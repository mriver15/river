import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-lifetest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0, lethal: true })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { bodyApi, bodyView } = await import("../src/server/body.ts");
const { bus } = await import("../src/server/bus.ts");
const { db } = await import("../src/server/db.ts");
const { lifeSoFar, obituary, obituaries, livedText } = await import("../src/server/life.ts");
const { resetApply } = await import("../src/server/reset.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }
const now = () => sim.simNow();

test("a lifespan is told in hours and days of world time", () => {
  assert.equal(livedText(0.01), "less than an hour"); assert.equal(livedText(0.25), "6 hours"); assert.equal(livedText(1), "1 day");
  assert.equal(livedText(3.17), "3 days and 4 hours"); assert.equal(livedText(2 + 1 / 24), "2 days and 1 hour");
});

test("what River does is counted: hunts, fish, builds, made things, places, songs, firsts", async () => {
  await run(20);
  const before = lifeSoFar(w, bodyApi.born());
  assert.equal(before.alive, true); assert.deepEqual(before.achievements.map((a) => a.id), [], "a blank life has done nothing yet");
  bus.emit("deed", { kind: "hunt", name: "fox" }); bus.emit("deed", { kind: "hunt", name: "wolf" }); bus.emit("deed", { kind: "fish", name: "fish" });
  bus.emit("made", { name: "lean-to", kind: "build", tags: [] });
  w.addItem("cord", "length of cord", "A cord.", 3, undefined, { maker: true }); w.addItem("spear", "stone spear", "A spear.", 1, { crafted: true }, { maker: true });
  db.prepare("INSERT INTO works(ts,name,shape,size,materials,colors,color_names,x,z,entity) VALUES(?,?,?,?,?,?,?,?,?,?)").run(now(), "lean-to", "lean-to", "small", "{}", "[]", "[]", 1, 1, "s1");
  db.prepare("INSERT INTO places(name,x,z,note,ts) VALUES(?,?,?,?,?)").run("Mossy Hollow", 3, 3, "", now());
  db.prepare("INSERT INTO compositions(title,spec,ts) VALUES(?,?,?)").run("Rain Song", "{}", now());
  db.prepare("INSERT INTO moments(ts,kind,title,text,intensity,emotions,x,z) VALUES(?,?,?,?,?,?,?,?)").run(now(), "first", "A first: fire", "It lit a fire.", 0.9, "{}", 0, 0);
  db.prepare("INSERT INTO journal(day,text,ts) VALUES(?,?,?)").run(1, "Today I built a shelter.", now());
  await run(2);
  const s = lifeSoFar(w, bodyApi.born()), num = (l: string) => s.numbers.find((n) => n.label === l)!.value;
  assert.equal(num("Animals hunted"), 2); assert.equal(num("Fish caught"), 1); assert.equal(num("Things built"), 1); assert.equal(num("Things made"), 4, "three cords and a spear");
  assert.equal(num("Places named"), 1); assert.equal(num("Pieces of music"), 1); assert.equal(num("Firsts"), 1);
  assert.deepEqual(s.hunted.map((h) => h.species).sort(), ["fox", "wolf"]); assert.deepEqual(s.built.map((b) => b.name), ["lean-to"]);
  assert.deepEqual(s.crafted.find((c) => c.name === "length of cord"), { name: "length of cord", qty: 3 });
  assert.ok(s.discoveries.firsts.includes("A first: fire") && s.discoveries.places.includes("Mossy Hollow")); assert.equal(s.wrote.lastEntry, "Today I built a shelter.");
  const ids = s.achievements.map((a) => a.id);
  for (const id of ["roof", "hunter", "predator", "fisher", "musician", "writer", "firsts"]) assert.ok(ids.includes(id), `missing achievement ${id}: ${ids}`);
  assert.ok(!ids.includes("village") && !ids.includes("week"), "and none that were not earned");
  assert.match(s.epitaph, /has lived/); assert.match(s.epitaph, /hunted 1 fox, 1 wolf|hunted 1 wolf, 1 fox/);
});

test("when River dies the whole life is written down, with its cause, before anything is wiped", async () => {
  const born = bodyApi.born();
  bodyApi.wound("claw", "chest", 1, 10, "a mauling in the dark", false, 500);
  await run(5);
  assert.equal(bodyApi.isDead(), true);
  const o = obituary()!;
  assert.ok(o, "an obituary exists"); assert.equal(o.alive, false); assert.equal(o.cause.length > 0, true); assert.equal(o.born, born);
  assert.ok(o.place && Number.isFinite(o.place.x)); assert.match(o.epitaph, /lived .*was the end of them/);
  assert.ok(o.achievements.length >= 5 && o.hunted.length === 2 && o.built.length === 1, "what it did is in it");
  assert.equal(obituaries().length, 1); assert.equal(obituaries()[0]!.lived, o.lived);
});

test("a new life starts blank, but the old life's summary is kept", async () => {
  const kept = JSON.stringify(obituary());
  resetApply({ world: false }, rt as never);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM life_deeds").get() as { n: number }).n, 0, "the ledger of deeds begins again");
  assert.equal(JSON.stringify(obituary()), kept, "the obituary is untouched by the reset");
  const fresh = lifeSoFar(w, bodyApi.born());
  assert.equal(fresh.life, 2); assert.deepEqual(fresh.achievements, []); assert.equal(fresh.numbers.find((n) => n.label === "Animals hunted")!.value, 0, "the new River has done none of it");
  assert.equal(obituaries().length, 1);
});

test("being looked in on gives River a faint, brief sense of being watched, a few times a day at most", async () => {
  const feel = () => bodyView().sensations.some((s) => /being watched/.test(s));
  assert.equal(feel(), false);
  assert.equal(bodyApi.watched(), true);
  await run(10);
  assert.equal(feel(), true, "felt while the sensation lasts");
  assert.equal(bodyApi.watched(), false, "not again straight away");
});
