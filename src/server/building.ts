// Building. River decides what to make, where, out of what, and in what colours; the world only checks that it makes sense
// (level ground, nothing in the way, within reach, enough material, a real span for a bridge). When it doesn't, River is told why, and
// where a good spot actually is. Nothing is pre-chosen: not the place, not the palette, not the look.
import { bus, log } from "./bus.ts";
import { ToolError, num, obj, str, type ToolDef } from "./toolkit.ts";
import { heightAt, isLand } from "../shared/noise.ts";
import { describeColour, hexToRgb, palette, rgbToHex } from "./colour.ts";
import { findPlace } from "./places.ts";
import { addWork } from "./taste.ts";
import type { Entity } from "../shared/types.ts";
import type { World } from "./world.ts";
import { registerActivity, runActivity, type Def as ActivityDef } from "./activities.ts";
import { simNow, STEP_MS } from "./sim.ts";
import { defForKind } from "../content/items.ts";

type Shape = "hut" | "lean-to" | "wall" | "fence" | "bench" | "cairn" | "tower" | "platform" | "bridge";
const SIZE = { small: 1, medium: 1.6, large: 2.4 } as const;
interface Spec { line: boolean; radius: number; need: (s: number, len: number) => number; allow: string[]; shelter?: boolean; walk?: boolean; roof?: boolean; parts: string[]; word: string }
const ANY = ["stick", "plank", "stone", "clay", "chalk"];
const SHAPES: Record<Shape, Spec> = {
  hut:        { line: false, radius: 1.6, need: (s) => Math.round(8 * s), allow: ANY, shelter: true, roof: true, parts: ["walls", "roof", "trim"], word: "hut" },
  "lean-to":  { line: false, radius: 1.4, need: (s) => Math.round(5 * s), allow: ["stick", "plank", "stone", "clay"], shelter: true, roof: true, parts: ["walls", "roof", "trim"], word: "lean-to" },
  bench:      { line: false, radius: 0.8, need: (s) => Math.round(3 * s), allow: ANY, parts: ["walls", "trim"], word: "bench" },
  cairn:      { line: false, radius: 0.7, need: (s) => Math.round(5 * s), allow: ["stone", "chalk"], parts: ["walls"], word: "cairn" },
  tower:      { line: false, radius: 1.1, need: (s) => Math.round(10 * s), allow: ["stone", "clay", "chalk", "stick", "plank"], parts: ["walls", "trim"], word: "tower" },
  platform:   { line: false, radius: 1.8, need: (s) => Math.round(6 * s), allow: ["stick", "plank", "stone"], walk: true, parts: ["deck", "trim"], word: "platform" },
  wall:       { line: true, radius: 0.5, need: (_, l) => Math.ceil(l * 1.2), allow: ["stone", "clay", "chalk", "stick", "plank"], parts: ["walls", "trim"], word: "wall" },
  fence:      { line: true, radius: 0.4, need: (_, l) => Math.ceil(l * 0.8), allow: ["stick", "plank"], parts: ["walls", "trim"], word: "fence" },
  bridge:     { line: true, radius: 0.9, need: (_, l) => Math.ceil(l * 2.2), allow: ["stick", "plank", "stone"], walk: true, parts: ["deck", "trim"], word: "bridge" },
};
/** natural colour of each material, and how much structure one of it is worth */
const MATERIAL: Record<string, { hex: string; units: number; word: string }> = {
  stick: { hex: "#8a6a45", units: 1, word: "wood" }, plank: { hex: "#a88a60", units: 2, word: "driftwood" }, stone: { hex: "#8d9199", units: 1, word: "stone" },
  clay: { hex: "#b5714a", units: 1, word: "clay" }, chalk: { hex: "#e6e2d6", units: 1, word: "chalk" },
};
const MOSS = "#5a8a46";
const DIR: Record<string, number> = { east: 0, "south-east": Math.PI / 4, south: Math.PI / 2, "south-west": (3 * Math.PI) / 4, west: Math.PI, "north-west": -(3 * Math.PI) / 4, north: -Math.PI / 2, "north-east": -Math.PI / 4 };
const dirAngle = (s?: string) => (s ? DIR[String(s).toLowerCase().replace(/\s+/g, "-").replace(/^(north|south)(east|west)$/, "$1-$2")] : undefined);
type XZ = { x: number; z: number };
const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
const compassOf = (from: XZ, to: XZ) => { const a = Math.atan2(to.z - from.z, to.x - from.x), n = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"]; return n[(Math.round(a / (Math.PI / 4)) + 8) % 8]; };

function target(w: World, ref: string): XZ | undefined {
  const e = w.entities.get(ref) ?? w.nearby(90).map((o) => o.e).find((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
  return e ?? findPlace(ref);
}
/** "here", or beside something, or a distance in a direction, or coordinates. */
function resolve(w: World, spec: any, origin: XZ, fallback?: () => XZ): XZ {
  if (!spec || typeof spec !== "object") { if (fallback) return fallback(); throw new ToolError("Say where."); }
  if (typeof spec.x === "number" && typeof spec.z === "number") return { x: spec.x, z: spec.z };
  const d = Number.isFinite(Number(spec.distance)) ? Math.max(0.5, Math.min(40, Number(spec.distance))) : 3, ang = dirAngle(spec.direction);
  if (spec.near) {
    const t = target(w, String(spec.near)); if (!t) throw new ToolError(`You don't know of anything called "${spec.near}" to build beside.`);
    const a = ang ?? Math.atan2(t.z - w.me.z, t.x - w.me.x);       // with no side given: on the far side of it from where you stand
    return { x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d };
  }
  if (ang !== undefined) return { x: origin.x + Math.cos(ang) * d, z: origin.z + Math.sin(ang) * d };
  if (fallback) return fallback(); throw new ToolError("Say where: coordinates, something to build beside, or a direction and distance.");
}

const BLOCKERS = new Set(["tree", "rock", "bush", "structure", "library", "shrine", "monolith", "campfire", "char"]);
function samples(shape: Spec, a: XZ, b?: XZ): XZ[] {
  if (shape.line && b) { const n = Math.max(2, Math.ceil(dist(a, b))); return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })); }
  return [a, ...Array.from({ length: 6 }, (_, i) => ({ x: a.x + Math.cos((i * Math.PI) / 3) * shape.radius, z: a.z + Math.sin((i * Math.PI) / 3) * shape.radius }))];
}
/** Does this make sense as a place? Returns what is wrong, in plain words, or null. */
function siteProblem(w: World, shapeName: Shape, a: XZ, b: XZ | undefined, spec: Spec): string | null {
  const pts = samples(spec, a, b), bridge = shapeName === "bridge";
  if (!bridge) {
    const wet = pts.find((p) => !w.isLandAt(p.x, p.z)); if (wet) return `Part of that is water or open sea, near (${wet.x.toFixed(0)}, ${wet.z.toFixed(0)}).`;
  } else {
    const wet = pts.filter((p) => !isLand(p.x, p.z, w.seed)).length / pts.length;
    if (!isLand(pts[0].x, pts[0].z, w.seed) || !isLand(pts[pts.length - 1].x, pts[pts.length - 1].z, w.seed)) return "A bridge has to start and end on firm ground; one end is in the water.";
    if (wet < 0.3) return "There's hardly any water between those two points. A bridge is for crossing water; a wall or a path would suit that ground.";
  }
  const hs = pts.map((p) => heightAt(p.x, p.z, w.seed)).filter((_, i) => bridge ? i === 0 || i === pts.length - 1 : true), rise = Math.max(...hs) - Math.min(...hs);
  if (bridge ? rise > 1.8 : rise > 0.9 + spec.radius * 0.35 + (spec.line ? 0.5 : 0)) return `The ground is too ${bridge ? "uneven between the two banks" : "steep there"}: it changes by ${rise.toFixed(1)}m across the spot.`;
  for (const { e, d } of w.nearby(60)) {
    if (!BLOCKERS.has(e.kind) || (e.props.walk && e.kind === "structure")) continue;
    const clear = e.kind === "tree" ? 0.7 : e.kind === "structure" ? (e.props.radius ?? 1) + 0.4 : 0.6;
    if (pts.some((p) => dist(p, e) < spec.radius + clear)) return `${/^[aeiou]/i.test(e.name) ? "An" : "A"} ${e.name} (${e.id}) is in the way, ${d.toFixed(0)}m from you at (${e.x.toFixed(0)}, ${e.z.toFixed(0)}).`;
  }
  return null;
}
/** Somewhere nearby that does work, so a refusal can point at a real alternative. */
function suggest(w: World, shapeName: Shape, centre: XZ, spec: Spec): string {
  if (spec.line) return "";
  for (let r = 2; r <= 12; r += 1.5) for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6, p = { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r };
    if (!siteProblem(w, shapeName, p, undefined, spec) && dist(p, w.me) < 14) return ` A level, clear spot lies ${r.toFixed(0)}m to the ${compassOf(centre, p)} of there, at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}).`;
  }
  return " Nothing close by is both level and clear; try further away.";
}

const hexOf = (it?: { props?: Record<string, any> }) => it?.props?.hex as string | undefined;
const nameOfHex = (hex: string) => palette().find((p) => p.hex.toLowerCase() === hex.toLowerCase())?.name ?? describeColour(hex);
const darker = (hex: string, f = 0.65) => { const c = hexToRgb(hex); return rgbToHex(c[0] * f, c[1] * f, c[2] * f); };

export const BUILD_TOOL: ToolDef = {
  name: "build",
  description:
    "Make something in the world with your hands. `raise`: build it (hut, lean-to, bench, cairn, tower, platform, wall, fence, or bridge). `plan`: ask what a build would take. `paint`: change the colours of something you built. `take_down`: dismantle something you built and get most of the materials back (more from something unfinished, less from something finished, and from something burnt only what the fire left). Building happens in three stages and the materials are used up stage by stage: if you are stopped, what you have built stands unfinished, holding what you put in, and `continue` (with its id as `target`) finishes it when you hold the rest. Wooden structures weather in rain and storms; `repair` them with sticks or planks before they fall. " +
    "YOU choose the shape, the size (small, medium or large), the materials, the colours and the spot. Where: `where` can be coordinates, something to build beside (with a direction and a distance), or a direction and distance from you; leave it out to build just in front of you. Walls, fences and bridges need both ends (`where` and `to`). " +
    "You must be within about ten paces of where you build. Ground must be level and clear; bridges must cross water, from firm ground to firm ground, and people can walk across them. A closed hut or a lean-to keeps off some of the weather. " +
    "Materials are things you carry: sticks, stones, clay, chalk and driftwood planks give structure (a plank is worth two); moss makes a roof. Say how many of each in `materials`. Without colours, a thing shows the colour of what it is made of; with pigment, you choose.",
  input_schema: obj({
    action: { type: "string", enum: ["raise", "plan", "paint", "take_down", "continue", "repair"], description: "raise (default), plan, paint, take_down, continue an unfinished build, or repair a weathered one" },
    shape: { type: "string", enum: Object.keys(SHAPES), description: "What to build" },
    name: str("Your name for this particular thing"), description: str("What it is for, or how it feels. Optional."),
    size: { type: "string", enum: ["small", "medium", "large"], description: "Default small" },
    materials: { type: "object", description: "How many of each item to use, e.g. {\"stick\": 6, \"stone\": 2}. Names as in your inventory.", additionalProperties: { type: "number" } },
    where: { type: "object", description: "Where. {x, z} or {near, direction, distance} or {direction, distance}. Omit for just in front of you." },
    to: { type: "object", description: "For wall, fence and bridge: where it ends. Same forms as `where`; direction and distance are measured from the first end." },
    colors: { type: "object", description: "Pigments to use, by their names in your inventory, for parts: walls, roof, trim, deck. e.g. {\"walls\": \"dusk\"}. One portion each.", additionalProperties: { type: "string" } },
    target: str("paint / take_down: the thing you built (its id or name)"),
  }, []),
  run: async (a, w: World) => {
    const act = String(a.action ?? "raise");
    if (act === "paint") return paintIt(a, w);
    if (act === "take_down") return takeDown(a, w);
    if (act === "continue") return continueBuild(a, w);
    if (act === "repair") return repairIt(a, w);
    const shapeName = String(a.shape ?? "") as Shape, spec = SHAPES[shapeName];
    if (!spec) throw new ToolError(`Choose a shape: ${Object.keys(SHAPES).join(", ")}.`);
    const size = (a.size && a.size in SIZE ? a.size : "small") as keyof typeof SIZE, s = SIZE[size];
    const A = resolve(w, a.where, w.me, () => ({ x: w.me.x + Math.cos(w.me.heading) * 2.6, z: w.me.z + Math.sin(w.me.heading) * 2.6 }));
    let B: XZ | undefined;
    if (spec.line) { if (!a.to) throw new ToolError(`A ${spec.word} has two ends. Say where it ends with \`to\`.`); B = resolve(w, a.to, A); }
    const length = B ? dist(A, B) : 0, need = spec.need(s, length);
    if (spec.line && (length < 2 || length > (shapeName === "bridge" ? 14 : 30))) throw new ToolError(`A ${spec.word} that long (${length.toFixed(1)}m) isn't possible: make it between 2m and ${shapeName === "bridge" ? 14 : 30}m.`);

    // what is held, and what it is worth
    const held = [...w.inventory.values()].filter((i) => MATERIAL[i.kind]);
    const holding = held.length ? held.map((i) => `${i.name}×${i.qty}`).join(", ") : "no building materials";
    const rule = `A ${size} ${spec.word}${spec.line ? ` ${length.toFixed(0)}m long` : ""} needs about ${need} units of ${spec.allow.map((k) => MATERIAL[k].word).join(", ")} (each counts 1; a driftwood plank counts 2).`;
    if (act === "plan") return `${rule} You are carrying ${holding}. ${spec.roof ? "Moss makes a roof. " : ""}You'd be building ${spec.line ? `from (${A.x.toFixed(0)}, ${A.z.toFixed(0)}) to (${B!.x.toFixed(0)}, ${B!.z.toFixed(0)})` : `at (${A.x.toFixed(0)}, ${A.z.toFixed(0)})`}. ${siteProblem(w, shapeName, A, B, spec) ?? "That spot would do."}`;

    const near = spec.line ? Math.min(...samples(spec, A, B).map((p) => dist(p, w.me))) : dist(A, w.me);
    if (near > 10) throw new ToolError(`That spot is ${near.toFixed(0)}m away. You build with your own hands, so walk over there first.`);
    const problem = siteProblem(w, shapeName, A, B, spec);
    if (problem) throw new ToolError(`You can't build there. ${problem}${suggest(w, shapeName, A, spec)}`);

    // materials
    const want: Record<string, number> = Array.isArray(a.materials) ? Object.fromEntries(a.materials.map((m: string) => [m, 1])) : (a.materials ?? {});
    if (!Object.keys(want).length) throw new ToolError(`${rule} You are carrying ${holding}. Say what to use in \`materials\`.`);
    const used: { it: NonNullable<ReturnType<World["findItem"]>>; n: number }[] = [];
    let units = 0; let moss = 0;
    for (const [ref, nRaw] of Object.entries(want)) {
      const n = Math.floor(Number(nRaw)); const it = w.findItem(ref);
      if (!it || !(n >= 1)) throw new ToolError(`You aren't carrying "${ref}"${n >= 1 ? "" : " (or the count isn't a whole number)"}. You have ${holding}.`);
      if (it.qty < n) throw new ToolError(`You only have ${it.qty} of ${it.name}, not ${n}.`);
      if (it.kind === "moss") { if (!spec.roof) throw new ToolError(`A ${spec.word} has no roof for moss to cover.`); moss += n; used.push({ it, n }); continue; }
      if (!MATERIAL[it.kind]) throw new ToolError(`${it.name} can't hold a structure up. Sticks, stones, clay, chalk and driftwood planks can.`);
      if (!spec.allow.includes(it.kind)) throw new ToolError(`${MATERIAL[it.kind].word[0].toUpperCase()}${MATERIAL[it.kind].word.slice(1)} won't do for a ${spec.word}. It needs ${spec.allow.map((k) => MATERIAL[k].word).join(", ")}.`);
      units += n * MATERIAL[it.kind].units; used.push({ it, n });
    }
    if (units < need) throw new ToolError(`${rule} You offered ${units}. You are carrying ${holding}. You need ${need - units} more.`);
    if (units > Math.ceil(need * 1.5)) throw new ToolError(`${units} units is more than a ${size} ${spec.word} can use (about ${need}). Use fewer, or build bigger.`);

    // colours: natural unless River chooses pigment
    const byKind = new Map<string, number>(); used.forEach(({ it, n }) => byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + n * (MATERIAL[it.kind]?.units ?? 0)));
    const ranked = [...byKind.entries()].filter(([k]) => MATERIAL[k]).sort((x, y) => y[1] - x[1]), main = ranked[0][0], second = ranked[1]?.[0];
    const col: Record<string, string> = {}, colName: Record<string, string> = {}, spend: { it: NonNullable<ReturnType<World["findItem"]>> }[] = [];
    col.walls = MATERIAL[main].hex; col.deck = MATERIAL[main].hex; col.trim = second ? MATERIAL[second].hex : darker(MATERIAL[main].hex, 0.75); col.roof = moss >= 2 ? MOSS : darker(MATERIAL[second ?? main].hex, 0.7);
    for (const [part0, ref] of Object.entries(a.colors ?? {}) as [string, string][]) {
      const part = part0 === "body" || part0 === "seat" ? "walls" : part0;
      if (!spec.parts.includes(part)) throw new ToolError(`A ${spec.word} has no ${part0} to colour. It has: ${spec.parts.join(", ")}.`);
      const p = w.findItem(String(ref)); if (!p || p.kind !== "pigment") throw new ToolError(`You aren't holding a pigment called "${ref}".`);
      col[part] = hexOf(p)!; colName[part] = p.name; spend.push({ it: p });
    }
    const perPigment = new Map<string, number>(); spend.forEach(({ it }) => perPigment.set(it.id, (perPigment.get(it.id) ?? 0) + 1));
    for (const [id, n] of perPigment) if ((w.inventory.get(id)?.qty ?? 0) < n) throw new ToolError(`You don't have enough of that pigment: ${n} portions are needed for those parts.`);

    // Everything is valid. The build becomes a plan: what to put where, in how many stages, and what each stage spends.
    const mid = spec.line ? { x: (A.x + B!.x) / 2, z: (A.z + B!.z) / 2 } : A;
    const materials: Record<string, number> = {}, kinds: Record<string, string> = {}; used.forEach(({ it, n }) => { materials[it.name] = (materials[it.name] ?? 0) + n; kinds[it.name] = it.kind; });
    const wood = (byKind.get("stick") ?? 0) + (byKind.get("plank") ?? 0), total = [...byKind.values()].reduce((x, y) => x + y, 0) || 1;
    const deckY = shapeName === "bridge" ? Math.max(0.5, Math.max(heightAt(A.x, A.z, w.seed), heightAt(B!.x, B!.z, w.seed)) + 0.12) : undefined;
    const heading = dirAngle(a.facing) ?? Math.atan2(w.me.z - mid.z, w.me.x - mid.x);                          // doors face the builder unless told
    const palWords = (["walls", "roof", "trim", "deck"] as const).filter((p) => spec.parts.includes(p)).map((p) => `${p} ${colName[p] ?? describeColour(col[p])}`);
    const look = `a ${size} ${spec.word} of ${[...byKind.keys()].filter((k) => MATERIAL[k]).map((k) => MATERIAL[k].word).join(" and ")}${moss >= 2 ? " with a moss roof" : ""}; ${palWords.join(", ")}`;
    const name = String(a.name ?? "").trim().slice(0, 60) || `${size} ${spec.word}`;
    const tags = [shapeName, size, ...Object.keys(kinds), ...Object.keys(materials), ...Object.values(colName), ...Object.values(col).map(describeColour), ...(a.description ? String(a.description).split(/\s+/) : [])];
    // each unit of each material is spent in the stage that uses it; pigments go on in the last
    const stages: Spend[][] = Array.from({ length: STAGES }, () => []);
    for (const { it, n } of used) for (let k = 0; k < STAGES; k++) { const q = Math.floor(((k + 1) * n) / STAGES) - Math.floor((k * n) / STAGES); if (q > 0) stages[k]!.push({ id: it.id, kind: it.kind, name: it.name, n: q }); }
    for (const [id, n] of perPigment) { const p = w.inventory.get(id)!; stages[STAGES - 1]!.push({ id, kind: p.kind, name: p.name, n }); }
    const plan: BuildPlan = {
      shape: shapeName, size, name, look, desc: a.description ? String(a.description).slice(0, 240) : "", mid, A, B, heading, tags, stages, stageMs: Math.max(1000, Math.round(Math.min(45_000, 3000 + need * 1500) / STAGES)),
      props: { shape: shapeName, size, colors: col, colorNames: colName, builtBy: w.me.name, radius: spec.line ? spec.radius : spec.radius * (shapeName === "bridge" ? 1 : 1.15), heading, shelter: !!spec.shelter, walk: !!spec.walk,
        flammable: wood / total >= 0.5, ...(spec.line ? { path: { x1: A.x, z1: A.z, x2: B!.x, z2: B!.z, width: shapeName === "bridge" ? 1.8 : 0.5 } } : {}), ...(deckY !== undefined ? { deckY } : {}) },
    };
    return runBuild(w, plan, 0, null);
  },
};

// ---------- building in stages ----------
// A structure is raised in stages. Each stage takes time, and spends its share of the materials when it is done, so nothing is spent
// for work that was not finished. Stop part way and what stands is an unfinished structure holding exactly what has been put in;
// it can be finished later (`continue`) or taken apart for most of it back.
const STAGES = 3;
interface Spend { id: string; kind: string; name: string; n: number }
interface BuildPlan { shape: Shape; size: string; name: string; look: string; desc: string; mid: XZ; A: XZ; B?: XZ; heading: number; tags: string[]; stages: Spend[][]; stageMs: number; props: Record<string, any> }

/** Start (or resume) the work and wait for it to end. */
async function runBuild(w: World, plan: BuildPlan, fromStage: number, entityId: string | null): Promise<string> {
  const r = await runActivity(w, "construct", { plan, fromStage, entityId }, `build ${plan.name}`);
  if (r.ok) return r.text;
  throw new ToolError(r.text);
}
/** What of a spend River actually holds (by id first, then by the same kind of thing). */
function holding(w: World, s: Spend): number {
  return w.items.carried().filter((i) => i.id === s.id || (i.kind === s.kind && i.name === s.name)).reduce((a, i) => a + i.qty, 0);
}
function spendNow(w: World, s: Spend) {
  let need = s.n;
  const stacks = w.items.carried().filter((i) => i.id === s.id || (i.kind === s.kind && i.name === s.name)).sort((a, b) => Number(b.id === s.id) - Number(a.id === s.id));
  for (const st of stacks) { if (need <= 0) break; const q = Math.min(need, st.qty); w.takeItem(st.id, q); need -= q; }
}

/** One stage is done: pay for it, and let the structure show it. Returns the finished text when this was the last. */
function completeStage(w: World, plan: BuildPlan, stage: number, entityId: string | null): { entityId: string; done?: string } {
  const spends = plan.stages[stage]!;
  const short = spends.find((s) => holding(w, s) < s.n);
  if (short) throw new ToolError(`You no longer have enough ${short.name} to finish this stage: it needs ${short.n} and you hold ${holding(w, short)}.`);
  const e0 = entityId ? w.entities.get(entityId) : undefined;
  const mats: Record<string, number> = { ...(e0?.props.materials ?? {}) }, kinds: Record<string, string> = { ...(e0?.props.materialKinds ?? {}) };
  for (const s of spends) { spendNow(w, s); if (s.kind !== "pigment") { mats[s.name] = (mats[s.name] ?? 0) + s.n; kinds[s.name] = s.kind; } }
  const progress = (stage + 1) / STAGES, last = stage === STAGES - 1;
  const base = { ...plan.props, materials: mats, materialKinds: kinds };
  const props = last
    ? { ...base, look: plan.look, desc: `${plan.look}.${plan.desc ? ` ${plan.desc}` : ""} Built by ${w.me.name}.` }
    : { ...base, unfinished: true, progress, stages: STAGES, look: `an unfinished ${SHAPES[plan.shape].word}`, desc: `An unfinished ${SHAPES[plan.shape].word}: ${stage + 1} of ${STAGES} stages done. It could be finished or taken apart.`, plan, shelter: false, walk: false };
  let e: Entity;
  if (e0) { e0.props = props; w.putEntity(e0); e = e0; } else e = w.spawn("structure", plan.name, plan.mid.x, plan.mid.z, props);
  if (!last) return { entityId: e.id };
  addWork({ name: plan.name, shape: plan.shape, size: plan.size, materials: mats, colors: plan.props.colors, colorNames: plan.props.colorNames, x: plan.mid.x, z: plan.mid.z }, e.id);
  w.bump({ mood: 8, curiosity: -6 });
  bus.emit("made", { name: plan.name, tags: plan.tags, kind: "build" });
  log("world", `River built ${plan.name} (${plan.look}).`, { perceived: true });
  const spec = SHAPES[plan.shape];
  return { entityId: e.id, done: `You build "${plan.name}": ${plan.look}. It stands ${spec.line ? `from (${plan.A.x.toFixed(0)}, ${plan.A.z.toFixed(0)}) to (${plan.B!.x.toFixed(0)}, ${plan.B!.z.toFixed(0)})` : `at (${plan.A.x.toFixed(0)}, ${plan.A.z.toFixed(0)}), ${dist(plan.A, w.me).toFixed(0)}m ${compassOf(w.me, plan.A)} of you`}.` };
}

const construct: ActivityDef = {
  id: "construct", version: "1", interruptedBy: ["fire", "injury", "predator", "collapse"],
  validate: (p) => (p.plan && Array.isArray(p.plan.stages) ? null : "there is nothing planned to build"),
  init: (p) => ({ progress: { stage: p.fromStage ?? 0, entityId: p.entityId ?? null, endsAt: simNow() + p.plan.stageMs }, maxTicks: Math.ceil((p.plan.stageMs * STAGES) / STEP_MS) + 300 }),
  step: (a, c) => {
    const p = a.progress, plan = a.params.plan as BuildPlan;
    if (simNow() < p.endsAt) return "continue";
    try {
      const r = completeStage(c.w, plan, p.stage, p.entityId);
      p.entityId = r.entityId; p.stage++;
      if (r.done) return { ok: true, text: r.done };
      p.endsAt = simNow() + plan.stageMs; return "continue";
    } catch (e: any) { return { ok: false, text: `${e.message} What you have built so far stands unfinished.`, data: { unfinished: p.entityId } }; }
  },
  label: (a) => `building ${a.params.plan.name} (stage ${Math.min(a.progress.stage + 1, STAGES)} of ${STAGES})`,
  pct: (a) => Math.min(1, (a.progress.stage + Math.max(0, 1 - (a.progress.endsAt - simNow()) / a.params.plan.stageMs)) / STAGES),
};
registerActivity(construct);

/** Pick up an unfinished structure's work where it was left. */
async function continueBuild(a: any, w: World): Promise<string> {
  const e = mine(w, String(a.target ?? ""));
  if (!e.props.unfinished || !e.props.plan) throw new ToolError(`${e.name} is already finished.`);
  const plan = e.props.plan as BuildPlan, stage = Math.round(e.props.progress * STAGES);
  const need = new Map<string, number>(); for (const sp of plan.stages.slice(stage).flat()) need.set(`${sp.kind}|${sp.name}`, (need.get(`${sp.kind}|${sp.name}`) ?? 0) + sp.n);
  const lacking = [...need].map(([k, n]) => { const [kind, name] = k.split("|") as [string, string]; const h = holding(w, { id: "", kind, name, n }); return h < n ? `${n - h} more ${name}` : ""; }).filter(Boolean);
  if (lacking.length) throw new ToolError(`To finish ${e.name} you still need ${lacking.join(", ")}.`);
  return runBuild(w, plan, stage, e.id);
}

function mine(w: World, ref: string, remnants = false): Entity {
  const r = ref.toLowerCase(), isMine = (x: Entity) => (x.kind === "structure" && !!x.props.shape) || (remnants && x.kind === "char" && !!x.props.wasMaterials);
  const e = w.entities.get(ref) ?? w.nearby(12).map((o) => o.e).find((x) => isMine(x) && x.name.toLowerCase().includes(r));
  if (!e || !isMine(e)) throw new ToolError("There's nothing you built by that name within reach.");
  if (dist(e, w.me) > (e.props.path ? 14 : 8)) throw new ToolError(`${e.name} is too far away to work on. Walk closer.`);
  return e;
}
function paintIt(a: any, w: World): string {
  const e = mine(w, String(a.target ?? "")), spec = SHAPES[e.props.shape as Shape], colors = a.colors ?? {};
  if (!Object.keys(colors).length) throw new ToolError("Say which parts to colour and with what, e.g. {\"walls\": \"dusk\"}.");
  const spend = new Map<string, number>(), changes: [string, string, string][] = [];
  for (const [part0, ref] of Object.entries(colors) as [string, string][]) {
    const part = part0 === "body" || part0 === "seat" ? "walls" : part0;
    if (!spec.parts.includes(part)) throw new ToolError(`${e.name} has no ${part0}. It has: ${spec.parts.join(", ")}.`);
    const p = w.findItem(String(ref)); if (!p || p.kind !== "pigment") throw new ToolError(`You aren't holding a pigment called "${ref}".`);
    spend.set(p.id, (spend.get(p.id) ?? 0) + 1); changes.push([part, hexOf(p)!, p.name]);
  }
  for (const [id, n] of spend) if ((w.inventory.get(id)?.qty ?? 0) < n) throw new ToolError("You don't have enough of that pigment for all of those parts.");
  for (const [id, n] of spend) w.takeItem(id, n);
  for (const [part, hex, nm] of changes) { e.props.colors[part] = hex; e.props.colorNames = { ...(e.props.colorNames ?? {}), [part]: nm }; }
  e.props.look = String(e.props.look).replace(/;.*$/, "") + `; ${spec.parts.map((p) => `${p} ${e.props.colorNames?.[p] ?? describeColour(e.props.colors[p])}`).join(", ")}`;
  e.props.desc = `${e.props.look}. Built by ${w.me.name}.`; w.putEntity(e); w.bump({ mood: 4, curiosity: -3 });
  bus.emit("made", { name: e.name, tags: [e.props.shape, ...changes.map((c) => c[2]), ...changes.map((c) => describeColour(c[1]))], kind: "paint" });
  return `You colour ${e.name}: ${changes.map(([p, , n]) => `${p} ${n}`).join(", ")}. Now it is ${e.props.look}.`;
}
// ---------- wear ----------
/** Per second, in rain and storms, how fast a structure's materials give way. Stone and chalk do not; clay a little; wood the most. */
const WEATHERING: Record<string, number> = { clear: 0, cloudy: 0, windy: 0, fog: 0.00004, rain: 0.00012, storm: 0.0003 };
const SOFTNESS: Record<string, number> = { stick: 1, plank: 1, clay: 0.3 };
export const integrityOf = (e: Entity) => Math.max(0, Math.min(1, e.props.integrity ?? 1));
/** Called every few seconds of world time. Wet weather wears wooden structures; one worn through falls down into part of what it was. */
export function weatherStructures(w: World, dtSec: number) {
  const rate = WEATHERING[w.weather] ?? 0; if (rate <= 0) return;
  for (const e of [...w.entities.values()]) {
    if (e.kind !== "structure" || !e.props.shape) continue;
    const kinds = Object.values((e.props.materialKinds ?? {}) as Record<string, string>), mats = e.props.materials as Record<string, number> | undefined;
    const units = Object.entries(mats ?? {}).reduce((s, [name, n]) => s + n * (SOFTNESS[(e.props.materialKinds ?? {})[name]] ?? 0), 0), total = Object.values(mats ?? {}).reduce((s, n) => s + n, 0) || 1;
    if (!kinds.length || units <= 0) continue;
    const next = +(integrityOf(e) - rate * dtSec * (units / total)).toFixed(4);
    if (next <= 0) { collapse(w, e); continue; }
    if (next !== integrityOf(e)) { e.props.integrity = next; w.putEntity(e); }              // written whenever it changes, or small steps would never add up
  }
}
/** A structure worn through. A part of what it was made of lies where it stood: never more than 40%, and never the pigment. */
function collapse(w: World, e: Entity) {
  const mats = (e.props.materials ?? {}) as Record<string, number>, kinds = (e.props.materialKinds ?? {}) as Record<string, string>;
  w.removeEntity(e.id);
  let k = 0;
  for (const [name, n] of Object.entries(mats)) {
    const q = Math.floor(n * 0.4), kind = kinds[name]; if (q < 1 || !kind) continue;
    const a = (k++ / Math.max(1, Object.keys(mats).length)) * Math.PI * 2;
    w.items.spawnLoose({ kind, name, desc: `${name}, from ${e.name}.`, qty: q, x: e.x + Math.cos(a) * 1.2, z: e.z + Math.sin(a) * 1.2, note: `fell from ${e.name}` });
  }
  log("world", `${e.name} has fallen down, worn through by the weather.`, { perceived: Math.hypot(e.x - w.me.x, e.z - w.me.z) < 40 });
  bus.emit("loss", { name: e.name, kind: "structure", x: e.x, z: e.z, named: true });
}
/** Mend a weathered structure with sticks or planks: each unit worth 0.12 of its soundness. */
function repairIt(a: any, w: World): string {
  const e = mine(w, String(a.target ?? "")), have = integrityOf(e);
  if (have >= 0.98) throw new ToolError(`${e.name} is sound; there is nothing to mend.`);
  const want: Record<string, number> = Array.isArray(a.materials) ? Object.fromEntries(a.materials.map((m: string) => [m, 1])) : (a.materials ?? {});
  if (!Object.keys(want).length) throw new ToolError(`Say what to mend it with in \`materials\`: sticks or driftwood planks.`);
  let gain = 0; const used: { id: string; n: number; name: string }[] = [];
  for (const [ref, nRaw] of Object.entries(want)) {
    const n = Math.floor(Number(nRaw)), it = w.findItem(ref);
    if (!it || !(n >= 1)) throw new ToolError(`You aren't carrying "${ref}".`);
    if (it.qty < n) throw new ToolError(`You only have ${it.qty} of ${it.name}.`);
    if (it.kind !== "stick" && it.kind !== "plank") throw new ToolError(`${it.name} won't mend a weathered ${e.props.shape}. Sticks and planks will.`);
    gain += 0.12 * n * (MATERIAL[it.kind]?.units ?? 1); used.push({ id: it.id, n, name: it.name });
  }
  const wasted = have + gain > 1.12 ? "That is more than it needed. " : "";
  for (const u of used) w.takeItem(u.id, u.n);
  e.props.integrity = Math.min(1, +(have + gain).toFixed(4)); w.putEntity(e); w.bump({ energy: -2, mood: 2 });
  return `${wasted}You work ${used.map((u) => `${u.n} ${u.name}`).join(" and ")} into ${e.name}. It is ${e.props.integrity >= 0.95 ? "sound again" : `firmer now (${Math.round(e.props.integrity * 100)}%)`}.`;
}

/**
 * Taking something apart returns part of what is actually there: 85% of the work in an unfinished structure (it was never fixed
 * together), 60% of a finished one, and from one that burnt, the stone and clay that survived at 60% plus a little ash for the wood.
 * Never more than was put in, and never what the fire destroyed.
 */
function takeDown(a: any, w: World): string {
  const e = mine(w, String(a.target ?? ""), true); w.setActivity("taking something down");
  const burnt = e.kind === "char", unfinished = !!e.props.unfinished;
  const mats = (burnt ? e.props.wasMaterials : e.props.materials ?? {}) as Record<string, number>, kinds = (burnt ? e.props.wasKinds : e.props.materialKinds ?? {}) as Record<string, string>;
  const share = (unfinished ? 0.85 : 0.6) * Math.max(0, Math.min(1, e.props.integrity ?? 1)), back: string[] = [];          // a weathered structure has less left in it
  let lostFuelKg = 0;
  for (const [name, n] of Object.entries(mats)) {
    const kind = kinds[name]; if (!kind || !(n >= 1)) continue;
    if (burnt && ["stick", "plank"].includes(kind)) { lostFuelKg += n * defForKind(kind).massKg; continue; }          // the wood is gone; only ash is left
    const k = Math.floor(n * share); if (k >= 1) { w.addItem(kind, name, `${name}, reclaimed.`, k, undefined, { note: `taken from ${e.name}` }); back.push(`${k} ${name}`); }
  }
  if (burnt && lostFuelKg > 0) {
    const ash = defForKind("charcoal"), pieces = Math.floor((lostFuelKg * 0.2) / ash.massKg);
    if (pieces >= 1) { w.addItem("charcoal", ash.name, "What a fire leaves of wood.", pieces, undefined, { note: `ash of ${e.name}` }); back.push(`${pieces} ${ash.name}`); }
  }
  w.removeEntity(e.id); w.bump({ energy: -3 }); bus.emit("made", { name: e.name, tags: [], kind: "take_down" });
  const what = burnt ? `the burnt remains of ${e.props.was}` : unfinished ? `${e.name}, unfinished,` : e.name;
  return `You take ${what} apart. ${back.length ? `You keep ${back.join(", ")}; the rest is broken or lost.` : "Nothing worth keeping comes back."}`;
}
