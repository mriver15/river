// The living island: how many deer, rabbits, foxes and wolves there are now, and who is about this season. The numbers come from src/sim/ecology.ts, stepped once
// an hour of world time against how much the plants are giving; what River does (hunting) changes them, and so does the year.
import { bus } from "./bus.ts";
import { cfg } from "./config.ts";
import { every, simNow } from "./sim.ts";
import { persisted } from "./persist.ts";
import { initial, step, shown, present, MODEL, type Pops } from "../sim/ecology.ts";
import type { World } from "./world.ts";

const HOUR = 60_000;

export class Ecology {
  pops: Pops = initial();
  private last = 0;

  constructor(private w: World) {
    const saved = persisted("ecology", () => ({ pops: this.pops, last: this.last }));
    if (saved) { this.pops = { ...this.pops, ...saved.pops }; this.last = saved.last; } else this.last = simNow();
    bus.on("deed", (e: { kind: string; name: string }) => { if (e.kind === "hunt" && MODEL[e.name]) this.pops[e.name] = Math.max(0, (this.pops[e.name] ?? 0) - 1); });
  }
  start() { every(HOUR / 2, () => this.tick(), "ecology"); }
  reset() { this.pops = initial(); this.last = simNow(); }

  /** How well the plants are giving: the average of what bushes and trees hold against what they can. */
  food(): number {
    let n = 0, sum = 0;
    for (const e of this.w.entities.values()) if (e.props.yields && e.props.max && (e.kind === "bush" || e.kind === "tree")) { n++; sum += Math.min(1, (e.props.stock ?? 0) / e.props.max); }
    return n ? sum / n : 0.5;
  }
  private tick() {
    if (!cfg("ecology")) { this.last = simNow(); return; }
    let hours = Math.floor((simNow() - this.last) / HOUR); if (hours <= 0) return;
    this.last += hours * HOUR; hours = Math.min(hours, 48);                                      // a long gap (the world was away) is caught up a couple of days at a time
    const env = { food: this.food(), growth: this.w.seasonRules().growth };
    for (let i = 0; i < hours; i++) this.pops = step(this.pops, env);
  }

  /** How many of this kind the world should hold right now. `base` is the number written in the species table. */
  count(key: string, base: number): number { return cfg("ecology") ? shown(this.pops, key, base) : base; }
  /** Is this kind about in this season? (With no ecology, always.) */
  here(key: string): boolean { return !cfg("ecology") || present(key, this.w.season().id); }
  view() { return { season: this.w.season(), food: +this.food().toFixed(2), pops: Object.fromEntries(Object.entries(this.pops).map(([k, v]) => [k, +v.toFixed(2)])) }; }
}

export const ecologyOf = (w: World) => (w as any).ecology as Ecology | undefined;
