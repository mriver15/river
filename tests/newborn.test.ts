import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-newborntest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: true, needsRate: 0, fallRate: 0, lethal: false })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { bodyApi, bodyView } = await import("../src/server/body.ts");
const rt = await createRuntime(); startSystems(rt);
const w = rt.world;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }

test("a newborn is not noticed by a wolf standing close; once the grace is over, it is", async () => {
  for (const e of [...w.entities.values()]) if (e.kind === "animal") w.removeEntity(e.id);
  w.epoch = sim.simNow() - 0.95 * sim.DAY_MS;                          // deep night, when wolves are about
  bodyApi.reset(); rt.wildlife.reset();
  setConfig("newbornGrace", 15);
  const wolf = w.spawn("animal", "wolf", w.me.x + 7, w.me.z, { species: "wolf", wild: true, desc: "A grey wolf, lean and silent.", hp: 32, maxHp: 32 });
  await run(2400);                                                   // four world minutes
  assert.equal(bodyView().marks.length, 0, "no wounds during the grace");
  assert.equal(bodyView().health, 100);
  setConfig("newbornGrace", 0);
  wolf.x = w.me.x + 7; wolf.z = w.me.z;
  await run(3000);
  assert.ok(bodyView().health < 100 || bodyView().marks.length > 0, "after the grace the wolf hunts it");
});
