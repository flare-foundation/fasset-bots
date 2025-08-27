import { logger } from "../logging/logger";
import { BotType, NotificationLevel, NotifierTransport } from "./NotifierTransport";

export class LoggerNotifierTransport implements NotifierTransport {
    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        if (level === NotificationLevel.INFO) {
            logger.info(`[ALERT:INFO] ${title}: ${message}`, { notification: { level, type, address } });
        } else if (level === NotificationLevel.DANGER) {
            logger.warn(`[ALERT:DANGER] ${title}: ${message}`, { notification: { level, type, address } });
        } else if (level === NotificationLevel.CRITICAL) {
            logger.error(`[ALERT:CRITICAL] ${title}: ${message}`, { notification: { level, type, address } });
        }
    }
}
