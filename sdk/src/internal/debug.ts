import util from "util"

export const debugFormat = (s: any) => {
    return util.inspect(s, {showHidden: false, depth: null, colors: false});
}

// From: https://stackoverflow.com/questions/10729276/how-can-i-get-the-full-object-in-node-jss-console-log-rather-than-object
export const debugLog = (s: any, title: string | null = null) => {
    const detail = debugFormat(s);
    if (title !== null) {
        console.log(`[${title}]:\n${detail}`)
    }
    else {
        console.log(detail);
    }
};