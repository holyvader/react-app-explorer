/** `3 routes`, `1 route`; `word: true` gives the word alone (`routes`), when something goes between. */
export const plural = (n: number, word: string, opts?: { word: true }) => (opts?.word ? "" : `${n} `) + (n === 1 ? word : `${word}s`);
