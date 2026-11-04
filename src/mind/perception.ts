// What River can know of an event. A thing happening is not a thing River observed: it has to be in range, in light, awake, or loud.
// Pure functions; the server supplies the observer's situation. No occlusion is modelled yet.

export type Modality = "sight" | "hearing" | "contact" | "body" | "told" | "remains";
export interface Observer { x: number; z: number; asleep: boolean; sightRadius: number; /** 1 in quiet air, less in storm and rain */ hearing: number }
/** How an event can reach a senser. */
export interface Signature {
  at?: { x: number; z: number };
  /** metres the sound carries in quiet air; 0 or absent: silent */
  loudness?: number;
  /** seen if in range; false for things that make no visible mark */
  visible?: boolean;
  /** it happened to River's own body or hands */
  contact?: boolean;
}
export interface Sense { modality: Modality; confidence: number }

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Sight, then hearing, then direct contact: the best channel that reaches River, or null if none does. */
export function sense(sig: Signature, o: Observer): Sense | null {
  if (sig.contact) return { modality: "contact", confidence: 1 };
  if (!sig.at) return null;
  const d = dist(sig.at, o);
  if (sig.visible !== false && !o.asleep && d <= o.sightRadius) return { modality: "sight", confidence: +(1 - 0.4 * (d / o.sightRadius)).toFixed(3) };
  const range = (sig.loudness ?? 0) * o.hearing * (o.asleep ? 0.4 : 1);
  if (range > 0 && d <= range) return { modality: "hearing", confidence: +(0.35 + 0.35 * (1 - d / range)).toFixed(3) };      // heard, not seen: where and what are uncertain
  return null;
}

export interface Observation {
  id: string;            // the event it came from, which is also the key that stops it being appraised twice
  subject: string;
  modality: Modality;
  confidence: number;
  tick: number;
  fact: string;
  /** learned later than it happened */
  late: boolean;
}
