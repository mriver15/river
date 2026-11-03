// Life generations. Anything slow (a model answer, an embedding, a dream) remembers the generation it started in and is
// discarded if a reset or a death has begun a new one, so a late answer can never act on the wrong life.
import { kvGet, kvSet } from "./db.ts";
import { log } from "./bus.ts";

let gen = kvGet<number>("lifeGen", 0);
export const lifeGen = () => gen;
export const isStale = (g: number) => g !== gen;
/** Begin a new generation. Returns it. */
export function beginGeneration(): number { gen++; kvSet("lifeGen", gen); return gen; }
/** A reset wipes the key-value table; write the counter back. */
export const persistGeneration = () => kvSet("lifeGen", gen);
/** Note (and count) a late result that was thrown away. */
export function discarded(what: string) { discardedCount++; log("system", `Discarded a late ${what} from a previous life.`); }
let discardedCount = 0;
export const discardedTotal = () => discardedCount;
