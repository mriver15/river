// Individual animals. Each deer, rabbit, crow and fox is somebody: a temperament, a name if River gives one, and a trust that
// grows with company, music and offerings and falls with fire. The more it trusts River, the closer it comes, until it is a friend.
// That is what makes a loss mean something.
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { Entity } from "../shared/types.ts";
import type { World } from "./world.ts";
import { onFlush, persisted } from "./persist.ts";
import { simNow, simRng, every } from "./sim.ts";
const sr = simRng("creatures");

export type Trait = "gentle" | "skittish" | "bold" | "curious";
export const SHY_MULT: Record<Trait, number> = { gentle: 0.9, skittish: 1.4, bold: 0.7, curious: 0.8 };
const TRUST_RATE: Record<Trait, number> = { gentle: 1.5, skittish: 0.6, bold: 1, curious: 1.3 };
const TRAIT_TEXT: Record<Trait, string> = { gentle: "gentle, slow to startle", skittish: "skittish, quick to bolt", bold: "bold, unafraid of new things", curious: "curious, always watching you" };
const TRAITS: Record<string, Trait[]> = { deer: ["gentle", "skittish", "bold"], rabbit: ["skittish", "curious"], crow: ["curious", "bold"], fox: ["skittish", "bold"] };
const DIET: Record<string, string[]> = { deer: ["berry", "flower"], rabbit: ["berry", "flower", "mushroom"], crow: ["seed", "berry"], fox: ["berry", "mushroom"] };

export interface Creature { id: string; species: string; trait: Trait; name: string | null; trust: number; met: number; lastSeen: number; alive: boolean }
export const STAGES = [[0.9, "a friend"], [0.7, "trusting"], [0.35, "familiar"], [0, "wary"]] as const;
export const stage = (t: number) => STAGES.find(([min]) => t >= min)![1];
const label = (c: Creature) => (c.name ? `${c.name} the ${c.species}` : `the ${c.species}`);

export class Creatures {
  rows = new Map<string, Creature>();
  private dirty = new Set<string>();
  private lastSync = 0;

  constructor(private w: World, private say: (text: string, at?: { x: number; z: number }, r?: number) => boolean) {
    this.lastSync = persisted("creatures", () => ({ lastSync: this.lastSync }))?.lastSync ?? 0;
    for (const r of db.prepare("SELECT * FROM creatures").all() as any[])
      this.rows.set(r.id, { id: r.id, species: r.species, trait: r.trait in TRUST_RATE ? r.trait : "curious",                         // an unknown trait would make trust NaN
        name: r.name, trust: Number.isFinite(r.trust) ? Math.max(0, Math.min(1, r.trust)) : 0, met: r.met, lastSeen: r.last_seen, alive: !!r.alive });
  }
  start() {
    every(1000, () => this.tick(1), "creatures");
    onFlush(() => { for (const id of this.dirty) { const c = this.rows.get(id); if (c) this.save(c); } this.dirty.clear(); });   // trust and sightings are committed with the clock
  }
  reset() { this.rows.clear(); this.dirty.clear(); }

  get(e: Entity): Creature | undefined { return e.props.creature ? this.rows.get(e.props.creature) : undefined; }
  private save(c: Creature) { db.prepare("INSERT INTO creatures(id,species,trait,name,trust,met,last_seen,alive) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,trust=excluded.trust,met=excluded.met,last_seen=excluded.last_seen,alive=excluded.alive").run(c.id, c.species, c.trait, c.name, c.trust, c.met, c.lastSeen, c.alive ? 1 : 0); }

  /** Make sure `count` individuals of a species exist, then make sure the right ones are present in the world right now. */
  presence(species: string, count: number, allowed: boolean, desc: string, pick: () => { x: number; z: number }) {
    const alive = [...this.rows.values()].filter((c) => c.species === species && c.alive);
    for (let i = alive.length; i < count; i++) {
      const traits = TRAITS[species] ?? ["curious"], c: Creature = { id: `cr_${species}_${simNow().toString(36)}${i}`, species, trait: traits[Math.floor(sr() * traits.length)], name: null, trust: 0, met: 0, lastSeen: 0, alive: true };
      this.rows.set(c.id, c); this.save(c); alive.push(c);
    }
    for (const c of [...alive].sort((a, b) => Number(!!a.name) - Number(!!b.name) || a.trust - b.trust).slice(0, Math.max(0, alive.length - count))) { c.alive = false; this.save(c); }      // the island holds fewer now: the unnamed, least-trusting move on first, and are not mourned
    const ents = [...this.w.entities.values()].filter((e) => e.kind === "animal" && e.props.species === species);
    for (const e of ents) if (e.props.creature && this.rows.get(e.props.creature)?.alive === false) this.w.removeEntity(e.id);
    const kept = alive.filter((c) => c.alive);
    for (const e of ents.filter((x) => !x.props.creature && this.w.entities.has(x.id))) {
      const free = kept.find((c) => !ents.some((x) => x.props.creature === c.id)); if (free) { e.props.creature = free.id; this.syncEntity(e, free); } else this.w.removeEntity(e.id);
    }
    if (!allowed) { ents.forEach((e) => this.w.removeEntity(e.id)); return; }
    for (const c of kept) if (!ents.some((e) => e.props.creature === c.id && this.w.entities.has(e.id))) {
      const p = pick(); this.w.spawn("animal", label(c).replace(/^the /, ""), p.x, p.z, { species, creature: c.id, desc, heading: sr() * 6.28, trust: +c.trust.toFixed(2), cname: c.name, trait: c.trait, met: c.met });
    }
  }
  private syncEntity(e: Entity, c: Creature) { Object.assign(e.props, { trust: +c.trust.toFixed(2), cname: c.name, trait: c.trait, met: c.met }); e.name = c.name ? `${c.name} the ${c.species}` : c.species; }

  tick(dt: number) {
    const now = simNow(), me = this.w.me;
    for (const e of this.w.entities.values()) {
      if (e.kind !== "animal") continue; const c = this.get(e); if (!c) continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z), before = stage(c.trust);
      if (d < 10) { if (now - c.lastSeen > 5 * 60_000) { c.met++; this.dirty.add(c.id); } c.lastSeen = now; }
      let gain = 0;
      if (d < 8 && !e.props.fleeing) gain += 0.0004 * TRUST_RATE[c.trait];                                  // simply being near, unthreatened
      if ((e.props.calmUntil ?? 0) > now && d < 22) gain += 0.0015;                                          // listening to River's music
      c.trust = Math.max(0, Math.min(1, c.trust + gain * (1 - c.trust) * dt));
      if ([...this.w.entities.values()].some((f) => f.props.burning && Math.hypot(f.x - e.x, f.z - e.z) < 13)) c.trust = Math.max(0, c.trust - 0.003 * dt);   // fire frightens, and River is near fire
      const after = stage(c.trust);
      if (after !== before && c.trust > 0) { if (STAGES.findIndex(([, s]) => s === after) < STAGES.findIndex(([, s]) => s === before)) this.milestone(e, c, after); }
      this.dirty.add(c.id);
    }
    if (now - this.lastSync > 5000) { this.lastSync = now; for (const e of this.w.entities.values()) { const c = e.kind === "animal" ? this.get(e) : undefined; if (c) this.syncEntity(e, c); } }
  }

  private milestone(e: Entity, c: Creature, s: string) {
    const who = label(c), text = s === "familiar" ? `${who} no longer flinches when you move. It watches you with something like recognition.`
      : s === "trusting" ? `${who} walks right up to you and stands there, as if it had decided something.`
      : `${who} stays near you as the day goes on, and when you stop, it stops. A friend.`;
    this.say(text, e, 25); bus.emit("bond", { id: c.id, stage: s, name: who });
  }

  /** A creature caught in flames. Loyal ones stay beside River even near danger, which is how they are lost. */
  hazard(e: Entity, dt: number) {
    const near = [...this.w.entities.values()].some((f) => f.props.burning && Math.hypot(f.x - e.x, f.z - e.z) < 1.8);
    if (!near || sr() > 0.1 * dt) return false;
    const c = this.get(e); this.w.removeEntity(e.id);
    if (c) { c.alive = false; this.save(c); bus.emit("loss", { id: c.id, name: label(c), kind: "creature", x: e.x, z: e.z, named: !!c.name, trust: c.trust }); }
    this.say(`${c ? label(c)[0].toUpperCase() + label(c).slice(1) : "A creature"} was caught in the fire.`, e, 60);
    log("world", `${c ? label(c) : "An animal"} died in the fire.`, { perceived: true });
    return true;
  }

  describe(e: Entity): string {
    const c = this.get(e); if (!c) return "";
    return `\nIt is ${TRAIT_TEXT[c.trait]}.${c.name ? ` You call it ${c.name}.` : ""} ${c.met > 0 ? `You have met it ${c.met} time${c.met === 1 ? "" : "s"}` : "You haven't met it before"}; it is ${stage(c.trust)} with you.`;
  }
}

// ---------- River's tools ----------
const nearestAnimal = (w: World, ref: string, maxD: number): Entity | undefined => {
  const r = ref.toLowerCase(), byId = w.entities.get(ref);
  const e = byId?.kind === "animal" ? byId : w.nearby(maxD).map((o) => o.e).find((x) => x.kind === "animal" && (x.name.toLowerCase().includes(r) || String(x.props.species).includes(r)));
  return e && w.dist(e) <= maxD ? e : undefined;
};
const creatures = (w: World) => (w as any).creatures as Creatures;

export const NAME_CREATURE_TOOL: ToolDef = {
  name: "name_creature",
  description: "Give a name to an animal within a few paces, so it becomes someone you can know and look for. A name sticks to that individual for good. Birds, deer, rabbits and foxes can be named; fireflies can't.",
  input_schema: obj({ target: str("The animal's id (from look), or 'deer' etc. for the nearest one"), name: str("The name, 2-24 letters") }, ["target", "name"]),
  run: (a, w) => {
    const e = nearestAnimal(w, String(a.target), 6); if (!e) throw new ToolError("There's no animal that close. Get within a few paces first (look shows who is near).");
    const c = creatures(w).get(e); if (!c) throw new ToolError("That's a swarm, not an individual; it can't be named.");
    const name = String(a.name).trim().replace(/[^\p{L}' -]/gu, "").slice(0, 24);
    if (name.length < 2) throw new ToolError("Give it a name of at least two letters.");
    if (c.name) throw new ToolError(`${c.name} already has a name; you can't rename someone.`);
    if ([...creatures(w).rows.values()].some((x) => x.alive && x.name?.toLowerCase() === name.toLowerCase())) throw new ToolError(`There is already a ${name}.`);
    c.name = name; c.trust = Math.min(1, c.trust + 0.04); creatures(w)["save"](c); creatures(w)["syncEntity"](e, c); w.putEntity(e);
    log("world", `River named the ${c.species} ${name}.`, { perceived: true });
    bus.emit("attach", { id: c.id, kind: "creature", name, evidence: "named" });
    return `You call the ${c.species} ${name}. ${c.trait === "skittish" ? "It flicks an ear at the sound, ready to bolt." : "It lifts its head at your voice."} It is yours to know now.`;
  },
};

export const OFFER_TOOL: ToolDef = {
  name: "offer",
  description: "Offer something from your inventory to an animal within a few paces. Deer take berries and flowers; rabbits berries, flowers and mushrooms; crows seeds and berries; foxes berries and mushrooms. Trust is built a little at a time, and a gift remembered is worth a lot.",
  input_schema: obj({ item: str("Inventory item id or name"), target: str("The animal's id, or 'deer' etc. for the nearest") }, ["item", "target"]),
  run: (a, w) => {
    const e = nearestAnimal(w, String(a.target), 5); if (!e) throw new ToolError("There's no animal within a few paces. Move closer, slowly.");
    const c = creatures(w).get(e); if (!c) throw new ToolError("That swarm can't be fed.");
    const it = w.findItem(String(a.item)); if (!it) throw new ToolError("You don't have that.");
    if (!(DIET[c.species] ?? []).includes(it.kind)) throw new ToolError(`The ${c.species} sniffs at the ${it.name} and turns its head away.`);
    if ((e.props.fleeing ?? false) && c.trust < 0.2) throw new ToolError(`The ${c.species} is too frightened to come near your hand.`);
    w.takeItem(it.id, 1);
    bus.emit("attach", { id: c.id, kind: "creature", name: c.name ?? c.species, evidence: "cared" });
    c.trust = Math.min(1, c.trust + 0.12 * TRUST_RATE[c.trait]); e.props.calmUntil = simNow() + 60_000; creatures(w)["save"](c);
    return `You hold out the ${it.name} and keep very still. After a long moment the ${c.species} steps in and takes it from your hand. ${c.trust >= 0.7 ? "It lingers beside you afterwards." : "It doesn't go far afterwards."}`;
  },
};
