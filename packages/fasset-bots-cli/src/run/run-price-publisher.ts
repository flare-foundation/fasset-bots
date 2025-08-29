import "dotenv/config";
import "source-map-support/register";

import { PricePublisherService } from "@flarenetwork/fasset-bots-core";
import { Secrets, loadConfigFile } from "@flarenetwork/fasset-bots-core/config";
import { authenticatedHttpProvider, initWeb3, sleep } from "@flarenetwork/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const program = programWithCommonOptions("bot", "all_fassets");

program.action(async () => {
    const options: { config: string; secrets: string } = program.opts();
    const secrets = await Secrets.load(options.secrets);
    const runConfig = loadConfigFile(options.config);
    const pricePublisherAddress: string = secrets.required("pricePublisher.address");
    const pricePublisherPrivateKey: string = secrets.required("pricePublisher.private_key");
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [pricePublisherPrivateKey], null);
    // start price publisher
    const pricePublisherService = await PricePublisherService.create(runConfig, secrets, pricePublisherAddress);
    pricePublisherService.start();
    // run
    console.log("Price publisher bot started, press CTRL+C to end");
    const stopBot = () => {
        console.log("Price publisher bot stopping...");
        pricePublisherService.requestStop();
    }
    process.on("SIGINT", stopBot);
    process.on("SIGTERM", stopBot);
    while (!pricePublisherService.stopped) {
        await sleep(1000);
    }
    console.log("Price publisher bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
