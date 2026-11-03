// River's body answers to what happens to it. A fall leaves a bruise or a scrape that darkens, yellows and heals; fire burns;
// cold, hunger, tiredness and long walking are felt; strong feelings land in the chest, hands and jaw, and stress that goes on
// too long turns into a real ache. All of it is reported as sensation and never as instruction. It shows on the 3D body.
import { cfg } from "./config.ts";
import { bus, log } from "./bus.ts";
import { db, kvGet, kvSet } from "./db.ts";
import { heightAt } from "../shared/noise.ts";
import { addMemory } from "./memory.ts";
import { worn } from "./clothing.ts";
import type { Emotions } from "./emotions.ts";
import type { World } from "./world.ts";
import type { BodyView, Mark } from "../shared/types.ts";
import { simNow, simRng, every } from "./sim.ts";
const sr = simRng("body");

type Kind = "bruise" | "scrape" | "burn" | "sprain" | "blister" | "bite" | "claw" | "gore" | "welt";
interface Injury { bleed: number; dressed?: boolean; cleaned?: boolean; id: number; kind: Kind; part: string; side: "left" | "right"; sev: number; born: number; heal: number; cause: string }
interface Saved { health: number; infection: number; born: number; dead: { cause: string; at: number } | null; injuries: Injury[]; strain: number; ailment: { name: string; until: number; venom?: boolean } | null; walked: number; next: number }

const MIN = 60_000, LEGS = new Set(["knee", "shin", "ankle", "foot", "hip"]);
let w: World, emo: Emotions, notify: (msg: string) => void = () => {};
const fresh = (): Saved => ({ health: 100, infection: 0, born: simNow(), dead: null, injuries: [], strain: 0, ailment: null, walked: 0, next: 1 });
let st: Saved = fresh();
let lastFaint = 0;
let prev: { x: number; z: number } | null = null, lastBurn = 0, lastSave = 0, sensations: { text: string; p: number }[] = [], shaking = 0;

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + sr() * (b - a);
const pick = <T,>(l: T[]) => l[Math.floor(sr() * l.length)];
const frac = (i: Injury) => clamp((simNow() - i.born) / i.heal);

/** how a mark looks at this age: the colour of the skin around it, and how strongly it shows */
function look(i: Injury): { hex: string; stage: string } {
  const f = frac(i);
  if (i.kind === "bruise") return f < 0.15 ? { hex: "#b8505a", stage: "fresh and tender" } : f < 0.5 ? { hex: "#6e4a8a", stage: "deep purple" } : f < 0.8 ? { hex: "#5d7f78", stage: "going green" } : { hex: "#a8a05a", stage: "yellowing, nearly gone" };
  if (i.kind === "scrape") return f < 0.35 ? { hex: "#c0504a", stage: "raw and stinging" } : f < 0.8 ? { hex: "#7a4a3a", stage: "scabbed over" } : { hex: "#c99a8a", stage: "healing pink" };
  if (i.kind === "burn") return f < 0.4 ? { hex: "#d4584a", stage: "angry red and hot" } : f < 0.75 ? { hex: "#c98f7a", stage: "blistered" } : { hex: "#d8a090", stage: "peeling" };
  if (i.kind === "bite") return f < 0.5 ? { hex: "#a8323a", stage: "two red punctures, swollen and hot" } : { hex: "#8a5a5a", stage: "scabbing over" };
  if (i.kind === "claw") return f < 0.4 ? { hex: "#b33a3a", stage: "deep raw gashes" } : f < 0.8 ? { hex: "#7a4a3a", stage: "crusted over" } : { hex: "#c99a8a", stage: "pink scars" };
  if (i.kind === "gore") return f < 0.5 ? { hex: "#8a3a5a", stage: "a huge purple bruise with a torn graze" } : { hex: "#7a6a5a", stage: "a fading ugly bruise" };
  if (i.kind === "welt") return { hex: "#d98a8a", stage: "an itchy red welt" };
  if (i.kind === "sprain") return { hex: "#c88a8a", stage: f < 0.5 ? "swollen and throbbing" : "stiff" };
  return { hex: "#d9a99a", stage: f < 0.6 ? "a raw blister" : "tough and healing" };
}
const KIND_WORD: Record<string, string> = { claw: "claw marks", gore: "a goring wound" };
const say = (i: Injury) => `${KIND_WORD[i.kind] ?? `a ${i.kind}`} on your ${i.side} ${i.part}, ${look(i).stage}`;
const pain = (i: Injury) => i.sev * (1 - frac(i)) * (i.kind === "sprain" ? 1.2 : i.kind === "gore" || i.kind === "claw" ? 1.3 : i.kind === "bruise" ? 0.7 : i.kind === "welt" ? 0.15 : 1);

function hurt(kind: Kind, part: string, sev: number, heal: number, cause: string, bleed = 0): Injury {
  const side = sr() < 0.5 ? "left" : "right", old = st.injuries.find((i) => i.part === part && i.side === side && i.kind === kind);
  if (old) { old.sev = clamp(Math.max(old.sev, sev) + 0.15); old.born = simNow(); old.heal = Math.max(old.heal, heal); old.bleed += bleed; old.dressed = false; return old; }
  const i: Injury = { bleed, id: st.next++, kind, part, side, sev, born: simNow(), heal, cause };
  st.injuries.push(i); if (st.injuries.length > 8) st.injuries.shift();
  return i;
}

/** Lose health. At zero River dies, unless lethality is switched off (RIVER_LETHAL=0), in which case it clings on. */
function damage(n: number, cause: string) {
  if (st.dead || n <= 0) return;
  st.health = Math.max(0, st.health - n);
  if (st.health <= 0) { if (!cfg("lethal")) { st.health = 4; return; } die(cause); }
}
function die(cause: string) {
  st.dead = { cause, at: simNow() }; st.health = 0; kvSet("body", st);
  w.me.activity = "dead"; w.me.sleeping = false;
  bus.emit("died", { cause, born: st.born, at: st.dead.at, x: w.me.x, z: w.me.z });
  bus.emit("state");
}

/** the moment of a fall: where it hurts depends on how it happened */
function fall(slope: number, why: string) {
  const worse = worn().some((g) => g.slot === "body") ? 0.85 : 1;
  const sev = clamp((0.2 + slope * 0.7 + rnd(0, 0.3)) * worse, 0.15, 0.9);
  const part = pick(["knee", "knee", "knee", "palm", "palm", "elbow", "shin", "shin", "hip", "ankle"]);
  const kind: Kind = part === "ankle" && sev > 0.45 ? "sprain" : ["knee", "palm", "elbow"].includes(part) && sr() < 0.5 ? "scrape" : "bruise";
  const i = hurt(kind, part, sev, (kind === "sprain" ? rnd(60, 90) : kind === "scrape" ? rnd(15, 40) : rnd(25, 70)) * MIN, why, kind === "scrape" && sev > 0.5 ? 2 : 0);
  damage(sev * (slope > 0.5 ? 18 : 9), why.includes("slope") ? "a fall from a slope" : "a fall");
  w.stopWalk("you stumbled and fell");
  emo.bump("dread", 0.15 + 0.3 * sev, "a hard fall"); emo.bump("frustration", 0.08, "tripped");
  w.bump({ mood: -4 * sev, energy: -3 });
  const text = `You ${why} and went down hard. Now there is ${say(i)}.`;
  log("need", `${w.me.name} fell: ${say(i)}.`, { perceived: true }); notify(text);
  addMemory(`I fell at (${w.me.x.toFixed(0)}, ${w.me.z.toFixed(0)}) because I ${why}, and ${say(i)}.`, 5, ["body"]);
  bus.emit("state");
}

function burn() {
  if (simNow() - lastBurn < 20_000) return; lastBurn = simNow();
  const part = pick(["palm", "forearm", "shin"]), sev = rnd(0.3, 0.7);
  const i = hurt("burn", part, sev, rnd(45, 100) * MIN, "fire");
  damage(sev * 16, "burns");
  log("need", `${w.me.name} was burned: ${say(i)}.`, { perceived: true });
  addMemory(`The fire burned me: ${say(i)}.`, 6, ["body"]);
  bus.emit("state");
}

function feel(dt: number) {
  const L = emo.level, n = w.me.needs, s: { text: string; p: number }[] = [];
  const add = (cond: boolean, text: string, p: number) => { if (cond) s.push({ text, p }); };
  add(L.dread > 0.4, L.dread > 0.7 ? "your heart is hammering, your breath is short, and your hands shake" : "your heart is pounding and your breath comes short", L.dread + 0.3);
  add(L.frustration > 0.45, "your jaw is clenched and your shoulders are tight", L.frustration);
  add(L.grief > 0.4, "your chest feels heavy and your throat is tight", L.grief);
  add(L.loneliness > 0.6, "a hollow ache sits under your ribs", L.loneliness * 0.7);
  add(L.wonder > 0.5, "the hairs on your arms stand up", L.wonder * 0.6);
  add(L.pride > 0.5, "your chest feels wide and warm", L.pride * 0.5);
  add(L.playfulness > 0.5, "you feel light, almost bouncing", L.playfulness * 0.4);
  add(L.boredom > 0.6, "your legs fidget; they want to be moving", L.boredom * 0.5);
  add(n.warmth < 15, "your fingers and toes are numb and clumsy", 1.1); add(n.warmth >= 15 && n.warmth < 35, "you shiver, and your skin is all goosebumps", 0.8);
  add(n.hunger < 25, "your stomach cramps and growls", 0.9);
  add(n.energy < 25, "your limbs are heavy and your eyelids drag", 0.9);
  const shoes = worn().some((g) => g.slot === "feet");
  add(st.walked > 700, shoes ? "your feet ache from the walking" : "the soles of your bare feet are sore and tender", 0.7);
  for (const i of st.injuries) { const p = pain(i), text = `your ${i.side} ${i.part} aches`; if (p > 0.25 && !s.some((x) => x.text === text)) s.push({ text, p: p + 0.3 }); }
  if (st.ailment) s.push({ text: st.ailment.name, p: 1.2 });
  sensations = s.sort((a, b) => b.p - a.p).slice(0, 5);
  shaking = clamp(Math.max(L.dread - 0.35, (30 - n.warmth) / 30, 0));
  void dt;
}

function tick(dt: number) {
  if (st.dead) return;
  const m = w.me, now = simNow();
  // movement: the ground, the dark and tiredness decide whether it goes well
  let moving = false;
  if (prev && !m.sleeping) {
    const d = Math.hypot(m.x - prev.x, m.z - prev.z);
    if (d > 0.1) {
      moving = true;
      st.walked += d * (worn().some((g) => g.slot === "feet") ? 0.5 : 1);
      const slope = Math.abs(heightAt(m.x, m.z, w.seed) - heightAt(prev.x, prev.z, w.seed)) / d, t = w.worldTime();
      const night = t < 0.23 || t > 0.78, wet = w.weather === "rain" || w.weather === "storm";
      const p = 0.003 + 0.08 * Math.max(0, slope - 0.3) + (night ? 0.006 : 0) + (wet ? 0.008 : 0) + (m.needs.energy < 20 ? 0.012 : 0) + emo.level.dread * 0.01;
      if (sr() < p * cfg("fallRate") * dt) fall(slope, wet && slope > 0.2 ? "slipped on the wet ground" : night ? "missed your footing in the dark" : slope > 0.35 ? "lost your footing on the slope" : m.needs.energy < 20 ? "stumbled from tiredness" : "tripped");
    }
  }
  prev = { x: m.x, z: m.z };
  if (!moving) st.walked = Math.max(0, st.walked - 0.5 * dt);
  if (m.sleeping) st.walked = Math.max(0, st.walked - 4 * dt);

  // healing, faster asleep; and the ache of what is still hurt
  const rate = m.sleeping ? 3 : 1;
  for (const i of st.injuries) i.born -= (rate - 1) * dt * 1000;
  st.injuries = st.injuries.filter((i) => now - i.born < i.heal);
  const total = clamp(st.injuries.reduce((a, i) => a + pain(i), 0), 0, 1.5);
  if (total) w.bump({ mood: -0.02 * total * dt });

  // vitals: blood, infection, hunger and cold, and slow recovery
  if (st.dead) return;
  const open = st.injuries.filter((i) => ["bite", "claw", "gore", "scrape", "burn"].includes(i.kind));
  for (const i of st.injuries) if (i.bleed > 0.05) { damage(i.bleed * dt / 60, i.cause); i.bleed *= Math.exp(-dt / (i.dressed ? 20 : 150)); } else i.bleed = 0;
  const raw = open.filter((i) => !i.dressed && !i.cleaned && now - i.born > 6 * MIN);
  if (raw.length) st.infection = clamp(st.infection + raw.length * dt / (14 * MIN / 1000), 0, 1); else st.infection = clamp(st.infection - dt / (20 * 60));
  if (st.infection > 0.3) damage((st.infection > 0.8 ? 5 : st.infection * 2.5) * dt / 60, "an infected wound");
  if (st.ailment?.venom) damage(2.5 * dt / 60, "venom");
  if (m.needs.hunger <= 1) damage(2 * dt / 60, "starvation");
  if (m.needs.warmth <= 3) damage(3 * dt / 60, "the cold");
  const bleeding = st.injuries.some((i) => i.bleed > 0.5);
  if (!bleeding && st.infection < 0.2 && m.needs.hunger > 35 && m.needs.warmth > 30 && st.health < 100) st.health = Math.min(100, st.health + (m.sleeping ? 1.5 : 0.5) * dt / 60);
  if (st.health < 35) w.bump({ energy: -0.02 * dt, mood: -0.02 * dt });
  if (st.health < 12 && !m.sleeping && now - lastFaint > 90_000) { lastFaint = now; log("need", `${m.name} collapsed, too weak to stand.`, { perceived: true }); void w.restFor(40); }

  // stress that goes on and on becomes a body ache
  const stress = Math.max(emo.level.dread, emo.level.frustration * 0.85, emo.level.grief * 0.5);
  st.strain = clamp(st.strain + (stress > 0.45 ? (stress - 0.3) * dt / 240 : -dt / 300));
  if (st.ailment && now > st.ailment.until) st.ailment = null;
  if (!st.ailment && st.strain > 0.7) {
    const L = emo.level, name = L.dread >= L.frustration ? pick(["a knot in your stomach", "trembling hands that won't settle"]) : L.grief > L.frustration ? "a heavy ache across your chest" : pick(["a tight, throbbing headache", "an aching jaw from clenching it"]);
    st.ailment = { name, until: now + rnd(10, 15) * MIN }; st.strain = 0.45;
    log("need", `${w.me.name}'s body is paying for the strain: ${name}.`, { perceived: true });
  }
  if (st.ailment) w.bump({ energy: (st.ailment.venom ? -0.04 : -0.01) * dt, mood: (st.ailment.venom ? -0.03 : -0.01) * dt });
  feel(dt);
  if (now - lastSave > 15_000) { lastSave = now; kvSet("body", st); }
}

export const bodyApi = {
  attach(world: World, emotions: Emotions, say: (msg: string) => void) {
    w = world; emo = emotions; notify = say;
    st = { ...st, ...kvGet<Partial<Saved>>("body", {}) }; if (!st.born) st.born = simNow();
    bus.on("scorched", () => burn());
  },
  /** Something living hurt River: a bite, claws, a goring. Returns how the wound reads. Venom brings a sickness on top. */
  wound(kind: Kind, part: string, sev: number, healMin: number, cause: string, venom = false, dmg = 0, bleed = 0): string {
    const i = hurt(kind, part, clamp(sev, 0.1, 1), healMin * MIN, cause, bleed); damage(dmg, cause);
    if (venom) { st.ailment = { name: "a sick, swimming head and a burning limb from the venom", until: simNow() + rnd(10, 16) * MIN, venom: true }; }
    bus.emit("state"); return say(i);
  },
  /** How much River hurts right now, summed over its wounds. */
  pain: () => clamp(st.injuries.reduce((a, i) => a + pain(i), 0), 0, 3),
  /** A fall caused by something outside the walking rules (a collapse, a tumble). */
  trip: (slope: number, why: string) => fall(slope, why),
  start() { every(500, () => tick(0.5), "body"); },
  reset() { st = fresh(); sensations = []; shaking = 0; kvSet("body", st); },
  /** Advance the body by dt seconds (the server runs this on a timer). */
  tick: (dt: number) => tick(dt),
  isDead: () => !!st.dead,
  health: () => st.health,
  /** Open wounds, for first aid. */
  wounds: () => st.injuries.map((i) => ({ id: i.id, kind: i.kind, part: i.part, side: i.side, bleeding: i.bleed > 0.5, dressed: !!i.dressed, cleaned: !!i.cleaned, text: say(i), open: ["bite", "claw", "gore", "scrape", "burn"].includes(i.kind) })),
  cleanWounds() { let n = 0; for (const i of st.injuries) if (!i.cleaned && ["bite", "claw", "gore", "scrape", "burn"].includes(i.kind)) { i.cleaned = true; n++; } st.infection = Math.max(0, st.infection - 0.35); if (st.ailment?.venom && n) st.ailment.until = Math.min(st.ailment.until, simNow() + 5 * MIN); bus.emit("state"); return n; },
  dress(n: number, antiseptic: boolean) { let k = 0; for (const i of st.injuries.filter((x) => !x.dressed && ["bite", "claw", "gore", "scrape", "burn"].includes(x.kind)).sort((a, b) => b.bleed - a.bleed)) { if (k >= n) break; i.dressed = true; i.bleed *= 0.15; if (antiseptic) i.cleaned = true; k++; } if (antiseptic) st.infection = Math.max(0, st.infection - 0.15); bus.emit("state"); return k; },
  splint() { const s = st.injuries.filter((i) => i.kind === "sprain"); for (const i of s) { i.heal = Math.max((simNow() - i.born) + 10 * MIN, i.heal * 0.5); i.sev *= 0.6; } return s.length; },
};

/** What River feels, as a section of its context. Empty when nothing is noteworthy. */
export function feelingsText(): string {
  const wounds = st.injuries.map(say), s = sensations.map((x) => x.text), h = st.health;
  const cond = h >= 85 ? "" : h >= 60 ? "You are hurt, but steady on your feet." : h >= 35 ? "You are badly hurt, and every step costs you." : h >= 15 ? "You are gravely hurt: light-headed, cold, your vision swimming." : "You are dying. The world is narrowing and going dark.";
  const bleeding = st.injuries.filter((i) => i.bleed > 0.5).map((i) => `your ${i.side} ${i.part}`);
  if (!wounds.length && !s.length && !cond) return "";
  return [cond, bleeding.length ? `You are bleeding from ${bleeding.join(" and ")}; it runs warm and wet.` : "", st.infection > 0.3 ? (st.infection > 0.7 ? "A fever burns in you; the wound is hot, swollen and foul, and you shake with chills." : "A wound has turned hot and tight, and you feel feverish.") : "", wounds.length ? `Marks on you: ${wounds.join("; ")}.` : "", s.length ? `Right now, in your body: ${s.join("; ")}.` : ""].filter(Boolean).join("\n");
}

export function bodyView(): BodyView {
  const marks: Mark[] = st.injuries.map((i) => { const l = look(i); return { part: i.part, side: i.side, kind: i.kind, hex: l.hex, alpha: +(1 - frac(i) * 0.6).toFixed(2), sev: +i.sev.toFixed(2), desc: say(i) }; });
  const lives = (db.prepare("SELECT COUNT(*) n FROM lives").get() as any).n as number;
  return { health: Math.round(st.health), bleeding: st.injuries.some((i) => i.bleed > 0.5), infection: +st.infection.toFixed(2), lives, dead: st.dead ? { cause: st.dead.cause, days: +((st.dead.at - st.born) / (24 * MIN)).toFixed(1) } : null, marks, shaking: +shaking.toFixed(2), limp: st.injuries.some((i) => LEGS.has(i.part) && pain(i) > 0.3), sensations: sensations.map((x) => x.text) };
}
