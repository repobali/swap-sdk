export const groupBy = <T, K extends keyof any>(arr: T[], key: (i: T) => K) =>
    arr.reduce((groups, item) => {
        (groups[key(item)] ||= []).push(item);
        return groups;
    }, {} as Record<K, T[]> as Record<K, T[]>
);

export const bigintPow = (a: bigint, b: number) => {
    return Array(b).fill(BigInt(a)).reduce((a, b) => a * b, BigInt(1));
}