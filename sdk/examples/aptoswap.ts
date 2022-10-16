// import { debugLog } from '../src/debug';
import { AptoswapClient, CoinType, isSameCoinType, PoolInfo, TransactionOperation } from "../src";
import { AptosAccount } from "aptos";
import { Log } from "./excommon"

import fs from "fs"
import yaml from "yaml"

const prompt_ = require('prompt-sync')();
const prompt = (s: string, default_?: string): string => {
    const i = prompt_(s + ((default_ !== undefined) ? ` [default: ${default_}]: ` : ": "));
    if (default_ !== undefined && i.trim().length === 0) {
        return default_;
    }
    return i;
}

const hexToBytes = (hex: string) => {
    console.log(hex);
    let bytes: number[] = [];
    for (let c = (hex.startsWith("0x") ? 2 : 0); c < hex.length; c += 2) {
        const b = hex.slice(c, c + 2);
        bytes.push(parseInt(b, 16));
    }
    return new Uint8Array(bytes);
}

const readAccount = (path: string, profile: string = "default") => {
    const ymlContent = fs.readFileSync(path, { encoding: 'utf-8' });
    const result = yaml.parse(ymlContent);

    if (!result.profiles) {
        return null;
    }

    if (!result.profiles[profile]) {
        return null;
    }

    const pf = result.profiles[profile];
    const accountPrivateKey = hexToBytes(pf.private_key);
    const accountAddress = pf.account;
    const account = new AptosAccount(accountPrivateKey, accountAddress);
    return account;
};

const getDecimalForCoinType = async (aptoswap: AptoswapClient, c: CoinType) => {
    const info: any = (await aptoswap.getAptosClient().getAccountResource(c.name.split("::")[0], `0x1::coin::CoinInfo<${c.name}>`)).data;
    const decimal: number = Number(info.decimals) ?? 0;
    return decimal;
}

const main = async () => {

    const host = "https://aptoswap.net";

    const aptoswap = await AptoswapClient.fromHost(host);
    if (aptoswap === null) {
        Log.error(`Cannot get aptoswap from ${host}`)
        return;
    }

    const { coins, pools } = await aptoswap.getCoinsAndPools();

    console.log("Avaliable Coins: ");
    console.log("========================================================");
    console.log(
        coins.map((c, index) => `    ${index}: ${c.name}`).join("\n")
    );
    console.log("========================================================");
    console.log("");

    console.log("Avaliable Pools: ");
    console.log("========================================================");
    console.log(
        pools
            .filter(p => p.isAvaliableForSwap())
            .map((p, index) => `   ${index}: ${p.type.xTokenType.name}/${p.type.yTokenType.name}[${p.x}/${p.y}]`).join("\n")
    )
    console.log("========================================================");
    console.log("");

    const operationType = prompt("Select the operation you want to continue [swap | deposit | withdraw | mint-test-coin]", "").toLocaleLowerCase().trim();
    if (operationType.trim() === "") {
        return;
    }
    else if (["swap", "deposit", "withdraw", "mint-test-coin"].indexOf(operationType)) {
        Log.error(`Invalid opeartion type: ${operationType}`);
    }

    const configPath = prompt("Please enter the config.yaml", "./.aptos/config.yaml");
    if (!fs.existsSync(configPath)) {
        Log.error(`config.yaml in "${configPath}" not exists`);
        return;
    }

    const account = readAccount(configPath, "default");
    if (account === null) {
        Log.error("Cannot get the account from config.yaml");
        return;
    }

    const accountCoins = await (aptoswap.getAccountCoins(account.address().toString()));

    if (operationType === "swap") {
        const sourceTokenIndex = prompt("Please enther the source token INDEX you want to swap from", "").trim();
        const destinationTokenIndex = prompt("Please enther the destination token INDEX you want to swap to", "").trim()
        if (sourceTokenIndex === "" || destinationTokenIndex === "") {
            Log.error("Invalid token index");
            return;
        }

        const sourceTokenType: CoinType = coins[Number(sourceTokenIndex)];
        const destinationTokenType: CoinType = coins[Number(destinationTokenIndex)];
        const sourceTokenName =sourceTokenType.name; 
        const destinationTokenName = destinationTokenType.name;

        const sourceTokenDecimal: number = await getDecimalForCoinType(aptoswap, sourceTokenType);

        const sourceTokenCoins = (accountCoins.filter(c => c.type.name === sourceTokenName && c.balance > BigInt(0)));
        if (sourceTokenCoins.length === 0) {
            Log.error("Cannot find the source token coin to swap to");
            return;
        }

        // For aptos, there's only one coin
        const sourceTokenCoin = sourceTokenCoins[0];
        const amountUiStr = prompt(`Please enther the input amount you want to swap to (max: ${Number(sourceTokenCoin.balance) / (10 ** sourceTokenDecimal)})`, "").trim();

        let amount: bigint = BigInt(0);
        if (amountUiStr.startsWith("[absolute]")) {
            amount = BigInt(amountUiStr.slice("[absolute]".length));
        }
        else {
            const amountUi = Number(amountUiStr);
            if (amountUi <= 0.0 || isNaN(amountUi)) {
                Log.error("Invalid amount input");
                return;    
            }        
            // Getting the actual amount
            amount = BigInt(Math.floor(amountUi * (10 ** sourceTokenDecimal)));
        }

        if (amount <= BigInt(0)) {
            Log.error("Invalid amount input");
            return;    
        }

        let pool: PoolInfo | null = null;
        for (const p of pools) {
            if (p.isCapableSwappingForCoins(sourceTokenType, destinationTokenType)) {
                pool = p;
                break;
            }
        }

        if (pool === null) {
            Log.error("Cannot find the direct pool for swapping");
            return;
        }

        const opeartion: TransactionOperation.Swap = {
            operation: "swap",
            pool: pool,
            direction: pool.getSwapDirection(sourceTokenType, destinationTokenType)!,
            amount: amount
        };

        const result = await aptoswap.execute(opeartion, account, { maxGasAmount: BigInt(4000) });
        console.log("Swap Result: ");
        console.log("========================================================");
        console.log(`Hash: ${result.hash}`);
        console.log(`Success: ${result.success}`);
        console.log(`Gas Used: ${result.gas_used}`);
        if (result.success) {
            const swapTokenEvents = result.events.filter(e => e.type.endsWith("pool::SwapTokenEvent"));
            if (swapTokenEvents.length > 0) {
                const swapTokenEvent = swapTokenEvents[0];
                const inAmount = BigInt(swapTokenEvent.data.in_amount);
                const outAmount = BigInt(swapTokenEvent.data.out_amount);
                console.log(`Swap: -${inAmount}[${sourceTokenName}] / +${outAmount}[${destinationTokenName}]`)
            }
        }
        console.log("========================================================");
        console.log("");
    }
    else if (operationType === "mint-test-coin") {
        const operation: TransactionOperation.MintTestCoin = {
            operation: "mint-test-coin",
            amount: BigInt("1000000000")
        };

        const result = await aptoswap.execute(operation, account, { maxGasAmount: BigInt(4000) });

        console.log("Mint Test Coin Result: ");
        console.log("========================================================");
        console.log(`Hash: ${result.hash}`);
        console.log(`Success: ${result.success}`);
        console.log(`Gas Used: ${result.gas_used}`);
        console.log("========================================================");
        console.log("");
    }
    else if (operationType === "deposit") {
        const poolIndex = Number(prompt("Please select the pool index the your want to deposit", "").trim());
        const pool = pools[poolIndex];

        if (!pool.isInitialized()) {
            Log.error("Pool is not initialized");
            return;
        }
        
        const xDecimal = await getDecimalForCoinType(aptoswap, pool.type.xTokenType);
        const yDecimal = await getDecimalForCoinType(aptoswap, pool.type.yTokenType);

        const xCoins = accountCoins.filter(c => isSameCoinType(c.type, pool.type.xTokenType));
        const yCoins = accountCoins.filter(c => isSameCoinType(c.type, pool.type.yTokenType));
        if (xCoins.length === 0 || yCoins.length === 0) {
            Log.error("One of you holding coin's balance is zero");
            return;
        }

        const xCoin = xCoins[0];
        const yCoin = yCoins[0];
        const [xMaxAmount, yMaxAmount] = pool.getDepositAmount(xCoin.balance, yCoin.balance);
        if (xMaxAmount <= BigInt(0) || yMaxAmount <= BigInt(0)) {
            Log.error("Insufficient max balacne to deposit to the pool");
            return;
        }

        const xMaxAmountUi = Number(xMaxAmount) / (10 ** xDecimal);
        const yMaxAmountUi = Number(yMaxAmount) / (10 ** yDecimal);

        console.log(`The max amount you could deposit is ${xMaxAmountUi}/${yMaxAmountUi}[${xMaxAmount}/${yMaxAmount}]`);

        const ratio = Number(prompt("Please enter the ratio to deposit between 0.0 to 1.0", "0.01").trim());
        if (!(ratio > 0.0 && ratio <= 1.0)) {
            Log.error("Invalid ratio input");
            return;
        }

        const ratioE8 = BigInt(ratio * 10000000)
        const xAmount = BigInt(xMaxAmount * ratioE8) / BigInt("10000000");
        const yAmount = BigInt(yMaxAmount * ratioE8) / BigInt("10000000");
        if (xMaxAmount <= BigInt(0) || yMaxAmount <= BigInt(0)) {
            Log.error("Insufficient balacne to deposit to the pool");
            return;
        }

        const operation: TransactionOperation.AddLiqudity = {
            operation: "add-liqudity",
            pool: pool,
            xAmount: xAmount,
            yAmount: yAmount
        };

        const result = await aptoswap.execute(operation, account, { maxGasAmount: BigInt(4000) });

        console.log("Deposit Result: ");
        console.log("========================================================");
        console.log(`Hash: ${result.hash}`);
        console.log(`Success: ${result.success}`);
        console.log(`Gas Used: ${result.gas_used}`);
        if (result.success) {
            const liquidityEvents = result.events.filter(e => e.type.endsWith("pool::LiquidityEvent"));
            if (liquidityEvents.length > 0) {
                const liquidityEvent = liquidityEvents[0];
                const inAmount = BigInt(liquidityEvent.data.x_amount);
                const outAmount = BigInt(liquidityEvent.data.y_amount);
                const lspAmount = BigInt(liquidityEvent.data.lsp_amount);
                console.log(`Deposit: -${inAmount}[${pool.type.xTokenType.name}] / +${outAmount}[${pool.type.yTokenType.name}]`);
                console.log(`Deposit: +${lspAmount}[${aptoswap.getPackageAddress()}pool::LSP<${pool.type.xTokenType.name}, ${pool.type.yTokenType.name}>]`);
            }
        }
        console.log("========================================================");
        console.log("");
    }
    else if (operationType === "withdraw") {
        const positions = aptoswap.getAccountPositionInfos(pools, accountCoins);
        console.log("Avaliable Positions: ");
        console.log("========================================================");
        console.log(
            positions.map((p, index) => `    ${index}: ${p.poolInfo.type.xTokenType.name}/${p.poolInfo.type.yTokenType.name}  [${p.balance()}]`).join("\n")
        );
        console.log("========================================================");
        console.log("");

        const positionIndex = Number(prompt("Please select the position index the your want to withdraw", "").trim());
        const position = positions[positionIndex];
        const pool = position.poolInfo;

        const operation: TransactionOperation.RemoveLiquidity = {
            operation: "remove-liqudity",
            positionInfo: position
        };

        const result = await aptoswap.execute(operation, account, { maxGasAmount: BigInt(4000) });

        console.log("Withdraw Result: ");
        console.log("========================================================");
        console.log(`Hash: ${result.hash}`);
        console.log(`Success: ${result.success}`);
        console.log(`Gas Used: ${result.gas_used}`);
        if (result.success) {
            const liquidityEvents = result.events.filter(e => e.type.endsWith("pool::LiquidityEvent"));
            if (liquidityEvents.length > 0) {
                const liquidityEvent = liquidityEvents[0];
                const inAmount = BigInt(liquidityEvent.data.x_amount);
                const outAmount = BigInt(liquidityEvent.data.y_amount);
                const lspAmount = BigInt(liquidityEvent.data.lsp_amount);
                console.log(`Withdraw: +${inAmount}[${pool.type.xTokenType.name}] / +${outAmount}[${pool.type.yTokenType.name}]`);
                console.log(`Withdraw: +${lspAmount}[${aptoswap.getPackageAddress()}pool::LSP<${pool.type.xTokenType.name}, ${pool.type.yTokenType.name}>]`);
            }
        }
        console.log("========================================================");
        console.log("");
    }

}

main()