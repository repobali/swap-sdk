import { AptosAccount, AptosClient, FaucetClient as AptosFaucetClient, Types as AptosTypes } from 'aptos';
import { JsonRpcProvider as SuiJsonRpcProvider, MoveCallTransaction as SuiMoveCallTransaction, SuiMoveObject, SuiObject, GetObjectDataResponse } from '@mysten/sui.js';
import { MoveTemplateType, PoolInfo, CoinType, PoolType, CoinInfo, AddressType, TxHashType, PositionInfo, CommonTransaction, WeeklyStandardMovingAverage, uniqArrayOn, SwapTransactionData, DepositTransactionData, WithdrawTransactionData, PoolDirectionType, isSameCoinType } from './common';
import { AptosSerializer, TransactionOperation, TransactionOptions, TransactionType, TransactionTypeSerializeContext } from './transaction';
import { AptosConstants, BigIntConstants, NumberLimit, SuiConstants } from './constants';
import axios from "axios"

export abstract class Client {
    abstract getPackageAddress: () => AddressType;
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

export interface SuiswapClientTransactionContext {
    accountAddr: AddressType;
    gasBudget?: bigint;
}

export class SuiswapClient extends Client {

    static DEFAULT_GAS_BUDGET = BigInt(2000);
    
    packageAddr: AddressType;
    testTokenSupplyAddr: AddressType;
    owner: AddressType;
    endpoint: string;
    provider: SuiJsonRpcProvider;

    constructor({ packageAddr, testTokenSupplyAddr, owner, endpoint } : { packageAddr: AddressType, testTokenSupplyAddr: AddressType, owner: AddressType, endpoint: string }) {
        super();
        this.packageAddr = packageAddr;
        this.testTokenSupplyAddr = testTokenSupplyAddr;
        this.owner = owner;
        this.endpoint = endpoint;
        this.provider = new SuiJsonRpcProvider(this.endpoint);
    }

    getPackageAddress = () => {
        return this.packageAddr;
    }

    getPrimaryCoinType = () => {
        return SuiConstants.SUI_COIN_TYPE;
    }

    getPool = async (poolInfo: PoolInfo) => {
        const response = (await this.provider.getObject(poolInfo.addr));
        return this._mapResponseToPoolInfo(response);
    }

    getSuiProvider = () => {
        return this.provider;
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

    generateMoveTransaction = async (opt: TransactionOperation.Any, ctx: SuiswapClientTransactionContext) => {
        if (opt.operation === "swap") {
            return (await this._generateMoveTransaction_Swap(opt as TransactionOperation.Swap, ctx));
        }
        else if (opt.operation === "add-liqudity") {
            return (await this._generateMoveTransaction_AddLiqudity(opt as TransactionOperation.AddLiqudity, ctx));
        }
        else if (opt.operation === "mint-test-coin") {
            return (await this._generateMoveTransaction_MintTestCoin(opt as TransactionOperation.MintTestCoin, ctx));
        }
        else if (opt.operation === "remove-liqudity") {
            return (await this._generateMoveTransaction_RemoveLiquidity(opt as TransactionOperation.RemoveLiquidity, ctx));
        }
        throw new Error(`Not implemented`);
    }

    generateMoveTransactionOrNull = async (opt: TransactionOperation.Any, ctx: SuiswapClientTransactionContext) => {
        try {
            const transaction = await this.generateMoveTransaction(opt, ctx);
            return transaction;
        } catch (e) {
            return null;
        }
    }

    checkGasFeeAvaliable = async (accountAddr: AddressType, excludeCoinsAddresses: AddressType[], estimateGas: bigint) => {
        const primaryCoins = (await this.getSortedAccountCoinsArray(accountAddr, [this.getPrimaryCoinType().name]))[0];
        const primaryCoinsFiltered = primaryCoins.filter(coin => excludeCoinsAddresses.indexOf(coin.addr) === -1);
        if (primaryCoinsFiltered.length === 0 || primaryCoins[0].balance < estimateGas) {
            return false;
        }
        return true;
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

    _generateMoveTransaction_Swap = async (opt: TransactionOperation.Swap, ctx: SuiswapClientTransactionContext) => {
        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_GAS_BUDGET;

        if (opt.amount <= 0 || opt.amount > NumberLimit.U64_MAX) {
            throw new Error(`Invalid input amount for swapping: ${opt.amount}`);
        }

        if ((opt.minOutputAmount !== undefined) && (opt.minOutputAmount < BigIntConstants.ZERO || opt.minOutputAmount > NumberLimit.U64_MAX)) {
            throw new Error(`Invalid min output amount for swapping: ${opt.minOutputAmount}`);
        }

        if (opt.pool.freeze) {
            throw new Error(`Cannot not swap for freeze pool: ${opt.pool.addr}`);
        }

        const swapCoinType = (opt.direction === "forward") ? opt.pool.type.xTokenType.name : opt.pool.type.yTokenType.name;

        const swapCoins = await this.getAccountCoins(ctx.accountAddr, [swapCoinType]);
        swapCoins.sort((a, b) => (a.balance < b.balance) ? 1 : (a.balance > b.balance ? -1 : 0));

        if (swapCoins.length === 0) {
            throw new Error(`The account doesn't hold the coin for swapping: ${swapCoinType}`);
        }
        const swapCoin = swapCoins[0];

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, [swapCoin.addr], gasBudget);
        if (!isGasEnough) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.getPackageAddress(),
            module: "pool",
            function: (opt.direction == "forward") ? "swap_x_to_y" : "swap_y_to_x",
            typeArguments: [opt.pool.type.xTokenType.name, opt.pool.type.yTokenType.name],
            arguments: [
                opt.pool.addr,
                swapCoin.addr,
                opt.amount.toString(),
                gasBudget.toString(),
            ],
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }

    _generateMoveTransaction_AddLiqudity = async (opt: TransactionOperation.AddLiqudity, ctx: SuiswapClientTransactionContext) => {

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_GAS_BUDGET;

        const pool = opt.pool;
        const xAmount = opt.xAmount;
        const yAmount = opt.yAmount;

        if (((xAmount <= 0 || xAmount > NumberLimit.U64_MAX) || (yAmount <= 0 || yAmount > NumberLimit.U64_MAX))) {
            throw new Error(`Invalid input amount for adding liqudity: ${xAmount} or minOutputAmount: ${yAmount}`);
        }

        if (pool.freeze) {
            throw new Error(`Cannot not swap for freeze pool: ${pool.addr}`);
        }

        // Temporarily comment due to Suiet bug
        // if ((await this.isConnected()) == false) {
        //     throw new Error("Wallet is not connected");
        // }

        const accountAddr = ctx.accountAddr;
        if (accountAddr === null) {
            throw new Error("Cannot get the current account address from wallet")
        }

        // Getting the both x coin and y coin
        const swapCoins = await this.getAccountCoins(accountAddr, [pool.type.xTokenType.name, pool.type.yTokenType.name]);
        const swapXCoins = swapCoins.filter(c => isSameCoinType(c.type, pool.type.xTokenType));
        const swapYCoins = swapCoins.filter(c => isSameCoinType(c.type, pool.type.yTokenType));
        swapXCoins.sort((a, b) => (a.balance < b.balance) ? 1 : (a.balance > b.balance ? -1 : 0));
        swapYCoins.sort((a, b) => (a.balance < b.balance) ? 1 : (a.balance > b.balance ? -1 : 0));

        if (swapXCoins.length === 0) {
            throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.xTokenType.name}`);
        }
        if (swapYCoins.length === 0) {
            throw new Error(`The account doesn't hold the coin for adding liqudity: ${pool.type.yTokenType.name}`);
        }

        const swapXCoin = swapXCoins[0];
        const swapYCoin = swapYCoins[0];

        if (swapXCoin.balance < xAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.xTokenType.name}, current balance: ${swapXCoin.balance}, expected: ${xAmount}`);
        }
        if (swapYCoin.balance < yAmount) {
            throw new Error(`The account has insuffcient balance for coin ${pool.type.yTokenType.name}, current balance: ${swapYCoin.balance}, expected: ${yAmount}`);
        }

        const isGasEnough = await this.checkGasFeeAvaliable(accountAddr, [swapXCoin.addr, swapYCoin.addr], gasBudget);
        if (!isGasEnough) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        // Entry: entry fun add_liquidity<X, Y>(pool: &mut Pool<X, Y>, x: Coin<X>, y: Coin<Y>, in_x_amount: u64, in_y_amount: u64, ctx: &mut TxContext)
        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.getPackageAddress(),
            module: "pool",
            function: "add_liquidity",
            typeArguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                pool.addr,
                swapXCoin.addr,
                swapYCoin.addr,
                xAmount.toString(),
                yAmount.toString()
            ],
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }

    _generateMoveTransaction_MintTestCoin = async (opt: TransactionOperation.MintTestCoin, ctx: SuiswapClientTransactionContext) => {;

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_GAS_BUDGET;

        const amount = opt.amount;
        const packageAddr = this.getPackageAddress();

        if (amount <= 0 || amount > NumberLimit.U64_MAX) {
            throw new Error(`Invalid input amount for minting test token: ${amount}`);
        }

        // Get test tokens
        let accountTestTokens: Array<CoinInfo> = [];
        try {
            accountTestTokens = (await this.getSortedAccountCoinsArray(ctx.accountAddr, [`${packageAddr}::pool::TestToken`]))[0];
        } catch {
            throw new Error("Network error while trying to get the test token info from account");
        }

        const accountTestToken = (accountTestTokens.length > 0) ? accountTestTokens[0] : null;

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, [], gasBudget);
        if (!isGasEnough) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        let transacation: SuiMoveCallTransaction = (accountTestToken === null) ? (
            // entry fun mint_test_token(token_supply: &mut TestTokenSupply, amount: u64, recipient: address, ctx: &mut TxContext)
            {
                packageObjectId: packageAddr,
                module: "pool",
                function: "mint_test_token",
                typeArguments: [],
                arguments: [
                    this.testTokenSupplyAddr,
                    amount.toString(),
                    ctx.accountAddr
                ],
                gasBudget: Number(gasBudget)
            }
        ) : (
            // entry fun mint_test_token_merge(token_supply: &mut TestTokenSupply, amount: u64, coin: &mut Coin<TestToken>, ctx: &mut TxContext) {
            {
                packageObjectId: packageAddr,
                module: "pool",
                function: "mint_test_token_merge",
                typeArguments: [],
                arguments: [
                    this.testTokenSupplyAddr,
                    amount.toString(),
                    accountTestToken.addr
                ],
                gasBudget: Number(gasBudget)
            }
        );

        return transacation;
    }

    _generateMoveTransaction_RemoveLiquidity = async (opt: TransactionOperation.RemoveLiquidity, ctx: SuiswapClientTransactionContext) => {;

        const gasBudget = ctx.gasBudget ?? SuiswapClient.DEFAULT_GAS_BUDGET;

        const position = opt.positionInfo;
        const pool = position.poolInfo;
        const lspCoin = position.lspCoin;
        const amount = position.balance();

        if ((amount <= 0 || amount > NumberLimit.U64_MAX)) {
            throw new Error(`Invalid input coin, balance is zero`);
        }

        const accountAddr = ctx.accountAddr;
        if (accountAddr === null) {
            throw new Error("Cannot get the current account address from wallet")
        }

        // Getting the both x coin and y coin
        const isGasEnough = await this.checkGasFeeAvaliable(accountAddr, [lspCoin.addr], gasBudget);
        if (!isGasEnough) {
            throw new Error("Cannot find the gas payment or not enough amount for paying the gas");
        }

        // Entry: entry fun remove_liquidity<X, Y>(pool: &mut Pool<X, Y>, lsp: Coin<LSP<X, Y>>, lsp_amount: u64, ctx: &mut TxContext)
        let transacation: SuiMoveCallTransaction = {
            packageObjectId: this.packageAddr,
            module: "pool",
            function: "remove_liquidity",
            typeArguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                pool.addr,
                lspCoin.addr,
                amount.toString(),
            ],
            gasBudget: Number(gasBudget)
        };

        return transacation;
    }
}

export interface AptoswapClientTransactionContext {
    accountAddr: AddressType;
    gasBudget?: bigint;
    gasPrice?: bigint;
}

export class AptoswapClient extends Client {

    static DEFAULT_GAS_BUDGET = BigInt(2000);
    static DEFAULT_EXPIRATION_SECS = 90;
    static DEFAULT_EXECUTE_TIMEOUT_SECS = 30;
    static HOST_DEPLOY_JSON_PATH = "api/deploy.json"

    packageAddr: AddressType;
    client: AptosClient;
    faucetClient?: AptosFaucetClient;
    minGasPrice: bigint;

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
            let minGasPrice: bigint | null = null;

            const gasScheduleV2Client =  new AptosClient(endpoint)
            const gasScheduleV2 = ((await gasScheduleV2Client.getAccountResource("0x1", "0x1::gas_schedule::GasScheduleV2")).data as any).entries;
            for (const entry of (gasScheduleV2) ?? []) {
                if (entry.key === "txn.min_price_per_gas_unit") {
                    minGasPrice = BigInt(entry.val);
                }
            }

            return new AptoswapClient({ packageAddr, endpoint, faucetEndpoint, minGasPrice: minGasPrice ?? BigIntConstants._1E2});

        } catch {
            return null;
        }
    }

    constructor({ packageAddr, endpoint, faucetEndpoint, minGasPrice }: { packageAddr: AddressType, endpoint: string, faucetEndpoint?: string, minGasPrice: bigint }) {
        super();

        this.packageAddr = packageAddr;
        this.client = new AptosClient(endpoint);

        if (faucetEndpoint !== undefined) {
            this.faucetClient = new AptosFaucetClient(endpoint, faucetEndpoint);
        }

        this.minGasPrice = minGasPrice;
    }

    getAptosClient = () => {
        return this.client;
    }

    getPackageAddress = () => {
        return this.packageAddr;
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

    static _isAccountNotHaveResource = (e: any) => {
        if ((e instanceof Error) && (e as any).status === 404 && (e as any).body !== undefined) {
            const body = (e as any).body as any;
            if (body.error_code === "account_not_found") {
                return true;
            }
        }
        return false;
    }

    static _checkAccountExists = (e: any) => {
        if (AptoswapClient._isAccountNotExistError(e)) {
            throw new Error("Account not found");
        }
    }

    static _checkAccountResource = (e: any) => {
        if (AptoswapClient._isAccountNotHaveResource(e)) {
            throw new Error("Resource not found not found");
        }
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

    generateTransactionType = async (opt: TransactionOperation.Any, ctx: AptoswapClientTransactionContext) => {
        if (opt.operation === "swap") {
            return (await this._generateTransactionType_Swap(opt as TransactionOperation.Swap, ctx));
        }
        else if (opt.operation === "add-liqudity") {
            return (await this._generateTransactionType_AddLiqudity(opt as TransactionOperation.AddLiqudity, ctx));
        }
        else if (opt.operation === "mint-test-coin") {
            return (await this._generateTransactionType_MintTestCoin(opt as TransactionOperation.MintTestCoin, ctx));
        }
        else if (opt.operation === "remove-liqudity") {
            return (await this._generateTransactionType_RemoveLiquidity(opt as TransactionOperation.RemoveLiquidity, ctx));
        }
        throw new Error(`Not implemented`);
    }

    generateEntryFuntionPayload = async (opt: TransactionOperation.Any, accountAddr: AddressType, opts: TransactionOptions) => {
        const transcationCtx: AptoswapClientTransactionContext = {
            accountAddr: accountAddr,
            gasBudget: opts.maxGasAmount ?? AptoswapClient.DEFAULT_GAS_BUDGET,
            gasPrice: opts.gasUnitPrice ?? this.minGasPrice
        };
        
        const serializeCtx: TransactionTypeSerializeContext = {
            packageAddr: this.getPackageAddress(),
            sender: accountAddr
        };

        const t = await this.generateTransactionType(opt, transcationCtx);
        const payload = AptosSerializer.toEntryFunctionPayload(t, serializeCtx);
        return payload;
    }

    submit = async (opt: TransactionOperation.Any, account: AptosAccount, opts: TransactionOptions) => { 
        const accountAddr = account.address().toString();
        const payload = await this.generateEntryFuntionPayload(opt, accountAddr, opts);

        const rawTransaction = await this.client.generateTransaction(
            accountAddr, 
            payload, 
            {
                max_gas_amount: (opts.maxGasAmount ?? AptoswapClient.DEFAULT_GAS_BUDGET).toString(),
                gas_unit_price: (opts.gasUnitPrice ?? this.minGasPrice).toString(),
                expiration_timestamp_secs: (Math.floor(Date.now() / 1000) + (opts?.expirationSecond ?? AptoswapClient.DEFAULT_EXPIRATION_SECS)).toString()
            }
        );
        
        const signedTransaction = await this.client.signTransaction(account, rawTransaction);
        const pendingTransaction = await this.client.submitTransaction(signedTransaction);
        return pendingTransaction.hash;
    }

    execute = async (opt: TransactionOperation.Any, account: AptosAccount, opts: TransactionOptions, timeout?: number) => {
        const txHash = await this.submit(opt, account, opts);
        const result = await this.client.waitForTransactionWithResult(txHash, { timeoutSecs: timeout ?? AptoswapClient.DEFAULT_EXECUTE_TIMEOUT_SECS, checkSuccess: false });
        return (result as AptosTypes.UserTransaction);
    }

    checkGasFeeAvaliable = async (accountAddr: AddressType, usedAmount: bigint, estimateGasAmount: bigint) => {
        let balance = BigIntConstants.ZERO;
        try {
            const resource = await this.client.getAccountResource(accountAddr, "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
            balance = BigInt((resource.data as any).coin?.value);
        } catch (e) {
            AptoswapClient._checkAccountExists(e);
            AptoswapClient._checkAccountResource(e);
            throw e;
        }

        if (balance < estimateGasAmount + usedAmount) {
            return false;
        }

        return true;
    }

    _generateTransactionType_Swap = async (opt: TransactionOperation.Swap, ctx: AptoswapClientTransactionContext) => {

        const gasBudget = ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET;

        const pool = opt.pool;
        const direction = opt.direction;
        const amount = opt.amount;
        const minOutputAmount = opt.minOutputAmount;

        const packageAddr = this.getPackageAddress();
        const function_name = (direction === "forward") ? "swap_x_to_y" : "swap_y_to_x";
        const sourceCoinType = (direction === "forward") ? (pool.type.xTokenType) : (pool.type.yTokenType);

        const isGasEnough = await this.checkGasFeeAvaliable(
            ctx.accountAddr,
            isSameCoinType(sourceCoinType, this.getPrimaryCoinType()) ? amount : BigIntConstants.ZERO,
            gasBudget
        );
        if (!isGasEnough) {
            throw new Error("Not enough gas for swapping");
        }

        // public entry fun swap_x_to_y<X, Y>(user: &signer, pool_account_addr: address, in_amount: u64, min_out_amount: u64) acquires Pool {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::${function_name}`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                amount,
                minOutputAmount ?? BigIntConstants.ZERO
            ]
        };

        return transaction;
    }

    _generateTransactionType_AddLiqudity = async (opt: TransactionOperation.AddLiqudity, ctx: AptoswapClientTransactionContext) => {

        const gasBudget = (ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET);

        const pool = opt.pool;
        const xAmount = opt.xAmount;
        const yAmount = opt.yAmount;
        const packageAddr = this.getPackageAddress();
        const aptosCoinType = this.getPrimaryCoinType();

        let depositGasCoinAmount: bigint = BigIntConstants.ZERO;
        if (isSameCoinType(pool.type.xTokenType, aptosCoinType)) {
            depositGasCoinAmount = xAmount;
        }
        else if (isSameCoinType(pool.type.yTokenType, aptosCoinType)) {
            depositGasCoinAmount = yAmount;
        }

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, depositGasCoinAmount, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for adding liquidity");
        }

        // public entry fun add_liquidity<X, Y>(user: &signer, pool_account_addr: address, x_added: u64, y_added: u64) acquires Pool, LSPCapabilities {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::add_liquidity`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                xAmount,
                yAmount
            ]
        };

        return transaction;
    }

    _generateTransactionType_MintTestCoin = async (opt: TransactionOperation.MintTestCoin, ctx: AptoswapClientTransactionContext) => {
        const gasBudget = (ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET);

        const amount = opt.amount;
        const packageAddr = this.getPackageAddress();
        const accountAddr = ctx.accountAddr;

        const isGasEnough = await this.checkGasFeeAvaliable(accountAddr, BigIntConstants.ZERO, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for minting test coin");
        }

        // public entry fun mint_test_token(owner: &signer, amount: u64, recipient: address) acquires SwapCap, TestTokenCapabilities {}
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::mint_test_token`,
            type_arguments: [],
            arguments: [
                amount,
                ["address", accountAddr]
            ]
        };

        return transaction;
    }

    _generateTransactionType_RemoveLiquidity = async (opt: TransactionOperation.RemoveLiquidity, ctx: AptoswapClientTransactionContext) => {
        const gasBudget = ctx.gasBudget ?? AptoswapClient.DEFAULT_GAS_BUDGET;

        const positionInfo = opt.positionInfo;
        const packageAddr = this.getPackageAddress();
        const pool = positionInfo.poolInfo;
        const balance = positionInfo.balance();

        const isGasEnough = await this.checkGasFeeAvaliable(ctx.accountAddr, BigIntConstants.ZERO, gasBudget);
        if (!isGasEnough) {
            throw new Error("Not enough gas for removing liquidity");
        }

        // public entry fun remove_liquidity<X, Y>(user: &signer, pool_account_addr: address, lsp_amount: u64) acquires Pool, LSPCapabilities {
        const transaction: TransactionType = {
            function: `${packageAddr}::pool::remove_liquidity`,
            type_arguments: [pool.type.xTokenType.name, pool.type.yTokenType.name],
            arguments: [
                balance
            ]
        };

        return transaction;
    }

}