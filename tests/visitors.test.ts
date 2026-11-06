import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-visitortest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0, needsRate: 0, visitorDays: 1 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { GATED_TOOLS } = await import("../src/server/tools.ts");
const { ARCHETYPES } = await import("../src/content/visitors.ts");
const { defById, defForKind } = await import("../src/content/items.ts");
const rt = await createRuntime(); startSystems(rt);
const w = rt.world, V = rt.visitors;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number, until?: () => boolean) { for (let i = 0; i < ticks && !until?.(); i++) { sim.runTicks(1); await drain(); } }
const tool = (n: string) => GATED_TOOLS.find((t) => t.name === n)!;
const nearRiver = () => { const e = V.here!; e.x = w.me.x + 3; e.z = w.me.z; w.putEntity(e); };

test("archetypes are well formed: their own wants and goods that exist, lines for every moment, and where they come from", () => {
  for (const a of ARCHETYPES) {
    assert.ok(a.inspiration.length >= 1 && a.names.length >= 3 && a.offers.length >= 2, a.id);
    for (const o of a.offers) assert.equal(defById(o.def).id, o.def, `${a.id} offers a real kind: ${o.def}`);
    for (const d of Object.keys(a.wants)) assert.equal(defById(d).id, d, `${a.id} wants a real kind: ${d}`);
    for (const k of ["greet", "talk", "ask", "trade_yes", "trade_no", "short", "farewell", "remember"] as const) assert.ok(a.lines[k].length >= 1, `${a.id}.${k}`);
    for (const line of Object.values(a.lines).flat()) assert.doesNotMatch(line, /\b(you should|you must|you need to|go to|find the|look for|the goal|your quest)\b/i, `${a.id}: ${line}`);
  }
});

test("someone comes ashore on a day, stays, and goes", async () => {
  w.me.sleeping = false; w.me.x = 4; w.me.z = 4;
  w.epoch = sim.simNow() - 0.4 * sim.DAY_MS;                           // morning
  V.st.next = sim.simNow() + 1000;
  await run(60, () => !!V.here);
  assert.ok(V.here, "a visitor arrived");
  assert.equal(V.here!.kind, "person");
  const h = V.st.here!; h.leaveAt = sim.simNow() + 2000;
  await run(4000, () => !V.here);
  assert.equal(V.here, null, "they went");
});

test("speaking to them works when near, fails when far, and is remembered", async () => {
  V.st.next = sim.simNow() + 1000; w.epoch = sim.simNow() - 0.4 * sim.DAY_MS; await run(60, () => !!V.here);
  assert.ok(V.here);
  const far = V.here!; far.x = w.me.x + 40; far.z = w.me.z; w.putEntity(far);
  await assert.rejects(Promise.resolve().then(() => tool("speak_to").run({ target: "them", text: "hello" }, w)), /Move closer/);
  nearRiver();
  const out1 = await tool("speak_to").run({ target: "them", text: "hello there" }, w) as string;
  assert.match(out1, /answers: "/);
  const rec = V.rec(V.st.here!.name);
  assert.equal(rec.met, 1); assert.equal(rec.talked, 1); assert.ok(rec.trust > 0);
  await tool("speak_to").run({ target: "them", text: "where did you come from?" }, w);
  assert.equal(rec.met, 1, "met only once"); assert.equal(rec.talked, 2);
});

test("a trade is fair: what they do not value is handed back, too little is refused, enough is exchanged", async () => {
  if (!V.here) { V.st.next = sim.simNow() + 1000; w.epoch = sim.simNow() - 0.4 * sim.DAY_MS; await run(60, () => !!V.here); }
  nearRiver();
  const a = V.arch()!, offer = a.offers[0]!, wantKind = Object.entries(a.wants).sort((x, y) => y[1] - x[1])[0]![0];
  assert.match(await tool("trade").run({ target: "them", want: "list" }, w) as string, /has:/);
  w.addItem("stick", "stick", "A stick.", 5);
  const stick = w.findItem("stick")!;
  const refused = await tool("trade").run({ target: "them", give: stick.id, want: offer.name }, w) as string;
  assert.match(refused, /hands it back|turns the/i); assert.ok(w.findItem("stick"), "kept what it gave");
  const per = a.wants[wantKind]!, need = Math.ceil(offer.cost / per);
  w.addItem(wantKind, defById(wantKind).name, "", need + 2);
  const had = w.findItem(defById(wantKind).name)!;
  const before = had.qty;
  const done = await tool("trade").run({ target: "them", give: w.findItem(defById(wantKind).name)!.id, want: offer.name, quantity: need + 1 }, w) as string;
  assert.match(done, /gives you/);
  assert.ok(w.findItem(offer.name), "River has what it traded for");
  assert.ok((w.findItem(defById(wantKind).name)?.qty ?? 0) < before + 0, "and has less of what it gave");
});

test("a model's line, when there is one, is used and counted; with none, they speak their own", async () => {
  if (!V.here) { V.st.next = sim.simNow() + 1000; w.epoch = sim.simNow() - 0.4 * sim.DAY_MS; await run(60, () => !!V.here); }
  nearRiver();
  const used = V.st.voiceUsed, voiced = V.st.here!.voiced;
  const out = await tool("speak_to").run({ target: "them", text: "hello" }, w, { line: "\"A line from the model.\"" }) as string;
  assert.match(out, /A line from the model/);
  assert.equal(V.st.voiceUsed, used + 1); assert.equal(V.st.here!.voiced, voiced + 1);
  assert.equal(await tool("speak_to").external!({ target: "them", text: "hello" }, w), undefined, "no model call with the mock brain");
  void defForKind;
});
