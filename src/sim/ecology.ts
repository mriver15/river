// Who lives on the island, and how many. A small predator-prey model stepped once an hour of world time: grazers feed on what the plants offer and are eaten
// by foxes and wolves, who in turn only thrive while there is something to eat. Populations are real numbers here; the world shows the nearest whole animals.
// Pure and deterministic: the same numbers in give the same numbers out.
import type { SeasonId } from "./seasons.ts";

export type Pops = Record<string, number>;
export interface Model {
  kind: "grazer" | "predator";
  /** how many the island can hold when the plants are lush */
  cap: number;
  /** how fast it breeds when there is room, per hour */
  rate: number;
  /** predators: what it eats, and how much it takes per hour per predator when prey is plentiful */
  eats?: Record<string, number>;
}

/** The kinds that rise and fall. `base` is how many the island has when nothing has disturbed it. */
export const BASE: Record<string, number> = { deer: 3, rabbit: 4, fox: 1, wolf: 3 };
export const MODEL: Record<string, Model> = {
  deer: { kind: "grazer", cap: BASE.deer! * 1.7, rate: 0.045 },
  rabbit: { kind: "grazer", cap: BASE.rabbit! * 1.7, rate: 0.08 },
  fox: { kind: "predator", cap: BASE.fox! * 2, rate: 0, eats: { rabbit: 0.014 } },
  wolf: { kind: "predator", cap: BASE.wolf! * 1.6, rate: 0, eats: { deer: 0.012, rabbit: 0.006 } },
};

/** Who is simply not about in a given season, whatever the numbers say. */
export const ABSENT: Record<SeasonId, string[]> = {
  spring: [], summer: [], autumn: ["firefly", "midges"], winter: ["firefly", "midges", "songbird", "bear"],
};
export const present = (key: string, season: SeasonId) => !ABSENT[season].includes(key);

/** how much of what a predator eats becomes more predators, and how fast they dwindle on their own */
const CONVERT = 0.45, STARVE = 0.01;

export interface Env { /** how much the plants are giving, 0 (bare) to 1 (lush) */ food: number; /** the season's push on grazers, per hour (negative in the lean months) */ growth: number }

/** One hour. Returns new numbers; never negative, never beyond the cap. */
export function step(pops: Pops, env: Env): Pops {
  const out: Pops = { ...pops };
  const taken: Record<string, number> = {};                                              // what each predator ate this hour, for them to grow on
  const grazers = Object.entries(MODEL).filter(([, m]) => m.kind === "grazer"), predators = Object.entries(MODEL).filter(([, m]) => m.kind === "predator");
  for (const [id, m] of grazers) {
    const n = pops[id] ?? 0, room = m.cap * (0.3 + 0.9 * Math.max(0, Math.min(1, env.food)));
    let eaten = 0;
    for (const [pid, p] of predators) { const hunters = pops[pid] ?? 0, take = (p.eats?.[id] ?? 0) * hunters * (n / (n + 1.5)); eaten += take; taken[pid] = (taken[pid] ?? 0) + take; }
    const breed = (m.rate + env.growth) * n * (1 - n / Math.max(0.5, room)), arrive = 0.003 * room * env.food;          // a few come over the water when there is plenty
    out[id] = Math.max(0, Math.min(m.cap, n + breed - eaten + arrive));
  }
  for (const [id, m] of predators) {
    const n = pops[id] ?? 0, fed = taken[id] ?? 0;
    const prey = Object.keys(m.eats ?? {}).reduce((s, k) => s + (pops[k] ?? 0), 0), arrive = prey > 1.5 ? 0.0025 * m.cap : 0;       // a few cross over when there is game
    out[id] = Math.max(0, Math.min(m.cap, n + fed * CONVERT - n * STARVE + arrive));
  }
  return out;
}

export const initial = (): Pops => ({ ...BASE });
/** The whole animals the world should show. */
export const shown = (pops: Pops, key: string, base: number): number => (MODEL[key] ? Math.max(0, Math.round(pops[key] ?? base)) : base);
