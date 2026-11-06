import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-contenttest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const { defById, capabilitiesOf, registerItems } = await import("../src/content/items.ts");
const { MATERIALS, registerMaterials } = await import("../src/content/materials.ts");
const { RECIPES, recipeById, matchRecipe, registerRecipes } = await import("../src/content/recipes.ts");
const { CONTENT_PACKS } = await import("../src/content/packs/index.ts");
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { takeOneUnit } = await import("../src/server/gathering.ts");

const cand = (defId: string, qty = 1) => ({ id: defId, defId, qty, durability: 1, massKg: defById(defId).massKg });

test("a pack's materials, kinds and recipes are in the engine's registries, and nothing can be replaced", () => {
  for (const p of CONTENT_PACKS) {
    for (const id of Object.keys(p.materials ?? {})) assert.ok(MATERIALS[id], id);
    for (const i of p.items ?? []) assert.equal(defById(i.id).id, i.id);
    for (const r of p.recipes ?? []) assert.ok(recipeById(r.id), r.id);
    assert.ok(p.inspiration.length >= 3, `${p.id} says what it draws on`);
  }
  assert.throws(() => registerMaterials({ copper: { density: 1, retention: 0, traits: [], flammability: 0 } }), /already exists/);
  assert.throws(() => registerItems([{ ...defById("copper_ingot"), massKg: 1 }]), /already exists/);
  assert.throws(() => registerRecipes([recipeById("stone_knife")!]), /already exists/);
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
});

test("what a new thing can do comes from what it is made of and its shape", () => {
  assert.ok(capabilitiesOf(defById("copper_ore")).includes("ore"));
  assert.ok(!capabilitiesOf(defById("copper_ore")).includes("cuts"), "an ore is not an edge");
  assert.ok(capabilitiesOf(defById("reed")).includes("binds"));
  assert.ok(capabilitiesOf(defById("stone_knife")).includes("cuts"));
  assert.ok(capabilitiesOf(defById("copper_knife")).includes("cuts"));
  assert.ok(capabilitiesOf(defById("reed_basket")).includes("holds"));
  assert.ok(capabilitiesOf(defById("clay_pot")).includes("holds-liquid"));
});

test("the ladder works: stone to a knife, ore and fuel to an ingot, an ingot to a better blade", () => {
  const knife = matchRecipe(recipeById("stone_knife")!, [cand("stone"), cand("stick"), cand("cord")]);
  assert.equal(knife.ok, true);
  const noBinding = matchRecipe(recipeById("stone_knife")!, [cand("stone"), cand("stick")]);
  assert.equal(noBinding.ok, false);
  const ingot = matchRecipe(recipeById("copper_ingot")!, [cand("copper_ore", 3), cand("charcoal", 2)]);
  assert.equal(ingot.ok, true);
  assert.equal(matchRecipe(recipeById("copper_ingot")!, [cand("stone", 3), cand("charcoal", 2)]).ok, false, "plain stone is not ore");
  assert.equal(recipeById("copper_ingot")!.place, "fire", "smelting needs a fire");
  const blade = matchRecipe(recipeById("copper_knife")!, [cand("copper_ingot"), cand("stick"), cand("cord"), cand("stone")]);
  assert.equal(blade.ok, true);
  assert.ok(recipeById("copper_knife")!.output.stats!.dmg > recipeById("stone_knife")!.output.stats!.dmg);
});

test("an island has the deposits, and gathering one gives the kind the pack names", async () => {
  const rt = await createRuntime(); startSystems(rt);
  const seam = [...rt.world.entities.values()].find((e) => e.name === "copper seam");
  assert.ok(seam, "a copper seam was laid down");
  assert.ok([...rt.world.entities.values()].some((e) => e.name === "reed bed"));
  const got = takeOneUnit(rt.world, seam!);
  assert.equal(got.kind, "copper_ore"); assert.equal(got.name, "green-streaked stone");
});
