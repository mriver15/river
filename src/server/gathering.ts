// Taking things from the world into River's hands. Shared by the pick_up tool and the gather activity.
import { simNow, simRng } from "./sim.ts";
import type { World } from "./world.ts";
import type { Entity } from "../shared/types.ts";
import { bus } from "./bus.ts";
import { defById } from "../content/items.ts";
import { kvGet, kvSet } from "./db.ts";

const sr = simRng("gathering");
export const ITEM_NAMES: Record<string, [string, string]> = {
  berry: ["wild berry", "A small red berry. Edible."], stick: ["stick", "A sturdy stick."],
  stone: ["stone", "A smooth, heavy stone."], seed: ["seed", "A small seed. It could be planted."],
  clay: ["lump of clay", "Cool, fine-grained clay that holds a shape when pressed. Red-brown."], chalk: ["lump of chalk", "Soft white chalk that marks whatever it touches."],
  meat: ["raw meat", "A heavy cut of raw meat, still warm. It would be better cooked."], hide: ["animal hide", "A thick, greasy hide. It would keep out wind and cold, and it can be lashed or sewn."],
  bark: ["strip of bark", "A long, flexible strip of bark, peeled loose. It bends without breaking."],
  moss: ["handful of moss", "Soft green moss, damp and springy."], charcoal: ["piece of charcoal", "A black, brittle remnant of burnt wood. It leaves a mark."],
};

/** Units of a source claimed by activities. */
export const reservedOn = (e: Entity): number => Object.values((e.props.reserved ?? {}) as Record<string, number>).reduce((a, n) => a + n, 0);
/** Stock that is actually there to take: what the source holds, less what is claimed by anyone but `except`. */
export const available = (e: Entity, except?: string): number => (e.props.stock ?? 0) - (reservedOn(e) - ((e.props.reserved ?? {})[except ?? ""] ?? 0));

/** Take one unit from a yielding source. `prefer` picks that kind when the source offers it. */
export function takeOneUnit(w: World, e: Entity, prefer?: string): { kind: string; name: string } {
  const kind: string = prefer && e.props.yields.includes(prefer) ? prefer : e.props.yields[Math.floor(sr() * e.props.yields.length)];
  const [name, desc] = ITEM_NAMES[kind] ?? [defById(kind).name, defById(kind).desc ?? ""];                 // kinds from content packs name themselves
  e.props.stock--; e.props.lastTake = simNow(); w.putEntity(e);
  w.addItem(kind, name, desc, 1, undefined, { sources: [e.id] });         // where it came from is part of what it is
  return { kind, name };
}
/** Pick up a loose item lying on the ground. */
export function takeLoose(w: World, e: Entity): string {
  const name = e.name;
  w.items.pickUp(e.id);                                               // the same object, now in River's hands
  const gift = String(e.props.catalog ?? "");
  if (gift.startsWith("c_")) {                                        // something a person left for it (not one of the island's own landmarks): the first time it is taken up is a moment
    const taken = kvGet<string[]>("giftsTaken", []);
    if (!taken.includes(gift)) { kvSet("giftsTaken", [...taken, gift].slice(-200)); bus.emit("gift_taken", { id: gift, name }); }
  }
  return name;
}
