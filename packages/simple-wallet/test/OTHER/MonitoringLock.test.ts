import { assert, expect } from "chai";
import { MonitoringLock } from "../../src/chain-clients/monitoring/MonitoringLock";
import { updateMonitoringState } from "../../src/db/dbutils";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOCK_WAIT_DELAY, MONITOR_PING_INTERVAL } from "../../src/utils/constants";
import { sleepMs } from "../../src/utils/utils";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";

describe("MonitoringLock tests", () => {
    let testOrm: ORM;

    beforeEach(async () => {
        testOrm = await initializeTestMikroORM();
    });

    function createTestLock(monitoringId: string) {
        const lock = new MonitoringLock(ChainType.testXRP, monitoringId);
        lock.randomSleepMsMax = 0;
        lock.monitorExpirationInterval = MONITOR_EXPIRATION_INTERVAL / 10;
        lock.monitorPingInterval = MONITOR_PING_INTERVAL / 10;
        lock.monitorLockWaitDelay = MONITOR_LOCK_WAIT_DELAY / 10;
        return lock;
    }

    async function createActiveLock() {
        const oldlock = createTestLock(`monitor-xyz`);
        await oldlock.acquire(testOrm.em);
    }

    async function createExpiredLock() {
        const oldlock = createTestLock(`monitor-xyz`);
        await oldlock.acquire(testOrm.em);
        await updateMonitoringState(testOrm.em, oldlock.chainType, (l) => { l.lastPingInTimestamp = l.lastPingInTimestamp.subn(oldlock.monitorExpirationInterval + 1000); });
    }

    async function testAcquire(n: number, expectLocks: number, create: (i: number) => MonitoringLock) {
        const locks: MonitoringLock[] = [];
        for (let i = 0; i < n; i++) {
            locks.push(create(i));
        }
        let totalAcquires = 0;
        await Promise.all(locks.map(async (lock) => {
            const threadEm = testOrm.em.fork();
            const lockAcquired = (await lock.acquire(threadEm)).acquired;
            if (lockAcquired) {
                totalAcquires++;
            }
        }));
        assert.equal(totalAcquires, expectLocks);
    }

    async function testWaitAndAcquire(n: number, expectLocks: number, create: (i: number) => MonitoringLock) {
        const locks: MonitoringLock[] = [];
        for (let i = 0; i < n; i++) {
            locks.push(create(i));
        }
        let totalAcquires = 0;
        await Promise.all(locks.map(async (lock) => {
            const threadEm = testOrm.em.fork();
            // const lockAcquired = (await lock.acquire(threadEm)).acquired;
            const lockAcquired = await lock.waitAndAcquire(threadEm);
            if (lockAcquired) {
                totalAcquires++;
                await sleepMs(lock.monitorPingInterval);
                await lock.ping(threadEm);
            }
        }));
        assert.equal(totalAcquires, expectLocks);
    }

    describe("test acquire", () => {
        it("test acquire - locks with same chainType and different monitoringId", async () => {
            await testAcquire(5, 1, i => createTestLock(`monitor-${i}`));
        });

        it("test acquire - many times with same lock", async () => {
            const lock = createTestLock(`monitor-1`);
            await testAcquire(5, 1, i => lock);
        });

        it("test acquire - locks with same chainType and different monitoringId, have expired lock before", async () => {
            await createExpiredLock();
            await testAcquire(5, 1, i => createTestLock(`monitor-${i}`));
        });

        it("test acquire - many times with same lock, have expired lock before", async () => {
            await createExpiredLock();
            const lock = createTestLock(`monitor-1`);
            await testAcquire(5, 1, i => lock);
        });

        it("test acquire - locks with same chainType and different monitoringId, have active lock before", async () => {
            await createActiveLock();
            await testAcquire(5, 0, i => createTestLock(`monitor-${i}`));
        });

        it("test acquire - many times with same lock, have active lock before", async () => {
            await createActiveLock();
            const lock = createTestLock(`monitor-1`);
            await testAcquire(5, 0, i => lock);
        });
    });

    describe("test waitAndAcquire", () => {
        it("test waitAndAcquire - locks with same chainType and different monitoringId", async () => {
            await testWaitAndAcquire(5, 1, i => createTestLock(`monitor-${i}`));
        });

        it("test waitAndAcquire - many times with same lock", async () => {
            const lock = createTestLock(`monitor-1`);
            await testWaitAndAcquire(5, 1, i => lock);
        });

        it("test waitAndAcquire - locks with same chainType and different monitoringId, have expired lock before", async () => {
            await createExpiredLock();
            await testWaitAndAcquire(5, 1, i => createTestLock(`monitor-${i}`));
        });

        it("test waitAndAcquire - many times with same lock, have expired lock before", async () => {
            await createExpiredLock();
            const lock = createTestLock(`monitor-1`);
            await testWaitAndAcquire(5, 1, i => lock);
        });

        it("test waitAndAcquire - locks with same chainType and different monitoringId, have active lock before", async () => {
            await createActiveLock();
            // Here the locks will wait that active one expires, and then one will be acquired.
            await testWaitAndAcquire(5, 1, i => createTestLock(`monitor-${i}`));
        });

        it("test waitAndAcquire - many times with same lock, have active lock before", async () => {
            await createActiveLock();
            const lock = createTestLock(`monitor-1`);
            // Here the locks will wait that active one expires, and then one will be acquired.
            await testWaitAndAcquire(5, 1, i => lock);
        });

        it("test waitAndAcquire - allow only one monitor lock per chainType", async () => {
            const monitorLock = createTestLock(`monitor-1`);
            const NUM_CALLS = 500;
            const promises = Array.from({ length: NUM_CALLS }, () =>
                monitorLock.waitAndAcquire(testOrm.em)
            );
            const results = await Promise.all(promises);
            // The correct amount of acquires here (on empty db) is 2: initially one lock is acquired. Since there are no pings,
            // all other waitAndAcquire calls will wait for its expiration. Once the first lock expires, one more lock will be acquired.
            // At that time all other waitAndAcquire calls will see that the lock time was updated, so they will give up because the lock is apparently active.
            expect(results.filter(r => r === true)).to.have.lengthOf(2);
        });
    });
});
