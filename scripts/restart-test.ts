// Restart-midway test: an activity that is interrupted by a process restart must resume and finish exactly as it would have.
//   tsx scripts/restart-test.ts
// A runs a gather errand to the end. Partway through, A copies its database. B boots a fresh process on the copy, resumes the
// errand, and runs to the same tick. The physical state must match.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [mode, snapFile, endTickArg] = process.argv.slice(2);
/** Print the result and wait for it to flush: it is large, and exiting straight away truncates a pipe. */
const emit = (o: unknown) => new Promise<void>((res) => process.stdout.write("RESULT " + JSON.stringify(o) + "\n", () => res()));

async function setup() {
  const { setConfig } = await import("../src/server/config.ts");
  // "alive" leaves the whole world running (weather, ambient events, wildlife, predators); the others isolate the activity machinery
  if (process.env.RT_SCENARIO !== "alive") for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
  const sim = await import("../src/server/sim.ts");
  const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
  const rt = await createRuntime(); startSystems(rt);
  const drain = () => new Promise<void>((r) => setImmediate(r));
  const run = async (n: number, until?: () => boolean) => { for (let i = 0; i < n && !until?.(); i++) { sim.runTicks(1); await drain(); } };
  return { sim, rt, run };
}
const parts = async (rt: any) => {
  const { stateParts } = await import("../src/server/recorder.ts");
  const p = stateParts(rt.world);
  const { db } = await import("../src/server/db.ts");
  const detail = { trees: [...rt.world.entities.values()].filter((e: any) => e.kind === "tree").map((e: any) => ({ id: e.id, stock: e.props.stock, reserved: e.props.reserved, lastTake: e.props.lastTake })), act: db.prepare("SELECT id,status,step,progress,started_tick,deadline_tick,reservations,outcome,ended_tick FROM sim_activities").all(), me: rt.world.me, emo: (rt.emotions as any).snapshot(), inv: [...rt.world.inventory.values()].map((i: any) => `${i.name}x${i.qty}`), ents: [...rt.world.entities.values()].sort((a: any, b: any) => (a.id < b.id ? -1 : 1)), known: db.prepare("SELECT * FROM known_entities ORDER BY id").all(), itemRows: db.prepare("SELECT * FROM item_instances ORDER BY id").all() };
  return { ...p, _detail: JSON.stringify(detail) };
};

if (mode === "A" && process.env.RT_SCENARIO === "items") {
  // a run of handling things: pick up, split, put down, stow, wear, make; then copy the database and carry on
  const { sim, rt, run } = await setup();
  const w = rt.world, R = w.items, { db } = await import("../src/server/db.ts");
  w.ensureMaterials();
  const e = w.spawn("item", "river glass", w.me.x + 1, w.me.z, { takeable: true, item: "bottle", itemName: "river glass", desc: "A bottle." });
  const sticks = w.addItem("stick", "stick", "A stick.", 6), stone = w.addItem("stone", "stone", "A stone.", 2), bark = w.addItem("bark", "strip of bark", "Bark.", 6);
  R.pickUp(e.id); const part = R.drop(sticks.id, 2); R.pickUp(part.id);
  const basket = w.addItem("crafted", "basket", "A basket.", 1, undefined, { defId: "basket" }); R.stow(R.carried().find((i) => i.kind === "bark")!.id, 3, basket.id);
  const hat = w.addItem("garment", "reed hat", "A hat.", 1, { garment: "hat", slot: "head", hex: "#aa8844", warm: 0.1 }); R.equip(hat.id, "head");
  const { craftNow } = await import("../src/server/crafting.ts"), { recipeById } = await import("../src/content/recipes.ts");
  craftNow(w, recipeById("sharpen_stick")!); craftNow(w, recipeById("cord")!);
  R.drop(stone.id, 1);
  await run(Number(process.env.RT_CUT ?? 50));
  sim.save(); fs.rmSync(snapFile!, { force: true }); db.prepare("VACUUM INTO ?").run(snapFile!);
  await run(Number(process.env.RT_LEN ?? 200));
  await emit({ midway: { phase: `${R.all().length} live items, audit ${R.audit().length === 0 ? "clean" : "DIRTY: " + R.audit().join("; ")}`, got: 0, running: false }, endTick: sim.simTick(), outcome: null, parts: await parts(rt), audit: R.audit() });
} else if (mode === "A" && process.env.RT_SCENARIO === "alive") {
  const { sim, rt, run } = await setup();
  await run(Number(process.env.RT_CUT ?? 3000));
  sim.save();
  const { db } = await import("../src/server/db.ts");
  fs.rmSync(snapFile!, { force: true }); db.prepare("VACUUM INTO ?").run(snapFile!);
  const atCut = await parts(rt), evBefore = (db.prepare("SELECT COUNT(*) n FROM events").get() as any).n;
  await run(Number(process.env.RT_LEN ?? 3000));
  const end = await parts(rt), moved = Object.keys(end).filter((k) => k[0] !== "_" && end[k] !== atCut[k]);
  await emit({ midway: { phase: `alive; ${(db.prepare("SELECT COUNT(*) n FROM events").get() as any).n - evBefore} events and changes in [${moved.join(" ")}] after the copy`, got: 0 }, endTick: sim.simTick(), outcome: null, parts: end });
} else if (mode === "A") {
  const { sim, rt, run } = await setup();
  const { isLand } = await import("../src/shared/noise.ts");
  const w = rt.world; let g = { x: 0, z: 0 };
  outer: for (let x = -40; x < 40; x += 2) for (let z = -40; z < 40; z += 2) { let ok = true; for (let d = 0; d <= 30 && ok; d++) if (!isLand(x + d, z, w.seed)) ok = false; if (ok) { g = { x, z }; break outer; } }
  for (const e of [...w.entities.values()]) w.removeEntity(e.id);
  w.me.x = g.x; w.me.z = g.z;
  for (const [i, dx] of [14, 20].entries()) rt.knowledge.learn(w.spawn("tree", `oak ${i}`, g.x + dx, g.z + i * 3, { yields: ["stick"], stock: 2, max: 2 }));
  w.ensureMaterials();                                         // the idempotent top-up a boot performs, so the copy needs nothing the original lacked
  const scenario = process.env.RT_SCENARIO ?? "gather", cut = Number(process.env.RT_CUT ?? 100);
  let act: any;
  if (scenario === "build") {
    const { db: d } = await import("../src/server/db.ts"), { findTool } = await import("../src/server/tools.ts"), { isLand } = await import("../src/shared/noise.ts");
    d.prepare("INSERT INTO tools(name, approved) VALUES('build', 1) ON CONFLICT(name) DO UPDATE SET approved = 1").run();
    for (const e of [...w.entities.values()]) w.removeEntity(e.id);
    let g = { x: 0, z: 0 }; outer2: for (let x = -30; x < 30; x += 3) for (let z = -30; z < 30; z += 3) { let ok = true; for (let dx = -4; dx <= 8 && ok; dx += 2) for (let dz = -4; dz <= 4 && ok; dz += 2) if (!isLand(x + dx, z + dz, w.seed)) ok = false; if (ok) { g = { x, z }; break outer2; } }
    w.ensureMaterials();                                       // the top-up a boot performs, so the copy needs nothing the original lacked
    w.me.x = g.x; w.me.z = g.z; w.addItem("stick", "stick", "A stick.", 6);
    void findTool("build")!.run({ shape: "bench", size: "medium", materials: { stick: 6 }, where: { x: g.x + 3, z: g.z }, name: "restart bench" }, w);
    await new Promise<void>((r) => setImmediate(r));
    act = rt.activities.cur;
  } else if (scenario === "craft" || scenario === "perform") {
    const { db: d } = await import("../src/server/db.ts"), { findTool } = await import("../src/server/tools.ts");
    for (const g of ["craft", "compose"]) d.prepare("INSERT INTO tools(name, approved) VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET approved = 1").run(g);
    if (scenario === "craft") { w.addItem("stick", "stick", "A stick.", 3); void findTool("craft")!.run({ ingredients: ["stick", "stick"], name: "frame", description: "A small frame." }, w); }
    else void findTool("compose")!.run({ action: "write", title: "Restart Tune", tempo: 120, voices: [{ instrument: "chimes", notes: "A4 C5 E5 A5 G5 E5 C5 A4" }] }, w)?.then?.(() => {}, (e: any) => console.error("compose failed:", e.message));
    await new Promise<void>((r) => setImmediate(r));              // an async tool reaches its gate a microtask later
    act = rt.activities.cur;
  } else act = scenario === "rest" ? rt.activities.begin("rest", { seconds: 20 }, { intent: "rest", source: "brain" })
    : rt.activities.begin("gather", { what: "stick", quantity: 3, returnToStart: true }, { intent: "gather", source: "brain" });
  await run(cut);                                              // partway
  const running = rt.activities.cur !== null;
  const phase = (running ? (act.progress.phase ?? act.def) : "already finished"), got = act.progress.got ?? 0;
  sim.save();
  const { db } = await import("../src/server/db.ts");
  fs.rmSync(snapFile!, { force: true }); db.prepare("VACUUM INTO ?").run(snapFile!);
  await run(5000, () => rt.activities.cur === null);
  await run(20);
  await emit({ midway: { phase, got, running }, endTick: sim.simTick(), outcome: act.outcome, parts: await parts(rt) });
} else if (mode === "B") {
  const { sim, rt, run } = await setup();
  const resumed = rt.activities.cur?.id ?? null, phase = rt.activities.cur?.progress?.phase ?? null;
  await run(Number(endTickArg) - sim.simTick());
  await emit({ resumed, phase, endTick: sim.simTick(), outcome: null, audit: rt.world.items.audit(), parts: await parts(rt), rows: (await import("../src/server/db.ts")).db.prepare("SELECT id,status,progress,outcome FROM sim_activities").all(), ev: (await import("../src/server/db.ts")).db.prepare("SELECT kind,text FROM events ORDER BY id DESC LIMIT 4").all(), cur: rt.activities.cur ? { def: rt.activities.cur.def, progress: rt.activities.cur.progress, deadline: rt.activities.cur.deadlineTick } : null });
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-restart-")), snap = path.join(dir, "snap.db");
  const call = (m: string, db: string, env: Record<string, string>, ...a: string[]) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/restart-test.ts", m, snap, ...a], { env: { ...process.env, RIVER_DB: db, MOCK_LLM: "1", ...env }, encoding: "utf8", maxBuffer: 1 << 28 });
    const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT ")); if (!line) { console.error(r.stdout.slice(-800), r.stderr.slice(-800)); process.exit(1); }
    return JSON.parse(line.slice(7));
  };
  let failed = 0;
  const only = process.env.RT_ONLY;
  for (const [scenario, cut] of (only === "alive" ? [["alive", 1500], ["alive", 4500], ["alive", 9000]] : [["gather", 5], ["gather", 40], ["gather", 100], ["gather", 130], ["gather", 185], ["rest", 30], ["rest", 120], ["craft", 12], ["craft", 25], ["perform", 15], ["perform", 40], ["build", 30], ["build", 90], ["items", 50], ["alive", 3000]]) as [string, number][]) {
    const A = call("A", path.join(dir, `a-${scenario}-${cut}.db`), { RT_SCENARIO: scenario, RT_CUT: String(cut), RT_LEN: process.env.RT_LEN ?? "4000" });
    const B = call("B", snap, { RT_SCENARIO: scenario }, String(A.endTick));
    const bad = Object.keys(A.parts).filter((k) => k[0] !== "_" && A.parts[k] !== B.parts[k]);
    const ok = (scenario === "alive" || scenario === "items" || !A.midway.running || !!B.resumed) && !bad.length && !(A.audit?.length) && !(B.audit?.length);
    if (!ok) console.error("B rows:", JSON.stringify(B.rows), "\nB events:", JSON.stringify(B.ev));
    if (bad.length) {
      const a = JSON.parse(A.parts._detail), b = JSON.parse(B.parts._detail);
      if (bad.includes("emotions")) for (const k of Object.keys(a.emo)) if (JSON.stringify(a.emo[k]) !== JSON.stringify(b.emo[k])) console.error("emotions." + k, "\n A", JSON.stringify(a.emo[k]).slice(0, 300), "\n B", JSON.stringify(b.emo[k]).slice(0, 300));
      if (bad.includes("t_item_instances")) {
        const ia = new Map(a.itemRows.map((r: any) => [r.id, JSON.stringify(r)])), ib = new Map(b.itemRows.map((r: any) => [r.id, JSON.stringify(r)]));
        for (const [id, v] of ia) if (ib.get(id) !== v) console.error("item row differs", id, "\n A", v, "\n B", ib.get(id));
        for (const id of ib.keys()) if (!ia.has(id)) console.error("item row only in B", id);
      }
      if (bad.includes("me")) console.error("me A", JSON.stringify(a.me), "\nme B", JSON.stringify(b.me));
      const ea = new Map(a.ents.map((e: any) => [e.id, JSON.stringify(e)])), eb = new Map(b.ents.map((e: any) => [e.id, JSON.stringify(e)]));
      let shown = 0; for (const [id, v] of ea) if (eb.get(id) !== v && shown++ < 3) console.error("entity differs", id, "\n A", v, "\n B", eb.get(id));
    }
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${scenario.padEnd(6)} restarted at tick ${cut} (${A.midway.phase}${A.midway.got ? `, ${A.midway.got} gathered` : ""}); finished tick ${A.endTick} ${ok ? "identically" : "differing: " + (bad.join(", ") || "not resumed")}`);
  }
  process.exit(failed ? 1 : 0);
}
process.exit(0);
