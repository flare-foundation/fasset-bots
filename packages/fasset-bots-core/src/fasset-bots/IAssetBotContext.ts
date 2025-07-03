import { AgentOwnerRegistryInstance, IIAssetManagerControllerInstance, CoreVaultManagerInstance, FAssetInstance, IIAssetManagerInstance, IPriceChangeEmitterInstance, IIAddressUpdaterInstance, IWNatInstance } from "../../typechain-truffle";
import { ChallengerBotStrategyDefinition, LiquidatorBotStrategyDefinition } from "../config";
import { ChainInfo } from "../fasset/ChainInfo";
import { NativeChainInfo } from "../fasset/ChainInfo";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { ContractWithEvents } from "../utils/events/truffle";

export type AddressUpdaterEvents = import("../../typechain-truffle/IIAddressUpdater").AllEvents;
export type WNatEvents = import("../../typechain-truffle/IWNat").AllEvents;
export type IIAssetManagerControllerEvents = import("../../typechain-truffle/IIAssetManagerController").AllEvents;
export type AssetManagerEvents = import("../../typechain-truffle/IIAssetManager").AllEvents;
export type FAssetEvents = import("../../typechain-truffle/FAsset").AllEvents;
export type IERC20Events = import("../../typechain-truffle/IERC20").AllEvents;
export type IPriceChangeEmitterEvents = import("../../typechain-truffle/IPriceChangeEmitter").AllEvents;
export type AgentOwnerRegistryEvents = import("../../typechain-truffle/AgentOwnerRegistry").AllEvents;
export type CoreVaultManagerEvents = import('../../typechain-truffle/CoreVaultManager').AllEvents;

export interface IAssetNativeChainContext {
    fAssetSymbol: string;
    nativeChainInfo: NativeChainInfo;
    priceChangeEmitter: ContractWithEvents<IPriceChangeEmitterInstance, IPriceChangeEmitterEvents>;
    wNat: ContractWithEvents<IWNatInstance, WNatEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<IIAssetManagerInstance, AssetManagerEvents>;
    assetManagerController: ContractWithEvents<IIAssetManagerControllerInstance, IIAssetManagerControllerEvents>;
    addressUpdater: ContractWithEvents<IIAddressUpdaterInstance, AddressUpdaterEvents>;
    agentOwnerRegistry: ContractWithEvents<AgentOwnerRegistryInstance, AgentOwnerRegistryEvents>;
    coreVaultManager: ContractWithEvents<CoreVaultManagerInstance, CoreVaultManagerEvents> | undefined;
}

export interface IAssetAgentContext extends IAssetNativeChainContext {
    chainInfo: ChainInfo;
    blockchainIndexer: BlockchainIndexerHelper;
    wallet: IBlockChainWallet;
    attestationProvider: AttestationHelper;
    verificationClient: IVerificationApiClient;
}

export interface ITimekeeperContext extends IAssetNativeChainContext {
    blockchainIndexer: BlockchainIndexerHelper;
    attestationProvider: AttestationHelper;
}

export interface ILiquidatorContext extends IAssetNativeChainContext {
    liquidationStrategy?: LiquidatorBotStrategyDefinition;
}

export interface IChallengerContext extends IAssetNativeChainContext {
    blockchainIndexer: BlockchainIndexerHelper;
    attestationProvider: AttestationHelper;
    challengeStrategy?: ChallengerBotStrategyDefinition;
}
