import "dotenv/config";
import "source-map-support/register";

import { decryptText, EncryptionMethod, encryptText, generateSecrets, generateUnderlyingAccount, isJSON, promptForPassword, SecretsUser } from "@flarenetwork/fasset-bots-core";
import { ENCRYPTION_PASSWORD_MIN_LENGTH, validateEncryptionPassword } from "@flarenetwork/fasset-bots-core/config";
import { assertCmd, CommandLineError, createSha256Hash, generateRandomHexString, logger, squashSpace, web3 } from "@flarenetwork/fasset-bots-core/utils";
import chalk from "chalk";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import { expandConfigPath } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateAddress } from "../utils/validation";

const program = new Command();

program.name("key-gen").description("Command line commands for generating keys and secrets file");

program
    .command("generateSecrets")
    .description("generate new secrets file")
    .option("-c, --config <configFile>", "Config file path. If omitted, env var FASSET_BOT_CONFIG or FASSET_USER_CONFIG is used. If this is undefined, use embedded config.")
    .option("-o, --output <outputFile>", "the output file; if omitted, the secrets are printed to stdout")
    .option("--overwrite", "if enabled, the output file can be overwritten; otherwise it is an error if it already exists")
    .option("--user", "generate secrets for user")
    .option("--agent <managementAddress>", "generate secrets for agent; required argument is agent owner's management (cold) address")
    .option("--other", "generate secrets for other bots (challenger, etc.)")
    .option("--merge <filename>", "merge into the result the contest of JSON file <filename>")
    .action(async (opts: { config?: string; output?: string; overwrite?: boolean; user?: boolean; agent?: string; other?: boolean, merge?: string }) => {
        const users: SecretsUser[] = [];
        if (opts.user) users.push("user");
        if (opts.agent) {
            validateAddress(opts.agent, "agent management address");
            users.push("agent");
        }
        if (opts.other) users.push("other");
        if (!opts.config) {
            opts.config = process.env.FASSET_BOT_CONFIG ?? process.env.FASSET_USER_CONFIG ?? "coston";
        }
        opts.config = expandConfigPath(opts.config, "bot");
        const secrets = generateSecrets(opts.config, users, opts.agent);
        if (opts.merge) {
            recursiveAssign(secrets, JSON.parse(fs.readFileSync(opts.merge).toString()));
        }
        const json = JSON.stringify(secrets, null, 4);
        if (opts.output) {
            if (fs.existsSync(opts.output) && !opts.overwrite) {
                program.error(`error: file ${opts.output} already exists`);
            }
            if (!fs.existsSync(path.dirname(opts.output))) {
                fs.mkdirSync(path.dirname(opts.output));
            }
            fs.writeFileSync(opts.output, json);
            if (process.platform !== "win32") {
                try {
                    fs.chmodSync(opts.output, 0o600);
                } catch (error) {
                    logger.error(`Error changing mode for file ${opts.output}`, error);
                    console.error(`${chalk.yellow("WARNING:")} You must set file permissions to 600 by executing "chmod 600 ${opts.output}"`);
                }
            } else if (process.env.ALLOW_SECRETS_ON_WINDOWS !== "true") {
                console.error(`${chalk.yellow("WARNING:")} You must set environment variable ALLOW_SECRETS_ON_WINDOWS=true to use secrets on windows`);
            }
        } else {
            console.log(json);
        }
        const emptyFields = Object.keys(secrets.apiKey).filter((k) => !secrets.apiKey[k]);
        if (emptyFields.length !== 0) {
            console.error(
                chalk.yellow("NOTE:"),
                `Replace empty fields in apiKey (${emptyFields.join(", ")}) with api keys from your provider or delete them if not needed.`
            );
        }
        if (secrets.owner) {
            const workAddress = secrets.owner.native.address;
            console.error(squashSpace`${chalk.yellow("NOTE:")} New agent's work address ${workAddress} has been created.
                To use it, first make sure your management address has been whitelisted, and then
                execute ${chalk.green(`AgentOwnerRegistry.setWorkAddress(${workAddress})`)} on block explorer.`);
            console.error(squashSpace`${chalk.yellow("WARNING:")} Be careful - there can be only one work address per management address,
                so make sure you don't overwrite it.`);
        }
    });

function recursiveAssign(dest: any, src: any) {
    assertCmd(typeof dest === "object" && dest != null, `Trying to assign to non-object ${dest}`);
    for (const [key, value] of Object.entries(src)) {
        if (typeof value === "object" && value != null) {
            if (!(key in dest)) {
                dest[key] = {};
            }
            recursiveAssign(dest[key], value);
        } else {
            dest[key] = value;
        }
    }
}

program
    .command("encryptSecrets")
    .description("encrypt content of secrets file")
    .option("-s, --secrets <secretsFile>", "Secrets file path. If omitted, env var FASSET_BOT_SECRETS or FASSET_USER_SECRETS is used.")
    .action(async (opts: { secretsPath?: string }) => {
        const secretsPath = opts.secretsPath ?? process.env.FASSET_BOT_SECRETS ?? process.env.FASSET_USER_SECRETS;
        if (!secretsPath) {
            throw new CommandLineError("Missing secrets file path.");
        }
        const secretsContent = fs.readFileSync(secretsPath).toString();
        if (isJSON(secretsContent)) {
            const secretsPassword = await promptForPassword(`Please enter the password (at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long) used to encrypt secrets file content: `);
            validateEncryptionPassword(secretsPassword, "password");
            const encryptedSecretsContent = encryptText(secretsPassword, secretsContent, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
            fs.writeFileSync(secretsPath, encryptedSecretsContent);
            console.log("Secrets file was encrypted.")
        } else {
            console.log("File is not in valid JSON format.");
        }
    });

program
    .command("decryptSecrets")
    .description("decrypt content of secrets file")
    .option("-s, --secrets <secretsFile>", "Secrets file path. If omitted, env var FASSET_BOT_SECRETS or FASSET_USER_SECRETS is used.")
    .action(async (opts: { secretsPath?: string }) => {
        const secretsPath = opts.secretsPath ?? process.env.FASSET_BOT_SECRETS ?? process.env.FASSET_USER_SECRETS;
        if (!secretsPath) {
            throw new CommandLineError("Missing secrets file path.");
        }
        const encryptedSecretsContent = fs.readFileSync(secretsPath).toString();
        if (isJSON(encryptedSecretsContent)) {
            console.log("File is already in JSON format.");
        } else {
            const secretsPassword = await promptForPassword("Please enter the password used to decrypt secrets file content: ");
            const decryptedSecretsContent = decryptText(secretsPassword, encryptedSecretsContent);
            const jsonToSave = JSON.stringify(JSON.parse(decryptedSecretsContent), null, 4);
            fs.writeFileSync(secretsPath, jsonToSave);
            console.log("Secrets file was decrypted.")
        }
    });

program
    .command("createApiKeyAndHash")
    .description("create api key and its hash")
    .action(async () => {
        const apiKey = generateRandomHexString(32);
        const hash = createSha256Hash(apiKey);
        console.log(apiKey, hash);
    });

program
    .command("createWalletEncryptionPassword")
    .description("create wallet encryption password")
    .action(async () => {
        const password = generateRandomHexString(32);
        console.log(password);
    });

program
    .command("createAccount")
    .description("create new address/private key pair on the underlying chain")
    .argument("<chainName>", "chain name, e.g. XRP or testXRP")
    .action(async (chainName: string) => {
        const account = generateUnderlyingAccount(chainName);
        console.log(JSON.stringify({ address: account.address, private_key: account.privateKey }, null, 4));
    });

program
    .command("createNativeAccount")
    .description("create new address/private key pair on the native chain")
    .action(async () => {
        const account = web3.eth.accounts.create();
        console.log(JSON.stringify({ address: account.address, private_key: account.privateKey }, null, 4));
    });

toplevelRun(async () => {
    await program.parseAsync();
});
