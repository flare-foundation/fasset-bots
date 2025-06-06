import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands } from "@flarenetwork/fasset-bots-core";
import { Secrets } from "@flarenetwork/fasset-bots-core/config";
import { Truffle } from "@flarenetwork/fasset-bots-core/types";
import { assertNotNullCmd, blockTimestamp, DAYS, getOrCreateAsync, isBigNumber, web3DeepNormalize } from "@flarenetwork/fasset-bots-core/utils";
import fs from "node:fs";
import { programWithCommonOptions } from "../utils/program";
import { registerToplevelFinalizer, toplevelRun } from "../utils/toplevel";
import { validate, validateInteger, validateOneOf } from "../utils/validation";

const program = programWithCommonOptions("util", "single_fasset");

program.name("utils").description("Various helpful tools");

program
    .command("logs")
    .description("list logs for asset manager")
    .option("-f, --from <number>", "list event from block")
    .option("-u, --until <number>", "list events to block (default: last finalized block")
    .option("-n, --number  <number>", "instead of listing blocks from 'from', list this number of block before 'to'")
    .option("-t, --contract <name>", "contract name (one of: assetManager, fAsset, assetManagerController, coreVaultManager, priceChangeEmitter, wNat, addressUpdater, agentOwnerRegistry; default: assetManager)")
    .option("-o, --out <file>", "output file; default stdout")
    .action(async (opts: { from?: string, until?: string, number?: string, contract?: string, out?: string }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        // validate options
        validateInteger(opts.from, "from", { min: 10_000_000 });
        validateInteger(opts.until, "to", { min: 0 });
        validateInteger(opts.number, "number", { min: 1 });
        validate(opts.from != null || opts.number != null, "either 'from' or 'number' must be present");
        validateOneOf(opts.contract, "contract name", ["assetManager", "fAsset", "assetManagerController", "coreVaultManager", "priceChangeEmitter", "wNat", "addressUpdater", "agentOwnerRegistry"]);
        // load
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const fromOrNumber = opts.from ? Number(opts.from) : -Number(opts.number);
        const toBlock = opts.until != null ? Number(opts.until) : undefined;
        const contractName = opts.contract ?? "assetManager";
        const contract = bot.context[contractName];
        assertNotNullCmd(contract, `missing contract ${contractName}`);
        // run
        const outfile = opts.out ? fs.openSync(opts.out, "w") : process.stdout.fd;
        try {
            await printEvents(bot, contract, fromOrNumber, toBlock, outfile);
        } finally {
            if (outfile !== process.stdout.fd) {
                fs.closeSync(outfile);
            }
        }
    });

async function printEvents(bot: InfoBotCommands, contract: Truffle.ContractInstance, fromOrNumber: number, toBlock: number | undefined, outfile: number) {
    const blockTimestamps = new Map<string, number>();
    let lastPrintTs = 0, count = 0;
    const startTime = Date.now();
    for await (const event of bot.readLogs(contract, fromOrNumber, toBlock)) {
        const timestamp = await getOrCreateAsync(blockTimestamps, String(event.blockNumber), (bn) => blockTimestamp(bn));
        const niceArgs = Object.fromEntries(
            Object.entries(event.args as any)
                .filter(([k, v]) => !isBigNumber(k) && k !== "__length__")
                .map(([k, v]) => [k, web3DeepNormalize(v)]));
        const datetime = new Date(timestamp * 1000).toISOString().replace(/\.0+Z$/, "Z");
        if (timestamp - lastPrintTs >= DAYS) {
            lastPrintTs = timestamp;
            console.error(`Exporting date ${datetime}, event count ${count}, elapsed ${(Date.now() - startTime) / 1000}s`);
        }
        const niceEvent = {
            datetime: datetime,
            block: Number(event.blockNumber),
            transaction: Number(event.transactionIndex),
            timestamp: timestamp,
            name: event.event,
            args: niceArgs,
        };
        fs.writeSync(outfile, JSON.stringify(niceEvent) + "\n");
        ++count;
    }
}

toplevelRun(async () => {
    await program.parseAsync();
});
