// The one clock. Every authoritative timer, deadline, sleep and random draw in the server goes through here.
//   simNow()      simulation time in ms, shaped like Date.now() (base + tick * STEP_MS), frozen while the world is paused
//   every(ms, fn) a periodic system, run on its tick in registration order
//   after(ms, fn) / simSleep(ms)   one-shot callbacks and awaitable sleeps, resolved by the tick loop
//   simRng(key)   seeded stream; states persist with the clock
// Wall time only feeds the accumulator in `start()`. Operational timers (API timeouts, token budgets, socket pushes) stay on setTimeout.
import { db, kvGet, kvSet } from "./db.ts";
import { persisted, flushPersisted } from "./persist.ts";
import { STEP_MS, DAY_MS, newClock, advanceWall, consumeTicks, ticksFor } from "../sim/clock.ts";
import { Streams, type StreamState } from "../sim/random.ts";

export { STEP_MS, DAY_MS };

interface Saved { wall0: number; base: number; tick: number; speed: number; paused: boolean; seed: number; rng: Record<string, StreamState>; /** wall time of the last commit, for offline catch-up */ wallSaved?: number }
const saved = kvGet<Saved | null>("sim", null);
const wallBoot = Date.now();

/** Simulation ms at tick 0. A fresh install uses wall time, so legacy timestamps in an existing database stay in the past. */
const base = saved?.base ?? wallBoot;
const clock = newClock(0);
if (saved) Object.assign(clock, { tick: saved.tick, speed: saved.speed, paused: saved.paused });
const streams = new Streams(saved?.seed ?? (wallBoot % 2_000_000_011), saved?.rng ?? {});
export const isFreshClock = !saved;
/** When the last process committed, in wall ms, and the speed it was running at: what offline catch-up converts an absence with. */
export const lastCommit = { wall: saved?.wallSaved ?? 0, speed: saved?.speed ?? 1, tick: saved?.tick ?? 0, paused: saved?.paused ?? false };

export const simNow = () => base + clock.tick * STEP_MS;
/** Simulation ms at tick 0 of this world's clock. */
export const simBase = base;
export const simTick = () => clock.tick;
export const simPaused = () => clock.paused;
export const simSpeed = () => clock.speed;
/** First-boot wall time. Used once, to carry an old wall-clock day phase into the simulation calendar. */
export const legacyWallBoot = saved?.wall0 ?? wallBoot;

/** A function drawing from the named seeded stream. Cheap to call repeatedly; the stream is looked up lazily. */
/** Saved state of every random stream, by key. */
export const rngState = () => streams.save();
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

// ---- persisted jobs: a deadline that carries data, not a closure ----
// `after()` holds a function and is lost on restart. A job names a handler registered at startup and stores its payload, so it
// is committed with the clock and fires after a restart exactly when it would have.
interface Job { id: number; due: number; kind: string; payload: unknown }
let jobs: Job[] = [];
let jobSeq = 1;
const jobState = persisted<{ jobs: Job[]; seq: number }>("jobs", (): { jobs: Job[]; seq: number } => ({ jobs, seq: jobSeq }));
if (jobState) { jobs = jobState.jobs; jobSeq = jobState.seq; }
const handlers = new Map<string, (payload: any) => void>();
export function onJob(kind: string, fn: (payload: any) => void) { handlers.set(kind, fn); }
export function scheduleJob(kind: string, ms: number, payload: unknown = null): number {
  const j: Job = { id: jobSeq++, due: clock.tick + Math.max(1, ticksFor(ms)), kind, payload };
  jobs.push(j); jobs.sort((a, b) => a.due - b.due || a.id - b.id);
  return j.id;
}
export const cancelJob = (id: number) => { jobs = jobs.filter((j) => j.id !== id); };
export const resetJobs = () => { jobs = []; };

let errorHook: (name: string, e: unknown) => void = (n, e) => console.error(`sim: ${n} failed:`, e);
export const onSimError = (fn: typeof errorHook) => { errorHook = fn; };

/** How long recent ticks took in wall time (a measurement for the dashboard and the resource limits; it never feeds back). */
const stepMs = new Float64Array(2000); let stepN = 0;
export function simStepStats() {
  const n = Math.min(stepN, stepMs.length); if (!n) return { n: 0, p50: 0, p95: 0, max: 0 };
  const a = Array.from(stepMs.subarray(0, n)).sort((x, y) => x - y);
  return { n, p50: +a[Math.floor(n * 0.5)]!.toFixed(3), p95: +a[Math.floor(n * 0.95)]!.toFixed(3), max: +a[n - 1]!.toFixed(3) };
}
function step() {
  const t0 = performance.now(); stepOnce(); stepMs[stepN++ % stepMs.length] = performance.now() - t0;
}
function stepOnce() {
  clock.tick++;
  const due = timers.findIndex((t) => t.due > clock.tick);
  for (const t of timers.splice(0, due === -1 ? timers.length : due)) { try { t.fn(); } catch (e) { errorHook("timer", e); } }
  while (jobs.length && jobs[0]!.due <= clock.tick) {
    const j = jobs.shift()!;
    try { handlers.get(j.kind)?.(j.payload); } catch (e) { errorHook(`job ${j.kind}`, e); }
  }
  for (const s of systems) {
    if ((clock.tick + s.offset) % s.every !== 0) continue;
    const t0 = performance.now();
    try { s.fn((s.every * STEP_MS) / 1000); } catch (e) { errorHook(s.name, e); }
    const p = perf.get(s.name) ?? { ms: 0, runs: 0 }; p.ms += performance.now() - t0; p.runs++; perf.set(s.name, p);
  }
}
/** Wall time each periodic system has used (a measurement for the dashboard; it never feeds back into the simulation). */
const perf = new Map<string, { ms: number; runs: number }>();
export const simPerf = () => [...perf].map(([name, p]) => ({ name, ms: +p.ms.toFixed(1), runs: p.runs })).sort((a, b) => b.ms - a.ms);
export const resetSimPerf = () => perf.clear();
/** Ticks per wall second the host loop (or an advance) most recently achieved. */
let rate = { ticksPerSec: 0, at: 0 };
export const simRate = () => rate;

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
  flushPersisted();
  kvSet("sim", { wall0: legacyWallBoot, base, tick: clock.tick, speed: clock.speed, paused: clock.paused, seed: streams.seed, rng: streams.save(), wallSaved: Date.now() } satisfies Saved);
}
export function setSimPaused(p: boolean) { clock.paused = p; save(); }
/** 1 = the canonical 24-minute day. 2 = a 12-minute day. */
export function setSimSpeed(s: number) { clock.speed = Math.max(0.1, Math.min(100, s)); save(); }
export const speedForDayMinutes = (minutes: number) => 24 / minutes;

export function simInfo() { return { tick: clock.tick, speed: clock.speed, paused: clock.paused, lagMs: Math.round(clock.lagMs), systems: systems.length, timers: timers.length, advancing: ffOwner, ticksPerSec: Math.round(rate.ticksPerSec) }; }

// ---- durability: one transaction per host turn ----
// Writes made by ticks, by the continuations between ticks and by commands arriving between turns share one open transaction, which
// is committed at the end of each turn together with the clock itself. A crash therefore leaves the last committed turn, whole.
// Acknowledgements and broadcasts wait for the commit, so nothing is announced that a restart could take back.
let txOpen = false, txSuspended = false;
const afterQ: (() => void)[] = [];
function beginTx() { if (!txOpen && !txSuspended) { db.exec("BEGIN"); txOpen = true; } }
export function commitTx() {
  if (txOpen) { save(); db.exec("COMMIT"); txOpen = false; }
  for (const f of afterQ.splice(0)) { try { f(); } catch (e) { errorHook("after-commit", e); } }
  beginTx();
}
/** Run `fn` once what has been written so far is durable (immediately if no transaction is open). */
export function afterCommit(fn: () => void) { if (txOpen) afterQ.push(fn); else fn(); }
/** Operations that cannot run inside a transaction (VACUUM, their own BEGIN) bracket themselves with these. */
export function suspendTx() { txSuspended = true; commitTx(); }
export function resumeTx() { txSuspended = false; beginTx(); }

let timer: NodeJS.Timeout | null = null, hosted = false;
/** While an advance owns the stepping, the host loop stands aside (and does not bank the wall time that passes meanwhile). */
let ffOwner = false;
export const setAdvancing = (on: boolean) => { ffOwner = on; };
export const isAdvancing = () => ffOwner;
const drain = () => new Promise<void>((r) => setImmediate(r));

// ---- the injection queue ----
// Everything that enters the world from outside the tick loop (a brain action, a model's answer, an embedding score) is queued and
// run at a tick boundary, one item at a time, with the event loop drained after each. Independent async chains therefore never
// interleave in an order that depends on timing, and replay, which applies the journal the same way, sees the same order.
interface Injected { fn: () => unknown; resolve: (v: any) => void; reject: (e: unknown) => void }
const injected: Injected[] = [];
/** Run `fn` at the next tick boundary. The promise settles with its result. Without a running host loop, `fn` runs at once. */
export function inject<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!hosted) return Promise.resolve().then(fn);
  return new Promise<T>((resolve, reject) => injected.push({ fn, resolve, reject }));
}
async function flushInjected() {
  while (injected.length) {
    const it = injected.shift()!;
    try { it.resolve(it.fn()); } catch (e) { it.reject(e); }
    await drain();
  }
}
/**
 * Host loop: a monotonic wall timer feeding the accumulator. Lag is carried, never dropped; work per turn is bounded.
 * Each tick is followed by a pass of the event loop, so the continuations of awaited sleeps always finish between ticks:
 * the same interleaving a replay reproduces.
 */
export function start(hz = 40) {
  if (timer) return;
  let last = performance.now(), busy = false;
  hosted = true;
  beginTx();
  timer = setInterval(async () => {
    if (busy) return;
    if (ffOwner) { last = performance.now(); return; }
    busy = true;
    try {
      const t = performance.now(), owed = advanceWall(clock, t - last, 100); last = t;
      let done = 0;
      for (; done < owed && !clock.paused; done++) { step(); await drain(); await flushInjected(); }
      await flushInjected();                              // also while the world is frozen: River may still act on a paused world
      consumeTicks(clock, done);
      if (done) rate = { ticksPerSec: done / Math.max(0.001, (performance.now() - t) / 1000), at: Date.now() };
      commitTx();
    } finally { busy = false; }
  }, 1000 / hz);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { if (txOpen) { save(); db.exec("COMMIT"); } else save(); process.exit(0); });
}
/**
 * Run up to `n` ticks the way the host loop does (one tick, then the event loop, then whatever was injected), without waiting for the
 * wall clock, and commit. This is the only way the world moves faster than real time: the same step, so the same outcome.
 * Returns the ticks run (fewer than `n` if the world is frozen). The caller yields between batches so controls stay responsive.
 */
export async function runBatch(n: number, stopWhen?: () => boolean): Promise<number> {
  let done = 0; const t0 = performance.now();
  for (; done < n && !clock.paused; done++) { step(); await drain(); await flushInjected(); if (stopWhen?.()) { done++; break; } }
  await flushInjected();
  if (done) rate = { ticksPerSec: done / Math.max(0.001, (performance.now() - t0) / 1000), at: Date.now() };
  commitTx();
  return done;
}
export function stop() { if (timer) clearInterval(timer); timer = null; if (txOpen) { save(); db.exec("COMMIT"); txOpen = false; } else save(); }

// A fresh clock is written down at once, so a copy of the database taken at boot carries its base time, seed and first-boot wall time.
if (!saved) save();
