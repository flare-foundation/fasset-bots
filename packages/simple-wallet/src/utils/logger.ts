import "dotenv/config";

import { createCustomizedLogger, Logger } from "@flarenetwork/fasset-bots-common";

const loggerName = "simple-wallet";

export const logger: Logger = createCustomizedLogger({
    json: `log/json/${loggerName}-%DATE%.log.json`,
    text: `log/text/${loggerName}-%DATE%.log`,
    logTarget: process.env.SEND_LOGS_TO
});
