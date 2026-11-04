// The item registry: every physical item that exists, as an instance with one identity and exactly one location.
// It is the authority. The world's inventory map and the item entities on the ground are projections it keeps in step, and the
// old World API (addItem, takeItem, findItem) is an adapter over it, so the rest of the game did not have to change.
//
// Rules, checked by audit():
//  - every live item has exactly one location: the ground, River's hands, a body slot, or inside another item;
//  - a container never holds itself, directly or through other containers, and never holds more than it can carry;
//  - quantities are whole and positive; a used-up item is recorded as consumed, with the event that consumed it;
//  - splitting a stack makes a child with lineage; merging records which item was folded into which.
import { db } from "./db.ts";
import { bus } from "./bus.ts";
import { simRng, simTick } from "./sim.ts";
import { lifeGen } from "./lifecycle.ts";
import { capabilitiesOf, defById, defForKind, type ItemDef } from "../content/items.ts";
import { MATERIALS } from "../content/materials.ts";
import type { World } from "./world.ts";
import type { Entity, InventoryItem } from "../shared/types.ts";

const sr = simRng("items");

export type Loc =
  | { kind: "world"; x: number; z: number }
  | { kind: "inventory" }
  | { kind: "equipped"; slot: string }
  | { kind: "container"; id: string }
  | { kind: "consumed"; event: number };

export interface Condition { durability: number; wetness: number; temperatureC: number }
export interface Provenance { createdAtTick: number; makerLifeId?: number; sourceIds: string[]; unknown?: boolean; note?: string }
export interface ItemInstance {
  id: string;
  defId: string; defVersion: string;
  /** the name the rest of the game calls its kind by ("stick", "garment", ...), kept so existing code keeps working */
  kind: string;
  name: string; desc: string; qty: number;
  /** game data that rides along with the item (a pigment's colour, a book's text, a weapon's damage) */
  props: Record<string, any>;
  condition: Condition;
  parts: { material: string; mass: number }[];
  provenance: Provenance;
  visual: { recipeId: string; version: string; seed: number; parameters: Record<string, unknown> };
  loc: Loc;
  lineage: { splitFrom?: string; mergedInto?: string; mergedFrom?: string[] };
  /** a name or an inscription makes a thing its own: it no longer stacks */
  named?: boolean;
}

export class ItemError extends Error {}

const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const bucket = (v: number) => Math.min(3, Math.floor(v * 4));            // condition buckets: items in different ones do not share a stack

const cols = "id, def_id, def_version, kind, name, desc, qty, props, durability, wetness, temp, parts, prov, visual, loc_kind, loc_a, loc_x, loc_z, lineage, named, created_tick, ended_tick";

export class ItemRegistry {
  /** live items, in the order they came to exist */
  private items = new Map<string, ItemInstance>();
  /** set while an item changes place between ground and hands, so the entity hooks do not mistake it for a loss */
  private moving = new Set<string>();

  constructor(private w: World) {}

  // ---------- load and migrate ----------
  load() {
    for (const r of db.prepare(`SELECT ${cols} FROM item_instances WHERE ended_tick IS NULL ORDER BY created_seq`).all() as any[]) this.items.set(r.id, this.fromRow(r));
    this.adoptLegacy();
    this.refreshView();
  }
  private fromRow(r: any): ItemInstance {
    const loc: Loc = r.loc_kind === "world" ? { kind: "world", x: r.loc_x, z: r.loc_z } : r.loc_kind === "equipped" ? { kind: "equipped", slot: r.loc_a } : r.loc_kind === "container" ? { kind: "container", id: r.loc_a } : r.loc_kind === "consumed" ? { kind: "consumed", event: Number(r.loc_a) } : { kind: "inventory" };
    return { id: r.id, defId: r.def_id, defVersion: r.def_version, kind: r.kind, name: r.name, desc: r.desc, qty: r.qty, props: JSON.parse(r.props), condition: { durability: r.durability, wetness: r.wetness, temperatureC: r.temp },
      parts: JSON.parse(r.parts), provenance: JSON.parse(r.prov), visual: JSON.parse(r.visual), loc, lineage: JSON.parse(r.lineage), named: !!r.named };
  }
  private save(i: ItemInstance) {
    const l = i.loc;
    const seq = (db.prepare("SELECT created_seq FROM item_instances WHERE id = ?").get(i.id) as { created_seq: number } | undefined)?.created_seq
      ?? ((db.prepare("SELECT COALESCE(MAX(created_seq), 0) + 1 AS n FROM item_instances").get() as { n: number }).n);
    db.prepare(`INSERT OR REPLACE INTO item_instances(${cols}, created_seq) VALUES(${Array(23).fill("?").join(",")})`)
      .run(i.id, i.defId, i.defVersion, i.kind, i.name, i.desc, i.qty, JSON.stringify(i.props), i.condition.durability, i.condition.wetness, i.condition.temperatureC, JSON.stringify(i.parts), JSON.stringify(i.provenance), JSON.stringify(i.visual),
        l.kind, l.kind === "equipped" ? l.slot : l.kind === "container" ? l.id : l.kind === "consumed" ? String(l.event) : null, l.kind === "world" ? l.x : null, l.kind === "world" ? l.z : null,
        JSON.stringify(i.lineage), i.named ? 1 : 0, i.provenance.createdAtTick, l.kind === "consumed" ? simTick() : null, seq);
  }
  private log(item: string, type: string, detail: unknown = {}): number {
    return Number(db.prepare("INSERT INTO item_events(tick, item, type, detail) VALUES(?,?,?,?)").run(simTick(), item, type, JSON.stringify(detail)).lastInsertRowid);
  }

  /**
   * Worlds that existed before instances: carried items and loose items on the ground get one, with their origin marked unknown.
   * Nothing is invented about their history.
   */
  private adoptLegacy() {
    const legacy = db.prepare("SELECT id, kind, name, desc, qty, props FROM inventory").all() as any[];
    for (const r of legacy) if (!this.items.has(r.id)) {
      const props = r.props ? JSON.parse(r.props) : {};
      this.make({ id: r.id, defId: r.kind === "weapon" && /sharpened/i.test(r.name) ? "sharpened_stick" : undefined, kind: r.kind, name: r.name, desc: r.desc, qty: r.qty, props, loc: { kind: "inventory" }, provenance: { createdAtTick: simTick(), sourceIds: [], unknown: true, note: "from before items were tracked" } }, "adopted");
    }
    if (legacy.length) db.exec("DELETE FROM inventory");
    for (const e of this.w.entities.values()) if (e.kind === "item" && !this.items.has(e.id)) this.adoptEntity(e);
    // worn clothes from before: they were kept as plain data, so they become garments again, worn
    const worn = db.prepare("SELECT v FROM kv WHERE k = 'worn'").get() as { v: string } | undefined;
    if (worn) {
      for (const g of JSON.parse(worn.v) as any[]) this.make({ kind: "garment", name: g.name, desc: g.desc ?? g.name, qty: 1, props: { garment: g.garment, slot: g.slot, hex: g.hex, warm: g.warm }, loc: { kind: "equipped", slot: g.slot }, provenance: { createdAtTick: simTick(), sourceIds: [], unknown: true, note: "from before items were tracked" } }, "adopted");
      db.prepare("DELETE FROM kv WHERE k = 'worn'").run();
    }
  }

  // ---------- creation ----------
  private make(o: { id?: string; kind: string; name: string; desc: string; qty: number; props?: Record<string, any>; loc: Loc; provenance?: Partial<Provenance>; condition?: Partial<Condition>; defId?: string; named?: boolean; parts?: { material: string; mass: number }[] }, why = "created"): ItemInstance {
    const def = o.defId ? defById(o.defId) : defForKind(o.kind);
    if (!Number.isInteger(o.qty) || o.qty < 1) throw new ItemError(`a quantity of ${o.qty} is not possible`);
    const id = o.id ?? this.w.allocId("item");
    const prov: Provenance = { createdAtTick: simTick(), sourceIds: [], ...o.provenance };
    const i: ItemInstance = {
      id, defId: def.id, defVersion: def.version, kind: o.kind, name: o.name, desc: o.desc, qty: o.qty, props: o.props ?? {},
      condition: { durability: 1, wetness: 0, temperatureC: 15, ...o.condition },
      parts: o.parts ?? def.parts.map((p) => ({ material: p.material, mass: +(def.massKg * p.fraction).toFixed(4) })),
      provenance: prov, visual: { recipeId: def.visual, version: def.version, seed: hash32(id), parameters: o.props?.hex ? { hex: o.props.hex } : {} },
      loc: o.loc, lineage: {}, named: o.named,
    };
    this.items.set(id, i); this.save(i); this.log(id, why, { kind: o.kind, qty: o.qty, loc: o.loc.kind });
    return i;
  }

  /** A loose item that appeared on the ground by some other route (the story, a gift, a plugin) becomes an instance. */
  adoptEntity(e: Entity): ItemInstance {
    const have = this.items.get(e.id); if (have) return have;
    return this.make({ id: e.id, kind: String(e.props.item ?? e.kind), name: String(e.props.title ?? e.props.itemName ?? e.name.replace(/^book: /, "")), desc: String(e.props.desc ?? ""), qty: 1, props: this.carryProps(e), loc: { kind: "world", x: e.x, z: e.z },
      provenance: { createdAtTick: simTick(), sourceIds: [], unknown: true, note: "found in the world" } }, "adopted");
  }
  /** The parts of an entity's props that belong to the item itself (what it says, its colour, what it can do). */
  private carryProps(e: Entity): Record<string, any> {
    const p: Record<string, any> = {};
    for (const k of ["text", "topic", "title", "beat", "hex", "garment", "slot", "warm", "dmg", "reach", "cooked", "lines", "crafted", "stats", "quality", "capacityKg"]) if (e.props[k] !== undefined) p[k] = e.props[k];
    return p;
  }

  // ---------- the old World API, as an adapter ----------
  /** Can this new unit simply join an existing stack? */
  private stackable(a: ItemInstance, b: { kind: string; name: string; props?: Record<string, any>; condition?: Partial<Condition>; named?: boolean }): boolean {
    const d = defById(a.defId);
    if (!d.fungible || a.named || b.named || a.props.text || b.props?.text || a.props.lines) return false;
    return a.kind === b.kind && a.name === b.name && a.props.hex === b.props?.hex && bucket(a.condition.durability) === bucket(b.condition?.durability ?? 1) && bucket(a.condition.wetness) === bucket(b.condition?.wetness ?? 0);
  }
  /** Add to River's hands. Units that can share a stack do; anything else is a new item. */
  add(kind: string, name: string, desc: string, qty = 1, props?: Record<string, any>, o: { sources?: string[]; maker?: boolean; condition?: Partial<Condition>; note?: string; defId?: string; parts?: { material: string; mass: number }[] } = {}): ItemInstance {
    const into = o.defId || o.parts ? undefined : [...this.items.values()].find((i) => i.loc.kind === "inventory" && this.stackable(i, { kind, name, props, condition: o.condition }));
    if (into) {
      into.qty += qty; for (const s of o.sources ?? []) if (!into.provenance.sourceIds.includes(s) && into.provenance.sourceIds.length < 8) into.provenance.sourceIds.push(s);
      this.save(into); this.log(into.id, "joined", { qty }); this.refreshView(); return into;
    }
    const i = this.make({ kind, name, desc, qty, props, loc: { kind: "inventory" }, condition: o.condition, defId: o.defId, parts: o.parts, provenance: { sourceIds: o.sources ?? [], makerLifeId: o.maker ? lifeGen() : undefined, note: o.note } });
    this.refreshView(); return i;
  }
  /** Use up `qty` of a carried item. Returns what was taken, for callers that describe it. */
  take(id: string, qty = 1, why = "used"): InventoryItem | null {
    const i = this.items.get(id);
    if (!i || i.loc.kind !== "inventory" || i.qty < qty || qty < 1) return null;
    const snap = this.project(i, qty);
    this.consume(i, qty, why);
    this.refreshView();
    return snap;
  }
  /** Reduce or end an item. An item that reaches zero is recorded as consumed, with the event that did it. */
  consume(i: ItemInstance, qty: number, why: string): void {
    if (qty > i.qty) throw new ItemError(`cannot consume ${qty} of ${i.qty}`);
    const ev = this.log(i.id, "consumed", { qty, why });
    if (qty < i.qty) { i.qty -= qty; this.save(i); return; }
    i.qty = 0; i.loc = { kind: "consumed", event: ev };
    this.items.delete(i.id); this.saveEnded(i);
    for (const c of [...this.items.values()]) if (c.loc.kind === "container" && c.loc.id === i.id) this.spill(c, i);   // what was inside falls where it was
  }
  private saveEnded(i: ItemInstance) {
    db.prepare("UPDATE item_instances SET qty = ?, loc_kind = 'consumed', loc_a = ?, loc_x = NULL, loc_z = NULL, ended_tick = ?, lineage = ?, prov = ? WHERE id = ?")
      .run(i.qty, String((i.loc as { event: number }).event), simTick(), JSON.stringify(i.lineage), JSON.stringify(i.provenance), i.id);
  }
  /** Contents of something that stopped existing: they are not lost, and not duplicated; they land where it was. */
  private spill(c: ItemInstance, from: ItemInstance) {
    const at = this.placeOf(from) ?? { x: this.w.me.x, z: this.w.me.z };
    this.toWorld(c, at.x, at.z);
  }
  private placeOf(i: ItemInstance): { x: number; z: number } | null {
    let cur: ItemInstance | undefined = i;
    for (let n = 0; cur && n < 16; n++) {
      if (cur.loc.kind === "world") return { x: cur.loc.x, z: cur.loc.z };
      if (cur.loc.kind === "inventory" || cur.loc.kind === "equipped") return { x: this.w.me.x, z: this.w.me.z };
      cur = cur.loc.kind === "container" ? this.items.get(cur.loc.id) : undefined;
    }
    return null;
  }
  rename(id: string, name: string) {
    const i = this.items.get(id); if (!i) return;
    if (i.qty > 1) { const one = this.splitOff(i, 1); one.name = name; one.named = true; this.save(one); }
    else { i.name = name; i.named = true; this.save(i); }
    this.log(id, "renamed", { name }); this.refreshView();
  }

  // ---------- moving things ----------
  /** Pick a loose thing up. It keeps its identity and condition; a unit that can join a stack folds into it, and says so. */
  pickUp(entityId: string): ItemInstance {
    const e = this.w.entities.get(entityId);
    if (!e) throw new ItemError("that is not there");
    const i = this.items.get(entityId) ?? this.adoptEntity(e);
    // On the ground the entity is what the world shows; a plugin may have inscribed or renamed it since it was adopted.
    i.name = String(e.props.title ?? e.props.itemName ?? e.name.replace(/^book: /, "")); i.desc = String(e.props.desc ?? i.desc); i.props = { ...i.props, ...this.carryProps(e) };
    this.moving.add(entityId);
    try { this.w.removeEntity(entityId); } finally { this.moving.delete(entityId); }
    const into = [...this.items.values()].find((s) => s !== i && s.loc.kind === "inventory" && this.stackable(s, i));
    if (into && i.qty >= 1) {                                                     // fold into the stack already carried, and record it
      into.qty += i.qty; (into.lineage.mergedFrom ??= []).push(i.id);
      for (const s of [i.id, ...i.provenance.sourceIds]) if (!into.provenance.sourceIds.includes(s) && into.provenance.sourceIds.length < 8) into.provenance.sourceIds.push(s);
      const ev = this.log(i.id, "merged", { into: into.id, qty: i.qty });
      i.lineage.mergedInto = into.id; i.loc = { kind: "consumed", event: ev }; this.items.delete(i.id); this.saveEnded(i); this.save(into);
      this.refreshView(); return into;
    }
    i.loc = { kind: "inventory" }; this.save(i); this.log(i.id, "picked up", {});
    this.refreshView(); return i;
  }
  /** Put some of a carried thing on the ground. A whole item keeps its identity; part of a stack becomes a child with lineage. */
  drop(id: string, qty = 1, at?: { x: number; z: number }): ItemInstance {
    const i = this.items.get(id);
    if (!i || i.loc.kind !== "inventory") throw new ItemError("you are not carrying that");
    if (qty < 1 || qty > i.qty) throw new ItemError(`you only have ${i.qty}`);
    const out = qty < i.qty ? this.splitOff(i, qty) : i;
    const p = at ?? this.w.spotNearMe(1.5);
    this.toWorld(out, p.x, p.z);
    this.refreshView(); return out;
  }
  /** Where an item lies, and its entity: the projection of a world location. */
  private toWorld(i: ItemInstance, x: number, z: number) {
    i.loc = { kind: "world", x, z }; this.save(i); this.log(i.id, "put down", { x, z });
    this.moving.add(i.id);
    try { this.w.spawnWithId("item", i.id, i.name, x, z, { takeable: true, item: i.kind, itemName: i.name, desc: i.desc, ...i.props, ...(i.qty > 1 ? { qty: i.qty } : {}) }); } finally { this.moving.delete(i.id); }
  }
  private splitOff(i: ItemInstance, qty: number): ItemInstance {
    i.qty -= qty; this.save(i);
    const child = this.make({ kind: i.kind, name: i.name, desc: i.desc, qty, props: { ...i.props }, loc: i.loc, condition: { ...i.condition }, defId: i.defId, named: i.named,
      provenance: { sourceIds: [i.id, ...i.provenance.sourceIds].slice(0, 8), makerLifeId: i.provenance.makerLifeId, note: i.provenance.note } }, "split");
    child.lineage.splitFrom = i.id; this.save(child); this.log(i.id, "split", { child: child.id, qty });
    return child;
  }

  /** Wear or hold something in a body slot; what was there goes back to River's hands. */
  equip(id: string, slot: string): ItemInstance {
    const i = this.items.get(id);
    if (!i || i.loc.kind !== "inventory") throw new ItemError("you are not carrying that");
    const one = i.qty > 1 ? this.splitOff(i, 1) : i;
    const old = [...this.items.values()].find((x) => x.loc.kind === "equipped" && x.loc.slot === slot);
    if (old) { old.loc = { kind: "inventory" }; this.save(old); this.log(old.id, "taken off", { slot }); }
    one.loc = { kind: "equipped", slot }; this.save(one); this.log(one.id, "equipped", { slot });
    this.refreshView(); return one;
  }
  unequip(match: (i: ItemInstance) => boolean): ItemInstance | null {
    const i = [...this.items.values()].find((x) => x.loc.kind === "equipped" && match(x));
    if (!i) return null;
    i.loc = { kind: "inventory" }; this.save(i); this.log(i.id, "taken off", {});
    this.refreshView(); return i;
  }
  equipped(): ItemInstance[] { return [...this.items.values()].filter((i) => i.loc.kind === "equipped"); }

  // ---------- containers ----------
  contents(containerId: string): ItemInstance[] { return [...this.items.values()].filter((i) => i.loc.kind === "container" && i.loc.id === containerId); }
  /** What it weighs, from what it is actually made of (crafted things weigh what went into them), with anything inside it. */
  massOf(i: ItemInstance): number { return +(i.parts.reduce((s, p) => s + p.mass, 0) * i.qty + this.contents(i.id).reduce((s, c) => s + this.massOf(c), 0)).toFixed(4); }
  unitMass(i: ItemInstance): number { return i.parts.reduce((s, p) => s + p.mass, 0); }
  /** Put some of a carried thing inside a container. Fails if the container cannot hold it, is the thing itself, or sits inside it. */
  stow(id: string, qty: number, containerId: string): ItemInstance {
    const i = this.items.get(id), c = this.items.get(containerId);
    if (!i || i.loc.kind !== "inventory") throw new ItemError("you are not carrying that");
    if (!c || !defById(c.defId).container) throw new ItemError("that cannot hold things");
    if (c.loc.kind === "consumed") throw new ItemError("that is gone");
    if (qty < 1 || qty > i.qty) throw new ItemError(`you only have ${i.qty}`);
    // no cycles: the container may not be the item, nor anywhere inside it
    for (let cur: ItemInstance | undefined = c, n = 0; cur; n++) {
      if (cur.id === i.id) throw new ItemError("a thing cannot be put inside itself");
      if (n > 32) throw new ItemError("containers are nested too deeply");
      cur = cur.loc.kind === "container" ? this.items.get(cur.loc.id) : undefined;
    }
    const cap = defById(c.defId).container!.capacityKg, add = this.unitMass(i) * qty + (qty === i.qty ? this.contents(i.id).reduce((s, x) => s + this.massOf(x), 0) : 0);
    if (this.contents(c.id).reduce((s, x) => s + this.massOf(x), 0) + add > cap + 1e-9) throw new ItemError(`${c.name} can only carry about ${cap} kg`);
    const part = qty < i.qty ? this.splitOff(i, qty) : i;
    const same = this.contents(c.id).find((x) => this.stackable(x, part));
    if (same) { same.qty += part.qty; (same.lineage.mergedFrom ??= []).push(part.id); const ev = this.log(part.id, "merged", { into: same.id }); part.lineage.mergedInto = same.id; part.loc = { kind: "consumed", event: ev }; this.items.delete(part.id); this.saveEnded(part); this.save(same); this.refreshView(); return same; }
    part.loc = { kind: "container", id: c.id }; this.save(part); this.log(part.id, "stowed", { in: c.id });
    this.refreshView(); return part;
  }
  takeOut(id: string, qty: number, containerId: string): ItemInstance {
    const i = this.items.get(id);
    if (!i || i.loc.kind !== "container" || i.loc.id !== containerId) throw new ItemError("that is not in there");
    if (qty < 1 || qty > i.qty) throw new ItemError(`there are only ${i.qty}`);
    const part = qty < i.qty ? this.splitOff(i, qty) : i;
    const into = [...this.items.values()].find((s) => s !== part && s.loc.kind === "inventory" && this.stackable(s, part));
    if (into) { into.qty += part.qty; (into.lineage.mergedFrom ??= []).push(part.id); const ev = this.log(part.id, "merged", { into: into.id }); part.lineage.mergedInto = into.id; part.loc = { kind: "consumed", event: ev }; this.items.delete(part.id); this.saveEnded(part); this.save(into); this.refreshView(); return into; }
    part.loc = { kind: "inventory" }; this.save(part); this.log(part.id, "taken out", { of: containerId });
    this.refreshView(); return part;
  }

  // ---------- the other side of a world item: its entity ----------
  /** The ground lost an item entity. If the item did not move by itself, it was destroyed. */
  entityRemoved(id: string, why = "lost") {
    if (this.moving.has(id)) return;
    const i = this.items.get(id);
    if (i && i.loc.kind === "world") { this.consume(i, i.qty, why); this.refreshView(); }
  }
  /** The ground gained one. Items put down by this registry already have an instance; anything else is adopted. */
  entityAdded(e: Entity) { if (e.kind === "item" && !this.moving.has(e.id)) this.adoptEntity(e); }
  /** An item entity moved (an animal dropped it, a push): keep the instance's place in step. */
  entityMoved(e: Entity) { const i = this.items.get(e.id); if (i && i.loc.kind === "world") i.loc = { kind: "world", x: e.x, z: e.z }; }

  // ---------- burning ----------
  /**
   * An item on the ground burns. It is consumed, and anything that was made of fuel leaves a little ash, never more than a fifth of
   * its mass: fire changes material, it does not make it.
   */
  burn(id: string): ItemInstance | null {
    const i = this.items.get(id); if (!i || i.loc.kind !== "world") return null;
    const at = { x: i.loc.x, z: i.loc.z }, def = defById(i.defId);
    if (!def.parts.some((p) => MATERIALS[p.material]?.fuel) || i.condition.wetness >= 0.6) return null;      // stone does not burn, and neither does a soaked plank
    const ashKind = def.parts.map((p) => MATERIALS[p.material]?.ash).find(Boolean);
    const mass = this.massOf(i);
    this.moving.add(id);                                                              // the loss is recorded here, not by the entity hook
    try { this.consume(i, i.qty, "burned"); this.w.removeEntity(id); } finally { this.moving.delete(id); }
    let ash: ItemInstance | null = null;
    if (ashKind) {
      const unit = defForKind(ashKind), n = Math.floor((mass * 0.2) / unit.massKg);
      if (n >= 1) { ash = this.make({ kind: ashKind, name: unit.name, desc: "What a fire leaves of wood: black, light, and good for marking.", qty: n, loc: { kind: "world", x: at.x, z: at.z }, provenance: { sourceIds: [id], note: "ash of a burnt item" } }, "created");
        this.moving.add(ash.id); try { this.w.spawnWithId("item", ash.id, ash.name, at.x, at.z, { takeable: true, item: ash.kind, itemName: ash.name, desc: ash.desc, qty: n }); } finally { this.moving.delete(ash.id); } }
    }
    this.refreshView(); return ash;
  }

  // ---------- views and queries ----------
  get(id: string): ItemInstance | undefined { return this.items.get(id); }
  all(): ItemInstance[] { return [...this.items.values()]; }
  carried(): ItemInstance[] { return [...this.items.values()].filter((i) => i.loc.kind === "inventory"); }
  history(id: string): { tick: number; type: string; detail: unknown }[] {
    return (db.prepare("SELECT tick, type, detail FROM item_events WHERE item = ? ORDER BY seq").all(id) as any[]).map((r) => ({ tick: r.tick, type: r.type, detail: JSON.parse(r.detail) }));
  }
  /** What a thing can do, and how it stands, as the world sees it (not as anyone describes it). */
  describe(i: ItemInstance) {
    const def = defById(i.defId), usable = i.condition.durability > 0;
    return { id: i.id, name: i.name, kind: i.kind, definition: `${def.id}@${def.version}`, quantity: i.qty, location: i.loc, condition: i.condition,
      materials: i.parts, massKg: this.massOf(i), dims: def.dims, capabilities: usable ? capabilitiesOf(def) : [], provenance: i.provenance, lineage: i.lineage, visual: i.visual, named: !!i.named,
      contents: this.contents(i.id).map((c) => ({ id: c.id, name: c.name, qty: c.qty })) };
  }
  /** Rebuild what River's code sees as its inventory. */
  project(i: ItemInstance, qty = i.qty): InventoryItem {
    const props = { ...i.props, ...(i.condition.durability < 0.95 ? { durability: +i.condition.durability.toFixed(2) } : {}), ...(i.condition.wetness > 0.2 ? { wet: +i.condition.wetness.toFixed(2) } : {}) };
    return { id: i.id, kind: i.kind, name: i.name, desc: i.desc, qty, props: Object.keys(props).length ? props : undefined };
  }
  refreshView() {
    const view = this.w.inventory; view.clear();
    for (const i of this.items.values()) if (i.loc.kind === "inventory") view.set(i.id, this.project(i));
    bus.emit("state");
  }

  // ---------- upkeep ----------
  /** Weather wets what lies out in it (a little less what is carried), warmth dries it. Slow, and only where a mechanic reads it. */
  tickCondition(dtSec: number, wet: number, ambientC: number) {
    for (const i of this.items.values()) {
      if (i.loc.kind !== "world" && i.loc.kind !== "inventory") continue;
      const exposure = i.loc.kind === "world" ? 1 : 0.35, c = i.condition;
      const wetness = +Math.max(0, Math.min(1, c.wetness + (wet > 0 ? wet * exposure * 0.01 : -0.004) * dtSec)).toFixed(4);
      const temperatureC = +(c.temperatureC + (ambientC - c.temperatureC) * Math.min(1, 0.02 * dtSec)).toFixed(3);
      if (wetness !== c.wetness || temperatureC !== c.temperatureC) { c.wetness = wetness; c.temperatureC = temperatureC; this.save(i); }     // written when it changes, like all state
    }
  }
  wear(id: string, amount: number) {
    const i = this.items.get(id); if (!i) return;
    i.condition.durability = Math.max(0, +(i.condition.durability - amount).toFixed(4)); this.save(i);
    if (i.condition.durability <= 0) { this.log(id, "broke", {}); this.consume(i, i.qty, "broke"); this.refreshView(); }
  }

  /** Remove everything River had when a new life begins. A fresh world forgets the ground too. */
  reset(freshWorld: boolean) {
    for (const i of [...this.items.values()]) if (freshWorld || i.loc.kind !== "world") { this.moving.add(i.id); try { this.consume(i, i.qty, "life ended"); } finally { this.moving.delete(i.id); } }
    if (freshWorld) db.exec("DELETE FROM item_instances; DELETE FROM item_events");
    this.refreshView();
  }

  // ---------- the proof ----------
  /** Every rule above, checked against the whole registry. Returns the violations; an empty list is a clean bill. */
  audit(): string[] {
    const bad: string[] = [], seen = new Set<string>();
    for (const i of this.items.values()) {
      if (seen.has(i.id)) bad.push(`${i.id} appears twice`); seen.add(i.id);
      if (!Number.isInteger(i.qty) || i.qty < 1) bad.push(`${i.id} has quantity ${i.qty}`);
      if (i.loc.kind === "consumed") bad.push(`${i.id} is consumed but still live`);
      if (i.loc.kind === "world") { const e = this.w.entities.get(i.id); if (!e) bad.push(`${i.id} is on the ground but has no entity`); else if (e.kind !== "item") bad.push(`${i.id} entity is a ${e.kind}`); }
      else if (this.w.entities.get(i.id)?.kind === "item") bad.push(`${i.id} is ${i.loc.kind} but also lies on the ground`);
      if (i.loc.kind === "container") {
        const c = this.items.get(i.loc.id);
        if (!c) bad.push(`${i.id} is in ${i.loc.id}, which does not exist`);
        else for (let cur: ItemInstance | undefined = c, n = 0; cur; n++) {
          if (cur.id === i.id) { bad.push(`container cycle through ${i.id}`); break; }
          if (n > 32) { bad.push(`containers nested too deeply at ${i.id}`); break; }
          cur = cur.loc.kind === "container" ? this.items.get(cur.loc.id) : undefined;
        }
      }
      if (i.loc.kind === "inventory" && !this.w.inventory.has(i.id)) bad.push(`${i.id} is carried but missing from the inventory view`);
    }
    for (const id of this.w.inventory.keys()) { const i = this.items.get(id); if (!i || i.loc.kind !== "inventory") bad.push(`inventory view shows ${id}, which is not carried`); }
    for (const e of this.w.entities.values()) if (e.kind === "item" && !this.items.has(e.id)) bad.push(`ground item ${e.id} has no instance`);
    for (const c of this.items.values()) {
      const cap = defById(c.defId).container?.capacityKg;
      if (cap !== undefined && this.contents(c.id).reduce((s, x) => s + this.massOf(x), 0) > cap + 1e-6) bad.push(`${c.id} holds more than it can carry`);
    }
    return bad;
  }
}

void sr; void (null as unknown as ItemDef);
