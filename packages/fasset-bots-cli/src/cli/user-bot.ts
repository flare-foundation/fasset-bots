import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands, PoolUserBotCommands, UserBotCommands } from "@flarenetwork/fasset-bots-core";
import { Secrets } from "@flarenetwork/fasset-bots-core/config";
import { BN_ZERO, formatFixed, logger, toBN, toBNExp, TokenBalances } from "@flarenetwork/fasset-bots-core/utils";
import BN from "bn.js";
import os from "os";
import path from "path";
import Web3 from "web3";
import { programWithCommonOptions } from "../utils/program";
import { registerToplevelFinalizer, toplevelRun } from "../utils/toplevel";
import { translateError, validate, validateAddress, validateDecimal, validateInteger } from "../utils/validation";

const program = programWithCommonOptions("user", "single_fasset");

program.name("user-bot").description("Command line commands for FAsset user (minter, redeemer, or collateral pool provider)");

program.addOption(
    program.createOption("-d, --dir <userDataDir>", `directory where minting and redemption state files will be stored`)
        .env("FASSET_USER_DATA_DIR")
        .default(path.resolve(os.homedir(), "fasset"))
);

program
    .command("info")
    .description("info about the system")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await bot.printSystemInfo();
    });

program
    .command("agents")
    .description("Lists the available agents")
    .option("-a, --all", "print all agents, including non-public")
    .option("-v, --verbose", "more verbose output (include underlying address; implies --all)")
    .action(async (opts: { all: boolean, verbose: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        if (opts.all || opts.verbose) {
            await bot.printAllAgents(opts.verbose);
        } else {
            await bot.printAvailableAgents();
        }
    });

program
    .command("agentCapacities")
    .description("Lists the available agents' capacity info")
    .action(async (opts: { all: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await bot.printAgentCapacities();
    });

program
    .command("agentInfo")
    .description("info about an agent")
    .argument("<agentVaultAddress>", "the address of the agent vault")
    .option("--raw", "print raw output of getAgentInfo")
    .option("--owner", "print some info about the owner")
    .action(async (agentVaultAddress: string, opts: { raw?: boolean, owner?: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        validateAddress(agentVaultAddress, "Agent vault address");
        try {
            const secrets = await Secrets.load(options.secrets);
            const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
            if (opts.raw) {
                await bot.printRawAgentInfo(agentVaultAddress);
            } else {
                await bot.printAgentInfo(agentVaultAddress, opts.owner ? "auto" : undefined);
            }
        } catch (error) {
            translateError(error, { "InvalidAgentVaultAddress": `Agent vault with address ${agentVaultAddress} does not exist.` });
        }
    });

program
    .command("mint")
    .description("Mints the amount of FAssets in lots")
    .option("-a --agent <agentVaultAddress>", "agent to use for minting; if omitted, use the one with least fee that can mint required number of lots")
    .argument("<numberOfLots>")
    .option("-u, --updateBlock")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .option("--noWait", "only reserve and pay for the minting, don't wait for payment finalization and proof; you have to execute the minting later")
    .option("--crFeeBump <bips>", "percentage of the collateral reservation fee that gets added to mitigate price changes")
    .action(async (numberOfLots: string, cmdOptions: { agent?: string, updateBlock?: boolean, executor?: string, executorFee?: string, noWait?: boolean, crFeeBump?: string }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        validateAddress(cmdOptions.agent, "Agent vault address");
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        validateAddress(cmdOptions.executor, "Executor address");
        validate(!cmdOptions.executor || !!cmdOptions.executorFee, "Option executorFee must be set when executor is set.");
        validate(!cmdOptions.executorFee || !!cmdOptions.executor, "Option executor must be set when executorFee is set.");
        validateDecimal(cmdOptions.crFeeBump, "CR fee bump", { min: 0, max: 0.2 });
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        const agentVault = cmdOptions.agent ?? (await minterBot.infoBot().findBestAgent(toBN(numberOfLots)));
        const crFeeBump = (cmdOptions.crFeeBump != null) ? Number(cmdOptions.crFeeBump) : undefined
        validate(agentVault != null, "No agent with enough free lots available.");
        try {
            if (cmdOptions.updateBlock) {
                await minterBot.updateUnderlyingTime();
            }
            if (cmdOptions.executor && cmdOptions.executorFee) {
                await minterBot.mint(agentVault, numberOfLots, !!cmdOptions.noWait, cmdOptions.executor, cmdOptions.executorFee, crFeeBump);
            } else {
                await minterBot.mint(agentVault, numberOfLots, !!cmdOptions.noWait, undefined, undefined, crFeeBump);
            }
        } catch (error) {
            translateError(error, {
                "InvalidAgentVaultAddress": `Agent vault with address ${agentVault} does not exist.`,
                "NotEnoughFreeCollateral": `Agent ${agentVault} does not have enough free collateral to accept the minting request.`,
                "AgentNotInMintQueue": `Agent ${agentVault} is not available for minting; try some other one.`,
                "InvalidAgentStatus": `Agent ${agentVault} is not available for minting; try some other one.`,
                "AgentsFeeTooHigh": `Agent ${agentVault} just changed minting fee; select an agent again.`,
            });
        }
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .option("--noWait", "don't wait for minting proof, but immediatelly exit with exitcode 10 if the proof isn't available")
    .action(async (requestId: string, cmdOptions: { noWait?: boolean }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        await minterBot.proveAndExecuteSavedMinting(requestId, cmdOptions.noWait ?? false);
    });

program
    .command("mintStatus")
    .description("List all open mintings")
    .option('--crt-id <crtId>', 'collateral reservation id (number)')
    .action(async (cmdOptions: { crtId?: string }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        if (cmdOptions.crtId !== undefined) {
            await minterBot.listMinting(cmdOptions.crtId);
        } else {
            await minterBot.listMintings();
        }
    });

program
    .command("updateMintings")
    .description("Update all open mintings")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        await redeemerBot.updateAllMintings();
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<numberOfLots>")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .action(async (numberOfLots: string, cmdOptions: { executor?: string, executorFee?: string }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        validateAddress(cmdOptions.executor, "Executor address");
        validate(!cmdOptions.executor || !!cmdOptions.executorFee, "Option executorFee must be set when executor is set.");
        validate(!cmdOptions.executorFee || !!cmdOptions.executor, "Option executor must be set when executorFee is set.");
        try {
            if (cmdOptions.executor && cmdOptions.executorFee) {
                await redeemerBot.redeem(numberOfLots, cmdOptions.executor, cmdOptions.executorFee);
            } else {
                await redeemerBot.redeem(numberOfLots);
            }
        } catch (error) {
            translateError(error, {
                "FAssetBalanceTooLow": `User account does not hold ${numberOfLots} lots of ${options.fasset}.`
            });
        }
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .option("--noWait", "don't wait for non-payment proof, but immediatelly exit with exitcode 10 if the proof isn't available")
    .action(async (requestId: string, cmdOptions: { noWait?: boolean }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        try {
            await redeemerBot.savedRedemptionDefault(requestId, cmdOptions.noWait ?? false);
        } catch (error) {
            translateError(error, {
                "RedemptionDefaultTooEarly": "Agent still has time to pay; please try redemptionDefault later if the redemption isn't paid."
            });
        }
    });

program
    .command("redemptionStatus")
    .description("List all open redemptions")
    .option('--request-id <requestId>', 'request id (number)')
    .action(async (cmdOptions: { requestId?: string }) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        if (cmdOptions.requestId !== undefined) {
            await redeemerBot.listRedemption(cmdOptions.requestId);
        } else {
            await redeemerBot.listRedemptions();
        }
    });

program
    .command("updateRedemptions")
    .description("Update all open redemptions")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        await redeemerBot.updateAllRedemptions();
    });

program
    .command("balances")
    .alias("balance")
    .description("Print user balances for relevant tokens")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const bot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        await bot.infoBot().printBalances(bot.nativeAddress, bot.underlyingAddress);
    });

program
    .command("pools")
    .description("Print the list of pools of public agents")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        await bot.printPools();
    });

program
    .command("poolHoldings")
    .description("Print the amount of tokens the user owns per pool")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const bot = await InfoBotCommands.create(secrets, options.config, options.fasset, registerToplevelFinalizer);
        const address = secrets.required("user.native.address");
        await bot.printPoolTokenBalance(address);
    });

program
    .command("enterPool")
    .description("Enter a collateral pool with specified amount of collateral")
    .argument("<poolAddressOrTokenSymbol>", "the pool the user wants to enter; can be identified by the token symbol or by the pool address")
    .argument("<collateralAmount>", "amount of collateral (FLR or SGB) to add to the pool")
    .action(async (poolAddressOrTokenSymbol: string, collateralAmount: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        validateDecimal(collateralAmount, "Collateral amount", { min: 1 }); // required at least 1 FLR to enter
        const bot = await PoolUserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const collateralAmountWei = toBNExp(collateralAmount, 18);
        const entered = await bot.enterPool(poolAddress, collateralAmountWei);
        const tokensStr = formatFixed(toBN(entered.receivedTokensWei), 18);
        console.log(`Received ${tokensStr} collateral pool tokens`);
    });

program
    .command("exitPool")
    .description("Exit a collateral pool for specified amount or all pool tokens")
    .argument("<poolAddressOrTokenSymbol>", "the pool the user wants to exit; can be identified by the token symbol or by the pool address")
    .argument("<tokenAmount>", 'the amount of collateral pool tokens to burn, can be a number or "all"')
    .action(async (poolAddressOrTokenSymbol: string, tokenAmountOrAll: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await PoolUserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const balance = await bot.infoBot().getPoolTokenBalance(poolAddress, bot.nativeAddress);
        let tokenAmountWei: BN;
        if (tokenAmountOrAll === "all") {
            tokenAmountWei = balance;
            validate(tokenAmountWei.gtn(0), "Collateral pool token balance is zero.");
        } else {
            validateDecimal(tokenAmountOrAll, "Token amount", { strictMin: 0 });
            tokenAmountWei = toBNExp(tokenAmountOrAll, 18);
            validate(tokenAmountWei.lte(balance), `Token amount must not exceed user's balance of pool tokens, which is ${formatFixed(balance, 18)}.`);
        }
        try {
            const exited = await bot.exitPool(poolAddress, tokenAmountWei);
            const burned = formatFixed(exited.burnedTokensWei, 18);
            const collateral = formatFixed(exited.receivedNatWei, 18);
            console.log(`Burned ${burned} pool tokens.`);
            console.log(`Received ${collateral} CFLR collateral.`);
        } catch (error) {
            translateError(error, {
                "TokenShareIsZero": "Token amount must be greater than 0",
                "TokenBalanceTooLow": `Token amount must not exceed user's balance of pool tokens, which is ${formatFixed(balance, 18)}.`,
                "CollateralRatioFallsBelowExitCR": `Cannot exit pool at this time, since it would reduce the collateral ratio to dangerously low level; try with lower token amount.`,
                "CollateralAfterExitTooLow": `Should not exit with nearly all tokens - use "all" for token amount.`,
                "InsufficientNontimelockedBalance": "You cannot exit pool immediately after entering, please wait a minute.",
            });
        }
    });

program
    .command("withdrawPoolFees")
    .description("Withdraw pool fees")
    .argument("<poolAddressOrTokenSymbol>", "the pool the user wants to withdraw the fees; can be identified by the token symbol or by the pool address")
    .action(async (poolAddressOrTokenSymbol: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await PoolUserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        try {
            const poolFeeBalance = await bot.poolFeesBalance(poolAddress);
            if (poolFeeBalance.gt(BN_ZERO)) {
                const res = await bot.withdrawPoolFees(poolAddress, poolFeeBalance);
                const br = await TokenBalances.fasset(bot.context);
                console.log(`User ${bot.nativeAddress} withdrew pool fees ${br.format(res.withdrawnFeesUBA)}.`);
            }
        } catch (error) {
            console.error(`Error while withdrawing pool fees for user ${bot.nativeAddress}: ${error}`);
            logger.error(`User ${bot.nativeAddress} ran into error while withdrawing pool fees:`, error);
        }
    });

program
    .command("redeemFromCoreVault")
    .description("Triggers redemption")
    .argument("<numberOfLots>")
    .action(async (numberOfLots: string) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        try {
            await redeemerBot.redeemFromCoreVault(numberOfLots);
        } catch (error) {
            translateError(error, {
                "FAssetBalanceTooLow": `User account does not hold ${numberOfLots} lots of ${options.fasset}.`
            });
        }
    });

program
    .command("confirmTransferToCoreVault")
    .description("Confirm payment to core vault (e.g. to increase balance for fees)")
    .argument("<transactionHash>")
    .action(async (transactionHash: string) => {
        const options: { config: string; secrets: string; fasset: string; dir: string } = program.opts();
        const bot = await UserBotCommands.create(options.secrets, options.config, options.fasset, options.dir, registerToplevelFinalizer);
        try {
            await bot.confirmTransferToCoreVault(transactionHash);
        } catch (error) {
            translateError(error, {
                "transaction not found": "Transaction does not exist or has not been finalized yet."
            });
        }
    });

async function getPoolAddress(bot: PoolUserBotCommands, poolAddressOrTokenSymbol: string) {
    return Web3.utils.isAddress(poolAddressOrTokenSymbol)
        ? poolAddressOrTokenSymbol
        : await bot.infoBot().findPoolBySymbol(poolAddressOrTokenSymbol);
}

toplevelRun(async () => {
    try {
        await program.parseAsync();
    } catch (error) {
        translateError(error, {
            "InvalidAgentVaultAddress": "Agent vault with given address does not exist.",
            "insufficient funds for gas * price + value": "User account does not heave enough CFLR.",
        });
    }
});
