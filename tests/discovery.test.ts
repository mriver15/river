import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-discoverytest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0, needsRate: 0, visitorDays: 0, discovery: true })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { ABILITIES, HUMAN_ONLY, describeCapabilities } = await import("../src/content/abilities.ts");
const { GATED_TOOLS, BASE_TOOLS, availableTools } = await import("../src/server/tools.ts");
const { isApproved } = await import("../src/server/mind.ts");
const { db } = await import("../src/server/db.ts");
const rt = await createRuntime(); startSystems(rt);
const w = rt.world, D = rt.discovery;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }
const clear = () => { db.exec("DELETE FROM tools"); for (const i of [...w.inventory.values()]) w.takeItem(i.id, i.qty); D.reset(); w.me.sleeping = false; w.me.needs.warmth = 90; };
const tryIt = (t: string) => BASE_TOOLS.find((x) => x.name === "try")!.run({ attempt: t }, w) as string;

test("every ability a person could be granted by hand can be found by living, except the ones that reach beyond the island", () => {
  const gated = GATED_TOOLS.map((t) => t.name).filter((n) => !HUMAN_ONLY.has(n));
  for (const n of gated) assert.ok(ABILITIES.some((a) => a.id === n), `${n} can be discovered`);
  for (const a of ABILITIES) { assert.ok(gated.includes(a.id), `${a.id} is a real ability`); assert.ok(a.dawn.length > 30); assert.ok(!HUMAN_ONLY.has(a.id)); }
  for (const a of ABILITIES) for (const text of [a.dawn, a.lack]) assert.doesNotMatch(text, /\b(use|call|the)\s+`?(craft|build|clothe|burn|fish|plant|tend|defend|colour|offer|trade|compose)`?\b|`[a-z_]+`/i, `${a.id} names no tool: ${text}`);
});

test("a thing says what it is good for in plain words, never a tool's name", () => {
  assert.equal(describeCapabilities(["cuts", "binds", "fuel"]), "It has an edge that would cut, is supple enough to tie with and would burn.");
  assert.equal(describeCapabilities([]), "It has no use beyond being what it is.");
});

test("holding a seed, it dawns on River that it could plant, and it is told once, in the world's words", async () => {
  clear(); assert.equal(isApproved("plant"), false);
  w.addItem("seed", "seed", "A small seed.", 2);
  await run(60);
  assert.equal(isApproved("plant"), true);
  assert.ok(availableTools().some((t) => t.name === "plant"));
  const n = (db.prepare("SELECT COUNT(*) n FROM life_deeds WHERE kind = 'discovered' AND name = 'plant'").get() as any).n;
  await run(200); assert.equal((db.prepare("SELECT COUNT(*) n FROM life_deeds WHERE kind = 'discovered' AND name = 'plant'").get() as any).n, n, "told once");
});

test("trying what the world does not yet allow says what is missing, and trying with enough opens it", async () => {
  clear();
  assert.match(tryIt("build a shelter to sleep under"), /do not yet have enough/);
  assert.equal(isApproved("build"), false);
  w.addItem("stick", "stick", "A stick.", 4); w.addItem("stone", "stone", "A stone.", 2);
  const out = tryIt("raise a lean-to out of these sticks");
  assert.match(out, /You know how to build/);
  assert.equal(isApproved("build"), true);
  assert.match(tryIt("build another shelter"), /already know how/);
  assert.match(tryIt("juggle flaming swords"), /nothing comes of it/);
});

test("the web is never discovered: it stays with the human", () => {
  clear();
  tryIt("search the web for how to make a roof"); tryIt("look it up on the internet");
  assert.equal(isApproved("web_search"), false); assert.equal(isApproved("web_fetch"), false);
});

test("asking for what it already has is answered at once, and discovery can be switched off", () => {
  clear(); w.addItem("seed", "seed", "A small seed.", 1); tryIt("plant this seed");
  assert.ok(isApproved("plant"));
  const req = BASE_TOOLS.find((x) => x.name === "request_tool")!;
  assert.match(req.run({ name: "plant", reason: "I want to put a seed in the ground" }, w) as string, /You already have plant/);
  assert.match(req.run({ name: "sow_seeds", reason: "I want to plant a seed in the ground and watch it grow into something" }, w) as string, /already do that/);
  setConfig("discovery", false);
  assert.ok(!availableTools().some((t) => t.name === "try"));
  assert.match(tryIt("tie these sticks together"), /nothing comes of it/);
  setConfig("discovery", true);
});
