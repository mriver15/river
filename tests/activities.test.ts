import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-acttest-")), "t.db");
process.env.MOCK_LLM = "1";
let netCalls = 0;
globalThis.fetch = (() => { netCalls++; throw new Error("no network in this test"); }) as typeof fetch;

const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems, humanCommand } = await import("../src/server/runtime.ts");
const { planPath } = await import("../src/server/nav.ts");
const { resetApply } = await import("../src/server/reset.ts");
const { db } = await import("../src/server/db.ts");
const { isLand } = await import("../src/shared/noise.ts");
const { bodyApi } = await import("../src/server/body.ts");

const rt = await createRuntime();
startSystems(rt);
const { world: w, activities: A } = rt;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number, until?: () => boolean) { for (let i = 0; i < ticks && !(until?.()); i++) { sim.runTicks(1); await drain(); } }

/** a flat open stretch of land: returns a start point with `len` metres of land to the east */
function openGround(len = 30) {
  for (let x = -40; x < 40; x += 2) for (let z = -40; z < 40; z += 2) {
    let ok = true; for (let d = 0; d <= len && ok; d += 1) for (let dz = -3; dz <= 3; dz += 3) if (!isLand(x + d, z + dz, w.seed)) ok = false;
    if (ok) return { x, z };
  }
  throw new Error("no open ground on this island");
}
function reset(ground = openGround()) {
  A.cancel("test");
  for (const e of [...w.entities.values()]) w.removeEntity(e.id);      // first, so nothing from the last test is still burning while the body settles
  bodyApi.reset(); sim.runTicks(2);                                   // a fresh body: wounds from an earlier test would (rightly) interrupt this one
  for (const i of [...w.inventory.values()]) w.takeItem(i.id, i.qty);
  w.me.x = ground.x; w.me.z = ground.z; w.me.sleeping = false; w.me.activity = "idle"; w.walk = null;
  return ground;
}
const known = (e: ReturnType<typeof w.spawn>) => { rt.knowledge.learn(e); return e; };
const count = (kind: string) => [...w.inventory.values()].filter((i) => i.kind === kind).reduce((a, i) => a + i.qty, 0);

test("gather three and come back, with no model call in between", async () => {
  const g = reset();
  known(w.spawn("tree", "oak", g.x + 14, g.z, { yields: ["stick"], stock: 5, max: 5 }));
  const p = A.completion((A.begin("gather", { what: "stick", quantity: 3, returnToStart: true }, { intent: "gather sticks", source: "brain" })).id);
  await run(3000, () => A.cur === null);
  const out = await p;
  assert.equal(out.ok, true); assert.equal(!!out.partial, false);
  assert.equal(count("stick"), 3);
  assert.ok(Math.hypot(w.me.x - g.x, w.me.z - g.z) < 1, "back where it started");
  assert.equal(netCalls, 0);
});

test("a source that runs dry gives partial completion", async () => {
  const g = reset();
  known(w.spawn("tree", "small oak", g.x + 10, g.z, { yields: ["stick"], stock: 2, max: 2 }));
  const p = A.completion(A.begin("gather", { what: "stick", quantity: 3 }, { intent: "gather", source: "brain" }).id);
  await run(3000, () => A.cur === null);
  const out = await p;
  assert.equal(out.partial, true); assert.equal(count("stick"), 2); assert.match(out.text, /wanted 3/);
});

test("fire interrupts rest and wakes River", async () => {
  const g = reset();
  const p = A.completion(A.begin("rest", { seconds: 30 }, { intent: "rest", source: "brain" }).id);
  await run(20); assert.equal(w.me.sleeping, true);
  w.spawn("tree", "burning oak", g.x + 2, g.z, { burning: { since: sim.simNow(), ends: sim.simNow() + 60_000 } });
  await run(20, () => A.cur === null);
  const out = await p;
  assert.equal(out.ok, false); assert.equal(out.data?.interrupted, "fire"); assert.equal(w.me.sleeping, false);
});

test("cancel releases only what was not yet taken", async () => {
  const g = reset();
  const bush = known(w.spawn("bush", "berry bush", g.x + 8, g.z, { yields: ["berry"], stock: 5, max: 5 }));
  const a = A.begin("gather", { what: "berry", quantity: 3 }, { intent: "gather", source: "brain" });
  await run(2000, () => count("berry") >= 1);
  assert.equal(count("berry"), 1, `activity ${a.status} ${JSON.stringify(a.progress)} ${JSON.stringify(a.outcome)} sleeping=${w.me.sleeping} at ${w.me.x.toFixed(1)},${w.me.z.toFixed(1)} bush at ${bush.x.toFixed(1)},${bush.z.toFixed(1)}`);
  assert.equal(w.entities.get(bush.id)!.props.reserved?.[a.id], 2, "two units still set aside");
  A.cancel("changed my mind");
  const after = w.entities.get(bush.id)!;
  assert.equal(after.props.reserved, undefined); assert.equal(after.props.stock, 4); assert.equal(count("berry"), 1);
});

test("a new life cancels the old work", async () => {
  const g = reset();
  known(w.spawn("tree", "oak", g.x + 12, g.z, { yields: ["stick"], stock: 5, max: 5 }));
  const p = A.completion(A.begin("gather", { what: "stick", quantity: 3 }, { intent: "gather", source: "brain" }).id);
  await run(20);
  resetApply({ world: false }, rt);
  const out = await p;
  assert.equal(out.ok, false); assert.match(out.text, /new life/);
  assert.equal(A.cur, null); assert.equal((db.prepare("SELECT COUNT(*) n FROM sim_activities WHERE status='running'").get() as any).n, 0);
});

test("routes go around known obstacles and fail when the way is shut", () => {
  const g = reset(openGround(40));
  const wall = (gap: boolean) => { for (const e of [...w.entities.values()]) w.removeEntity(e.id); for (let z = -60; z <= 60; z += 1.5) if (!(gap && Math.abs(z - g.z) < 3)) known(w.spawn("structure", "wall", g.x + 15, z, { shape: "wall", radius: 1.2 })); };
  const target = { x: g.x + 30, z: g.z };
  wall(false);
  assert.equal(planPath(w, { x: g.x, z: g.z }, target, w.isKnown), null, "a wall across the island, all of it known");
  assert.ok(planPath(w, { x: g.x, z: g.z }, target, () => false), "the same wall unseen does not shape the plan");
  wall(true);
  const path = planPath(w, { x: g.x, z: g.z }, target, w.isKnown)!;
  assert.ok(path, "a gap lets the route through");
  const pts = [{ x: g.x, z: g.z }, ...path];
  let crossZ: number | null = null;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!; if ((a.x - (g.x + 15)) * (b.x - (g.x + 15)) <= 0 && a.x !== b.x) crossZ = a.z + ((b.z - a.z) * (g.x + 15 - a.x)) / (b.x - a.x); }
  assert.ok(crossZ !== null && Math.abs(crossZ - g.z) < 3, `and it crosses the wall inside the gap (crossed at z offset ${crossZ === null ? "never" : (crossZ - g.z).toFixed(1)})`);
  assert.deepEqual(path, planPath(w, { x: g.x, z: g.z }, target, w.isKnown), "the same plan every time");
});

test("what River has not seen cannot be a target", async () => {
  const g = reset();
  const far = w.spawn("bush", "far bush", g.x + 50, g.z, { yields: ["berry"], stock: 5, max: 5 });   // beyond sight, never learned
  assert.equal(w.isKnown(far), false);
  const byKind = A.completion(A.begin("gather", { what: "berry", quantity: 2 }, { intent: "gather", source: "brain" }).id);
  await run(200, () => A.cur === null);
  const o1 = await byKind; assert.equal(o1.ok, false); assert.match(o1.text, /nothing to gather/);
  const byId = A.completion(A.begin("gather", { what: far.id, quantity: 1 }, { intent: "gather", source: "brain" }).id);
  await run(200, () => A.cur === null);
  assert.equal((await byId).ok, false);
  const tool = (await import("../src/server/tools.ts")).BASE_TOOLS.find((t) => t.name === "move_to")!;
  await assert.rejects(async () => tool.run({ target: far.id }, w), /No known thing/);
  void humanCommand;
});

test("a charging predator stops the errand and River runs, before any thinking", async () => {
  const g = reset();
  known(w.spawn("tree", "oak", g.x + 12, g.z, { yields: ["stick"], stock: 5, max: 5 }));
  const p = A.completion(A.begin("gather", { what: "stick", quantity: 3 }, { intent: "gather", source: "brain" }).id);
  await run(5);
  const wolf = { name: "wolf", d: 5, x: w.me.x - 5, z: w.me.z };   // behind River, with open ground ahead
  const real = rt.wildlife.threat; rt.wildlife.threat = () => wolf;
  const before = Math.hypot(w.me.x - wolf.x, w.me.z - wolf.z);
  await run(2);
  const out = await p;
  assert.equal(out.data?.interrupted, "predator");
  assert.equal(A.cur?.source, "reflex", "the instinct to run began an escape without waiting for a decision");
  rt.wildlife.threat = () => null;
  await run(80);
  assert.ok(Math.hypot(w.me.x - wolf.x, w.me.z - wolf.z) > before + 4, "River is farther from the wolf");
  rt.wildlife.threat = real;
  assert.equal(netCalls, 0);
});

const { findTool } = await import("../src/server/tools.ts");
const tool = (name: string) => {
  for (const g of ["craft", "compose", "build", "clothe", "colour", "tend"]) db.prepare("INSERT INTO tools(name, approved) VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET approved = 1").run(g);   // abilities a human has granted (a reset takes them away)
  const t = findTool(name); if (!t) throw new Error(`no tool ${name}`); return t; };

test("crafting takes time and spends its materials only at the end", async () => {
  reset(); w.addItem("stick", "stick", "A stick.", 3);
  const done = Promise.resolve(tool("craft").run({ ingredients: ["stick", "stick"], name: "frame", description: "A small frame." }, w));
  await run(10);
  assert.equal(count("stick"), 3, "nothing spent while the work is under way");
  assert.equal(A.cur?.def, "work"); assert.ok((A.view()?.pct ?? 0) > 0);
  await run(60, () => A.cur === null);
  assert.match(await done, /You crafted: frame/);
  assert.equal(count("stick"), 1); assert.equal(count("crafted"), 1);
});

test("an invalid recipe fails at once and costs nothing", async () => {
  reset(); w.addItem("stick", "stick", "A stick.", 1);
  await assert.rejects(async () => tool("craft").run({ ingredients: ["stick", "unicorn horn"], name: "x", description: "y" }, w), /unicorn horn|carrying|have/i);
  assert.equal(A.cur, null); assert.equal(count("stick"), 1);
});

test("danger stops the work and the materials are untouched", async () => {
  const g = reset(); w.addItem("stick", "stick", "A stick.", 2);
  const done = Promise.resolve(tool("craft").run({ ingredients: ["stick", "stick"], name: "frame", description: "A frame." }, w)).catch((e) => e);
  await run(10);
  w.spawn("tree", "burning oak", g.x + 2, g.z, { burning: { since: sim.simNow(), ends: sim.simNow() + 60_000 } });
  await run(20, () => A.cur === null);
  assert.match(String(((await done) as Error).message), /fire is close/);
  assert.equal(count("stick"), 2); assert.equal(count("crafted"), 0);
});

test("a performance is counted once and its effects land at the end", async () => {
  reset();
  const plays = () => (db.prepare("SELECT COALESCE(SUM(plays),0) n FROM compositions").get() as any).n as number;
  const before = plays();
  const done = Promise.resolve(tool("compose").run({ action: "write", title: "Test Tune", tempo: 600, voices: [{ instrument: "chimes", notes: "A4 C5 E5 A5" }] }, w));
  await run(5);
  assert.equal(plays(), before + 1, "counted when it begins");
  await run(400, () => A.cur === null);
  assert.match(await done, /You wrote and performed "Test Tune"/);
  assert.equal(plays(), before + 1, "and not again when it ends");
});

test("a sudden noise or a human voice wakes someone resting, but not someone walking", async () => {
  reset();
  const p = A.completion(A.begin("rest", { seconds: 30 }, { intent: "rest", source: "brain" }).id);
  await run(20); assert.equal(w.me.sleeping, true);
  humanCommand(rt, { t: "say", text: "hello" });
  await run(5, () => A.cur === null);
  const out = await p;
  assert.equal(out.data?.interrupted, "noise"); assert.equal(w.me.sleeping, false);
  const g = reset();
  known(w.spawn("tree", "oak", g.x + 12, g.z, { yields: ["stick"], stock: 5, max: 5 }));
  A.begin("gather", { what: "stick", quantity: 1 }, { intent: "gather", source: "brain" });
  await run(5); humanCommand(rt, { t: "say", text: "hello again" }); await run(5);
  assert.equal(A.cur?.def, "gather", "walking is not interrupted by being spoken to");
});
