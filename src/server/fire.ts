// Fire: a real, spreading, permanent world process.
//   - things catch fire (River's `burn` tool, lightning, spread from neighbours), burn for a while, and burn OUT:
//     trees leave charred trunks, small plants vanish, structures and books are destroyed, the ground is scorched.
//   - rain fights it, wind feeds it, animals flee it, and it hurts anyone standing in it.
//   - burnt ground slowly greens again (fireweed).
// Nothing here is undoable by the system; only weather, time or River's own effort stops it.
import { bus, log } from "./bus.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { Entity, Weather } from "../shared/types.ts";
import type { World } from "./world.ts";
import { persisted } from "./persist.ts";
import { defForKind } from "../content/items.ts";
import { MATERIALS } from "../content/materials.ts";
import { simNow, simRng, simSleep, every } from "./sim.ts";
const sr = simRng("fire");

interface Flam { dur: number; radius: number; p: number }
/** seconds to burn out, spread radius (m), per-second chance to ignite each neighbour in range */
const FLAM: Record<string, Flam> = {
  tree: { dur: 70, radius: 4.5, p: 0.012 }, bush: { dur: 25, radius: 3.2, p: 0.02 }, flower: { dur: 8, radius: 2, p: 0.04 },
  mushroom: { dur: 6, radius: 1.5, p: 0.02 }, sprout: { dur: 8, radius: 1.5, p: 0.03 }, structure: { dur: 60, radius: 4, p: 0.012 },
  book: { dur: 10, radius: 1.5, p: 0.03 }, item: { dur: 12, radius: 1.5, p: 0.03 },
};
/** how wet a loose item is, 0..1 (set by the Fire system, which can see the item registry) */
let wetnessOf: (id: string) => number = () => 0;
/** Whether a loose item can burn comes from what it is made of; a soaked one will not catch. */
const itemFlam = (e: Entity): Flam | null => {
  const d = defForKind(String(e.props.item ?? "")), fuel = d.parts.some((p) => MATERIALS[p.material]?.fuel);
  return fuel && wetnessOf(e.id) < 0.6 ? FLAM.item : null;
};
const flam = (e: Entity): Flam | null => (e.kind === "structure" && e.props.flammable === false ? null : e.kind === "item" ? itemFlam(e) : FLAM[e.kind] ?? null);
const WEATHER_SPREAD: Record<Weather, number> = { clear: 1, cloudy: 0.9, windy: 1.7, fog: 0.5, rain: 0.15, storm: 0.05 };
const rand = (a: number, b: number) => a + sr() * (b - a);
const CHAR_REGROW_MS = 30 * 60_000;

export const isBurning = (e: Entity) => !!e.props.burning;

export class Fire {
  private lastSay = 0;
  private lastHurt = 0;
  private tickN = 0;

  constructor(private w: World, private say: (text: string, at?: { x: number; z: number }, r?: number) => boolean, private notify: (m: string) => void) {
    wetnessOf = (id) => this.w.items.get(id)?.condition.wetness ?? 0;
    const s = persisted("fire", () => ({ lastSay: this.lastSay, lastHurt: this.lastHurt, tickN: this.tickN }));   // throttles and the regrowth cadence, committed with the clock
    if (s) { this.lastSay = s.lastSay; this.lastHurt = s.lastHurt; this.tickN = s.tickN; }
  }

  start() {
    every(1000, () => this.tick(), "fire");
    bus.on("strike", () => this.lightning());
  }

  burningNear(x: number, z: number, r: number) { return [...this.w.entities.values()].filter((e) => isBurning(e) && Math.hypot(e.x - x, e.z - z) <= r); }

  ignite(e: Entity, cause: "river" | "lightning" | "spread" | "ember"): boolean {
    const f = flam(e); if (!f || isBurning(e)) return false;
    const wet = this.w.weather === "rain" ? 0.7 : this.w.weather === "storm" ? 0.5 : 1;
    e.props.burning = { since: simNow(), ends: simNow() + f.dur * 1000 * rand(0.8, 1.25) * wet };
    this.w.putEntity(e);
    if (cause !== "spread") log("world", cause === "river" ? `${this.w.me.name} set the ${e.name} alight.` : cause === "ember" ? `A glowing coal lying against the ${e.name} set it alight.` : `Lightning struck the ${e.name}; it caught fire.`, { id: e.id });
    return true;
  }

  private lightning() {
    const trees = [...this.w.entities.values()].filter((e) => e.kind === "tree" && !isBurning(e));
    if (!trees.length) return;
    const t = trees[Math.floor(sr() * trees.length)];
    if (this.ignite(t, "lightning")) {
      this.say(`A fork of lightning hits the ${t.name} to the ${this.w.compass(t)}; it splits and catches fire.`, t, 80);
    }
  }

  private tick() {
    const w = this.w, now = simNow(); this.tickN++;
    const burning = [...w.entities.values()].filter(isBurning);
    if (this.tickN % 10 === 0) this.regrow();
    // A very hot thing lying against dry fuel sets it alight: a glowing coal dropped in the grass is a fire waiting to happen.
    for (const it of w.items.all()) {
      if (it.loc.kind !== "world" || it.condition.temperatureC < 200) continue;
      for (const e of w.entities.values()) {
        if (e.id === it.id || isBurning(e) || e.kind === "campfire" || !flam(e) || Math.hypot(e.x - it.loc.x, e.z - it.loc.z) > 0.9) continue;
        const dry = e.kind === "item" ? 1 - wetnessOf(e.id) : w.weather === "rain" || w.weather === "storm" ? 0.3 : 1;
        if (sr() < 0.12 * dry && this.ignite(e, "ember")) this.say(`A glowing coal sets the ${e.name} alight.`, e, 40);
      }
    }

    if (!burning.length) return;

    const wk = WEATHER_SPREAD[w.weather], wet = w.weather === "rain" || w.weather === "storm";
    const caught: Entity[] = [];
    for (const e of burning) {
      const f = flam(e)!;
      if (wet) e.props.burning.ends -= 2000;                      // rain eats the fire's remaining life ~3x faster
      for (const o of w.entities.values()) {
        if (o === e || isBurning(o)) continue;
        const of = flam(o); if (!of) continue;
        const d = Math.hypot(o.x - e.x, o.z - e.z); if (d > f.radius) continue;
        if (sr() < f.p * wk * (1 - 0.5 * d / f.radius)) { if (this.ignite(o, "spread")) caught.push(o); }
      }
      if (now >= e.props.burning.ends) this.burnOut(e);
    }
    if (caught.length && now - this.lastSay > 6000) {
      this.lastSay = now;
      const c = caught[0];
      this.say(caught.length === 1 ? `The fire leaps to a nearby ${c.name}.` : `The fire spreads: ${caught.length} more catch, among them the ${c.name} to the ${w.compass(c)}.`, c, 60);
    }

    // heat hurts; smoke wakes sleepers
    const me = w.me, close = burning.filter((e) => Math.hypot(e.x - me.x, e.z - me.z) < 2.2);
    if (close.length && now - this.lastHurt > 1000) {
      this.lastHurt = now;
      w.bump({ energy: -2.5 * close.length, mood: -3 }); bus.emit("scorched", {});
      if (me.sleeping) w.wake();
      if (this.tickN % 4 === 0) { log("need", `${me.name} is being scorched by the burning ${close[0].name}.`); this.notify("You are standing too close to a fire: the heat is scorching you. Move away."); }
    } else if (me.sleeping && burning.some((e) => Math.hypot(e.x - me.x, e.z - me.z) < 7)) {
      w.wake(); this.notify("You wake choking on smoke; something near you is burning.");
    }
  }

  private burnOut(e: Entity) {
    const w = this.w, name = e.name, oldKind = e.kind;
    delete e.props.burning;
    bus.emit("loss", { name, kind: oldKind, x: e.x, z: e.z });
    w.burnMark(e.x, e.z, oldKind === "tree" || oldKind === "structure" ? 2.8 : 1.6, oldKind === "tree" ? 1.4 : 1);
    if (oldKind === "tree" || oldKind === "bush" || oldKind === "structure") {
      e.kind = "char"; e.name = `burnt ${name}`;
      const wasMaterials = e.props.materials, wasKinds = e.props.materialKinds;      // what it was made of, so a burnt structure can still be taken apart for what survived
      e.props = { wasKind: oldKind, was: name, ...(wasMaterials ? { wasMaterials, wasKinds } : {}), desc: `What is left of the ${name}: blackened, brittle, still warm to the touch. Ash lies thick around it.`, regrowAt: simNow() + CHAR_REGROW_MS, yields: ["charcoal"], stock: 2, max: 2, noRegrow: true };
      w.putEntity(e);
    } else { if (oldKind === "item") w.items.burn(e.id); w.removeEntity(e.id); }           // small plants and books: gone; things that were fuel leave a little ash
    this.say(`The ${name} has burnt itself out.`, e, 40);
  }

  /** Time heals: burnt ground greens first with fireweed. */
  private regrow() {
    const now = simNow();
    for (const e of [...this.w.entities.values()]) {
      if (e.kind !== "char" || !e.props.regrowAt || e.props.regrowAt > now) continue;
      this.w.removeEntity(e.id);
      this.w.spawn("sprout", "fireweed shoot", e.x, e.z, { desc: "Fireweed, the first thing to grow in burnt ground.", born: now, ms: 120_000, grow: "flower", grownName: "fireweed", grown: { takeable: true, item: "flower", itemName: "fireweed", desc: "Fireweed, the first thing to grow in burnt ground." } });
    }
  }
}

// ---------- River's tool ----------
export const BURN_TOOL: ToolDef = {
  name: "burn",
  description:
    "Set a thing alight, or fight a fire. `ignite`: set fire to something within a few paces (trees, bushes, flowers, structures, books, planks...). It needs a spark: a glowing coal, or a stick plus a stone to strike, or a stick lit from a burning fire beside you. " +
    "`smother`: try to put out something burning within reach (may fail and scorch you). Fire SPREADS between things that are close together, faster in dry wind and slower in rain, and it is not stopped by wanting it to stop. " +
    "What burns is gone: trees become charred trunks, small plants and books vanish, the ground stays scorched for a long time. Standing next to flames hurts. Animals flee.",
  input_schema: obj({
    action: { type: "string", enum: ["ignite", "smother"], description: "Start a fire, or fight one." },
    target: str("Entity id of the thing to burn or put out (use look)."),
    with: str("ignite: a 'glowing coal' item, or a stick (with `stone` to strike, or beside a burning fire)."),
    stone: str("ignite: a stone to strike against the stick."),
  }, ["action", "target"]),
  run: async (a, w: World) => {
    const e = w.entities.get(String(a.target)) ?? w.nearby(6).map((o) => o.e).find((x) => x.name.toLowerCase().includes(String(a.target).toLowerCase()));
    if (!e) throw new ToolError("Nothing like that known. Use look to find its id.");
    if (w.dist(e) > 3.5) throw new ToolError(`${e.name} is ${w.dist(e).toFixed(0)}m away. Get within a few paces first.`);
    const fire = (w as any).fire as Fire;

    if (a.action === "smother") {
      if (!isBurning(e)) throw new ToolError(`${e.name} isn't burning.`);
      w.setActivity("beating at the flames");
      await simSleep(5000);
      if (!isBurning(e)) return `By the time you reach it, the ${e.name} has already burnt itself out.`;
      if (sr() < 0.65) {
        delete e.props.burning; w.putEntity(e); w.burnMark(e.x, e.z, 1.2, 0.6); w.bump({ energy: -6, mood: 5 });
        return `You smother the flames on the ${e.name} with armfuls of earth and wet leaves until they gutter and die. Black, but standing. Your hands are shaking.`;
      }
      w.bump({ energy: -9, mood: -8 });
      return `The heat drives you back. You beat at the ${e.name} but the flames hold, and your arms and face are scorched for it.`;
    }

    if (a.action !== "ignite") throw new ToolError(`Unknown action "${a.action}". Use ignite or smother.`);
    if (isBurning(e)) throw new ToolError(`${e.name} is already burning.`);
    if (!flam(e)) throw new ToolError(`${e.name} won't burn.`);

    // find a spark
    const coal = a.with && /coal|ember/i.test(String(a.with)) ? w.findItem(String(a.with)) : w.findItem("glowing coal");
    const stick = w.findItem("stick");
    const litFire = w.nearby(6).map((o) => o.e).find((x) => (x.kind === "campfire" && x.props.lit !== false) || isBurning(x));
    let how: string;
    if (coal) { w.takeItem(coal.id, 1); how = "You press the glowing coal into the base of it and breathe on it until a flame takes."; }
    else if (stick && litFire) { w.takeItem(stick.id, 1); how = `You hold a stick into the ${litFire.kind === "campfire" ? "hearth" : "flames"} until its end blazes, then carry it over and set it to the ${e.name}.`; }
    else if (stick && (w.findItem(String(a.stone ?? "stone")))) { w.takeItem(stick.id, 1); how = "You strike the stone against the stick until a spark catches in the tinder, and feed it to the base of the thing."; }
    else throw new ToolError("You have no way to make a spark. A glowing coal, or a stick and a stone, or a stick and a fire to light it from.");

    w.setActivity("setting a fire");
    await simSleep(4000);
    fire.ignite(e, "river");
    w.bump({ curiosity: -6, mood: 3 });
    const wind = w.weather === "windy" ? " The wind is tugging the flames sideways." : w.weather === "rain" || w.weather === "storm" ? " The rain is working against you." : "";
    return `${how} The ${e.name} catches.${wind} Within a breath it is roaring, and you can feel it on your face. This cannot be undone now; only time, weather or your own effort will end it.`;
  },
};
