import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-buildtest-")), "t.db");
process.env.MOCK_LLM = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { db } = await import("../src/server/db.ts");
const { findTool } = await import("../src/server/tools.ts");
const { bodyApi } = await import("../src/server/body.ts");
const { isLand } = await import("../src/shared/noise.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, R = w.items, A = rt.activities;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number, until?: () => boolean) { for (let i = 0; i < ticks && !until?.(); i++) { sim.runTicks(1); await drain(); } }
const build = (args: object) => { db.prepare("INSERT INTO tools(name, approved) VALUES('build', 1) ON CONFLICT(name) DO UPDATE SET approved = 1").run(); return Promise.resolve(findTool("build")!.run(args, w)); };
const have = (kind: string) => R.carried().filter((i) => i.kind === kind).reduce((a, i) => a + i.qty, 0);
const structures = () => [...w.entities.values()].filter((e) => e.kind === "structure");

/** open ground with room to build in front of River */
function ground() {
  for (let x = -30; x < 30; x += 3) for (let z = -30; z < 30; z += 3) {
    let ok = true; for (let dx = -4; dx <= 8 && ok; dx += 2) for (let dz = -4; dz <= 4 && ok; dz += 2) if (!isLand(x + dx, z + dz, w.seed)) ok = false;
    if (ok) return { x, z };
  }
  throw new Error("no ground");
}
function fresh(sticks: number, stones = 0) {
  A.cancel("test"); bodyApi.reset(); sim.runTicks(2);
  for (const e of [...w.entities.values()]) w.removeEntity(e.id);
  for (const i of R.carried()) R.take(i.id, i.qty);
  const g = ground(); w.me.x = g.x; w.me.z = g.z; w.me.heading = 0; w.me.sleeping = false; w.walk = null;
  if (sticks) w.addItem("stick", "stick", "A stick.", sticks); if (stones) w.addItem("stone", "stone", "A stone.", stones);
  return g;
}

test("a build is spent stage by stage: nothing before a stage is done, and what is spent shows in what stands", async () => {
  fresh(3);
  const done = build({ shape: "bench", materials: { stick: 3 }, where: { x: w.me.x + 3, z: w.me.z }, name: "resting bench" });
  await run(10);
  assert.equal(have("stick"), 3, "nothing is spent while the first stage is under way"); assert.equal(structures().length, 0, "and nothing stands yet");
  await run(20, () => structures().length > 0);
  const e = structures()[0]!;
  assert.equal(e.props.unfinished, true); assert.equal(e.props.progress, 1 / 3); assert.deepEqual(e.props.materials, { stick: 1 }, "it holds exactly what has been put in");
  assert.equal(have("stick"), 2); assert.equal(e.props.shelter, false); assert.equal(e.props.walk, false);
  await run(200, () => A.cur === null);
  assert.match(await done, /You build "resting bench"/);
  const f = w.entities.get(e.id)!;
  assert.equal(f.props.unfinished, undefined); assert.deepEqual(f.props.materials, { stick: 3 }); assert.equal(have("stick"), 0, "exactly what the plan said, no more");
  assert.equal(structures().length, 1, "one structure, the same one");
});

test("stopped half way, what stands is unfinished and holds what was spent; continuing finishes it for exactly the rest", async () => {
  const g = fresh(6);
  const done = build({ shape: "bench", size: "medium", materials: { stick: 6 }, where: { x: g.x + 3, z: g.z }, name: "long bench" }).catch((e) => e);
  await run(200, () => structures().length > 0);
  const id = structures()[0]!.id, spentSoFar = 6 - have("stick");
  assert.ok(spentSoFar >= 1 && spentSoFar < 6);
  A.cancel("changed my mind");                                           // stopped after the first stage
  const err = await done;
  assert.ok(err instanceof Error);
  const e = w.entities.get(id)!;
  assert.equal(e.props.unfinished, true); assert.equal(Object.values(e.props.materials as Record<string, number>).reduce((a, b) => a + b, 0), spentSoFar, "it holds exactly what was spent");
  assert.equal(have("stick"), 6 - spentSoFar, "and the rest is still River's");
  await assert.rejects(() => build({ action: "continue", target: "no such" }), /nothing you built/);
  const held = R.carried().find((i) => i.kind === "stick")!; R.drop(held.id, held.qty);             // put the rest down: cannot finish without it
  await assert.rejects(() => build({ action: "continue", target: id }), /still need/);
  R.pickUp(held.id);
  const fin = build({ action: "continue", target: id });
  await run(400, () => A.cur === null);
  assert.match(await fin, /You build/);
  const f = w.entities.get(id)!;
  assert.equal(f.props.unfinished, undefined); assert.equal(Object.values(f.props.materials as Record<string, number>).reduce((a, b) => a + b, 0), 6, "six in all: not one more, not one fewer");
  assert.equal(have("stick"), 0);
});

test("danger stops the work between stages and the unfinished structure is left standing", async () => {
  const g = fresh(6);
  const done = build({ shape: "bench", size: "medium", materials: { stick: 6 }, where: { x: g.x + 3, z: g.z } }).catch((e) => e);
  await run(200, () => structures().length > 0);
  w.spawn("tree", "burning oak", w.me.x + 2, w.me.z, { burning: { since: sim.simNow(), ends: sim.simNow() + 90_000 } });
  await run(40, () => A.cur === null);
  const err = await done; assert.ok(err instanceof Error); assert.match(err.message, /fire is close/);
  const e = structures().find((x) => x.props.unfinished)!; assert.ok(e, "left unfinished");
  assert.equal(have("stick") + Object.values(e.props.materials as Record<string, number>).reduce((a, b) => a + b, 0), 6, "every stick is accounted for");
});

test("an unfinished structure returns most of what is in it; a finished one less; neither more than went in", async () => {
  const g = fresh(0);
  w.spawn("structure", "scaffold", g.x + 2, g.z, { shape: "tower", size: "small", unfinished: true, progress: 2 / 3, materials: { stick: 6 }, materialKinds: { stick: "stick" }, builtBy: "River", radius: 1.2, colors: {}, colorNames: {} });
  const sid = structures()[0]!.id;
  assert.match(await build({ action: "take_down", target: sid }), /unfinished, apart/);
  assert.equal(have("stick"), 5, "85% of 6, rounded down");
  fresh(0);
  const s2 = w.spawn("structure", "tower", w.me.x + 2, w.me.z, { shape: "tower", size: "small", materials: { stick: 10 }, materialKinds: { stick: "stick" }, builtBy: "River", radius: 1.2, colors: {}, colorNames: {} });
  await build({ action: "take_down", target: s2.id });
  assert.equal(have("stick"), 6, "60% of 10");
  assert.deepEqual(R.audit(), []);
});

test("a burnt structure gives back what survived the fire, and only a little ash for the wood", async () => {
  const g = fresh(0);
  const e = w.spawn("structure", "stone hut", g.x + 2, g.z, { shape: "hut", size: "small", materials: { stick: 6, stone: 3 }, materialKinds: { stick: "stick", stone: "stone" }, builtBy: "River", radius: 1.6, flammable: true, colors: {}, colorNames: {}, burning: { since: sim.simNow(), ends: sim.simNow() + 500 } });
  await run(100, () => w.entities.get(e.id)?.kind === "char");
  const ch = w.entities.get(e.id)!; assert.equal(ch.kind, "char"); assert.deepEqual(ch.props.wasMaterials, { stick: 6, stone: 3 });
  const out = await build({ action: "take_down", target: e.id });
  assert.equal(have("stick"), 0, "the wood is gone"); assert.equal(have("stone"), 1, "60% of the stone survives");
  const ash = R.carried().find((i) => i.kind === "charcoal")!; assert.ok(ash && R.massOf(ash) <= 6 * 0.25 * 0.2 + 1e-9, "ash weighs at most a fifth of the wood that burned");
  assert.match(out, /burnt remains/); assert.ok(!w.entities.has(e.id));
  assert.deepEqual(R.audit(), []);
});

const { weatherStructures } = await import("../src/server/building.ts");
const mk = (name: string, mats: Record<string, number>, extra: object = {}) => {
  const kinds = Object.fromEntries(Object.keys(mats).map((n) => [n, n]));
  return w.spawn("structure", name, w.me.x + 2, w.me.z, { shape: "bench", size: "small", materials: mats, materialKinds: kinds, builtBy: "River", radius: 0.8, colors: {}, colorNames: {}, ...extra });
};

test("rain wears wooden structures down; stone and dry weather do not", () => {
  fresh(0);
  const wood = mk("wooden bench", { stick: 6 }), rock = mk("stone cairn", { stone: 6 });
  w.weather = "clear"; for (let n = 0; n < 200; n++) weatherStructures(w, 5);
  assert.equal(w.entities.get(wood.id)!.props.integrity, undefined, "dry weather does nothing");
  w.weather = "rain"; for (let n = 0; n < 200; n++) weatherStructures(w, 5);
  const i = w.entities.get(wood.id)!.props.integrity;
  assert.ok(i < 0.95 && i > 0.8, `wood after 1000 s of rain: ${i}`); assert.equal(w.entities.get(rock.id)!.props.integrity, undefined, "stone is untouched");
  w.weather = "storm"; for (let n = 0; n < 200; n++) weatherStructures(w, 5);
  assert.ok(w.entities.get(wood.id)!.props.integrity < i - 0.1, "a storm wears faster");
  w.weather = "clear";
});

test("mending restores soundness by exactly what was put in, and a sound structure needs none", async () => {
  fresh(5);
  const e = mk("old bench", { stick: 6 }, { integrity: 0.5 });
  await build({ action: "repair", target: e.id, materials: { stick: 3 } });
  assert.equal(w.entities.get(e.id)!.props.integrity, 0.86, "three sticks, 0.12 each"); assert.equal(have("stick"), 2);
  await assert.rejects(() => build({ action: "repair", target: mk("sound bench", { stick: 6 }).id, materials: { stick: 1 } }), /sound/);
  await assert.rejects(() => build({ action: "repair", target: e.id, materials: { stone: 1 } }), /aren't carrying|won't mend/);
});

test("a structure worn through falls down into part of what it was, and no more", () => {
  fresh(0);
  const e = mk("tired shelter", { stick: 7, clay: 3 }, { integrity: 0.0002 });
  const total = (kind: string) => R.all().filter((i) => i.kind === kind && i.loc.kind === "world").reduce((s, i) => s + i.qty, 0);
  const sticks0 = total("stick"), clay0 = total("clay");
  w.weather = "storm"; weatherStructures(w, 5); w.weather = "clear";
  assert.ok(!w.entities.has(e.id), "it fell");
  assert.ok(total("stick") - sticks0 <= Math.floor(7 * 0.4) && total("stick") - sticks0 >= 1, "some of the sticks lie where it stood");
  assert.ok(total("clay") - clay0 <= 1, "and no more than 40% of anything");
  assert.deepEqual(R.audit(), []);
});

test("what comes back from taking a weathered structure apart is less", async () => {
  fresh(0);
  const e = mk("weathered tower", { stick: 10 }, { integrity: 0.5 });
  await build({ action: "take_down", target: e.id });
  assert.equal(have("stick"), 3, "60% of 10, halved by the weathering: 3");
});
