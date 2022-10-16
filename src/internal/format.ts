import { DateConstants } from "./constants";

export function middleEllipsis(
    txt: string | null,
    maxLength = 14,
    maxLengthBeginning?: number
) {
    if (!txt) {
        return '';
    }
    if (txt.length < maxLength + 3) {
        return txt;
    }
    let beginningLength = maxLengthBeginning || Math.ceil(maxLength / 2);
    if (beginningLength >= maxLength) {
        beginningLength = Math.ceil(maxLength / 2);
        // eslint-disable-next-line no-console
        console.warn(
            `[useMiddleEllipsis]: maxLengthBeginning (${maxLengthBeginning}) is equal or bigger than maxLength (${maxLength})`
        );
    }
    const endingLength = maxLength - beginningLength;
    return `${txt.substring(0, beginningLength)}...${txt.substring(
        txt.length - endingLength
    )}`;
}

export const truncateNumeric = (s: string, width: number) => {
    return (s.length > width) ? s.slice(0, width) : s;
}


export const formatNumeric = (ss: string, width?: number) => {
    let s = ss.slice();

    // Remove leading 0000
    s = s.replace(/^0+/, '');
    if (s.indexOf('.') > -1) {
        // Remove trailign .000000000
        s = s.replace(/0+$/, '')
    }
    // Appending 0 before .
    if (s.length > 0 && s[0] === '.') {
        s = '0' + s;
    }
    s = (s === '') ? '0' : s;
    // Trim width
    if (width !== undefined && s.length > width) {
        s = s.slice(0, width);
    }
    // Remove "."
    if (s.slice(-1) === ".") {
        s = s.slice(0, -1);
    }
    return s;
}

const pad = (num: number, size: number) => {
    let num_ = num.toString();
    while (num_.length < size) num_ = "0" + num_;
    return num_;
}

export const formatTimestamp = (timestamp: number) => {
    const n = new Date(timestamp * 1000.0);
    const y = n.getFullYear();
    const m = DateConstants.MONTH_NAMES[n.getMonth()];
    const d = pad(n.getDate(), 2);
    const h = pad(n.getHours(), 2);
    const mi = pad(n.getMinutes(), 2);
    const s = pad(n.getSeconds(), 2);
    return `${d} ${m} ${y} ${h}:${mi}:${s}`;
}