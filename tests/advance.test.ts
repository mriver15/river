import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-advtest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";
process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { catchUp, targetFor } = await import("../src/server/advance.ts");
const { bodyApi } = await import("../src/server/body.ts");
const { db } = await import("../src/server/db.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, A = rt.advancer, agent = rt.agent;
const thaw = () => { if (sim.simPaused()) sim.setSimPaused(false); };

test("advancing to dawn runs the ticks, ends at dawn, and leaves the calendar where it was", async () => {
  const epoch = w.epoch, day0 = w.day(), t0 = sim.simTick(), want = targetFor(rt, { kind: "dawn" });
  const r = await A.run({ until: { kind: "dawn" }, decision: "defer" });
  assert.equal(r.reason, "target"); assert.equal(sim.simTick(), want); assert.equal(r.ticks, want - t0);
  const f = w.worldTime(); assert.ok(f >= 0.25 && f < 0.26, `it is dawn (${f})`);
  assert.equal(w.epoch, epoch, "the calendar origin did not move: no day was rewritten");
  assert.ok(w.day() >= day0, "the day index only moves forward"); assert.ok(r.summary.simSeconds > 0 && r.summary.toDay >= r.summary.fromDay);
  const again = targetFor(rt, { kind: "dawn" }); assert.ok(again - sim.simTick() > 14000, "the next dawn is a full day away, not now");
});

test("a cancel is heard within one batch, and what ran is kept", async () => {
  let asked = false;
  A.onProgress = (p) => { if (p && !asked) { asked = true; A.cancel(); } };
  const r = await A.run({ until: { kind: "ticks", ticks: 5000 }, decision: "defer", batch: 50 });
  A.onProgress = () => {};
  assert.equal(r.reason, "cancelled"); assert.ok(r.ticks >= 50 && r.ticks <= 100, `${r.ticks}`);
  assert.equal(A.current, null, "nothing is left running");
  const next = await A.run({ until: { kind: "ticks", ticks: 10 }, decision: "defer" }); assert.equal(next.reason, "target", "and a new one can start");
});

test("a frozen world cannot be advanced, and does not move", async () => {
  sim.setSimPaused(true);
  const t = sim.simTick(), r = await A.run({ until: { kind: "ticks", ticks: 100 } });
  assert.equal(r.reason, "frozen"); assert.equal(sim.simTick(), t); thaw();
});

test("an advance stops at death, at the tick it happens", async () => {
  thaw();
  const t0 = sim.simTick(), hit = A.onProgress;
  let done = false;
  A.onProgress = (p) => { if (p && !done) { done = true; setConfig("lethal", true); bodyApi.wound("claw", "chest", 1, 10, "a test", false, 500); } };
  const r = await A.run({ until: { kind: "ticks", ticks: 3000 }, batch: 40, decision: "defer" });
  A.onProgress = hit;
  assert.equal(r.reason, "death"); assert.ok(r.ticks < 3000 && r.ticks >= 40); assert.equal(r.summary.deaths, 1);
  const again = await A.run({ until: { kind: "ticks", ticks: 100 } }); assert.equal(again.reason, "death", "it does not carry on past a death");
  const onward = await A.run({ until: { kind: "ticks", ticks: 20 }, stopOnDeath: false, decision: "defer" }); assert.equal(onward.reason, "target", "unless told to");
  assert.ok(t0 < sim.simTick());
});

test("an urgent decision stops an advance, a deferred one is counted, and a standing one does not block a new advance", async () => {
  // (River is dead from the test above; the decision logic does not depend on it)
  let fired = false;
  A.onProgress = (p) => { if (p && !fired) { fired = true; agent.raise("danger", "something is wrong", "t-danger"); } };
  const stopped = await A.run({ until: { kind: "ticks", ticks: 2000 }, batch: 20, stopOnDeath: false, decision: "stop" });
  A.onProgress = () => {};
  assert.equal(stopped.reason, "decision"); assert.ok(stopped.ticks < 2000);
  agent.queue.clear(); fired = false;
  A.onProgress = (p) => { if (p && !fired) { fired = true; agent.raise("danger", "again", "t-danger2"); } };
  const deferred = await A.run({ until: { kind: "ticks", ticks: 200 }, batch: 20, stopOnDeath: false, decision: "defer" });
  A.onProgress = () => {};
  assert.equal(deferred.reason, "target"); assert.equal(deferred.summary.decisions.raised.danger, 1, "the decision it met is reported");
  agent.queue.clear();
  agent.raise("danger", "already waiting", "t-standing");
  const go = await A.run({ until: { kind: "ticks", ticks: 60 }, batch: 20, stopOnDeath: false, decision: "stop" });
  assert.equal(go.reason, "target", "what was already waiting when it began is not a reason to stop");
  agent.queue.clear();
});

test("work budgets bound an advance", async () => {
  const r = await A.run({ until: { kind: "ticks", ticks: 100000 }, maxTicks: 300, batch: 100, stopOnDeath: false, decision: "defer" });
  assert.equal(r.reason, "budget"); assert.equal(r.ticks, 300);
  const t = await A.run({ until: { kind: "ticks", ticks: 100000 }, maxWallMs: 1, batch: 50, stopOnDeath: false, decision: "defer" });
  assert.equal(t.reason, "budget"); assert.ok(t.ticks < 1000);
});

test("changing the speed does not move any day: days come from ticks, not from the clock rate", async () => {
  const tick = sim.simTick(), day = w.day(), when = sim.simNow();
  const row = db.prepare("INSERT INTO events(ts, kind, text) VALUES(?,?,?)").run(when, "system", "marker");
  sim.setSimSpeed(37); assert.equal(w.day(), day); assert.equal(sim.simNow(), when);
  sim.setSimSpeed(1); assert.equal(w.day(), day); assert.equal(sim.simTick(), tick);
  assert.equal((db.prepare("SELECT ts FROM events WHERE id = ?").get(Number(row.lastInsertRowid)) as { ts: number }).ts, when, "the journal keeps the time it was written at");
  const r = await A.run({ until: { kind: "ticks", ticks: 100 }, stopOnDeath: false, decision: "defer" });
  assert.equal(sim.simNow(), when + r.ticks * sim.STEP_MS, "simulation time is ticks times the step, whatever the speed was");
});

test("an absence is converted at the speed the world was running, bounded, with the remainder reported", async () => {
  const day = 14_400;
  bodyApi.reset(); sim.runTicks(2);                                                  // River lives again (the death test above)
  Object.assign(sim.lastCommit, { wall: 1_000_000, speed: 2, paused: false });
  assert.equal(await catchUp(A, 1_000_000 + 30_000), null, "off by default: the world waits");
  setConfig("offlineCatchup", true); setConfig("catchupMaxDays", 1);
  assert.equal(await catchUp(A, 1_000_000 + 30_000), null, "a short restart is not an absence");
  const t0 = sim.simTick();
  const c = (await catchUp(A, 1_000_000 + 60_000 * 3))!;                           // 3 minutes away at 2x = 6 sim minutes = 3600 ticks
  assert.equal(c.ticksOwed, 3600); assert.equal(c.ticksRun, 3600); assert.equal(sim.simTick() - t0, 3600); assert.equal(c.deferredWallMs, 0);
  const t1 = sim.simTick();
  const long = (await catchUp(A, 1_000_000 + 60_000 * 60 * 24 * 3))!;              // three days away, one day allowed
  assert.equal(long.ticksRun, day, `one world day, no more (${long.ticksRun})`);
  assert.ok(long.ticksOwed > 4 * day, "it was owed far more"); assert.ok(long.deferredWallMs > 0, "and the rest is reported as not simulated");
  assert.equal(sim.simTick() - t1, day);
  Object.assign(sim.lastCommit, { paused: true });
  assert.equal(await catchUp(A, 1_000_000 + 60_000 * 600), null, "a world that was frozen stays frozen");
  setConfig("offlineCatchup", false);
});

test("the advance leaves a record: a summary of what happened, and the decisions it met", async () => {
  const r = await A.run({ until: { kind: "ticks", ticks: 600 }, stopOnDeath: false, decision: "defer" });
  assert.equal(r.summary.toTick - r.summary.fromTick, 600);
  assert.ok(Object.keys(r.summary.needs.after).length >= 4);
  assert.ok(typeof r.summary.decisions.taken === "number" && Array.isArray(r.summary.moments));
});

test("advancing is the same as stepping: every checkpoint hash matches an ordinary run, to a tick count and to dawn", { timeout: 300_000 }, () => {
  const base = path.join(dir, "eq-base.db");
  assert.equal(spawnSync(process.execPath, ["--import", "tsx", "scripts/ff-equivalence.ts", "prepare", "0", base], { encoding: "utf8" }).status, 0);
  const run = (mode: string, n: number) => {
    const file = path.join(dir, `eq-${mode}-${n}-${Date.now()}.db`); fs.copyFileSync(base, file);        // the same island and the same calendar for every run
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/ff-equivalence.ts", mode, String(n), file], { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr.slice(-400));
    return JSON.parse(r.stdout.slice(r.stdout.lastIndexOf('{"mode"')));
  };
  const a = run("advance", 3000), s = run("step", 3000);
  const common = Object.keys(a.checkpoints).filter((t) => t in s.checkpoints);
  assert.ok(common.length >= 8, `${common.length} checkpoints compared`);
  for (const t of common) assert.equal(a.checkpoints[t], s.checkpoints[t], `state differs at tick ${t}`);
  const d = run("dawn", 0), ds = run("step", d.target);
  assert.equal(d.endTick, d.target);
  for (const t of Object.keys(d.checkpoints).filter((t) => t in ds.checkpoints)) assert.equal(d.checkpoints[t], ds.checkpoints[t], `state differs at tick ${t} on the way to dawn`);
  assert.ok(d.worldTime >= 0.25 && d.worldTime < 0.26);
});
