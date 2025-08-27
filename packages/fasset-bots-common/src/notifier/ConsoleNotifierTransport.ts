import chalk from "chalk";
import { BotType, NotificationLevel, NotifierTransport } from "./NotifierTransport";

export class ConsoleNotifierTransport implements NotifierTransport {
    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        console.log(`${chalk.cyan(`${title}:`)} ${message}`);
    }
}
