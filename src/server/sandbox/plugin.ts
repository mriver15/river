// A plugin as the engine uses it: found on disk, described and run by the sandbox, pinned to the hash and capabilities it was installed
// with, and applied only after its result has been validated. The engine never imports plugin source into its own process.
import fs from "node:fs";
import path from "node:path";
import { bus, log } from "../bus.ts";
import { db } from "../db.ts";
import { simSleep, simTick } from "../sim.ts";
import { isStale, lifeGen } from "../lifecycle.ts";
import { ToolError, type ToolDef } from "../toolkit.ts";
import { REACH, type World } from "../world.ts";
import { defById } from "../../content/items.ts";
import { ENTITY_KINDS, ContractError, LIMITS, SDK_VERSION, scanSource, validateResult, type Capability, type Journaled, type Op } from "./contract.ts";
import { describePlugin, hashOf, runPlugin, type Snapshot } from "./host.ts";

export interface PluginRecord { name: string; file: string; hash: string; capabilities: Capability[]; status: "active" | "disabled"; reason: string; shipped: boolean }
export const pluginRecords = new Map<string, PluginRecord>();

const FORGED_INSTALLED = (name: string) => !!db.prepare("SELECT 1 FROM forged WHERE name = ? AND status = 'installed'").get(name);

function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const plainCopy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** What River perceives, as plain data: where it is, what is known nearby, what it carries. No handle to anything in the engine. */
export function snapshotFor(w: World, args: unknown, name: string): Snapshot {
  const me = w.me, near = [...w.entities.values()].filter((e) => w.isKnown(e) && Math.hypot(e.x - me.x, e.z - me.z) <= 80)
    .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)).slice(0, LIMITS.entities);
  const spots: Record<string, { x: number; z: number }> = {};
  for (let d = 0.5; d <= 8; d += 0.5) spots[String(d)] = w.spotNearMe(d);
  const caps: Record<string, string[]> = {};
  for (const i of w.inventory.values()) caps[i.id] = w.items.capabilityList(i.id);
  const rnd = mulberry(seedOf(`${name}|${simTick()}|${JSON.stringify(args)}`));
  return {
    me: { x: me.x, z: me.z, heading: me.heading, needs: { ...me.needs }, sleeping: !!me.sleeping, name: me.name },
    entities: near.map((e) => ({ id: e.id, kind: e.kind, name: e.name, x: e.x, z: e.z, props: plainCopy(e.props) })).filter((e) => JSON.stringify(e.props).length <= LIMITS.propsBytes),
    inventory: [...w.inventory.values()].map((i) => ({ id: i.id, kind: i.kind, name: i.name, desc: i.desc, qty: i.qty, props: i.props ? plainCopy(i.props) : undefined })),
    reach: REACH, timeLabel: w.timeLabel(), spots, caps, rng: Array.from({ length: LIMITS.rng }, rnd), limits: { waitMs: LIMITS.waitMs }, args: plainCopy(args ?? {}),
  };
}

/** Check that what the plugin proposes can still be done, all of it, before any of it is. */
function preflight(w: World, ops: Op[]) {
  const have = new Map<string, number>([...w.inventory.values()].map((i) => [i.id, i.qty]));
  const made = new Set<string>(), gone = new Set<string>();
  const fail = (m: string): never => { throw new ToolError(`${m} Nothing happened.`); };
  for (const o of ops) {
    if (o.op === "spawn" || o.op === "addItem") made.add(o.tmp);
    else if (o.op === "takeItem") { if (made.has(o.id)) continue; const n = have.get(o.id) ?? 0; if (n < o.qty) fail("You no longer have what that needed."); have.set(o.id, n - o.qty); }
    else if (o.op === "putEntity" || o.op === "removeEntity") {
      if (made.has(o.id)) { if (o.op === "removeEntity") gone.add(o.id); continue; }
      const e = w.entities.get(o.id);
      if (!e || gone.has(o.id)) fail("Something it needed is no longer there.");
      else if (!ENTITY_KINDS.has(e.kind)) fail(`A ${e.kind} cannot be changed by a tool.`);
      if (o.op === "removeEntity") gone.add(o.id);
    }
  }
}

function applyOps(w: World, ops: Op[]) {
  const real = new Map<string, string>(), id = (x: string) => real.get(x) ?? x;
  for (const o of ops) {
    switch (o.op) {
      case "spawn": real.set(o.tmp, w.spawn(o.kind as never, o.name, o.x, o.z, o.props).id); break;
      case "addItem": {
        const defId = o.opts?.defId && defById(o.opts.defId).id === o.opts.defId ? o.opts.defId : undefined;
        const it = w.addItem(o.kind, o.name, o.desc, o.qty, o.props, { sources: (o.opts?.sources ?? []).filter((s) => typeof s === "string").map(id), maker: !!o.opts?.maker, note: typeof o.opts?.note === "string" ? o.opts.note : undefined, defId });
        real.set(o.tmp, it.id); break;
      }
      case "takeItem": w.takeItem(id(o.id), o.qty); break;
      case "putEntity": { const e = w.entities.get(id(o.id)); if (e) { e.name = o.name; e.x = o.x; e.z = o.z; e.props = o.props; w.putEntity(e); } break; }
      case "removeEntity": w.removeEntity(id(o.id)); break;
      case "bump": w.bump(o.delta); break;
      case "log": log(o.kind as never, o.text, o.data); break;
      case "setActivity": break;                    // applied at the start
    }
  }
}

function pin(rec: PluginRecord) {
  const row = db.prepare("SELECT hash, capabilities, status, reason, installed_tick FROM plugin_installs WHERE name = ?").get(rec.name) as { hash: string; capabilities: string; status: string; reason: string; installed_tick: number } | undefined;
  db.prepare("INSERT INTO plugin_installs(name, hash, capabilities, status, reason, shipped, installed_tick, sdk) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, capabilities = excluded.capabilities, status = excluded.status, reason = excluded.reason, shipped = excluded.shipped")
    .run(rec.name, rec.hash, JSON.stringify(rec.capabilities), rec.status, rec.reason, rec.shipped ? 1 : 0, row?.installed_tick ?? simTick(), SDK_VERSION);
}
const pinned = (name: string) => { const r = db.prepare("SELECT hash, capabilities FROM plugin_installs WHERE name = ? AND shipped = 0").get(name) as { hash: string; capabilities: string } | undefined; return r ? { hash: r.hash, capabilities: JSON.parse(r.capabilities) as Capability[] } : undefined; };

/** Record that a human installed this exact source with these capabilities. Later changes to the file do not inherit the permission. */
export function installPin(name: string, source: string): { hash: string; capabilities: Capability[] } {
  const hash = hashOf(source), capabilities = scanSource(source).capabilities;
  db.prepare("INSERT INTO plugin_installs(name, hash, capabilities, status, reason, shipped, installed_tick, sdk) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, capabilities = excluded.capabilities, status = 'active', reason = '', shipped = 0, installed_tick = excluded.installed_tick, sdk = excluded.sdk")
    .run(name, hash, JSON.stringify(capabilities), "active", "", 0, simTick(), SDK_VERSION);
  return { hash, capabilities };
}

/** Load one plugin file into the engine: described by the sandbox, never imported. Returns null (with a recorded reason) if it cannot run. */
export async function loadPlugin(file: string): Promise<ToolDef | null> {
  const source = fs.readFileSync(file, "utf8"), hash = hashOf(source), scan = scanSource(source), base = path.basename(file, ".ts");
  const rec: PluginRecord = { name: base, file, hash, capabilities: scan.capabilities, status: "active", reason: "", shipped: !FORGED_INSTALLED(base) };
  const disable = (reason: string) => { rec.status = "disabled"; rec.reason = reason; pluginRecords.set(rec.name, rec); pin(rec); log("system", `Plugin "${rec.name}" is disabled: ${reason}`); return null; };
  const meta = await describePlugin(source);
  if ("error" in meta) return disable(`it could not be loaded in the sandbox: ${meta.error}`);
  rec.name = meta.name;
  if (scan.unsupported.length) return disable(`it uses things the plugin contract does not offer (${scan.unsupported.join(", ")}). It needs adapting; see docs/PLUGIN_SDK.md.`);
  if (!rec.shipped) {                                   // a generated plugin runs only as it was approved
    const p = pinned(rec.name);
    if (!p) return disable("it was never installed through the review flow, so it holds no permissions.");
    if (p.hash !== hash) return disable("its source changed after it was installed. Install it again to give it permissions.");
    rec.capabilities = p.capabilities;
  }
  pluginRecords.set(rec.name, rec); pin(rec);
  const prepare = (a: Record<string, any>, w: World): Promise<Journaled> => runPlugin(source, snapshotFor(w, a, rec.name), { name: rec.name, hash, gen: lifeGen(), tick: simTick() });
  const allowed = new Set<Capability>(rec.capabilities);
  return {
    name: rec.name, description: meta.description, input_schema: meta.input_schema,
    external: (a, w) => prepare(a, w),
    run: async (a, w, ext) => {
      const gen0 = lifeGen(), r = (ext as Journaled | undefined) ?? await prepare(a, w);
      if (r.name !== rec.name || r.hash !== hash) throw new ToolError("That tool changed since it was prepared. Try again.");
      if (r.gen !== gen0 || isStale(r.gen)) throw new ToolError("That belongs to a life that has ended; nothing happens.");   // fenced: a result is for the life that asked for it
      if (!r.ok) throw new ToolError(r.failure === "tool" ? r.message ?? "That did not work." : `The ${rec.name} tool could not finish (${r.failure}): ${r.message ?? "no reason given"}. Nothing happened.`);
      try { validateResult(r, allowed); } catch (e) { if (e instanceof ContractError) throw new ToolError(`The ${rec.name} tool asked for something it may not do (${e.message}). Nothing happened.`); throw e; }
      const ops = r.ops!;
      for (const o of ops) if (o.op === "setActivity") w.setActivity(o.text);
      if ((r.waitMs ?? 0) > 0) { await simSleep(r.waitMs!); if (isStale(gen0)) throw new ToolError("That belongs to a life that has ended; nothing happens."); }
      preflight(w, ops);
      applyOps(w, ops);
      bus.emit("state");
      return r.text!;
    },
  };
}
