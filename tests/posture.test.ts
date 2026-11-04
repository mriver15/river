import test from "node:test";
import assert from "node:assert/strict";
import { NEUTRAL_POSTURE, postureOf } from "../src/shared/posture.ts";

const well = { energy: 90, warmth: 80 }, fit = { health: 100 };

test("a settled River stands neutrally", () => {
  const p = postureOf({}, well, fit);
  assert.ok(p.slump < 0.1 && p.tension < 0.1 && Math.abs(p.gaze) < 0.1);
  assert.ok(Math.abs(p.gait - NEUTRAL_POSTURE.gait) < 0.05);
});
test("grief folds the body and drops the eyes; wonder lifts them", () => {
  const grief = postureOf({ grief: 0.9 }, well, fit), wonder = postureOf({ wonder: 0.9 }, well, fit);
  assert.ok(grief.slump > 0.4 && grief.gaze < -0.2 && grief.gait < 1);
  assert.ok(wonder.gaze > 0.4 && wonder.slump < 0.1);
});
test("fear braces the body; play quickens the stride", () => {
  assert.ok(postureOf({ dread: 1 }, well, fit).tension > 0.7);
  assert.ok(postureOf({ playfulness: 1 }, well, fit).gait > 1.1);
});
test("hurt and tired slow the walk, and every channel stays in range", () => {
  const p = postureOf({ grief: 1, loneliness: 1, boredom: 1, dread: 1, frustration: 1 }, { energy: 0, warmth: 0 }, { health: 0, shaking: 5, limp: true });
  for (const v of [p.tension, p.slump]) assert.ok(v >= 0 && v <= 1);
  assert.ok(p.gaze >= -1 && p.gaze <= 1 && p.gait >= 0.6 && p.gait <= 1.25);
  assert.ok(p.gait < 0.8);
});
test("the same inputs always give the same posture", () => {
  assert.deepEqual(postureOf({ pride: 0.4, wonder: 0.2 }, well, fit), postureOf({ pride: 0.4, wonder: 0.2 }, well, fit));
});
