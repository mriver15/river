import test from "node:test";
import assert from "node:assert/strict";
import { Hysteresis, MIN_SPACING_TICKS, TriggerQueue } from "../src/brain/triggers.ts";
import { assemble, estimateTokens, type Section } from "../src/brain/packet.ts";

test("a threat and a human voice outrank everything, whatever order they arrive in", () => {
  const q = new TriggerQueue();
  q.raise("novelty", "a bird", 10); q.raise("idle", "", 10); q.raise("completion", "done", 11); q.raise("contact", "hello", 12); q.raise("danger", "a wolf", 13);
  assert.deepEqual(q.take(20).map((t) => t.kind), ["danger", "contact", "completion", "novelty", "idle"]);
});

test("triggers with the same key merge into one, keeping the most urgent priority", () => {
  const q = new TriggerQueue();
  q.raise("completion", "gathered sticks", 0, { key: "activity" });
  const t = q.raise("failure", "could not reach the bush", 5, { key: "activity" });
  assert.equal(q.size, 1); assert.equal(t.kind, "failure"); assert.equal(t.count, 2); assert.equal(t.texts.length, 2);
});

test("stale triggers are dropped rather than acted on late", () => {
  const q = new TriggerQueue();
  q.raise("novelty", "a rustle", 0);              // lives 300 ticks
  q.raise("danger", "a wolf", 0);
  assert.equal(q.take(5_000).length, 0, "both have expired");
  q.raise("contact", "hello", 0);                 // a human voice lives much longer
  assert.equal(q.take(5_000).length, 1);
});

test("minimum spacing holds back repeats, except for threats and the human", () => {
  const q = new TriggerQueue();
  q.raise("novelty", "a", 0); assert.equal(q.take(0).length, 1);
  q.raise("novelty", "b", 10); assert.equal(q.take(10).length, 0, "too soon");
  assert.equal(q.waitTicks(10), MIN_SPACING_TICKS.novelty - 10);
  assert.equal(q.take(MIN_SPACING_TICKS.novelty).length, 1);
  q.raise("danger", "x", 300); q.take(300); q.raise("danger", "y", 301);
  assert.equal(q.take(301).length, 1, "a second threat is not made to wait");
});

test("hysteresis wakes the mind once per dip, not once per tick", () => {
  const h = new Hysteresis(15, 30);
  const fired = [40, 20, 14, 13, 15, 14, 12, 29, 31, 14].filter((v) => h.update(v)).length;
  assert.equal(fired, 2, "once on the way down to 14, and once after recovering past 30");
});

const sec = (name: Section["name"], items: Section["items"]): Section => ({ name, title: name, items });

test("critical items are always kept, even when they exceed their share", () => {
  const big = "x".repeat(4000);
  const p = assemble([sec("observations", [{ text: `DANGER ${big}`, critical: true }, { text: "a bird", weight: 1 }]), sec("state", [{ text: "ok" }])], 500, 100);
  assert.ok(p.text.includes("DANGER"));
  assert.equal(p.sections.find((s) => s.name === "observations")!.overCritical, true);
});

test("the rest is admitted by salience until the share is used, and the packet stays within the budget", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ text: `memory ${i} ${"word ".repeat(30)}`, weight: i }));
  const p = assemble([sec("memories", items), sec("state", [{ text: "s".repeat(200) }]), sec("observations", [{ text: "o".repeat(200) }])], 3000, 1500);
  const mem = p.sections.find((s) => s.name === "memories")!;
  assert.ok(mem.kept > 0 && mem.dropped > 0);
  assert.ok(p.tokens <= 3000 - 1500, `variable parts stay within what the fixed parts leave (${p.tokens})`);
  assert.ok(p.text.includes("memory 59 "), "the most salient is kept");
  assert.ok(!p.text.includes("memory 0 "), "the least salient is not");
});

test("token estimates are conservative", () => { assert.ok(estimateTokens("a".repeat(380)) >= 100); });
