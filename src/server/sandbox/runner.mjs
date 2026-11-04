// The sandbox process. It is started with Node's permission model on (no file writes, no child processes, no workers, no network),
// a small heap, and nothing but this file readable. Plugin code runs inside a fresh vm context that has no host objects at all: no
// process, no require, no fetch, no timers, no eval. Data goes in and out as JSON strings, so no live object crosses the boundary.
// A plugin sees a copy of what River perceives (the snapshot) through the same `w` it always used, but its writes become proposals,
// returned for the engine to validate and apply. Nothing a plugin does here can change the world.
import vm from "node:vm";

const SDK = String.raw`
(() => {
"use strict";
const __S = JSON.parse(__input);
const __ops = [];
let __t = 0, __ri = 0, __n = 0;
const __clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
class ToolError extends Error { constructor(m) { super(m); this.name = "ToolError"; } }
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const rand = () => { if (__ri >= __S.rng.length) throw new ToolError("The world has no more chance in it for this."); return __S.rng[__ri++]; };
const wait = async (ms) => { ms = Number(ms); if (!(ms >= 0)) ms = 0; __t += ms; if (__t > __S.limits.waitMs) throw new Error("waited longer than the world allows"); };
const log = (kind, text, data) => { __ops.push({ op: "log", kind: String(kind), text: String(text), ...(data === undefined ? {} : { data: __clone(data) }) }); };

const me = Object.freeze({ ...__clone(__S.me), needs: __clone(__S.me.needs) });
const entities = new Map(__S.entities.map((e) => [e.id, __clone(e)]));
const inventory = new Map(__S.inventory.map((i) => [i.id, __clone(i)]));
const dist = (e) => Math.hypot(e.x - me.x, e.z - me.z);
const w = {
  me,
  entities,
  reach: __S.reach,
  nearby: (r) => [...entities.values()].map((e) => ({ e, d: dist(e) })).filter((o) => o.d <= r).sort((a, b) => a.d - b.d),
  dist,
  inReach: (e) => dist(e) <= __S.reach,
  compass: (e) => { const a = Math.atan2(e.z - me.z, e.x - me.x), d = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"]; return d[(Math.round(a / (Math.PI / 4)) + 8) % 8]; },
  timeLabel: () => __S.timeLabel,
  spotNearMe: (d = 2) => { const k = String(Math.max(0.5, Math.min(8, Math.round(Number(d) * 2) / 2))); return __clone(__S.spots[k] ?? { x: me.x, z: me.z }); },
  findItem: (ref) => { const r = String(ref).toLowerCase(); return inventory.get(ref) ?? [...inventory.values()].find((i) => i.name.toLowerCase() === r || i.kind.toLowerCase() === r); },
  canDo: (id, cap) => !!(__S.caps[id] && __S.caps[id].includes(cap)),
  items: { canDo: (id, cap) => !!(__S.caps[id] && __S.caps[id].includes(cap)) },
  putEntity: (e) => { if (!e || typeof e.id !== "string") throw new Error("putEntity needs an entity"); entities.set(e.id, e); __ops.push({ op: "putEntity", id: e.id, name: String(e.name), x: Number(e.x), z: Number(e.z), props: __clone(e.props ?? {}) }); },
  spawn: (kind, name, x, z, props = {}) => { const id = "new_" + (++__n); const e = { id, kind, name, x, z, props: __clone(props) }; entities.set(id, e); __ops.push({ op: "spawn", tmp: id, kind: String(kind), name: String(name), x: Number(x), z: Number(z), props: __clone(props) }); return e; },
  removeEntity: (id) => { entities.delete(id); __ops.push({ op: "removeEntity", id: String(id) }); },
  addItem: (kind, name, desc, qty = 1, props, opts) => {
    const tmp = "new_item_" + (++__n); const it = { id: tmp, kind, name, desc, qty, props: __clone(props) };
    inventory.set(tmp, it);
    __ops.push({ op: "addItem", tmp, kind: String(kind), name: String(name), desc: String(desc), qty: Number(qty), ...(props === undefined ? {} : { props: __clone(props) }), ...(opts === undefined ? {} : { opts: __clone(opts) }) });
    return it;
  },
  takeItem: (id, qty = 1) => {
    const it = inventory.get(id); if (!it || it.qty < qty || qty < 1) return null;
    const snap = { ...__clone(it), qty }; it.qty -= qty; if (it.qty <= 0) inventory.delete(id);
    __ops.push({ op: "takeItem", id: String(id), qty: Number(qty) }); return snap;
  },
  bump: (delta) => { __ops.push({ op: "bump", delta: __clone(delta) }); for (const k of Object.keys(delta)) if (typeof me.needs[k] === "number") me.needs[k] = Math.max(0, Math.min(100, me.needs[k] + delta[k])); },
  setActivity: (text) => { __ops.push({ op: "setActivity", text: String(text) }); },
};
globalThis.__sdk = { ToolError, obj, str, num, wait, rand, log };
globalThis.__describe = () => { const t = __exports.default; return JSON.stringify({ name: t.name, description: t.description, input_schema: t.input_schema }); };
globalThis.__run = async () => {
  const tool = __exports.default;
  try {
    const out = await tool.run(__clone(__S.args), w);
    if (typeof out !== "string" || !out.trim()) throw new Error("run() must return a non-empty string");
    return JSON.stringify({ v: 1, ok: true, text: out, ops: __ops, waitMs: __t });
  } catch (e) {
    if (e instanceof ToolError || (e && e.name === "ToolError")) return JSON.stringify({ v: 1, ok: false, failure: "tool", message: String(e.message) });
    return JSON.stringify({ v: 1, ok: false, failure: "crash", message: String((e && e.message) || e).slice(0, 400) });
  }
};
})();
`;

/** Turn the (type-stripped) plugin source into a script for the context: its imports become the SDK, its default export a variable. */
function wrap(code) {
  const body = code
    .replace(/^\s*import\s*\{([^}]*)\}\s*from\s*["']\.\.\/(?:toolkit|bus)\.ts["'];?/gm, (_, names) => `const {${names.replace(/\btype\s+\w+\s*,?/g, "")}} = __sdk;`)
    .replace(/\bexport\s+default\b/, "__exports.default =");
  return `const __exports = {};\n${SDK}\nconst __sdk = globalThis.__sdk;\n${body}\n;undefined`;
}

function context(input) {
  const ctx = vm.createContext({ __input: JSON.stringify(input) }, { codeGeneration: { strings: false, wasm: false } });
  return ctx;
}

process.on("message", async (msg) => {
  const reply = (o) => process.send(JSON.stringify({ id: msg.id, ...o }), () => process.exit(0));
  try {
    const ctx = context(msg.input);
    vm.runInContext(wrap(msg.code), ctx, { timeout: msg.cpuMs, filename: "plugin.js" });
    if (msg.t === "describe") return reply({ out: vm.runInContext("__describe()", ctx, { timeout: msg.cpuMs }) });
    const p = vm.runInContext("__run()", ctx, { timeout: msg.cpuMs });
    reply({ out: await p });
  } catch (e) {
    reply({ error: String((e && e.message) || e).slice(0, 400), timeout: !!(e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") });
  }
});
process.send(JSON.stringify({ ready: true }));
