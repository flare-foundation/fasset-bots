import "dotenv/config";
import "source-map-support/register";

import { ActorBaseKind, ActorBaseRunner } from "@flarenetwork/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadConfigFile } from "@flarenetwork/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, logger } from "@flarenetwork/fasset-bots-core/utils";
import { programWithCommonOptions, getOneDefaultToAll } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { ChallengerNotifier } from "../../../fasset-bots-core/src/utils/notifier/ChallengerNotifier";

const program = programWithCommonOptions("bot", "all_fassets");

let activityUpdateTimer: NodeJS.Timeout | null = null;
const activityUpdateInterval = 120000; // 2min

async function activityTimestampUpdate(notifier: ChallengerNotifier) {
    try {
        await notifier.sendActivityReport()
    } catch (error) {
        logger.error("Error sending timestamp:", error);
        console.error(`Error sending timestamp: ${error}`);
    }
}

function startTimestampUpdater(notifier: ChallengerNotifier) {
    activityUpdateTimer = setInterval(() => void activityTimestampUpdate(notifier), activityUpdateInterval);
}

program.action(async () => {
    const options: { config: string; secrets: string, fasset?: string } = program.opts();
    const secrets = await Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const challengerAddress: string = secrets.required("challenger.address");
    const challengerPrivateKey: string = secrets.required("challenger.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [challengerPrivateKey], null);
    const config = await createBotConfig("keeper", secrets, runConfig, challengerAddress);
    logger.info(`Asset manager controller is ${config.contractRetriever.assetManagerController.address}.`);
    const fassetList = getOneDefaultToAll(config.fAssets, options.fasset);
    const runners = await Promise.all(fassetList.map(
        (chainConfig) => ActorBaseRunner.create(config, challengerAddress, ActorBaseKind.CHALLENGER, chainConfig)
    ));
    // start activity update
    if (runners.length > 0) { // only the first runner will send updates (this should not be a problem as only FXRP will be running)
        startTimestampUpdater(runners[0].actor.notifier as ChallengerNotifier);
    }
    // run
    try {
        console.log("Challenger bot started, press CTRL+C to end");
        const stopBot = () => {
            console.log("Challenger bot stopping...");
            runners.forEach(runner => runner.requestStop());
        }
        process.on("SIGINT", stopBot);
        process.on("SIGTERM", stopBot);
        await Promise.allSettled(runners.map(
            runner => runner.run(ActorBaseKind.CHALLENGER))
        );
    } finally {
        if (activityUpdateTimer) {
            clearInterval(activityUpdateTimer);
            logger.info("Activity update timer was cleared.");
            console.log("Activity update timer was cleared.");
        }
        await closeBotConfig(config);
    }
    console.log("Challenger bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
