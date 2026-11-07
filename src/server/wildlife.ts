// The wild island: snakes, bugs, fish, birds, and larger animals that can hurt River. Prey animals live in creatures.ts / ambient.ts;
// everything here is wild: it can't be named or tamed, and it follows its own appetites and fears.
//
// Threats play out as a sequence River can read and respond to: a warning (a hiss, a snort, eyes at the edge of the dark), then a
// closing in, then an attack that costs real wounds (see body.ts). Fire, shelter, standing still, noise and thrown stones all turn
// them away. Nothing here kills River: a mauling knocks it out, and the animals lose interest.
import { cfg } from "./config.ts";
import { bus, log } from "./bus.ts";
import { addMemory } from "./memory.ts";
import { bodyApi } from "./body.ts";
import { ecologyOf } from "./ecology.ts";
import { HALF, groveness, isLand } from "../shared/noise.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { Entity } from "../shared/types.ts";
import type { Emotions } from "./emotions.ts";
import type { World } from "./world.ts";
import { persisted } from "./persist.ts";
import { gate } from "./activities.ts";
import { checkRecipe, craftNow } from "./crafting.ts";
import { recipeById } from "../content/recipes.ts";
import { simNow, simRng, simSleep, every, after } from "./sim.ts";
const sr = simRng("wildlife");

type Cls = "snake" | "bug" | "fish" | "bird" | "predator";
type Habitat = "land" | "water" | "shore" | "air" | "tree";
interface Sp { name: string; cls: Cls; count: number; speed: number; when: "day" | "night" | "any"; habitat: Habitat; alt?: number; desc: string; notice?: number; charge?: number; cool?: number; sound?: string; hp?: number; hits?: number; gap?: number }
export const WILD: Record<string, Sp> = {
  snake:     { name: "snake", cls: "snake", count: 3, speed: 0.6, when: "any", habitat: "land", desc: "A snake, olive-brown and patterned like dead leaves, moving through the grass.", sound: "a dry rustle in the grass" },
  beetle:    { name: "beetle", cls: "bug", count: 6, speed: 0.25, when: "day", habitat: "land", desc: "A glossy blue-black beetle, bustling over the ground as though late for something." },
  butterfly: { name: "butterfly", cls: "bug", count: 5, speed: 0.9, when: "day", habitat: "land", alt: 1.1, desc: "A butterfly with amber wings, drifting from flower to flower." },
  midges:    { name: "midge swarm", cls: "bug", count: 2, speed: 0.5, when: "night", habitat: "shore", alt: 1.4, desc: "A shimmering cloud of tiny biting midges.", sound: "a thin whine of midges" },
  fish:      { name: "silver fish", cls: "fish", count: 9, speed: 0.9, when: "any", habitat: "water", desc: "A silver fish, a flicker under the surface." },
  gull:      { name: "gull", cls: "bird", count: 3, speed: 2.2, when: "day", habitat: "shore", alt: 4, desc: "A white gull, riding the air above the shore.", sound: "a gull crying" },
  heron:     { name: "heron", cls: "bird", count: 1, speed: 0.5, when: "day", habitat: "shore", desc: "A grey heron standing in the shallows, so still it seems carved.", sound: "a heron's rough croak" },
  owl:       { name: "owl", cls: "bird", count: 1, speed: 1.5, when: "night", habitat: "tree", alt: 3.6, desc: "A pale owl on a high branch, turning its head to follow you.", sound: "an owl hooting" },
  songbird:  { name: "songbird", cls: "bird", count: 3, speed: 1.6, when: "day", habitat: "tree", alt: 2.4, desc: "A small brown songbird, flitting among the branches.", sound: "birdsong" },
  wolf:      { name: "wolf", cls: "predator", count: 3, speed: 2.6, when: "night", habitat: "land", notice: 26, charge: 5.2, cool: 150, hp: 32, hits: 7, gap: 3500, desc: "A grey wolf, lean and silent.", sound: "a wolf howling" },
  boar:      { name: "boar", cls: "predator", count: 2, speed: 1.2, when: "day", habitat: "land", notice: 9, charge: 4.6, cool: 90, hp: 50, hits: 2, gap: 5500, desc: "A heavy, bristle-backed boar with yellowed tusks.", sound: "snuffling and grunting" },
  bear:      { name: "bear", cls: "predator", count: 1, speed: 1.4, when: "day", habitat: "land", notice: 16, charge: 4.2, cool: 240, hp: 95, hits: 3, gap: 3800, desc: "A huge brown bear, its shoulders rolling as it walks.", sound: "a heavy tread in the undergrowth" },
};
export const wildSound = (species: string) => WILD[species]?.sound;

interface St { hits?: number; nextHit?: number; tx: number; tz: number; wait: number; mode: string; until: number; cool: number; ang: number; warnedAt: number; perch?: { x: number; z: number } }
const rand = (a: number, b: number) => a + sr() * (b - a);
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const isNight = (w: World) => { const t = w.worldTime(); return t < 0.23 || t > 0.78; };
let freezeUntil = 0, noiseUntil = 0, instance: Wildlife | null = null;

export class Wildlife {
  private st = new Map<string, St>();
  private lastPersist = 0;
  private fresh = true;
  constructor(private w: World, public emo: Emotions, private say: (text: string, at?: { x: number; z: number }, r?: number) => boolean, private notify: (msg: string) => void) {
    instance = this;
    // each animal's behaviour mode, committed with the clock
    const s = persisted("wildlife", () => ({ st: [...this.st], freezeUntil, noiseUntil, lastPersist: this.lastPersist }));
    if (s) { this.fresh = false; this.st = new Map(s.st); freezeUntil = s.freezeUntil; noiseUntil = s.noiseUntil; this.lastPersist = s.lastPersist; }
  }
  /** River has struck it: it fights back. */
  /** The nearest predator that is charging or fighting, if any is within `max` metres. Read-only. */
  threat(max = 12): { name: string; d: number; x: number; z: number } | null {
    let best: { name: string; d: number; x: number; z: number } | null = null;
    for (const e of this.w.entities.values()) {
      const st = this.st.get(e.id); if (!st || (st.mode !== "charge" && st.mode !== "fight")) continue;
      const d = Math.hypot(e.x - this.w.me.x, e.z - this.w.me.z);
      if (d <= max && (!best || d < best.d)) best = { name: String(e.props.species ?? e.name), d, x: e.x, z: e.z };
    }
    return best;
  }
  provoke(e: Entity) { const st = this.st.get(e.id); if (st && !(st.mode === "fight" || st.mode === "charge" || st.mode === "retreat")) { st.mode = "charge"; st.until = simNow() + 10_000; } }
  start() { every(15_000, () => this.sync(), "wildlife.sync"); every(500, () => this.tick(0.5), "wildlife"); if (this.fresh) this.sync(); }
  reset() { this.st.clear(); }

  // ---------- who is here ----------
  private spot(sp: Sp, minFromMe: number): { x: number; z: number; perch?: { x: number; z: number } } | null {
    const w = this.w;
    for (let i = 0; i < 80; i++) {
      const x = rand(-HALF + 8, HALF - 8), z = rand(-HALF + 8, HALF - 8);
      if (!isLand(x, z, w.seed) || Math.hypot(x - w.me.x, z - w.me.z) < minFromMe) continue;
      if (sp.habitat === "land" || sp.habitat === "air") return { x, z };
      if (sp.habitat === "tree") { const t = [...w.entities.values()].filter((e) => e.kind === "tree").sort(() => sr() - 0.5).find((e) => Math.hypot(e.x - w.me.x, e.z - w.me.z) >= minFromMe); return t ? { x: t.x, z: t.z, perch: { x: t.x, z: t.z } } : null; }
      // shore and water: walk outward from the land point, in a random direction, until the sea
      const a = rand(0, 6.28); let k = 0;
      while (k < 60 && isLand(x + Math.cos(a) * k, z + Math.sin(a) * k, w.seed)) k++;
      if (k >= 60) continue;
      const out = sp.habitat === "shore" ? k - 1.2 : k + rand(1.5, 5);
      return { x: x + Math.cos(a) * out, z: z + Math.sin(a) * out };
    }
    return null;
  }

  /** Re-check who should be on the island (a setting changed). */
  refresh() { this.sync(); }
  private sync() {
    const w = this.w, night = isNight(w), have = new Map<string, Entity[]>();
    for (const e of w.entities.values()) if (e.kind === "animal" && WILD[e.props.species]) (have.get(e.props.species) ?? have.set(e.props.species, []).get(e.props.species)!).push(e);
    let spawned = 0;
    for (const [key, sp] of Object.entries(WILD)) {
      const list = have.get(key) ?? [], on = sp.cls === "predator" ? cfg("predators") : cfg("smallWild"), eco = ecologyOf(w), allowed = on && (sp.when === "any" || (sp.when === "night") === night) && (eco?.here(key) ?? true), want = eco ? eco.count(key, sp.count) : sp.count;
      if (!on) { for (const e of list) { w.removeEntity(e.id); this.st.delete(e.id); } continue; }
      const far = sp.cls === "predator" ? 40 : 14;
      if (!allowed) { for (const e of list) if (Math.hypot(e.x - w.me.x, e.z - w.me.z) > far) { w.removeEntity(e.id); this.st.delete(e.id); } continue; }
      if (list.length > want) { const gone = list.filter((e) => Math.hypot(e.x - w.me.x, e.z - w.me.z) > far).sort((a, b) => Math.hypot(b.x - w.me.x, b.z - w.me.z) - Math.hypot(a.x - w.me.x, a.z - w.me.z))[0]; if (gone) { w.removeEntity(gone.id); this.st.delete(gone.id); } }     // the island holds fewer now: the farthest slips away
      for (let i = list.length; i < want && spawned < 3; i++) {
        const p = this.spot(sp, far); if (!p) break;
        const e = w.spawn("animal", sp.name, p.x, p.z, { species: key, wild: true, desc: sp.desc, heading: rand(0, 6.28), alt: sp.alt ?? 0, swim: sp.cls === "fish" || undefined, ...(sp.hp ? { hp: sp.hp, maxHp: sp.hp } : {}) });
        this.st.set(e.id, { tx: p.x, tz: p.z, wait: rand(1, 6), mode: "wander", until: 0, cool: 0, ang: rand(0, 6.28), warnedAt: 0, perch: p.perch }); spawned++;
      }
    }
  }

  // ---------- the guards River has ----------
  private fireNear(): boolean { const me = this.w.me; return [...this.w.entities.values()].some((e) => (e.kind === "campfire" && e.props.lit !== false && Math.hypot(e.x - me.x, e.z - me.z) < 8) || (e.props.burning && Math.hypot(e.x - me.x, e.z - me.z) < 14)); }
  private sheltered(): boolean { const me = this.w.me; return [...this.w.entities.values()].some((e) => e.kind === "structure" && (e.props.shelter ?? !e.props.shape) && Math.hypot(e.x - me.x, e.z - me.z) < 3.2 + (e.props.radius ?? 0)); }

  // ---------- life ----------
  private tick(dt: number) {
    const w = this.w, now = simNow(), persist = now - this.lastPersist > 30_000; if (persist) this.lastPersist = now;
    const prot = this.fireNear(), shel = this.sheltered(), frozen = now < freezeUntil, night = isNight(w);
    for (const e of [...w.entities.values()]) {
      if (e.kind !== "animal" || !e.props.wild) continue;
      const sp = WILD[e.props.species]; if (!sp) continue;
      const st = this.st.get(e.id) ?? { tx: e.x, tz: e.z, wait: 0, mode: "wander", until: 0, cool: 0, ang: rand(0, 6.28), warnedAt: 0 }; this.st.set(e.id, st);
      const d = Math.hypot(e.x - w.me.x, e.z - w.me.z);
      let speed = sp.speed, moved = false;
      const go = (x: number, z: number, sp2 = speed) => {
        const dx = x - e.x, dz = z - e.z, L = Math.hypot(dx, dz); if (L < 0.05) return;
        const nx = e.x + (dx / L) * Math.min(L, sp2 * dt), nz = e.z + (dz / L) * Math.min(L, sp2 * dt);
        const ok = sp.cls === "fish" ? !isLand(nx, nz, w.seed) && Math.abs(nx) < HALF + 14 && Math.abs(nz) < HALF + 14 : sp.cls === "bird" && sp.alt ? true : sp.habitat === "shore" && sp.cls === "bird" ? true : isLand(nx, nz, w.seed);
        if (!ok) { st.tx = e.x - dx; st.tz = e.z - dz; st.wait = 0; return; }
        e.x = nx; e.z = nz; e.props.heading = Math.atan2(dz, dx); moved = true;
      };
      const roam = (r: number, lo = 3, hi = 12) => { if (st.wait > 0) { st.wait -= dt; return; } if (Math.hypot(st.tx - e.x, st.tz - e.z) < 0.4) { st.wait = rand(lo, hi); const a = rand(0, 6.28), k = rand(r * 0.4, r); st.tx = e.x + Math.cos(a) * k; st.tz = e.z + Math.sin(a) * k; } else go(st.tx, st.tz); };
      const setDesc = (s: string, pose?: string) => { if (e.props.desc !== s || e.props.pose !== pose) { e.props.desc = s; e.props.pose = pose; if (!persist) w.putEntity(e); } };

      switch (sp.cls) {
        case "snake": this.snake(e, sp, st, d, dt, night, frozen, go, roam, setDesc); break;
        case "bug":
          if (e.props.species === "midges") this.midges(e, st, d, go, roam, prot);
          else if (d < 2.5) { const a = Math.atan2(e.z - w.me.z, e.x - w.me.x); go(e.x + Math.cos(a) * 4, e.z + Math.sin(a) * 4, speed * 2.5); } else roam(e.props.species === "butterfly" ? 9 : 3, 1, 5);
          break;
        case "fish":
          if (d < 3.2) { const a = Math.atan2(e.z - w.me.z, e.x - w.me.x); go(e.x + Math.cos(a) * 5, e.z + Math.sin(a) * 5, speed * 3); }
          else { roam(7, 1, 4); if (sr() < 0.004 * dt * 10 && d < 30) { e.props.leap = now; } }
          break;
        case "bird": this.bird(e, sp, st, d, go, roam, night); break;
        case "predator": this.predator(e, sp, st, d, dt, prot, shel, frozen, night, go, roam, setDesc); break;
      }
      if (moved) persist ? w.putEntity(e) : w.moveEntity(e);
      else if (e.props.leap && now - e.props.leap < 600) w.moveEntity(e);
    }
  }

  // ---------- snakes: they hold still, and they strike what steps on them ----------
  private snake(e: Entity, sp: Sp, st: St, d: number, dt: number, night: boolean, frozen: boolean, go: (x: number, z: number, s?: number) => void, roam: (r: number, lo?: number, hi?: number) => void, setDesc: (s: string, p?: string) => void) {
    const w = this.w, now = simNow(), cold = night || w.weather === "rain" || w.weather === "storm";
    if (d < 4.5 && !w.me.sleeping) {
      setDesc("A snake, coiled tight with its head raised, tongue flickering. It is watching you and ready to strike.", "coiled");
      if (now - st.warnedAt > 90_000) { st.warnedAt = now; this.say("A dry hiss, close by. A snake lies coiled in the grass, head raised, its eyes fixed on you.", e, 8); }
      if (d < 1.3 && !frozen && now > st.cool && sr() < 0.6 * dt) {
        st.cool = now + 40_000;
        const part = sr() < 0.65 ? "shin" : "palm", venom = sr() < 0.35;
        const text = bodyApi.wound("bite", part, rand(0.3, 0.6), venom ? 40 : 25, "a snake bite", venom, rand(3, 8) * cfg("damageScale"), 1.5);
        w.stopWalk("a snake struck you"); this.emo.bump("dread", 0.5, "a snake's strike"); w.bump({ mood: -6, energy: -2 });
        this.notify(`A snake lunges out of the grass and bites: now there is ${text}.${venom ? " Something burns under the skin, and your head begins to swim." : ""}`);
        log("need", `${w.me.name} was bitten by a snake.`, { perceived: true }); addMemory(`A snake bit me at (${w.me.x.toFixed(0)}, ${w.me.z.toFixed(0)}): ${text}.${venom ? " It was venomous." : ""}`, 7, ["danger", "body"]);
        const a = Math.atan2(e.z - w.me.z, e.x - w.me.x); st.tx = e.x + Math.cos(a) * 8; st.tz = e.z + Math.sin(a) * 8; st.wait = 0; st.mode = "flee"; st.until = now + 8000;
      }
    } else { setDesc(sp.desc); }
    if (st.mode === "flee" && now < st.until) go(st.tx, st.tz, 1.6); else if (d >= 4.5) roam(5, 4, 14), void (cold && (st.wait = Math.max(st.wait, 2)));
  }

  // ---------- midges: they find River at night near the water ----------
  private midges(e: Entity, st: St, d: number, go: (x: number, z: number, s?: number) => void, roam: (r: number) => void, prot: boolean) {
    const w = this.w, now = simNow();
    if (d < 20 && !prot && w.weather !== "rain" && w.weather !== "storm") { go(w.me.x + Math.cos(now / 900) * 1.2, w.me.z + Math.sin(now / 900) * 1.2, 1.4); } else roam(6);
    if (d < 2.2 && !prot && now > st.cool && !w.me.sleeping) {
      st.cool = now + 45_000; const text = bodyApi.wound("welt", "forearm", 0.15, 12, "midges");
      w.bump({ mood: -3 }); this.notify(`A cloud of midges settles on you, whining in your ears. They bite: you now have ${text}.`);
    }
  }

  // ---------- birds ----------
  private bird(e: Entity, sp: Sp, st: St, d: number, go: (x: number, z: number, s?: number) => void, roam: (r: number, lo?: number, hi?: number) => void, night: boolean) {
    const w = this.w, now = simNow(), name = e.props.species;
    if (name === "gull") {                                    // circling the shore, now and then settling
      e.props.alt = st.mode === "land" ? 0.15 : 3.5 + Math.sin(now / 2500 + e.x) * 1.2;
      if (st.mode === "land" && now > st.until || d < 4) { st.mode = "fly"; }
      if (st.mode !== "land") { st.ang += 0.06; const R = 18; go(st.tx + Math.cos(st.ang) * R * 0.5, st.tz + Math.sin(st.ang) * R * 0.5, sp.speed); if (sr() < 0.002) { st.mode = "land"; st.until = now + rand(15, 40) * 1000; } }
    } else if (name === "heron") {
      if (d < 8) { e.props.alt = 2.5; const a = Math.atan2(e.z - w.me.z, e.x - w.me.x); go(e.x + Math.cos(a) * 10, e.z + Math.sin(a) * 10, 2.4); } else { e.props.alt = 0; roam(2.5, 6, 20); }
    } else if (name === "owl") {
      e.props.alt = sp.alt;
      if (night && d < 6 && now - st.warnedAt > 120_000) { st.warnedAt = now; this.say("High in the branches, two round, pale eyes turn to follow you. An owl.", e, 9); }
      if (!night) return;
      if (d < 2.5) { const t = [...w.entities.values()].filter((x) => x.kind === "tree").sort(() => sr() - 0.5)[0]; if (t) go(t.x, t.z, 4); }
    } else {                                                  // songbirds flit tree to tree
      e.props.alt = 2.2 + Math.sin(now / 700 + e.x * 3) * 0.3;
      if (d < 3) { const a = Math.atan2(e.z - w.me.z, e.x - w.me.x); go(e.x + Math.cos(a) * 8, e.z + Math.sin(a) * 8, 4); } else roam(8, 2, 8);
    }
  }

  // ---------- the large and dangerous ----------
  private predator(e: Entity, sp: Sp, st: St, d: number, dt: number, prot: boolean, shel: boolean, frozen: boolean, night: boolean, go: (x: number, z: number, s?: number) => void, roam: (r: number, lo?: number, hi?: number) => void, setDesc: (s: string, p?: string) => void) {
    const w = this.w, me = w.me, now = simNow(), key = e.props.species as string, scared = (e.props.scaredUntil ?? 0) > now;
    const away = (k: number) => { const a = Math.atan2(e.z - me.z, e.x - me.x); st.tx = e.x + Math.cos(a) * k; st.tz = e.z + Math.sin(a) * k; };
    const retreat = (secs: number, why: string) => { st.mode = "retreat"; st.until = now + secs * 1000; away(18); setDesc(`${sp.desc} It is backing off, wary, ${why}.`, "retreating"); };
    if (e.props.hp === undefined && sp.hp) { e.props.hp = sp.hp; e.props.maxHp = sp.hp; }
    if (st.mode !== "retreat" && e.props.hp < e.props.maxHp * 0.35) retreat(70, "badly hurt");
    const hunting = ["stalk", "charge", "warn", "fight"].includes(st.mode);
    if (hunting && d < 22 && !me.sleeping) this.emo.bump("dread", 0.02 * (1 - d / 22) * dt * 2, `a ${key} close by`);
    if (hunting && (scared || (prot && d < 12))) retreat(25, scared ? "driven off" : "keeping clear of the fire");

    switch (st.mode) {
      case "retreat": go(st.tx, st.tz, sp.speed * 1.6); if (now > st.until || Math.hypot(st.tx - e.x, st.tz - e.z) < 1) { st.mode = "wander"; setDesc(sp.desc); } break;
      case "stalk": {                                                           // a wolf circling in, closer and closer
        const R = shel || prot ? 10 : Math.max(6, 11 - (now - (st.until - 1)) * 0), dir = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1;
        st.ang += 0.18 * dir * dt; go(me.x + Math.cos(st.ang) * R, me.z + Math.sin(st.ang) * R, sp.speed);
        setDesc(`A grey wolf, head low, pale eyes fixed on you. It is circling.`, "stalking");
        const siblingCharging = [...w.entities.values()].some((o) => o.id !== e.id && o.props.species === key && this.st.get(o.id)?.mode === "charge");
        if ((now > st.until || siblingCharging) && !shel && !prot && !frozen) { st.mode = "charge"; st.until = now + 12_000; }
        else if (d > sp.notice! * 1.4) { st.mode = "wander"; setDesc(sp.desc); }
        break;
      }
      case "warn": {                                                            // a boar or bear giving River one last chance
        e.props.heading = Math.atan2(me.z - e.z, me.x - e.x);
        if (now > st.until) {
          if (d < (key === "bear" ? 7 : 6) && !shel && !prot && !(frozen && sr() < 0.6)) { st.mode = "charge"; st.until = now + 8000; e.props.bluff = key === "bear" && sr() < 0.4; }
          else retreat(20, "the moment passed");
        }
        break;
      }
      case "charge": {
        go(me.x, me.z, sp.charge); setDesc(`${sp.desc} It is coming straight at you.`, "charging");
        if (e.props.bluff && d < 3.2) { st.mode = "retreat"; st.until = now + 15_000; away(16); st.cool = now + sp.cool! * 1000; e.props.bluff = false; this.notify("The bear thunders at you and stops, rearing up a few paces away, roaring. Then it drops and backs off, huffing. A warning."); setDesc(sp.desc); break; }
        if (d < 1.8) { st.mode = "fight"; st.hits = 0; st.nextHit = now; }
        else if (shel && d < 6 || now > st.until) retreat(20, "unable to reach you");
        break;
      }
      case "fight": {                                                           // it does not stop at one blow
        e.props.heading = Math.atan2(me.z - e.z, me.x - e.x);
        if (d > 3) { st.mode = "charge"; st.until = now + 8000; break; }
        if (bodyApi.isDead()) { st.mode = "wander"; setDesc(sp.desc); break; }
        if (key === "bear" && (me.sleeping || frozen) && (st.hits ?? 0) >= 1) { retreat(60, "losing interest in something that doesn't move"); st.cool = now + sp.cool! * 1000; break; }
        if (now >= (st.nextHit ?? 0)) {
          this.attack(e, sp, shel, frozen); st.hits = (st.hits ?? 0) + 1; st.nextHit = now + sp.gap! * rand(0.8, 1.2);
          if (st.hits >= sp.hits!) { st.cool = now + sp.cool! * 1000; retreat(40, "for now"); }
        }
        break;
      }
      default: {                                                                // wander, and notice
        setDesc(sp.desc);
        if (key === "bear") {                                                   // food draws a bear
          const food = [...w.inventory.values()].some((i) => (i.kind === "berry" || i.kind === "fish") && i.qty >= 2);
          if (food && d < 18 && d > 8 && now > st.cool && !prot) { go(me.x, me.z, sp.speed); if (now - st.warnedAt > 120_000) { st.warnedAt = now; this.say("A bear lifts its nose toward you, testing the air. It smells what you are carrying.", e, 20); } break; }
        }
        roam(key === "wolf" ? 22 : 10, key === "wolf" ? 2 : 4, key === "wolf" ? 6 : 14);
        const newborn = now - bodyApi.born() < cfg("newbornGrace") * 60_000;          // a new life is given time to learn before it is hunted
        const sees = !newborn && d < sp.notice! * (me.sleeping ? 1.3 : 1) && now > st.cool && !scared && !prot;
        if (!sees) break;
        if (key === "wolf") {
          st.mode = "stalk"; st.ang = Math.atan2(e.z - me.z, e.x - me.x); st.until = now + (me.sleeping ? rand(12, 20) : rand(45, 80)) * 1000;
          if (now - st.warnedAt > 180_000) { st.warnedAt = now; this.say("At the edge of the dark, a pair of pale eyes catches the light. A wolf, watching you, and it is not alone.", e, 40); }
        } else if (d < (key === "bear" ? 11 : 6.5)) {
          st.mode = "warn"; st.until = now + rand(3.5, 5.5) * 1000;
          this.say(key === "bear" ? "A bear rears up on its hind legs, huffing and swaying. It has seen you, and it does not like how close you are." : "A boar's head comes up. It snorts, stamps, and rakes the ground with a tusk. It has marked you as a threat.", e, 20);
        }
      }
    }
  }

  private attack(e: Entity, sp: Sp, shel: boolean, frozen: boolean) {
    const w = this.w, me = w.me, key = e.props.species as string;
    if (shel && sr() < 0.8) return void this.notify(`The ${key} hits the edge of your shelter and veers off, snarling.`);
    if (key === "bear" && frozen && sr() < 0.5) return void this.notify("The bear rears over you, sniffs, and lumbers away. Staying still saved you.");
    const [kind, parts, lo, hi, heal, msg] =
      key === "wolf" ? ["bite", ["shin", "forearm", "shoulder"], 0.35, 0.7, 45, "A wolf lunges and sinks its teeth into you."]
      : key === "boar" ? ["gore", ["hip", "shin", "side"], 0.45, 0.85, 60, "The boar slams into you and rips upward with a tusk."]
      : ["claw", ["shoulder", "back", "forearm"], 0.65, 0.95, 90, "The bear's paw swings and knocks you flat, claws raking you."] as const;
    const dmg = (key === "wolf" ? rand(8, 16) : key === "boar" ? rand(15, 28) : rand(24, 42)) * cfg("damageScale"), bleed = key === "wolf" ? 5 : key === "boar" ? 4 : 11;
    const text = bodyApi.wound(kind as any, parts[Math.floor(sr() * parts.length)], rand(lo, hi), heal, `a ${key}`, false, dmg, bleed);
    w.stopWalk(`a ${key} attacked you`); if (me.sleeping) w.wake();
    this.emo.bump("dread", 0.6, `mauled by a ${key}`); w.bump({ energy: -6, mood: -9 });
    this.notify(`${msg} Now there is ${text}.`);
    log("need", `${me.name} was attacked by a ${key}: ${text}.`, { perceived: true });
    addMemory(`A ${key} attacked me at (${me.x.toFixed(0)}, ${me.z.toFixed(0)}): ${text}.${this.fireNear() ? "" : " I had no fire."}`, 8, ["danger", "body"]);
    bus.emit("attacked", { by: key });
  }
}

// ---------- River's tools ----------
const wildNear = (w: World, r: number) => w.nearby(r).map((o) => o).filter((o) => o.e.kind === "animal" && o.e.props.wild && WILD[o.e.props.species]);

/** The best thing River is holding to hit with. */
const weapon = (w: World) => {
  const held = [...w.inventory.values()].filter((i) => i.props?.dmg && (w.items.get(i.id)?.condition.durability ?? 1) > 0).sort((a, b) => b.props!.dmg - a.props!.dmg)[0];
  if (held) return { id: held.id, name: held.name, dmg: (held.props!.dmg as number) * (0.4 + 0.6 * (w.items.get(held.id)?.condition.durability ?? 1)), reach: held.props!.reach as number };
  const stick = w.findItem("stick"); return stick ? { id: stick.id, name: "stick", dmg: 5, reach: 1.9 } : { id: "", name: "bare hands", dmg: 2, reach: 1.3 };
};
/** An animal dies: it becomes something River can butcher. */
function kill(e: Entity, w: World, emo: Emotions | null) {
  const sp = e.props.species as string; w.removeEntity(e.id);
  w.spawn("carcass", `${sp} carcass`, e.x, e.z, { species: sp, desc: `The ${sp}, dead. There is meat on it, and a hide worth taking.`, yields: ["meat", "hide"], stock: 3, max: 3, noRegrow: true, expires: simNow() + 25 * 60_000 });
  bus.emit("deed", { kind: "hunt", name: sp });
  emo?.bump("pride", 0.4, `killed a ${sp}`); emo?.bump("dread", -0.2);
  log("world", `River killed a ${sp}.`, { perceived: true }); addMemory(`I killed a ${sp} at (${w.me.x.toFixed(0)}, ${w.me.z.toFixed(0)}) with ${weapon(w).name}.`, 7, ["danger"]);
}

export const DEFEND_TOOL: ToolDef = {
  name: "defend",
  description:
    "Defend yourself from a creature that means you harm, and make weapons. `strike`: hit the nearest dangerous animal in reach with the best thing you hold (bare hands do little; a stick helps; a sharpened stick or a spear do real damage). It will fight back. " +
    "`shout`: a great noise; wolves and boars often back off, a bear may not. `throw`: hurl a stone from range. `freeze`: stand perfectly still; bears and snakes often lose interest in what does not move. " +
    "`sharpen`: whittle a stick to a point, with a stone to scrape it. `bind`: lash a stone point and a strip of bark to a sharpened stick to make a spear. Fire and a shelter also keep animals away.",
  input_schema: obj({ action: { type: "string", enum: ["strike", "shout", "throw", "freeze", "sharpen", "bind"], description: "what to do" }, item: str("throw: the stone to throw (default: a stone)") }, ["action"]),
  run: async (a, w: World) => {
    const act = String(a.action ?? ""), now = simNow();
    if (act === "sharpen" || act === "bind") {
      const r = recipeById(act === "sharpen" ? "sharpen_stick" : "spear")!;
      checkRecipe(w, r);                                                   // a point needs a rod and something to scrape it with; a spear a pointed shaft, a stone head and a binding
      gate(w, r.durationMs, act === "sharpen" ? "sharpening a stick" : "binding a spear");
      const made = craftNow(w, r);
      if (act === "sharpen") { return `You scrape the end of the stick against the stone until it holds a hard, narrow point. (${made.item.name}: hits for about ${made.item.props.dmg}, reaches ${made.item.props.reach}m.)`; }
      w.bump({ mood: 4 });
      return `You wedge the stone into a split in the shaft and bind it tight, wrap after wrap. It has weight, and reach. It is a spear. (Hits for about ${made.item.props.dmg}, reaches ${made.item.props.reach}m.)`;
    }
    if (act === "freeze") { freezeUntil = now + 25_000; w.setActivity("holding perfectly still"); await simSleep(4000); return "You go still, hardly breathing, and let the world move around you. It will last a while if you don't move."; }
    const threats = wildNear(w, 30).filter((o) => WILD[o.e.props.species].cls === "predator");
    if (act === "strike") {
      const wp = weapon(w), t = threats[0];
      if (!t || t.d > wp.reach + 1.1) throw new ToolError(t ? `The nearest threat is ${t.d.toFixed(0)}m away; with ${wp.name} you must be within ${(wp.reach + 1.1).toFixed(0)}m.` : "Nothing dangerous is close enough to strike.");
      w.setActivity("fighting"); await simSleep(900); w.bump({ energy: -3 }); if (wp.id) w.items.wear(wp.id, 0.04);   // hitting things wears what hits
      const e = t.e, dmg = wp.dmg * rand(0.7, 1.3), max = e.props.maxHp ?? 40;
      e.props.hp = (e.props.hp ?? max) - dmg; instance?.provoke(e);
      if (e.props.hp <= 0) { kill(e, w, (instance as any)?.emo ?? null); return `You drive ${wp.name} home and the ${e.props.species} staggers, drops, and does not get up. It is dead. Your hands are shaking.`; }
      w.putEntity(e);
      const left = e.props.hp / max;
      return `You strike the ${e.props.species} with ${wp.name}. ${left > 0.7 ? "It barely seems to notice." : left > 0.4 ? "It howls and its blows come wilder." : "It is badly hurt; it is wavering, looking for a way out."}`;
    }
    if (act === "shout") {
      w.setActivity("shouting"); await simSleep(1500); w.bump({ energy: -2 }); noiseUntil = now + 10_000;
      if (!threats.length) return "You shout. Your voice goes out over the island and nothing answers.";
      const out: string[] = [];
      for (const { e, d } of threats) if (d < 24) { const chance = e.props.species === "bear" ? 0.4 : 0.6; if (sr() < chance) { e.props.scaredUntil = now + 40_000; out.push(`the ${e.props.species} flinches and backs away`); } else out.push(`the ${e.props.species} is not impressed`); }
      return out.length ? `You roar at the dark. ${out.join("; ")}.` : "You shout, but nothing is near enough to hear it.";
    }
    if (act === "throw") {
      const stone = a.item ? w.findItem(String(a.item)) : w.findItem("stone");
      if (!stone || stone.kind !== "stone") throw new ToolError("You need a stone in your hands to throw.");
      const t = threats.find((o) => o.d < 14); if (!t) throw new ToolError("There's no dangerous animal close enough to throw at.");
      w.setActivity("throwing a stone"); w.takeItem(stone.id, 1); await simSleep(1200);
      const hit = sr() < clamp(0.85 - t.d * 0.035, 0.25, 0.8);
      if (hit) { t.e.props.hp = (t.e.props.hp ?? 40) - 5; if (t.e.props.hp > 0) { t.e.props.scaredUntil = now + 25_000; return `The stone cracks against the ${t.e.props.species}'s flank. It yelps and shies away, for now.`; } kill(t.e, w, null); return `The stone catches the ${t.e.props.species} and it falls. It is dead.`; }
      return `Your stone skips past the ${t.e.props.species}. It doesn't even turn its head.`;
    }
    throw new ToolError("Use strike, shout, throw, freeze, sharpen or bind.");
  },
};

export const FISH_TOOL: ToolDef = {
  name: "fish",
  description:
    "Try to catch a fish with your hands from the water's edge. You must stand at the shore with fish close enough to reach; stand still and be patient. A catch is food. Cook it over a fire for more.",
  input_schema: obj({}),
  run: async (_a, w: World) => {
    const wet = (x: number, z: number) => !isLand(x, z, w.seed), me = w.me;
    const shore = [[2, 0], [-2, 0], [0, 2], [0, -2], [1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]].some(([dx, dz]) => wet(me.x + dx, me.z + dz));
    if (!shore) throw new ToolError("You are not at the water's edge. Walk to the shore first.");
    const fish = wildNear(w, 7).find((o) => o.e.props.species === "fish");
    if (!fish) throw new ToolError("You crouch and wait, but no fish come near enough to the shore.");
    w.setActivity("waiting for a fish"); await simSleep(6000);
    const calm = simNow() > noiseUntil ? 0.15 : 0, got = sr() < 0.3 + calm - fish.d * 0.02;
    w.bump({ energy: -3, curiosity: -2 });
    if (!got) return "A silver shape glides past your fingers and is gone. You wait for another.";
    bus.emit("deed", { kind: "fish", name: "fish" });
    w.removeEntity(fish.e.id); w.addItem("fish", "silver fish", "A cold, silver fish, still twitching. Good food, better cooked.", 1);
    w.bump({ mood: 5 });
    return "Your hands close, and a fish flops hard against your palms. You hold on and drag it up onto the stones.";
  },
};
