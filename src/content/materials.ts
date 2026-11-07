// Materials and the rules that turn what a thing is made of, and its shape, into what it can do.
// Capabilities come only from here. A description River writes, or a name it gives, never adds one.
export const RULES_VERSION = "1";

export interface Material {
  id: string;
  /** kg per cubic metre, for working out mass from size */
  density: number;
  /** what the stuff is, regardless of shape */
  traits: string[];
  /** fuel: seconds it burns per kg, and how hot */
  fuel?: { burnSecondsPerKg: number; heatC: number };
  /** how readily it takes fire when dry, 0..1 */
  flammability: number;
  /** can be worked into a strip that binds */
  flexible?: boolean;
  /** what remains when it burns */
  ash?: string;
  /** how it looks, if the built-in table does not know it: colour, roughness, metalness */
  look?: [number, number, number];
  /** how well it keeps heat once warmed, 0..1: a stone by the fire stays warm a long while, a stick does not */
  retention: number;
}

export const MATERIALS: Record<string, Material> = {
  wood: { id: "wood", density: 600, retention: 0.25, traits: ["burns"], fuel: { burnSecondsPerKg: 900, heatC: 600 }, flammability: 0.7, ash: "charcoal" },
  stone: { id: "stone", density: 2600, retention: 0.9, traits: ["hard"], flammability: 0 },
  bark: { id: "bark", density: 400, retention: 0.15, traits: ["burns"], fuel: { burnSecondsPerKg: 500, heatC: 500 }, flammability: 0.8, flexible: true, ash: "charcoal" },
  moss: { id: "moss", density: 150, retention: 0.1, traits: ["burns", "insulates", "absorbs"], fuel: { burnSecondsPerKg: 200, heatC: 300 }, flammability: 0.3, flexible: true },
  hide: { id: "hide", density: 900, retention: 0.2, traits: ["insulates", "waterproof"], flammability: 0.3, flexible: true },
  clay: { id: "clay", density: 1800, retention: 0.85, traits: ["moldable"], flammability: 0 },
  charcoal: { id: "charcoal", density: 400, retention: 0.5, traits: ["burns", "marks"], fuel: { burnSecondsPerKg: 1500, heatC: 800 }, flammability: 0.6 },
  pigment: { id: "pigment", density: 1500, retention: 0.4, traits: ["marks", "dyes"], flammability: 0 },
  // not on the original list; inert unless noted, so that nothing River finds is left without a definition
  food: { id: "food", density: 1000, retention: 0.3, traits: ["edible"], flammability: 0.1 },
  shell: { id: "shell", density: 2400, retention: 0.6, traits: ["hard"], flammability: 0 },
  glass: { id: "glass", density: 2500, retention: 0.6, traits: ["hard", "holds-liquid-when-hollow"], flammability: 0 },
  metal: { id: "metal", density: 7800, retention: 0.7, traits: ["hard"], flammability: 0 },
  paper: { id: "paper", density: 700, retention: 0.1, traits: ["burns"], fuel: { burnSecondsPerKg: 300, heatC: 400 }, flammability: 0.9 },
  inert: { id: "inert", density: 800, retention: 0.3, traits: [], flammability: 0 },
};

/** Add materials from a content pack. A pack cannot replace one that exists. */
export function registerMaterials(ms: Record<string, Omit<Material, "id">>) {
  for (const [id, m] of Object.entries(ms)) { if (MATERIALS[id]) throw new Error(`content pack material "${id}" already exists`); MATERIALS[id] = { id, ...m }; }
}

export interface Part { material: string; fraction: number }

/**
 * What a thing can do, from its materials and its shape tags. Tags describe geometry the definition states, not prose:
 *  long (a rod, longer than ~0.6 m), pointed, edge (a worked cutting edge), strip (thin and flexible), hollow, flat.
 */
export function deriveCapabilities(parts: Part[], tags: string[], dims: { l: number; w: number; h: number }, extra: { container?: boolean; wearable?: boolean; edible?: boolean } = {}): string[] {
  const caps = new Set<string>();
  const mats = parts.map((p) => MATERIALS[p.material] ?? MATERIALS.inert!);
  const main = mats[0] ?? MATERIALS.inert!;
  for (const m of mats) for (const t of m.traits) if (!t.includes("-when-")) caps.add(t);
  const has = (t: string) => tags.includes(t);
  const hard = mats.some((m) => m.traits.includes("hard"));
  if (has("long") && dims.l >= 0.6 && dims.w <= 0.06 && dims.h <= 0.06 && main.id === "wood") caps.add("shaft");       // a slender wooden rod, not a board
  if (has("pointed")) caps.add("pierces");
  if (has("edge") && hard) caps.add("cuts");
  if (has("strip") && mats.some((m) => m.flexible)) caps.add("binds");
  if (has("hollow") && has("wind") && mats.some((m) => m.id === "wood")) caps.add("sounds");        // a hollow wooden pipe can be blown across
  if (mats.some((m) => m.flexible)) caps.add("fibre");                                                  // can be worked into cloth, cord or weave
  if (has("hollow") && mats.some((m) => m.traits.some((t) => t.startsWith("holds-liquid") || t === "waterproof") || m.id === "clay")) caps.add("holds-liquid");
  if (has("flat") && mats.some((m) => m.flexible)) caps.add("covers");
  if (extra.container) caps.add("holds");
  if (extra.wearable) caps.add("wearable");
  if (extra.edible || mats.some((m) => m.traits.includes("edible"))) caps.add("edible");
  if (mats.some((m) => m.fuel)) caps.add("fuel");
  return [...caps].sort();
}

/** Mass in kg from size and material mix, when a definition does not state it. */
export function massOf(parts: Part[], dims: { l: number; w: number; h: number }, fillFactor = 0.5): number {
  const vol = dims.l * dims.w * dims.h * fillFactor;
  const d = parts.reduce((s, p) => s + (MATERIALS[p.material]?.density ?? 800) * p.fraction, 0);
  return +(vol * d).toFixed(3);
}

import { CONTENT_PACKS } from "./packs/index.ts";
for (const p of CONTENT_PACKS) registerMaterials(p.materials ?? {});
