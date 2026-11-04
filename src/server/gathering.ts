// Taking things from the world into River's hands. Shared by the pick_up tool and the gather activity.
import { simNow, simRng } from "./sim.ts";
import type { World } from "./world.ts";
import type { Entity } from "../shared/types.ts";

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
  const [name, desc] = ITEM_NAMES[kind];
  e.props.stock--; e.props.lastTake = simNow(); w.putEntity(e);
  w.addItem(kind, name, desc);
  return { kind, name };
}
/** Pick up a loose item lying on the ground. */
export function takeLoose(w: World, e: Entity): string {
  const props = e.props.text ? { text: e.props.text, topic: e.props.topic, title: e.props.title, beat: e.props.beat } : undefined;
  w.removeEntity(e.id);
  w.addItem(e.props.item ?? e.kind, e.props.title ?? e.props.itemName ?? e.name.replace(/^book: /, ""), e.props.desc ?? "", 1, props);
  return e.name;
}
