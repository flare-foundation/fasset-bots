import { ApiNotifierTransport, BotType, NotificationLevel } from "@flarenetwork/fasset-bots-common";
import MockAdapter from "axios-mock-adapter";
import { sleep } from "../../src/utils";

// to use in tests
export class FaultyNotifierTransport extends ApiNotifierTransport {
    mock: MockAdapter | undefined;

    constructor() {
        super({
            apiUrl: "FaultyNotifier",
            apiKey: "MockApiKey",
            level: NotificationLevel.INFO
        });
        this.mock = new MockAdapter(this.client);
        this.mock.onPost("/api/0/bot_alert").reply(500, "Internal Server Error");
    }

    override async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string): Promise<void> {
        await super.send(type, address, level, title, message);
        await sleep(100);
    }
}
