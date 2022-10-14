// import { debugLog } from '../src/debug';
import { AptoswapClient, CoinType, PoolInfo, TransactionOperation } from "../src";
import { Log } from "./excommon"
import { AptosAccount } from "aptos";

import fs from "fs"
import yaml from "yaml"

const prompt_ = require('prompt-sync')();
const prompt = (s: string, default_?: string): string => {
    const i = prompt_(s + (default_ !== undefined) ? `[default: ${default_}]` : "");
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

    const operationType = prompt("Select the operation you want to continue [swap/deposit/withdraw/mint-test-token]", "").toLocaleLowerCase().trim();
    if (operationType.trim() === "") {
        return;
    }
    else if (["swap", "deposit", "withdraw", "mint-test-token"].indexOf(operationType)) {
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

    if (operationType === "swap") {
        const sourceTokenName = prompt("Please enther the source token type you want to swap from", "");
        const destinationTokenName = prompt("Please enther the source token type you want to swap to", "");
        const amount = Number(prompt("Please enther the source token amount you want to swap to", ""));

        if (amount <= 0.0 || isNaN(amount)) {
            Log.error("Invalid amount input");
            return;
        }

        const sourceTokenType: CoinType = { network: "aptos", name: sourceTokenName };
        const destinationTokenType: CoinType = { network: "aptos", name: destinationTokenName };

        let pool: PoolInfo | null = null;
        for (const p of pools) {
            if (p.isAvaliableForSwap() && p.isCapableSwappingForCoins(sourceTokenType , destinationTokenType)) {s
                pool = p;
            }
            break;
        }

        if (pool === null) {
            Log.error("Cannot find the direct pool for swapping");
            return;
        }

        // TODO
        // const swapOpt: TransactionOperation.Swap = {
        //     operation: "swap",
        //     pool: pool,
        //     direction: pool.ggetSwappingDirectionForCoins(sourceTokenType, destinationTokenType)!,
        // }
    }

}

main()