// Token accounting: every LLM call (agent cycles, reflection, tool smith) is recorded, persisted, and capped.
import { cfg } from "./config.ts";
import { kvGet, kvSet } from "./db.ts";

interface Rec { ts: number; inp: number; out: number; hit: number }
let recs: Rec[] = kvGet<Rec[]>("usage", []);
const HOUR = 3_600_000;

// DeepSeek bills half price off-peak (default: peak = 01:00-04:00 and 06:00-10:00 UTC on weekdays; weekends are all off-peak).
// At these prices the budget is about pacing, not money, so it stretches off-peak: the same spend buys more thinking.
const PEAK: [number, number][] = (process.env.PEAK_HOURS_UTC ?? "1-4,6-10").split(",").map((r) => r.split("-").map(Number) as [number, number]).filter((r) => r.length === 2 && !r.some(Number.isNaN));

export function isPeak(d = new Date()): boolean {
  const dow = d.getUTCDay(); if (dow === 0 || dow === 6) return false;
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return PEAK.some(([a, b]) => h >= a && h < b);
}
export const maxTokensNow = () => Math.round(cfg("tokensK") * 1000 * (isPeak() ? 1 : cfg("offpeak")));
export const maxCyclesNow = () => Math.round(cfg("cycles") * (isPeak() ? 1 : cfg("offpeak")));

export function resetUsage() { recs = []; kvSet("usage", []); }

export function record(u: any) {
  if (!u) return;
  recs.push({ ts: Date.now(), inp: u.prompt_tokens ?? 0, out: u.completion_tokens ?? 0, hit: u.prompt_cache_hit_tokens ?? 0 });
  recs = recs.filter((r) => r.ts > Date.now() - 24 * HOUR);
  kvSet("usage", recs);
}
const sum = (since: number) => recs.filter((r) => r.ts > since).reduce((a, r) => ({ inp: a.inp + r.inp, out: a.out + r.out, hit: a.hit + r.hit }), { inp: 0, out: 0, hit: 0 });

export function usageStats() {
  const h = sum(Date.now() - HOUR), d = sum(Date.now() - 24 * HOUR);
  return {
    tokensLastHour: h.inp + h.out, tokensLast24h: d.inp + d.out, maxTokensPerHour: maxTokensNow(), offPeak: !isPeak(),
    cacheHitPct: d.inp ? Math.round((d.hit / d.inp) * 100) : 0,
  };
}
export const overBudget = () => usageStats().tokensLastHour >= maxTokensNow();

/**
 * Soft limit: instead of running full speed and then stopping dead, slow down as the hour's budget fills.
 * Returns a multiplier for the pause between thought cycles.
 */
export function paceFactor(): number {
  const r = usageStats().tokensLastHour / maxTokensNow();
  const base = isPeak() ? 1 : 0.75;                  // off-peak: think a little more often
  return base * (r < 0.6 ? 1 : r < 0.85 ? 2 : 4);
}
/** ms until enough old usage ages out of the rolling hour to get back under budget */
export function msUntilUnderBudget() {
  let total = usageStats().tokensLastHour;
  for (const r of recs) { total -= r.inp + r.out; if (total < maxTokensNow() * 0.9) return Math.max(30_000, r.ts + HOUR - Date.now()); }
  return 60_000;
}
