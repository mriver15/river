// What can be made, from what. A recipe names the roles its parts play and what each role must be able to do. Parts are matched by
// capability (derived from material and shape), never by name, so a thing River has called something grander cannot stand in.
import { capabilitiesOf, defById } from "./items.ts";

export interface Role {
  role: string;
  /** every one of these must be among the part's capabilities */
  needs: string[];
  /** or a definition by id (for outputs of earlier steps) */
  def?: string;
  qty: number;
  /** false: a tool. It must be there and in working order, and is worn a little, but not used up. */
  consumed: boolean;
}
export interface Recipe {
  id: string; version: string; name: string;
  /** shown to River so it can find out what is possible */
  summary: string;
  roles: Role[];
  durationMs: number;
  energy: number;
  output: { def: string; qty: number; name: string; desc: string; kind: string; stats?: Record<string, number> };
  /** a bounded assembly: limits that must hold across the parts */
  limits?: { massKg: number; connections: number };
  /** how much of the output depends on the parts' condition (0 = not at all) */
  qualityFrom: "parts" | "none";
  /** where it has to be done: beside a fire, say (clay is fired, not just shaped) */
  place?: "fire";
  /** made through another tool (clothes are sewn with `clothe`, not `craft`) */
  via?: string;
  /** properties of the product that follow from the parts used (a garment takes the colour of what it is sewn from) */
  derive?: (parts: { defId: string; qty: number }[]) => Record<string, unknown>;
}

/** what each garment is, where it goes on the body, how many pieces of fibre it takes, and how much cold it keeps off */
export const GARMENT_SPECS: Record<string, { slot: string; need: number; warm: number }> = {
  wrap: { slot: "body", need: 3, warm: 0.18 }, cloak: { slot: "body", need: 5, warm: 0.3 }, tunic: { slot: "body", need: 5, warm: 0.26 }, skirt: { slot: "body", need: 3, warm: 0.12 },
  hat: { slot: "head", need: 2, warm: 0.1 }, band: { slot: "head", need: 1, warm: 0.02 }, sandals: { slot: "feet", need: 3, warm: 0.08 }, scarf: { slot: "neck", need: 2, warm: 0.07 },
};
/** the colour of the fibres themselves */
const FIBRE_HEX: Record<string, string> = { bark: "#7a6246", moss: "#5a8a46", hide: "#7a5c3e" };

export const RECIPES: Recipe[] = [
  { id: "sharpen_stick", version: "1", name: "sharpened stick", summary: "Scrape a slender wooden rod to a point with something hard that has an edge.", durationMs: 4000, energy: 3, qualityFrom: "parts",
    roles: [{ role: "shaft", needs: ["shaft"], qty: 1, consumed: true }, { role: "scraper", needs: ["cuts"], qty: 1, consumed: false }],
    output: { def: "sharpened_stick", qty: 1, name: "sharpened stick", desc: "A stick whittled to a hard point. It will pierce.", kind: "weapon", stats: { dmg: 9, reach: 2.2 } } },
  { id: "spear", version: "1", name: "stone-tipped spear", summary: "Lash a stone point to a pointed shaft with something that binds.", durationMs: 5000, energy: 3, qualityFrom: "parts",
    roles: [{ role: "shaft", needs: ["shaft", "pierces"], qty: 1, consumed: true }, { role: "head", needs: ["cuts"], qty: 1, consumed: true }, { role: "binding", needs: ["binds"], qty: 1, consumed: true }],
    limits: { massKg: 3, connections: 2 },
    output: { def: "weapon", qty: 1, name: "stone-tipped spear", desc: "A long stick with a chipped stone lashed to its end. It reaches well and cuts deep.", kind: "weapon", stats: { dmg: 17, reach: 2.7 } } },
  { id: "cord", version: "1", name: "length of cord", summary: "Twist strips of bark into cord.", durationMs: 3000, energy: 1, qualityFrom: "none",
    roles: [{ role: "fibre", needs: ["binds"], qty: 2, consumed: true }],
    output: { def: "cord", qty: 1, name: "length of cord", desc: "Strips of bark twisted into a strong cord.", kind: "cord" } },
  { id: "basket", version: "1", name: "bark basket", summary: "Weave strips of bark into a basket that holds things.", durationMs: 8000, energy: 4, qualityFrom: "none",
    roles: [{ role: "weave", needs: ["binds"], qty: 4, consumed: true }],
    output: { def: "basket", qty: 1, name: "bark basket", desc: "A basket of woven bark. It holds a few kilos of whatever you put in it.", kind: "basket" } },
  { id: "hide_pouch", version: "1", name: "hide pouch", summary: "Stitch a hide closed around a drawstring of cord to make a small pouch.", durationMs: 6000, energy: 3, qualityFrom: "none",
    roles: [{ role: "skin", needs: [], def: "hide", qty: 1, consumed: true }, { role: "drawstring", needs: [], def: "cord", qty: 1, consumed: true }],
    output: { def: "pouch", qty: 1, name: "hide pouch", desc: "A small pouch of hide with a drawstring. It holds a kilo or so of small things.", kind: "pouch" } },
  { id: "wooden_flute", version: "1", name: "wooden flute", summary: "Carve a slender wooden rod hollow and cut finger holes, with something that has an edge.", durationMs: 9000, energy: 4, qualityFrom: "parts",
    roles: [{ role: "pipe", needs: ["shaft"], qty: 1, consumed: true }, { role: "carver", needs: ["cuts"], qty: 1, consumed: false }],
    output: { def: "flute", qty: 1, name: "wooden flute", desc: "A length of wood hollowed out and pierced for the fingers. Breath across it makes a note.", kind: "flute" } },
  { id: "clay_bowl", version: "1", name: "fired clay bowl", summary: "Shape clay into a bowl and fire it beside a fire, so it keeps its shape.", durationMs: 10000, energy: 3, qualityFrom: "none", place: "fire",
    roles: [{ role: "clay", needs: ["moldable"], qty: 2, consumed: true }],
    output: { def: "bowl", qty: 1, name: "fired clay bowl", desc: "A small bowl of fired clay. It holds a little, and it is heavy.", kind: "bowl" } },
  ...Object.entries(GARMENT_SPECS).map(([g, sp]): Recipe => ({
    id: `sew_${g}`, via: "clothe", version: "1", name: g, summary: `Sew a ${g} (for the ${sp.slot}) from bark, moss or hide: about ${sp.need} pieces.`, durationMs: 3500, energy: 3, qualityFrom: "none",
    roles: [{ role: "fibre", needs: ["fibre"], qty: sp.need, consumed: true }],
    output: { def: "garment", qty: 1, name: g, desc: `A ${g}, sewn from fibre. It goes on your ${sp.slot}.`, kind: "garment", stats: {} },
    derive: (parts) => {
      const top = [...parts].sort((a, b) => b.qty - a.qty)[0]?.defId ?? "bark";
      return { garment: g, slot: sp.slot, warm: sp.warm, hex: FIBRE_HEX[top] ?? "#7a6246" };
    },
  })),
];

/** Add recipes from a content pack. A pack cannot replace one that exists. */
export function registerRecipes(rs: Recipe[]) {
  for (const r of rs) { if (RECIPES.some((x) => x.id === r.id)) throw new Error(`content pack recipe "${r.id}" already exists`); RECIPES.push(r); }
}

export const recipeById = (id: string) => RECIPES.find((r) => r.id === id);
/** what `craft` offers: everything not made through some other tool */
export const craftable = () => RECIPES.filter((r) => !r.via);
export const recipeByName = (q: string) => { const s = q.toLowerCase().trim(); return craftable().find((r) => r.id === s || r.name.toLowerCase() === s) ?? craftable().find((r) => r.name.toLowerCase().includes(s) || r.id.includes(s.replace(/\s+/g, "_"))); };

/** The part of an item a recipe needs to see. */
export interface Candidate { id: string; defId: string; qty: number; durability: number; massKg: number }
export interface Pick { role: Role; item: Candidate; qty: number }
export type Match = { ok: true; picks: Pick[]; massKg: number } | { ok: false; why: string };

const can = (c: Candidate, need: string[]) => c.durability > 0 && need.every((n) => capabilitiesOf(defById(c.defId)).includes(n));

/**
 * Choose parts for every role from `have`, without using any unit twice. Prefers the sturdiest parts. Fails with what is missing,
 * touching nothing: matching never changes anything.
 */
export function matchRecipe(r: Recipe, have: Candidate[], prefer: string[] = []): Match {
  const left = new Map(have.map((c) => [c.id, c.qty] as const)), picks: Pick[] = [];
  for (const role of r.roles) {
    const pool = have.filter((c) => (role.def ? c.defId === role.def : can(c, role.needs)) && (left.get(c.id) ?? 0) > 0)
      .sort((a, b) => Number(prefer.includes(b.id)) - Number(prefer.includes(a.id)) || b.durability - a.durability || (a.id < b.id ? -1 : 1));
    let need = role.qty;
    for (const c of pool) { if (need <= 0) break; const take = Math.min(need, left.get(c.id)!); left.set(c.id, left.get(c.id)! - take); picks.push({ role, item: c, qty: take }); need -= take; }
    if (need > 0) return { ok: false, why: `missing ${role.qty} ${role.role} (something that ${role.needs.join(" and ")})${role.def ? ` — a ${role.def}` : ""}` };
  }
  const massKg = picks.reduce((s, p) => s + p.item.massKg * p.qty, 0);
  if (r.limits && massKg > r.limits.massKg + 1e-9) return { ok: false, why: `too heavy for a ${r.name} (${massKg.toFixed(1)} kg, at most ${r.limits.massKg})` };
  if (r.limits && picks.length > r.limits.connections + 1) return { ok: false, why: `too many parts to join (${picks.length})` };
  return { ok: true, picks, massKg };
}

import { CONTENT_PACKS } from "./packs/index.ts";
for (const p of CONTENT_PACKS) registerRecipes(p.recipes ?? []);
