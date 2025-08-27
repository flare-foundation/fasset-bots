import { ApiNotifierTransport, NotificationLevel } from "@flarenetwork/fasset-bots-common";
import MockAdapter from "axios-mock-adapter";

export class MockNotifierTransport extends ApiNotifierTransport {
    mock: MockAdapter | undefined;

    constructor() {
        super({
            apiUrl: "Mock",
            apiKey: "MockApiKey",
            level: NotificationLevel.INFO
        });
        this.mock = new MockAdapter(this.client);
        this.mock.onPost('/api/0/bot_alert').reply(config => {
            console.log('POST request made to /api/0/bot_alert', config.data);
            return [200, { data: 'Mocked data' }];
        });
    }
}
