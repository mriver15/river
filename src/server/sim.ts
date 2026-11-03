// The one clock. Every authoritative timer, deadline, sleep and random draw in the server goes through here.
//   simNow()      simulation time in ms, shaped like Date.now() (base + tick * STEP_MS), frozen while the world is paused
//   every(ms, fn) a periodic system, run on its tick in registration order
//   after(ms, fn) / simSleep(ms)   one-shot callbacks and awaitable sleeps, resolved by the tick loop
//   simRng(key)   seeded stream; states persist with the clock
// Wall time only feeds the accumulator in `start()`. Operational timers (API timeouts, token budgets, socket pushes) stay on setTimeout.
import { kvGet, kvSet } from "./db.ts";
import { STEP_MS, DAY_MS, newClock, advanceWall, consumeTicks, ticksFor } from "../sim/clock.ts";
import { Streams, type StreamState } from "../sim/random.ts";

export { STEP_MS, DAY_MS };

interface Saved { base: number; tick: number; speed: number; paused: boolean; seed: number; rng: Record<string, StreamState> }
const saved = kvGet<Saved | null>("sim", null);
const wallBoot = Date.now();

/** Simulation ms at tick 0. A fresh install uses wall time, so legacy timestamps in an existing database stay in the past. */
const base = saved?.base ?? wallBoot;
const clock = newClock(0);
if (saved) Object.assign(clock, { tick: saved.tick, speed: saved.speed, paused: saved.paused });
const streams = new Streams(saved?.seed ?? (wallBoot % 2_000_000_011), saved?.rng ?? {});
export const isFreshClock = !saved;

export const simNow = () => base + clock.tick * STEP_MS;
export const simTick = () => clock.tick;
export const simPaused = () => clock.paused;
export const simSpeed = () => clock.speed;
/** First-boot wall time. Used once, to carry an old wall-clock day phase into the simulation calendar. */
export const legacyWallBoot = wallBoot;

/** A function drawing from the named seeded stream. Cheap to call repeatedly; the stream is looked up lazily. */
export const simRng = (key: string) => () => streams.get(key).next();

interface Periodic { name: string; every: number; offset: number; fn: (dtSec: number) => void }
interface Timer { id: number; due: number; seq: number; fn: () => void }
const systems: Periodic[] = [];
let timers: Timer[] = [];
let timerSeq = 1;

/** Register a periodic system. `fn` receives the elapsed simulation seconds since its last run (exactly `ms / 1000`). */
export function every(ms: number, fn: (dtSec: number) => void, name = "system") {
  const n = Math.max(1, ticksFor(ms));
  systems.push({ name, every: n, offset: systems.length % n, fn: (dt) => fn(dt) });
  systems[systems.length - 1]!.every = n;
}
export function after(ms: number, fn: () => void): number {
  const t: Timer = { id: timerSeq++, due: clock.tick + Math.max(1, ticksFor(ms)), seq: timerSeq, fn };
  timers.push(t); timers.sort((a, b) => a.due - b.due || a.seq - b.seq);
  return t.id;
}
export const cancel = (id: number) => { timers = timers.filter((t) => t.id !== id); };
export const simSleep = (ms: number) => new Promise<void>((r) => { after(ms, r); });

let errorHook: (name: string, e: unknown) => void = (n, e) => console.error(`sim: ${n} failed:`, e);
export const onSimError = (fn: typeof errorHook) => { errorHook = fn; };

function step() {
  clock.tick++;
  const due = timers.findIndex((t) => t.due > clock.tick);
  for (const t of timers.splice(0, due === -1 ? timers.length : due)) { try { t.fn(); } catch (e) { errorHook("timer", e); } }
  for (const s of systems) {
    if ((clock.tick + s.offset) % s.every !== 0) continue;
    try { s.fn((s.every * STEP_MS) / 1000); } catch (e) { errorHook(s.name, e); }
  }
  if (clock.tick % 10 === 0) save();
}

/** Run the ticks owed for `wallMs` of wall time, at most `maxTicks`. Returns the number run. */
export function pump(wallMs: number, maxTicks = 100): number {
  const n = advanceWall(clock, wallMs, maxTicks);
  for (let i = 0; i < n; i++) step();
  consumeTicks(clock, n);
  return n;
}
/** Run exactly n ticks regardless of pause (tests, fast-forward, tools). */
export function runTicks(n: number) { for (let i = 0; i < n; i++) step(); }

export function save() {
  kvSet("sim", { base, tick: clock.tick, speed: clock.speed, paused: clock.paused, seed: streams.seed, rng: streams.save() } satisfies Saved);
}
export function setSimPaused(p: boolean) { clock.paused = p; save(); }
/** 1 = the canonical 24-minute day. 2 = a 12-minute day. */
export function setSimSpeed(s: number) { clock.speed = Math.max(0.1, Math.min(100, s)); save(); }
export const speedForDayMinutes = (minutes: number) => 24 / minutes;

export function simInfo() { return { tick: clock.tick, speed: clock.speed, paused: clock.paused, lagMs: Math.round(clock.lagMs), systems: systems.length, timers: timers.length }; }

let timer: NodeJS.Timeout | null = null;
/** Host loop: a monotonic wall timer feeding the accumulator. Lag is carried, never dropped; work per turn is bounded. */
export function start(hz = 40) {
  if (timer) return;
  let last = performance.now();
  timer = setInterval(() => { const n = performance.now(); pump(n - last); last = n; }, 1000 / hz);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { save(); process.exit(0); });
}
export function stop() { if (timer) clearInterval(timer); timer = null; save(); }
