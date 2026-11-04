// What kinds of thing exist. A definition says what a thing physically is; an instance (src/server/items.ts) is one particular thing.
import { RULES_VERSION, deriveCapabilities, massOf, type Part } from "./materials.ts";

export interface ItemDef {
  id: string;
  version: string;
  /** the names the game has always used for this kind of thing */
  aliases: string[];
  name: string;
  dims: { l: number; w: number; h: number };            // metres
  massKg: number;
  parts: Part[];
  tags: string[];
  /** units of the same kind may share a stack */
  fungible: boolean;
  /** durability 1 = new; wears with use */
  worn?: boolean;
  nutrition?: number;
  container?: { capacityKg: number };
  wearable?: { slot: string };
  /** which procedural look draws it (see the client's visual registry) */
  visual: string;
  /** fixed numbers a mechanic uses, e.g. a weapon's damage; set by recipes from the parts */
  stats?: Record<string, number>;
}

type Spec = Omit<ItemDef, "version" | "massKg"> & { massKg?: number };
const def = (s: Spec): ItemDef => ({ version: RULES_VERSION, ...s, massKg: s.massKg ?? massOf(s.parts, s.dims) });
const wood = [{ material: "wood", fraction: 1 }], stone = [{ material: "stone", fraction: 1 }];

export const ITEM_DEFS: ItemDef[] = [
  def({ id: "stick", aliases: ["stick"], name: "stick", dims: { l: 0.9, w: 0.03, h: 0.03 }, massKg: 0.25, parts: wood, tags: ["long"], fungible: true, visual: "stick" }),
  def({ id: "stone", aliases: ["stone", "rock", "pebble", "flint"], name: "stone", dims: { l: 0.12, w: 0.09, h: 0.07 }, massKg: 0.6, parts: stone, tags: ["edge"], fungible: true, visual: "stone" }),
  def({ id: "seed", aliases: ["seed"], name: "seed", dims: { l: 0.01, w: 0.01, h: 0.01 }, massKg: 0.001, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, visual: "seed" }),
  def({ id: "berry", aliases: ["berry"], name: "wild berry", dims: { l: 0.012, w: 0.012, h: 0.012 }, massKg: 0.002, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, nutrition: 14, visual: "food" }),
  def({ id: "mushroom", aliases: ["mushroom"], name: "mushroom", dims: { l: 0.06, w: 0.06, h: 0.07 }, massKg: 0.04, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, nutrition: 8, visual: "food" }),
  def({ id: "flower", aliases: ["flower"], name: "flower", dims: { l: 0.25, w: 0.05, h: 0.05 }, massKg: 0.01, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, nutrition: 3, visual: "flower" }),
  def({ id: "shell", aliases: ["shell"], name: "shell", dims: { l: 0.07, w: 0.05, h: 0.03 }, massKg: 0.05, parts: [{ material: "shell", fraction: 1 }], tags: ["hollow"], fungible: true, visual: "shell" }),
  def({ id: "clay", aliases: ["clay"], name: "lump of clay", dims: { l: 0.1, w: 0.08, h: 0.06 }, massKg: 0.5, parts: [{ material: "clay", fraction: 1 }], tags: [], fungible: true, visual: "lump" }),
  def({ id: "chalk", aliases: ["chalk"], name: "lump of chalk", dims: { l: 0.08, w: 0.05, h: 0.04 }, massKg: 0.15, parts: [{ material: "pigment", fraction: 1 }], tags: [], fungible: true, visual: "lump" }),
  def({ id: "meat", aliases: ["meat"], name: "raw meat", dims: { l: 0.2, w: 0.12, h: 0.06 }, massKg: 0.5, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, nutrition: 18, visual: "food" }),
  def({ id: "fish", aliases: ["fish"], name: "fish", dims: { l: 0.3, w: 0.08, h: 0.05 }, massKg: 0.4, parts: [{ material: "food", fraction: 1 }], tags: [], fungible: true, nutrition: 11, visual: "fish" }),
  def({ id: "hide", aliases: ["hide"], name: "animal hide", dims: { l: 0.9, w: 0.7, h: 0.01 }, massKg: 1.2, parts: [{ material: "hide", fraction: 1 }], tags: ["strip", "flat"], fungible: true, visual: "hide" }),
  def({ id: "bark", aliases: ["bark"], name: "strip of bark", dims: { l: 0.7, w: 0.05, h: 0.004 }, massKg: 0.05, parts: [{ material: "bark", fraction: 1 }], tags: ["strip"], fungible: true, visual: "strip" }),
  def({ id: "moss", aliases: ["moss"], name: "handful of moss", dims: { l: 0.15, w: 0.12, h: 0.06 }, massKg: 0.05, parts: [{ material: "moss", fraction: 1 }], tags: ["flat"], fungible: true, visual: "moss" }),
  def({ id: "charcoal", aliases: ["charcoal"], name: "piece of charcoal", dims: { l: 0.1, w: 0.03, h: 0.03 }, massKg: 0.06, parts: [{ material: "charcoal", fraction: 1 }], tags: [], fungible: true, visual: "lump" }),
  def({ id: "pigment", aliases: ["pigment"], name: "pigment", dims: { l: 0.06, w: 0.06, h: 0.03 }, massKg: 0.05, parts: [{ material: "pigment", fraction: 1 }], tags: [], fungible: true, visual: "pigment" }),
  def({ id: "plank", aliases: ["plank", "driftwood"], name: "driftwood plank", dims: { l: 1.2, w: 0.15, h: 0.03 }, massKg: 1.6, parts: wood, tags: ["long", "flat"], fungible: true, visual: "plank" }),
  def({ id: "root", aliases: ["root"], name: "tough root", dims: { l: 0.5, w: 0.03, h: 0.03 }, massKg: 0.1, parts: [{ material: "bark", fraction: 1 }], tags: ["strip", "long"], fungible: true, visual: "strip" }),
  def({ id: "bottle", aliases: ["bottle"], name: "bottle", dims: { l: 0.25, w: 0.08, h: 0.08 }, massKg: 0.4, parts: [{ material: "glass", fraction: 1 }], tags: ["hollow"], fungible: false, visual: "bottle" }),
  def({ id: "cup", aliases: ["cup"], name: "cup", dims: { l: 0.09, w: 0.09, h: 0.08 }, massKg: 0.12, parts: [{ material: "metal", fraction: 1 }], tags: ["hollow"], fungible: false, visual: "cup" }),
  def({ id: "lamp", aliases: ["lamp"], name: "lamp", dims: { l: 0.12, w: 0.1, h: 0.2 }, massKg: 0.5, parts: [{ material: "metal", fraction: 1 }], tags: ["hollow"], fungible: false, visual: "lamp" }),
  def({ id: "book", aliases: ["book"], name: "book", dims: { l: 0.22, w: 0.15, h: 0.03 }, massKg: 0.5, parts: [{ material: "paper", fraction: 1 }], tags: ["flat"], fungible: false, visual: "book" }),
  def({ id: "garment", aliases: ["garment"], name: "garment", dims: { l: 0.6, w: 0.5, h: 0.02 }, massKg: 0.5, parts: [{ material: "bark", fraction: 0.5 }, { material: "moss", fraction: 0.5 }], tags: ["flat", "strip"], fungible: false, wearable: { slot: "body" }, visual: "garment" }),
  def({ id: "weapon", aliases: ["weapon"], name: "weapon", dims: { l: 1.8, w: 0.05, h: 0.05 }, massKg: 1.1, parts: wood, tags: ["long", "pointed"], fungible: false, worn: true, visual: "spear" }),
  def({ id: "sharpened_stick", aliases: ["sharpened stick"], name: "sharpened stick", dims: { l: 1.0, w: 0.03, h: 0.03 }, massKg: 0.25, parts: wood, tags: ["long", "pointed"], fungible: false, worn: true, visual: "spear" }),
  def({ id: "basket", aliases: ["basket"], name: "bark basket", dims: { l: 0.35, w: 0.3, h: 0.25 }, massKg: 0.3, parts: [{ material: "bark", fraction: 1 }], tags: ["hollow"], fungible: false, container: { capacityKg: 4 }, worn: true, visual: "basket" }),
  def({ id: "cord", aliases: ["cord"], name: "length of cord", dims: { l: 1.2, w: 0.01, h: 0.01 }, massKg: 0.03, parts: [{ material: "bark", fraction: 1 }], tags: ["strip", "long"], fungible: true, visual: "strip" }),
  // anything River makes that has no mechanical meaning: a keepsake, a carving, an arrangement. Honest about doing nothing.
  def({ id: "keepsake", aliases: ["crafted", "keepsake"], name: "keepsake", dims: { l: 0.15, w: 0.1, h: 0.1 }, massKg: 0.3, parts: [{ material: "inert", fraction: 1 }], tags: [], fungible: false, visual: "keepsake" }),
  // conservative fallback for anything the game produces that has no definition yet
  def({ id: "generic", aliases: [], name: "thing", dims: { l: 0.15, w: 0.1, h: 0.1 }, massKg: 0.3, parts: [{ material: "inert", fraction: 1 }], tags: [], fungible: false, visual: "keepsake" }),
];

const BY_ID = new Map(ITEM_DEFS.map((d) => [d.id, d] as const));
const BY_ALIAS = new Map<string, ItemDef>();
for (const d of ITEM_DEFS) for (const a of [d.id, ...d.aliases]) if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, d);

export const defById = (id: string): ItemDef => BY_ID.get(id) ?? BY_ID.get("generic")!;
/** The definition for a kind the game already uses; unknown kinds get the inert fallback. */
export const defForKind = (kind: string): ItemDef => BY_ALIAS.get(kind.toLowerCase()) ?? BY_ID.get("generic")!;

const capCache = new Map<string, string[]>();
/** What this kind of thing can do. Same for every instance until its condition says otherwise. */
export function capabilitiesOf(d: ItemDef): string[] {
  const k = `${d.id}@${d.version}`;
  let c = capCache.get(k);
  if (!c) { c = deriveCapabilities(d.parts, d.tags, d.dims, { container: !!d.container, wearable: !!d.wearable, edible: d.nutrition !== undefined }); capCache.set(k, c); }
  return c;
}
