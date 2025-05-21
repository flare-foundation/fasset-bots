import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands } from "@flarenetwork/fasset-bots-core";
import { blockTimestamp, DAYS, getOrCreateAsync, isBigNumber, web3DeepNormalize } from "@flarenetwork/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateInteger } from "../utils/validation";
import { Secrets } from "@flarenetwork/fasset-bots-core/config";

const program = programWithCommonOptions("util", "single_fasset");

program.name("utils").description("Various helpful tools");

program
    .command("logs")
    .description("list logs for asset manager")
    .argument("<blockCount>", "the numer of blocks (until the current block) from which to list logs")
    .action(async (blockCount: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset);
        const blockTimestamps = new Map<string, number>();
        validateInteger(blockCount, "blockCount", { min: 1 });
        let lastPrintTs = 0, count = 0;
        const startTime = Date.now();
        for await (const event of bot.readAssetManagerLogs(Number(blockCount))) {
            const timestamp = await getOrCreateAsync(blockTimestamps, String(event.blockNumber), (bn) => blockTimestamp(bn));
            const niceArgs = Object.fromEntries(
                Object.entries(event.args as any)
                    .filter(([k, v]) => !isBigNumber(k) && k !== "__length__")
                    .map(([k, v]) => [k, web3DeepNormalize(v)]));
            const datetime = new Date(timestamp * 1000);
            if (timestamp - lastPrintTs >= DAYS) {
                lastPrintTs = timestamp;
                console.error(`Exporting date ${datetime.toISOString()}, event count ${count}, elapsed ${(Date.now() - startTime) / 1000}s`);
            }
            const niceEvent = {
                datetime: datetime.toISOString(),
                block: Number(event.blockNumber),
                timestamp: timestamp,
                name: event.event,
                args: niceArgs,
            }
            console.log(JSON.stringify(niceEvent));
            ++count;
        }
    });

toplevelRun(async () => {
    await program.parseAsync();
});
