import test from "node:test";
import assert from "node:assert/strict";
import { NO_FACTORS, appraiseAmount, decay, habitKey, habituate } from "../src/mind/appraisal.ts";
import { sense, type Observer } from "../src/mind/perception.ts";
import { grow, newLink } from "../src/mind/links.ts";
import { assertBelief, reviseBelief } from "../src/mind/beliefs.ts";
import { TriggerQueue, MIN_SPACING_TICKS } from "../src/brain/triggers.ts";

const H = 3_600_000, MIN = 60_000;
const firstHab = { f: 1, first: false };

test("attachment, surprise and responsibility make a loss weigh more; control softens a threat", () => {
  const plain = appraiseAmount(0.2, NO_FACTORS, "loss", firstHab).amount;
  assert.ok(appraiseAmount(0.2, { ...NO_FACTORS, attachment: 1 }, "loss", firstHab).amount > plain * 1.5);
  assert.ok(appraiseAmount(0.2, { ...NO_FACTORS, expectationError: 1 }, "loss", firstHab).amount > plain);
  assert.ok(appraiseAmount(0.2, { ...NO_FACTORS, responsibility: 1 }, "loss", firstHab).amount > plain);
  assert.ok(appraiseAmount(0.2, { ...NO_FACTORS, controllability: 1 }, "threat", firstHab).amount < appraiseAmount(0.2, { ...NO_FACTORS, controllability: 0 }, "threat", firstHab).amount);
  assert.ok(appraiseAmount(0.2, { ...NO_FACTORS, vulnerability: 1 }, "gain", firstHab).amount > appraiseAmount(0.2, NO_FACTORS, "gain", firstHab).amount);
});
test("an appraisal explains itself: every multiplier that changed the result is listed", () => {
  const r = appraiseAmount(0.2, { ...NO_FACTORS, attachment: 0.8, expectationError: 0.5 }, "loss", { f: 0.6, first: false });
  assert.deepEqual(r.parts.map((p) => p.name).sort(), ["attachment", "expectation error", "habituation", "relevance"].sort().concat([]).filter((n) => r.parts.some((p) => p.name === n)).sort());
  assert.ok(r.parts.find((p) => p.name === "attachment")!.mult > 1);
  assert.ok(Math.abs(r.amount - Math.min(0.6, 0.2 * r.parts.reduce((a, p) => a * p.mult, 1))) < 0.01);
});
test("amounts are bounded and never negative or non-finite, whatever comes in", () => {
  for (const f of [{ ...NO_FACTORS, attachment: 50 }, { ...NO_FACTORS, relevance: NaN }, { ...NO_FACTORS, expectationError: -3 }]) {
    const a = appraiseAmount(0.5, f as any, "loss", firstHab, Infinity).amount;
    assert.ok(Number.isFinite(a) && a >= 0 && a <= 0.9);
  }
  assert.equal(appraiseAmount(-1, NO_FACTORS, "gain", firstHab).amount, 0);
});

test("decay halves by half-life in simulated seconds and cannot go below zero", () => {
  assert.ok(Math.abs(decay(0.8, 120, 120) - 0.4) < 1e-9);
  assert.equal(decay(0.8, 0, 120), 0.8);
  assert.equal(decay(-1, 10, 120), 0); assert.equal(decay(NaN, 10, 120), 0); assert.equal(decay(0.005, 1, 120), 0);
  assert.equal(decay(0.5, 1e9, Infinity), 0.5, "loneliness has no half-life: only its causes ease it");
  assert.ok(decay(0.9, 100, 60) >= 0 && decay(5, 1, 60) <= 1);
});

test("habituation: the tenth is weaker than the first, and force returns over simulated time", () => {
  let h = undefined as ReturnType<typeof habituate>["next"] | undefined, t = 0;
  const fs: number[] = [];
  for (let i = 0; i < 6; i++) { const r = habituate(h, t, 2 * H); fs.push(r.f); h = r.next; t += 5 * MIN; }
  assert.equal(fs[0], 1); for (let i = 1; i < fs.length; i++) assert.ok(fs[i]! < fs[i - 1]!, "each one lands less");
  const worn = fs.at(-1)!, later = habituate(h, t + 8 * H, 2 * H).f;
  assert.ok(later > worn + 0.4 && later > 0.75, `after eight hours it lands nearly fresh again (${later.toFixed(2)} vs ${worn.toFixed(2)})`);
});
test("habituation keys keep different things apart", () => {
  assert.notEqual(habitKey("loss", "fox_1"), habitKey("loss", "fox_2"));
  assert.notEqual(habitKey("sound", "owl", "night"), habitKey("sound", "owl", "day"));
});

const me: Observer = { x: 0, z: 0, asleep: false, sightRadius: 20, hearing: 1 };
test("perception needs range, light, wakefulness or sound; contact is always direct", () => {
  assert.equal(sense({ at: { x: 10, z: 0 } }, me)?.modality, "sight");
  assert.equal(sense({ at: { x: 60, z: 0 } }, me), null, "too far, and silent");
  assert.equal(sense({ at: { x: 60, z: 0 }, loudness: 80 }, me)?.modality, "hearing");
  assert.equal(sense({ at: { x: 10, z: 0 } }, { ...me, asleep: true }), null, "eyes are closed");
  assert.equal(sense({ at: { x: 30, z: 0 } }, { ...me, sightRadius: 11 }), null, "the dark closes the world in");
  assert.equal(sense({ at: { x: 60, z: 0 }, loudness: 80 }, { ...me, hearing: 0.4 }), null, "a storm drowns it");
  assert.equal(sense({ contact: true }, me)?.modality, "contact");
  const near = sense({ at: { x: 2, z: 0 } }, me)!.confidence, far = sense({ at: { x: 19, z: 0 } }, me)!.confidence;
  assert.ok(near > far, "closer is clearer");
  assert.ok(sense({ at: { x: 60, z: 0 }, loudness: 80 }, me)!.confidence < 0.75, "heard is less certain than seen");
});

test("attachment grows from what River does, with diminishing returns and no farming", () => {
  const l = newLink("i1", "item", "spear", 0);
  grow(l, "made", 0); const made = l.attachment; assert.ok(made > 0.2 && made < 0.4);
  assert.equal(grow(l, "made", 1), false, "it is only made once");
  grow(l, "named", 0); assert.ok(l.attachment > made);
  const before = l.attachment;
  for (let i = 0; i < 20; i++) grow(l, "used", 5 * MIN);                      // twenty uses in one breath count once
  assert.ok(l.attachment - before < 0.05, "repetition within a few minutes cannot be farmed");
  for (let i = 1; i <= 40; i++) grow(l, "used", i * 11 * MIN);
  assert.ok(l.attachment < 1 && l.attachment > before, "a long habit adds more, but never reaches certainty");
  const named = newLink("c", "creature", "x", 0); grow(named, "named", 0);
  assert.ok(named.attachment < 0.3, "a name alone is not love");
  assert.ok(l.evidence.length <= 8);
});

test("beliefs: observations support or contradict, the same one cannot count twice, facts differ from hypotheses", () => {
  let b = assertBelief(undefined, { id: "at:s", proposition: "the spear is at the shrine", subjects: ["s"], kind: "hypothesis", confidence: 0.5, obs: "o1", now: 1 });
  const c0 = b.confidence;
  b = reviseBelief(b, "o2", true, 0.9, 2); assert.ok(b.confidence > c0); assert.equal(b.kind, "fact", "a clear observation makes it a fact");
  const again = reviseBelief(b, "o2", true, 0.9, 3); assert.equal(again.confidence, b.confidence, "the same observation is not evidence twice");
  const down = reviseBelief(b, "o3", false, 1, 4);
  assert.ok(down.confidence < 0.3 && down.contradict.includes("o3") && down.support.includes("o2"), "evidence is kept on both sides");
  assert.equal(down.kind, "hypothesis", "a belief the evidence has turned against is no longer a measured fact");
});

test("a stirred mind lets minor things wait, but threats, needs and a human voice never wait longer", () => {
  const q = new TriggerQueue(); let scale = 2; q.spacingScale = () => scale;
  q.raise("novelty", "a", 0); assert.equal(q.take(0).length, 1);
  q.raise("novelty", "b", 100, { ttl: 2000 }); assert.equal(q.take(100 + MIN_SPACING_TICKS.novelty).length, 0, "absorbed: it waits twice as long");
  assert.equal(q.take(100 + 2 * MIN_SPACING_TICKS.novelty).length, 1);
  for (const k of ["danger", "need", "contact"] as const) { q.raise(k, "x", 1000); q.take(1000); q.raise(k, "y", 1000 + MIN_SPACING_TICKS[k]); assert.equal(q.take(1000 + MIN_SPACING_TICKS[k]).length, 1, `${k} is never delayed by calm or absorption`); }
  scale = 1000; q.raise("emotion", "e", 5000); q.take(5000); q.raise("emotion", "f", 5000 + MIN_SPACING_TICKS.emotion * 2); assert.equal(q.take(5000 + MIN_SPACING_TICKS.emotion * 2).length, 1, "the scale is bounded");
});

import fs from "node:fs";
test("appraisal fixtures: the same scenarios always give the same amounts, so a coefficient change is a deliberate, visible one", () => {
  const rows = JSON.parse(fs.readFileSync(new URL("./fixtures/appraisal.json", import.meta.url), "utf8")) as { name: string; nature: any; base: number; factors: object; hab: { f: number; first: boolean }; amount: number }[];
  assert.ok(rows.length >= 7);
  for (const r of rows) assert.equal(+appraiseAmount(r.base, { ...NO_FACTORS, ...r.factors }, r.nature, r.hab, 1).amount.toFixed(3), r.amount, r.name);
  const by = (n: string) => rows.find((r) => r.name.startsWith(n))!.amount;
  assert.ok(by("tenth") < by("first") && by("a beloved") > by("a stock") * 0.8 && by("its maker") > by("a beloved") * 0.9 && by("a storm in") > by("a storm, rested"));
});
