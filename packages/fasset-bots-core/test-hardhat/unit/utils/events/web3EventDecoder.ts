import { expect } from "chai";
import { AbiItem } from "web3-utils";
import { Web3ContractEventDecoder } from "../../../../src/utils/events/Web3ContractEventDecoder";
import { web3 } from "../../../../src/utils/web3";
import { testChainInfo } from "../../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../../test-utils/create-test-asset-context";

describe("Web3 event decoder unit tests", () => {
    let context: TestAssetBotContext;
    let accounts: string[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should filter out one event", async () => {
        const eventDecoder = new Web3ContractEventDecoder(
            { assetManager: context.assetManager, priceChangeEmitter: context.priceChangeEmitter },
            { filter: ["PricesPublished"], requireKnownAddress: true }
        );
        expect(eventDecoder.eventTypes.size).to.eq(1);
    });

    it("Should handle anonymous event", async () => {
        const assetManagerAddress = context.assetManager.address;
        const rawEvent = {
            removed: false,
            logIndex: 0,
            transactionIndex: 0,
            transactionHash: "0xe32e0177e970e4734dc2c0b8a77a32c2334579501eb2750e8e0b2a8d795e4407",
            blockHash: "0xb6920b300aeeb2b32a2729636423fc8e23e7278f2bd318ef13d249661e16a8bd",
            blockNumber: 21457354,
            address: assetManagerAddress,
            data: "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000008f1b34207d97b1c5ac2b65a72ca1afc11417ad1b",
            topics: ["0x000000000000000000000000edc84bc0a3f609388d0f68dbf752aa6c1afb5ebf"],
            id: "log_4059b9da",
        };
        const eventDecoder = new Web3ContractEventDecoder({ assetManager: context.assetManager, agentOwnerRegistry: context.agentOwnerRegistry }, { requireKnownAddress: true });
        // set event as anonymous and do some id changes to satisy requirements
        // must make a copy, otherwise later tests break
        const evtType = JSON.parse(JSON.stringify(eventDecoder.eventTypes.get("0x174ce844d7e28d695e043ecb1f4f404b2b32b9d554236756bbbf09c730cfaf20"))) as AbiItem;
        evtType.anonymous = true;
        evtType.name = undefined;
        eventDecoder.eventTypes.set("0x000000000000000000000000edc84bc0a3f609388d0f68dbf752aa6c1afb5ebf", evtType);
        // decode event
        const decode = eventDecoder.decodeEvent(rawEvent);
        expect(decode?.event).eq("<unknown>");
        // change address
        const otherAddress = context.addressUpdater.address;
        rawEvent.address = otherAddress;
        const decode2 = eventDecoder.decodeEvent(rawEvent);
        expect(decode2).to.be.null;
    });
});
