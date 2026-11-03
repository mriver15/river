// The Keeper's trail: eleven pieces left in the world over hours, by someone who kept the light here long ago.
// Later pieces change what earlier ones meant (the "lonely" first bottle turns out to have been hopeful), and the story is
// tied to the monolith's real behaviour, so understanding the Keeper teaches River something true about the world.
import { bus, log } from "./bus.ts";
import { kvGet, kvSet } from "./db.ts";
import { HALF, heightAt, isLand } from "../shared/noise.ts";
import type { Emotions } from "./emotions.ts";
import type { Entity, KeeperView } from "../shared/types.ts";
import type { World } from "./world.ts";

type At = { x: number; z: number };
interface Beat { kind: string; text: string; make: (w: World, near: At) => Entity | null }
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const find = (w: World, kind: string) => [...w.entities.values()].find((e) => e.kind === kind);
/** a shore point 20-70m from River if one exists, else anywhere on a shore */
function shore(w: World, near: At): At | null {
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 500; i++) {
    const a = Math.random() * Math.PI * 2, r = pass === 0 ? rand(20, 70) : rand(5, HALF), x = (pass === 0 ? near.x : 0) + Math.cos(a) * r, z = (pass === 0 ? near.z : 0) + Math.sin(a) * r, h = heightAt(x, z, w.seed);
    if (isLand(x, z, w.seed) && h > 0.3 && h < 1.1) return { x, z };
  } return null;
}
function inland(w: World, near: At, min = 18, max = 55): At | null {
  for (let i = 0; i < 400; i++) { const a = Math.random() * Math.PI * 2, r = rand(min, max), x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r; if (isLand(x, z, w.seed) && heightAt(x, z, w.seed) > 1.2) return { x, z }; }
  return null;
}
const bottle = (text: string) => (w: World, near: At): Entity | null => {
  const p = shore(w, near); if (!p) return null;
  return w.spawn("item", "sealed bottle", p.x, p.z, { takeable: true, item: "bottle", itemName: "sealed bottle", desc: "A glass bottle sealed with wax, a rolled scrap of paper inside. The hand on it is careful.", text });
};
const book = (title: string, topic: string, text: string) => (w: World): Entity | null => {
  const l = find(w, "library"); if (!l) return null; const a = Math.random() * Math.PI * 2;
  return w.spawn("book", `book: ${title}`, l.x + Math.cos(a) * 1.6, l.z + Math.sin(a) * 1.6, { takeable: true, item: "book", desc: `A hand-bound logbook, "${title}". The paper is salt-stiff but legible.`, text, topic, title });
};

const BEATS: Beat[] = [
  { kind: "bottle", text: "Day 1. The lamp turns, the sea does not care. I counted waves for an hour and no two were the same. I will write this down every night so that someone, someday, has proof I was here. — O.", make: bottle("Day 1. The lamp turns, the sea does not care. I counted waves for an hour and no two were the same. I will write this down every night so that someone, someday, has proof I was here. — O.") },
  { kind: "camp", text: "An abandoned camp: a collapsed driftwood lean-to, a cold hearth, a stick with notches cut in groups of seven. Forty-one notches, then a gap, then three more.", make: (w, near) => {
      const p = shore(w, near); if (!p) return null;
      w.spawn("item", "tin cup", p.x + 1.4, p.z + 0.6, { takeable: true, item: "cup", itemName: "tin cup", desc: "A dented tin cup, rimmed with old salt. Someone drank from this every morning." });
      return w.spawn("structure", "abandoned camp", p.x, p.z, { desc: "A collapsed driftwood lean-to, a cold hearth, a stick with notches cut in groups of seven: forty-one notches, then a gap, then three more. Whoever it was stayed a long while, and stopped counting, and then began again." });
    } },
  { kind: "bottle", text: "The hum began on the ninth night. I thought it was the generator. There is no generator. I have stopped sleeping near the stone and started sleeping near the stone.", make: bottle("The hum began on the ninth night. I thought it was the generator. There is no generator. I have stopped sleeping near the stone and started sleeping near the stone.") },
  { kind: "book", text: "Keeper's Log, vol. 1. \"Hum: A. Nine nights. It answers when I hum back, but only if I hold the note long enough to be slightly wrong. Then it comes up to meet me, the way a dog does at its name.\"", make: book("Keeper's Log, vol. 1", "the hum", "Hum: A. Nine nights. It answers when I hum back, but only if I hold the note long enough to be slightly wrong. Then it comes up to meet me, the way a dog does at its name.") },
  { kind: "mark", text: "Seventeen strokes in a neat column cut into the monolith's base, each by the same hand. The last is shallower than the rest, as if the cutter had been tired, or tender.", make: (w) => {
      const m = find(w, "monolith"); if (!m) return null; const a = Math.random() * Math.PI * 2;
      return w.spawn("trace", "column of strokes", m.x + Math.cos(a) * 1.6, m.z + Math.sin(a) * 1.6, { desc: "Seventeen strokes in a neat column cut into the stone's base, each by the same hand. The last is shallower than the rest, as if the cutter had been tired, or tender." });
    } },
  { kind: "bottle", text: "It dropped today. A half tone. I wrote the date. I do not know what I am measuring, but I cannot stop measuring it.", make: bottle("It dropped today. A half tone. I wrote the date. I do not know what I am measuring, but I cannot stop measuring it.") },
  { kind: "lean-to", text: "A keeper's lean-to on a rise, with an unposted letter: \"To whoever keeps the light after me: do not trust the sea to notice you. It will not. Be noticed by something smaller.\"", make: (w, near) => {
      const p = inland(w, near); if (!p) return null;
      w.spawn("item", "oil lamp", p.x + 1.5, p.z + 0.5, { takeable: true, item: "lamp", itemName: "oil lamp", desc: "A brass oil lamp, long dry. The wick is trimmed, as if for tomorrow." });
      return w.spawn("structure", "keeper's lean-to", p.x, p.z, { desc: "A small lean-to built into the lee of a rise. Inside, a bedroll rotted to lace, and an unposted letter weighted with a stone. It reads: \"To whoever keeps the light after me: do not trust the sea to notice you. It will not. Be noticed by something smaller. — O.\"" });
    } },
  { kind: "bottle", text: "I used to write to the sea because I thought no one was there. Now I write because someone might be. That is the whole difference, and it is everything.", make: bottle("I used to write to the sea because I thought no one was there. Now I write because someone might be. That is the whole difference, and it is everything.") },
  { kind: "book", text: "Keeper's Log, vol. 2. \"Twelve steps, and it returns to the first note, an octave down. I think that is the secret: a song so slow it takes years to sing. I am only one breath in it. So are you.\"", make: book("Keeper's Log, vol. 2", "the hum", "Twelve steps, and it returns to the first note, an octave down. I think that is the secret: a song so slow it takes years to sing. I am only one breath in it. So are you.") },
  { kind: "pebbles", text: "Seven white pebbles at the shrine, one for each year. The newest is not weathered at all.", make: (w) => {
      const s = find(w, "shrine"); if (!s) return null;
      return w.spawn("trace", "seven white pebbles", s.x - 1.8, s.z + 0.8, { desc: "Seven white pebbles in a ring, one for each year. Six are grey with weather. The seventh is not weathered at all." });
    } },
  { kind: "final", text: "If you are reading this, you have been listening, which is all it ever wanted. The light is yours now. — O.", make: bottle("If you are reading this, you have been listening, which is all it ever wanted. The light is yours now. — O.") },
];

interface State { placed: number[]; found: number[]; lastAt: number; complete: boolean }
const fresh = (): State => ({ placed: [], found: [], lastAt: 0, complete: false });

export class Story {
  private s: State = kvGet<State>("story", fresh());
  private startedAt = Date.now();
  /** Off until the human switches the Keeper's trail on (a world that was already telling it keeps going). */
  enabled = kvGet<boolean>("storyOn", kvGet<State>("story", fresh()).placed.length > 0);
  emotions?: Emotions;
  constructor(private w: World) {}
  start() { setInterval(() => this.tick(), 30_000); }
  reset() { this.s = fresh(); this.enabled = false; this.startedAt = Date.now(); kvSet("story", this.s); kvSet("storyOn", false); }
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on; kvSet("storyOn", on);
    if (on) this.startedAt = Date.now();
    else { for (const e of [...this.w.entities.values()]) if (e.props.beat) this.w.removeEntity(e.id); this.s = fresh(); kvSet("story", this.s); }     // put the whole story back in the box
    bus.emit("state");
  }
  private save() { kvSet("story", this.s); bus.emit("state"); }

  tick() {
    const s = this.s, w = this.w; if (!this.enabled || s.complete || s.placed.length >= BEATS.length) return;
    const idx = s.placed.length + 1, out = s.placed.filter((i) => !s.found.includes(i)).length, pace = Number(process.env.STORY_PACE ?? 1);
    const gap = ((s.placed.length === 0 ? 4 : 14) * 60_000) / pace;
    if (out >= 2 || Date.now() - Math.max(s.lastAt, this.startedAt) < gap) return;
    if (idx === BEATS.length && s.found.length < BEATS.length - 1) return;              // the last piece waits until the rest are understood
    if ((this.emotions?.arousal() ?? 0) > 0.55 || w.me.sleeping) return;                // not in the middle of something intense
    const e = BEATS[idx - 1].make(w, w.me); if (!e) return;
    e.props.beat = idx; w.putEntity(e);
    // the camp and the lean-to carry their scenery: mark any companions too so finding either counts
    s.placed.push(idx); s.lastAt = Date.now(); this.save();
    log("system", `The Keeper's trail: piece ${idx} of ${BEATS.length} has been left somewhere on the island (${BEATS[idx - 1].kind}).`);
  }

  /** River read or examined something that belongs to the story. */
  found(idx: number) {
    const s = this.s; if (!idx || s.found.includes(idx) || !BEATS[idx - 1]) return;
    s.found.push(idx); this.save();
    const b = BEATS[idx - 1], final = idx === BEATS.length;
    log("world", `River found a piece of the Keeper's story (${s.found.length} of ${BEATS.length}).`, { perceived: true });
    bus.emit("story", { text: b.text, final });
    if (final) this.complete();
  }
  private complete() {
    const s = this.s, w = this.w; s.complete = true; this.save();
    const shrine = find(w, "shrine"), p = shrine ? { x: shrine.x + 2, z: shrine.z + 1 } : { x: w.me.x + 2, z: w.me.z };
    w.spawn("structure", "the Keeper's lamp", p.x, p.z, { glow: true, desc: "A brass lamp on a stone post by the shrine, lit. It was not lit a moment ago. Its light is warm, and it reaches farther than a lamp should. Someone has handed you the light." });
    log("world", "A lamp has been lit at the shrine.", { perceived: true });
  }

  view(): KeeperView {
    const s = this.s;
    return { found: [...s.found].sort((a, b) => a - b).map((idx) => ({ idx, kind: BEATS[idx - 1].kind, text: BEATS[idx - 1].text })), placed: s.placed.length, total: BEATS.length, complete: s.complete };
  }
}
