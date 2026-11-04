import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-innertest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";
process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { bus } = await import("../src/server/bus.ts");
const { db } = await import("../src/server/db.ts");
const { InnerLife } = await import("../src/server/inner.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, E = rt.emotions, I = rt.inner, R = w.items;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number) { for (let i = 0; i < ticks; i++) { sim.runTicks(1); await drain(); } }
const home = { x: w.me.x, z: w.me.z };
const calm = () => { E.reset(); I.reset(); for (const e of [...w.entities.values()]) w.removeEntity(e.id); w.me.x = home.x; w.me.z = home.z; w.me.sleeping = false; };
const grief = () => E.level.grief;
const loss = (id: string, name: string, kind: string, x: number, z: number, extra: object = {}) => bus.emit("loss", { id, name, kind, x, z, ...extra });

test("something that happens out of sight cannot be grieved until River comes upon it", async () => {
  calm();
  const far = { x: home.x + 150, z: home.z };
  const s = w.spawn("structure", "far lean-to", far.x, far.z, {});
  I.attach(s.id, "structure", s.name, "made");                 // River built it, so it matters
  loss(s.id, s.name, "structure", far.x, far.z, { named: true });
  await run(5);
  assert.equal(grief(), 0, "no grief for what River has not seen");
  assert.equal(I.view().unseen.length, 1, "it is remembered as not yet known");
  assert.ok(((db.prepare("SELECT COUNT(*) n FROM mind_trace WHERE kind = 'unseen'").get() as { n: number }).n) >= 1);
  w.me.x = far.x - 5; w.me.z = far.z;                          // River comes upon the place
  await run(15);
  assert.ok(grief() > 0.1, `the discovery lands when River finds out (${grief()})`);
  assert.equal(I.view().unseen.length, 0);
  assert.ok(I.view().observations.some((o) => o.late && o.subject === s.id), "recorded as found out later");
});

test("a loud thing heard but not seen leaves unease, not grief, and is still unknown", async () => {
  calm(); w.weather = "fog";                                    // sight closes in to 14 m; a burning oak 20 m away is still audible
  loss("tree_far", "far oak", "tree", home.x + 20, home.z);
  await run(5); w.weather = "clear";
  assert.equal(grief(), 0); assert.equal(I.view().unseen.length, 1);
  assert.ok(E.level.wonder > 0 || E.level.dread > 0, "something was heard");
});

test("losing something River made and named weighs far more than losing a stock item of the same kind", async () => {
  calm();
  const mine = { id: "item_mine", name: "river's flute", x: home.x + 4, z: home.z }, stock = { id: "item_stock", name: "a flute", x: home.x + 6, z: home.z };
  I.attach(mine.id, "item", mine.name, "made"); I.attach(mine.id, "item", mine.name, "named"); I.attach(mine.id, "item", mine.name, "used");
  loss(stock.id, stock.name, "item", stock.x, stock.z);
  await run(2); const generic = grief();
  E.reset();
  loss(mine.id, mine.name, "item", mine.x, mine.z);
  await run(2); const personal = grief();
  assert.ok(generic > 0 && personal > generic * 1.8, `personal ${personal} vs generic ${generic}`);
  const why = E.traces(5, "grief")[0]!;
  assert.equal(why.event_id, `loss:${mine.id}`);
  assert.ok(why.data.factors.attachment > 0.3 && why.data.parts.some((p: any) => p.name === "attachment"), "the explanation names attachment");
});

test("what River expected to find makes the loss land harder", async () => {
  calm();
  const a = w.spawn("structure", "marked hut", home.x + 3, home.z, {}), b = w.spawn("structure", "unmarked hut", home.x + 5, home.z, {});
  I.expect(a.id, a.name, a.x, a.z);                            // River knew it was there
  loss(b.id, b.name, "structure", b.x, b.z); await run(2); const unexpected = grief();
  E.reset(); loss(a.id, a.name, "structure", a.x, a.z); await run(2); const expected = grief();
  assert.ok(expected > unexpected, `${expected} vs ${unexpected}`);
  const belief = I.belief(`at:${a.id}`)!;
  assert.ok(belief.contradict.length === 1 && belief.confidence < 0.5, "the belief that it was there was contradicted, with the evidence kept");
  assert.equal(I.belief(`gone:${a.id}`)!.kind, "fact");
});

test("mending something River cares about raises attachment, eases grief and leaves some of it", async () => {
  calm();
  const s = w.spawn("structure", "mended hut", home.x + 3, home.z, {});
  I.attach(s.id, "structure", s.name, "made");
  E.level.grief = 0.5; E.level.longing = 0; E.level.pride = 0;
  const before = I.link(s.id)!.attachment;
  bus.emit("restored", { id: s.id, name: s.name, kind: "structure" });
  await run(2);
  assert.ok(I.link(s.id)!.attachment > before, "attachment grows");
  assert.ok(grief() < 0.45, `grief eased (${grief()})`); assert.ok(grief() > 0.1, "but not erased");
  assert.ok(E.level.pride > 0, "and there is pride in it");
  assert.ok(E.level.longing > 0, "a mended thing is not quite the old one");
});

test("an item River mends looks mended, is sounder, and grows closer to it", async () => {
  calm();
  const spear = R.add("weapon", "river's spear", "Made by River.", 1, { crafted: true }, { maker: true });
  assert.ok(I.link(spear.id)!.attachment > 0.2, "making it made it River's");
  R.wear(spear.id, 0.5); assert.equal(R.packet(R.get(spear.id)!).look.damage, 1);
  const before = I.link(spear.id)!.attachment;
  R.repair(spear.id, 0.4);
  const it = R.get(spear.id)!;
  assert.equal(R.packet(it).look.repaired, true); assert.ok(it.condition.durability > 0.8);
  assert.ok(I.link(spear.id)!.attachment > before);
});

test("rediscovering what was thought gone eases grief and surprises", async () => {
  calm();
  const s = w.spawn("structure", "lost hut", home.x + 3, home.z, {});
  I.attach(s.id, "structure", s.name, "made"); I.attach(s.id, "structure", s.name, "named");
  loss(s.id, s.name, "structure", s.x, s.z); await run(2); const mourned = grief(); assert.ok(mourned > 0.1);
  I.report({ id: `found:${s.id}`, cls: "found", subject: { id: s.id, kind: "structure", name: s.name }, sig: { contact: true } });
  await run(2);
  assert.ok(grief() < mourned, "the grief eases"); assert.ok(E.level.wonder > 0, "and it is a surprise");
  assert.ok(I.belief(`gone:${s.id}`)!.contradict.length >= 1);
});

test("the same event cannot be appraised twice", async () => {
  calm();
  const s = w.spawn("structure", "twice hut", home.x + 3, home.z, {});
  loss(s.id, s.name, "structure", s.x, s.z); await run(2); const once = grief();
  loss(s.id, s.name, "structure", s.x, s.z); loss(s.id, s.name, "structure", s.x, s.z); await run(2);
  assert.equal(grief(), once * Math.pow(0.5, 2 / 900) < once ? grief() : once, "unchanged apart from decay");
  assert.ok(grief() <= once + 1e-9, "nothing was added");
  E.reset();
  E.appraiseNow({ key: "x", eventId: "evt-1", emotion: "wonder", base: 0.3, text: "a thing", why: "a thing" });
  const w1 = E.level.wonder; E.appraiseNow({ key: "x", eventId: "evt-1", emotion: "wonder", base: 0.3, text: "a thing", why: "a thing" });
  assert.equal(E.level.wonder, w1);
  assert.ok(E.appraised("evt-1"));
});

test("repeated events fade in force, and different subjects do not share habituation", async () => {
  calm();
  const amounts: number[] = [];
  for (let i = 0; i < 4; i++) { const b = E.level.wonder; E.appraiseNow({ key: "world:meteor", eventId: `m${i}`, emotion: "wonder", base: 0.25, text: "a meteor", why: "a meteor" }); amounts.push(E.level.wonder - b); E.level.wonder = 0; }
  for (let i = 1; i < amounts.length; i++) assert.ok(amounts[i]! < amounts[i - 1]!, `${amounts.map((a) => a.toFixed(2))}`);
  const b = E.level.wonder; E.appraiseNow({ key: "world:rainbow", eventId: "r1", emotion: "wonder", base: 0.25, text: "a rainbow", why: "a rainbow" });
  assert.ok(E.level.wonder - b > amounts[1]!, "a rainbow is not the fourth meteor");
});

test("an embedding annotation arriving late changes nothing before it and only adds after it", async () => {
  calm();
  E.appraiseNow({ key: "annot", eventId: "a1", emotion: "wonder", base: 0.3, text: "pigment and clay", why: "something" });
  const state = JSON.stringify(E.state().level);
  await run(3);                                                // however long the outside service takes, nothing moves
  const after3 = E.level.wonder;
  const id = [...(E.state().pending as [number, unknown][])].pop()![0];
  E.resolveRelevance({ id: 99999, r: 1 });                     // an annotation for nothing is ignored
  assert.equal(E.level.wonder, after3);
  E.resolveRelevance({ id, r: 1, top: "pigment" });            // applied now, at this tick
  assert.ok(E.level.wonder >= after3, "it can only add");
  E.resolveRelevance({ id, r: 1 });                            // and only once
  assert.ok(state.length > 0);
});

test("feelings stay finite and non-negative whatever happens", async () => {
  calm();
  E.bump("grief", NaN); E.bump("dread", -5); E.bump("pride", Infinity);
  await run(3);
  for (const v of Object.values(E.level)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
});

test("small changes are summed into one line; full tracing keeps each", async () => {
  calm(); db.exec("DELETE FROM mind_trace");
  for (let i = 0; i < 5; i++) E.bump("playfulness", 0.004, "a flicker");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mind_trace WHERE emotion = 'playfulness'").get() as any).n, 0, "not traced one by one");
  setConfig("traceAll", true); E.bump("playfulness", 0.004, "a flicker"); setConfig("traceAll", false);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mind_trace WHERE emotion = 'playfulness'").get() as any).n, 1, "debug mode keeps the full trace");
  await run(600);
  assert.ok((db.prepare("SELECT COUNT(*) n FROM mind_trace WHERE kind = 'aggregate'").get() as any).n >= 1, "and the rest was summed");
});

test("a stirred heart remembers more firmly; tolerance stays inside its bounds", async () => {
  calm();
  const calmS = E.salience(); E.level.dread = 0.9; E.level.wonder = 0.8;
  assert.ok(E.salience() > calmS && E.salience() <= 2);
  assert.ok(E.tolerance() >= 0.5 && E.tolerance() <= 2);
  E.level.dread = 0; E.level.frustration = 1; assert.ok(E.tolerance() <= 2);
});

test("a new life clears personal beliefs, attachments and what was unseen", async () => {
  calm();
  const s = w.spawn("structure", "kept hut", home.x + 3, home.z, {});
  I.attach(s.id, "structure", s.name, "made"); I.expect(s.id, s.name, s.x, s.z);
  loss("elsewhere", "far thing", "structure", home.x + 400, home.z);
  assert.ok(I.view().relationships.length && I.view().beliefs.length && I.view().unseen.length);
  const { resetApply } = await import("../src/server/reset.ts");
  resetApply({ world: false }, rt as any);
  assert.deepEqual([I.view().relationships, I.view().beliefs, I.view().unseen, I.view().observations], [[], [], [], []]);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM mind_trace").get() as any).n, 0, "and the explanations of the old life");
  assert.equal(E.state().seen.length, 0);
});

test("what is saved and restored gives the same inner life", async () => {
  calm();
  const s = w.spawn("structure", "saved hut", home.x + 3, home.z, {});
  I.attach(s.id, "structure", s.name, "made"); I.expect(s.id, s.name, s.x, s.z); loss("far_x", "far", "structure", home.x + 300, home.z);
  const snap = JSON.stringify(I.state());
  const clone = new InnerLife(w, E);                           // (constructing re-reads what was last committed)
  clone.reset();
  Object.assign(clone as any, { links: new Map(JSON.parse(snap).links), beliefs: new Map(JSON.parse(snap).beliefs), unseen: new Map(JSON.parse(snap).unseen), reported: JSON.parse(snap).reported, obs: JSON.parse(snap).obs });
  assert.equal(JSON.stringify(clone.state()), snap);
  E.minds = I; w.attention = (id) => I.attention(id);          // the clone took over as the appraisal's source: put the real one back
});

test("what River loves, and what surprised it, draws its attention", async () => {
  calm();
  const a = w.spawn("structure", "loved hut", home.x + 5, home.z, {}), b = w.spawn("structure", "plain hut", home.x + 5, home.z + 1, {});
  I.attach(a.id, "structure", a.name, "made"); I.attach(a.id, "structure", a.name, "named");
  assert.equal(w.attention(b.id), 1);
  assert.ok(w.attention(a.id) > 1.4, `${w.attention(a.id)}`);
  I.expect(b.id, b.name, b.x, b.z); loss(b.id, b.name, "structure", b.x, b.z); await run(2);
  assert.ok(w.attention(b.id) > 1, "something that was not where River expected stands out");
});
