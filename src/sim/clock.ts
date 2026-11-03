// Simulation clock: integer ticks of fixed length. Wall time only feeds the accumulator in `advanceWall`.
export const STEP_MS = 100;
export const DAY_MS = 1_440_000;

export interface SimulationClock {
  tick: number;
  speed: number;           // simulation seconds per wall second
  paused: boolean;
  calendarOriginMs: number; // offset into day 1 at tick 0
  lagMs: number;            // unspent simulation time carried between host turns
}

export const newClock = (calendarOriginMs = 0.3 * DAY_MS): SimulationClock => ({ tick: 0, speed: 1, paused: false, calendarOriginMs, lagMs: 0 });
export const elapsedMs = (c: SimulationClock) => c.tick * STEP_MS;
export const calendarMs = (c: SimulationClock) => c.calendarOriginMs + elapsedMs(c);
export const dayIndex = (c: SimulationClock) => Math.floor(calendarMs(c) / DAY_MS) + 1;
export const dayFraction = (c: SimulationClock) => (calendarMs(c) % DAY_MS) / DAY_MS;
/** Round a duration up to whole ticks. */
export const ticksFor = (ms: number) => Math.ceil(ms / STEP_MS);

/**
 * Convert elapsed wall time into whole ticks owed, keeping the remainder. Lag is never discarded; `maxTicks` bounds
 * work per host turn so controls stay responsive. Paused clocks accumulate nothing.
 */
export function advanceWall(c: SimulationClock, wallMs: number, maxTicks = 50): number {
  if (c.paused || wallMs <= 0) return 0;
  c.lagMs += wallMs * c.speed;
  return Math.min(maxTicks, Math.floor(c.lagMs / STEP_MS));
}
export function consumeTicks(c: SimulationClock, n: number) { c.lagMs -= n * STEP_MS; }
