import test from "node:test";
import assert from "node:assert/strict";
import { Engine, canonicalHash } from "../src/sim/engine.ts";
import { dayIndex } from "../src/sim/clock.ts";

const hash = (e: Engine) => canonicalHash({ s: e.state, r: e.rng.save(), j: e.scheduler.save() });
const script = (e: Engine) => { e.enqueue({ type: "move_to", x: 8, z: -3 }); };

test("world pause freezes all authoritative state", () => {
  const e = new Engine(7); script(e); e.run(200);
  e.enqueue({ type: "pause", paused: true }); e.run(1);
  const before = hash(e);
  e.run(6000); e.pump(60_000);
  assert.equal(hash(e), before);
});

test("pump (wall time) matches direct stepping regardless of speed or chunking", () => {
  const a = new Engine(11); script(a); a.run(3000);
  const b = new Engine(11); script(b); b.state.clock.speed = 10;
  let wall = 0; while (b.state.clock.tick < 3000) { b.pump(37, 13); wall += 37; if (wall > 1e7) throw new Error("no progress"); }
  assert.equal(b.state.clock.tick, 3000);
  assert.equal(hash(a).length, hash(b).length);
  // same tick, same inputs => same state (speed is not part of physical state)
  b.state.clock.speed = a.state.clock.speed; b.state.clock.lagMs = a.state.clock.lagMs;
  assert.equal(hash(a), hash(b));
});

test("snapshot/restore continues identically (including RNG and pending jobs)", () => {
  const a = new Engine(3); script(a); a.run(1500);
  const b = Engine.restore(a.snapshot());
  a.run(5000); b.run(5000);
  assert.equal(hash(a), hash(b));
  assert.deepEqual(a.events.filter((x) => x.tick > 1500), b.events);
});

test("same seed and inputs reproduce; different seed diverges in weather timing", () => {
  const run = (seed: number) => { const e = new Engine(seed); e.run(4000); return e.events.filter((x) => x.type === "weather").map((x) => x.tick); };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});

test("river travels, arrives, gets hungry, rests and recovers energy", () => {
  const e = new Engine(1, { river: { x: 0, z: 0, fullness: 100, energy: 50, resting: false, target: null } }); e.enqueue({ type: "move_to", x: 3, z: 4 }); e.run(200);
  assert.ok(e.events.some((x) => x.type === "arrived"));
  assert.ok(e.state.river.energy < 50);
  const low = e.state.river.energy;
  e.enqueue({ type: "rest", seconds: 60 }); e.run(100);
  assert.equal(e.state.river.resting, true);
  e.run(700);
  assert.equal(e.state.river.resting, false);
  assert.ok(e.events.some((x) => x.type === "rest_ended"));
  assert.ok(e.state.river.energy > low);
});

test("plant grows and calendar day advances with the tick, not wall time", () => {
  const e = new Engine(2); const d0 = dayIndex(e.state.clock);
  e.run(6000); assert.ok(e.state.plant.growth > 0.9);
  e.run(14_400 - 6000); // one canonical day = 14,400 ticks
  assert.equal(dayIndex(e.state.clock), d0 + 1);
});

test("pump yields bounded work and keeps lag", () => {
  const e = new Engine(4); e.state.clock.speed = 100;
  assert.equal(e.pump(1000, 50), 50);
  assert.ok(e.state.clock.lagMs > 0);
});
