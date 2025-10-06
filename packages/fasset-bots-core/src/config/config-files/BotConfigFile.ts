import { AgentSettingsConfig } from "./AgentSettingsConfig";
import type { LiquidatorBotStrategyDefinition, ChallengerBotStrategyDefinition } from "./BotStrategyConfig";

export type DatabaseType = "mysql" | "sqlite" | "postgresql";

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export enum NotificationLevel {
    INFO = "info",
    DANGER = "danger",
    CRITICAL = "critical"
}

export interface ApiNotifierConfig {
    apiUrl: string;
    apiKey?: string;
    level?: NotificationLevel;
}

export interface OrmConfigOptions {
    type: DatabaseType;
    schemaUpdate?: SchemaUpdate;
    debug?: boolean;
    // connection building - either clientUrl or some combination of others
    clientUrl?: string;
    dbName?: string;
    host?: string;
    port?: number;
    charset?: string;
    pool?: {
        min?: number;
        max?: number;
        acquireTimeoutMillis?: number;
    }
    // allow other options
    [key: string]: any;
}

interface StuckTransaction {
    blockOffset?: number; // How many block to wait for transaction to be validated
    retries?: number; // How many times should transaction retry to successfully submit
    feeIncrease?: number; // Factor to increase fee in resubmitting process
    executionBlockOffset?: number; //
    enoughConfirmations?: number; // number of confirmations to be declared successful
    desiredChangeValue?: number; // value that change output should be (as close as possible) in main units (DOGE, BTC)
}

export interface BotFAssetInfo {
    chainId: string;
    tokenName: string;       // underlying token name
    tokenSymbol: string;     // underlying token symbol
    tokenDecimals: number;   // decimals for both underlying token and fasset
    walletUrls?: string[]; // for agent bot and user
    indexerUrls?: string[]; // for agent bot, user, challenger and timeKeeper
    priceChangeEmitter: string; // the name of the contract (in Contracts file) that emits price change event
    minimumAccountBalance?: string; // only needed for XRP
    faucet?: string;
    stuckTransactionOptions?: StuckTransaction;
    useOwnerUnderlyingAddressForPayingFees?: boolean
}

export interface BotNativeChainInfo {
    chainName: string;
    tokenSymbol: string;
    finalizationBlocks: number;
    // maximum number of blocks in getPastLogs() call
    readLogsChunkSize: number;
    recommendedOwnerBalance?: string;
    faucet?: string;
}


export interface PricePublisherConfig {
    enabled: boolean;
    loopDelayMs?: number;
}

export interface BotConfigFile {
    ormOptions?: OrmConfigOptions; // only for agent bot
    fAssets: { [fAssetSymbol: string]: BotFAssetInfo };
    // notifierFile: string;
    loopDelay: number;
    nativeChainInfo: BotNativeChainInfo;
    agentBotSettings: AgentBotSettingsJson;
    rpcUrl: string;
    dataAccessLayerUrls?: string[]; // only for agent bot, challenger and timeKeeper
    prioritizeAddressUpdater: boolean;
    // at least one must be set
    assetManagerController?: string;
    contractsJsonFile?: string;
    // notifier apis
    apiNotifierConfigs?: ApiNotifierConfig[]
    // price publisher settings
    pricePublisherConfig?: PricePublisherConfig;
    // liquidation strategies for liquidator and challenger
    liquidationStrategy?: LiquidatorBotStrategyDefinition; // only for liquidator
    challengeStrategy?: ChallengerBotStrategyDefinition; // only for challenge
}

export type AgentSettingsConfigDefaults = Omit<AgentSettingsConfig, "poolTokenSuffix" | "vaultCollateralFtsoSymbol">;

export interface AgentBotFassetSettingsJson {
    /**
     * The amount of underlying currency on owner's underlying address, below which an alert is triggered.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    recommendedOwnerBalance: string;

    /**
     * The amount of underlying currency on owner's underlying address, below which the address should be topped-up,
     * to prevent negative free underlying balance after redemptions.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    minimumFreeUnderlyingBalance: string;

    /**
     * Settings that are prefilled in new agent creation settings file/form (per-FAsset overrides).
     */
    defaultAgentSettings?: Partial<AgentSettingsConfigDefaults>;

    /**
     * A multiplier used to adjust the suggested minimum fee per KB for UTXO redemption payments, preventing transactions from getting pinned.
     * If set to 0, the suggested minimum fee won't be calculated.
     * Default: 2 for UTXO chains (e.g., BTC, DOGE), 0 for XRP (as it is not relevant for XRP).
     * Note: Before changing values, it is advised to perform calculations to balance pinning prevention with the max transaction fee allocated by the smart contract.
     */
    feeSafetyFactorPerKB: number;

    /**
     * Ratio of minted lots to (minted + free lots) that triggers a transfer to CV.
     */
    transferToCVRatio: number;

    /**
     * Ratio of minted lots to (minted + free lots) that triggers a return from CV.
     */
    returnFromCVRatio: number;

    /**
     * Target ratio of minted lots to (minted + free lots) after CV transfer.
     */
    targetTransferToCVRatio: number;

    /**
     * Target ratio of minted lots to (minted + free lots) after CV return.
     */
    targetReturnFromCVRatio: number;

    /**
     * Minimum transfer to CV amount (as share of the total minting capacity).
     */
    minimumTransferToCVSize: number;

    /**
     * If true, the bot will automatically manage CoreVault transfers and returns
     * based on `targetTransferToCVRatio` and `targetReturnFromCVRatio`.
     * Otherwise, the automation will be turned off.
     */
    useAutomaticCoreVaultTransferAndReturn: boolean;
}

export interface AgentBotSettingsJson {
    /**
     * If true, mintings and various redemption steps will run in parallel.
     * WARNING: should not be used with sqlite database.
     */
    parallel: boolean;

    /**
     * Minimum amount of collateral to topup vault to, to prevent liquidation.
     * Relative to min CR.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    liquidationPreventionFactor: string;

    /**
     * The threshold for USDC/WETH/... on owner's work address, below which alert is triggered.
     * Relative to required vault collateral for current minted amount.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    vaultCollateralReserveFactor: string;

    /**
     * The threshold for NAT on owner's work address, below which alert is triggered.
     * Relative to required pool collateral for current minted amount.
     * @pattern ^[0-9]+(\.[0-9]+)?$
     */
    poolCollateralReserveFactor: string;

    /**
     * Minimum balance needed for gas on request submitter and timekeeper account.
     */
    minBalanceOnServiceAccount: string;

    /**
     * Minimum balance needed for gas and other things on agent work account.
     * Pool collateral topups always leav this amount.
     */
    minBalanceOnWorkAccount: string;

    /**
     * The list of address to whose pings the agent will respond.
     */
    trustedPingSenders: string[];

    /**
     * Settings that are prefilled in new agent creation settings file/form.
     */
    defaultAgentSettings: AgentSettingsConfigDefaults;

    /**
     * Per FAsset settings.
     */
    fAssets: { [fAssetSymbol: string]: AgentBotFassetSettingsJson };
}

export type AgentBotSettingsJsonOverride =
    Partial<Omit<AgentBotSettingsJson, "fAssets">> & {
        fAssets?: { [fAssetSymbol: string]: Partial<AgentBotFassetSettingsJson> };
    };

export type BotConfigFileOverride =
    Partial<Omit<BotConfigFile, "fAssets" | "nativeChainInfo">> & {
        extends: string;
        fAssets?: { [fAssetSymbol: string]: Partial<BotFAssetInfo> };
        nativeChainInfo?: Partial<BotNativeChainInfo>;
        agentBotSettings?: AgentBotSettingsJsonOverride;
    };

export type Schema_BotConfigFile = BotConfigFile & { $schema?: string };
export type Schema_BotConfigFileOverride = BotConfigFileOverride & { $schema?: string };
