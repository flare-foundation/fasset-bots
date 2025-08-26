import { DEFAULT_RATE_LIMIT_OPTIONS } from "@flarenetwork/fasset-bots-common";
import { expect } from "chai";
import { DOGE } from "../../src";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";

describe("Dogecoin network helper tests", () => {

   it("Should create config with predefined 'stuckTransactionConstants'", async () => {
      const DOGEMccConnectionTestInitial = {
         urls: [process.env.DOGE_URL ?? ""],
         username: "",
         password: "",
         inTestnet: true, stuckTransactionOptions: { blockOffset: 10, retries: 5, feeIncrease: 4 },

      };
      const testOrm = await initializeTestMikroORM();
      const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
      const DOGEMccConnectionTest = { ...DOGEMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
      const wClient = DOGE.initialize({... DOGEMccConnectionTest});
      expect(wClient.blockchainAPI.clients[0].defaults.timeout).to.eq(DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs);
   });
});
