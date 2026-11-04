import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_DEFS, capabilitiesOf, defById, defForKind } from "../src/content/items.ts";
import { MATERIALS, deriveCapabilities } from "../src/content/materials.ts";

test("every definition is made of known materials with fractions that sum to one", () => {
  for (const d of ITEM_DEFS) {
    assert.ok(d.parts.every((p) => MATERIALS[p.material]), `${d.id} uses an unknown material`);
    assert.ok(Math.abs(d.parts.reduce((s, p) => s + p.fraction, 0) - 1) < 1e-9, `${d.id} fractions`);
    assert.ok(d.massKg > 0 && d.dims.l > 0);
  }
});

test("what a thing can do comes from what it is, not what it is called", () => {
  assert.ok(capabilitiesOf(defById("stick")).includes("shaft"));
  assert.ok(capabilitiesOf(defById("stick")).includes("burns"));
  assert.ok(!capabilitiesOf(defById("stick")).includes("cuts"));
  assert.ok(capabilitiesOf(defById("stone")).includes("cuts"));
  assert.ok(capabilitiesOf(defById("bark")).includes("binds"));
  assert.ok(capabilitiesOf(defById("basket")).includes("holds"));
  assert.deepEqual(capabilitiesOf(defById("keepsake")), [], "a keepsake does nothing, however it is described");
  assert.ok(!capabilitiesOf(defById("stone")).includes("burns"));
});

test("a name or description cannot add a capability: unknown kinds are inert", () => {
  const d = defForKind("magic sword of fire");
  assert.equal(d.id, "generic");
  assert.deepEqual(capabilitiesOf(d), []);
});

test("shape tags only help where the material allows it", () => {
  assert.ok(!deriveCapabilities([{ material: "stone", fraction: 1 }], ["strip"], { l: 0.7, w: 0.05, h: 0.01 }).includes("binds"), "a stone strip does not bind");
  assert.ok(deriveCapabilities([{ material: "hide", fraction: 1 }], ["strip"], { l: 0.7, w: 0.05, h: 0.01 }).includes("binds"));
  assert.ok(!deriveCapabilities([{ material: "wood", fraction: 1 }], ["long"], { l: 0.2, w: 0.03, h: 0.03 }).includes("shaft"), "too short to be a shaft");
});

test("legacy kinds map to definitions", () => {
  for (const k of ["stick", "stone", "berry", "flower", "mushroom", "shell", "clay", "hide", "bark", "moss", "charcoal", "plank", "pigment", "garment", "weapon", "crafted", "bottle", "cup", "lamp", "book", "fish", "meat", "chalk", "seed"])
    assert.notEqual(defForKind(k).id, "generic", k);
});
