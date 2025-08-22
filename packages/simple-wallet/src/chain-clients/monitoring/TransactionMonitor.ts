import { EntityManager } from "@mikro-orm/core";
import { fetchMonitoringState, fetchTransactionEntities } from "../../db/dbutils";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { ITransactionMonitor } from "../../interfaces/IWalletTransaction";
import { errorMessage } from "../../utils/axios-utils";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOOP_SLEEP, MONITOR_PING_INTERVAL, RESTART_IN_DUE_NO_RESPONSE } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { loggerAsyncStorage } from "../../utils/logger-config";
import { createMonitoringId, sleepMs } from "../../utils/utils";
import { MonitoringLock } from "./MonitoringLock";

export interface IMonitoredWallet {
    submitPreparedTransactions(txEnt: TransactionEntity): Promise<void>;
    checkPendingTransaction(txEnt: TransactionEntity): Promise<void>;
    prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkNetworkStatus(): Promise<boolean>;
    resubmitSubmissionFailedTransactions?(txEnt: TransactionEntity): Promise<void>;
}

export interface CreateWalletOverrides {
    monitoringId?: string;
    walletEm?: EntityManager;
    feeService?: BlockchainFeeService;
}

export type CreateWalletMethod = (overrides: CreateWalletOverrides) => IMonitoredWallet;

class StopTransactionMonitor extends Error {}

export class TransactionMonitor implements ITransactionMonitor {
    private monitoring = false;
    private readonly chainType: ChainType;
    private readonly rootEm: EntityManager;
    private readonly runningThreads: Map<Promise<void>, string> = new Map();
    private readonly createWallet: CreateWalletMethod;
    private readonly monitoringId: string;
    private readonly feeService: BlockchainFeeService | undefined;
    private readonly monitoringLock: MonitoringLock;
    private initializing: boolean = false;

    constructor(chainType: ChainType, rootEm: EntityManager, createWallet: CreateWalletMethod, feeService?: BlockchainFeeService) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.createWallet = createWallet;
        this.monitoringId = createMonitoringId(`${chainType}-m`);
        this.feeService = feeService;
        this.monitoringLock = new MonitoringLock(this.chainType, this.monitoringId);
    }

    getId(): string {
        return this.monitoringId;
    }

    isMonitoring(): boolean {
        return this.monitoring || this.runningThreads.size > 0;
    }

    async startMonitoring(): Promise<void> {
        if (this.initializing || this.runningThreads.size > 0) {
            logger.info(`Monitor ${this.monitoringId} already used or initializing`);
            return;
        }
        this.initializing = true;
        try {
            const acquiredLock = await this.monitoringLock.waitAndAcquire(this.rootEm);
            if (!acquiredLock) {
                return;   // monitoring is already running elsewhere
            }
            // mark started
            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.monitoringId}`);
            // start pinger
            this.startThread(this.rootEm, `ping-${this.monitoringId}`, async (em) => {
                await this.updatePingLoop(em);
            });
            // start fee monitoring
            const feeService = this.feeService;
            if (feeService) {
                feeService.monitoringId = this.monitoringId;
                feeService.initialSetup = true;
                this.startThread(this.rootEm, `fee-service-${this.monitoringId}`, async (threadEm) => {
                    await feeService.monitorFees(threadEm, () => this.monitoring);
                });
            }
            // start main loop
            this.startThread(this.rootEm, `monitoring-${this.monitoringId}`, async (threadEm) => {
                const waitStart = Date.now();
                while (feeService && !(feeService?.hasEnoughTimestampHistory() || Date.now() - waitStart > 60_000)) {
                    await sleepMs(500);    // wait for setupHistory to be complete (or fail)
                }
                const wallet = this.createWallet({ monitoringId: this.monitoringId, walletEm: threadEm, feeService: feeService });
                await this.monitoringMainLoop(threadEm, wallet);
            });
        } finally {
            this.initializing = false;
        }
    }

    async stopMonitoring(): Promise<void> {
        logger.info(`Monitoring stop requested for ${this.monitoringId} ...`);
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (monitoringState?.processOwner === this.monitoringId) {
            logger.info(`Stopping wallet monitoring ${this.monitoringId} ...`);
            console.log(`Stopping wallet monitoring ${this.monitoringId} ...`);
            this.monitoring = false;
            // wait for all 3 threads to stop
            await this.waitForThreadsToStop();
            await this.monitoringLock.release(this.rootEm);
            logger.info(`Monitoring stopped for ${this.monitoringId}`);
            console.log(`Monitoring stopped for ${this.monitoringId}`);
        } else if (monitoringState?.processOwner != null) {
            logger.info(`Monitoring will NOT stop. Process ${this.monitoringId} is not owner of current process ${monitoringState.processOwner}`);
        } else {
            logger.info(`Monitoring already stopped, no need to stop ${this.monitoringId}.`);
        }
    }

    async runningMonitorId(): Promise<string | null> {
        const now = Date.now();
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (monitoringState == null) return null;
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        if (elapsed > MONITOR_EXPIRATION_INTERVAL) return null;
        return monitoringState.processOwner;
    }

    private async waitForThreadsToStop() {
        await Promise.allSettled(Array.from(this.runningThreads.keys()));
        /* istanbul ignore next: should never happen */
        if (this.runningThreads.size > 0) {
            const remaining = Array.from(this.runningThreads.values());
            logger.error(`Threads not stopped properly - threads [${remaining}] not cleaned up.`);
            this.runningThreads.clear();
        }
    }

    private startThread(rootEm: EntityManager, name: string, method: (em: EntityManager) => Promise<void>) {
        const thread = loggerAsyncStorage.run(name, async () => {
            logger.info(`Thread started ${name}.`);
            try {
                const threadEm = rootEm.fork();
                await method(threadEm);
                logger.info(`Thread ended ${name}.`);
            } catch (error) {
                logger.error(`Thread ${name} stopped due to unexpected error:`, error);
            } finally {
                this.runningThreads.delete(thread);
            }
        });
        this.runningThreads.set(thread, name);
    }


    private async updatePingLoop(threadEm: EntityManager): Promise<void> {
        while (this.monitoring) {
            try {
                const result = await this.monitoringLock.ping(threadEm);
                if (result === "takenOver") {
                    this.monitoring = false;
                }
            } catch (error) {
                logger.error(`${String(error)} - retrying in ${MONITOR_PING_INTERVAL}sec`);    // error will always be "Too many failed attepmts..."
            }
            await sleepMs(MONITOR_PING_INTERVAL);
        }
    }

    private async monitoringMainLoop(threadEm: EntityManager, wallet: IMonitoredWallet) {
        let count = 0;
        while (this.monitoring) {
            try {
                threadEm.clear();
                const networkUp = await wallet.checkNetworkStatus();
                if (!networkUp) {
                    logger.error(`Network is down ${this.monitoringId} - trying again in ${RESTART_IN_DUE_NO_RESPONSE}`);
                    await sleepMs(RESTART_IN_DUE_NO_RESPONSE);
                    continue;
                }
                await this.processTransactions(threadEm, [TransactionStatus.TX_PREPARED], wallet.submitPreparedTransactions.bind(wallet));
                if (wallet.resubmitSubmissionFailedTransactions) {
                    await this.processTransactions(threadEm, [TransactionStatus.TX_SUBMISSION_FAILED], wallet.resubmitSubmissionFailedTransactions.bind(wallet));
                }
                await this.processTransactions(threadEm, [TransactionStatus.TX_PENDING], wallet.checkPendingTransaction.bind(wallet));
                await this.processTransactions(threadEm, [TransactionStatus.TX_CREATED], wallet.prepareAndSubmitCreatedTransaction.bind(wallet));
                // only check submitted transactions every 10 loops
                if (count % 10 === 0) {
                    await this.processTransactions(threadEm, [TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_REPLACED_PENDING], wallet.checkSubmittedTransaction.bind(wallet));
                }
            } catch (error) {
                if (error instanceof StopTransactionMonitor) break;
                logger.error(`Monitoring ${this.monitoringId} run into error. Restarting in ${MONITOR_LOOP_SLEEP}: ${errorMessage(error)}`);
            }
            if (this.monitoring) {
                await sleepMs(MONITOR_LOOP_SLEEP);
            }
            count++;
        }
        logger.info(`Monitoring stopped for chain ${this.monitoringId}`);
    }

    async processTransactions(
        threadEm: EntityManager,
        statuses: TransactionStatus[],
        processFunction: (txEnt: TransactionEntity) => Promise<void>
    ): Promise<void> {
        await this.checkIfMonitoringStopped(threadEm);
        const transactionEntities = await fetchTransactionEntities(threadEm, this.chainType, statuses);
        logger.info(`Processing ${transactionEntities.length} transactions with statuses: ${statuses}`);
        for (const txEnt of transactionEntities) {
            await this.checkIfMonitoringStopped(threadEm);
            try {
                logger.info(`Started processing transaction ${txEnt.id} with status ${txEnt.status}`);
                await processFunction(txEnt);
            } catch (error) /* istanbul ignore next */ {
                logger.error(`Cannot process transaction ${txEnt.id}: ${errorMessage(error)}`);
            }
        }
    }

    private async checkIfMonitoringStopped(threadEm: EntityManager) {
        const monitoringAlive = this.monitoring && await this.monitoringLock.holds(threadEm);
        if (!monitoringAlive) {
            logger.info(`Monitoring should be stopped for chain ${this.monitoringId}`);
            this.monitoring = false;    // notify other threads that lock was lost
            throw new StopTransactionMonitor();
        }
    }
}
