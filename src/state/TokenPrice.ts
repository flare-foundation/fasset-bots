import { IERC20Contract, IERC20Instance, IFtsoContract, IFtsoInstance, IFtsoRegistryContract, IFtsoRegistryInstance } from "../../typechain-truffle";
import { AMGSettings, amgToTokenWeiPrice } from "../fasset/Conversions";
import { IERC20Events } from "../fasset/IAssetContext";
import { artifacts } from "../utils/artifacts";
import { ContractWithEvents } from "../utils/events/truffle";
import { BN_ZERO, BNish, exp10, getOrCreateAsync, minBN, requireNotNull, toBN } from "../utils/helpers";

const IFtso = artifacts.require("IFtso");
const IFtsoRegistry = artifacts.require("IFtsoRegistry");
const IERC20 = artifacts.require('IERC20');

export async function tokenContract(tokenAddress: string) {
    return await IERC20.at(tokenAddress) as ContractWithEvents<IERC20Instance, IERC20Events>;
}

export async function tokenBalance(tokenAddress: string, owner: string) {
    const token = await IERC20.at(tokenAddress);
    return await token.balanceOf(owner);
}

export class TokenPrice {
    constructor(
        public readonly price: BN,
        public readonly timestamp: BN,
        public readonly decimals: BN
    ) {
    }

    fresh(relativeTo: TokenPrice, maxAge: BN) {
        return this.timestamp.add(maxAge).gte(relativeTo.timestamp);
    }

    toNumber() {
        return Number(this.price) * (10 ** -Number(this.decimals));
    }

    toFixed(displayDecimals: number = 3) {
        return this.toNumber().toFixed(displayDecimals);
    }

    toString() {
        return this.toNumber().toFixed(3);
    }

    amgToTokenWei(settings: AMGSettings, tokenDecimals: BNish, assetUSD: TokenPrice) {
        return amgToTokenWeiPrice(settings, tokenDecimals, this.price, this.decimals, assetUSD.price, assetUSD.decimals);
    }

    static fromFraction(multiplier: BN, divisor: BN, timestamp: BN, decimals: BNish) {
        decimals = toBN(decimals);
        const price = multiplier.isZero() ? BN_ZERO : multiplier.mul(exp10(decimals)).div(divisor);
        return new TokenPrice(price, timestamp, decimals);
    }

    priceInToken(tokenPrice: TokenPrice, decimals: BNish) {
        decimals = toBN(decimals);
        const multiplier = exp10(decimals.add(tokenPrice.decimals).sub(this.decimals));
        const price = this.price.mul(multiplier).div(tokenPrice.price);
        const timestamp = minBN(this.timestamp, tokenPrice.timestamp);
        return new TokenPrice(price, timestamp, decimals);
    }
}

export class TokenPriceReader {
    ftsoCache: Map<string, IFtsoInstance> = new Map();
    priceCache: Map<string, TokenPrice> = new Map();

    constructor(
        public ftsoRegistry: IFtsoRegistryInstance
    ) { }

    static async create(settings: { ftsoRegistry: string }) {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        return new TokenPriceReader(ftsoRegistry);
    }

    getFtso(symbol: string) {
        return getOrCreateAsync(this.ftsoCache, symbol, async () => {
            const ftsoAddress = await this.ftsoRegistry.getFtsoBySymbol(symbol);
            return await IFtso.at(ftsoAddress);
        });
    }

    getRawPrice(symbol: string, trusted: boolean) {
        return getOrCreateAsync(this.priceCache, `${symbol}::trusted=${trusted}`, async () => {
            const ftso = await this.getFtso(symbol);
            const { 0: price, 1: timestamp, 2: decimals } =
                trusted ? await ftso.getCurrentPriceWithDecimals() : await ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
            return new TokenPrice(toBN(price), toBN(timestamp), toBN(decimals));
        });
    }

    async getPrice(symbol: string, trusted?: false): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean, trustedMaxAge: BNish): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean = false, trustedMaxAge?: BNish) {
        const ftsoPrice = await this.getRawPrice(symbol, false);
        if (trusted) {
            const trustedPrice = await this.getRawPrice(symbol, true);
            return trustedPrice.fresh(ftsoPrice, toBN(requireNotNull(trustedMaxAge))) ? trustedPrice : ftsoPrice;
        } else {
            return ftsoPrice;
        }
    }
}

