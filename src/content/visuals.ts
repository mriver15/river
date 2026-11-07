// How things look. A visual recipe turns an item's definition (its dimensions and materials) and its instance seed into a short list of
// approved primitive components. The server and the client both read this file: the server for sizes and bounds, the client to draw.
// Nothing here can affect what an item is or does, and nothing here reads a mesh: bounds come from the numbers.
import { defById, type ItemDef } from "./items.ts";
import { MATERIALS } from "./materials.ts";

export const VISUAL_VERSION = "1";
export const MAX_COMPONENTS = 32;                     // per item; raise after profiling
export const MAX_TRIANGLES = 3000;                    // per item, a budget for the whole design
export const MIN_EXTENT = 0.002;                      // metres: smaller than this cannot be seen or placed
export const MAX_EXTENT = 3;                          // metres: larger than any held thing

export type Shape = "box" | "sphere" | "cylinder" | "cone" | "torus";
export type Channel = "primary" | "secondary" | "accent" | "metal" | "glass" | "glow";
export type Axis = "x" | "y" | "z";
export type V3 = [number, number, number];
export const SHAPES: readonly Shape[] = ["box", "sphere", "cylinder", "cone", "torus"];
export const CHANNELS: readonly Channel[] = ["primary", "secondary", "accent", "metal", "glass", "glow"];

/** One primitive. `size` is the full extent along each world axis (x = length, y = up, z = width); `pos` is its centre. */
export interface Component {
  shape: Shape;
  size: V3;
  pos: V3;
  channel: Channel;
  /** which way a cylinder or cone points (its tip toward +axis), or what a torus rings around. Default y. */
  axis?: Axis;
  /** a tube with no end caps, drawn from both sides: cloth */
  open?: boolean;
  /** the fraction of a cylinder's circumference present (a cloak does not close) */
  arc?: number;
  /** drawn only at damage levels min..max (0 sound .. 3 broken); omit for always */
  damage?: [number, number];
  /** drawn only once the item has been repaired */
  repaired?: boolean;
  /** kept when the item is far away and drawn cheaply */
  major?: boolean;
}

/** How an item's condition shows. Quantised, so the world only has to say so when it visibly changes. */
export interface Look { wet: number; char: number; damage: number; hot: boolean; repaired: boolean }
export const NEW_LOOK: Look = { wet: 0, char: 0, damage: 0, hot: false, repaired: false };

export function lookOf(c: { durability: number; wetness: number; temperatureC: number }, props: Record<string, any> = {}): Look {
  return {
    wet: Math.round(Math.max(0, Math.min(1, c.wetness)) * 4) / 4,
    char: props.charred ? 1 : props.roasted ? 0.5 : 0,
    damage: c.durability >= 0.7 ? 0 : c.durability >= 0.4 ? 1 : c.durability >= 0.15 ? 2 : 3,
    hot: c.temperatureC >= 200,
    repaired: !!props.repaired,
  };
}
export const lookKey = (l: Look) => `${l.wet}/${l.char}/${l.damage}/${l.hot ? 1 : 0}/${l.repaired ? 1 : 0}`;

/** What a client needs to draw one item, wherever it is: on the ground, in a pack preview, on the body. */
export interface VisualPacket {
  recipeId: string; version: string; seed: number; parameters: Record<string, unknown>;
  defId: string; mats: string[]; look: Look;
}

// ---------- colour ----------
export interface Style { color: number; roughness: number; metalness: number; opacity: number; emissive: number; emissiveIntensity: number }
const MAT_LOOK: Record<string, [number, number, number]> = {      // colour, roughness, metalness
  wood: [0x9a6b3f, 0.9, 0], stone: [0x8d9199, 0.95, 0], bark: [0x7a5a3a, 1, 0], moss: [0x5f8f3f, 1, 0], hide: [0xa57a52, 0.9, 0],
  clay: [0xb5714a, 0.95, 0], charcoal: [0x232120, 1, 0], pigment: [0xc0503a, 1, 0], food: [0xc9a05a, 0.8, 0], shell: [0xf2c9c0, 0.4, 0],
  glass: [0xa8d8e0, 0.1, 0], metal: [0x9aa0a8, 0.35, 0.8], paper: [0xe8dcc0, 1, 0], inert: [0xb8a98f, 0.8, 0],
};
const matLook = (m: string) => MAT_LOOK[m] ?? MATERIALS[m]?.look ?? MAT_LOOK.inert!;
const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const darker = (c: number, t: number) => mix(c, 0x000000, t);

function rngOf(seed: number) {                         // mulberry32: a stable stream of numbers from the instance's seed
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hexNum = (h: unknown): number | null => (typeof h === "string" && /^#[0-9a-fA-F]{6}$/.test(h) ? parseInt(h.slice(1), 16) : null);

/** The colour and finish of each channel for one item, with wet, burnt and heat applied. */
export function styleFor(p: Pick<VisualPacket, "seed" | "parameters" | "mats" | "look">): Record<Channel, Style> {
  const [m1, m2] = [p.mats[0] ?? "inert", p.mats[1]];
  const [c1, r1, k1] = matLook(m1), dyed = hexNum(p.parameters.hex);
  const base = dyed ?? (p.parameters.variant === "chalk" ? 0xe6e2d6 : c1);        // chalk is made of the pigment material but is not coloured like it
  const rnd = rngOf(p.seed), tint = 0.92 + rnd() * 0.16;                 // each one slightly its own colour
  const L = p.look;
  const finish = (c: number, r: number, k: number, o = 1): Style => {
    const sc = (s: number) => Math.min(255, Math.round(((c >> s) & 255) * tint));
    let col = (sc(16) << 16) | (sc(8) << 8) | sc(0);
    col = darker(col, 0.35 * L.wet);                                      // wet things are darker and shinier
    col = mix(col, 0x1a1816, 0.85 * L.char);
    return { color: col, roughness: Math.max(0.15, r * (1 - 0.5 * L.wet)), metalness: k, opacity: o, emissive: 0, emissiveIntensity: 0 };
  };
  const ore = p.parameters.variant === "copper_ore";               // a dull rock shot through with verdigris and orange
  const primary = finish(base, r1, k1, m1 === "glass" ? 0.55 : 1);
  const second = m2 ? matLook(m2) : null;
  const secondary = ore ? finish(0xc27a3a, 0.8, 0) : second ? finish(second[0], second[1], second[2]) : finish(darker(base, 0.3), r1, k1);
  const accent = ore ? finish(0x4aa386, 0.7, 0) : finish(dyed ?? mix(base, 0xffffff, 0.25), 0.8, 0);
  const metal = finish(0x9aa0a8, 0.35, 0.8), glass = finish(0xa8d8e0, 0.1, 0, 0.5);
  const glow: Style = { color: 0xffd58a, roughness: 1, metalness: 0, opacity: 1, emissive: 0xff8a30, emissiveIntensity: 1.2 };
  if (L.hot) for (const s of [primary, secondary]) { s.emissive = 0xff5a10; s.emissiveIntensity = 0.9; }
  return { primary, secondary, accent, metal, glass, glow };
}

// ---------- building ----------
interface Ctx { dims: { l: number; w: number; h: number }; rnd: () => number; params: Record<string, unknown>; variant: string }
const c = (shape: Shape, size: V3, pos: V3, channel: Channel = "primary", extra: Partial<Component> = {}): Component => ({ shape, size, pos, channel, ...extra });
const around = (r: () => number, amount: number) => 1 + (r() - 0.5) * 2 * amount;

export interface VisualRecipe {
  id: string; version: string;
  build: (x: Ctx) => Component[];
  /** named attachment points, in the item's own space (before it is placed): where a hand grips, where a cord ties */
  sockets?: Record<string, V3>;
}

const R: VisualRecipe[] = [];
const recipe = (id: string, build: VisualRecipe["build"], sockets?: VisualRecipe["sockets"]) => R.push({ id, version: VISUAL_VERSION, build, sockets });

recipe("stick", ({ rnd }) => {
  const out = [c("cylinder", [1, 0.035, 0.035], [0, 0, 0], "primary", { axis: "x", major: true })];
  out.push(c("cone", [0.04, 0.03, 0.03], [0.5, 0, 0], "secondary", { axis: "x" }));              // a broken end
  const at = (rnd() - 0.5) * 0.6; out.push(c("cylinder", [0.03, 0.06, 0.03], [at, 0.02, 0], "primary", { axis: "y" }));  // a stub of a branch
  out.push(c("cone", [0.028, 0.02, 0.028], [at, 0.06, 0], "secondary", { axis: "y", damage: [0, 1] }));
  out.push(c("sphere", [0.03, 0.02, 0.03], [-0.3, 0.012, 0], "secondary", { damage: [2, 3] }));      // splintered
  return out;
}, { grip: [0, 0, 0] });

recipe("stone", ({ rnd }) => [
  c("sphere", [1, 0.7, 0.8], [0, 0, 0], "primary", { major: true }),
  c("sphere", [0.5 * around(rnd, 0.2), 0.4, 0.5], [0.2, 0.12, 0.1], "primary"),
  c("box", [0.3, 0.3, 0.25], [-0.25, -0.05, 0.2 * around(rnd, 0.3)], "secondary", { damage: [1, 3] }),       // a chipped face
  c("cone", [0.35, 0.25, 0.3], [0.38, -0.02, -0.12], "secondary", { axis: "x", damage: [2, 3] }),            // a broken edge
]);

recipe("lump", ({ rnd, variant }) => {
  const chalk = variant === "chalk", coal = variant === "charcoal", ore = variant === "copper_ore";
  const out = [c(coal ? "box" : "sphere", [1, 0.55, 0.7], [0, 0, 0], "primary", { major: true })];
  if (ore) {                                                                                   // veins of verdigris and a few orange flecks standing proud of the rock
    out.push(c("sphere", [0.5, 0.3, 0.3], [0.2, 0.18, 0.2], "accent", { major: true }), c("sphere", [0.35, 0.2, 0.25], [-0.25, 0.1, 0.22], "accent"), c("sphere", [0.18, 0.14, 0.16], [0.05, 0.22, -0.15], "secondary", { major: true }), c("sphere", [0.15, 0.12, 0.14], [-0.38, 0.05, -0.05], "secondary"));
  }
  out.push(c(coal ? "box" : "sphere", [0.55, 0.4, 0.45], [0.2, 0.12, 0.1 * around(rnd, 0.5)], chalk ? "accent" : "primary"));
  if (coal) out.push(c("box", [0.3, 0.3, 0.3], [-0.3, 0.05, -0.1], "secondary"));
  return out;
});

recipe("food", ({ rnd, variant }) => {
  if (variant === "mushroom") return [c("cylinder", [0.35, 0.6, 0.35], [0, 0, 0], "accent", { major: true }), c("sphere", [1, 0.55, 1], [0, 0.4, 0], "primary", { major: true })];
  if (variant === "meat") return [c("box", [1, 0.35, 0.6], [0, 0, 0], "primary", { major: true }), c("box", [0.4, 0.2, 0.3], [0.2, 0.25, 0.1], "secondary"), c("cylinder", [0.9, 0.12, 0.12], [0.05, 0.2, -0.15], "accent", { axis: "x" })];
  const n = 3 + Math.floor(rnd() * 3), out: Component[] = [];                                      // berries in a little cluster
  for (let i = 0; i < n; i++) out.push(c("sphere", [0.5, 0.5, 0.5], [(i - n / 2) * 0.3 + 0.1, (i % 2) * 0.2, ((i * 7) % 3 - 1) * 0.2], "primary", { major: i < 2 }));
  out.push(c("cone", [0.1, 0.2, 0.1], [0, 0.35, 0], "secondary"));
  return out;
});

recipe("seed", () => [c("sphere", [1, 0.6, 0.6], [0, 0, 0], "primary", { major: true }), c("cone", [0.3, 0.3, 0.3], [0.55, 0, 0], "secondary", { axis: "x" })]);

recipe("flower", ({ rnd }) => {
  const out = [c("cylinder", [0.06, 0.8, 0.06], [0, 0, 0], "secondary", { major: true })], petals = 5;
  out.push(c("sphere", [0.2, 0.2, 0.2], [0, 0.45, 0], "glow", { major: true }));
  for (let i = 0; i < petals; i++) { const a = (i / petals) * Math.PI * 2 + rnd() * 0.2; out.push(c("sphere", [0.22, 0.12, 0.22], [Math.cos(a) * 0.2, 0.42, Math.sin(a) * 0.2], "accent")); }
  out.push(c("box", [0.25, 0.02, 0.1], [0.15, 0.1, 0], "secondary", { damage: [0, 1] }));
  return out;
});

recipe("shell", () => [
  c("sphere", [1, 0.5, 0.7], [0, 0, 0], "primary", { major: true }), c("torus", [0.9, 0.1, 0.55], [0, 0.22, 0], "accent", { axis: "y" }), c("cone", [0.3, 0.3, 0.3], [-0.4, 0.1, 0], "secondary", { axis: "x" }),
]);

recipe("fish", ({ rnd }) => [
  c("sphere", [0.75, 0.5, 0.35], [0, 0, 0], "primary", { major: true }),
  c("cone", [0.3, 0.4, 0.1], [-0.5, 0, 0], "secondary", { axis: "x", major: true }),
  c("cone", [0.2, 0.18, 0.06], [0.05, 0.28, 0], "secondary"),
  c("sphere", [0.07, 0.07, 0.05], [0.28, 0.07, 0.17 * around(rnd, 0.05)], "metal"),
]);

recipe("hide", ({ rnd }) => [
  c("box", [1, 0.1, 0.8], [0, 0, 0], "primary", { major: true }),
  c("box", [0.35, 0.1, 0.3], [0.3, 0.03, 0.25 * around(rnd, 0.3)], "secondary"),
  c("box", [0.25, 0.1, 0.2], [-0.35, 0.03, -0.3], "secondary"),
  c("box", [0.1, 0.1, 0.15], [0.52, 0, -0.35], "primary", { damage: [0, 1] }),
]);

recipe("strip", ({ variant, rnd }) => variant === "reed" ? [
  c("cylinder", [1, 0.05, 0.05], [0, 0, 0], "primary", { axis: "x", major: true }),
  c("cylinder", [0.95, 0.05, 0.05], [0.02, 0.04, 0.05 * around(rnd, 0.3)], "primary", { axis: "x", major: true }),
  c("cylinder", [1, 0.05, 0.05], [-0.02, 0.02, -0.05], "secondary", { axis: "x" }),
  c("cone", [0.08, 0.05, 0.05], [0.5, 0, 0], "secondary", { axis: "x" }),
] : variant === "cord" ? [
  c("cylinder", [1, 0.1, 0.1], [0, 0, 0], "primary", { axis: "x", major: true }),
  c("torus", [0.12, 0.1, 0.1], [0.3, 0, 0], "secondary", { axis: "x" }),
  c("torus", [0.12, 0.1, 0.1], [-0.2, 0, 0], "secondary", { axis: "x" }),
] : [
  c("box", [1, 0.06, 0.6], [0, 0, 0], "primary", { major: true }),
  c("box", [0.3, 0.06, 0.45], [0.35, 0.02, 0.05], "secondary"),
  c("box", [0.12, 0.05, 0.35], [-0.45, 0.01, 0], "secondary", { damage: [0, 1] }),
]);

recipe("moss", ({ rnd }) => {
  const out: Component[] = [];
  for (let i = 0; i < 6; i++) out.push(c("sphere", [0.45, 0.3, 0.45], [((i % 3) - 1) * 0.3, (i % 2) * 0.1, (Math.floor(i / 3) - 0.5) * 0.4 * around(rnd, 0.2)], i % 2 ? "primary" : "secondary", { major: i < 3 }));
  return out;
});

recipe("pigment", ({ rnd }) => [
  c("cylinder", [1, 0.3, 1], [0, 0, 0], "secondary", { major: true }),
  c("cylinder", [0.8, 0.2, 0.8], [0, 0.22, 0], "accent", { major: true }),
  c("sphere", [0.25, 0.15, 0.25], [0.25 * around(rnd, 0.3), 0.3, 0.1], "accent"),
]);

recipe("plank", () => [
  c("box", [1, 0.2, 0.15], [0, 0, 0], "primary", { major: true }),
  c("box", [1, 0.05, 0.15], [0, 0.1, 0.0], "secondary"),
  c("cylinder", [0.04, 0.22, 0.04], [0.35, 0, 0.0], "metal", { damage: [0, 1] }),       // a nail from someone's boat
  c("box", [0.2, 0.2, 0.12], [-0.45, 0, 0], "secondary", { damage: [2, 3] }),
]);

recipe("bottle", () => [
  c("cylinder", [0.7, 0.9, 0.9], [-0.1, 0, 0], "glass", { axis: "x", major: true }),
  c("cylinder", [0.3, 0.38, 0.38], [0.4, 0, 0], "glass", { axis: "x", major: true }),
  c("cylinder", [0.08, 0.34, 0.34], [0.55, 0, 0], "accent", { axis: "x" }),              // a wax seal
  c("cylinder", [0.5, 0.2, 0.2], [-0.05, 0, 0], "accent", { axis: "x", damage: [0, 2] }),    // a rolled paper inside
  c("box", [0.1, 0.5, 0.5], [-0.3, 0.2, 0.2], "secondary", { damage: [3, 3] }),
]);

recipe("cup", () => [
  c("cylinder", [1, 1, 1], [0, 0, 0], "metal", { major: true }),
  c("cylinder", [0.85, 0.12, 0.85], [0, 0.5, 0], "secondary", { major: true }),
  c("torus", [0.4, 0.5, 0.1], [0.6, 0, 0], "metal", { axis: "z" }),
  c("box", [0.3, 0.3, 0.2], [-0.3, 0.45, 0.4], "secondary", { damage: [2, 3] }),
]);

recipe("lamp", () => [
  c("cylinder", [0.9, 0.2, 0.9], [0, 0, 0], "metal", { major: true }),
  c("sphere", [0.8, 0.55, 0.8], [0, 0.35, 0], "glass", { major: true }),
  c("sphere", [0.35, 0.3, 0.35], [0, 0.35, 0], "glow", { major: true }),
  c("cone", [0.6, 0.25, 0.6], [0, 0.7, 0], "metal"),
  c("torus", [0.5, 0.3, 0.5], [0, 0.88, 0], "metal", { axis: "y" }),
]);

recipe("book", ({ rnd }) => {
  const out = [c("box", [1, 0.9, 0.9], [0, 0, 0], "secondary", { major: true })];            // the cover
  out.push(c("box", [0.94, 0.78, 0.84], [0.03, 0, 0.02], "accent", { major: true }));         // the pages
  out.push(c("box", [0.1, 1, 1], [-0.5, 0, 0], "secondary", { major: true }));                // the spine
  out.push(c("box", [0.18, 0.12, 0.05], [0.4, 0.45 * around(rnd, 0.01), 0.45], "accent", { damage: [0, 1] }));   // a ribbon marker
  out.push(c("box", [0.3, 0.15, 0.4], [0.35, -0.38, 0.05], "secondary", { damage: [2, 3] }));         // a torn corner
  return out;
}, { open: [0, 0.5, 0] });

const GARMENT_FOLD: Record<string, V3> = { wrap: [1, 0.3, 0.8], tunic: [0.9, 0.35, 0.8], cloak: [1, 0.5, 0.7], skirt: [0.9, 0.3, 0.9], hat: [0.7, 0.6, 0.7], band: [0.8, 0.12, 0.3], scarf: [1, 0.2, 0.3] };
recipe("garment", ({ params, rnd }) => {
  const g = String(params.garment ?? "wrap");
  if (g === "sandals") return [-1, 1].map((s) => c("box", [0.5, 0.12, 0.9], [0, 0.1, s * 0.5], "primary", { major: true })).concat([-1, 1].map((s) => c("box", [0.5, 0.04, 0.1], [0, 0.2, s * 0.5], "accent")));
  if (g === "hat") return [c("cylinder", [1, 0.1, 1], [0, 0, 0], "primary", { major: true }), c("cone", [0.6, 0.8, 0.6], [0, 0.45, 0], "primary", { major: true }), c("torus", [0.6, 0.12, 0.6], [0, 0.1, 0], "accent")];
  const f = GARMENT_FOLD[g] ?? GARMENT_FOLD.wrap!;
  return [c("box", f, [0, 0, 0], "primary", { major: true }), c("box", [f[0] * 0.95, 0.05, f[2] * 0.2], [0, f[1] / 2, rnd() * 0.1], "accent", { major: true }), c("box", [f[0] * 0.3, 0.08, f[2] * 0.6], [f[0] * 0.3, f[1] / 2 - 0.04, 0], "secondary", { repaired: true }),
    c("box", [f[0] * 0.2, f[1] * 0.4, f[2] * 0.3], [-f[0] * 0.35, 0, f[2] * 0.3], "secondary", { damage: [2, 3] })];
});

const spear = (len: number): VisualRecipe["build"] => () => [
  c("cylinder", [len, 0.03, 0.03], [0, 0, 0], "primary", { axis: "x", major: true }),
  c("cone", [0.12, 0.06, 0.06], [len / 2 + 0.06, 0, 0], "secondary", { axis: "x", major: true }),            // the head
  c("torus", [0.04, 0.05, 0.05], [len / 2 - 0.03, 0, 0], "accent", { axis: "x", damage: [0, 2] }),           // the binding
  c("torus", [0.04, 0.05, 0.05], [len / 2 - 0.08, 0, 0], "accent", { axis: "x", repaired: true }),           // a fresh binding after repair
  c("sphere", [0.05, 0.04, 0.04], [-0.1, 0.012, 0], "secondary", { damage: [2, 3] }),
];
recipe("spear", spear(1.8), { grip: [-0.1, 0, 0], tip: [0.95, 0, 0] });
recipe("stake", spear(1.0), { grip: [-0.1, 0, 0], tip: [0.5, 0, 0] });

recipe("basket", ({ rnd, variant }) => {
  const reed = variant === "reed_basket";                                            // taller, tighter, with a woven lid-rim and no handle
  const out = [c("cylinder", [0.9, reed ? 1.1 : 0.9, 0.9], [0, 0, 0], "primary", { major: true }), c("cylinder", [1, 0.1, 1], [0, reed ? 0.55 : 0.45, 0], "secondary", { major: true })];
  if (reed) { for (let i = 0; i < 6; i++) out.push(c("torus", [0.93, 0.06, 0.93], [0, -0.45 + i * 0.18, 0], "secondary", { axis: "y" })); return out; }
  for (let i = 0; i < 3; i++) out.push(c("torus", [0.95, 0.08, 0.95], [0, -0.3 + i * 0.3, 0], "secondary", { axis: "y" }));     // the weave, in rings
  out.push(c("torus", [0.8, 0.15, 0.1], [0, 0.45 * around(rnd, 0.01), 0], "accent", { axis: "z", damage: [0, 1] }));              // a handle
  return out;
}, { hold: [0, 0.2, 0] });

recipe("pouch", () => [
  c("sphere", [1, 0.9, 0.8], [0, 0, 0], "primary", { major: true }),
  c("cylinder", [0.5, 0.2, 0.5], [0, 0.42, 0], "secondary", { major: true }),
  c("torus", [0.52, 0.1, 0.52], [0, 0.35, 0], "accent", { axis: "y" }),                                // the draw cord
  c("cylinder", [0.2, 0.3, 0.2], [0.4, 0.45, 0], "accent", { damage: [0, 2] }),
]);

recipe("flute", ({ rnd }) => {
  const out = [c("cylinder", [1, 0.07, 0.07], [0, 0, 0], "primary", { axis: "x", major: true })];
  for (let i = 0; i < 5; i++) out.push(c("cylinder", [0.02, 0.012, 0.012], [-0.05 + i * 0.1, 0.035, 0], "secondary", { axis: "y" }));      // finger holes
  out.push(c("torus", [0.04, 0.08, 0.08], [0.46, 0, 0], "accent", { axis: "x" }), c("torus", [0.04, 0.08, 0.08], [-0.46, 0, 0], "accent", { axis: "x" }));
  out.push(c("box", [0.06, 0.016, 0.02], [-0.3 * around(rnd, 0.05), 0.037, 0], "secondary", { damage: [0, 2] }));
  out.push(c("box", [0.3, 0.02, 0.03], [0.2, 0.04, 0.01], "secondary", { damage: [2, 3] }));          // a crack along the bore
  return out;
}, { mouth: [-0.4, 0, 0], grip: [0, 0, 0] });

recipe("bowl", () => [
  c("cylinder", [1, 0.45, 1], [0, 0, 0], "primary", { major: true }),
  c("cylinder", [0.7, 0.25, 0.7], [0, -0.3, 0], "secondary", { major: true }),
  c("cylinder", [0.82, 0.05, 0.82], [0, 0.23, 0], "secondary", { major: true }),                         // the dark inside
  c("torus", [1, 0.08, 1], [0, 0.22, 0], "accent", { axis: "y" }),
  c("box", [0.2, 0.15, 0.1], [0.45, 0.2, 0], "secondary", { damage: [1, 3] }),                        // a chipped rim
]);

recipe("keepsake", ({ rnd }) => {
  const out = [c("sphere", [1, 0.8, 0.8], [0, 0, 0], "primary", { major: true }), c("sphere", [0.55, 0.5, 0.5], [0.2, 0.3, 0.1 * around(rnd, 0.5)], "accent", { major: true })];
  out.push(c("box", [0.4, 0.4, 0.4], [-0.3, -0.1, 0.2], "secondary"));
  out.push(c("torus", [0.7, 0.1, 0.7], [0, -0.1, 0], "accent", { axis: "y", repaired: true }));
  return out;
});

// ---- recipes for what content packs add ----
/** A blade bound into a short handle: the first material is the blade, the second the handle. */
recipe("knife", ({ rnd }) => [
  c("box", [0.55, 0.05, 0.22], [0.22, 0, 0], "primary", { major: true }),                          // the blade, broad at the base
  c("cone", [0.2, 0.05, 0.2], [0.58, 0, 0], "primary", { axis: "x", major: true }),                // its point
  c("cylinder", [0.5, 0.07, 0.07], [-0.25, 0, 0], "secondary", { axis: "x", major: true }),        // the handle
  c("torus", [0.07, 0.11, 0.11], [0.0, 0, 0], "accent", { axis: "x" }),                            // the lashing
  c("torus", [0.07, 0.11, 0.11], [-0.07, 0, 0], "accent", { axis: "x", damage: [0, 1] }),
  c("box", [0.12, 0.04, 0.06], [0.3 * around(rnd, 0.1), 0.03, 0.06], "primary", { damage: [2, 3] }),   // a chipped edge
], { grip: [-0.25, 0, 0], tip: [0.65, 0, 0] });

/** A heavy head lashed to a long haft. */
recipe("axe", () => [
  c("cylinder", [1, 0.05, 0.05], [0, 0, 0], "secondary", { axis: "x", major: true }),              // the haft
  c("box", [0.22, 0.2, 0.1], [0.38, 0.03, 0], "primary", { major: true }),                         // the head
  c("cone", [0.14, 0.2, 0.1], [0.5, 0.03, 0], "primary", { axis: "x", major: true }),              // the bit
  c("torus", [0.07, 0.09, 0.09], [0.3, 0, 0], "accent", { axis: "x" }),
  c("torus", [0.07, 0.09, 0.09], [0.24, 0, 0], "accent", { axis: "x", damage: [0, 1] }),
  c("sphere", [0.07, 0.05, 0.05], [-0.48, 0, 0], "secondary", { damage: [2, 3] }),
], { grip: [-0.25, 0, 0], tip: [0.55, 0, 0] });

/** A small bar of metal, narrower at the top, still pitted from the fire. */
recipe("ingot", ({ rnd }) => [
  c("box", [1, 0.5, 0.45], [0, 0, 0], "primary", { major: true }),
  c("box", [0.82, 0.22, 0.33], [0, 0.3, 0], "primary", { major: true }),
  c("sphere", [0.12, 0.06, 0.12], [0.2 * around(rnd, 0.4), 0.42, 0.04], "secondary"),
  c("sphere", [0.1, 0.06, 0.1], [-0.25, 0.4, -0.05], "secondary"),
]);

/** A round-bellied, narrow-necked pot with two lugs. */
recipe("pot", () => [
  c("sphere", [1, 0.85, 1], [0, 0, 0], "primary", { major: true }),
  c("cylinder", [0.5, 0.25, 0.5], [0, 0.5, 0], "primary", { major: true }),
  c("torus", [0.6, 0.08, 0.6], [0, 0.63, 0], "accent", { axis: "y" }),                              // the rim
  c("cylinder", [0.42, 0.04, 0.42], [0, 0.6, 0], "secondary", { major: true }),                     // the dark inside
  c("torus", [0.2, 0.16, 0.06], [0.52, 0.12, 0], "secondary", { axis: "z" }),                       // a lug
  c("torus", [0.2, 0.16, 0.06], [-0.52, 0.12, 0], "secondary", { axis: "z" }),
  c("box", [0.25, 0.2, 0.1], [0.4, 0.2, 0.3], "secondary", { damage: [1, 3] }),                     // a chip
]);

const REGISTRY = new Map(R.map((r) => [`${r.id}@${r.version}`, r] as const));
export const visualRecipeIds = (): string[] => R.map((r) => r.id);
export const visualRecipe = (id: string, version: string) => REGISTRY.get(`${id}@${version}`);

// ---------- validation and geometry ----------
const TRIS: Record<Shape, number> = { box: 12, sphere: 96, cylinder: 64, cone: 48, torus: 160 };
export class DesignError extends Error {}

/** Reject a design that is not made only of approved parts of sensible size. Used on every design before anything is allocated. */
export function validateDesign(comps: unknown): asserts comps is Component[] {
  if (!Array.isArray(comps)) throw new DesignError("a design is a list of components");
  if (comps.length === 0) throw new DesignError("a design has at least one component");
  if (comps.length > MAX_COMPONENTS) throw new DesignError(`a design may have ${MAX_COMPONENTS} components, not ${comps.length}`);
  const ok = new Set(["shape", "size", "pos", "channel", "axis", "open", "arc", "damage", "repaired", "major"]);
  let tris = 0;
  for (const k of comps as Record<string, any>[]) {
    if (!k || typeof k !== "object") throw new DesignError("a component is an object");
    for (const key of Object.keys(k)) if (!ok.has(key)) throw new DesignError(`unknown component field "${key}"`);          // no urls, no code, no extra payload
    if (!SHAPES.includes(k.shape)) throw new DesignError(`"${k.shape}" is not an approved shape`);
    if (!CHANNELS.includes(k.channel)) throw new DesignError(`"${k.channel}" is not a material channel`);
    if (k.axis !== undefined && !["x", "y", "z"].includes(k.axis)) throw new DesignError("axis is x, y or z");
    for (const v of [k.size, k.pos]) if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new DesignError("size and pos are three finite numbers");
    for (const n of k.size) if (n < MIN_EXTENT || n > MAX_EXTENT) throw new DesignError(`a component of ${n} m is outside ${MIN_EXTENT}..${MAX_EXTENT} m`);
    for (const n of k.pos) if (Math.abs(n) > MAX_EXTENT) throw new DesignError("a component is placed too far from its item");
    if (k.arc !== undefined && !(k.arc > 0 && k.arc <= 1)) throw new DesignError("arc is a fraction above 0 up to 1");
    tris += TRIS[k.shape as Shape];
  }
  if (tris > MAX_TRIANGLES) throw new DesignError(`a design may cost ${MAX_TRIANGLES} triangles, this costs ${tris}`);
}

export interface Bounds { min: V3; max: V3; size: V3 }
export function boundsOf(comps: Component[]): Bounds {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const k of comps) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, k.pos[a]! - k.size[a]! / 2); max[a] = Math.max(max[a]!, k.pos[a]! + k.size[a]! / 2); }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Scale a design so it is exactly the documented size, and stand it on the ground at its centre. The size on file is the truth. */
export function fit(comps: Component[], dims: { l: number; w: number; h: number }): Component[] {
  const b = boundsOf(comps), want: V3 = [dims.l, dims.h, dims.w];
  const k: V3 = [want[0] / b.size[0], want[1] / b.size[1], want[2] / b.size[2]];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  return comps.map((p) => ({
    ...p,
    size: [p.size[0] * k[0], p.size[1] * k[1], p.size[2] * k[2]] as V3,
    pos: [(p.pos[0] - cx) * k[0], (p.pos[1] - b.min[1]) * k[1], (p.pos[2] - cz) * k[2]] as V3,   // y is lifted so the item's lowest point is 0
  }));
}

/** The collision footprint a definition documents: what a client mesh must agree with and cannot change. */
export function collisionBounds(def: Pick<ItemDef, "dims">): Bounds {
  const { l, w, h } = def.dims;
  return { min: [-l / 2, 0, -w / 2], max: [l / 2, h, w / 2], size: [l, h, w] };
}

/** How big an item is drawn on the ground. Very small things are enlarged to be seen; the documented size never changes. */
export const GROUND_MIN_EDGE = 0.14, GROUND_MAX_SCALE = 12;
export function groundScale(dims: { l: number; w: number; h: number }): number {
  return Math.min(GROUND_MAX_SCALE, Math.max(1, GROUND_MIN_EDGE / Math.max(dims.l, dims.w, dims.h)));
}

/** Which components show at this condition. */
export function visibleParts(comps: Component[], look: Look): Component[] {
  return comps.filter((k) => (!k.damage || (look.damage >= k.damage[0] && look.damage <= k.damage[1])) && (!k.repaired || look.repaired));
}

export interface Resolved {
  components: Component[]; sockets: Record<string, V3>; bounds: Bounds; style: Record<Channel, Style>;
  /** why the neutral stand-in was used, if it was */
  diagnostic?: string;
}

/** The neutral stand-in: exactly the right size, plainly a block, claiming nothing about what the thing is. */
export function fallbackDesign(dims: { l: number; w: number; h: number }): Component[] {
  return fit([c("box", [1, 1, 1], [0, 0, 0], "secondary", { major: true })], dims);
}

/** Everything needed to draw one item, from its packet. Unknown recipes or versions give the stand-in with a diagnostic. */
export function resolve(p: VisualPacket): Resolved {
  const def = defById(p.defId), style = styleFor(p);
  const rec = visualRecipe(p.recipeId, p.version);
  const stand = (why: string): Resolved => { const comps = fallbackDesign(def.dims); return { components: visibleParts(comps, p.look), sockets: {}, bounds: boundsOf(comps), style, diagnostic: why }; };
  if (!rec) return stand(`no visual recipe "${p.recipeId}" at version ${p.version}`);
  try {
    const variant = String(p.parameters.variant ?? def.id);
    const raw = rec.build({ dims: def.dims, rnd: rngOf(p.seed), params: p.parameters, variant });
    validateDesign(raw);
    const comps = fit(raw, def.dims);
    return { components: visibleParts(comps, p.look), sockets: rec.sockets ?? {}, bounds: boundsOf(comps), style };
  } catch (e) {
    if (e instanceof DesignError) return stand(e.message);
    throw e;
  }
}

/** Build the full design for a definition at rest (all conditions), used by the gallery and by size checks. */
export function designOf(p: VisualPacket): Component[] {
  const rec = visualRecipe(p.recipeId, p.version);
  if (!rec) return fallbackDesign(defById(p.defId).dims);
  const def = defById(p.defId);
  return fit(rec.build({ dims: def.dims, rnd: rngOf(p.seed), params: p.parameters, variant: String(p.parameters.variant ?? def.id) }), def.dims);
}

// ---------- clothing on the body ----------
/** Where each slot's clothing is anchored on River's body, in metres from the feet. */
export const BODY_SOCKETS: Record<string, V3> = { body: [0, 0.9, 0], head: [0, 1.9, 0], neck: [0, 1.38, 0], feet: [0, 0, 0] };

/** A garment as worn: components relative to its slot's socket. Not fitted to the item's size; it is cut to the body. */
export function wornDesign(garment: string): { slot: string; components: Component[] } | null {
  const at = (slot: string, comps: Component[]) => ({ slot, components: comps.map((k) => ({ ...k, pos: [k.pos[0] - BODY_SOCKETS[slot]![0], k.pos[1] - BODY_SOCKETS[slot]![1], k.pos[2] - BODY_SOCKETS[slot]![2]] as V3 })) });
  switch (garment) {
    case "wrap": return at("body", [c("cylinder", [0.68, 0.5, 0.68], [0, 0.88, 0], "primary", { open: true }), c("torus", [0.6, 0.07, 0.6], [0, 1.12, 0], "accent", { axis: "y" })]);
    case "tunic": return at("body", [c("cylinder", [0.68, 0.8, 0.68], [0, 0.9, 0], "primary", { open: true }), ...[-0.36, 0.36].map((sx) => c("cylinder", [0.21, 0.22, 0.21], [sx, 1.1, 0], "primary", { open: true }))]);
    case "cloak": return at("body", [c("cylinder", [1.1, 1.0, 1.1], [0, 0.85, -0.04], "primary", { open: true, arc: 0.8 }), c("torus", [0.6, 0.12, 0.6], [0, 1.36, 0], "accent", { axis: "y" })]);
    case "skirt": return at("body", [c("cylinder", [0.76, 0.45, 0.76], [0, 0.62, 0], "primary", { open: true })]);
    case "hat": return at("head", [c("cone", [0.54, 0.4, 0.54], [0, 2.08, 0], "primary"), c("cylinder", [0.8, 0.04, 0.8], [0, 1.9, 0], "primary")]);
    case "band": return at("head", [c("torus", [0.6, 0.07, 0.6], [0, 1.82, 0], "primary", { axis: "y" })]);
    case "scarf": return at("neck", [c("torus", [0.4, 0.14, 0.4], [0, 1.38, 0], "primary", { axis: "y" }), c("box", [0.1, 0.4, 0.04], [0.14, 1.15, 0.2], "primary")]);
    case "sandals": return at("feet", [-0.13, 0.13].map((sx) => c("box", [0.18, 0.04, 0.34], [sx, 0.03, 0.05], "primary")) as Component[]);
    default: return null;
  }
}

/** The transform a client applies to an oriented primitive: rotation (radians) and the scale of its unit geometry. */
export function orient(k: Component): { rot: V3; scale: V3 } {
  const [sx, sy, sz] = k.size, axis = k.axis ?? "y";
  if (k.shape === "box" || k.shape === "sphere") return { rot: [0, 0, 0], scale: [sx, sy, sz] };
  if (k.shape === "torus") {
    // the unit torus rings around z with a fixed tube; `size` along the ring's axis is its thickness
    const T = 4;                                                       // the unit torus is a quarter as thick as it is wide
    return axis === "z" ? { rot: [0, 0, 0], scale: [sx, sy, sz * T] } : axis === "y" ? { rot: [Math.PI / 2, 0, 0], scale: [sx, sz, sy * T] } : { rot: [0, Math.PI / 2, 0], scale: [sz, sy, sx * T] };
  }
  // cylinders and cones: the unit geometry stands along y with tip up
  return axis === "y" ? { rot: [0, 0, 0], scale: [sx, sy, sz] } : axis === "x" ? { rot: [0, 0, -Math.PI / 2], scale: [sy, sx, sz] } : { rot: [Math.PI / 2, 0, 0], scale: [sx, sz, sy] };
}
