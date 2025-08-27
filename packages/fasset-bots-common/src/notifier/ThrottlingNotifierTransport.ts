import { systemTimestamp } from "../utils/common-helpers";
import { BotType, NotificationLevel, NotifierTransport } from "./NotifierTransport";

// the time in seconds to throttle alert with title `notificationKey` (default no throttle)
export type NotifierThrottlingConfig = { duration: number; addressInKey: boolean; };

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
            const key = throttling.addressInKey ? `${title}-${address}` : title;
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
