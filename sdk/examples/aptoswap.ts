// import { debugLog } from '../src/debug';
import { AptoswapClient } from "../src";
import { errorAndExit } from "./excommon"
// import { SuiConstants } from '../src/constants';
// import { CommonTransaction, DepositTransactionData, PoolDirectionType, PoolType, SwapTransactionData, WithdrawTransactionData } from '../src/common';

const main = async () => {

    const host = "https://aptoswap.net";
    const aptoswap = await AptoswapClient.fromHost(host);

    if (aptoswap === null) {
        errorAndExit(`Cannot get aptoswap from ${host}`);
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
        pools.map((p, index) => `   ${index}: ${p.type.xTokenType.name}/${p.type.yTokenType.name}[${p.x}/${p.y}]`).join("\n")
    )
    console.log("========================================================");
}

main()