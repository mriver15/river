import test from "node:test";
import assert from "node:assert/strict";
import { seasonAt, RULES, SEASONS, rulesFor } from "../src/sim/seasons.ts";

test("a year is four seasons in turn, beginning partway into spring, and it repeats", () => {
  const n = 6, names = Array.from({ length: 5 * n }, (_, i) => seasonAt(i + 1, n).id);
  assert.equal(names[0], "spring");
  assert.deepEqual([...new Set(names)], ["spring", "summer", "autumn", "winter"]);
  assert.equal(seasonAt(1, n).day, 4, "day one is the middle of spring");
  assert.equal(seasonAt(1 + 4 * n, n).id, seasonAt(1, n).id, "a year later it is the same season");
  assert.equal(seasonAt(1 + 4 * n, n).year, 2);
  for (let d = 1; d < 80; d++) { const s = seasonAt(d, n); assert.ok(s.progress >= 0 && s.progress < 1 && s.day >= 1 && s.day <= n); }
});

test("with no season length there are no seasons: it is a steady, mild summer", () => {
  assert.equal(seasonAt(1, 0).id, "summer"); assert.equal(seasonAt(500, 0).id, "summer");
  assert.equal(rulesFor(40, 0).cold, 0.6 * 1);
});

test("winter is colder, barer and slower to grow back than summer, and every season has something to say", () => {
  assert.ok(RULES.winter.cold > RULES.autumn.cold && RULES.autumn.cold > RULES.spring.cold && RULES.spring.cold > RULES.summer.cold);
  assert.ok(RULES.winter.regrow < RULES.autumn.regrow && RULES.spring.regrow > RULES.summer.regrow);
  assert.ok(RULES.winter.growth < 0 && RULES.spring.growth > 0);
  for (const s of SEASONS) assert.ok(RULES[s].arrives.length > 30, s);
  for (const s of SEASONS) assert.doesNotMatch(RULES[s].arrives, /\b(you should|you must|you need)\b/i);
});
