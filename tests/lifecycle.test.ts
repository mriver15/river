import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-lifetest-")), "t.db");
process.env.MOCK_LLM = "1";
const { db } = await import("../src/server/db.ts");
const { admit, finishCommand, recoverCommands } = await import("../src/server/recorder.ts");
const { lifeGen, beginGeneration, isStale, discardedTotal } = await import("../src/server/lifecycle.ts");
const { createRuntime } = await import("../src/server/runtime.ts");
const sim = await import("../src/server/sim.ts");

test("a command id is admitted once; a repeat returns the original outcome", () => {
  const a = admit("human", "gift", { name: "pebble" }, "cid-1");
  assert.equal(a.duplicate, false);
  if (!a.duplicate) finishCommand(a.seq, "ok", "placed");
  const b = admit("human", "gift", { name: "pebble" }, "cid-1");
  assert.deepEqual(b.duplicate && { s: b.status, r: b.result }, { s: "ok", r: "placed" });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sim_commands WHERE command_id='cid-1'").get() as any).n, 1);
});

test("commands without an id are never treated as duplicates", () => {
  assert.equal(admit("human", "say", { text: "a" }).duplicate, false);
  assert.equal(admit("human", "say", { text: "a" }).duplicate, false);
});

test("after a restart, what was running is marked interrupted", () => {
  const a = admit("brain", "tool", { name: "look" }, "cid-run");
  assert.equal(a.duplicate, false);
  assert.ok(recoverCommands() >= 1);
  const row = db.prepare("SELECT status FROM sim_commands WHERE command_id='cid-run'").get() as any;
  assert.equal(row.status, "interrupted");
});

test("generations: a new life makes earlier work stale", () => {
  const g = lifeGen(); assert.equal(isStale(g), false);
  beginGeneration(); assert.equal(isStale(g), true); assert.equal(isStale(lifeGen()), false);
});

test("a tool call from a previous life changes nothing and is journaled nowhere", async () => {
  const rt = await createRuntime();
  const old = lifeGen(); beginGeneration();
  const before = discardedTotal(), rows = (db.prepare("SELECT COUNT(*) n FROM sim_commands").get() as any).n, act = rt.world.me.activity;
  const out = await rt.agent.exec("rest", { seconds: 30 }, old, `${old}:call_1`);
  assert.equal(out.is_error, true);
  assert.equal(discardedTotal(), before + 1);
  assert.equal(rt.world.me.sleeping, false); assert.equal(rt.world.me.activity, act);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sim_commands").get() as any).n, rows);
});

test("a repeated tool call id is not run twice", async () => {
  const rt = await createRuntime();
  const g = lifeGen();
  const first = await rt.agent.exec("look", {}, g, `${g}:call_dup`);
  const rows = (db.prepare("SELECT COUNT(*) n FROM sim_commands").get() as any).n;
  const again = await rt.agent.exec("look", {}, g, `${g}:call_dup`);
  assert.equal(again.content, first.content);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sim_commands").get() as any).n, rows);
  void sim;
});
