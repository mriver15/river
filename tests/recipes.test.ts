import test from "node:test";
import assert from "node:assert/strict";
import { RECIPES, matchRecipe, recipeById, recipeByName, type Candidate } from "../src/content/recipes.ts";
import { defById } from "../src/content/items.ts";

const c = (id: string, defId: string, qty = 1, durability = 1): Candidate => ({ id, defId, qty, durability, massKg: defById(defId).massKg });

test("parts are matched by what they can do, not by name", () => {
  const spear = recipeById("spear")!;
  const ok = matchRecipe(spear, [c("a", "sharpened_stick"), c("b", "stone"), c("c", "bark")]);
  assert.equal(ok.ok, true);
  const bad = matchRecipe(spear, [c("a", "sharpened_stick"), c("b", "stone"), c("k", "keepsake")]);          // a keepsake named "rope" still does not bind
  assert.equal(bad.ok, false); assert.match((bad as { why: string }).why, /binding/);
});

test("a plain stick is not a pointed shaft, and a flower is not a binding", () => {
  assert.equal(matchRecipe(recipeById("spear")!, [c("s", "stick"), c("b", "stone"), c("f", "flower")]).ok, false);
});

test("a tool must be in working order", () => {
  const r = recipeById("sharpen_stick")!;
  assert.equal(matchRecipe(r, [c("s", "stick"), c("t", "stone", 1, 0.5)]).ok, true);
  assert.equal(matchRecipe(r, [c("s", "stick"), c("t", "stone", 1, 0)]).ok, false, "a broken stone cuts nothing");
});

test("no unit is used for two roles, and quantities are respected", () => {
  const cord = recipeById("cord")!;
  assert.equal(matchRecipe(cord, [c("b", "bark", 1)]).ok, false, "needs two strips");
  const two = matchRecipe(cord, [c("b", "bark", 2)]);
  assert.equal(two.ok && two.picks.reduce((s, p) => s + p.qty, 0), 2);
  const basket = recipeById("basket")!;
  assert.equal(matchRecipe(basket, [c("b", "bark", 3), c("h", "hide", 1)]).ok, true, "hide binds too");
});

test("matching changes nothing", () => {
  const have = [c("a", "sharpened_stick"), c("b", "stone"), c("c", "bark", 2)];
  const before = JSON.stringify(have);
  matchRecipe(recipeById("spear")!, have); matchRecipe(recipeById("spear")!, have.slice(0, 1));
  assert.equal(JSON.stringify(have), before);
});

test("an assembly respects its mass budget", () => {
  const spear = { ...recipeById("spear")!, limits: { massKg: 0.5, connections: 2 } };
  const m = matchRecipe(spear, [c("a", "sharpened_stick"), c("b", "stone"), c("c", "bark")]);
  assert.equal(m.ok, false); assert.match((m as { why: string }).why, /too heavy/);
});

test("recipes can be found by id or name", () => { assert.equal(recipeByName("stone-tipped spear")?.id, "spear"); assert.equal(recipeByName("basket")?.id, "basket"); assert.ok(RECIPES.length >= 4); });
