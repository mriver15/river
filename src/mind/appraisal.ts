// How an event becomes a feeling, as arithmetic. Pure and deterministic: the same factors always give the same amount, and every
// multiplier is returned so the result can explain itself. The coefficients are gameplay design parameters, not psychology.

/** What bears on how strongly an event lands. Each is 0..1. */
export interface Factors {
  /** 1 the first time, falling as the same kind of thing recurs (see habituate) */
  novelty: number;
  /** how directly it touches what River is doing or cares about, from explicit links */
  relevance: number;
  /** River's attachment to the subject */
  attachment: number;
  /** how far it differs from what River believed */
  expectationError: number;
  /** how much River could have done about it */
  controllability: number;
  /** how much River itself caused it */
  responsibility: number;
  /** how exposed River's body is just now (hurt, tired, cold) */
  vulnerability: number;
}
export const NO_FACTORS: Factors = { novelty: 0, relevance: 0.35, attachment: 0, expectationError: 0, controllability: 0.5, responsibility: 0, vulnerability: 0 };
export type EventNature = "threat" | "loss" | "gain" | "neutral";

export interface Appraised { amount: number; parts: { name: string; mult: number }[] }
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const fin = (v: number) => (Number.isFinite(v) ? v : 0);

/**
 * How much feeling an event of strength `base` produces. `hab` is the habituation multiplier (1 for something never met).
 * `carry` is the arousal already in the body, which colours what comes next.
 */
export function appraiseAmount(base: number, f: Factors, nature: EventNature, hab: { f: number; first: boolean }, carry = 1): Appraised {
  const parts: Appraised["parts"] = [];
  let m = 1;
  const mul = (name: string, v: number) => { v = fin(v); if (Math.abs(v - 1) > 1e-9) parts.push({ name, mult: +v.toFixed(3) }); m *= v; };
  mul("habituation", hab.f);
  mul("first time", hab.first ? 1.4 : 1);
  mul("relevance", 0.7 + 0.8 * clamp(f.relevance));
  mul("attachment", 1 + 0.9 * clamp(f.attachment));
  mul("expectation error", 1 + 0.6 * clamp(f.expectationError));
  mul("vulnerability", 1 + 0.4 * clamp(f.vulnerability));
  mul("arousal carry-over", carry);
  if (nature === "threat") mul("controllability", 1 - 0.35 * clamp(f.controllability));
  if (nature === "loss") mul("responsibility", 1 + 0.3 * clamp(f.responsibility));
  const amount = clamp(fin(base * m), 0, Math.min(0.9, Math.max(0, base) * 3));
  return { amount, parts };
}

/** Feelings fade by half-life in simulated seconds. Never negative, never non-finite. */
export function decay(level: number, dtSec: number, halfLifeSec: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (!Number.isFinite(halfLifeSec)) return clamp(level);           // loneliness does not fade by itself; its causes ease it
  const v = level * Math.pow(0.5, Math.max(0, dtSec) / halfLifeSec);
  return v < 0.01 ? 0 : clamp(v);
}

export interface Habit { n: number; t: number }
/** The tenth meteor is not the first. The count of recent encounters halves every `halfLifeMs`, so familiarity fades and force returns. */
export function habituate(prior: Habit | undefined, nowMs: number, halfLifeMs: number): { f: number; first: boolean; next: Habit } {
  const eff = prior ? prior.n * Math.pow(0.5, Math.max(0, nowMs - prior.t) / halfLifeMs) : 0;
  return { f: 1 / (1 + 0.7 * eff), first: !prior, next: { n: eff + 1, t: nowMs } };
}

/** A habituation key that keeps different things apart: the class of event, and the subject or place it was about. */
export const habitKey = (cls: string, subject?: string, context?: string) => [cls, subject, context].filter(Boolean).join(":");
