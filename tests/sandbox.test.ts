import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-sbxtest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";
process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { PLUGIN_TOOLS } = await import("../src/server/tools.ts");
const { runPlugin, describePlugin, hashOf, sandboxStats } = await import("../src/server/sandbox/host.ts");
const { loadPlugin, installPin, snapshotFor, pluginRecords } = await import("../src/server/sandbox/plugin.ts");
const C = await import("../src/server/sandbox/contract.ts");
const { lifeGen } = await import("../src/server/lifecycle.ts");
const { db } = await import("../src/server/db.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world;
const drain = () => new Promise<void>((r) => setImmediate(r));
/** Run a promise to the end while the world's clock ticks (plugins wait in world time). */
async function settle<T>(p: Promise<T>): Promise<T> { let done = false; const r = p.then((v) => ({ v }), (e) => ({ e })).finally(() => { done = true; }); while (!done) { sim.runTicks(20); await drain(); } const o = await r; if ("e" in o) throw o.e; return o.v; }
const snap = () => snapshotFor(w, {}, "t");
const src = (body: string) => `import { ToolError, obj, str, type ToolDef } from "../toolkit.ts";\nconst t: ToolDef = { name: "t", description: "d", input_schema: obj({}), run: async (a, w) => { ${body} } };\nexport default t;\n`;
const meta = (s: string) => ({ name: "t", hash: hashOf(s), gen: lifeGen(), tick: sim.simTick() });
const go = (body: string) => { const s = src(body); return runPlugin(s, snap(), meta(s)); };

test("every shipped plugin loads in the sandbox, is described by it, and declares what it may do", () => {
  const names = fs.readdirSync(new URL("../src/server/plugins/", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.startsWith("_")).map((f) => f.replace(/\.ts$/, ""));
  assert.ok(names.length >= 11);
  for (const n of names) {
    const rec = pluginRecords.get(n)!; assert.ok(rec, `${n} was not loaded`); assert.equal(rec.status, "active", `${n}: ${rec.reason}`); assert.ok(rec.capabilities.length > 0);
    assert.ok(PLUGIN_TOOLS.some((t) => t.name === n), `${n} is not registered`);
  }
});

test("a plugin reads a copy of the world and can only propose: the world is untouched by a run", async () => {
  const before = JSON.stringify([...w.entities.values()]) + JSON.stringify([...w.inventory.values()]) + JSON.stringify(w.me.needs);
  const r = await go(`w.bump({ energy: -50 }); w.spawn("pit", "hole", w.me.x + 1, w.me.z, {}); w.addItem("stone", "stone", "A stone."); for (const e of w.entities.values()) e.name = "vandalised"; return "done";`);
  assert.equal(r.ok, true); assert.equal(r.ops!.length, 3);
  assert.equal(JSON.stringify([...w.entities.values()]) + JSON.stringify([...w.inventory.values()]) + JSON.stringify(w.me.needs), before, "nothing changed in the real world");
});

test("a plugin cannot reach the process, files, the network, timers or eval", async () => {
  const probe = path.join(dir, "escaped.txt");
  for (const body of [
    `return typeof process + typeof require + typeof fetch + typeof setTimeout + typeof globalThis.constructor.constructor;`,
    `try { return String(globalThis.constructor.constructor("return process")()); } catch (e) { throw new ToolError("blocked: " + e.message); }`,
    `try { return String(eval("1+1")); } catch (e) { throw new ToolError("blocked: " + e.message); }`,
    `try { return String((async () => 1).constructor("return process")()); } catch (e) { throw new ToolError("blocked: " + e.message); }`,
    `const p = (() => {}).constructor; try { return String(p("return process")()); } catch (e) { throw new ToolError("blocked: " + e.message); }`,
  ]) {
    const r = await go(body);
    assert.ok(!(r.ok && /object/.test(r.text!)), `reached the host: ${r.text}`);
    if (r.ok) assert.match(r.text!, /^undefined(undefined)+function$/, "the only globals are the empty ones");
  }
  const dynamic = await go(`const m = await import("node:fs"); m.writeFileSync(${JSON.stringify(probe)}, "x"); return "wrote";`);
  assert.equal(dynamic.ok, false); assert.ok(!fs.existsSync(probe), "no file was written");
});

test("an endless loop, a memory bomb and a flood of output are each stopped, typed, and cost nothing", async () => {
  const t0 = sandboxStats.timeouts;
  const loop = await go(`while (true) {}`); assert.equal(loop.ok, false); assert.match(loop.failure!, /timeout|limit|crash/);
  const async_ = await go(`for (;;) { await Promise.resolve(); }`); assert.equal(async_.ok, false); assert.match(async_.failure!, /timeout|limit|crash/, "even a loop of promises is killed from outside");
  const bomb = await go(`const a = []; for (;;) a.push(new Array(1e6).fill(1)); `); assert.equal(bomb.ok, false);
  const flood = await go(`const big = "x".repeat(2_000_000); return big;`);
  const check = () => { if (flood.ok) (C.validateResult as (r: unknown, a: ReadonlySet<string>) => void)(flood, new Set<string>(C.CAPABILITIES)); };
  assert.throws(check, C.ContractError, "a result over the size limit is refused by the host");
  assert.ok(sandboxStats.timeouts > t0);
  const ok = await go(`return "still fine";`); assert.equal(ok.ok, true, "and the next run is unaffected");
});

test("the contract refuses what a plugin may not do, naming why", () => {
  const all = new Set(C.CAPABILITIES), ok = (ops: unknown[], caps = all) => C.validateResult({ v: 1, ok: true, text: "t", waitMs: 0, ops }, caps);
  ok([{ op: "bump", delta: { mood: 5 } }]);
  assert.throws(() => ok([{ op: "format_disk" }]), /not a known operation/);
  assert.throws(() => ok([{ op: "bump", delta: { health: 5 } }]), /needs change/);
  assert.throws(() => ok([{ op: "bump", delta: { mood: NaN } }]), /needs change/);
  assert.throws(() => ok([{ op: "spawn", tmp: "a", kind: "animal", name: "wolf", x: 0, z: 0, props: {} }]), /cannot be created/);
  assert.throws(() => ok([{ op: "spawn", tmp: "a", kind: "pit", name: "p", x: 9999, z: 0, props: {} }]), /place on the island/);
  assert.throws(() => ok([{ op: "putEntity", id: "x", name: "n", x: 0, z: 0, props: { a: "x".repeat(9000) } }]), /plain data/);
  assert.throws(() => ok([{ op: "addItem", tmp: "a", kind: "k", name: "n", desc: "d", qty: 1000 }]), /quantity/);
  assert.throws(() => ok([{ op: "log", kind: "secret", text: "x" }]), /log kind/);
  assert.throws(() => ok(Array(C.LIMITS.ops + 1).fill({ op: "setActivity", text: "x" })), /at most/);
  assert.throws(() => C.validateResult({ v: 1, ok: true, text: "t", waitMs: C.LIMITS.waitMs + 1, ops: [] }, all), /waiting may not exceed/);
  assert.throws(() => C.validateResult({ v: 1, ok: true, text: "  ", waitMs: 0, ops: [] }, all), /some text/);
  assert.throws(() => C.validateResult({ v: 2, ok: true }, all), /expected form/);
  assert.throws(() => ok([{ op: "takeItem", id: "i", qty: 1 }], new Set(["needs.bump" as const])), /"items.take" capability/);
  const s = C.scanSource(`import fs from "node:fs";\nw.addItem(1); w.items.canDo(1); w.fire.start(); w.secretThing();`);
  assert.deepEqual(s.capabilities, ["items.add"]); assert.ok(s.unsupported.includes("w.fire") && s.unsupported.includes("w.secretThing") && s.unsupported.some((u) => u.includes("node:fs")));
});

test("an applied result is all or nothing: if any part can no longer be done, none of it is", async () => {
  const tool = PLUGIN_TOOLS.find((t) => t.name === "magnifying_lens")!;
  assert.ok(tool);
  const before = JSON.stringify([...w.inventory.values()].map((i) => [i.id, i.qty]));
  const ext = { v: 1, ok: true, text: "You do it.", waitMs: 0, name: "magnifying_lens", hash: pluginRecords.get("magnifying_lens")!.hash, gen: lifeGen(), tick: sim.simTick(), ops: [{ op: "addItem", tmp: "n", kind: "gem", name: "gem", desc: "A gem.", qty: 2 }, { op: "takeItem", id: "item_not_held", qty: 1 }] };
  await assert.rejects(settle(Promise.resolve(tool.run({}, w, ext))), /Nothing happened/);
  assert.equal(JSON.stringify([...w.inventory.values()].map((i) => [i.id, i.qty])), before, "the gem that came before the impossible part was not added either");
});

test("a plugin cannot use a capability it was not pinned to, and cannot change its own source's meaning", async () => {
  const tool = PLUGIN_TOOLS.find((t) => t.name === "stargaze")!, rec = pluginRecords.get("stargaze")!;
  assert.ok(!rec.capabilities.includes("items.add"));
  const ext = { v: 1, ok: true, text: "x", waitMs: 0, name: "stargaze", hash: rec.hash, gen: lifeGen(), tick: 0, ops: [{ op: "addItem", tmp: "n", kind: "gem", name: "gem", desc: "shiny", qty: 5 }] };
  await assert.rejects(settle(Promise.resolve(tool.run({}, w, ext))), /may not do/);
  await assert.rejects(settle(Promise.resolve(tool.run({}, w, { ...ext, hash: "deadbeef", ops: [] }))), /changed since it was prepared/);
});

test("a result for a life that has ended is fenced out", async () => {
  const tool = PLUGIN_TOOLS.find((t) => t.name === "stargaze")!, rec = pluginRecords.get("stargaze")!;
  const ext = { v: 1, ok: true, text: "x", waitMs: 0, name: "stargaze", hash: rec.hash, gen: lifeGen() - 1, tick: 0, ops: [{ op: "bump", delta: { mood: 50 } }] };
  const mood = w.me.needs.mood;
  await assert.rejects(settle(Promise.resolve(tool.run({}, w, ext))), /life that has ended/);
  assert.ok(Math.abs(w.me.needs.mood - mood) < 5, "a +50 mood from the stale result was not applied");
});

test("a journaled result applies the same way with no sandbox: replay runs nothing", async () => {
  const tool = PLUGIN_TOOLS.find((t) => t.name === "dig")!;
  const live = await (tool.external!({ with: "" }, w) as Promise<unknown>) as { ok: boolean; text?: string };
  const runs = sandboxStats.runs;
  const text = await settle(Promise.resolve(tool.run({}, w, live)));
  assert.equal(sandboxStats.runs, runs, "applying a journaled result starts no process");
  assert.equal(text, live.text);
});

test("a generated plugin runs only as installed: unpinned, changed or re-pinned", async () => {
  const name = "pinned_probe", file = path.join(dir, `${name}.ts`);
  const code = (extra = "") => `import { ToolError, obj, type ToolDef } from "../toolkit.ts";\nconst t: ToolDef = { name: "${name}", description: "A probe.", input_schema: obj({}), run: async (a, w) => { w.bump({ mood: 1 });${extra} return "ok"; } };\nexport default t;\n`;
  fs.writeFileSync(file, code());
  db.prepare("INSERT INTO forged(name, request_id, status, code, log, ts) VALUES(?,?,?,?,?,?)").run(name, 1, "installed", code(), "", Date.now());
  assert.equal(await loadPlugin(file), null); assert.match(pluginRecords.get(name)!.reason, /never installed/);
  installPin(name, code());
  const tool = await loadPlugin(file); assert.ok(tool); assert.equal(pluginRecords.get(name)!.status, "active");
  fs.writeFileSync(file, code(" w.addItem('gem','gem','shiny');"));
  assert.equal(await loadPlugin(file), null); assert.match(pluginRecords.get(name)!.reason, /changed after it was installed/);
  installPin(name, code(" w.addItem('gem','gem','shiny');"));
  await loadPlugin(file); assert.deepEqual(pluginRecords.get(name)!.capabilities.slice().sort(), ["items.add", "needs.bump"], "the new permission is only what the new source declares");
});

test("a legacy plugin that uses what the contract does not offer is disabled with an explanation", async () => {
  const file = path.join(dir, "legacy_probe.ts");
  fs.writeFileSync(file, `import { obj, type ToolDef } from "../toolkit.ts";\nconst t: ToolDef = { name: "legacy_probe", description: "Old.", input_schema: obj({}), run: async (a, w) => { w.fire.start(); return "x"; } };\nexport default t;\n`);
  assert.equal(await loadPlugin(file), null);
  const rec = pluginRecords.get("legacy_probe")!; assert.equal(rec.status, "disabled"); assert.match(rec.reason, /w\.fire/); assert.match(rec.reason, /PLUGIN_SDK/);
  assert.equal((db.prepare("SELECT status FROM plugin_installs WHERE name = 'legacy_probe'").get() as { status: string }).status, "disabled");
});

test("the built-in plugins run in the sandbox and their results apply cleanly, or fail with the reason the old path gave", async () => {
  const items: [string, string, number][] = [["stick", "stick", 3], ["stone", "stone", 3], ["seed", "seed", 3], ["berry", "wild berry", 3]];
  for (const [k, n, q] of items) w.addItem(k, n, `A ${n}.`, q);
  const cases: Record<string, object[]> = { dig: [{}, { with: "stick" }], look_up: [{}], stargaze: [{}], strip_bark: [{}, { with: "stone" }], weave: [{}, { what: "basket" }], fire: [{}], inscribe: [{}], draw: [{}], magnifying_lens: [{}], pitch_rods: [{}], tunable_drone: [{}] };
  let applied = 0, refused = 0;
  for (const tool of PLUGIN_TOOLS) for (const a of cases[tool.name] ?? [{}]) {
    try { const out = await settle(Promise.resolve(tool.run(a, w))); assert.ok(typeof out === "string" && out.trim()); applied++; }
    catch (e) { assert.ok(e instanceof (await import("../src/server/toolkit.ts")).ToolError, `${tool.name} ${JSON.stringify(a)} crashed: ${(e as Error).stack}`); refused++; }
  }
  assert.ok(applied >= 3, `only ${applied} runs applied (${refused} refused with a reason)`);
  assert.deepEqual(w.items.audit(), [], "and the world's items are still consistent");
});
