import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-vistest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { db } = await import("../src/server/db.ts");
const { ItemRegistry } = await import("../src/server/items.ts");
const { resolve } = await import("../src/content/visuals.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, R = w.items;
const groundPacket = (id: string) => w.entities.get(id)!.props.visual;

test("an item looks the same on the ground, in the pack and after being put down again", () => {
  const spear = R.add("weapon", "stone-tipped spear", "Made by River.", 1, { crafted: true });
  const inPack = w.inventory.get(spear.id)!.visual!;
  const down = R.drop(spear.id, 1);
  assert.equal(down.id, spear.id);
  const onGround = groundPacket(spear.id);
  assert.deepEqual({ ...onGround, look: 0 }, { ...inPack, look: 0 }, "the same recipe, seed and parameters on the ground");
  assert.deepEqual(resolve(onGround).components, resolve(inPack).components, "and so the same parts");
  const back = R.pickUp(spear.id);
  assert.deepEqual(w.inventory.get(back.id)!.visual, inPack, "picked up again, nothing changed");
});

test("a part of a stack looks like the rest of it, and keeps its look when it is joined back", () => {
  const berries = R.add("berry", "wild berry", "Red.", 5);
  const part = R.drop(berries.id, 2);
  assert.notEqual(part.id, berries.id);
  assert.deepEqual(part.visual, berries.visual, "the same seed, so the same berries");
  assert.equal(groundPacket(part.id).seed, berries.visual.seed);
});

test("appearance is stored with the instance and survives a reload", () => {
  const g = R.add("garment", "bark tunic", "A tunic.", 1, { garment: "tunic", slot: "body", hex: "#7a6246", warm: 0.2 });
  R.patch(g.id, { props: { hex: "#aa3322" } });
  const before = JSON.parse(JSON.stringify(R.get(g.id)!.visual));
  assert.equal(before.parameters.hex, "#aa3322"); assert.equal(before.parameters.garment, "tunic"); assert.equal(before.parameters.variant, "garment");
  const fresh = new ItemRegistry(w); fresh.load();
  assert.deepEqual(fresh.get(g.id)!.visual, before);
  assert.deepEqual(fresh.packet(fresh.get(g.id)!), R.packet(R.get(g.id)!), "and so the same packet");
});

test("equipping keeps the look, and the worn view carries the garment's packet", () => {
  const g = R.add("garment", "moss wrap", "A wrap.", 1, { garment: "wrap", slot: "body", hex: "#5a8a46", warm: 0.2 });
  const before = R.packet(R.get(g.id)!);
  R.equip(g.id, "body");
  assert.deepEqual(R.packet(R.get(g.id)!), before);
});

test("an item on the ground shows getting wet and wearing, and the world is told only when the look changes", () => {
  const stick = R.spawnLoose({ kind: "stick", name: "stick", desc: "A stick.", qty: 1, x: 3, z: 3 });
  assert.equal(groundPacket(stick.id).look.wet, 0);
  const writes = () => (db.prepare("SELECT COUNT(*) AS n FROM entities WHERE id = ?").get(stick.id) as { n: number }).n;
  assert.equal(writes(), 1);
  let told = 0; const orig = w.putEntity.bind(w); w.putEntity = ((e: any) => { if (e.id === stick.id) told++; return orig(e); }) as typeof w.putEntity;
  R.tickCondition(1, 1, 15);                                     // a second of rain: wetter, but not yet visibly so
  assert.equal(told, 0, "a barely damp stick is not news");
  for (let i = 0; i < 60; i++) R.tickCondition(5, 1, 15);
  assert.equal(groundPacket(stick.id).look.wet, 1, "soaked");
  const n = told; assert.ok(n >= 1 && n <= 5, `told ${n} times on the way to soaked, once per visible step`);
  R.wear(stick.id, 0.6);
  assert.equal(groundPacket(stick.id).look.damage, 1);
  w.putEntity = orig;
});

test("a carried hot coal glows in the pack and on the ground", () => {
  const coal = R.add("crafted", "glowing coal", "An ember.", 1, { coal: true });
  for (let i = 0; i < 40; i++) R.tickCondition(5, 0, 15);
  assert.equal(R.packet(R.get(coal.id)!).look.hot, true);
  const down = R.drop(coal.id, 1);
  assert.equal(groundPacket(down.id).look.hot, true);
});

test("no loose item is left without a look the client can draw", () => {
  for (const e of w.entities.values()) if (e.kind === "item") {
    const p = e.props.visual; assert.ok(p, `${e.id} has no visual packet`);
    assert.equal(resolve(p).diagnostic, undefined, `${e.id} (${p.defId}) falls back`);
  }
  assert.deepEqual(R.audit(), []);
});
