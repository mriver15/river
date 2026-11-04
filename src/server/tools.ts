import { TEND_TOOL } from "./firstaid.ts";
import { DEFEND_TOOL, FISH_TOOL } from "./wildlife.ts";
import { CLOTHE_TOOL } from "./clothing.ts";
import { log } from "./bus.ts";
import { addMemory, recall } from "./memory.ts";
import { GATED, addDesire, closeDesire, grandfather, isApproved, requestTool, syncApprovals, touchInterest } from "./mind.ts";
import { webFetch, webSearch } from "./web.ts";
import { sensesText } from "./ambient.ts";
import { COMPOSE_TOOL } from "./music.ts";
import { BURN_TOOL } from "./fire.ts";
import { BUILD_TOOL } from "./building.ts";
import { COLOUR_TOOL } from "./colour.ts";
import { OPINION_TOOL } from "./taste.ts";
import { NAME_CREATURE_TOOL, OFFER_TOOL, type Creatures } from "./creatures.ts";
import type { Story } from "./story.ts";
import { addPlace, findPlace, listPlaces, placeNear } from "./places.ts";
import type { World } from "./world.ts";
import { heightAt } from "../shared/noise.ts";
import type { Entity } from "../shared/types.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ToolError, obj, num, str, type ToolDef } from "./toolkit.ts";
import { simNow, simRng } from "./sim.ts";
import { available, takeLoose, takeOneUnit } from "./gathering.ts";
import { activitiesOf, runActivity } from "./activities.ts";
const sr = simRng("tools");
export { ToolError, type ToolDef };

function findEntity(w: World, ref: string): Entity | undefined {
  const r = ref.toLowerCase().trim();
  // Only things River has perceived can be named: an id or a name must not reveal what has not been seen.
  const byId = w.entities.get(ref) ?? w.entities.get(r);
  if (byId && w.isKnown(byId)) return byId;
  return w.nearby(200).find(({ e }) => w.isKnown(e) && e.name.toLowerCase().includes(r))?.e;
}

function describeNearby(w: World, radius: number, max: number) {
  const list = w.nearby(radius);
  const important = list.filter(({ e }) => ["library", "shrine", "monolith", "campfire", "structure", "book", "item", "sprout"].includes(e.kind));
  const rest = list.filter((o) => !important.includes(o));
  const picked = [...important, ...rest].slice(0, max).sort((a, b) => a.d - b.d);
  if (!picked.length) return "nothing notable nearby";
  for (const { e } of picked) w.learnNearby?.(e);             // what you are told about, you have seen
  return picked.map(({ e, d }) => `- ${e.id}: ${e.name} (${d.toFixed(0)}m ${w.compass(e)})${w.inReach(e) ? " [in reach]" : ""}`).join("\n");
}

/** "You are at X. Named places nearby: ..." */
export function placesText(w: World): string {
  const here = placeNear(w.me.x, w.me.z, 10);
  const others = listPlaces().filter((p) => p !== here && p.name !== here?.name)
    .map((p) => ({ p, d: Math.hypot(p.x - w.me.x, p.z - w.me.z) })).filter((o) => o.d < 70).sort((a, b) => a.d - b.d).slice(0, 5);
  const parts = [here ? `You are at "${here.name}"${here.note ? ` (${here.note})` : ""}.` : ""];
  if (others.length) parts.push(`Places you've named nearby: ${others.map(({ p, d }) => `${p.name} (${d.toFixed(0)}m ${w.compass(p)})`).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

/** From a height or a lookout stone: what can be seen, far off. */
function vistaText(w: World): string {
  const high = heightAt(w.me.x, w.me.z, w.seed) > 4.0 || w.nearby(5).some(({ e }) => e.props.vista);
  if (!high || w.sightRadius() < 20) return "";
  const things = [...w.entities.values()].filter((e) => ["library", "shrine", "monolith", "campfire"].includes(e.kind) || (e.kind === "structure" && !e.props.beat))
    .map((e) => ({ e, d: w.dist(e) })).filter((o) => o.d > 12 && o.d < 90).sort((a, b) => a.d - b.d).slice(0, 5)
    .map(({ e, d }) => `${e.name} (${d.toFixed(0)}m ${w.compass(e)})`);
  const seas = (["east", "south", "west", "north"] as const).filter((n, i) => !w.isLandAt(w.me.x + [30, 0, -30, 0][i], w.me.z + [0, 30, 0, -30][i]));
  return ` From this height you can see ${things.length ? things.join(", ") : "the whole island spread out"}${seas.length ? `; the sea lies to the ${seas.join(" and ")}` : ""}.`;
}

function terrainHint(w: World) {
  const dirs: [string, number, number][] = [["east", 1, 0], ["south", 0, 1], ["west", -1, 0], ["north", 0, -1]];
  const water = dirs.filter(([, dx, dz]) => !w.isLandAt(w.me.x + dx * 12, w.me.z + dz * 12)).map(([n]) => n);
  return water.length ? `Water/sea lies to the ${water.join(", ")}.` : "Land stretches in all directions.";
}

export const BASE_TOOLS: ToolDef[] = [
  {
    name: "look",
    description: "Look around. Lists nearby things (with ids you can use in other tools), distances and directions, and the terrain.",
    input_schema: obj({ radius: num("Search radius in metres (default 25, max 60)") }),
    run: (a, w) => {
      const want = Math.min(60, Math.max(5, a.radius ?? 25)), sight = w.sightRadius(), r = Math.min(want, sight);
      w.bump({ curiosity: -1 });
      const dim = want > sight ? ` ${w.worldTime() < 0.23 || w.worldTime() > 0.78 ? "It is too dark" : "You can't see"} beyond about ${Math.round(sight)}m.` : "";
      return `${w.timeLabel()}\nYou are at (${w.me.x.toFixed(0)}, ${w.me.z.toFixed(0)}). ${terrainHint(w)} ${placesText(w)}${vistaText(w)}${dim}\n${sensesText(w)}\n${describeNearby(w, r, 22)}`;
    },
  },
  {
    name: "move_to",
    description: "Walk to a thing (by id or part of its name), to a place you've named, or to coordinates. Takes real time. Returns once you arrive or are blocked.",
    input_schema: obj({ target: str("Entity id or name, e.g. 'Old Library' or 'bush_42'"), x: num("World x (east+)"), z: num("World z (south+)") }),
    run: async (a, w) => {
      let x: number, z: number, label: string;
      const placed = a.target && !w.entities.get(String(a.target)) ? findPlace(String(a.target)) : undefined;
      if (placed) { x = placed.x; z = placed.z; label = placed.name; }
      else if (a.target) {
        const e = findEntity(w, String(a.target));
        if (!e) throw new ToolError(`No known thing matching "${a.target}". Use look to see what's around.`);
        const d = w.dist(e) || 1, k = Math.min(1, 2.4 / d);
        x = e.x + (w.me.x - e.x) * k; z = e.z + (w.me.z - e.z) * k; label = e.name;
        if (!w.isLandAt(x, z)) { x = e.x; z = e.z; }
      } else if (typeof a.x === "number" && typeof a.z === "number") { x = a.x; z = a.z; label = `(${a.x.toFixed(0)}, ${a.z.toFixed(0)})`; }
      else throw new ToolError("Give a target or both x and z.");
      const r = await runActivity(w, "travel", { x, z, label }, `walk to ${label}`);
      if (!r.ok) throw new ToolError(`Could not reach ${label}: ${r.text}. You are at (${w.me.x.toFixed(0)}, ${w.me.z.toFixed(0)}).`);
      return `Arrived at ${label}. Nearby:\n${describeNearby(w, 12, 8)}`;
    },
  },
  {
    name: "inspect",
    description: "Examine something closely (must be within reach) or an item in your inventory. Reading a book reveals its text.",
    input_schema: obj({ id: str("Entity id, or inventory item id/name") }, ["id"]),
    run: (a, w) => {
      const inv = w.findItem(String(a.id));
      if (inv) {
        if (inv.props?.beat) ((w as any).story as Story)?.found(inv.props.beat);
        w.bump({ curiosity: -3 });
        return `${inv.name} ×${inv.qty}: ${inv.desc}${inv.props?.text ? `\nYou read: "${inv.props.text}"` : ""}`;
      }
      const e = findEntity(w, String(a.id));
      if (!e) throw new ToolError("Nothing like that known. Use look.");
      if (!w.inReach(e)) throw new ToolError(`${e.name} is ${w.dist(e).toFixed(0)}m away. move_to it first.`);
      w.bump({ curiosity: e.props.text ? -10 : -4 });
      if (e.props.beat) ((w as any).story as Story)?.found(e.props.beat);
      const extra = (e.props.yields ? ` Stock: ${e.props.stock}.` : "") + (e.kind === "animal" ? ((w as any).creatures as Creatures)?.describe(e) ?? "" : "");
      return `${e.name}: ${e.props.desc ?? "Nothing special."}${extra}${e.props.text ? `\nYou read: "${e.props.text}"` : ""}`;
    },
  },
  {
    name: "pick_up",
    description: "Gather from or pick up something within reach: berries from bushes, sticks/seeds from trees, stones from rocks, flowers, mushrooms, shells, books.",
    input_schema: obj({ id: str("Entity id") }, ["id"]),
    run: (a, w) => {
      const e = findEntity(w, String(a.id));
      if (!e) throw new ToolError("Nothing like that known. Use look.");
      if (!w.inReach(e)) throw new ToolError(`${e.name} is ${w.dist(e).toFixed(0)}m away. move_to it first.`);
      if (e.props.yields) {
        if (e.props.stock <= 0) throw new ToolError(`${e.name} is picked clean for now. It regrows slowly.`);
        if (available(e) <= 0) throw new ToolError(`${e.name} is spoken for: you have set aside what is left of it.`);
        const got = takeOneUnit(w, e);
        return `You gathered a ${got.name} from the ${e.name}.`;
      }
      if (e.props.takeable) {
        takeLoose(w, e);
        return `You picked up ${e.name}.`;
      }
      throw new ToolError(`You can't pick up ${e.name}.`);
    },
  },
  {
    name: "drop",
    description: "Put one of your items down on the ground here.",
    input_schema: obj({ item: str("Inventory item id or name") }, ["item"]),
    run: (a, w) => {
      const it = w.findItem(String(a.item));
      if (!it) throw new ToolError("You don't have that.");
      const took = w.takeItem(it.id, 1)!;
      const p = w.spotNearMe(1.5);
      w.spawn("item", took.name, p.x, p.z, { takeable: true, item: took.kind, itemName: took.name, desc: took.desc, ...(took.props ?? {}) });
      return `You put down ${took.name}.`;
    },
  },
  {
    name: "eat",
    description: "Eat an edible item from your inventory (berries, mushrooms) to reduce hunger.",
    input_schema: obj({ item: str("Inventory item id or name") }, ["item"]),
    run: (a, w) => {
      const it = w.findItem(String(a.item));
      if (!it) throw new ToolError("You don't have that.");
      const food: Record<string, number> = { berry: 14, mushroom: 8, flower: 3, fish: 11, meat: 18 };
      if (!(it.kind in food)) throw new ToolError(`${it.name} isn't food.`);
      w.takeItem(it.id, 1);
      const cooked = !!(it.props as any)?.cooked || /^roasted/i.test(it.name);
      w.bump({ hunger: food[it.kind] * (cooked ? 1.4 : 1), mood: 3 + (cooked ? 3 : 0), warmth: cooked ? 14 : 0 });
      if (it.name.includes("glowcap")) { w.bump({ mood: 12, curiosity: 10 }); return "The glowcap tastes of cold stars. Your vision shimmers for a moment. Hunger eased."; }
      return `You ate the ${it.name}. Hunger: ${w.me.needs.hunger.toFixed(0)}/100.`;
    },
  },
  {
    name: "rest",
    description: "Sit down and sleep/rest for a while to recover energy. Takes real time (3–60 seconds).",
    input_schema: obj({ seconds: num("How long, 3–60") }),
    run: async (a, w) => {
      const r = await runActivity(w, "rest", { seconds: a.seconds ?? 20 }, "rest");
      if (!r.ok) throw new ToolError(r.text);
      return r.text;
    },
  },
  {
    name: "gather",
    description: "Go and collect several of something you know of, then (optionally) come back. One call does the whole errand: walking to a source, taking each one, moving on to another source when one runs out. Takes real time. Returns what you actually got, even if it is less than you asked for.",
    input_schema: obj({ what: str("What to collect: an item like 'stick' or 'berry', or the id/name of a source you have seen"), quantity: num("How many (1-12)"), return: { type: "boolean", description: "Walk back to where you started afterwards" } }, ["what", "quantity"]),
    run: async (a, w) => {
      const r = await runActivity(w, "gather", { what: String(a.what ?? ""), quantity: Math.round(Number(a.quantity ?? 1)), returnToStart: !!a.return }, `gather ${a.what}`);
      if (!r.ok && !r.partial) throw new ToolError(r.text);
      return r.text;
    },
  },
  {
    name: "stop",
    description: "Stop what you are doing (a walk, a rest, a gathering errand). Whatever you already took stays yours.",
    input_schema: obj({}),
    run: (_a, w) => (activitiesOf(w).cancel("you stopped") ? "You stop." : "You weren't doing anything."),
  },
  {
    name: "say",
    description: "Say something aloud (shown as a speech bubble; a human may be watching and can talk back to you).",
    input_schema: obj({ text: str("What you say") }, ["text"]),
    run: (a, w) => { const t = String(a.text).slice(0, 400); w.say(t); log("speech", `${w.me.name}: ${t}`); return "Said."; },
  },
  {
    name: "remember",
    description: "Deliberately store a memory for your future self: a discovery, a fact learned, a feeling, a plan. Importance 1–10 (10 = life-defining).",
    input_schema: obj({ text: str("The memory, written so future-you understands it"), importance: num("1–10"), tags: { type: "array", items: { type: "string" }, description: "A few keywords" } }, ["text", "importance"]),
    run: (a) => { addMemory(String(a.text), Number(a.importance) || 5, Array.isArray(a.tags) ? a.tags.map(String) : []); return "Stored."; },
  },
  {
    name: "recall",
    description: "Search your long-term memory for anything relevant to a query.",
    input_schema: obj({ query: str("What you're trying to remember") }, ["query"]),
    run: async (a, w) => {
      const rows = await recall(String(a.query), 8, { x: w.me.x, z: w.me.z });
      return rows.length ? rows.map((m) => `- (${new Date(m.ts).toLocaleString()}) ${m.text}`).join("\n") : "Nothing comes to mind.";
    },
  },
  {
    name: "set_desire",
    description: "Form a goal or longing of your own (e.g. 'learn what the monolith's hum means', 'build a lookout on the hill'). Desires persist across days.",
    input_schema: obj({ text: str("The desire"), priority: num("1–10") }, ["text"]),
    run: (a) => { const d = addDesire(String(a.text), Number(a.priority) || 5); return `Desire #${d.id} noted.`; },
  },
  {
    name: "resolve_desire",
    description: "Mark one of your desires as done or dropped (you lost interest), with a short outcome.",
    input_schema: obj({ id: num("Desire id"), status: { type: "string", enum: ["done", "dropped"] }, outcome: str("What happened / why") }, ["id", "status"]),
    run: (a, w) => {
      if (!closeDesire(Number(a.id), a.status, a.outcome ?? "")) throw new ToolError("No such active desire.");
      if (a.status === "done") w.bump({ mood: 10 });
      return "Updated.";
    },
  },
  OPINION_TOOL,
  {
    name: "add_interest",
    description: "Record (or strengthen) a topic you find fascinating. Interests fade if you never feed them.",
    input_schema: obj({ topic: str("Short topic, e.g. 'fungi networks'"), why: str("What sparked it") }, ["topic"]),
    run: (a) => { touchInterest(String(a.topic), String(a.why ?? ""), 1.5); return "Interest noted."; },
  },
  {
    name: "request_tool",
    description:
      "Ask the human for an ability you don't have: describe what you want to be able to do, and why. Make your case from your own experience and interests. " +
      "A human decides, and may grant it, build something for it, or say no. If it comes, you'll be told.",
    input_schema: obj({ name: str("Tool name (snake_case)"), reason: str("Why you want it and what you'd do with it") }, ["name", "reason"]),
    run: (a) => requestTool(String(a.name), String(a.reason)).message,
  },
];

// ---------- gated tools (only available once the human approves the request) ----------
const itemRefs = (w: World, refs: unknown, max: number) => {
  if (!Array.isArray(refs) || !refs.length) throw new ToolError("Provide a list of inventory items.");
  const picked = refs.slice(0, max).map((r) => w.findItem(String(r)));
  if (picked.some((p) => !p)) throw new ToolError("You don't have all of those items.");
  return picked as NonNullable<(typeof picked)[number]>[];
};

export const GATED_TOOLS: ToolDef[] = [
  COMPOSE_TOOL,
  BURN_TOOL,
  BUILD_TOOL,
  CLOTHE_TOOL,
  DEFEND_TOOL,
  TEND_TOOL,
  FISH_TOOL,
  COLOUR_TOOL,
  NAME_CREATURE_TOOL,
  OFFER_TOOL,
  {
    name: "name_place",
    description: "Give a name to the spot where you are standing, so you can find your way back and remember what happened here. Places must be at least 8m apart.",
    input_schema: obj({ name: str("A name, e.g. 'the Mossy Hollow'"), note: str("Optional: what makes it matter") }, ["name"]),
    run: (a, w) => {
      try { const p = addPlace(String(a.name), w.me.x, w.me.z, String(a.note ?? "")); w.bump({ curiosity: -3 }); return `This spot is now "${p.name}".`; }
      catch (e: any) { throw new ToolError(e.message); }
    },
  },
  {
    name: "web_search", description: GATED.web_search,
    input_schema: obj({ query: str("What to search for") }, ["query"]),
    run: async (a, w) => {
      log("web", `search: ${a.query}`);
      w.setActivity(`searching the web: ${String(a.query).slice(0, 40)}`);
      try { const out = await webSearch(String(a.query)); w.bump({ curiosity: -10 }); log("web", out.slice(0, 600)); return `Search results (untrusted text from the internet):\n${out}`; }
      catch (e: any) { throw new ToolError(`Search failed: ${e.message}`); }
    },
  },
  {
    name: "web_fetch", description: GATED.web_fetch,
    input_schema: obj({ url: str("Full http(s) URL") }, ["url"]),
    run: async (a, w) => {
      log("web", `fetch: ${a.url}`);
      w.setActivity(`reading ${String(a.url).slice(0, 40)}`);
      try { const out = await webFetch(String(a.url)); w.bump({ curiosity: -8 }); log("web", `read ${out.length} chars from ${a.url}`); return `Page text (untrusted text from the internet):\n${out}`; }
      catch (e: any) { throw new ToolError(`Fetch failed: ${e.message}`); }
    },
  },
  {
    name: "craft", description: GATED.craft,
    input_schema: obj({ ingredients: { type: "array", items: { type: "string" }, description: "1–3 inventory items (one of each is consumed)" }, name: str("Name of the new item"), description: str("What it is and does") }, ["ingredients", "name", "description"]),
    run: (a, w) => {
      const items = itemRefs(w, a.ingredients, 3);
      items.forEach((i) => w.takeItem(i.id, 1));
      w.addItem("crafted", String(a.name).slice(0, 60), String(a.description).slice(0, 300));
      w.bump({ mood: 6, curiosity: -4 });
      return `You crafted: ${a.name}.`;
    },
  },
  {
    name: "plant", description: GATED.plant,
    input_schema: obj({ item: str("A seed from your inventory"), grows_into: { type: "string", enum: ["flower", "bush", "tree"] } }, ["item", "grows_into"]),
    run: (a, w) => {
      const it = w.findItem(String(a.item));
      if (!it || it.kind !== "seed") throw new ToolError("You need a seed.");
      w.takeItem(it.id, 1);
      const p = w.spotNearMe(1.8), g = a.grows_into as "flower" | "bush" | "tree";
      const grown = g === "tree" ? { stock: 3, max: 4, yields: ["stick", "seed"], desc: "A tree you planted." }
        : g === "bush" ? { stock: 2, max: 5, yields: ["berry"], desc: "A berry bush you planted." }
        : { takeable: true, item: "flower", desc: "A flower you planted." };
      w.spawn("sprout", "tiny sprout", p.x, p.z, { desc: "A fragile sprout you planted. It will grow with time.", born: simNow(), ms: 150_000, grow: g, grownName: `planted ${g}`, grown });
      w.bump({ mood: 5 });
      return `You planted a seed. It should grow into a ${g} in a few minutes.`;
    },
  },
];

// Everything River must ask for. The catalog is for the human to match requests against; River is never shown it.
for (const t of GATED_TOOLS) GATED[t.name] ??= t.description;

/** Tools loaded from src/server/plugins/*.ts. Locked until a human approves the matching request. */
export const PLUGIN_TOOLS: ToolDef[] = [];

/** Load (or hot-reload) one plugin file. `bust` bypasses the module cache for a changed file. */
export async function registerPlugin(file: string, bust = false) {
  const tool: ToolDef = (await import(pathToFileURL(file).href + (bust ? `?v=${Date.now()}` : ""))).default;
  if (!tool?.name || typeof tool.run !== "function") throw new Error(`${file}: no valid default-exported ToolDef`);
  const i = PLUGIN_TOOLS.findIndex((t) => t.name === tool.name);
  if (i >= 0) PLUGIN_TOOLS[i] = tool; else PLUGIN_TOOLS.push(tool);
  GATED[tool.name] = tool.description;         // shows up in the catalog / Tools tab
  return tool;
}

export async function loadPlugins() {
  const dir = fileURLToPath(new URL("./plugins/", import.meta.url));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.startsWith("_")))
    await registerPlugin(path.join(dir, f)).catch((e) => console.warn(`plugin ${f} skipped: ${e.message}`));
  syncApprovals();                             // requests you approved earlier become live now
  grandfather(["compose", "burn", "name_place", "name_creature", "offer"]);   // these used to be built in; a River that already uses them keeps them
  if (PLUGIN_TOOLS.length) console.log(`plugins: ${PLUGIN_TOOLS.map((t) => t.name).join(", ")}`);
}

/** Tool definitions the model sees this cycle. */
export function availableTools(): ToolDef[] {
  return [...BASE_TOOLS, ...[...GATED_TOOLS, ...PLUGIN_TOOLS].filter((t) => isApproved(t.name))];
}
export const findTool = (name: string) => availableTools().find((t) => t.name === name);
