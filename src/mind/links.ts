// What River is to the things it knows: how familiar, how far trusted, how attached, how feared. Attachment grows from what River
// actually does with a thing, with diminishing returns, and is never maximal just because something has a name.
export type LinkKind = "creature" | "item" | "place" | "structure" | "human";
export type Evidence = "made" | "named" | "used" | "cared" | "shared" | "met" | "repaired" | "found" | "lost";

export interface Link {
  id: string; kind: LinkKind; name: string;
  familiarity: number; trust: number; attachment: number; fear: number;
  /** simulation ms of the last encounter */
  last: number;
  evidence: { type: Evidence; at: number }[];
  /** when each kind of evidence last counted, so repetition cannot be farmed */
  counted: Partial<Record<Evidence, number>>;
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const newLink = (id: string, kind: LinkKind, name: string, now: number): Link =>
  ({ id, kind, name, familiarity: 0, trust: 0, attachment: 0, fear: 0, last: now, evidence: [], counted: {} });

const MIN = 60_000;
/** per kind of evidence: attachment gained, familiarity gained, and how long before another of the same kind counts again */
const GAIN: Record<Evidence, { att: number; fam: number; cool: number }> = {
  made: { att: 0.3, fam: 0.4, cool: Infinity }, named: { att: 0.2, fam: 0.2, cool: Infinity }, used: { att: 0.03, fam: 0.05, cool: 10 * MIN },
  cared: { att: 0.1, fam: 0.1, cool: 10 * MIN }, shared: { att: 0.012, fam: 0.03, cool: 30 * MIN }, met: { att: 0, fam: 0.06, cool: 5 * MIN },
  repaired: { att: 0.12, fam: 0.1, cool: 5 * MIN }, found: { att: 0.05, fam: 0.1, cool: Infinity }, lost: { att: 0, fam: 0, cool: Infinity },
};

/** Record something that happened between River and this subject. Returns whether it counted. */
export function grow(l: Link, ev: Evidence, now: number): boolean {
  const g = GAIN[ev], last = l.counted[ev];
  l.last = now;
  if (last !== undefined && now - last < g.cool) return false;
  l.counted[ev] = now;
  l.attachment = clamp(l.attachment + g.att * (1 - l.attachment));                 // the closer it is, the less each thing adds
  l.familiarity = clamp(l.familiarity + g.fam * (1 - l.familiarity));
  l.evidence.push({ type: ev, at: now }); if (l.evidence.length > 8) l.evidence.shift();
  return true;
}

/** How much a loss of this thing weighs in addition to what such a thing is worth in general. */
export const lossWeight = (l: Link | undefined) => (l ? l.attachment : 0);
