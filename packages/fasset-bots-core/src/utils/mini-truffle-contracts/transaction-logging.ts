import "dotenv/config";

import { createCustomizedLogger, Logger } from "@flarenetwork/fasset-bots-common";

export const transactionLogger: Logger = createCustomizedLogger({
    json: "log/transactions/transactions-%DATE%.log.json",
    logTarget: process.env.LOG_TARGET
});

// Return first line of the error message
export function extractErrorMessage(error: any, defaultMsg: string = "Unknown error") {
    /* istanbul ignore next */
    return (error?.message as string)?.split("\n")[0] ?? defaultMsg;
}
