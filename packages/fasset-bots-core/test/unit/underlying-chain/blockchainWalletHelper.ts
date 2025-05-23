import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Secrets } from "../../../src/config";
import { createBlockchainWalletHelper } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { BlockchainWalletHelper } from "../../../src/underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../../../src/underlying-chain/ChainId";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { createTestOrm } from "../../test-utils/create-test-orm";
import { TEST_SECRETS } from "../../test-utils/test-bot-config";
import { removeWalletAddressFromDB } from "../../test-utils/test-helpers";
import { TransactionStatus } from "@flarenetwork/simple-wallet";
import { sleep } from "../../../src/utils";
use(chaiAsPromised);

let orm: ORM;
let dbWallet: DBWalletKeys;
let walletHelper: BlockchainWalletHelper;

export const fundedAddressXRP = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
export const fundedPrivateKeyXRP = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
export const targetAddressXRP = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
export const targetPrivateKeyXRP = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

describe("testXRP wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testXRP;
    const walletUrls: string[] = ["https://s.altnet.rippletest.net:51234"];
    const amountToSendDrops = 1000000;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = await createBlockchainWalletHelper(secrets, chainId, orm.em, walletUrls);
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKeyXRP);
        const account1 = await walletHelper.addExistingAccount(targetAddressXRP, targetPrivateKeyXRP);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKeyXRP);
        await removeWalletAddressFromDB(walletHelper, fundedAddressXRP);
        await removeWalletAddressFromDB(walletHelper, targetAddressXRP);
    });

    it("Should delete account", async () => {
        const newAccount = await walletHelper.createAccount();
        const del = await walletHelper.deleteAccount(newAccount, fundedAddressXRP, null);
        expect(del).to.be.greaterThan(0);
        const info = await walletHelper.checkTransactionStatus(del);
        expect(info.status).to.eq(TransactionStatus.TX_CREATED);
        await removeWalletAddressFromDB(walletHelper, newAccount);
    });

    it("Should not add multi transaction - method not implemented", async () => {
        await expect(walletHelper.addMultiTransaction()).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should not add transaction - source address not found in db", async () => {
        await expect(walletHelper.addTransaction(targetAddressXRP, fundedAddressXRP, amountToSendDrops, null, undefined))
            .to.eventually.be.rejectedWith(`Cannot find address ${targetAddressXRP}`)
            .and.be.an.instanceOf(Error);
    });

    it("Should get transaction fee", async () => {
        const fee = await walletHelper.getTransactionFee({isPayment: true});
        expect(fee.gtn(0));
    });

    it("Should send transaction", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddressXRP, fundedPrivateKeyXRP);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKeyXRP);
        const newAccount = await walletHelper.createAccount();

        const transaction = await walletHelper.addTransactionAndWaitForItsFinalization(account0, newAccount, 10_000000, null);
        expect(transaction).to.be.a('string');
        await removeWalletAddressFromDB(walletHelper, newAccount);
        await removeWalletAddressFromDB(walletHelper, account0);
    });

    it("Should be monitoring", async () => {
        const monitor = await walletHelper.createMonitor();
        await monitor.startMonitoring();
        await sleep(2000);
        expect(monitor.isMonitoring()).to.be.true;
        await monitor.stopMonitoring();
        expect(monitor.isMonitoring()).to.be.false;

        expect(walletHelper.requestStopVal).to.be.false;
        await walletHelper.requestStop();
        expect(walletHelper.requestStopVal).to.be.true;
    });
});

describe("testBTC wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testBTC;
    const walletUrls: string[] = ["https://api.bitcore.io/api/BTC/testnet/"];
    const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
    const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
    const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
    const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = await createBlockchainWalletHelper(secrets, chainId, orm.em, walletUrls, undefined);
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKey);
        const account1 = await walletHelper.addExistingAccount(targetAddress, targetPrivateKey);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKey);
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
        await removeWalletAddressFromDB(walletHelper, targetAddress);
    });
});

describe("testDOGE wallet tests", () => {
    let secrets: Secrets;
    const chainId: ChainId = ChainId.testDOGE;
    const walletUrls: string[] = ["https://api.bitcore.io/api/DOGE/testnet/"];
    const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
    const fundedPrivateKey = "cfHf9MCiZbPidE1XXxCCBnzwJSKRtvpfoZrY6wFvy17HmKbBqt1j";
    const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
    const targetPrivateKey = "ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9";
    const amountToSendSatoshies = 100000000;

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        orm = await createTestOrm();
        dbWallet = DBWalletKeys.from(orm.em, secrets);
        walletHelper = await createBlockchainWalletHelper(secrets, chainId, orm.em, walletUrls);
    });

    it("Should create account", async () => {
        const account = await walletHelper.createAccount();
        const privateKey = await dbWallet.getKey(account);
        expect(privateKey).to.not.be.null;
    });

    it("Should add account", async () => {
        const account0 = await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const privateKey0 = await dbWallet.getKey(account0);
        expect(privateKey0).to.eq(fundedPrivateKey);
        const account1 = await walletHelper.addExistingAccount(targetAddress, targetPrivateKey);
        const privateKey1 = await dbWallet.getKey(account1);
        expect(privateKey1).to.eq(targetPrivateKey);
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
        await removeWalletAddressFromDB(walletHelper, targetAddress);
    });

    it("Should send funds", async () => {
        await walletHelper.addExistingAccount(fundedAddress, fundedPrivateKey);
        const txDbId = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendSatoshies, "TestNote", undefined);
        expect(txDbId).to.not.be.null;
        expect(txDbId).to.be.gt(0);
        await removeWalletAddressFromDB(walletHelper, fundedAddress);
    });
});
