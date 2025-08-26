import type { NotificationLevel } from "./BaseNotifier";

export interface ApiNotifierConfig {
    apiUrl: string;
    apiKey?: string;
    level?: NotificationLevel;
}
