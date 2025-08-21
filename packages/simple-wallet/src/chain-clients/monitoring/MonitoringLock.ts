import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, retryDatabaseTransaction, transactional, updateMonitoringState } from "../../db/dbutils";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOCK_WAIT_DELAY, MONITOR_PING_INTERVAL, RANDOM_SLEEP_MS_MAX } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { getRandomInt, sleepMs } from "../../utils/utils";


export class MonitoringLock {
    constructor(
        public readonly chainType: ChainType,
        public readonly monitoringId: string
    ) {
    }

    /**
     * Only one monitoring process can be alive at any time; this is taken care of by this method.
     */
    async waitAndAcquire(threadEm: EntityManager) {
        const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
        await sleepMs(randomMs);
        // try to acquire free lock
        const start = await this.acquire(threadEm);
        if (start.acquired) {
            logger.info(`Monitoring created for chain ${this.monitoringId}`);
            return true;
        }
        // lock is marked as locked, wait a bit to see if it is alive or should be taken over
        logger.info(`Monitoring possibly running for chain ${this.monitoringId} - waiting for liveness confirmation or expiration`);
        const startTime = Date.now();
        while (Date.now() - startTime < MONITOR_EXPIRATION_INTERVAL + 2 * MONITOR_PING_INTERVAL) { // condition not really necessary - loop should always finish before this
            await sleepMs(MONITOR_LOCK_WAIT_DELAY);
            // try to acquire lock again
            const next = await this.acquire(threadEm);
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

    async acquire(threadEm: EntityManager) {
        return await retryDatabaseTransaction(`trying to obtain monitoring lock for chain ${this.monitoringId}`, async () => {
            return await transactional(threadEm, async (em) => {
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

    async release(threadEm: EntityManager) {
        await retryDatabaseTransaction(`stopping monitor for chain ${this.monitoringId}`, async () => {
            await updateMonitoringState(threadEm, this.chainType, (monitoringEnt) => {
                if (monitoringEnt.processOwner === this.monitoringId) {
                    monitoringEnt.processOwner = "";
                    monitoringEnt.lastPingInTimestamp = toBN(0);
                }
            });
        });
    }

    async holds(threadEm: EntityManager): Promise<boolean> {
        const now = Date.now();
        const monitoringState = await fetchMonitoringState(threadEm, this.chainType);
        if (!monitoringState || monitoringState.processOwner !== this.monitoringId) {
            return false;
        }
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        if (elapsed >= MONITOR_EXPIRATION_INTERVAL) {
            logger.error(`Running monitor lock expired for chain ${this.monitoringId} (${elapsed / 1000}s since last ping) - stopping monitor.`);
        }
        return elapsed < MONITOR_EXPIRATION_INTERVAL;
    }
}
