import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_DEFS, defById } from "../src/content/items.ts";
import { GARMENT_SPECS } from "../src/content/recipes.ts";
import {
  BODY_SOCKETS, DesignError, MAX_COMPONENTS, MAX_TRIANGLES, NEW_LOOK, VISUAL_VERSION, boundsOf, collisionBounds, designOf, fit, groundScale, lookOf, orient, resolve,
  validateDesign, visibleParts, visualRecipe, visualRecipeIds, wornDesign, type Component, type Look, type VisualPacket,
} from "../src/content/visuals.ts";

const packet = (defId: string, o: Partial<VisualPacket> = {}): VisualPacket => {
  const d = defById(defId);
  return { recipeId: d.visual, version: VISUAL_VERSION, seed: 12345, parameters: { variant: d.id, ...(d.id === "garment" ? { garment: "tunic" } : {}) }, defId, mats: d.parts.map((p) => p.material), look: NEW_LOOK, ...o };
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test("every definition names a recipe that exists, so nothing falls back to a generic marker", () => {
  for (const d of ITEM_DEFS) {
    assert.ok(visualRecipe(d.visual, VISUAL_VERSION), `${d.id} wants visual "${d.visual}", which has no recipe`);
    assert.equal(resolve(packet(d.id)).diagnostic, undefined, `${d.id} used the stand-in`);
  }
  assert.ok(visualRecipeIds().length >= 12, "at least twelve families");
});

test("a drawn item is exactly the documented size, standing on the ground, and its collision bounds agree", () => {
  for (const d of ITEM_DEFS) {
    const r = resolve(packet(d.id)), b = collisionBounds(d), got = boundsOf(designOf(packet(d.id)));
    for (let a = 0; a < 3; a++) assert.ok(near(got.size[a]!, b.size[a]!), `${d.id}: axis ${a} is ${got.size[a]} but the definition says ${b.size[a]}`);
    assert.ok(near(got.min[1]!, 0, 1e-9), `${d.id} floats or sinks`);
    assert.ok(near(got.min[0]! + got.max[0]!, 0, 1e-9) && near(got.min[2]! + got.max[2]!, 0, 1e-9), `${d.id} is off-centre`);
    assert.equal(r.components.length > 0, true);
  }
});

test("every design is within the component and triangle budgets", () => {
  for (const d of ITEM_DEFS) for (let damage = 0; damage <= 3; damage++) for (const repaired of [false, true]) {
    const all = designOf(packet(d.id));
    assert.ok(all.length <= MAX_COMPONENTS, `${d.id} has ${all.length} components`);
    assert.equal(resolve(packet(d.id, { look: { ...NEW_LOOK, damage, repaired } })).diagnostic, undefined, `${d.id} fails validation`);   // validated as authored, then scaled to size
    const shown = visibleParts(all, { ...NEW_LOOK, damage, repaired });
    assert.ok(shown.length >= 1, `${d.id} disappears at damage ${damage}`);
  }
});

test("the same seed always draws the same thing, and different instances are not clones", () => {
  const a = designOf(packet("food", { seed: 7, parameters: { variant: "berry" } })), b = designOf(packet("food", { seed: 7, parameters: { variant: "berry" } }));
  assert.deepEqual(a, b);
  const seen = new Set<string>();
  for (let s = 1; s <= 12; s++) seen.add(JSON.stringify(designOf(packet("berry", { seed: s * 977 }))));
  assert.ok(seen.size > 1, "twelve berries should not all be identical");
});

test("variants of one family look like what they are", () => {
  const berry = designOf(packet("berry")), mush = designOf(packet("mushroom")), meat = designOf(packet("meat"));
  assert.notDeepEqual(berry.map((k) => k.shape), mush.map((k) => k.shape));
  assert.ok(meat.some((k) => k.shape === "box"));
  assert.ok(designOf(packet("cord")).some((k) => k.shape === "cylinder"), "cord is round");
  assert.ok(designOf(packet("bark")).every((k) => k.shape !== "cylinder" || k.size[1] < 0.02), "bark is flat");
});

test("wet, burnt and heat change how the material looks, not what the item is", () => {
  const dry = resolve(packet("stick")), wet = resolve(packet("stick", { look: { ...NEW_LOOK, wet: 1 } })), burnt = resolve(packet("stick", { look: { ...NEW_LOOK, char: 1 } })), hot = resolve(packet("stone", { look: { ...NEW_LOOK, hot: true } }));
  const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
  assert.ok(lum(wet.style.primary.color) < lum(dry.style.primary.color), "wet is darker");
  assert.ok(wet.style.primary.roughness < dry.style.primary.roughness, "wet is shinier");
  assert.ok(lum(burnt.style.primary.color) < lum(wet.style.primary.color), "char is darker still");
  assert.ok(hot.style.primary.emissiveIntensity > 0 && dry.style.primary.emissiveIntensity === 0, "hot things glow");
  assert.deepEqual(wet.bounds, dry.bounds, "condition never changes the size");
});

test("damage and repair change which components show, and a repaired thing has a fresh part", () => {
  const all = designOf(packet("weapon"));
  const sound = visibleParts(all, NEW_LOOK), broken = visibleParts(all, { ...NEW_LOOK, damage: 3 }), fixed = visibleParts(all, { ...NEW_LOOK, damage: 1, repaired: true });
  assert.notDeepEqual(sound, broken); assert.ok(fixed.some((k) => k.repaired) && !sound.some((k) => k.repaired));
  assert.ok(broken.some((k) => k.damage), "a break leaves splinters");
});

test("condition becomes a quantised look: small drifts do not change it", () => {
  const c = { durability: 1, wetness: 0.01, temperatureC: 15 };
  assert.deepEqual(lookOf(c), NEW_LOOK);
  assert.equal(lookOf({ ...c, wetness: 0.12 }).wet, 0.25 * Math.round(0.12 * 4));
  assert.equal(lookOf({ ...c, durability: 0.5 }).damage, 1); assert.equal(lookOf({ ...c, durability: 0.1 }).damage, 3);
  assert.equal(lookOf({ ...c, temperatureC: 320 }).hot, true);
  assert.equal(lookOf(c, { roasted: true }).char, 0.5);
});

test("an unknown recipe or version draws the right-sized neutral block with a diagnostic, never a misleading model", () => {
  for (const bad of [packet("flute", { recipeId: "flute-of-the-future" }), packet("flute", { version: "99" })]) {
    const r = resolve(bad), d = defById("flute");
    assert.ok(r.diagnostic, "says why");
    assert.equal(r.components.length, 1); assert.equal(r.components[0]!.shape, "box"); assert.equal(r.components[0]!.channel, "secondary");
    assert.ok(near(r.bounds.size[0], d.dims.l) && near(r.bounds.size[2], d.dims.w) && near(r.bounds.size[1], d.dims.h), "dimension-correct");
  }
});

test("an unbounded or hostile design is refused before anything can be allocated", () => {
  const box: Component = { shape: "box", size: [0.1, 0.1, 0.1], pos: [0, 0, 0], channel: "primary" };
  assert.throws(() => validateDesign(Array(MAX_COMPONENTS + 1).fill(box)), DesignError);
  assert.throws(() => validateDesign([]), DesignError);
  assert.throws(() => validateDesign([{ ...box, size: [100, 1, 1] }]), /outside/);
  assert.throws(() => validateDesign([{ ...box, size: [0, 1, 1] }]), /outside/);
  assert.throws(() => validateDesign([{ ...box, size: [NaN, 1, 1] }]), /finite/);
  assert.throws(() => validateDesign([{ ...box, pos: [Infinity, 0, 0] }]), /finite/);
  assert.throws(() => validateDesign([{ ...box, shape: "mesh" as any }]), /approved shape/);
  assert.throws(() => validateDesign([{ ...box, channel: "neon" as any }]), /channel/);
  assert.throws(() => validateDesign([{ ...box, src: "https://example.com/model.glb" } as any]), /unknown component field/);
  assert.throws(() => validateDesign([{ ...box, arc: 2 }]), /arc/);
  const heavy = Array(MAX_COMPONENTS).fill({ ...box, shape: "torus" });
  assert.throws(() => validateDesign(heavy), new RegExp(`${MAX_TRIANGLES}`));
  validateDesign([box]);
});

test("fit makes any design the documented size", () => {
  const f = fit([{ shape: "box", size: [3, 1, 2], pos: [5, 5, 5], channel: "primary" }, { shape: "sphere", size: [1, 1, 1], pos: [6, 6, 6], channel: "accent" }], { l: 0.4, w: 0.2, h: 0.1 });
  const b = boundsOf(f);
  assert.ok(near(b.size[0], 0.4) && near(b.size[1], 0.1) && near(b.size[2], 0.2));
  assert.ok(near(b.min[1], 0));
});

test("tiny things are enlarged to be seen without lying about their size", () => {
  assert.equal(groundScale(defById("stone").dims) >= 1, true);
  const seed = defById("seed");
  assert.ok(groundScale(seed.dims) * Math.max(seed.dims.l, seed.dims.w, seed.dims.h) >= 0.1, "a seed can be seen");
  assert.ok(groundScale(seed.dims) <= 12, "but only so far");
  assert.equal(groundScale({ l: 2, w: 0.1, h: 0.1 }), 1, "a spear is drawn at its size");
  assert.deepEqual(collisionBounds(seed).size, [seed.dims.l, seed.dims.h, seed.dims.w], "the documented footprint is unchanged by display scale");
});

test("every garment can be worn: a body design anchored at its slot's socket", () => {
  for (const [name, spec] of Object.entries(GARMENT_SPECS)) {
    const w = wornDesign(name);
    assert.ok(w, `${name} has no worn design`); assert.equal(w!.slot, (spec as { slot: string }).slot, `${name} is made for another slot`);
    assert.ok(BODY_SOCKETS[w!.slot], "the slot has a socket"); validateDesign(w!.components);
  }
  assert.equal(wornDesign("space helmet"), null);
});

test("orienting a primitive puts its long axis where the design says", () => {
  const along = (k: Component) => { const o = orient(k); return { rot: o.rot, scale: o.scale }; };
  assert.deepEqual(along({ shape: "cylinder", axis: "y", size: [1, 2, 3], pos: [0, 0, 0], channel: "primary" }), { rot: [0, 0, 0], scale: [1, 2, 3] });
  const x = orient({ shape: "cylinder", axis: "x", size: [2, 0.1, 0.1], pos: [0, 0, 0], channel: "primary" });
  assert.ok(near(x.scale[1], 2), "the unit cylinder's height becomes the length along x");
  const z = orient({ shape: "cone", axis: "z", size: [0.1, 0.1, 2], pos: [0, 0, 0], channel: "primary" });
  assert.ok(near(z.scale[1], 2));
});

test("looks are plain data that survive JSON, so a reload cannot change them", () => {
  const p = packet("garment", { seed: 99, parameters: { variant: "garment", garment: "cloak", hex: "#aa3322" }, look: { wet: 0.5, char: 0, damage: 2, hot: false, repaired: true } as Look });
  const q: VisualPacket = JSON.parse(JSON.stringify(p));
  assert.deepEqual(resolve(q), resolve(p));
});
