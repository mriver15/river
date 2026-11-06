import test from "node:test";
import assert from "node:assert/strict";
import { healEpoch } from "../src/sim/clock.ts";

const DAY = 1_440_000;

test("a calendar origin ahead of the clock is moved back, keeping the time of day", () => {
  const start = 1_793_773_565_439, now = start + 75_442 * 1000 * 0 + 3.4 * DAY;
  const epoch = now + 50.5 * DAY;                                      // the bug: origin 50 days in the future
  const healed = healEpoch(epoch, now, start);
  const phase = (((now - healed) / DAY) % 1 + 1) % 1, was = (((now - epoch) / DAY) % 1 + 1) % 1;
  assert.ok(Math.abs(phase - was) < 1e-9, "time of day is preserved");
  assert.equal(Math.floor((now - healed) / DAY) + 1, 4, "the day counts the days the clock has run");
  assert.ok(healed <= now);
});

test("healing at the clock's start gives day 1", () => {
  const healed = healEpoch(5 * DAY, 1000, 1000);
  assert.equal(Math.floor((1000 - healed) / DAY) + 1, 1);
});
