export const errorAndExit = (s: string) => {
    console.log(`[ERROR] ${s}`);
    process.exit(1);
}