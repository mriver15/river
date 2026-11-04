// How River's feelings and body show in how it carries itself. These are signals for the eye: they read the simulation and never feed back into it.
import type { EmotionName } from "./emotions.ts";

export interface Posture {
  /** 0..1 how braced the shoulders and arms are */
  tension: number;
  /** -1 eyes down .. 1 eyes up */
  gaze: number;
  /** 0.6..1.25 how brisk the stride is (1 is ordinary) */
  gait: number;
  /** 0..1 how far the body folds forward and the head hangs */
  slump: number;
}
export const NEUTRAL_POSTURE: Posture = { tension: 0, gaze: 0, gait: 1, slump: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const f = (m: Partial<Record<EmotionName, number>>, k: EmotionName) => clamp(m[k] ?? 0, 0, 1);

/** Needs are 0..100 (100 = fine); health is 0..100. These coefficients are looks, chosen to read at a glance. */
export function postureOf(feelings: Partial<Record<EmotionName, number>>, needs: { energy: number; warmth: number }, body: { health: number; shaking?: number; limp?: boolean }): Posture {
  const tired = clamp(1 - needs.energy / 100, 0, 1), cold = clamp(1 - needs.warmth / 100, 0, 1), hurt = clamp(1 - body.health / 100, 0, 1);
  const slump = clamp(f(feelings, "grief") * 0.6 + f(feelings, "loneliness") * 0.3 + f(feelings, "boredom") * 0.2 + tired * 0.5 + hurt * 0.3 - f(feelings, "pride") * 0.3, 0, 1);
  const tension = clamp(f(feelings, "dread") * 0.8 + f(feelings, "frustration") * 0.5 + cold * 0.3 + hurt * 0.3 + clamp(body.shaking ?? 0, 0, 1) * 0.3, 0, 1);
  const gaze = clamp(f(feelings, "wonder") * 0.7 + f(feelings, "playfulness") * 0.3 + f(feelings, "pride") * 0.3 - f(feelings, "grief") * 0.5 - f(feelings, "dread") * 0.15 - slump * 0.5, -1, 1);
  const gait = clamp(1 + f(feelings, "playfulness") * 0.25 + f(feelings, "pride") * 0.1 - slump * 0.4 - hurt * 0.2 - (body.limp ? 0.15 : 0), 0.6, 1.25);
  return { tension, gaze, gait, slump };
}
