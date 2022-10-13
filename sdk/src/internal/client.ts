import { AptosClient, FaucetClient as AptosFaucetClient, Types as AptosTypes } from 'aptos';
import { JsonRpcProvider as SuiJsonRpcProvider, SuiMoveObject, SuiObject, GetObjectDataResponse } from '@mysten/sui.js';
import { MoveTemplateType, PoolInfo, CoinType, PoolType, CoinInfo, AddressType, TxHashType, PositionInfo, CommonTransaction, WeeklyStandardMovingAverage, uniqArrayOn, SwapTransactionData, DepositTransactionData, WithdrawTransactionData, PoolDirectionType, TransactionOperation as TxOps } from './common';
import { AptosConstants, BigIntConstants, SuiConstants } from './constants';
import axios from "axios"

export abstract class Client {
    abstract getCoinsAndPools: () => Promise<{ coins: CoinType[], pools: PoolInfo[] }>;
    abstract getPool: (poolInfo: PoolInfo) => Promise<PoolInfo | null>;

    abstract getAccountCoins: (accountAddr: AddressType, filter?: Array<string>) => Promise<CoinInfo[]>;
    abstract getExplorerHrefForTxHash?: (txHash: TxHashType) => string;
    abstract getPrimaryCoinType: () => CoinType;
    abstract getTransactions: (accountAddr: AddressType, limit: number) => Promise<CommonTransaction[]>;
    abstract getPrimaryCoinPrice: () => Promise<number>;
    abstract getAccountPositionInfos: (pools: PoolInfo[], coins: CoinInfo[]) => PositionInfo[];

    getCoins: () => Promise<CoinType[]> = async () => {
        return (await this.getCoinsAndPools()).coins;
    }

    getPools: () => Promise<PoolInfo[]> = async () => {
        return (await this.getCoinsAndPools()).pools;
    }

    getSortedAccountCoinsArray = async (accountAddr: AddressType, filter: Array<string>) => {
        const coins = await this.getAccountCoins(accountAddr, filter);
        coins.sort((a, b) => (a.balance < b.balance) ? 1 : (a.balance > b.balance ? -1 : 0));
        return filter.map(ty => coins.filter(coin => coin.type.name === ty));
    }
}

export class SuiswapClient extends Client {
    
    packageAddr: AddressType;
    owner: AddressType;
    endpoint: string;
    provider: SuiJsonRpcProvider;

    constructor({ packageAddr, owner, endpoint } : { packageAddr: AddressType, owner: AddressType, endpoint: string }) {
        super();
        this.packageAddr = packageAddr;
        this.owner = owner;
        this.endpoint = endpoint;
        this.provider = new SuiJsonRpcProvider(this.endpoint);
    }

    getPrimaryCoinType = () => {
        return SuiConstants.SUI_COIN_TYPE;
    }

    _mapResponseToPoolInfo = (response: GetObjectDataResponse) => {
        try {
            const details = response.details as SuiObject;
            const typeString = (details.data as SuiMoveObject).type;
            const poolTemplateType = MoveTemplateType.fromString(typeString)!;
            const poolType: PoolType = {
                xTokenType: { network: "sui", name: poolTemplateType.typeArgs[0] },
                yTokenType: { network: "sui", name: poolTemplateType.typeArgs[1] },
            };
            const fields = (details.data as SuiMoveObject).fields;
            const poolInfo = new PoolInfo({
                type: poolType,
                typeString: typeString,
                addr: fields.id.id,

                index: 0, // TODO: SUI
                swapType: "v2", // TODO: SUI

                x: BigInt(fields.x),
                y: BigInt(fields.y),
                lspSupply: BigInt(fields.lsp_supply.fields.value),

                feeDirection: "X",

                freeze: fields.freeze,

                totalTradeX: BigIntConstants.ZERO,
                totalTradeY: BigIntConstants.ZERO,
                totalTrade24hLastCaptureTime: BigIntConstants.ZERO,
                totalTradeX24h: BigIntConstants.ZERO,
                totalTradeY24h: BigIntConstants.ZERO,

                kspSma: WeeklyStandardMovingAverage.Zero(),

                adminFee: BigInt(fields.admin_fee),
                lpFee: BigInt(fields.lp_fee),
                incentiveFee: BigIntConstants.ZERO,
                connectFee: BigIntConstants.ZERO,
                withdrawFee: BigIntConstants.ZERO
            });
            return poolInfo;
        } catch (_e) {
            return null;
        }
    }

    getPool = async (poolInfo: PoolInfo) => {
        const response = (await this.provider.getObject(poolInfo.addr));
        return this._mapResponseToPoolInfo(response);
    }

    getCoinsAndPools: (() => Promise<{ coins: CoinType[]; pools: PoolInfo[]; }>) = async () => {
        const packageAddr = this.packageAddr;
        const packageOwner = this.owner;

        const poolInfoIds = (await this.provider.getObjectsOwnedByAddress(packageOwner))
            .filter((obj) => { return (obj.type === `${packageAddr}::pool::PoolCreateInfo`) })
            .map((obj) => obj.objectId);

        const poolInfoObjects = await this.provider.getObjectBatch(poolInfoIds);

        const poolIds = poolInfoObjects.map((x) => {
            const details = x.details as SuiObject;
            const object = details.data as SuiMoveObject;
            const poolId = object.fields["pool_id"] as string;
            return poolId;
        });

        const poolInfos = (await this.provider.getObjectBatch(poolIds)).map((response) => this._mapResponseToPoolInfo(response)).filter(x => x !== null) as PoolInfo[];

        const coinTypes = uniqArrayOn(poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]), coinType => coinType.name);
        return { coins: coinTypes, pools: poolInfos };
    };

    getAccountCoins: (accountAddr: AddressType, filter?: string[] | undefined) => Promise<CoinInfo[]> = async (accountAddr: AddressType, filter?: Array<string>) => {
        let coinFilter = new Set<string>();
        if (filter !== undefined) {
            filter.forEach((x) => { coinFilter.add(`0x2::coin::Coin<${x}>`) });
        }

        const accountObjects = (await this.provider.getObjectsOwnedByAddress(accountAddr));
        const accountCoinObjects = accountObjects.filter((obj) => obj.type.startsWith("0x2::coin::Coin"));
        const accountFilteredCoinObjects = (filter === undefined) ? accountCoinObjects : accountCoinObjects.filter((obj) => coinFilter.has(obj.type));

        const coinAddrs = accountFilteredCoinObjects.map(x => x.objectId);
        const coinObjects = (await this.provider.getObjectBatch(coinAddrs)).filter(x => (x.status === "Exists"));

        const coins = coinObjects.map(x => {
            let data = ((x.details as SuiObject).data as SuiMoveObject);
            let coin = {
                type: { name: data.type.replace(/^0x2::coin::Coin<(.+)>$/, "$1"), network: "sui" },
                addr: data.fields.id.id as AddressType,
                balance: BigInt(data.fields.balance)
            } as CoinInfo;
            return coin;
        });

        return coins.filter((coin) => coin.balance > BigIntConstants.ZERO);
    }

    getAccountPoolLspCoins = async (accountAddr: string) => {
        const packageAddr = this.packageAddr;

        const coinFilter = [`${packageAddr}::pool::LSP<0x2::sui::SUI, ${packageAddr}::pool::TestToken>`];
        const coins = (await this.getSortedAccountCoinsArray(accountAddr, coinFilter))[0];
        return coins;
    }

    getAccountPositionInfos = (pools: PoolInfo[], coins: CoinInfo[]) => {
        const packageAddr = this.packageAddr;
        const lspPrefix = `${packageAddr}::pool::LSP`;

        const lspCoins = coins.filter(coin => coin.type.name.startsWith(lspPrefix));
        const lspPositionInfos = lspCoins
            .map(coin => {
                try {
                    const template = MoveTemplateType.fromString(coin.type.name)!;
                    const xCoinTypeName = template.typeArgs[0];
                    const yCoinTypeName = template.typeArgs[1];

                    const poolInfos = pools.filter((p) => (p.type.xTokenType.name === xCoinTypeName && p.type.yTokenType.name === yCoinTypeName))
                    if (poolInfos.length === 0) return null;

                    // Get the largest one
                    let poolInfo = poolInfos[0];
                    for (const p of poolInfos) {
                        if (p.lspSupply > poolInfo.lspSupply) {
                            poolInfo = p;
                        }
                    }

                    return new PositionInfo(poolInfo, coin);
                } catch { }

                return null;
            })
            .filter(x => x !== null) as PositionInfo[];
        return lspPositionInfos;
    }

    getExplorerHrefForTxHash = (txHash: TxHashType) => {
        return `https://explorer.devnet.sui.io/transactions/${txHash}`;
    }

    getTransactions: (accountAddr: string, limit: number) => Promise<CommonTransaction[]> = async (_accountAddr: string, _limit: number) => {
        // TODO: SUI
        return [];
    }

    getPrimaryCoinPrice: () => Promise<number> = async () => {
        return (38.535 + Math.random() * 0.03);
    }
}

export class AptoswapClient extends Client {

    static HOST_DEPLOY_JSON_PATH = "api/deploy.json"

    packageAddr: AddressType;
    client: AptosClient;
    faucetClient?: AptosFaucetClient;

    /**
     * Generate AptoswapClient by providing the host website
     * 
     * @param host the host for the website, for example: "https://aptoswap.net"
     * 
     * @returns An AptoswapClient if we could generate the client from host or null otherwise
     */
    static fromHost = async (host: string) => {
        // Generate something like "https://aptoswap.net/api/deploy.json"
        const deployJsonHref = host + (host.endsWith('/') ? "" : "/") + AptoswapClient.HOST_DEPLOY_JSON_PATH;

        try {
            const response = await axios.get(deployJsonHref);
            const endpoint: string = response.data.endpoint;
            const faucetEndpoint: string | undefined = response.data.faucetEndpoint;
            const packageAddr: string = response.data.aptoswap?.package;    

            return new AptoswapClient({ packageAddr, endpoint, faucetEndpoint });

        } catch {
            return null;
        }
    }

    constructor({ packageAddr, endpoint, faucetEndpoint }: { packageAddr: AddressType, endpoint: string, faucetEndpoint?: string }) {
        super();

        this.packageAddr = packageAddr;
        this.client = new AptosClient(endpoint);

        if (faucetEndpoint !== undefined) {
            this.faucetClient = new AptosFaucetClient(endpoint, faucetEndpoint);
        }
    }

    static _isAccountNotExistError = (e: any) => {
        if ((e instanceof Error) && (e as any).status === 404 && (e as any).body !== undefined) {
            const body = (e as any).body as any;
            if (body.error_code === "account_not_found") {
                return true;
            }
        }
        return false;
    }

    static _mapResourceToPoolInfo = (addr: AddressType, resource: AptosTypes.MoveResource) => {
        try {
            const typeString = resource.type;
            const mtt = MoveTemplateType.fromString(typeString)!;

            const xCoinType = {
                network: "aptos",
                name: mtt.typeArgs[0]
            } as CoinType;

            const yCoinType = {
                network: "aptos",
                name: mtt.typeArgs[1]
            } as CoinType;

            const data = resource.data as any;

            const poolType = { xTokenType: xCoinType, yTokenType: yCoinType } as PoolType;
            const poolInfo = new PoolInfo({
                type: poolType,
                typeString: typeString,
                addr: addr,

                index: Number(data.index),
                swapType: (Number(data.pool_type) === 100) ? "v2" : "stable",

                x: BigInt(data.x.value),
                y: BigInt(data.y.value),
                lspSupply: BigInt(data.lsp_supply),

                feeDirection: (Number(data.fee_direction) === 200) ? "X" : "Y",

                freeze: data.freeze,

                totalTradeX: BigInt(data.total_trade_x),
                totalTradeY: BigInt(data.total_trade_y),
                totalTrade24hLastCaptureTime: BigInt(data.total_trade_24h_last_capture_time),
                totalTradeX24h: BigInt(data.total_trade_x_24h),
                totalTradeY24h: BigInt(data.total_trade_y_24h),

                kspSma: new WeeklyStandardMovingAverage(
                    Number(data.ksp_e8_sma.start_time),
                    Number(data.ksp_e8_sma.current_time),
                    BigInt(data.ksp_e8_sma.a0),
                    BigInt(data.ksp_e8_sma.a1),
                    BigInt(data.ksp_e8_sma.a2),
                    BigInt(data.ksp_e8_sma.a3),
                    BigInt(data.ksp_e8_sma.a4),
                    BigInt(data.ksp_e8_sma.a5),
                    BigInt(data.ksp_e8_sma.a6),

                    BigInt(data.ksp_e8_sma.c0),
                    BigInt(data.ksp_e8_sma.c1),
                    BigInt(data.ksp_e8_sma.c2),
                    BigInt(data.ksp_e8_sma.c3),
                    BigInt(data.ksp_e8_sma.c4),
                    BigInt(data.ksp_e8_sma.c5),
                    BigInt(data.ksp_e8_sma.c6),
                ),

                adminFee: BigInt(data.admin_fee),
                lpFee: BigInt(data.lp_fee),
                incentiveFee: BigInt(data.incentive_fee),
                connectFee: BigInt(data.connect_fee),
                withdrawFee: BigInt(data.withdraw_fee)
            });

            return poolInfo;
        } catch {}

        return null;
    }

    getPool = async (poolInfo: PoolInfo) => {
        try {
            const resource = await this.client.getAccountResource(poolInfo.addr, poolInfo.typeString);
            return AptoswapClient._mapResourceToPoolInfo(poolInfo.addr, resource);
        }
        catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return null;
            }
            else {
                throw e;
            }
        }
    }

    getCoinsAndPools: (() => Promise<{ coins: CoinType[]; pools: PoolInfo[]; }>) = async () => {
        // First
        let poolInfosRaw: AptosTypes.MoveResource[] = [];

        try {
            poolInfosRaw = (await this.client.getAccountResources(this.packageAddr))
            .filter(resource => resource.type.startsWith(`${this.packageAddr}::pool::Pool`));
        } catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return { coins: [], pools: [] };
            }
            else {
                throw e;
            }
        }

        const poolInfos = poolInfosRaw
            .map((pr) => AptoswapClient._mapResourceToPoolInfo(this.packageAddr, pr))
            .filter(x => x !== null) as PoolInfo[];

        const coinTypes = uniqArrayOn(poolInfos.flatMap((poolInfo) => [poolInfo.type.xTokenType, poolInfo.type.yTokenType]), coinType => coinType.name);
        return { coins: coinTypes, pools: poolInfos };
    }

    getAccountCoins: (accountAddr: AddressType, filter?: string[] | undefined) => Promise<CoinInfo[]> = async (accountAddr: AddressType, filter?: Array<string>) => {
        let coinsRaw: AptosTypes.MoveResource[] = [];
        try {
            coinsRaw = (await this.client.getAccountResources(accountAddr))
        } catch (e) {
            if (AptoswapClient._isAccountNotExistError(e)) {
                return [];
            }
            else {
                throw e;
            }
        }

        const coins = coinsRaw
            .map(c => {
                const template = MoveTemplateType.fromString(c.type);
                if (template === null || template.head !== "0x1::coin::CoinStore") { return null; }

                // Filter the coin type
                const coinType = { network: "aptos", name: template.typeArgs[0] } as CoinType;
                if (filter !== undefined && filter.indexOf(coinType.name) === -1) { return null; }

                try {
                    const balance = BigInt((c.data as any).coin.value);
                    if (balance <= BigIntConstants.ZERO) {
                        return null;
                    }
                    return {
                        type: coinType,
                        addr: accountAddr,
                        balance: balance
                    } as CoinInfo
                } catch {
                    return null;
                }
            })
            .filter(c => c !== null) as CoinInfo[];

        return coins;
    }

    getAccountPositionInfos = (pools: PoolInfo[], coins: CoinInfo[]) => {        
        const lspPrefix = `${this.packageAddr}::pool::LSP`;

        const lspCoins = coins.filter(coin => coin.type.name.startsWith(lspPrefix))
        const lspPositionInfos = lspCoins
            .map(coin => {
                try {
                    if (coin.balance <= BigIntConstants.ZERO) {
                        return null;
                    }
                    const template = MoveTemplateType.fromString(coin.type.name);
                    if (template === null || template.typeArgs.length !== 2) {
                        return null;
                    }

                    const xCoinTypeName = template.typeArgs[0];
                    const yCoinTypeName = template.typeArgs[1];
                    const poolInfos = pools.filter((p) => (p.type.xTokenType.name === xCoinTypeName && p.type.yTokenType.name === yCoinTypeName))
                    if (poolInfos.length === 0) return null;

                    // Get the largest one
                    let poolInfo = poolInfos[0];
                    for (const p of poolInfos) {
                        if (p.lspSupply > poolInfo.lspSupply) {
                            poolInfo = p;
                        }
                    }

                    return new PositionInfo(poolInfo, coin);
                } catch { }

                return null;
            })
            .filter(x => x !== null) as PositionInfo[];

        return lspPositionInfos;
    }

    getTransactions: (accountAddr: string, limit: number) => Promise<CommonTransaction[]> = async (accountAddr: string, limit: number) => {
        const transactions = await this.client.getAccountTransactions(accountAddr, { limit: limit }) as AptosTypes.UserTransaction[]; 

        const swapTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return (payload.function.includes("swap_x_to_y") || payload.function.includes("swap_y_to_x"));
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const direction: PoolDirectionType = payload.function.includes("swap_x_to_y") ? "forward" : "reverse";
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let inAmount = BigInt(payload.arguments[0]);
                let outAmount: bigint | undefined = undefined;
                const swapTokenEvents = r.events.filter(e => e.type.endsWith("pool::SwapTokenEvent"));
                if (swapTokenEvents.length > 0) {
                    const swapTokenEvent = swapTokenEvents[0];
                    inAmount = BigInt(swapTokenEvent.data.in_amount);
                    outAmount = BigInt(swapTokenEvent.data.out_amount);
                }
                return {
                    type: "swap",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    data: {
                        poolType,
                        direction,
                        inAmount,
                        outAmount
                    } as SwapTransactionData
                } as CommonTransaction
            });

        const depositTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return payload.function.includes("add_liquidity")
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let inAmountX = BigInt(payload.arguments[0]);
                let inAmountY = BigInt(payload.arguments[1]);
                
                return {
                    type: "deposit",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    data: {
                        poolType,
                        inAmountX,
                        inAmountY
                    } as DepositTransactionData
                } as CommonTransaction
            });

        const withdrawTransactions = transactions
            .filter( r => {
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                return payload.function.includes("remove_liquidity")
            }).map( r => {
                const success = r.success;
                const payload = r.payload as AptosTypes.EntryFunctionPayload;
                const poolType: PoolType = {
                    xTokenType: { network: "aptos", name: payload.type_arguments[0] },
                    yTokenType: { network: "aptos", name: payload.type_arguments[1] }
                };
                let outAmountX: bigint | undefined;
                let outAmountY: bigint | undefined;
                const liqudityEvents = r.events.filter(r => r.type.endsWith("pool::LiquidityEvent"));
                if (liqudityEvents.length > 0) {
                    const liqudityEvent = liqudityEvents[0];
                    outAmountX = BigInt(liqudityEvent.data.x_amount);
                    outAmountY = BigInt(liqudityEvent.data.y_amount);
                }      
                return {
                    type: "withdraw",
                    id: r.hash,
                    timestamp: Number(r.timestamp) / 1e6,
                    success: success,
                    data: {
                        poolType,
                        outAmountX,
                        outAmountY
                    } as WithdrawTransactionData
                } as CommonTransaction
            });

        const txs = [...swapTransactions, ...depositTransactions, ...withdrawTransactions];
        txs.sort((a, b) => (a.timestamp < b.timestamp) ? 1 : (a.timestamp > b.timestamp ? -1 : 0));
        return txs;
    }

    getExplorerHrefForTxHash = (txHash: string) => {
        return `https://explorer.aptoslabs.com/txn/${txHash}`
    }

    getPrimaryCoinType = () => {
        return AptosConstants.APTOS_COIN_TYPE;
    }

    getPrimaryCoinPrice: () => Promise<number> = async () => {
        return (38.535 + Math.random() * 0.03) / (10 ** 8);
    }
}