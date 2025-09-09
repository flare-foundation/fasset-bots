import { LockMode } from "@mikro-orm/core";
import { EM } from "../config/orm";
import { ActivityTimestampEntity } from "../entities/activityTimestamp";
import { toBN } from "../utils/helpers";
import { logger } from "../utils/logger";

let activityUpdateTimer: NodeJS.Timeout | null = null;

async function activityTimestampUpdate(rootEm: EM) {
    await rootEm.transactional(async (em) => {
        let stateEnt = await em.findOne(ActivityTimestampEntity, { id: 1 }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!stateEnt) {
            stateEnt = new ActivityTimestampEntity();
        } else {
            stateEnt.lastActiveTimestamp = toBN(Math.floor((new Date()).getTime() / 1000));
        }
        await em.persistAndFlush(stateEnt);
    }).catch(error => {
        logger.error("Error updating timestamp:", error);
        console.error(`Error updating timestamp: ${error}`);
    });
}

export function startActivityTimestampUpdater(rootEm: EM, activityUpdateInterval: number) {
    const threadEm = rootEm.fork();
    void activityTimestampUpdate(threadEm);
    activityUpdateTimer = setInterval(() => void activityTimestampUpdate(threadEm), activityUpdateInterval);
}

export function stopActivityTimestampUpdater() {
    if (activityUpdateTimer) {
        clearInterval(activityUpdateTimer);
        logger.info("Activity update timer was cleared.");
        console.log("Activity update timer was cleared.");
    }
}

/**
 * Returns last activity timestamp in seconds, or 0 if there is no activity recorded in the database.
 */
export async function lastActivityTimestampSeconds(em: EM) {
    const query = em.createQueryBuilder(ActivityTimestampEntity);
    const result = await query.limit(1).getSingleResult();
    return toBN(result?.lastActiveTimestamp ?? 0).toNumber();
}
