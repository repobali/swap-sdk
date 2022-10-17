# Swap SDK

`swap-sdk` is the typescript SDK for multiple swap platforms including `Aptoswap` and `Suiswap`.

## 💿 Getting Started 

To install the `swap-sdk`, simply add `@vividnetwork/swap-sdk` into your `package.json`.

```shell
npm install @vividnetwork/swap-sdk
```

Or 

```
yarn add @vividnetwork/swap-sdk
```

## 📙 Usage

You can use the `swap-sdk` to query positions, deposit, withdraw LSP tokens and swap assets with 

### `Aptoswap`

> For more detail usage demo for `Aptoswap`, please review the example in `sdk/examples/aptoswap.ts`.

The following snippet shows how to use `swap-sdk` to swap `ATP` to `tAPTS` assets on `Aptoswap`:

```typescript
import { AptoswapClient, TransactionOperation } from "@vividnetwork/swap-sdk";
import { AptosAccount } from "@vividnetwork/swap-sdk/node_modules/aptos"

const simpleSwap = async () => {
    const aptoswap = (await AptoswapClient.fromHost("https://aptoswap.net"))!;
    const packageAddr = aptoswap.getPackageAddress();
    const { pools } = await aptoswap.getCoinsAndPools();

    const pool = pools.filter(p => p.type.xTokenType.name === `${packageAddr}::pool::TestToken` && p.type.yTokenType.name === "0x1::aptos_coin::AptosCoin")[0];
    if (pool === undefined) {
        return;
    }

    const account = new AptosAccount("<your-private-key>");
    const operation: TransactionOperation.Swap = {
        operation: "swap",
        pool: pool,
        direction: "reverse",
        amount: BigInt("100000")
    };
    const result = await aptoswap.execute(operation, account, { maxGasAmount: BigInt("4000") });
    console.log(result.hash, " ", result.success);
}

simpleSwap()
```

