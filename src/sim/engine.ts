// Headless engine, first MVP 1 slice: clock, fixed stepping, movement, hunger, rest, one growing plant.
// Rates are per simulation second. Placeholder tuning, to be reconciled with the legacy server values at migration.
import { STEP_MS, ticksFor, newClock, advanceWall, consumeTicks, type SimulationClock } from "./clock.ts";
import { Streams, type StreamState } from "./random.ts";
import { Scheduler, type Job } from "./scheduler.ts";

export const PARAMS = {
  walkSpeed: 1.4,            // metres / s
  hungerPerSec: 100 / 1800,  // fullness lost per s while awake (empty in 30 sim-min)
  restHungerFactor: 0.4,
  restEnergyPerSec: 100 / 300,
  awakeEnergyPerSec: 100 / 2400,
  plantGrowthPerSec: 1 / 600, // 0..1, mature after 10 sim-min
  arrivalRadius: 0.2,
};

export interface WorldState {
  clock: SimulationClock;
  river: { x: number; z: number; fullness: number; energy: number; resting: boolean; target: { x: number; z: number } | null };
  plant: { x: number; z: number; growth: number; rainBoost: boolean };
  weather: "clear" | "rain";
}

export type Command =
  | { type: "move_to"; x: number; z: number }
  | { type: "rest"; seconds: number }
  | { type: "set_speed"; speed: number }
  | { type: "pause"; paused: boolean };

export interface SimEvent { tick: number; type: string; detail?: Record<string, unknown> }
export interface Snapshot { state: WorldState; rng: Record<string, StreamState>; seed: number; scheduler: { nextId: number; jobs: Job[] }; events: number }

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export class Engine {
  state: WorldState;
  rng: Streams;
  scheduler: Scheduler;
  events: SimEvent[] = [];
  private queue: { atTick: number; seq: number; cmd: Command }[] = [];
  private seq = 0;

  constructor(seed: number, init?: Partial<WorldState>) {
    this.rng = new Streams(seed);
    this.scheduler = new Scheduler();
    this.state = {
      clock: newClock(),
      river: { x: 0, z: 0, fullness: 100, energy: 100, resting: false, target: null },
      plant: { x: 5, z: 5, growth: 0, rainBoost: false },
      weather: "clear", ...init,
    };
    this.scheduler.schedule(ticksFor(this.rng.get("weather").range(120_000, 240_000)), "weather");
  }

  /** Queue a command for the next tick it can run on. */
  enqueue(cmd: Command) { this.queue.push({ atTick: this.state.clock.tick + 1, seq: this.seq++, cmd }); }

  private emit(type: string, detail?: Record<string, unknown>) { this.events.push({ tick: this.state.clock.tick, type, detail }); }

  private apply(cmd: Command) {
    const { river, clock } = this.state;
    switch (cmd.type) {
      case "move_to": river.target = { x: cmd.x, z: cmd.z }; river.resting = false; this.emit("move_started", { x: cmd.x, z: cmd.z }); break;
      case "rest": river.resting = true; river.target = null; this.scheduler.schedule(clock.tick + ticksFor(cmd.seconds * 1000), "wake"); this.emit("rest_started"); break;
      case "set_speed": clock.speed = cmd.speed; break;
      case "pause": clock.paused = cmd.paused; break;
    }
  }

  /** Advance exactly one tick, in fixed phase order. Does nothing while the world is paused. */
  step() {
    const s = this.state, c = s.clock;
    if (c.paused) return;
    c.tick++;
    const dt = STEP_MS / 1000, P = PARAMS;
    // 1. commands
    this.queue.sort((a, b) => a.atTick - b.atTick || a.seq - b.seq);
    while (this.queue.length && this.queue[0]!.atTick <= c.tick) this.apply(this.queue.shift()!.cmd);
    // 2. scheduled transitions
    for (const job of this.scheduler.due(c.tick)) {
      if (job.type === "weather") {
        s.weather = s.weather === "clear" ? "rain" : "clear"; this.emit("weather", { weather: s.weather });
        this.scheduler.schedule(c.tick + ticksFor(this.rng.get("weather").range(120_000, 240_000)), "weather");
      } else if (job.type === "wake" && s.river.resting) { s.river.resting = false; this.emit("rest_ended"); }
    }
    // 3. movement
    const r = s.river;
    if (r.target && !r.resting) {
      const dx = r.target.x - r.x, dz = r.target.z - r.z, d = Math.hypot(dx, dz), stepLen = P.walkSpeed * dt;
      if (d <= Math.max(P.arrivalRadius, stepLen)) { r.x = r.target.x; r.z = r.target.z; r.target = null; this.emit("arrived", { x: r.x, z: r.z }); }
      else { r.x += (dx / d) * stepLen; r.z += (dz / d) * stepLen; }
    }
    // 5. physiology and growth
    const wasHungry = r.fullness < 20;
    r.fullness = clamp(r.fullness - P.hungerPerSec * dt * (r.resting ? P.restHungerFactor : 1));
    r.energy = clamp(r.energy + (r.resting ? P.restEnergyPerSec : -P.awakeEnergyPerSec) * dt);
    if (!wasHungry && r.fullness < 20) this.emit("hungry");
    s.plant.growth = Math.min(1, s.plant.growth + P.plantGrowthPerSec * dt * (s.weather === "rain" ? 1.5 : 1));
  }

  /** Run n ticks (skipping any spent paused). */
  run(n: number) { for (let i = 0; i < n; i++) this.step(); }

  /** Host entry: feed elapsed wall time, bounded work per call. Returns ticks executed. */
  pump(wallMs: number, maxTicks = 50): number {
    const c = this.state.clock, n = advanceWall(c, wallMs, maxTicks);
    for (let i = 0; i < n; i++) this.step();
    consumeTicks(c, n);
    return n;
  }

  snapshot(): Snapshot {
    return structuredClone({ state: this.state, rng: this.rng.save(), seed: this.rng.seed, scheduler: this.scheduler.save(), events: this.events.length });
  }
  static restore(snap: Snapshot): Engine {
    const e = new Engine(snap.seed, structuredClone(snap.state));
    e.rng = new Streams(snap.seed, snap.rng);
    e.scheduler = Scheduler.restore(structuredClone(snap.scheduler));
    return e;
  }
}

/** Canonical hash: sorted keys, rejects non-finite numbers. */
export function canonicalHash(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in state");
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as any)[k])]));
    return v;
  };
  const text = JSON.stringify(canon(value));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
