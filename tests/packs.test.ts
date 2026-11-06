import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-packtest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 1, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { Ambient } = await import("../src/server/ambient.ts");
const { PACKS, enabledPacks, packOfEvent } = await import("../src/server/packs/index.ts");
const { bus } = await import("../src/server/bus.ts");
const rt = await createRuntime(); startSystems(rt);

const TONES = ["calm", "beauty", "mystery", "spectacle", "tension"], THEMES = ["sound", "light", "water", "growth", "animals", "trace", "message", "material", "self", "place", "pattern"];

test("packs are well formed: unique names, a tone and theme from the director's own, and something to say about where they came from", () => {
  const names = Ambient.eventNames();
  assert.equal(new Set(names).size, names.length, "every happening has its own name");
  for (const p of PACKS) {
    assert.ok(p.title && p.inspiration.length >= 3, `${p.id} says what it draws on`);
    assert.ok(p.events.length >= 5, `${p.id} has enough to stay fresh`);
    for (const e of p.events) { assert.ok(TONES.includes(e.tone), e.name); assert.ok(THEMES.includes(e.theme), e.name); assert.ok(e.weight > 0); }
  }
});

test("a happening is only ever a stimulus: what River perceives never tells it what to do or what it means", () => {
  const said: string[] = []; bus.on("perceived", (m: { text: string }) => said.push(m.text));
  w_prepare();
  for (const p of PACKS) for (const e of p.events) for (let i = 0; i < 6; i++) rt.ambient.trigger(e.name);
  const texts = [...said, ...PACKS.flatMap((p) => p.events.flatMap((e) => (rt.world.entities.size ? [...rt.world.entities.values()].filter((x) => x.kind === "trace" || x.kind === "item").map((x) => String(x.props.desc ?? "")) : [])))];
  assert.ok(said.length >= PACKS.flatMap((p) => p.events).length * 0.6, `happenings were perceived (${said.length})`);
  for (const t of texts) assert.doesNotMatch(t, /\b(you should|you must|you need to|you have to|go to|try to|find the|look for|remember to|it means|the answer|is a clue|reward)\b/i, t);
});

test("only the packs that are switched on are drawn from", () => {
  assert.deepEqual(enabledPacks("zone").map((p) => p.id), ["zone"]);
  assert.deepEqual(enabledPacks("all").map((p) => p.id), PACKS.map((p) => p.id));
  assert.deepEqual(enabledPacks("none"), []);
  setConfig("contentPacks", "none");
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) { const e = rt.ambient.pickEvent(1e12 + i * 700_000); if (e) seen.add(e.name); }
  assert.ok(seen.size > 3 && [...seen].every((n) => !packOfEvent(n)), "no pack happenings when none are on");
  setConfig("contentPacks", "mind");
  const seen2 = new Set<string>();
  for (let i = 0; i < 600; i++) { const e = rt.ambient.pickEvent(2e12 + i * 700_000); if (e) seen2.add(e.name); }
  assert.ok([...seen2].some((n) => packOfEvent(n)?.id === "mind") && [...seen2].every((n) => packOfEvent(n)?.id !== "zone"));
  setConfig("contentPacks", "all");
});

function w_prepare() { rt.world.me.sleeping = false; rt.world.me.x = 4; rt.world.me.z = 4; }
