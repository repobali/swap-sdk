export class Log {

    static _log = (prefix: string, s: string) => {
        console.log(`[${prefix}] ${s}`);
    }

    static error = (s: string) => {
        Log._log("ERROR", s);
    }
}

