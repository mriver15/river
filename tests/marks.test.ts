import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-markstest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0, needsRate: 0, visitorDays: 0, discovery: false })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");

const rt = await createRuntime(); startSystems(rt);
const w = rt.world;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }
const { grantTool } = await import("../src/server/mind.ts");
grantTool("colour");
const act = async (a: Record<string, unknown>) => {                         // through the agent, the way River calls it: timed actions take their time
  let done = false, res: { content: string; is_error?: boolean } | null = null;
  const p = rt.agent.execNow("colour", a).then((r) => { res = r; done = true; });
  for (let i = 0; i < 400 && !done; i++) { sim.runTicks(1); await drain(); }
  await p; if (res!.is_error) throw new Error(res!.content); return res!.content;
};

test("a pigment can be pressed onto a rock within reach, and it leaves a mark that stays, up to a few", async () => {
  for (const i of [...w.inventory.values()]) w.takeItem(i.id, i.qty);
  const rock = w.spawn("rock", "chalk outcrop", w.me.x + 2, w.me.z, { stock: 3, max: 4, yields: ["chalk"], desc: "A pale outcrop." }); rt.knowledge.learn(rock);
  w.addItem("berry", "wild berry", "A berry.", 1);
  await act({ action: "grind", item: "berry" });
  const pig = [...w.inventory.values()].find((i) => i.kind === "pigment")!; assert.ok(pig);
  const before = pig.qty;
  const out = await act({ action: "mark", pigment: pig.id, target: rock.id, shape: "bold spiral" });
  assert.match(out, /draw a bold spiral/);
  const mark = [...w.entities.values()].find((e) => e.props.markOf === rock.id)!;
  assert.ok(mark && mark.props.mark && /^#[0-9a-f]{6}$/i.test(mark.props.hex), "a mark stands on the rock");
  assert.ok(mark.props.expires > sim.simNow(), "and wears away in time");
  assert.equal(w.findItem(pig.id)!.qty, before - 1, "one portion used");
  for (let i = 0; i < 6; i++) { try { await act({ action: "mark", pigment: pig.id, target: rock.id, shape: `sign ${i}` }); } catch { /* out of pigment or room */ } }
  assert.ok([...w.entities.values()].filter((e) => e.props.markOf === rock.id).length <= 4, "a surface has only so much room");
});

test("a mark needs something to hold it and something within reach", async () => {
  const far = w.spawn("rock", "grey rock", w.me.x + 40, w.me.z, { desc: "A rock." }); rt.knowledge.learn(far);
  w.addItem("pigment", "red pigment (aa0000)", "red", 2, { hex: "#aa0000" });
  const pig = [...w.inventory.values()].find((i) => i.kind === "pigment" && i.props?.hex === "#aa0000")!;
  await assert.rejects(Promise.resolve().then(() => act({ action: "mark", pigment: pig.id, target: far.id })), /away|Go to it/);
  const pond = w.spawn("flower", "poppy", w.me.x + 1, w.me.z, { desc: "A flower." }); rt.knowledge.learn(pond);
  await assert.rejects(Promise.resolve().then(() => act({ action: "mark", pigment: pig.id, target: pond.id })), /will not hold a mark/);
});
