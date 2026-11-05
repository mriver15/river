import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, SeqTracker } from "../src/shared/protocol.ts";

test("a client builds on a snapshot, takes broadcasts in order, ignores old ones, and asks again on a gap", () => {
  const t = new SeqTracker();
  assert.equal(t.accept(5), "gap", "nothing to build on yet");
  t.reset(10);
  assert.equal(t.accept(11), "ok"); assert.equal(t.accept(12), "ok");
  assert.equal(t.accept(12), "stale", "a repeat is ignored, not applied twice"); assert.equal(t.accept(3), "stale");
  assert.equal(t.accept(14), "gap", "13 never came");
  assert.equal(t.last, 12, "a gap does not move the cursor");
  t.reset(20); assert.equal(t.accept(21), "ok");
});
test("the protocol has a version a client can compare", () => { assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 2); });
