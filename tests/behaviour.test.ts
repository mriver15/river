import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { behaviourReport, evenness, loops, formatReport, TICKS_PER_DAY } from "../src/server/behaviour.ts";

test("evenness is 0 for one thing and 1 for an even spread", () => {
  assert.equal(evenness([10]), 0);
  assert.equal(evenness([10, 0, 0]), 0);
  assert.ok(Math.abs(evenness([5, 5, 5, 5]) - 1) < 1e-9);
  assert.ok(evenness([97, 1, 1, 1]) < 0.2);
});

test("loops finds an unbroken repeat and a repeating cycle", () => {
  assert.deepEqual(loops(["a|x", "a|x", "a|x", "b|y"]).n, 3);
  const cyc = loops(Array.from({ length: 30 }, (_, i) => ["gather|a", "craft|b", "drop|c"][i % 3]));
  assert.ok(cyc.share > 0.9, `a pure cycle is nearly all loop (${cyc.share})`);
  const varied = loops(["a|1", "b|2", "c|3", "d|4", "e|5", "f|6", "g|7", "h|8"]);
  assert.ok(varied.share < 0.5);
});

function dbWith(acts: { def: string; target: string; day: number }[]) {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE sim_activities (id TEXT, def TEXT, status TEXT, params TEXT, started_tick INTEGER);
          CREATE TABLE sim_checkpoints (tick INTEGER);
          CREATE TABLE desires (status TEXT);`);
  acts.forEach((a, i) => d.prepare("INSERT INTO sim_activities VALUES(?,?,?,?,?)").run(`a${i}`, a.def, "completed", JSON.stringify({ target: a.target }), a.day * TICKS_PER_DAY + i));
  return d;
}

test("a narrow, stuck run is flagged, and tables that do not exist are not an error", () => {
  const r = behaviourReport(dbWith(Array.from({ length: 40 }, (_, i) => ({ def: "gather", target: "berry", day: Math.floor(i / 10) }))));
  assert.equal(r.activities.distinct, 1);
  assert.ok(r.warnings.some((w) => w.startsWith("Stuck")), r.warnings.join("|"));
  assert.ok(r.warnings.some((w) => w.startsWith("Aimless")));
  assert.match(formatReport(r), /Warnings/);
});

test("a varied run that keeps trying new things raises no activity warnings", () => {
  const defs = ["gather", "craft", "build", "fish", "move_to", "eat", "inspect", "plant"];
  const r = behaviourReport(dbWith(Array.from({ length: 48 }, (_, i) => ({ def: defs[(i * 5) % Math.min(defs.length, 1 + Math.floor(i / 6) + 1)], target: `t${i % 7}`, day: Math.floor(i / 8) }))));
  assert.ok(r.activities.variety > 0.8, String(r.activities.variety));
  assert.deepEqual(r.warnings.filter((w) => /^(Narrow|Stuck|Cycling|Plateau)/.test(w)), []);
});
