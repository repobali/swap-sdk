import { formatNumeric } from "./format";
import { BigIntConstants } from "./constants";
import { bigintPow } from "./utils";
import { Client } from "./client";

export function uniqArray<T>(array: Array<T>): Array<T> {
    return Array.from(new Set(array));
}

export function uniqArrayOn<T, K>(array: Array<T>, on: (t: T) => K): Array<T> {
    const map = new Map(array.map(t => [on(t), t] as [K, T]));
    return Array.from(map.values());
}

export type SwapType = "v2" | "stable";
export type FeeDirection = "X" | "Y";
export type NetworkType = "sui" | "aptos";
export type AddressType = string;
export type PoolDirectionType = "forward" | "reverse";
export type TxHashType = string;

export class DemicalFormat {
    value: bigint;
    demical: number;

    constructor(value: bigint, demical: number) {
        this.value = value;
        this.demical = (demical < 0) ? 0 : demical;
    }

    toString: (fixed?: boolean) => string = (fixed?: boolean) => {
        if (this.demical <= 0) { 
            return formatNumeric(this.value.toString()); 
        }
        let vs = Array(this.demical).fill("0").join("") +  this.value.toString();
        // Add "."
        vs = vs.slice(0, -this.demical) + "." + vs.slice(-this.demical);
        vs = formatNumeric(vs);

        const fixed_ = fixed ?? false;
        if (fixed_ && this.demical > 0) {
            if (vs.indexOf(".") === -1) {
                vs += ".";
            }
            const currentDemical = (vs.length - 1 - vs.indexOf("."));
            let appendDemical = this.demical - currentDemical;
            if (appendDemical < 0) { 
                appendDemical = 0;
            }
            vs += Array(appendDemical).fill("0").join("");
        }

        return vs;
    }

    toNumber = () => {
        return Number(this.value) / (10 ** this.demical);
    }

    static fromString: (s: string) => DemicalFormat | null = (s_: string) => {
        // Format numberic
        if (s_.match(/(^[0-9]+$)|(^[0-9]+\.[0-9]*$)/) === null) {
            return null;
        }
        let s = formatNumeric(s_);

        let demical = s.length - 1 - s.indexOf('.');
        // Demical not presented
        if (demical >= s.length) {
            demical = 0;
        }

        try {
            // Remove . and parse to BigInt
            const value = BigInt(s.replace('.', ''));
            return new DemicalFormat(value, demical);
        } catch {}

        return null;
    }

    canAlignTo = (r: DemicalFormat | number) => {
        const rDemical = (typeof r === "number") ? r : r.demical;
        return this.demical <= rDemical;
    }

    alignTo = (r: DemicalFormat | number): DemicalFormat => {
        const rDemical = (typeof r === "number") ? r : r.demical;
        const mul = bigintPow(BigInt(10), rDemical - this.demical);
        return new DemicalFormat(this.value * mul, rDemical)
    }
}

export interface CoinType {
    network: NetworkType;
    name: string;
}

export const getCoinTypeUuid = (c: CoinType) => {
    return `CoinType[${c.network}-${c.name}]`;
}

export const isSameCoinType = (a: CoinType, b: CoinType) => {
    return (a.network === b.network) && (a.name === b.name);
}

export interface CoinInfo {
    type: CoinType;
    addr: AddressType;
    balance: bigint;
}

export const isSameCoin = (a: CoinInfo, b: CoinInfo) => {
    // Note: For sui ecosystem, we only need to check address For aptos, since all the addr are equal for single account, we need to check the reset.
    return isSameCoinType(a.type, b.type) && (a.addr === b.addr) && (a.balance === b.balance);
}

export const getCoinInfoUuid = (c: CoinInfo) => {
    return `CoinInfo[${getCoinTypeUuid(c.type)}-${c.addr}]`
}

export interface LSPCoinType {
    xTokenType: CoinType;
    yTokenType: CoinType;
}

export const getLspCoinTypeUuid = (l: LSPCoinType) => {
    return `LSPCoinType[${getCoinTypeUuid(l.xTokenType)}-${getCoinTypeUuid(l.yTokenType)}]`
}

export interface PoolType {
    xTokenType: CoinType;
    yTokenType: CoinType
};

export const getPoolTypeUuid = (p: PoolType) => {
    return `PoolType[${getCoinTypeUuid(p.xTokenType)}-${getCoinTypeUuid(p.yTokenType)}]`
}

export class WeeklyStandardMovingAverage {
    start_time: number;
    current_time: number;
    a0: bigint;
    a1: bigint;
    a2: bigint;
    a3: bigint;
    a4: bigint;
    a5: bigint;
    a6: bigint;
    c0: bigint;
    c1: bigint;
    c2: bigint;
    c3: bigint;
    c4: bigint;
    c5: bigint;
    c6: bigint;

    static Zero = () => {
        return new WeeklyStandardMovingAverage(
            0, 
            0,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO,
            BigIntConstants.ZERO
        );
    }

    constructor(start_time: number, current_time: number, a0: bigint, a1: bigint, a2: bigint, a3: bigint, a4: bigint, a5: bigint, a6: bigint, c0: bigint, c1: bigint, c2: bigint, c3: bigint, c4: bigint, c5: bigint, c6: bigint) {
        this.start_time = start_time;
        this.current_time = current_time;
        this.a0 = a0;
        this.a1 = a1;
        this.a2 = a2;
        this.a3 = a3;
        this.a4 = a4;
        this.a5 = a5;
        this.a6 = a6;
        this.c0 = c0;
        this.c1 = c1;
        this.c2 = c2;
        this.c3 = c3;
        this.c4 = c4;
        this.c5 = c5;
        this.c6 = c6;
    }
}

export class MoveTemplateType {
    head: string;
    typeArgs: Array<string>;

    constructor(head: string, typeArgs: string[]) {
        this.head = head;
        this.typeArgs = typeArgs;
    }

    static fromString(s: string): MoveTemplateType | null {
        try {
            // Remove empty space
            const ms = s.match(/^(.+?)<(.*)>$/) as RegExpMatchArray;
            const head = ms[1];
            const inner = ms[2];
            let typeArgs: string[] = [];
            let braceCounter: number = 0;

            let currentArg = "";
            for (let i = 0; i < inner.length; i += 1) {

                const c = inner[i];
                const nc = (i + 1 < inner.length) ? inner[i + 1] : ""

                if (c === '<') { braceCounter += 1; }
                else if (c === '>') { braceCounter -= 1; }

                if (c === ',' && braceCounter === 0) { 
                    if (currentArg !== "") {
                        typeArgs.push(currentArg);
                    }
                    currentArg = "";
                    if (nc === ' ') {
                        i += 1;
                    }
                }
                else {
                    currentArg += c;
                }
            }

            if (currentArg !== "") {
                typeArgs.push(currentArg);
            }

            return { head, typeArgs }
        } catch {}

        return null;
    }
}

export class EPoolNotAvaliableReason {
    static Freeze = "Pool is freezed";
    static Empty = "Pool is empty, deposit first";
    static Unknown = "Pool is not avaliable";
}


export class PositionInfo {
    poolInfo: PoolInfo;
    lspCoin: CoinInfo;
    ratio?: DemicalFormat;

    constructor(poolInfo: PoolInfo, lspCoin: CoinInfo, ratio?: DemicalFormat) {
        this.poolInfo = poolInfo;
        this.lspCoin = lspCoin;
        this.ratio = ratio;
    }

    partial: (ratio: DemicalFormat) => PositionInfo = (ratio: DemicalFormat) => {
        return new PositionInfo(this.poolInfo, this.lspCoin, ratio);
    }

    balance: () => bigint = () => {
        if (this.ratio === undefined) {
            return this.lspCoin.balance;
        }

        const bl = this.lspCoin.balance * this.ratio.value / bigintPow(BigIntConstants._1E1, this.ratio.demical);
        if (bl < BigIntConstants.ZERO) {
            return BigIntConstants.ZERO;
        }
        else if (bl > this.lspCoin.balance) {
            return this.lspCoin.balance;
        }
        return bl;
    }

    getShareRatio: () => number = () => {
        if (this.poolInfo.lspSupply === BigIntConstants.ZERO) {
            return 0.0;
        }
        return Number(this.balance()) / Number(this.poolInfo.lspSupply);
    }

    getShareCoinAmounts: () => [bigint, bigint] = () => {
        if (this.poolInfo.lspSupply === BigIntConstants.ZERO) {
            return [BigIntConstants.ZERO, BigIntConstants.ZERO];
        }
        let t = this.balance();
        return [
            t * this.poolInfo.x / this.poolInfo.lspSupply,
            t * this.poolInfo.y / this.poolInfo.lspSupply
        ];
    }

    getUuid: () => string = () => {
        return `PositionInfo[${this.poolInfo.getUuid()}-${getCoinInfoUuid(this.lspCoin)}]`
    }
}

export class PoolInfo {

    static BPS_SCALING: bigint = BigInt("10000");

    type: PoolType;
    typeString: string;
    addr: string;

    index: number;
    swapType: SwapType;
    
    x: bigint;
    y: bigint;
    lspSupply: bigint;

    feeDirection: FeeDirection;

    freeze: boolean;

    totalTradeX: bigint;
    totalTradeY: bigint;
    totalTrade24hLastCaptureTime: bigint;
    totalTradeX24h: bigint;
    totalTradeY24h: bigint;

    kspSma: WeeklyStandardMovingAverage;

    adminFee: bigint;
    lpFee: bigint;
    incentiveFee: bigint;
    connectFee: bigint;
    withdrawFee: bigint;

    _fAdmin: number;
    _fLp: number;
    _aAdmin: number;
    _aLp: number;

    constructor({ type, typeString, addr, index, swapType, x, y, lspSupply, feeDirection, freeze, totalTradeX, totalTradeY, totalTrade24hLastCaptureTime, totalTradeX24h, totalTradeY24h, kspSma, adminFee, lpFee, incentiveFee, connectFee, withdrawFee }: { type: PoolType, typeString: string, addr: string, index: number, swapType: SwapType, x: bigint, y: bigint, lspSupply: bigint, feeDirection: FeeDirection, freeze: boolean, totalTradeX: bigint, totalTradeY: bigint, totalTrade24hLastCaptureTime: bigint, totalTradeX24h: bigint, totalTradeY24h: bigint, kspSma: WeeklyStandardMovingAverage, adminFee: bigint, lpFee: bigint, incentiveFee: bigint, connectFee: bigint, withdrawFee: bigint }) {
        this.type = type;
        this.typeString = typeString;
        this.addr = addr;
        this.index = index;
        this.swapType = swapType;
        this.x = x;
        this.y = y;
        this.lspSupply = lspSupply;
        this.feeDirection = feeDirection;
        this.freeze = freeze;
        this.totalTradeX = totalTradeX;
        this.totalTradeY = totalTradeY;
        this.totalTrade24hLastCaptureTime = totalTrade24hLastCaptureTime;
        this.totalTradeX24h = totalTradeX24h;
        this.totalTradeY24h = totalTradeY24h;
        this.kspSma = kspSma;
        this.adminFee = adminFee;
        this.lpFee = lpFee;
        this.incentiveFee = incentiveFee;
        this.connectFee = connectFee;
        this.withdrawFee = withdrawFee;

        this._fAdmin = Number(this.adminFee + this.connectFee) / 10000.0;
        this._fLp = Number(this.lpFee + this.incentiveFee) / 10000.0;
        this._aAdmin = 1.0 - this._fAdmin;
        this._aLp = 1.0 - this._fLp;
    }

    totalAdminFee = () => {
        return this.adminFee + this.connectFee;
    }

    totalLpFee = () => {
        return this.incentiveFee + this.lpFee;
    }

    isAvaliableForSwap = () => {
        return this.getNotAvaliableForSwapReason() === null;
    }

    getNotAvaliableForSwapReason = () => {
        if (this.freeze) { 
            return EPoolNotAvaliableReason.Freeze 
        }
        else if (this.x === BigIntConstants.ZERO || this.y === BigIntConstants.ZERO) {
            return EPoolNotAvaliableReason.Empty;
        }

        return null;
    }

    getPrice = () => {
        // Define with base token, since X is quote and Y is base
        // which is -1 / (dX / dY) = - dY / dX
        // As X * Y = K 
        // ==> X * dY + Y * dX = 0
        // ==> - dY / dX = Y / X
        if (this.x === BigIntConstants.ZERO) return 0.0;
        return Number(this.y) / Number(this.x)
    }

    getPriceBuy = () => {
        // Excahnge y to x by taking fee
        return this.getPrice() / (this._aAdmin * this._aLp)
    }

    getPriceSell = () => {
        // Excahnge x to y by taking fee
        return this.getPrice() * (this._aAdmin * this._aLp);
    }

    getXToYAmount = (dx: bigint) => {
        const x_reserve_amt = this.x;
        const y_reserve_amt = this.y;

        if (this.feeDirection === "X") {
            dx = dx - dx * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        dx = dx - dx * this.totalLpFee() / PoolInfo.BPS_SCALING;
        if (dx < BigIntConstants.ZERO) { return BigIntConstants.ZERO; }

        let dy = this._computeAmount(dx, x_reserve_amt, y_reserve_amt);
        if (this.feeDirection === "Y") {
            dy = dy - dy * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        return dy;
    }

    getYToXAmount = (dy: bigint) => {
        const x_reserve_amt = this.x;
        const y_reserve_amt = this.y;

        if (this.feeDirection === "Y") {
            dy = dy - dy * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }

        dy = dy - dy * this.totalLpFee() / PoolInfo.BPS_SCALING;
        if (dy < BigIntConstants.ZERO) { return BigIntConstants.ZERO; }

        let dx = this._computeAmount(dy, y_reserve_amt, x_reserve_amt);
        if (this.feeDirection === "X") {
            dx = dx - dx * this.totalAdminFee() / PoolInfo.BPS_SCALING;
        }
        
        return dx;
    }

    getPriceBuyWithInput = (dy: bigint) => {
        const dx = this.getYToXAmount(dy);
        return Number(dy) / Number(dx);
    }

    getPriceSellWithInput = (dx: bigint) => {
        const dy = this.getXToYAmount(dx);
        return Number(dy) / Number(dx);
    }

    getPriceBuySlippage = (dy: bigint) => {
        // TODO: Refine swap slippage computation, which should be actual amount / target amount
        const amountActual = this.getYToXAmount(dy) * BigIntConstants._1E8;
        const amountExpect = dy * this.x * BigIntConstants._1E8 / this.y;

        if (amountExpect === BigIntConstants.ZERO) {
            return 0.0;
        }

        let diff = amountExpect - amountActual;
        if (diff < BigIntConstants.ZERO) {
            diff = -diff;
        }

        return Number((diff * BigIntConstants._1E8 / amountExpect)) / (10 ** 8);
    }

    getPriceSellSlippage = (dx: bigint) => {
        // TODO: Refine swap slippage computation, which should be actual amount / target amount
        // const priceActual = this.getPriceSellWithInput(dx);
        // const priceExpect = this.getPriceSell();
        // const slippage = Math.max(0.0, priceExpect - priceActual) / priceExpect;
        // return (!isNaN(slippage)) ? slippage : 0.0;

        const amountActual = this.getXToYAmount(dx) * BigIntConstants._1E8;
        const amountExpect = dx * this.y * BigIntConstants._1E8 / this.x;

        if (amountExpect === BigIntConstants.ZERO) {
            return 0.0;
        }

        let diff = amountExpect - amountActual;
        if (diff < BigIntConstants.ZERO) {
            diff = -diff;
        }

        return Number((diff * BigIntConstants._1E8 / amountExpect)) / (10 ** 8);
    }

    getXToYMinOutputAmount = (dx: bigint, slippage: number) => {
        const dy = this.getXToYAmount(dx);
        return dy * BigInt(Math.round((10 ** 9) * (1.0 - slippage))) / BigIntConstants._1E9;
    }

    getYToXMinOutputAmount = (dy: bigint, slippage: number) => {
        const dx = this.getYToXAmount(dy);
        return dx * BigInt(Math.round((10 ** 9) * (1.0 - slippage))) / BigIntConstants._1E9;
    }

    getTvl = (client: Client, primaryCoinPrice: number) => {
        if (isSameCoinType(client.getPrimaryCoinType(), this.type.xTokenType)) {
            return Number(this.x) * primaryCoinPrice * 2.0;
        }
        else if (isSameCoinType(client.getPrimaryCoinType(), this.type.yTokenType)) {
            return Number(this.y) * primaryCoinPrice * 2.0;
        }
        // TODO: Stable coin
        return null;
    }

    getTradeVolumne24h = (client: Client, primaryCoinPrice: number) => {
        return this._getTradeVolumneInternal(client, primaryCoinPrice, Number(this.totalTradeX24h), Number(this.totalTradeY24h));
    }

    getTradeVolumne = (client: Client, primaryCoinPrice: number) => {
        return this._getTradeVolumneInternal(client, primaryCoinPrice, Number(this.totalTradeX), Number(this.totalTradeY));
    }

    _getTradeVolumneInternal = (client: Client, primaryCoinPrice: number, tx: number, ty: number) => {
        const price = this.getPrice();
        if (price === 0.0) {
            return null;
        }

        let px: number | null = null;
        let py: number | null = null;

        if (isSameCoinType(client.getPrimaryCoinType(), this.type.xTokenType)) {
            px = primaryCoinPrice;
            py = px / price;
        }

        else if (isSameCoinType(client.getPrimaryCoinType(), this.type.yTokenType)) {
            py = primaryCoinPrice;
            px = py * price;
        }

        if (px !== null && py !== null) {
            return px * tx + py * ty;
        }

        // TODO: Stable coin
        return null;
    }

    getApy = () => {
        const st = this.kspSma.start_time;
        const ct = this.kspSma.current_time;

        if (st < 1) { 
            // When st == 0, means no initialized
            return null;
        }

        const vs = [
            (ct >= st + (0 * 86400)) ? (Number(this.kspSma.a0 * BigIntConstants._1E8 / this.kspSma.c0) / 1e16) : null,
            (ct >= st + (1 * 86400)) ? (Number(this.kspSma.a1 * BigIntConstants._1E8 / this.kspSma.c1) / 1e16) : null,
            (ct >= st + (2 * 86400)) ? (Number(this.kspSma.a2 * BigIntConstants._1E8 / this.kspSma.c2) / 1e16) : null,
            (ct >= st + (3 * 86400)) ? (Number(this.kspSma.a3 * BigIntConstants._1E8 / this.kspSma.c3) / 1e16) : null,
            (ct >= st + (4 * 86400)) ? (Number(this.kspSma.a4 * BigIntConstants._1E8 / this.kspSma.c4) / 1e16) : null,
            (ct >= st + (5 * 86400)) ? (Number(this.kspSma.a5 * BigIntConstants._1E8 / this.kspSma.c5) / 1e16) : null,
            (ct >= st + (6 * 86400)) ? (Number(this.kspSma.a6 * BigIntConstants._1E8 / this.kspSma.c6) / 1e16) : null
        ].filter(x => x !== null) as number[];

        if (vs.length < 2) {
            // Cannot diff
            return null;
        }

        let dpyc: number = 0.0; // Daily percentage yield (total)
        let dpyn: number = 0.0; // Counter
        for (let i = 1; i < vs.length; ++i) {
            const v = Math.sqrt(vs[i] / vs[i - 1]);
            dpyc += (v <= 1.0) ? 1.0 : v;
            dpyn += 1.0;
        }

        const dpy = dpyc / dpyn;
        return Math.pow(dpy, 365) - 1.0;
    }

    getDepositXAmount = (y: bigint) => {
        if (this.y === BigIntConstants.ZERO) { return BigIntConstants.ZERO; }
        return (this.x * y) / this.y;
    }

    getDepositYAmount = (x: bigint) => {
        if (this.x === BigIntConstants.ZERO) { return BigIntConstants.ZERO; }
        return (x * this.y) / this.x;
    }

    getDepositAmount = (xMax: bigint, yMax: bigint) => {
        if (!this.isInitialized() || xMax <= BigIntConstants.ZERO || yMax <= BigIntConstants.ZERO) {
            return [BigIntConstants.ZERO, BigIntConstants.ZERO] as [bigint, bigint]
        };

        let x: bigint = BigIntConstants.ZERO;
        let y: bigint = BigIntConstants.ZERO;

        if (this.getDepositXAmount(yMax) > xMax) {
          x = xMax;
          y = this.getDepositYAmount(xMax);
          y = (y < yMax) ? y : yMax;
        }
        else {
          y = yMax;
          x = this.getDepositXAmount(yMax);
          x = (x < xMax) ? x : xMax;
        }

        return [x, y];
    }

    isInitialized = () => {
        return (this.x > BigIntConstants.ZERO) && (this.y > BigIntConstants.ZERO);
    }

    getSwapDirection = (x: CoinType, y: CoinType) => { 
        const x_ = this.type.xTokenType;
        const y_ = this.type.yTokenType;
        if (isSameCoinType(x, x_) && isSameCoinType(y, y_)) {
            return "forward" as PoolDirectionType
        }
        else if (isSameCoinType(x, y_) && isSameCoinType(y, x_)) {
            return "reverse" as PoolDirectionType;
        }
        return null;
    }

    isCapableSwappingForCoins = (x: CoinType, y: CoinType) => {
        return this.isInitialized() && this.isAvaliableForSwap() && (this.getSwapDirection(x, y) !== null);
    }

    _computeAmount = (dx: bigint, x: bigint, y: bigint) => {
        const numerator = y * dx;
        const denominator = x + dx;
        const dy = numerator / denominator;
        return dy;
    }

    getUuid: () => string = () => {
        return `PoolInfo[${getPoolTypeUuid(this.type)}-${this.addr}]`;
    }
}

export const isSamePool = (a: PoolInfo, b: PoolInfo) => {
    return (a.addr === b.addr) && isSameCoinType(a.type.xTokenType, b.type.xTokenType) && isSameCoinType(a.type.yTokenType, b.type.yTokenType);
}

export interface CommonTransaction {
    id: string;
    type: "swap" | "deposit" | "withdraw";
    success: boolean;
    data: SwapTransactionData | DepositTransactionData   | WithdrawTransactionData;
    timestamp: number;
}

export interface SwapTransactionData {
    poolType: PoolType;
    direction: PoolDirectionType;
    inAmount: bigint;
    outAmount?: bigint;
}

export interface DepositTransactionData {
    poolType: PoolType;
    inAmountX: bigint;
    inAmountY: bigint;
}

export interface WithdrawTransactionData {
    poolType: PoolType;
    outAmountX?: bigint;
    outAmountY?: bigint;
}