import { systemTimestamp } from "../utils/common-helpers";
import { BotType, NotificationData, NotificationLevel, NotifierTransport } from "./NotifierTransport";

export type NotificationKeyFunction = (nd: NotificationData) => string;

export namespace NotificationThrottlingKey {
    export const title = (nd: NotificationData) => nd.title;
    export const titleAndAddress = (nd: NotificationData) => `${nd.title}-${nd.address}`;
    export const titleAndMessage = (nd: NotificationData) => `${nd.title}-${nd.message}`;
}

// the time in seconds to throttle alert with title `notificationKey` (default no throttle)
export type NotifierThrottlingConfig = { duration: number; key: NotificationKeyFunction; };

export type NotifierThrottlingConfigs = { [notificationKey: string]: NotifierThrottlingConfig };

export class ThrottlingNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;

    constructor(
        public wrappedTransport: NotifierTransport,
        public throttling: NotifierThrottlingConfigs
    ) {}

    public lastAlertAt: { [notificationKey: string]: number; } = {};

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        const timestamp = systemTimestamp();
        const throttling = this.throttling[title];
        if (throttling) {
            const key = throttling.key({ type, address, level, title, message });
            const lastAlertAt = this.lastAlertAt[key] ?? 0;
            if (timestamp - lastAlertAt >= throttling.duration) {
                await this.wrappedTransport.send(type, address, level, title, message);
                this.lastAlertAt[key] = timestamp;
            }
        } else {
            // no throttling for this message type
            await this.wrappedTransport.send(type, address, level, title, message);
        }
    }
}
