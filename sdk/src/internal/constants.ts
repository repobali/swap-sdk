import { CoinType, NetworkType } from "./common";

export class BigIntConstants {
    static ZERO = BigInt(0);
    static ONE = BigInt(1);
    static TWO = BigInt(2);

    static _1E0 = BigInt(1);
    static _1E1 = BigInt(10 ** 1);
    static _1E2 = BigInt(10 ** 2);
    static _1E3 = BigInt(10 ** 3);
    static _1E4 = BigInt(10 ** 4);
    static _1E5 = BigInt(10 ** 5);
    static _1E6 = BigInt(10 ** 6);
    static _1E7 = BigInt(10 ** 7);
    static _1E8 = BigInt(10 ** 8);
    static _1E9 = BigInt(10 ** 9);
}

export class UiConstants {
    static DEFAULT_UNKNOWN_COIN_UI_LOGO_PATH = "/images/token/unknown-token.svg";
    static DEFAULT_UNKNOWN_WALLET_UI_LOGO_PATH = "/images/token/unknown-wallet.svg"
}

export class DateConstants {
    static MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
}

export class NumberLimit {
    static U64_MAX = BigInt("18446744073709551615");
}

export class SuiConstants {
    static SUI_COIN_NAME = "0x2::sui::SUI";
    static SUI_COIN_TYPE = {
        network: "sui" as NetworkType,
        name: SuiConstants.SUI_COIN_NAME
    } as CoinType;
}

export class AptosConstants {
    static APTOS_COIN_NAME = "0x1::aptos_coin::AptosCoin";
    static APTOS_COIN_TYPE = {
        network: "aptos" as NetworkType,
        name: AptosConstants.APTOS_COIN_NAME
    } as CoinType;
}