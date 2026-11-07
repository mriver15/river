import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-seasontest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 1, prey: true, smallWild: true, predators: false, fallRate: 0, seasonDays: 6, visitorDays: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { bus } = await import("../src/server/bus.ts");
const rt = await createRuntime(); startSystems(rt);
const w = rt.world;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }
/** put the world on a given day, at a given time of day */
const setDay = (day: number, time = 0.9) => { w.epoch = sim.simNow() - ((day - 1) + time) * sim.DAY_MS; };

test("the year turns: the world knows the season, and winter is colder than summer", async () => {
  setDay(1 + 6 * 1 - 3); assert.equal(w.season().id, "summer");
  setDay(1 + 6 * 2 + 1); assert.equal(w.season().id, "autumn");
  const cold = async (day: number) => { setDay(day, 0.9); w.me.needs.warmth = 90; w.me.sleeping = false; w.weather = "clear"; const before = w.me.needs.warmth; await run(600); return before - w.me.needs.warmth; };
  const summer = await cold(1 + 6 - 2), winter = await cold(1 + 6 * 3 - 2 + 3);
  assert.equal(w.season().id, "winter");
  assert.ok(winter > summer * 1.5, `a winter night costs more warmth (${winter.toFixed(2)}) than a summer one (${summer.toFixed(2)})`);
});

test("the world says when the season changes, once", async () => {
  setDay(9, 0.95);                                                   // the last day of summer, late
  w.me.sleeping = false;
  const heard: string[] = []; bus.on("perceived", (m: { text: string }) => heard.push(m.text));
  await run(100); const before = heard.length;
  setDay(10, 0.05);                                                  // the first day of autumn
  await run(1500);
  const said = heard.slice(before).filter((t) => /edge to the mornings|leaves are turning/.test(t));
  assert.equal(said.length, 1, heard.slice(before).join(" | "));
});

test("hunting changes the numbers, winter sends some away, and with the ecology off nothing changes", () => {
  const E = rt.ecology;
  setDay(3); const before = E.count("deer", 3);
  bus.emit("deed", { kind: "hunt", name: "deer" });
  assert.equal(E.count("deer", 3), Math.max(0, Math.round(E.pops.deer!)));
  assert.ok(E.pops.deer! < before + 1e-9);
  assert.equal(E.count("gull", 3), 3, "a kind outside the model is as written");
  setDay(1 + 6 * 3 + 2); assert.equal(w.season().id, "winter");
  assert.equal(E.here("bear"), false); assert.equal(E.here("wolf"), true);
  setConfig("ecology", false);
  assert.equal(E.count("deer", 3), 3); assert.equal(E.here("bear"), true);
  setConfig("ecology", true);
});

test("the agent's view carries the season", () => {
  setDay(5);
  assert.equal(w.view().season?.id, w.season().id);
});
