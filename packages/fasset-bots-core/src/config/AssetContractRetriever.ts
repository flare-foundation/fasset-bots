import { AddressUpdaterInstance, FAssetInstance, IIAssetManagerControllerInstance, IIAssetManagerInstance, Truffle } from "../../typechain-truffle";
import { CommandLineError, requireNotNullCmd } from "../utils/command-line-errors";
import { ZERO_ADDRESS } from "../utils/helpers";
import { artifacts } from "../utils/web3";
import { ChainContracts, loadContracts } from "./contracts";

const IIAssetManager = artifacts.require("IIAssetManager");
const IIAssetManagerController = artifacts.require("IIAssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const FAsset = artifacts.require("FAsset");

export class ContractRetriever {
    constructor(
        public prioritizeAddressUpdater: boolean,
        public addressUpdater: AddressUpdaterInstance,
        public contracts?: ChainContracts,
    ) {}

    async getContractAddress(name: string, addressUpdaterName: string = name) {
        if (this.contracts == null || this.prioritizeAddressUpdater) {
            const address = await this.addressUpdater.getContractAddress(addressUpdaterName);
            if (address !== ZERO_ADDRESS) {
                return address;
            }
        }
        if (this.contracts != null) {
            const address = this.contracts[name]?.address;
            if (address) {
                return address;
            }
        }
        throw new Error(`Cannot find address for contract ${name}`);
    }

    async getContract<T>(factory: Truffle.Contract<T>, name: string = factory.contractName, addressUpdaterName: string = name) {
        const address = await this.getContractAddress(name, addressUpdaterName);
        return await factory.at(address);
    }
}

type FAssetPair = { assetManager: IIAssetManagerInstance; fasset: FAssetInstance };

export class AssetContractRetriever extends ContractRetriever {
    constructor(
        prioritizeAddressUpdater: boolean,
        addressUpdater: AddressUpdaterInstance,
        contracts: ChainContracts | undefined,
        public assetManagerController: IIAssetManagerControllerInstance,
        public assetManagers: Map<string, FAssetPair>,
    ) {
        super(prioritizeAddressUpdater, addressUpdater, contracts);
    }

    static async create(prioritizeAddressUpdater: boolean, contractsJsonFile?: string, assetManagerControllerAddress?: string) {
        const contracts = contractsJsonFile ? loadContracts(contractsJsonFile) : undefined;
        let assetManagerController: IIAssetManagerControllerInstance;
        let addressUpdater: AddressUpdaterInstance;
        if (assetManagerControllerAddress) {
            assetManagerController = await IIAssetManagerController.at(assetManagerControllerAddress);
            addressUpdater = await AddressUpdater.at(await assetManagerController.getAddressUpdater());
        } else if (contracts != null) {
            addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
            const contractRetriever = new ContractRetriever(prioritizeAddressUpdater, addressUpdater, contracts);
            assetManagerController = await contractRetriever.getContract(IIAssetManagerController, "AssetManagerController");
        } else {
            throw new CommandLineError("At least one of contractsJsonFile or assetManagerController must be defined");
        }
        const assetManagers = await AssetContractRetriever.createAssetManagerMap(assetManagerController);
        return new AssetContractRetriever(prioritizeAddressUpdater, addressUpdater, contracts, assetManagerController, assetManagers);
    }

    getAssetManager(symbol: string) {
        return requireNotNullCmd(this.assetManagers.get(symbol)?.assetManager, `No asset manager for FAsset with symbol ${symbol}`);
    }

    getFAsset(symbol: string) {
        return requireNotNullCmd(this.assetManagers.get(symbol)?.fasset, `No asset manager for FAsset with symbol ${symbol}`);
    }

    static async createAssetManagerMap(assetManagerController: IIAssetManagerControllerInstance) {
        const map = new Map<string, FAssetPair>();
        for (const assetManagerAddress of await assetManagerController.getAssetManagers()) {
            const assetManager = await IIAssetManager.at(assetManagerAddress);
            const fasset = await FAsset.at(await assetManager.fAsset());
            const symbol = await fasset.symbol();
            map.set(symbol, { assetManager, fasset });
        }
        return map;
    }
}
