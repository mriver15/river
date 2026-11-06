// Ambient life: weather, wildlife, senses, and occasional strange happenings.
// Design rule: these are stimuli, never instructions. Nothing here tells River what to do or rewards any choice.
import { cfg } from "./config.ts";
import { wildSound } from "./wildlife.ts";
import { bus, log } from "./bus.ts";
import { kvGet, kvSet } from "./db.ts";
import { HALF, heightAt, isLand } from "../shared/noise.ts";
import type { Entity, FxKind, Weather } from "../shared/types.ts";
import type { Emotions } from "./emotions.ts";
import { SHY_MULT, type Creatures } from "./creatures.ts";
import type { World } from "./world.ts";
import { simNow, simRng, every, after, scheduleJob, onJob } from "./sim.ts";
import { persisted } from "./persist.ts";
import { PACKS, enabledPacks, packOfEvent } from "./packs/index.ts";
const sr = simRng("ambient");

const rand = (a: number, b: number) => a + sr() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(sr() * xs.length)];
const weighted = <T extends { weight: number }>(xs: T[]): T => { let r = sr() * xs.reduce((a, x) => a + x.weight, 0); return xs.find((x) => (r -= x.weight) < 0) ?? xs[0]; };
const isNight = (w: World) => { const t = w.worldTime(); return t < 0.23 || t > 0.78; };

// ---------- senses (also used by `look` and the per-cycle context) ----------
const WEATHER_TEXT: Record<Weather, string> = {
  clear: "clear sky", cloudy: "overcast, low grey cloud", rain: "steady rain", fog: "thick fog; the far trees are gone", storm: "a storm, wind and rain lashing", windy: "a strong, gusting wind",
};
export function sensesText(w: World): string {
  const m = w.me, sounds: string[] = [], seed = Math.floor(simNow() / 90_000);
  const water = ([["east", 1, 0], ["south", 0, 1], ["west", -1, 0], ["north", 0, -1]] as const).filter(([, dx, dz]) => !w.isLandAt(m.x + dx * 14, m.z + dz * 14)).map(([n]) => n);
  if (water.length) sounds.push(`surf to the ${water.join(" and ")}`);
  const near = (kind: string, r: number) => w.nearby(r).some(({ e }) => e.kind === kind);
  if (near("monolith", 30)) sounds.push("a low, steady hum");
  if (near("campfire", 8)) sounds.push("the crackle of the campfire");
  if (w.nearby(10).filter(({ e }) => e.kind === "tree").length >= 6 && w.weather !== "rain") sounds.push("leaves rustling");
  if (w.weather === "rain" || w.weather === "storm") sounds.push("rain on leaves and stone");
  if (w.weather === "storm") sounds.push("thunder");
  if (w.weather === "windy" || w.weather === "storm") sounds.push("wind in the branches");
  if (isNight(w)) sounds.push(["crickets", "an owl somewhere", "frogs by the water", "the night insects"][seed % 4]);
  else if (w.weather === "clear") sounds.push(["birdsong", "a woodpecker tapping", "bees in the flowers", "a distant gull"][seed % 4]);
  for (const { e } of w.nearby(14)) if (e.kind === "animal") sounds.push(wildSound(e.props.species) ?? (e.props.species === "crow" ? "a crow calling" : `a ${e.props.species} moving close by`));
  const fires = [...w.entities.values()].filter((e) => e.props.burning).map((e) => Math.hypot(e.x - m.x, e.z - m.z));
  if (fires.length) { const d = Math.min(...fires); sounds.push(d < 25 ? "the roar and crackle of a fire" : d < 70 ? "the distant crackle of burning wood" : "a faint smell of smoke on the air"); }
  const cold = m.needs.warmth < 15 ? "You are shaking with cold." : m.needs.warmth < 35 ? "You are cold." : "";
  const dark = isNight(w) && !w.lit() ? "The dark presses close; you can see only a few steps." : "";
  const sky = isNight(w) && w.weather !== "storm" && w.weather !== "fog" && w.weather !== "cloudy" ? " The moon and stars are out." : "";
  return `${[cold, dark].filter(Boolean).join(" ")}${cold || dark ? "\n" : ""}Weather: ${WEATHER_TEXT[w.weather]}.${sky} Sounds: ${[...new Set(sounds)].join(", ") || "near silence"}.`;
}

// ---------- wildlife ----------
interface Species { name: string; count: number; speed: number; shy: number; when: "day" | "night" | "any"; arrive: string; desc: string }
const SPECIES: Record<string, Species> = {
  deer: { name: "deer", count: 3, speed: 1.5, shy: 9, when: "any", arrive: "steps out of cover and lifts its head", desc: "A deer with soft brown flanks. Its ears turn toward you; it is ready to bolt." },
  rabbit: { name: "rabbit", count: 4, speed: 2.2, shy: 6, when: "any", arrive: "bolts across the grass, then freezes", desc: "A small rabbit, nose twitching, motionless the way prey can be." },
  crow: { name: "crow", count: 2, speed: 1.2, shy: 4, when: "day", arrive: "lands nearby and watches you with one eye", desc: "A glossy black crow. It seems to be studying you, rather than the other way round." },
  fox: { name: "fox", count: 1, speed: 1.8, shy: 12, when: "night", arrive: "slips along the edge of the trees", desc: "A russet fox, thin and watchful, keeping exactly one tree's distance." },
  firefly: { name: "firefly", count: 6, speed: 0.6, shy: 0, when: "night", arrive: "drift up from the grass, pale green motes of light", desc: "A small drifting light. It blinks in no pattern you can see." },
};

// ---------- strange happenings ----------
const BOTTLE_NOTES = [
  "To whoever finds this: the third lantern is not a star.",
  "I counted the tides for forty days. They no longer keep the moon's time.",
  "If the monolith is humming, do not answer it. Or do. I never decided.",
  "Is anyone there? I've been writing this letter to the sea for a long time.",
  "My name is on the back of this paper. I have forgotten how to read it.",
  "The keeper's last entry: 'I think the ships were watching me.'",
  "Seeds do better in the dark first. — a gardener",
  "I left something under the oldest tree. I no longer remember what.",
  "Today the water was warm and I understood nothing and it was fine.",
  "The map is wrong on purpose. Ask the one who drew it. (He is gone.)",
  "Three knocks from under the hill. Every full moon. Then silence.",
  "Someone should be told that the shrine is older than the island.",
  "I tried to teach a crow to carry messages. It carried this one back to me.",
];
const BOOKS: [string, string, string][] = [
  ["Notes on Moss", "moss", "Moss has no roots, only anchors. It drinks the air and keeps the oldest memory of any green thing."],
  ["Wind and Its Habits", "wind", "Wind is not a thing but a motion, like a story told. It only becomes visible when it moves something else."],
  ["The Salt Road", "salt", "Before roads there were salt roads, and before salt roads there were animal paths. All of them go to water."],
  ["A Grammar of Birds", "birds", "Birds do not sing for pleasure alone. A song is a boundary, a signature and an invitation, all at once."],
  ["Clay and Fire", "pottery", "Clay remembers every hand that shaped it until the fire makes it forget. What remains is shape."],
  ["On Being Watched", "attention", "To be observed changes the observer first. Ask anyone who has lived near a lighthouse."],
  ["The Slow Library", "libraries", "A library is a conversation between the dead and the not yet born, conducted entirely in silence."],
  ["Counting Stars", "stars", "Old sailors counted the stars not to know their number, but to learn where they were not."],
];

export interface Ctx { w: World; say: (text: string, at?: { x: number; z: number }, r?: number) => boolean; fx: (k: FxKind) => void; night: boolean; rand: (a: number, b: number) => number; pick: <T>(xs: T[]) => T }
/** What a happening does to the heart. The director uses this to build contrast: quiet after tension, surprise after calm. */
export type Tone = "calm" | "beauty" | "mystery" | "spectacle" | "tension";
const TONE: Record<string, Tone> = {
  bell: "mystery", "sea-light": "mystery", meteor: "spectacle", whale: "spectacle", flock: "beauty", smoke: "mystery", chime: "mystery", "hum-shift": "mystery",
  bottle: "mystery", driftwood: "calm", footprints: "tension", offering: "mystery", symbol: "mystery", "new-book": "mystery",
  "golden-light": "beauty", "stars-clear": "beauty", "animals-return": "calm", rustle: "tension", "dew-web": "beauty", "tide-pool": "calm", "seed-drift": "beauty",
};
/**
 * What kind of thing a happening is about. The director avoids repeating a theme, so River's interests grow out of the whole
 * environment (light, water, growth, animals, traces, messages, sound) and not out of any one object or sense.
 */
export type Theme = "sound" | "light" | "water" | "growth" | "animals" | "trace" | "message" | "material" | "self" | "place" | "pattern";
const THEME: Record<string, Theme> = {
  bell: "sound", chime: "sound", "hum-shift": "sound", rustle: "sound",
  "sea-light": "light", meteor: "light", "golden-light": "light", "stars-clear": "light", "dew-web": "light",
  whale: "water", "tide-pool": "water", "seed-drift": "growth",
  flock: "animals", "animals-return": "animals",
  footprints: "trace", offering: "trace", symbol: "trace", smoke: "trace",
  bottle: "message", "new-book": "message", driftwood: "material",
};
export interface WEvent { name: string; weight: number; when?: (c: Ctx) => boolean; run: (c: Ctx) => void }

function shorePoint(w: World) {
  for (let i = 0; i < 400; i++) {
    const a = sr() * Math.PI * 2, r = rand(14, HALF - 4), x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z, w.seed);
    if (isLand(x, z, w.seed) && h > 0.3 && h < 1.1) return { x, z };
  }
  return null;
}
const landPoint = (w: World, near?: { x: number; z: number }, spread = 40) => {
  for (let i = 0; i < 200; i++) {
    const x = (near?.x ?? 0) + rand(-spread, spread), z = (near?.z ?? 0) + rand(-spread, spread);
    if (isLand(x, z, w.seed)) return { x, z };
  }
  return { x: 0, z: 0 };
};
const find = (w: World, kind: string) => [...w.entities.values()].find((e) => e.kind === kind);
const HOUR = 3_600_000;

const EVENTS: WEvent[] = [
  { name: "bell", weight: 1, run: (c) => c.say("Far off, a single bell tolls once, twice, three times. No bell on this island that you know of.") },
  { name: "sea-light", weight: 2, when: (c) => c.night, run: (c) => c.say("Far out on the black water a small light moves slowly along the horizon, then goes out.") },
  { name: "meteor", weight: 3, when: (c) => c.night, run: (c) => { c.fx("meteor"); c.say("A streak of light crosses the sky and vanishes behind the sea."); } },
  { name: "whale", weight: 2, when: (c) => !c.night && c.w.weather !== "fog", run: (c) => c.say("Out past the surf something enormous breaks the water and exhales a plume of spray.") },
  { name: "flock", weight: 3, when: (c) => !c.night && c.w.weather === "clear", run: (c) => c.say("A great flock of birds wheels overhead, turning all at once like a single animal.") },
  { name: "smoke", weight: 1, when: (c) => !c.night, run: (c) => c.say(`A thin thread of smoke rises from beyond the sea to the ${pick(["north", "east", "south", "west"])}, as if from another shore.`) },
  { name: "chime", weight: 2, when: (c) => !!find(c.w, "library"), run: (c) => { const l = find(c.w, "library")!; c.say("From the Old Library comes a soft hollow note, as if the wind had found one of its shelves.", l, 55); } },
  { name: "hum-shift", weight: 2, when: (c) => !!find(c.w, "monolith"), run: (c) => {
      const m = find(c.w, "monolith")!; m.props.shifts = (m.props.shifts ?? 0) + 1;
      m.props.desc = m.props.desc.replace(/ The hum has changed pitch \d+ times? since.*$/, "") + ` The hum has changed pitch ${m.props.shifts} time${m.props.shifts === 1 ? "" : "s"} since the island woke.`;
      c.w.putEntity(m); c.say("The monolith's hum drops by a half tone, and holds it.", m, 70);
    } },
  { name: "bottle", weight: 3, run: (c) => {
      const p = shorePoint(c.w); if (!p) return;
      const text = pick(BOTTLE_NOTES);
      c.w.spawn("item", "sealed bottle", p.x, p.z, { takeable: true, item: "bottle", itemName: "sealed bottle", desc: "A glass bottle sealed with wax, a rolled scrap of paper inside.", text, expires: simNow() + 3 * HOUR });
      c.say(`Something small glints at the waterline to the ${c.w.compass(p)}.`, p, 45);
    } },
  { name: "driftwood", weight: 3, run: (c) => {
      const p = shorePoint(c.w); if (!p) return;
      c.w.spawn("item", "driftwood plank", p.x, p.z, { takeable: true, item: "plank", itemName: "driftwood plank", desc: "A bleached, salt-stiff plank of driftwood. Someone's boat, once.", expires: simNow() + 3 * HOUR });
      c.say(`The tide has left a pale plank of driftwood on the shore to the ${c.w.compass(p)}.`, p, 40);
    } },
  { name: "footprints", weight: 2, run: (c) => {
      const p = landPoint(c.w);
      c.w.spawn("trace", "strange footprints", p.x, p.z, { desc: "Bare footprints, a little larger than yours. They begin in the middle of the clearing and lead nowhere.", expires: simNow() + 0.5 * HOUR });
      c.say("There are footprints in the soft ground here that you do not remember making.", p, 18);
    } },
  { name: "offering", weight: 2, when: (c) => !!find(c.w, "shrine"), run: (c) => {
      const s = find(c.w, "shrine")!;
      c.w.spawn("trace", "ring of white pebbles", s.x + 1.8, s.z + 0.4, { desc: "A neat ring of white pebbles, laid at the foot of the shrine. The stones are dry.", expires: simNow() + 1 * HOUR });
      c.say("A ring of white pebbles has appeared at the foot of the shrine.", s, 22);
    } },
  { name: "symbol", weight: 2, run: (c) => {
      const rocks = [...c.w.entities.values()].filter((e) => e.kind === "rock" && !e.props.marked); if (!rocks.length) return;
      const r = pick(rocks); r.props.marked = true; r.props.desc += " A fresh spiral with a dot at its centre has been scratched into one face.";
      c.w.putEntity(r); c.say(`A spiral with a dot at its centre is scratched into the ${r.name} here. You'd swear it wasn't there before.`, r, 14);
    } },
  { name: "new-book", weight: 2, when: (c) => !!find(c.w, "library") && [...c.w.entities.values()].filter((e) => e.kind === "book").length < 16, run: (c) => {
      const l = find(c.w, "library")!;
      const have = new Set([...c.w.entities.values()].filter((e) => e.kind === "book").map((e) => e.props.title));
      const fresh = [...BOOKS, ...enabledPacks(cfg("contentPacks")).flatMap((p) => p.books ?? [])].filter(([t]) => !have.has(t)); if (!fresh.length) return;
      const [title, topic, text] = pick(fresh), a = sr() * Math.PI * 2;
      c.w.spawn("book", `book: ${title}`, l.x + Math.cos(a) * 1.8, l.z + Math.sin(a) * 1.8, { takeable: true, item: "book", desc: `A book titled "${title}". The cover is still dry.`, text, topic, title });
      c.say("There is a book in the Old Library that wasn't there before. Its cover is still dry.", l, 30);
    } },
  { name: "golden-light", weight: 2, when: (c) => !c.night, run: (c) => { c.w.weather = "clear"; kvSet("weather", { w: "clear", until: simNow() + rand(240_000, 480_000) }); c.say("The cloud breaks, and low gold light floods the island, every leaf and wet stone lit from within."); } },
  { name: "stars-clear", weight: 2, when: (c) => c.night, run: (c) => { c.w.weather = "clear"; kvSet("weather", { w: "clear", until: simNow() + rand(240_000, 480_000) }); c.say("The cloud draws back and the stars come out, thick and close, as if the sky had leaned in to look."); } },
  { name: "animals-return", weight: 2, run: (c) => {
      const me = c.w.me, a = sr() * Math.PI * 2, x = me.x + Math.cos(a) * 9, z = me.z + Math.sin(a) * 9; if (!isLand(x, z, c.w.seed)) return;
      const e = c.w.spawn("animal", "deer", x, z, { species: "deer", desc: SPECIES.deer.desc, heading: a + Math.PI, calmUntil: simNow() + 150_000 });
      c.say(`A deer steps out of the trees and stands at the edge of the clearing, simply looking at you.`, e, 20);
    } },
  { name: "rustle", weight: 3, when: (c) => c.night, run: (c) => {
      c.say("Something moves in the dark, just past where you can see.");
      scheduleJob("ambient.rustle", 28_000);       // it stays ambiguous for a while, and then it is a fox, or it is nothing
    } },
  { name: "dew-web", weight: 2, when: (c) => !c.night && c.w.worldTime() < 0.4 && c.w.weather !== "rain" && c.w.weather !== "storm", run: (c) => c.say("In the early light every spider's web on the island is strung with beads of dew, thousands of small bright constellations hung between the branches.") },
  { name: "tide-pool", weight: 2, when: (c) => !c.night && !!shorePoint(c.w), run: (c) => { const p = shorePoint(c.w)!; c.say(`The tide has drawn back far enough to leave a mirror-flat pool on the shore to the ${c.w.compass(p)}, and in it the sky is perfectly still.`, p, 70); } },
  { name: "seed-drift", weight: 2, when: (c) => !c.night && c.w.weather !== "rain", run: (c) => {
      const me = c.w.me; let first: Entity | null = null;
      for (let i = 0; i < 3; i++) {
        const a = sr() * Math.PI * 2, r = rand(6, 18), x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r; if (!isLand(x, z, c.w.seed)) continue;
        const e = c.w.spawn("sprout", "tiny sprout", x, z, { desc: "A tiny shoot where there was nothing before. A seed must have drifted here.", born: simNow(), ms: 140_000, grow: "flower", grownName: "windflower", grown: { takeable: true, item: "flower", itemName: "windflower", desc: "A pale flower that grew from a drifting seed." } });
        first ??= e;
      }
      c.say("Pale seeds drift across the clearing on the air like slow snow, and settle in the grass.", first ?? undefined, 40);
    } },
];

// Packs add their happenings to the same director, with their own tone and theme.
for (const p of PACKS) for (const e of p.events) { TONE[e.name] = e.tone; THEME[e.name] = e.theme; }

// ---------- weather ----------
const WEATHERS: { w: Weather; weight: number }[] = [{ w: "clear", weight: 38 }, { w: "cloudy", weight: 25 }, { w: "rain", weight: 16 }, { w: "fog", weight: 9 }, { w: "windy", weight: 8 }, { w: "storm", weight: 4 }];
const WEATHER_START: Record<Weather, string> = {
  clear: "The clouds thin and the sky opens.", cloudy: "Grey cloud slides in from the sea.", rain: "Rain begins, soft at first, then steady.",
  fog: "A pale fog rolls up from the water and swallows the far trees.", windy: "A strong wind picks up, bending the treetops.", storm: "The wind rises and the sky turns the colour of a bruise. Thunder, far off.",
};

export class Ambient {
  private weatherUntil = kvGet<{ until: number }>("weather", { until: 0 }).until;
  private nextEvent = 0;
  private last = new Map<string, number>();
  private noted = new Map<string, number>();
  private animalState = new Map<string, { tx: number; tz: number; wait: number }>();
  private lastPersist = 0;

  creatures?: Creatures;
  emotions?: Emotions;                // set by the server so the director can read River's heart
  private deferred = 0;
  private current = "";                 // name of the happening being run, for the log
  private recentThemes: Theme[] = [];

  constructor(private w: World, private notify: (msg: string) => void) {
    // after a scare passes, the world offers something gentle
    bus.on("relief", () => scheduleJob("ambient.relief", rand(8_000, 20_000)));
    onJob("ambient.relief", () => this.offerRelief());
    onJob("ambient.rustle", () => {       // it stayed ambiguous for a while, and now it is a fox, or it is nothing
      const fox = [...this.w.entities.values()].find((e) => e.kind === "animal" && e.props.species === "fox" && this.w.dist(e) < 45);
      this.say(fox ? "A fox's eyes catch the light for an instant, then it is gone." : "Nothing. Only the wind in the leaves, you tell yourself.");
    });
    // the director's schedule and memory, committed with the clock
    const s = persisted("ambient", () => ({ weatherUntil: this.weatherUntil, nextEvent: this.nextEvent, last: [...this.last], noted: [...this.noted], animalState: [...this.animalState], deferred: this.deferred, current: this.current, recentThemes: this.recentThemes.slice(-12), lastPersist: this.lastPersist }));
    if (s) { this.weatherUntil = s.weatherUntil; this.nextEvent = s.nextEvent; this.last = new Map(s.last); this.noted = new Map(s.noted); this.animalState = new Map(s.animalState); this.deferred = s.deferred; this.current = s.current; this.recentThemes = s.recentThemes; this.lastPersist = s.lastPersist; }
    else this.nextEvent = simNow() + rand(40_000, 120_000);
  }

  /**
   * The pacing director. Contrast is what lets a feeling register: after strain, quiet and beauty; after a long calm, something to stir the heart.
   */
  /** Avoid the same kind of happening twice running: the more of the last few were about this theme, the less likely another is. */
  private themeWeight(name: string): number {
    const th = THEME[name]; if (!th) return 1;
    return 1 / (1 + 0.9 * this.recentThemes.slice(-6).filter((x) => x === th).length);
  }
  private toneWeight(t: Tone): number {
    const emo = this.emotions; if (!emo) return 1;
    const strained = emo.arousal() > 0.55 || emo.valence() < -0.3, stale = emo.calmFor() > 12 * 60_000;
    if (strained) return t === "calm" || t === "beauty" ? 3 : t === "tension" ? 0.15 : t === "spectacle" ? 0.6 : 1;
    if (stale) return t === "tension" ? 2.5 : t === "spectacle" ? 2 : t === "mystery" ? 1.5 : t === "calm" ? 0.6 : 1;
    return 1;
  }
  /** Choose the next strange happening: what is possible now, shaped by tone (contrast with River's heart) and theme (variety). */
  pickEvent(now = simNow()): WEvent | null {
    const ctx = this.ctx();
    const ok = this.events().filter((e) => (this.last.get(e.name) ?? 0) < now - 10 * 60_000 && (!e.when || e.when(ctx)));
    return ok.length ? weighted(ok.map((x) => ({ x, weight: x.weight * this.toneWeight(TONE[x.name] ?? "mystery") * this.themeWeight(x.name) }))).x : null;
  }
  private offerRelief() {
    const ctx = this.ctx();
    const ok = this.events().filter((e) => (TONE[e.name] === "calm" || TONE[e.name] === "beauty") && (!e.when || e.when(ctx)));
    if (ok.length) { const e = weighted(ok); this.last.set(e.name, simNow()); this.current = e.name; e.run(ctx); }
  }

  /** A new world: forget schedules and creatures, then repopulate. */
  reset() {
    this.weatherUntil = 0; this.nextEvent = simNow() + rand(40_000, 120_000);
    this.last.clear(); this.noted.clear(); this.animalState.clear();
    this.syncWildlife();
  }

  start() {
    if (cfg("ambientRate") <= 0) return;
    this.expire(); this.syncWildlife();
    every(1000, () => this.slow(), "ambient.slow");
    every(500, () => this.animals(0.5), "ambient.animals");
  }

  /** Fire a named happening now (debugging / testing). */
  trigger(name: string) {
    const e = [...EVENTS, ...PACKS.flatMap((p) => p.events)].find((x) => x.name === name);
    if (e) { this.current = e.name; e.run(this.ctx()); }
    return !!e;
  }
  static eventNames = () => [...EVENTS, ...PACKS.flatMap((p) => p.events)].map((e) => e.name);
  /** The happenings in play: the built-in ones, and those of the packs that are switched on. */
  private events(): WEvent[] { return [...EVENTS, ...enabledPacks(cfg("contentPacks")).flatMap((p) => p.events)]; }
  private ctx(): Ctx { return { w: this.w, say: this.say, fx: this.fx, night: isNight(this.w), rand, pick }; }

  /** Log for the human; tell River only if it could perceive it. */
  readonly say = (text: string, at?: { x: number; z: number }, r = Infinity): boolean => {
    const m = this.w.me, perceived = !m.sleeping && (!at || Math.hypot(at.x - m.x, at.z - m.z) <= r);
    log("world", text, { perceived, tone: TONE[this.current], theme: THEME[this.current] });
    if (perceived) { this.notify(`You notice: ${text}`); bus.emit("perceived", { text }); }
    return perceived;
  };
  private fx = (kind: FxKind) => bus.emit("fx", { t: "fx", kind });

  private slow() {
    const now = simNow(), w = this.w;
    if (now >= this.weatherUntil) this.changeWeather();
    if (w.weather === "storm" && sr() < 0.03) { this.fx("lightning"); if (sr() < 0.3) bus.emit("strike"); if (sr() < 0.4) { this.say("Thunder cracks, close enough to feel in your chest."); bus.emit("loud", { text: "thunder cracked overhead" }); } }
    if (now >= this.nextEvent) {
      if (this.emotions?.absorbed() && this.deferred < 3) { this.deferred++; this.nextEvent = now + 120_000; }       // don't interrupt deep work with trivia
      else {
        this.deferred = 0; this.nextEvent = now + rand(90_000, 300_000) / cfg("ambientRate");
        const e = this.pickEvent(now); if (e) { this.last.set(e.name, now); this.current = e.name; this.recentThemes.push(THEME[e.name]); e.run(this.ctx()); }
      }
    }
    this.expire();
    if (Math.floor(now / 1000) % 20 === 0) this.syncWildlife();
  }

  private changeWeather() {
    const w = this.w, prev = w.weather;
    const emo = this.emotions, calmLong = (emo?.calmFor() ?? 0) > 20 * 60_000, strained = (emo?.arousal() ?? 0) > 0.55;
    let next = weighted(WEATHERS.filter((x) => x.w !== prev).map((x) => ({ ...x, weight: x.weight * (x.w === "storm" ? (strained ? 0 : calmLong ? 2.5 : 1) : 1) }))).w;
    if (prev === "storm") next = "rain";
    w.weather = cfg("weather") ? next : "clear"; this.weatherUntil = simNow() + rand(180_000, 540_000) / cfg("ambientRate");
    kvSet("weather", { w: next, until: this.weatherUntil });
    if (prev === w.weather) return;
    this.say(WEATHER_START[next]);
    if ((prev === "rain" || prev === "storm") && next !== "rain" && next !== "storm") this.afterRain();
  }

  private afterRain() {
    const w = this.w, trees = [...w.entities.values()].filter((e) => e.kind === "tree");
    if (!trees.length) return;
    let first: Entity | null = null;
    for (let i = 0; i < 3 + Math.floor(sr() * 3); i++) {
      const t = pick(trees), a = sr() * 6.28, x = t.x + Math.cos(a) * 1.8, z = t.z + Math.sin(a) * 1.8;
      if (!isLand(x, z, w.seed)) continue;
      const glow = sr() < 0.15;
      const e = w.spawn("mushroom", glow ? "glowcap mushroom" : "brown mushroom", x, z, { takeable: true, item: "mushroom", desc: "A mushroom, new since the rain.", expires: simNow() + 2 * HOUR });
      first ??= e;
    }
    if (first) this.say("After the rain, mushrooms have pushed up through the leaf litter.", first, 30);
    if (w.worldTime() > 0.25 && w.worldTime() < 0.75 && sr() < 0.6) this.say("A rainbow arches over the island, one foot somewhere out in the sea.");
  }

  private expire() {
    const now = simNow();
    for (const e of [...this.w.entities.values()]) if (e.props.expires && e.props.expires < now) this.w.removeEntity(e.id);
  }

  // ---------- wildlife ----------
  refreshWildlife() { this.syncWildlife(); }
  private syncWildlife() {
    const w = this.w, night = isNight(w), have = new Map<string, Entity[]>();
    for (const e of w.entities.values()) if (e.kind === "animal") (have.get(e.props.species) ?? have.set(e.props.species, []).get(e.props.species)!).push(e);
    for (const [key, s] of Object.entries(SPECIES)) {
      const list = have.get(key) ?? [], allowed = (s.when === "any" || (s.when === "night") === night) && (key === "firefly" || cfg("prey"));
      if (key !== "firefly" && this.creatures) { this.creatures.presence(key, s.count, allowed, s.desc, () => landPoint(w, undefined, HALF - 8)); continue; }   // individuals
      if (!allowed) { list.forEach((e) => w.removeEntity(e.id)); continue; }
      for (let i = list.length; i < s.count; i++) {
        const p = landPoint(w, undefined, HALF - 8);
        const e = w.spawn("animal", s.name, p.x, p.z, { species: key, desc: s.desc, heading: sr() * 6.28 });
        this.animalState.set(e.id, { tx: p.x, tz: p.z, wait: rand(1, 6) });
      }
    }
  }

  private animals(dt: number) {
    const w = this.w, now = simNow(), persist = now - this.lastPersist > 30_000;
    if (persist) this.lastPersist = now;
    for (const e of w.entities.values()) {
      if (e.kind !== "animal") continue;
      const s = SPECIES[e.props.species]; if (!s) continue;
      const st = this.animalState.get(e.id) ?? { tx: e.x, tz: e.z, wait: 0 }; this.animalState.set(e.id, st);
      const dMe = Math.hypot(e.x - w.me.x, e.z - w.me.z);
      const cr = this.creatures?.get(e), trust = cr?.trust ?? 0, shy = s.shy * (cr ? SHY_MULT[cr.trait] : 1) * (1 - 0.85 * trust);
      if (cr && this.creatures!.hazard(e, dt)) continue;                                   // caught in the flames
      const loyal = trust >= 0.8 && dMe < 6;                                              // a friend stays by River, even when it is dangerous
      const blaze = [...w.entities.values()].find((f) => f.props.burning && Math.hypot(f.x - e.x, f.z - e.z) < 13);
      if (blaze && !loyal) { const a = Math.atan2(e.z - blaze.z, e.x - blaze.x); st.tx = e.x + Math.cos(a) * 12; st.tz = e.z + Math.sin(a) * 12; st.wait = 0; e.props.calmUntil = 0; }
      let speed = s.speed;
      const calm = (e.props.calmUntil ?? 0) > now;              // listening to music: fear drops, curiosity wins
      if (calm && dMe > 4.5 && dMe < 26) {
        st.tx = w.me.x + rand(-3, 3); st.tz = w.me.z + rand(-3, 3); st.wait = 0; speed *= 1.2;
      } else if (s.shy && !calm && dMe < shy) {                  // flee (less far the more it trusts River)
        const a = Math.atan2(e.z - w.me.z, e.x - w.me.x);
        st.tx = e.x + Math.cos(a) * 10; st.tz = e.z + Math.sin(a) * 10; st.wait = 0; speed *= 2.2; e.props.fleeing = true;
      } else if (trust >= 0.5 && !blaze && dMe > 6 && dMe < 30 && !w.me.sleeping) {   // trusting animals keep company
        st.tx = w.me.x + rand(-4, 4); st.tz = w.me.z + rand(-4, 4); st.wait = 0; e.props.fleeing = false;
      } else if (st.wait > 0) { st.wait -= dt; if (e.props.species === "firefly") { e.x += rand(-0.2, 0.2); e.z += rand(-0.2, 0.2); w.moveEntity(e); } continue; }
      if (!(s.shy && !calm && dMe < shy)) e.props.fleeing = false;
      let dx = st.tx - e.x, dz = st.tz - e.z; const d = Math.hypot(dx, dz);
      if (d < 0.4) { st.wait = rand(3, 12); const a = sr() * 6.28, r = rand(3, 9); st.tx = e.x + Math.cos(a) * r; st.tz = e.z + Math.sin(a) * r; continue; }
      const nx = e.x + (dx / d) * speed * dt, nz = e.z + (dz / d) * speed * dt;
      if (!isLand(nx, nz, w.seed)) { st.tx = e.x - dx; st.tz = e.z - dz; st.wait = 0; continue; }
      e.x = nx; e.z = nz; e.props.heading = Math.atan2(dz, dx);
      persist ? w.putEntity(e) : w.moveEntity(e);
    }
    // first glimpse of a creature coming close
    for (const { e, d } of w.nearby(13)) {
      if (e.kind !== "animal" || w.me.sleeping || !SPECIES[e.props.species]) continue;
      const key = e.props.species as string;
      if (now - (this.noted.get(key) ?? 0) < 4 * 60_000) continue;
      this.noted.set(key, now);
      this.say(`A ${SPECIES[key].name} ${SPECIES[key].arrive}, ${d.toFixed(0)}m to the ${w.compass(e)}.`, e, 14);
    }
  }
}
