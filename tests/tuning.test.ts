import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-tunetest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";
process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const config = await import("../src/server/config.ts");
const { setConfig, DEFS, cfg, paramSet, applyPreset, paramHistory, effective } = config;
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems, humanCommand, REPLAYABLE } = await import("../src/server/runtime.ts");
const { PRESETS } = await import("../src/content/presets.ts");
const { timeline } = await import("../src/server/timeline.ts");
const { bus } = await import("../src/server/bus.ts");
const { db } = await import("../src/server/db.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, E = rt.emotions, R = w.items;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }

test("every parameter says who owns it, how it may change, what ruleset it belongs to, and stays inside its own bounds", () => {
  const keys = new Set(DEFS.map((d) => d.key));
  for (const d of DEFS) {
    assert.ok(d.owner && d.applies && d.ruleset, `${d.key} is missing registry metadata`);
    assert.ok(["immediate", "new-instance", "restart"].includes(d.applies));
    if (d.type === "number") { assert.ok(d.min! <= (d.def as number) && (d.def as number) <= d.max!, `${d.key} default is out of range`); assert.ok(d.step! > 0 && d.unit !== undefined || d.unit === undefined); }
    for (const n of d.needs ?? []) assert.ok(keys.has(n), `${d.key} depends on unknown ${n}`);
  }
  for (const group of ["Time & weather", "Survival", "Wildlife", "Perception", "Feelings", "River's mind", "Budget"]) assert.ok(DEFS.some((d) => d.group === group), `no parameters in ${group}`);
});

test("a value outside its bounds is clamped, and an unknown parameter is refused", () => {
  assert.equal(setConfig("sightDay", 5000), true); assert.equal(cfg("sightDay"), 80);
  assert.equal(setConfig("sightDay", -1), true); assert.equal(cfg("sightDay"), 10);
  assert.equal(setConfig("sightDay", "far"), false); assert.equal(setConfig("nonsense", 1), false);
  setConfig("sightDay", 32);
});

test("parameters name immutable sets: the same values always give the same set, and the history says when each began", () => {
  const home = paramSet(), before = paramHistory().length;
  setConfig("needsRate", 2); const changed = paramSet();
  assert.notEqual(changed, home);
  setConfig("needsRate", 1); assert.equal(paramSet(), home, "back to the same values is the same set");
  const row = db.prepare("SELECT json, ruleset FROM sim_param_sets WHERE hash = ?").get(changed) as { json: string; ruleset: string };
  assert.equal(JSON.parse(row.json).needsRate, 2, "the set that was in force is kept exactly as it was"); assert.ok(row.ruleset.startsWith("rules-"));
  const hist = paramHistory(); assert.ok(hist.length >= before + 2);
  assert.equal(hist[0]!.hash, home); assert.match(hist[0]!.cause, /needsRate/);
});

test("a boot snapshot names the parameter set it ran under", async () => {
  const { snapshotBoot } = await import("../src/server/recorder.ts");
  const snap = snapshotBoot();
  const row = db.prepare("SELECT param_set FROM sim_snapshots WHERE tick = ?").get(snap.tick) as { param_set: string };
  assert.equal(row.param_set, paramSet());
});

test("parameters change what they say they change", async () => {
  setConfig("sightDay", 20); setConfig("sightNight", 7);
  w.weather = "clear";
  assert.ok(w.sightRadius() <= 26, `River sees less far (${w.sightRadius()})`);
  setConfig("sightDay", 32); setConfig("sightNight", 11);
  E.reset(); E.level.wonder = 0.8; setConfig("emotionSpeed", 1);
  E.tick(120); const slow = E.level.wonder;
  E.level.wonder = 0.8; setConfig("emotionSpeed", 4);
  E.tick(120); const fast = E.level.wonder;
  setConfig("emotionSpeed", 1);
  assert.ok(fast < slow * 0.5, `feelings fade faster when told to (${fast} vs ${slow})`);
});

test("presets are recorded commands that set known parameters, and 'standard' returns to the defaults", () => {
  assert.ok(REPLAYABLE.has("config_preset") && REPLAYABLE.has("config_set"), "so a replay repeats them");
  for (const p of PRESETS) for (const [k, v] of Object.entries(p.values)) { const d = DEFS.find((x) => x.key === k)!; assert.ok(d, `${p.id}: unknown parameter ${k}`); if (d.type === "number") assert.ok((v as number) >= d.min! && (v as number) <= d.max!, `${p.id}.${k} out of range`); }
  const r = humanCommand(rt, { t: "config_preset", id: "gentle" });
  assert.equal(r.notice?.level, "ok"); assert.equal(cfg("needsRate"), 0.5); assert.equal(cfg("damageScale"), 0.5);
  assert.match(paramHistory()[0]!.cause, /\w/);
  assert.equal(humanCommand(rt, { t: "config_preset", id: "nope" }).notice?.level, "error");
  assert.deepEqual(applyPreset("gentle"), [], "applying it again changes nothing");
  humanCommand(rt, { t: "config_preset", id: "default" });
  assert.deepEqual(effective(), Object.fromEntries(DEFS.map((d) => [d.key, d.def])));
  for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
});

test("the timeline lists what happened from the records, and can be filtered by actor, object, source and range", async () => {
  const spear = R.add("weapon", "river's spear", "Made by River.", 1, { crafted: true }, { maker: true });
  R.drop(spear.id, 1); await run(3); R.pickUp(spear.id);
  const all = timeline({ limit: 400 });
  assert.ok(all.length > 5 && all.every((e) => Number.isFinite(e.tick)));
  assert.ok(all.some((e) => e.source === "item" && e.object === spear.id), "its own history is there");
  const mine = timeline({ object: spear.id }); assert.ok(mine.length >= 3 && mine.every((e) => e.object === spear.id || e.text.includes(spear.id)));
  assert.ok(timeline({ source: "item" }).every((e) => e.source === "item"));
  assert.ok(timeline({ actor: "world" }).every((e) => e.actor === "world"));
  const sorted = timeline({ limit: 50 }); for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1]!.tick >= sorted[i]!.tick, "newest first");
  const mid = sorted[Math.floor(sorted.length / 2)]!.tick;
  assert.ok(timeline({ fromTick: mid }).every((e) => e.tick >= mid));
});

test("a feeling can be followed back to its cause: the chain from an event gathers what it made", async () => {
  const id = "structure_chain";
  rt.inner.attach(id, "structure", "chain hut", "made");
  bus.emit("loss", { id, name: "chain hut", kind: "structure", x: w.me.x + 3, z: w.me.z, named: true });
  await run(3);
  const chain = timeline({ chain: `loss:${id}` });
  assert.ok(chain.some((e) => e.source === "feeling" && /grief/.test(e.text)), "the grief it caused");
  assert.ok(chain.some((e) => e.source === "feeling" && /observation|chain hut/.test(e.text)), "and the observation that let River know");
  assert.ok(chain.every((e) => e.event === undefined || e.event.startsWith(`loss:${id}`) || e.object === id));
});

test("an activity's timeline is its own span", async () => {
  const act = rt.activities.begin("rest", { seconds: 5 }, { intent: "rest", source: "brain" });
  await run(80);
  const t = timeline({ activity: act.id });
  assert.ok(t.length >= 1 && t.some((e) => e.source === "activity" && e.activity === act.id), "the activity itself is in its timeline");
  assert.deepEqual(timeline({ activity: "no-such-activity" }), []);
});
