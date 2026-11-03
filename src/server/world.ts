import { cfg } from "./config.ts";
import { warmthFactor, worn } from "./clothing.ts";
import { bodyView } from "./body.ts";
import { db, kvGet, kvSet } from "./db.ts";
import { bus, log } from "./bus.ts";
import { DEFAULT_SEED, HALF, WORLD_SIZE, groveness, heightAt, isLand, mulberry32 } from "../shared/noise.ts";
import { HEAT_N } from "../shared/types.ts";
import type { EmotionName } from "../shared/emotions.ts";
import type { AgentView, Entity, EntityKind, InventoryItem, Needs, Weather } from "../shared/types.ts";

export const dayMs = () => cfg("dayMinutes") * 60_000;
/** distance from a point to a line segment */
export function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l2));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}           // one world day = 24 real minutes
const WALK_SPEED = 3;                         // units / second
const REACH = 5;                              // interaction distance
const OBSTACLES: EntityKind[] = ["tree", "rock", "shrine", "monolith", "structure"];


export class World {
  seed = DEFAULT_SEED;
  entities = new Map<string, Entity>();
  inventory = new Map<string, InventoryItem>();
  epoch = 0;
  weather: Weather = "clear";
  /** current feelings, set by the Emotions system once a second so the viewer can show them */
  feelings: Partial<Record<EmotionName, number>> = {};
  /** set by the server: the Fire system (kept loosely typed to avoid an import cycle) */
  fire: unknown;
  /** set by the server: individual animals and the Keeper story (loosely typed to avoid import cycles) */
  creatures: unknown;
  story: unknown;
  /** How much each ~2m cell has been walked. Wears into visible paths in the viewer. */
  heat = new Float32Array(HEAT_N * HEAT_N);
  /** Burnt ground. Painted dark in the viewer; fades very slowly. */
  scorch = new Float32Array(HEAT_N * HEAT_N);
  private lastScorchEmit = 0;
  private heatDirty = false;
  private lastHeatSave = 0;
  private sleepStart = 0;
  private nextId = 1;
  private quiet = false;                      // suppress change broadcasts while regenerating

  me = {
    name: process.env.AGENT_NAME ?? "River",
    x: 0, z: 0, heading: 0,
    activity: "waking up", speech: null as string | null, speechUntil: 0,
    sleeping: false, sleepUntil: 0, thinking: false,
    needs: { energy: 90, hunger: 70, mood: 60, curiosity: 70, warmth: 75 } as Needs,
  };
  private walk: { x: number; z: number; label: string; resolve: (r: { arrived: boolean; reason?: string }) => void; stuck: number; lastD: number } | null = null;
  private lastSave = 0;
  private lastGrow = 0;

  init() {
    this.seed = kvGet<number>("seed", DEFAULT_SEED);
    this.epoch = kvGet<number>("epoch", 0);
    if (!this.epoch) { this.epoch = Date.now() - 0.3 * dayMs(); kvSet("epoch", this.epoch); }
    this.nextId = kvGet<number>("nextId", 1);
    this.weather = kvGet<{ w: Weather }>("weather", { w: "clear" }).w;
    const rows = db.prepare("SELECT * FROM entities").all() as any[];
    if (rows.length === 0) this.generate();
    else for (const r of rows) this.entities.set(r.id, { id: r.id, kind: r.kind, name: r.name, x: r.x, z: r.z, props: JSON.parse(r.props) });
    this.ensureMaterials();
    for (const r of db.prepare("SELECT * FROM inventory").all() as any[])
      this.inventory.set(r.id, { id: r.id, kind: r.kind, name: r.name, desc: r.desc, qty: r.qty, props: r.props ? JSON.parse(r.props) : undefined });
    const h = kvGet<number[]>("heat", []); if (h.length === this.heat.length) this.heat.set(h);
    const sc = kvGet<number[]>("scorch", []); if (sc.length === this.scorch.length) this.scorch.set(sc);
    const saved = kvGet<any>("agent", null);
    if (saved) Object.assign(this.me, { x: saved.x, z: saved.z, heading: saved.heading, needs: saved.needs, name: saved.name ?? this.me.name });
    else { this.me.x = 4; this.me.z = 4; }
    this.me.needs.warmth ??= 75;                          // lives saved before warmth existed
    if (!isLand(this.me.x, this.me.z, this.seed)) { this.me.x = 4; this.me.z = 4; }
  }

  /**
   * Natural sources of building materials and pigments: clay on the low shores, chalk on the ridges, moss on boulders.
   * Idempotent, so an island made before these existed gains them without being regenerated.
   */
  ensureMaterials() {
    const rng = mulberry32(this.seed ^ 0x51ab), have = (n: string) => [...this.entities.values()].some((e) => e.name === n);
    const put = (name: string, count: number, accept: (h: number) => boolean, props: Record<string, any>) => {
      if (have(name)) return;
      for (let tries = 0, placed = 0; tries < count * 300 && placed < count; tries++) {
        const x = (rng() * 2 - 1) * (HALF - 6), z = (rng() * 2 - 1) * (HALF - 6), h = heightAt(x, z, this.seed);
        if (!isLand(x, z, this.seed) || !accept(h) || [...this.entities.values()].some((e) => Math.hypot(e.x - x, e.z - z) < 2.5)) continue;
        this.spawn("rock", name, x, z, { ...props }); placed++;
      }
    };
    put("clay bank", 5, (h) => h > 0.3 && h < 1.4, { stock: 3, max: 5, yields: ["clay"], desc: "A bank of fine, cool clay, red-brown where the water has cut into it." });
    put("chalk outcrop", 4, (h) => h > 3.4, { stock: 3, max: 4, yields: ["chalk"], desc: "A pale outcrop of soft chalk that leaves a white mark on whatever it touches." });
    for (const e of this.entities.values()) if (e.kind === "tree" && e.props.yields && !e.props.noRegrow && !e.props.yields.includes("bark")) { e.props.yields.push("bark"); this.putEntity(e); }
    for (const e of this.entities.values()) if (e.name === "mossy boulder" && !e.props.yields?.includes("moss")) { e.props.yields = ["stone", "moss"]; this.putEntity(e); }
  }

  // ---------- generation ----------
  private newId(prefix: string) { const id = `${prefix}_${this.nextId++}`; kvSet("nextId", this.nextId); return id; }

  private generate() {
    const rng = mulberry32(this.seed);
    const spots: { x: number; z: number }[] = [];
    const place = (minGap: number, filter: (x: number, z: number, h: number) => boolean = () => true) => {
      for (let tries = 0; tries < 200; tries++) {
        const x = (rng() * 2 - 1) * (HALF - 4), z = (rng() * 2 - 1) * (HALF - 4);
        const h = heightAt(x, z, this.seed);
        if (!isLand(x, z, this.seed) || !filter(x, z, h)) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minGap)) continue;
        spots.push({ x, z }); return { x, z };
      }
      return null;
    };
    const add = (kind: EntityKind, name: string, p: { x: number; z: number } | null, props: Record<string, any> = {}) => {
      if (p) this.putEntity({ id: this.newId(kind), kind, name, x: p.x, z: p.z, props });
      return p;
    };

    // No structures are generated: the library, shrine, monolith, campfire and lookouts live in the catalog (catalog.ts) and are placed by hand.
    // Keep the start clear, so River doesn't wake up inside a tree.
    spots.push({ x: 2, z: 2 }, { x: 4, z: 4 });

    // flora & resources, shaped by biome: groves of trees, open meadows of single-colour flowers, ridges of stone, marshy shores.
    const g = (x: number, z: number) => groveness(x, z, this.seed);
    /** keep sampling until `count` things have been placed, accepting each candidate with probability accept(x, z, h) */
    const scatter = (count: number, minGap: number, accept: (x: number, z: number, h: number) => number, make: (x: number, z: number, h: number) => void) => {
      let placed = 0;
      for (let tries = 0; tries < count * 80 && placed < count; tries++) {
        const x = (rng() * 2 - 1) * (HALF - 4), z = (rng() * 2 - 1) * (HALF - 4), h = heightAt(x, z, this.seed);
        if (!isLand(x, z, this.seed) || rng() > accept(x, z, h)) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minGap)) continue;
        spots.push({ x, z }); make(x, z, h); placed++;
      }
    };
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const treeAt = (x: number, z: number, h: number) => {
      const gv = g(x, z), name = h > 4.2 ? "tall pine" : h < 1.7 ? (rng() < 0.7 ? "twisted willow" : "silver birch") : gv > 0.62 ? "old oak" : (rng() < 0.6 ? "silver birch" : "old oak");
      add("tree", name, { x, z }, { stock: 3, max: 4, yields: ["stick", "seed", "bark"], desc: "A tree. Sticks, seeds and loose strips of bark can be found at its base." });
    };
    scatter(120, 3, (x, z) => clamp01((g(x, z) - 0.36) * 3.2), treeAt);                                              // groves
    scatter(24, 3, (x, z) => clamp01(0.5 - Math.abs(g(x, z) - 0.42) * 4), treeAt);                                   // a few lone trees at the grove edges
    scatter(48, 3, (x, z, h) => clamp01((h - 2.5) * 0.45) * 0.9 + 0.12, (x, z) => { const mossy = rng() < 0.2; add("rock", mossy ? "mossy boulder" : "grey rock", { x, z }, { stock: 2, max: 3, yields: mossy ? ["stone", "moss"] : ["stone"], desc: mossy ? "A boulder furred with soft green moss." : "A weathered rock." }); });
    scatter(40, 3, (x, z) => clamp01(1 - Math.abs(g(x, z) - 0.46) * 5), (x, z) => add("bush", "berry bush", { x, z }, { stock: 3, max: 5, yields: ["berry"], desc: "A bush heavy with small red berries." }));   // ecotone: where grove meets meadow
    // flowers: a handful of meadow patches, each a single colour (more beautiful than a uniform sprinkle)
    const flowerNames = ["blue starflower", "yellow buttercup", "pale violet", "red poppy"];
    for (let patch = 0, tries = 0; patch < 7 && tries < 400; tries++) {
      const cx = (rng() * 2 - 1) * (HALF - 12), cz = (rng() * 2 - 1) * (HALF - 12), h = heightAt(cx, cz, this.seed);
      if (!isLand(cx, cz, this.seed) || g(cx, cz) > 0.34 || h < 1 || h > 4.4) continue;
      const name = flowerNames[patch % flowerNames.length];
      for (let k = 0; k < 9; k++) { const a = rng() * Math.PI * 2, r = 1 + rng() * 5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (isLand(x, z, this.seed) && !spots.some((s) => Math.hypot(s.x - x, s.z - z) < 1.6)) { spots.push({ x, z }); add("flower", name, { x, z }, { takeable: true, item: "flower", desc: "A wildflower." }); } }
      patch++;
    }
    scatter(24, 2, (x, z) => clamp01((g(x, z) - 0.55) * 4), (x, z) => add("mushroom", rng() < 0.3 ? "glowcap mushroom" : "brown mushroom", { x, z }, { takeable: true, item: "mushroom", desc: "A mushroom growing in the damp." }));  // the deep grove
    scatter(18, 3, (x, z, h) => (h < 0.9 ? 1 : 0), (x, z) => add("shell", "spiral shell", { x, z }, { takeable: true, item: "shell", desc: "A spiral shell, smooth from the sea." }));
  }

  /**
   * A brand-new life. The caller has already wiped the database tables; this resets the in-memory state to match.
   * `freshWorld` also rolls a new island (new seed, new layout, no burns, no paths, day 1).
   */
  reset(freshWorld: boolean) {
    this.walk?.resolve({ arrived: false, reason: "a new life began" }); this.walk = null;
    Object.assign(this.me, { x: 4, z: 4, heading: 0, activity: "waking up", speech: null, speechUntil: 0, sleeping: false, sleepUntil: 0, thinking: false, needs: { energy: 90, hunger: 70, mood: 60, curiosity: 70, warmth: 75 } });
    this.inventory.clear(); this.sleepStart = 0;
    for (const e of [...this.entities.values()]) if (e.props.beat) this.removeEntity(e.id);   // the old story's traces
    if (freshWorld) {
      this.quiet = true;
      this.seed = Math.floor(Math.random() * 2_000_000_000); kvSet("seed", this.seed);
      this.entities.clear(); this.nextId = 1; kvSet("nextId", 1);
      this.epoch = Date.now() - 0.3 * dayMs(); kvSet("epoch", this.epoch);
      this.weather = "clear"; kvSet("weather", { w: "clear", until: 0 });
      this.heat.fill(0); this.scorch.fill(0); kvSet("heat", []); kvSet("scorch", []);
      this.generate(); this.ensureMaterials();
      if (!isLand(this.me.x, this.me.z, this.seed)) { const p = this.spotNearMe(1); this.me.x = p.x; this.me.z = p.z; }
      this.quiet = false;
    }
    kvSet("agent", { x: this.me.x, z: this.me.z, heading: 0, needs: this.me.needs, name: this.me.name });
  }

  // ---------- entity ops ----------
  putEntity(e: Entity) {
    this.entities.set(e.id, e);
    db.prepare("INSERT INTO entities(id,kind,name,x,z,props) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,x=excluded.x,z=excluded.z,props=excluded.props")
      .run(e.id, e.kind, e.name, e.x, e.z, JSON.stringify(e.props));
    if (!this.quiet) bus.emit("entity", { t: "entity", op: "upsert", entity: e });
  }
  /** Move an entity without persisting (animals move constantly; the ambient loop persists them occasionally). */
  moveEntity(e: Entity) { bus.emit("entity", { t: "entity", op: "upsert", entity: e }); }
  removeEntity(id: string) {
    this.entities.delete(id);
    db.prepare("DELETE FROM entities WHERE id = ?").run(id);
    if (!this.quiet) bus.emit("entity", { t: "entity", op: "remove", id });
  }
  spawn(kind: EntityKind, name: string, x: number, z: number, props: Record<string, any>) {
    const e: Entity = { id: this.newId(kind), kind, name, x, z, props };
    this.putEntity(e);
    return e;
  }
  /** nearest valid land position around the agent for placing things */
  spotNearMe(dist = 2): { x: number; z: number } {
    for (let i = 0; i < 12; i++) {
      const a = this.me.heading + (i * Math.PI) / 6;
      const x = this.me.x + Math.cos(a) * dist, z = this.me.z + Math.sin(a) * dist;
      if (isLand(x, z, this.seed)) return { x, z };
    }
    return { x: this.me.x, z: this.me.z };
  }

  isLandAt(x: number, z: number) { return isLand(x, z, this.seed); }
  /** 0..1: how much a nearby fire, lamp or hearth is warming River. */
  warmSource(): number {
    let best = 0;
    for (const e of this.entities.values()) {
      const d = Math.hypot(e.x - this.me.x, e.z - this.me.z);
      const reach = e.kind === "campfire" && e.props.lit !== false ? 7 : e.props.burning ? 5 : e.props.glow ? 5 : 0;
      if (reach && d < reach) best = Math.max(best, (1 - d / reach) * (e.props.burning ? 0.7 : e.props.glow ? 0.6 : 1));
    }
    return best;
  }
  /** Is there a light close by (hearth, flames, a lamp)? */
  lit(): boolean { return [...this.entities.values()].some((e) => ((e.kind === "campfire" && e.props.lit !== false) || e.props.burning || e.props.glow) && Math.hypot(e.x - this.me.x, e.z - this.me.z) < 10); }
  /** How far River can make things out: the dark, fog and storms close the world in; a fire pushes the dark back. */
  sightRadius(): number {
    const t = this.worldTime(), night = t < 0.23 || t > 0.78;
    let r = night ? 11 : 32;
    if (this.weather === "fog") r = Math.min(r, 14); else if (this.weather === "storm") r = Math.min(r, 17); else if (this.weather === "rain") r = Math.min(r, 24);
    return this.lit() ? Math.max(r, 26) : r;
  }

  dist(e: { x: number; z: number }) { return Math.hypot(e.x - this.me.x, e.z - this.me.z); }
  inReach(e: Entity) { return this.dist(e) <= REACH; }
  nearby(radius: number): { e: Entity; d: number }[] {
    return [...this.entities.values()].map((e) => ({ e, d: this.dist(e) })).filter((o) => o.d <= radius).sort((a, b) => a.d - b.d);
  }
  compass(e: { x: number; z: number }) {
    const a = Math.atan2(e.z - this.me.z, e.x - this.me.x); // +x = east, +z = south
    const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
    return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
  }

  // ---------- inventory ----------
  addItem(kind: string, name: string, desc: string, qty = 1, props?: Record<string, any>) {
    const existing = [...this.inventory.values()].find((i) => i.kind === kind && i.name === name && !props?.text && i.props?.hex === props?.hex);
    if (existing) { existing.qty += qty; this.saveItem(existing); }
    else {
      const it: InventoryItem = { id: this.newId("item"), kind, name, desc, qty, props };
      this.inventory.set(it.id, it); this.saveItem(it);
    }
    bus.emit("state");
  }
  private saveItem(it: InventoryItem) {
    db.prepare("INSERT INTO inventory(id,kind,name,desc,qty,props) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET qty=excluded.qty, name=excluded.name, desc=excluded.desc, props=excluded.props")
      .run(it.id, it.kind, it.name, it.desc, it.qty, it.props ? JSON.stringify(it.props) : null);
  }
  renameItem(id: string, name: string) { const it = this.inventory.get(id); if (!it) return; it.name = name; this.saveItem(it); bus.emit("state"); }
  takeItem(id: string, qty = 1): InventoryItem | null {
    const it = this.inventory.get(id);
    if (!it || it.qty < qty) return null;
    it.qty -= qty;
    if (it.qty <= 0) { this.inventory.delete(id); db.prepare("DELETE FROM inventory WHERE id = ?").run(id); } else this.saveItem(it);
    bus.emit("state");
    return { ...it, qty };
  }
  findItem(ref: string): InventoryItem | undefined {
    const r = ref.toLowerCase();
    return this.inventory.get(ref) ?? [...this.inventory.values()].find((i) => i.name.toLowerCase() === r || i.kind.toLowerCase() === r);
  }

  // ---------- time ----------
  /** The world controller moves time forward to the next dawn. */
  skipToDawn(): number {
    const dm = dayMs(), f = this.worldTime(), adv = ((f < 0.25 ? 0.25 - f : 1.25 - f)) * dm;
    this.epoch -= adv; kvSet("epoch", this.epoch); return this.day();
  }
  /** Day length changed: keep the same moment of the same day. */
  rebaseDay(oldMs: number) { const elapsed = (Date.now() - this.epoch) / oldMs; this.epoch = Date.now() - elapsed * dayMs(); kvSet("epoch", this.epoch); }
  worldTime() { return (((Date.now() - this.epoch) / dayMs()) % 1 + 1) % 1; }
  day() { return Math.floor((Date.now() - this.epoch) / dayMs()) + 1; }
  timeLabel() {
    const t = this.worldTime() * 24, h = Math.floor(t), m = Math.floor((t - h) * 60);
    const part = h < 5 ? "deep night" : h < 8 ? "dawn" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night";
    return `Day ${this.day()}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${part})`;
  }

  // ---------- agent actions ----------
  setActivity(a: string) { this.me.activity = a; }
  say(text: string) { this.me.speech = text; this.me.speechUntil = Date.now() + Math.min(12000, 3000 + text.length * 60); }
  bump(n: Partial<Needs>) {
    for (const k of Object.keys(n) as (keyof Needs)[]) this.me.needs[k] = Math.max(0, Math.min(100, this.me.needs[k] + (n[k] ?? 0)));
  }

  walkTo(x: number, z: number, label: string): Promise<{ arrived: boolean; reason?: string }> {
    this.walk?.resolve({ arrived: false, reason: "interrupted by a new destination" });
    if (this.me.sleeping) return Promise.resolve({ arrived: false, reason: "you are asleep" });
    if (!this.walkable(x, z)) return Promise.resolve({ arrived: false, reason: "that spot is water or off the island" });
    return new Promise((resolve) => {
      this.walk = { x, z, label, resolve, stuck: 0, lastD: Infinity };
      this.me.activity = `walking to ${label}`;
      // safety timeout
      setTimeout(() => { if (this.walk?.resolve === resolve) this.finishWalk(false, "took too long"); }, 90_000);
    });
  }
  /** Something stops River mid-step (a fall, say). The walk reports why. */
  stopWalk(reason: string) { this.walk && this.finishWalk(false, reason); }
  private finishWalk(arrived: boolean, reason?: string) {
    const w = this.walk; this.walk = null;
    if (w) { this.me.activity = arrived ? "idle" : this.me.activity; w.resolve({ arrived, reason }); }
  }
  restFor(seconds: number): Promise<void> {
    const s = Math.max(3, Math.min(60, seconds));
    this.sleepStart = Date.now(); this.me.sleeping = true; this.me.sleepUntil = Date.now() + s * 1000; this.me.activity = "resting";
    return new Promise((r) => setTimeout(() => { this.wake(); r(); }, s * 1000));
  }
  /** End sleep (idempotent). Long sleeps are announced so the agent can dream. */
  wake() {
    if (!this.me.sleeping) return;
    const secs = (Date.now() - (this.sleepStart || Date.now())) / 1000;
    this.me.sleeping = false; this.me.activity = "idle"; this.sleepStart = 0;
    if (secs >= 15) bus.emit("slept", { seconds: secs });
  }

  /** Char the ground around a point. */
  burnMark(x: number, z: number, radius = 2.4, amount = 1) {
    const cell = WORLD_SIZE / HEAT_N, r = Math.ceil(radius / cell);
    const cx = Math.floor(((x + HALF) / WORLD_SIZE) * HEAT_N), cz = Math.floor(((z + HALF) / WORLD_SIZE) * HEAT_N);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const gx = cx + dx, gz = cz + dz; if (gx < 0 || gz < 0 || gx >= HEAT_N || gz >= HEAT_N) continue;
      const d = Math.hypot(dx * cell, dz * cell); if (d > radius) continue;
      const i = gz * HEAT_N + gx; this.scorch[i] = Math.min(4, this.scorch[i] + amount * (1 - d / (radius + 0.01) * 0.6));
    }
    kvSet("scorch", Array.from(this.scorch, (v) => Math.round(v * 100) / 100));
    if (Date.now() - this.lastScorchEmit > 1500) { this.lastScorchEmit = Date.now(); bus.emit("heat"); }
  }

  private stamp(x: number, z: number, dt: number) {
    const cx = Math.floor(((x + HALF) / WORLD_SIZE) * HEAT_N), cz = Math.floor(((z + HALF) / WORLD_SIZE) * HEAT_N);
    if (cx < 0 || cz < 0 || cx >= HEAT_N || cz >= HEAT_N) return;
    const i = cz * HEAT_N + cx; this.heat[i] = Math.min(255, this.heat[i] + dt); this.heatDirty = true;
  }

  /** Is (x, z) on the deck of a bridge River has built? */
  bridgeAt(x: number, z: number): boolean {
    for (const e of this.entities.values()) {
      const p = e.props.path; if (e.kind !== "structure" || e.props.shape !== "bridge" || !p) continue;
      if (segDist(x, z, p.x1, p.z1, p.x2, p.z2) <= (p.width ?? 1.8) / 2 + 0.15) return true;
    }
    return false;
  }
  /** Can River stand here: on the island, or on a bridge over the water. */
  walkable(x: number, z: number) { return isLand(x, z, this.seed) || this.bridgeAt(x, z); }

  private blocked(x: number, z: number, fromX = x, fromZ = z) {
    if (!this.walkable(x, z)) return true;
    for (const e of this.entities.values()) {          // flames can't be walked into, but you can always walk away from them
      if (!e.props.burning) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < 1.4 && d < Math.hypot(e.x - fromX, e.z - fromZ)) return true;
    }
    for (const e of this.entities.values()) {
      if (!OBSTACLES.includes(e.kind)) continue;
      if (e.kind === "structure" && e.props.shape) {                       // things River built have real shapes
        if (e.props.walk) continue;                                        // platforms and bridges are walked on
        const p = e.props.path;
        if (p ? segDist(x, z, p.x1, p.z1, p.x2, p.z2) < (p.width ?? 0.5) / 2 + 0.35 : Math.hypot(e.x - x, e.z - z) < (e.props.radius ?? 1.2)) return true;
        continue;
      }
      if (Math.abs(e.x - x) < 1.2 && Math.abs(e.z - z) < 1.2 && Math.hypot(e.x - x, e.z - z) < (e.kind === "library" ? 2.8 : 1.0)) return true;
    }
    return false;
  }

  /** 10Hz simulation step */
  tick(dt: number) {
    const m = this.me, now = Date.now();
    if (m.speech && now > m.speechUntil) m.speech = null;

    // needs
    const rate = m.sleeping ? 0.3 : 1, nr = cfg("needsRate");
    m.needs.hunger = Math.max(0, m.needs.hunger - 0.022 * dt * rate * nr);
    if (m.sleeping) m.needs.energy = Math.min(100, m.needs.energy + 1.2 * dt);
    else m.needs.energy = Math.max(0, m.needs.energy - (this.walk ? 0.05 : 0.025) * dt * nr);
    m.needs.curiosity = Math.min(100, m.needs.curiosity + 0.04 * dt);
    const target = (m.needs.energy + m.needs.hunger) / 2;
    m.needs.mood += (target - m.needs.mood) * 0.01 * dt;
    if (this.weather === "rain" || this.weather === "storm") m.needs.mood = Math.max(0, m.needs.mood - 0.012 * dt);
    // warmth: the night, rain and wind take it; fire, shelter and sun give it back
    {
      const t = this.worldTime(), night = t < 0.23 || t > 0.78;
      let loss = (night ? 0.045 : 0) + (this.weather === "rain" ? 0.035 : this.weather === "storm" ? 0.07 : this.weather === "windy" ? 0.02 : this.weather === "fog" ? 0.01 : 0);
      const sheltered = [...this.entities.values()].some((e) => e.kind === "structure" && (e.props.shelter ?? !e.props.shape) && Math.hypot(e.x - m.x, e.z - m.z) < 3.2 + (e.props.radius ?? 0));
      if (sheltered) loss *= 0.4;
      loss *= (1 - warmthFactor()) * nr;                         // clothes turn some of it away
      const gain = (!night && (this.weather === "clear" || this.weather === "windy") ? 0.03 : 0) + this.warmSource() * 0.35;
      m.needs.warmth = Math.max(0, Math.min(100, m.needs.warmth + (gain - loss) * dt));
      if (m.needs.warmth < 30) { m.needs.energy = Math.max(0, m.needs.energy - 0.02 * dt); m.needs.mood = Math.max(0, m.needs.mood - 0.01 * dt); }   // cold wears you down
    }

    if (!m.sleeping && m.needs.energy <= 0) {
      this.sleepStart = now; m.sleeping = true; m.sleepUntil = now + 30_000; m.activity = "collapsed from exhaustion";
      this.walk && this.finishWalk(false, "you collapsed from exhaustion");
      log("need", `${m.name} collapsed from exhaustion and fell asleep.`);
    }
    if (m.sleeping && now >= m.sleepUntil) this.wake();

    // walking
    if (this.walk && !m.sleeping) {
      const w = this.walk, dx = w.x - m.x, dz = w.z - m.z, d = Math.hypot(dx, dz);
      if (d < 0.6) { this.finishWalk(true); }
      else {
        const base = Math.atan2(dz, dx);
        let moved = false;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
          const a = base + off, nx = m.x + Math.cos(a) * WALK_SPEED * dt, nz = m.z + Math.sin(a) * WALK_SPEED * dt;
          if (!this.blocked(nx, nz, m.x, m.z)) { m.x = nx; m.z = nz; m.heading = a; moved = true; this.stamp(nx, nz, dt); break; }
        }
        if (!moved || d > w.lastD - 0.002) w.stuck += dt; else w.stuck = Math.max(0, w.stuck - dt);
        w.lastD = Math.min(w.lastD, d);
        if (w.stuck > 3) this.finishWalk(false, "path is blocked");
      }
    }
    if (!this.walk && !m.sleeping && m.activity.startsWith("walking")) m.activity = "idle";

    // world processes (every 5s): regrowth and sprouts
    if (now - this.lastGrow > 5000) {
      this.lastGrow = now;
      for (const e of this.entities.values()) {
        const p = e.props;
        if (p.yields && !p.noRegrow && p.stock < p.max && now - (p.lastTake ?? 0) > 60_000) { p.stock++; p.lastTake = now; this.putEntity(e); }
        if (e.kind === "sprout" && now - p.born > p.ms / (this.weather === "rain" || this.weather === "storm" ? 2 : 1)) {
          e.kind = p.grow; e.name = p.grownName; e.props = p.grown; this.putEntity(e);
          log("observation", `The sprout you planted has grown into ${e.name} at (${e.x.toFixed(0)}, ${e.z.toFixed(0)}).`, { id: e.id });
          this.bump({ mood: 8 });
        }
      }
    }

    if (now - this.lastHeatSave > 20_000) {
      this.lastHeatSave = now;
      if (this.heatDirty) {
        this.heatDirty = false;
        for (let i = 0; i < this.heat.length; i++) this.heat[i] *= 0.9993;      // unused paths slowly fade
        kvSet("heat", Array.from(this.heat, (v) => Math.round(v * 10) / 10));
        bus.emit("heat");
      }
    }
    if (now - this.lastSave > 5000) {
      this.lastSave = now;
      kvSet("agent", { x: m.x, z: m.z, heading: m.heading, needs: m.needs, name: m.name });
    }
  }

  view(): AgentView {
    const m = this.me;
    return { name: m.name, x: m.x, z: m.z, heading: m.heading, activity: m.activity, speech: m.speech, sleeping: m.sleeping,
      needs: m.needs, weather: this.weather, feelings: this.feelings, worldTime: this.worldTime(), day: this.day(), thinking: m.thinking, worn: worn(), body: bodyView() };
  }
}
