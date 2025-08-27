import axios, { AxiosError, AxiosInstance } from "axios";
import chalk from "chalk";
import { logger } from "../logging/logger";
import { createAxiosConfig } from "../utils/axios-utils";
import { BotType, NotificationLevel, NotifierTransport } from "./NotifierTransport";

export interface ApiNotifierConfig {
    apiUrl: string;
    apiKey?: string;
    level?: NotificationLevel;
}

export interface PostAlert {
    bot_type: string; // agent, liquidator, challenger
    address: string;
    level: string; // info, danger, critical
    title: string;
    description: string;
}

export class ApiNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;
    protected minimumLevel: NotificationLevel = NotificationLevel.DANGER;

    client: AxiosInstance;

    constructor(public apiNotifierConfig: ApiNotifierConfig) {
        this.client = axios.create(createAxiosConfig(apiNotifierConfig.apiUrl, apiNotifierConfig.apiKey));
        if (apiNotifierConfig.level != null) {
            this.minimumLevel = apiNotifierConfig.level;
        }
    }

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        if (this.isLesserLevel(level, this.minimumLevel)) return;
        const request: PostAlert = {
            bot_type: type,
            address: address,
            level: level,
            title: title,
            description: message,
        };
        // run alert sending in the background
        void this.client.post(`/api/agent/botAlert`, request)
            .catch((e: AxiosError) => {
                const status = e.response?.status ?? "unknown status";
                const errorMessage = (e.response?.data as any)?.error ?? "unknown error";
                logger.error(`Notifier error: cannot send notification ${JSON.stringify(request)}: ${status}: ${errorMessage}`);
                console.error(`${chalk.red("Notifier error:")} cannot send notification (${request.level} to ${request.bot_type}) "${request.title}: ${request.description}"`)
            });
    }

    protected isLesserLevel(level1: NotificationLevel, level2: NotificationLevel): boolean {
        const vals = Object.values(NotificationLevel);
        return vals.indexOf(level1) < vals.indexOf(level2)
    }

}
