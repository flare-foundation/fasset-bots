import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, fetchTransactionEntities, retryDatabaseTransaction, transactional, updateMonitoringState } from "../../db/dbutils";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOCK_WAIT_DELAY, MONITOR_LOOP_SLEEP, MONITOR_PING_INTERVAL, RANDOM_SLEEP_MS_MAX, RESTART_IN_DUE_NO_RESPONSE } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { loggerAsyncStorage } from "../../utils/logger-config";
import { createMonitoringId, getRandomInt, sleepMs } from "../../utils/utils";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { errorMessage } from "../../utils/axios-utils";
import { ITransactionMonitor } from "../../interfaces/IWalletTransaction";

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
    private chainType: ChainType;
    private rootEm: EntityManager;
    private runningThreads: Map<Promise<void>, string> = new Map();
    private createWallet: CreateWalletMethod;
    private monitoringId: string;
    private feeService: BlockchainFeeService | undefined;

    constructor(chainType: ChainType, rootEm: EntityManager, createWallet: CreateWalletMethod, feeService?: BlockchainFeeService) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.createWallet = createWallet;
        this.monitoringId = createMonitoringId(`${chainType}-m`);
        this.feeService = feeService;
    }

    getId(): string {
        return this.monitoringId;
    }

    isMonitoring(): boolean {
        return this.monitoring || this.runningThreads.size > 0;
    }

    async startMonitoring(): Promise<boolean> {
        if (this.runningThreads.size > 0) {
            logger.error(`Monitor ${this.monitoringId} already used`);
            return true;
        }
        const acquiredLock = await this.waitAndAcquireMonitoringLock(this.rootEm);
        if (!acquiredLock) {
            return false;   // monitoring is already running elsewhere
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
        return true;
    }

    async stopMonitoring(): Promise<void> {
        logger.info(`Monitoring will stop for ${this.monitoringId} ...`);
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (monitoringState?.processOwner === this.monitoringId) {
            console.log(`Stopping wallet monitoring ${this.monitoringId} ...`);
            this.monitoring = false;
            // wait for all 3 threads to stop
            await this.waitForThreadsToStop();
            await this.releaseMonitoringLock(this.rootEm);
            logger.info(`Monitoring stopped for ${this.monitoringId}`);
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

    /**
     * Only one monitoring process can be alive at any time; this is taken care of by this method.
     */
    async waitAndAcquireMonitoringLock(threadEm: EntityManager) {
        const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
        await sleepMs(randomMs);
        // try to acquire free lock
        const start = await this.acquireMonitoringLock(threadEm);
        if (start.acquired) {
            logger.info(`Monitoring created for chain ${this.monitoringId}`);
            return true;
        }
        // lock is marked as locked, wait a bit to see if it is alive or should be taken over
        logger.info(`Monitoring possibly running for chain ${this.monitoringId} - waiting for liveness confirmation or expiration`);
        const startTime = Date.now();
        while (Date.now() - startTime < MONITOR_EXPIRATION_INTERVAL + 2 * MONITOR_PING_INTERVAL) {   // condition not really necessary - loop should always finish before this
            await sleepMs(MONITOR_LOCK_WAIT_DELAY);
            // try to acquire lock again
            const next = await this.acquireMonitoringLock(threadEm);
            // if the lock expired or was released in the meantime, it will be acquired now
            if (next.acquired) {
                logger.info(`Monitoring created for chain ${this.monitoringId} - old lock released or expired`);
                return true;
            }
            // if the lock ping tme increased, the thread holding it is apparently still active, so we give up and leave the old thread to do the work
            if (next.lastPing > start.lastPing) {
                logger.info(`Another monitoring instance is already running for chain ${this.monitoringId}`);
                return false;
            }
        }
        logger.warn(`Timeout waiting for monitoring lock for chain ${this.monitoringId}`);
        return false;
    }

    async acquireMonitoringLock(threadEm: EntityManager) {
        return await retryDatabaseTransaction(`trying to obtain monitoring lock for chain ${this.monitoringId}`, async () => {
            return await transactional(threadEm, async em => {
                const monitoringState = await fetchMonitoringState(em, this.chainType);
                const now = Date.now();
                if (monitoringState == null) {
                    // no lock has been created for this chain yet - create new
                    em.create(MonitoringStateEntity,
                        {
                            chainType: this.chainType,
                            lastPingInTimestamp: toBN(now),
                            processOwner: this.monitoringId
                        } as RequiredEntityData<MonitoringStateEntity>,
                        { persist: true });
                    return { acquired: true } as const;
                } else {
                    const lastPing = monitoringState.lastPingInTimestamp.toNumber();
                    if (now > lastPing + MONITOR_EXPIRATION_INTERVAL) {
                        // old lock expired or released (marked by lastPing==0) - take over lock
                        monitoringState.lastPingInTimestamp = toBN(now);
                        monitoringState.processOwner = this.monitoringId;
                        return { acquired: true } as const;
                    } else {
                        // just return the lock state
                        return { acquired: false, lastPing } as const;
                    }
                }
            });
        });
    }

    async holdsMonitoringLock(threadEm: EntityManager): Promise<boolean> {
        const now = Date.now();
        const monitoringState = await fetchMonitoringState(threadEm, this.chainType);
        if (!monitoringState || monitoringState.processOwner !== this.monitoringId) {
            return false;
        }
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        if (elapsed >= MONITOR_EXPIRATION_INTERVAL) {
            logger.error(`Running monitor lock expired for chain ${this.monitoringId} (${elapsed/1000}s since last ping) - stopping monitor.`);
        }
        return elapsed < MONITOR_EXPIRATION_INTERVAL;
    }

    async releaseMonitoringLock(threadEm: EntityManager) {
        await retryDatabaseTransaction(`stopping monitor for chain ${this.monitoringId}`, async () => {
            await updateMonitoringState(threadEm, this.chainType, (monitoringEnt) => {
                if (monitoringEnt.processOwner === this.monitoringId) {
                    monitoringEnt.processOwner = "";
                    monitoringEnt.lastPingInTimestamp = toBN(0);
                }
            });
        });
    }

    private async updatePingLoop(threadEm: EntityManager): Promise<void> {
        while (this.monitoring) {
            try {
                await retryDatabaseTransaction(`updating ping status for chain ${this.monitoringId}`, async () => {
                    await updateMonitoringState(threadEm, this.chainType, (monitoringEnt) => {
                        if (monitoringEnt.processOwner === this.monitoringId) {
                            monitoringEnt.lastPingInTimestamp = toBN(Date.now());
                        } else {
                            logger.error(`Monitoring thread was taken over from ${this.monitoringId} by ${monitoringEnt.processOwner}`);
                            this.monitoring = false;
                        }
                    });
                });
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
        const monitoringAlive = this.monitoring && await this.holdsMonitoringLock(threadEm);
        if (!monitoringAlive) {
            logger.info(`Monitoring should be stopped for chain ${this.monitoringId}`);
            this.monitoring = false;    // notify other threads that lock was lost
            throw new StopTransactionMonitor();
        }
    }
}
