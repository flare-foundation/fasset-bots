export enum BotType {
    AGENT = "agent",
    LIQUIDATOR = "liquidator",
    CHALLENGER = "challenger"
}

export enum NotificationLevel {
    INFO = "info",
    DANGER = "danger",
    CRITICAL = "critical"
}

export interface NotificationData {
    type: BotType;
    address: string;
    level: NotificationLevel;
    title: string;
    message: string;
}

export interface NotifierTransport {
    send(type: BotType, address: string, level: NotificationLevel, title: string, message: string): Promise<void>;
}
