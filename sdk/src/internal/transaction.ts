import { AddressType, PoolInfo, PoolDirectionType, PositionInfo } from "./common";

import { BCS as AptosBCS, TxnBuilderTypes, Types } from 'aptos';
import { bcs as SuiBCS, SuiJsonValue, MoveCallTransaction as SuiMoveCallTransaction } from '@mysten/sui.js';

export type TransacationNormalizedArgument = ["address" | "string", string] | ["u8" | "u16" | "u32" | "u64" | "u128", number | bigint];
export type TransacationArgument = string | number | bigint | TransacationNormalizedArgument;

export interface TransactionType {
    function: string;
    type_arguments: string[];
    arguments: TransacationArgument[];
}

export interface TransactionTypeSerializeContext {
    packageAddr: AddressType;
    sender: AddressType;
}

export interface TransactionOptions {
    maxGasAmount?: bigint;
    gasUnitPrice?: bigint;
    expirationSecond?: number;
}

export interface TransactionOperation_SwapProps {
    operation: "swap";
    pool: PoolInfo;
    direction: PoolDirectionType;
    amount: bigint;
    minOutputAmount?: bigint;
};

export interface TransactionOperation_AddLiqudityProps {
    operation: "add-liqudity";
    pool: PoolInfo;
    xAmount: bigint;
    yAmount: bigint;
};

export interface TransactionOperation_RemoveLiquidityProps {
    operation: "remove-liqudity";
    positionInfo: PositionInfo
}

export interface TransactionOperation_MintTestCoinProps {
    operation: "mint-test-coin";
    amount: bigint;
}

export type TransactionOperation_Any = (
    TransactionOperation_SwapProps | 
    TransactionOperation_AddLiqudityProps |
    TransactionOperation_RemoveLiquidityProps | 
    TransactionOperation_MintTestCoinProps
);

export declare namespace TransactionOperation {
    export {
        TransactionOperation_SwapProps as Swap,
        TransactionOperation_AddLiqudityProps as AddLiqudity,
        TransactionOperation_RemoveLiquidityProps as RemoveLiquidity,
        TransactionOperation_MintTestCoinProps as MintTestCoin,
        TransactionOperation_Any as Any,
    }
}

const normalizeArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
    let vs: any = v;
    if (typeof v === "string") {
        vs = (v.startsWith("0x") || v === "@" || v === "$sender")  ? ["address", v] : ["string", v];
    }
    else if (typeof v === "number") {
        vs = ["u64", v];
    }
    else if (typeof v === "bigint") {
        vs = ["u64", v];
    }
    else {
        vs = v;
    }

    // Speical hanlding for address
    if (vs[0] === "address") {
        let valueStr = vs[1].toString();

        // Use @ to replace current package addr
        if (valueStr === "@") {
           vs[1] = ctx.packageAddr;
        }
        else if (valueStr === "$sender") {
            vs[1] = ctx.sender;
        }
    }

    return vs as TransacationNormalizedArgument;
}

export class AptosSerializer {

    static _normalizArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        return normalizeArgument(v, ctx)
    }

    static normalized(v: TransactionType, ctx: TransactionTypeSerializeContext) {
        const t = {
            function: v.function.replace("@", ctx.packageAddr),
            type_arguments: v.type_arguments.map(t => t.replace("@", ctx.packageAddr)),
            arguments: v.arguments.map(arg => AptosSerializer._normalizArgument(arg, ctx)) 
        } as TransactionType;
        return t;
    }

    static toBCSArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        let vs: any = v;
        if (typeof v === "string") {
            vs = v.startsWith("0x") ? ["address", v] : ["string", v];
        }
        else if (typeof v === "number") {
            vs = ["u64", v];
        }
        else if (typeof v === "bigint") {
            vs = ["u64", v];
        }
        else {
            vs = v;
        }
    
        const tag = vs[0] as "address" | "string" | "u8" | "u16" | "u32" | "u64" | "u128";
        const value = vs[1] as (string | number | bigint);
        if (tag === "address") {
            let valueStr = value.toString();
    
            // Use @ to replace current package addr
            if (valueStr === "@") {
               valueStr = ctx.packageAddr;
            }
            else if (valueStr === "$sender") {
                valueStr = ctx.sender;
            }
    
            return AptosBCS.bcsToBytes(TxnBuilderTypes.AccountAddress.fromHex(valueStr));
        }
        else if (tag === "string") {
            return AptosBCS.bcsSerializeStr(value.toString());
        }
        else if (tag === "u8") {
            return AptosBCS.bcsSerializeU8(Number(value));
        }
        else if (tag === "u16") {
            return AptosBCS.bcsSerializeU16(Number(value));
        }
        else if (tag === "u32") {
            return AptosBCS.bcsSerializeU32(Number(value));
        }
        else if (tag === "u64") {
            return AptosBCS.bcsSerializeUint64(BigInt(value));
        }
        else if (tag === "u128") {
            return AptosBCS.bcsSerializeU128(BigInt(value));
        }
        throw Error(`[AptosSerializer] BCS serialize error on argument: ${v}`)
    }

    static toEntryFunctionPayload = (t: TransactionType, ctx: TransactionTypeSerializeContext) => {
        const t_ = AptosSerializer.normalized(t, ctx);
        return t_ as Types.EntryFunctionPayload;
    }

    // static toPayload = (t: TransactionType, ctx: TransactionTypeSerializeContext) => {
    //     const packageAddr = ctx.packageAddr;

    //     const transactionFunctionSplit = t.function.split("::");
    //     const moduleName = transactionFunctionSplit.slice(0, -1).join("::").replace("@", packageAddr);
    //     const functionName = transactionFunctionSplit.slice(-1)[0];
    
    //     const typeArguments = t.type_arguments
    //         .map(ty => ty.replace("@", ctx.packageAddr))
    //         .map(ty => new AptosTxnBuilderTypes.TypeTagStruct(AptosTxnBuilderTypes.StructTag.fromString(ty)));
    
    //     const args = t.arguments.map(x => AptosSerializer.toBCSArgument(x, ctx));
    
    //     const payload = new AptosTxnBuilderTypes.TransactionPayloadEntryFunction(
    //         AptosTxnBuilderTypes.EntryFunction.natural(
    //             moduleName,
    //             functionName,
    //             typeArguments,
    //             args
    //         )
    //     );
    
    //     return payload;
    // }

    
}

export class SuiSerializer {

    static _SERIALIZE_TRANSACTION_HAS_PREPARED = false;

    static _normalizArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        if (SuiSerializer._SERIALIZE_TRANSACTION_HAS_PREPARED === false) {
            SuiSerializer._SERIALIZE_TRANSACTION_HAS_PREPARED = true;
            if (!SuiBCS.hasType(SuiBCS.ADDRESS)) {
                SuiBCS.registerAddressType(SuiBCS.ADDRESS, 20);
            }
        }
        return normalizeArgument(v, ctx)
    }

    static toBCSArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        const vs = SuiSerializer._normalizArgument(v, ctx);
    
        const tag = vs[0];
        const value = vs[1] as (string | number | bigint);
        if (tag === "address") {    
            return SuiBCS.ser(SuiBCS.ADDRESS, value.toString()).toBytes();
        }
        else if (tag === "string") {
            return SuiBCS.ser(SuiBCS.STRING, value.toString()).toBytes();
        }
        else if (tag === "u8") {
            return SuiBCS.ser(SuiBCS.U8, value).toBytes();
        }
        else if (tag === "u16") {
            throw Error("Sui doesn't support u16 type bcs serialization");
        }
        else if (tag === "u32") {
            return SuiBCS.ser(SuiBCS.U32, value).toBytes();
        }
        else if (tag === "u64") {
            return SuiBCS.ser(SuiBCS.U64, value).toBytes();
        }
        else if (tag === "u128") {
            return SuiBCS.ser(SuiBCS.U128, value).toBytes();
        }
        throw Error(`[SuiSerializer] BCS serialize error on argument: ${v}`)
    }

    static toJsonArgument = (v: TransacationArgument, ctx: TransactionTypeSerializeContext) => {
        const vs = SuiSerializer._normalizArgument(v, ctx);

        const tag = vs[0];
        const value = vs[1];
        if (tag === "address" || tag === "string") {    
            return value.toString();
        }
        else if ("u8" || "u16" || "u32") {
            return Number(value);
        }
        else if (tag === "u64" || tag === "u128") {
            return value.toString();
        }
        throw Error(`[SuiSerializer] Json serialize error on argument: ${v}`)
    }

    static toMoveTransaction = (t: TransactionType, ctx: TransactionTypeSerializeContext, opt?: TransactionOptions,) => {
        const packageAddr = ctx.packageAddr;
    
        const transactionFunctionSplit = t.function.split("::");
        const packageObjectId = transactionFunctionSplit[0].replace("@", packageAddr);
        const module_ = transactionFunctionSplit[1];
        const function_ = transactionFunctionSplit[2];
    
        const typeArguments = t.type_arguments.map(ty => ty.replace("@", packageAddr));
        const arguments_ = t.arguments.map(arg => ( SuiSerializer.toJsonArgument(arg, ctx) as SuiJsonValue) );
    
        return {
            packageObjectId, 
            module: module_, 
            function: function_, 
            typeArguments, 
            arguments: arguments_, 
            gasBudget: opt?.maxGasAmount ?? 2000
        } as SuiMoveCallTransaction
    }
}