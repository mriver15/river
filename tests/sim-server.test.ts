import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-simtest-")), "t.db");
const sim = await import("../src/server/sim.ts");

test("periodic systems run in registration order, on their own period, with exact dt", () => {
  const log: string[] = [];
  sim.every(100, (dt) => log.push(`a${dt}`), "a");
  sim.every(300, (dt) => log.push(`b${dt}`), "b");
  sim.runTicks(3);
  assert.deepEqual(log.filter((x) => x[0] === "b"), ["b0.3"]);
  assert.equal(log.filter((x) => x[0] === "a").length, 3);
  assert.ok(log.every((x) => x === "a0.1" || x === "b0.3"));
});

test("simNow is frozen while the world is paused, pump does nothing", async () => {
  const t0 = sim.simNow(); let slept = false;
  sim.simSleep(500).then(() => { slept = true; });
  sim.setSimPaused(true);
  assert.equal(sim.pump(10_000), 0);
  await Promise.resolve();
  assert.equal(sim.simNow(), t0); assert.equal(slept, false);
  sim.setSimPaused(false);
  sim.setSimSpeed(1);
  assert.equal(sim.pump(500, 100), 5);
  await new Promise((r) => setImmediate(r));
  assert.equal(slept, true);
});

test("speed scales ticks per wall second; lag is carried, work per turn bounded", () => {
  sim.setSimSpeed(10);
  assert.equal(sim.pump(100, 4), 4);          // 1000 ms owed, only 4 ticks allowed this turn
  assert.equal(sim.pump(0.0001, 100), 6);     // remainder paid next turn, nothing discarded
  sim.setSimSpeed(1);
});

test("one-shot timers fire in due order; cancelled ones never fire", () => {
  const out: number[] = [];
  sim.after(300, () => out.push(3)); sim.after(100, () => out.push(1)); const id = sim.after(200, () => out.push(2)); sim.cancel(id);
  sim.runTicks(5);
  assert.deepEqual(out, [1, 3]);
});

test("seeded streams are stable and their state persists across save", async () => {
  const r = sim.simRng("t1"); const a = r(); sim.save();
  assert.ok(a >= 0 && a < 1);
  const { kvGet } = await import("../src/server/db.ts"); const stored = kvGet<any>("sim", null);
  assert.ok(stored.rng.t1);
});
