// Making things from what River holds. Everything is checked before anything is touched; the parts a recipe names are used up
// exactly (tools are only worn); what is made weighs what went into it; and it remembers what it was made from.
import { ToolError } from "./toolkit.ts";
import { simRng } from "./sim.ts";
import { defById } from "../content/items.ts";
import { matchRecipe, type Candidate, type Recipe } from "../content/recipes.ts";
import type { World } from "./world.ts";
import type { ItemInstance } from "./items.ts";

const sr = simRng("crafting");

/** River's carried items, as a recipe sees them. */
export const candidates = (w: World): Candidate[] =>
  w.items.carried().map((i) => ({ id: i.id, defId: i.defId, qty: i.qty, durability: i.condition.durability, massKg: w.items.unitMass(i) }));

/** Check a recipe against what is held. Changes nothing. Throws what is missing. */
export function checkRecipe(w: World, r: Recipe, prefer: string[] = []) {
  const m = matchRecipe(r, candidates(w), prefer);
  if (!m.ok) throw new ToolError(`You can't make ${r.name} yet: ${m.why}.`);
  return m;
}

export interface Made { item: ItemInstance; quality: number; used: { id: string; name: string; qty: number }[] }

/**
 * Make it. Revalidates, then uses up exactly the consumed parts, wears the tools, and creates the product.
 * Quality comes from the parts' condition and a small seeded variation; a product's stats scale with it.
 */
export function craftNow(w: World, r: Recipe, prefer: string[] = []): Made {
  const m = checkRecipe(w, r, prefer);
  const sturdiness = m.picks.reduce((s, p) => s + p.item.durability, 0) / m.picks.length;
  const quality = r.qualityFrom === "parts" ? Math.max(0.5, Math.min(1.15, +(0.55 + 0.5 * sturdiness + (sr() - 0.5) * 0.2).toFixed(3))) : 1;
  const parts = new Map<string, number>(), used: Made["used"] = [], sources: string[] = [];
  for (const p of m.picks) {
    const inst = w.items.get(p.item.id)!;
    sources.push(inst.id);
    if (p.role.consumed) {
      for (const part of inst.parts) parts.set(part.material, (parts.get(part.material) ?? 0) + part.mass * p.qty);
      used.push({ id: inst.id, name: inst.name, qty: p.qty });
      w.items.take(inst.id, p.qty, `made ${r.name}`);
    } else w.items.wear(inst.id, 0.03);                                      // a tool is worn, not used up
  }
  const stats = r.output.stats ? Object.fromEntries(Object.entries(r.output.stats).map(([k, v]) => [k, +(v * quality).toFixed(2)])) : {};
  const outParts = [...parts].map(([material, mass]) => ({ material, mass: +mass.toFixed(4) }));
  const item = w.items.add(r.output.kind, r.output.name, r.output.desc, r.output.qty, { ...stats, crafted: true, quality, recipe: r.id }, {
    sources, maker: true, defId: r.output.def, parts: outParts.length ? outParts : undefined, condition: { durability: Math.min(1, +(0.6 + 0.4 * sturdiness).toFixed(3)) }, note: `made by recipe ${r.id}@${r.version}`,
  });
  w.bump({ energy: -r.energy });
  return { item, quality, used };
}

/** What a recipe asks for, for River to read. */
export const describeRecipe = (r: Recipe) =>
  `${r.name} — ${r.summary} Needs: ${r.roles.map((x) => `${x.qty > 1 ? `${x.qty} × ` : ""}${x.def ?? x.needs.join("+")}${x.consumed ? "" : " (a tool, kept)"}`).join("; ")}. Takes about ${Math.round(r.durationMs / 1000)}s.`;

void defById;
