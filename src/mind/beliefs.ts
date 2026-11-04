// What River believes, kept as claims with evidence. A fact is something River observed; a hypothesis is something it inferred or was told.
// Claims are revised only by explicit observations; there is no inference engine here.
export interface Belief {
  id: string;
  proposition: string;
  subjects: string[];
  kind: "fact" | "hypothesis";
  /** 0..1 */
  confidence: number;
  support: string[];
  contradict: string[];
  revised: number;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const push = (a: string[], v: string) => { if (!a.includes(v)) { a.push(v); if (a.length > 12) a.shift(); } };

export function assertBelief(prev: Belief | undefined, o: { id: string; proposition: string; subjects: string[]; kind: Belief["kind"]; confidence: number; obs: string; now: number }): Belief {
  if (prev) return reviseBelief(prev, o.obs, true, o.confidence, o.now);
  return { id: o.id, proposition: o.proposition, subjects: o.subjects, kind: o.kind, confidence: clamp(o.confidence), support: [o.obs], contradict: [], revised: o.now };
}
/** An observation backs the claim or goes against it, with a weight (the observation's own confidence). */
export function reviseBelief(b: Belief, obs: string, supports: boolean, weight: number, now: number): Belief {
  if (b.support.includes(obs) || b.contradict.includes(obs)) return b;                // the same observation cannot count twice
  const w = clamp(weight);
  const confidence = supports ? clamp(b.confidence + (1 - b.confidence) * 0.6 * w) : clamp(b.confidence * (1 - 0.8 * w));
  const out = { ...b, support: [...b.support], contradict: [...b.contradict], confidence: +confidence.toFixed(4), revised: now };
  push(supports ? out.support : out.contradict, obs);
  if (supports && w >= 0.8) out.kind = "fact";
  if (!supports && out.confidence < 0.5) out.kind = "hypothesis";                    // no longer a measured fact once the evidence has turned
  return out;
}
