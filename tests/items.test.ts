import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-itemtest-"));
process.env.RIVER_DB = path.join(dir, "t.db");
process.env.MOCK_LLM = "1";

// A world from before items had identity: a stack in the pack, a bottle on the ground, a garment being worn.
{
  const { db } = await import("../src/server/db.ts");
  db.prepare("INSERT INTO inventory(id,kind,name,desc,qty,props) VALUES('item_900','stick','stick','A sturdy stick.',4,NULL)").run();
  db.prepare("INSERT INTO entities(id,kind,name,x,z,props) VALUES('item_901','item','old bottle',1,1,?)").run(JSON.stringify({ takeable: true, item: "bottle", itemName: "old bottle", desc: "A bottle." }));
  db.prepare("INSERT INTO kv(k,v) VALUES('worn',?)").run(JSON.stringify([{ slot: "body", garment: "wrap", name: "bark wrap", hex: "#7a6246", warm: 0.18, desc: "bark wrap (brown wrap)" }]));
  db.prepare("INSERT INTO kv(k,v) VALUES('nextId','1000')").run();
}
const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { db } = await import("../src/server/db.ts");
const { recipeById } = await import("../src/content/recipes.ts");
const { checkRecipe, craftNow } = await import("../src/server/crafting.ts");
const { findTool } = await import("../src/server/tools.ts");
const { worn } = await import("../src/server/clothing.ts");
const rt = await createRuntime();
startSystems(rt);
const w = rt.world, R = w.items;
const drain = () => new Promise<void>((r) => setImmediate(r));
async function run(ticks: number, until?: () => boolean) { for (let i = 0; i < ticks && !until?.(); i++) { sim.runTicks(1); await drain(); } }
const carried = (kind: string) => R.carried().filter((i) => i.kind === kind).reduce((a, i) => a + i.qty, 0);
const clearPack = () => { for (const i of R.carried()) R.take(i.id, i.qty); };
const grant = () => { for (const g of ["craft", "build"]) db.prepare("INSERT INTO tools(name, approved) VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET approved = 1").run(g); };

test("a world from before items is adopted without inventing a history", () => {
  const stack = R.get("item_900")!;
  assert.equal(stack.loc.kind, "inventory"); assert.equal(stack.qty, 4); assert.equal(stack.provenance.unknown, true, "origin is marked unknown, not made up");
  assert.equal(R.get("item_901")?.loc.kind, "world"); assert.equal(R.get("item_901")!.defId, "bottle");
  assert.equal(worn().length, 1, "the garment is still worn"); assert.equal(R.equipped()[0]!.kind, "garment");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM inventory").get() as any).n, 0, "the old table no longer holds anything");
  assert.deepEqual(R.audit(), []);
});

test("picking up, putting down and wearing keep an item what it is", () => {
  const e = w.spawn("item", "river glass", w.me.x + 1, w.me.z, { takeable: true, item: "bottle", itemName: "river glass", desc: "A bottle of green glass." });
  const thing = R.get(e.id)!; thing.condition.durability = 0.7; thing.condition.wetness = 0.4;
  const before = JSON.stringify({ prov: thing.provenance, cond: thing.condition, vis: thing.visual });
  const held = R.pickUp(e.id);
  assert.equal(held.id, e.id, "same identity in the hands"); assert.equal(held.loc.kind, "inventory"); assert.equal(w.entities.has(e.id), false);
  const down = R.drop(held.id, 1);
  assert.equal(down.id, e.id, "and on the ground again"); assert.equal(w.entities.get(e.id)?.kind, "item");
  R.pickUp(e.id);
  assert.equal(JSON.stringify({ prov: R.get(e.id)!.provenance, cond: R.get(e.id)!.condition, vis: R.get(e.id)!.visual }), before, "condition, provenance and look are untouched by being moved");
  const g = w.addItem("garment", "reed hat", "A hat.", 1, { garment: "hat", slot: "head", hex: "#aa8844", warm: 0.1 });
  const on = R.equip(g.id, "head");
  assert.equal(on.id, g.id); assert.equal(on.loc.kind, "equipped"); assert.equal(w.inventory.has(g.id), false);
  R.unequip((i) => i.id === g.id); assert.equal(R.get(g.id)!.loc.kind, "inventory");
  assert.ok(R.history(e.id).some((h) => h.type === "picked up") && R.history(e.id).some((h) => h.type === "put down"), "the journey is on record");
  assert.deepEqual(R.audit(), []);
});

test("splitting a stack makes a child with lineage; picking it back up folds it in and says so", () => {
  clearPack();
  const s = w.addItem("stick", "stick", "A stick.", 5);
  const part = R.drop(s.id, 2);
  assert.notEqual(part.id, s.id, "part of a stack is a new thing"); assert.equal(part.qty, 2); assert.equal(R.get(s.id)!.qty, 3);
  assert.equal(part.lineage.splitFrom, s.id); assert.ok(part.provenance.sourceIds.includes(s.id));
  assert.equal(carried("stick") + part.qty, 5, "nothing lost");
  const back = R.pickUp(part.id);
  assert.equal(back.id, s.id); assert.equal(back.qty, 5);
  assert.ok(R.get(s.id)!.lineage.mergedFrom?.includes(part.id), "the merge is recorded");
  const row = db.prepare("SELECT loc_kind, lineage FROM item_instances WHERE id = ?").get(part.id) as any;
  assert.equal(row.loc_kind, "consumed"); assert.equal(JSON.parse(row.lineage).mergedInto, s.id);
  assert.deepEqual(R.audit(), []);
});

test("a named or inscribed thing no longer stacks", () => {
  clearPack();
  const a = w.addItem("stone", "stone", "A stone.", 2); w.addItem("stone", "stone", "A stone.", 1);
  assert.equal(R.carried().filter((i) => i.kind === "stone").length, 1, "plain stones share a stack");
  R.rename(a.id, "my first stone");
  w.addItem("stone", "stone", "A stone.", 1);
  assert.equal(R.carried().filter((i) => i.kind === "stone").length, 2, "the named one stands apart from the plain stack");
  assert.equal(R.carried().find((i) => i.name === "my first stone")!.qty, 1);
  assert.equal(R.carried().find((i) => i.name === "stone")!.qty, 3, "and the plain ones, new and old, still share");
});

test("an invalid recipe changes nothing; a valid one uses up exactly what it declares, and conserves mass", () => {
  clearPack();
  w.addItem("stick", "stick", "A stick.", 2); const stone = w.addItem("stone", "stone", "A stone.", 1); w.addItem("bark", "strip of bark", "Bark.", 3);
  const snapshot = () => JSON.stringify(R.carried().map((i) => [i.id, i.qty, i.condition.durability]));
  const before = snapshot();
  assert.throws(() => checkRecipe(w, recipeById("spear")!), /binding|shaft|missing/i);
  assert.throws(() => craftNow(w, recipeById("spear")!), /can't make/);
  assert.equal(snapshot(), before, "nothing was touched");

  const made = craftNow(w, recipeById("sharpen_stick")!);
  assert.equal(carried("stick"), 1, "one rod used, exactly");
  assert.equal(R.get(stone.id)!.qty, 1, "the scraping stone is kept"); assert.ok(R.get(stone.id)!.condition.durability < 1, "but worn");
  assert.equal(made.item.defId, "sharpened_stick"); assert.ok(made.item.props.dmg > 4 && made.item.props.dmg <= 11);
  const input = made.used.reduce((s, u) => s + u.qty * 0.25, 0);
  assert.ok(R.massOf(made.item) <= input + 1e-9, "the product weighs no more than what went into it");

  const spear = craftNow(w, recipeById("spear")!);
  assert.equal(carried("bark"), 2); assert.equal(R.get(stone.id), undefined, "the stone head was used up"); assert.equal(R.get(made.item.id), undefined, "and the sharpened stick");
  assert.ok(spear.item.props.dmg >= 8 && spear.item.props.dmg <= 20, `dmg ${spear.item.props.dmg}`);
  assert.ok(spear.item.provenance.sourceIds.includes(made.item.id) && spear.item.provenance.sourceIds.includes(stone.id), "it remembers what it was made from");
  assert.deepEqual(R.audit(), []);
});

test("describing a thing grandly does not give it powers", async () => {
  grant(); clearPack();
  w.addItem("stone", "stone", "A stone.", 1); w.addItem("bark", "strip of bark", "Bark.", 1);
  const craft = findTool("craft")!;
  const done = Promise.resolve(craft.run({ ingredients: ["stone", "bark"], name: "Sword of Unbinding", description: "A blade that cuts anything and binds anything and burns forever." }, w));
  await run(60, () => rt.activities.cur === null); const text = await done;
  assert.match(text, /keepsake/); assert.match(text, /does nothing/);
  const k = R.carried().find((i) => i.name === "Sword of Unbinding")!;
  assert.deepEqual(w.items.describe(k).capabilities, [], "no capabilities, whatever the words");
  assert.equal(k.props.dmg, undefined);
});

test("a keepsake cannot stand in for a part, and renaming something does not change what it is", () => {
  clearPack();
  const k = w.addItem("crafted", "perfect rope", "The finest rope.", 1, undefined, { defId: "keepsake" });
  w.addItem("sharpened stick", "sharpened stick", "A pointed stick.", 1, undefined, { defId: "sharpened_stick" }); w.addItem("stone", "stone", "A stone.", 1);
  assert.throws(() => checkRecipe(w, recipeById("spear")!), /binding/);
  R.rename(k.id, "bark"); assert.throws(() => checkRecipe(w, recipeById("spear")!), /binding/);
});

test("fire turns fuel into a little ash and never makes material from nothing; a soaked thing resists", async () => {
  clearPack();
  const plank = w.spawn("item", "driftwood plank", w.me.x + 4, w.me.z, { takeable: true, item: "plank", itemName: "driftwood plank", desc: "A plank." });
  const mass = R.massOf(R.get(plank.id)!);
  const ash = R.burn(plank.id);
  assert.equal(R.get(plank.id), undefined, "the plank is gone"); assert.ok(!w.entities.has(plank.id));
  assert.ok(ash && R.massOf(ash) <= mass * 0.2 + 1e-9, "ash weighs at most a fifth of what burned");
  assert.equal(ash!.provenance.sourceIds[0], plank.id, "and knows what it came from");
  assert.deepEqual(R.audit(), []);
  const stone = w.spawn("item", "grey stone", w.me.x + 5, w.me.z, { takeable: true, item: "stone", itemName: "grey stone", desc: "A stone." });
  assert.equal(R.burn(stone.id), null); assert.equal(R.get(stone.id)?.loc.kind, "world", "stone does not burn");
  const wet = w.spawn("item", "soaked plank", w.me.x + 6, w.me.z, { takeable: true, item: "plank", itemName: "soaked plank", desc: "A plank." });
  R.get(wet.id)!.condition.wetness = 0.9;
  assert.equal(R.burn(wet.id), null); assert.ok(R.get(wet.id), "a soaked plank resists the fire");
  assert.deepEqual(R.audit(), []);
  void run;
});

test("taking a structure down returns only part of what is recorded, never more", async () => {
  grant(); clearPack();
  const s = w.spawn("structure", "lean-to", w.me.x + 2, w.me.z, { shape: "shelter", size: "small", materials: { stick: 6 }, materialKinds: { stick: "stick" }, builtBy: w.me.name, radius: 1.5, colors: {}, colorNames: {} });
  const out = await Promise.resolve(findTool("build")!.run({ action: "take_down", target: s.id }, w));
  assert.ok(carried("stick") <= 6 && carried("stick") >= 1, `recovered ${carried("stick")} of 6`); assert.ok(!w.entities.has(s.id)); assert.match(out, /apart/);
  assert.deepEqual(R.audit(), []);
});

test("containers hold what fits, never themselves, and never in a loop", () => {
  clearPack();
  const stones0 = R.all().filter((i) => i.kind === "stone").reduce((s, i) => s + i.qty, 0);        // (stones left lying about by earlier tests)
  const a = w.addItem("crafted", "basket A", "", 1, undefined, { defId: "basket" }), b = w.addItem("crafted", "basket B", "", 1, undefined, { defId: "basket" });
  w.addItem("stone", "stone", "A stone.", 7);
  const stones = R.carried().find((i) => i.kind === "stone")!;
  assert.throws(() => R.stow(a.id, 1, a.id), /itself/);
  R.stow(b.id, 1, a.id);
  assert.throws(() => R.stow(a.id, 1, b.id), /itself/, "B is inside A, so A cannot go into B");
  assert.throws(() => R.stow(stones.id, 7, a.id), /can only carry/, "7 stones are more than a basket carries");
  R.stow(stones.id, 6, a.id);
  assert.equal(R.contents(a.id).length, 2); assert.ok(R.massOf(R.get(a.id)!) > 3.6);
  const total = () => R.all().filter((i) => i.kind === "stone").reduce((s, i) => s + i.qty, 0);
  assert.equal(total(), stones0 + 7, "nothing lost by stowing");
  R.take(a.id, 1);                                              // the basket is used up: what was inside is not lost or doubled
  assert.equal(total(), stones0 + 7); assert.ok(R.all().filter((i) => i.loc.kind === "world").length >= 2, "its contents land where it was");
  assert.deepEqual(R.audit(), []);
});

test("a reset ends what River carried but leaves the world's things, and the audit stays clean", () => {
  const ground = R.all().filter((i) => i.loc.kind === "world").length;
  w.addItem("berry", "wild berry", "A berry.", 3);
  w.items.reset(false);
  assert.equal(R.carried().length, 0); assert.ok(R.all().every((i) => i.loc.kind === "world"), "everything left is on the ground");
  assert.ok(R.all().filter((i) => i.loc.kind === "world").length >= ground, "the world's things were not touched");
  assert.deepEqual(R.audit(), []);
  void new DatabaseSync(":memory:");
});
