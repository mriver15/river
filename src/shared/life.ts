// What a life amounted to: counted from the records, not written by a model. Shown when River dies, and (as "so far") while it lives.
export interface Achievement { id: string; title: string; text: string; icon: string }
export interface LifeSummary {
  name: string;
  /** which life this was, counting from 1 */
  life: number;
  alive: boolean;
  /** simulation ms at birth and at the end (or now) */
  born: number; end: number;
  /** how long, in canonical days (a day is 24 minutes of world time), and as words */
  days: number; lived: string;
  dayBorn: number; dayEnd: number; nights: number;
  cause: string; place: { x: number; z: number } | null;
  epitaph: string;
  numbers: { label: string; value: number; note?: string }[];
  achievements: Achievement[];
  built: { name: string; shape: string }[];
  crafted: { name: string; qty: number }[];
  hunted: { species: string; n: number }[];
  fished: number;
  gathered: number;
  tools: { requested: number; granted: number; forged: string[]; mostUsed: { name: string; n: number }[] };
  discoveries: { firsts: string[]; places: string[]; things: { kind: string; n: number }[]; colours: string[]; keeperPieces: number };
  music: string[];
  wrote: { journal: number; lastEntry: string | null };
  bonds: { name: string; species: string; trust: number; alive: boolean }[];
  feelings: { emotion: string; peak: number; why: string }[];
  desiresDone: string[];
  moments: { title: string; intensity: number }[];
}
