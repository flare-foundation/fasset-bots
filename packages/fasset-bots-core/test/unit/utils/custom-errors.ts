import { assert } from "chai";
import { Secrets } from "../../../src/config";
import { artifacts, initWeb3 } from "../../../src/utils";
import { TransactionRevertedError } from "../../../src/utils/mini-truffle-contracts/custom-errors";
import { COSTON_RPC, TEST_SECRETS } from "../../../test/test-utils/test-bot-config";
import { CustomErrorMockInstance } from "../../../typechain-truffle";

const CustomErrorMock = artifacts.require("CustomErrorMock");

describe("Custom errors on Coston", () => {
    let accounts: string[];
    let customErrorMock: CustomErrorMockInstance;

    before(async () => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const accountPrivateKey = secrets.required("user.native.private_key");
        accounts = await initWeb3(COSTON_RPC, [accountPrivateKey], null);
        customErrorMock = await CustomErrorMock.at("0x07d4D0D336508fc4A7978D54e073Fc5f3A5676D3");
    });

    it("emit error without args", async () => {
        try {
            await customErrorMock.emitErrorWithoutArgs({ from: accounts[0] });
        } catch (error) {
            assert(error instanceof TransactionRevertedError, "not a revert");
            assert.include(error.message, `ErrorWithoutArgs()`);
            assert.equal(error.revertData.name, "ErrorWithoutArgs");
            assert.equal(error.revertData.args.__length__, 0);
            assert.equal(error.formattedRevertData(), `ErrorWithoutArgs()`);
        }
    });

    it("emit error with args", async () => {
        try {
            await customErrorMock.emitErrorWithArgs(12, "say hello", { from: accounts[0] });
        } catch (error) {
            assert(error instanceof TransactionRevertedError, "not a revert");
            assert.include(error.message, `ErrorWithArgs(12, "say hello")`);
            assert.equal(error.revertData.name, "ErrorWithArgs");
            assert.equal(error.revertData.args.__length__, 2);
            assert.equal(error.revertData.args.value, "12");
            assert.equal(error.revertData.args.text, "say hello");
            assert.equal(error.formattedRevertData(), `ErrorWithArgs(12, "say hello")`);
        }
    });

    it("emit error with string message", async () => {
        try {
            await customErrorMock.emitErrorWithString({ from: accounts[0] });
        } catch (error) {
            assert(error instanceof TransactionRevertedError, "not a revert");
            assert.include(error.message, `string type error`);
            assert.equal(error.revertData.name, "Error");
            assert.equal(error.revertData.args.__length__, 1);
            assert.equal(error.revertData.args.message, "string type error");
            assert.equal(error.formattedRevertData(), `Error("string type error")`);
        }
    });

    it("emit error with args - fixed gas", async () => {
        try {
            await customErrorMock.emitErrorWithArgs(12, "say hello", { from: accounts[0], gas: 1000000 });
        } catch (error) {
            assert(error instanceof TransactionRevertedError, "not a revert");
            assert.include(error.message, `ErrorWithArgs(12, "say hello")`);
            assert.equal(error.revertData.name, "ErrorWithArgs");
            assert.equal(error.revertData.args.__length__, 2);
            assert.equal(error.revertData.args.value, "12");
            assert.equal(error.revertData.args.text, "say hello");
            assert.equal(error.formattedRevertData(), `ErrorWithArgs(12, "say hello")`);
        }
    });
});
