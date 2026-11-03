export const WORLD_SIZE = 120; // square, centered on origin
export const HALF = WORLD_SIZE / 2;
export const WATER_LEVEL = 0;
export const DEFAULT_SEED = 1337;

export function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(z - zi);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Deterministic terrain height; shared by server (walkability) and client (mesh). */
export function heightAt(x: number, z: number, seed = DEFAULT_SEED): number {
  const r = Math.hypot(x, z) / (HALF * 0.9);
  const island = 1 - Math.pow(Math.min(r, 1.4), 2.4);
  let n = 0, amp = 1, f = 0.045, tot = 0;
  for (let i = 0; i < 4; i++) {
    n += valueNoise(x * f, z * f, seed + i * 101) * amp;
    tot += amp; amp *= 0.5; f *= 2.1;
  }
  n /= tot;
  return island * 6.5 + (n - 0.5) * 9 - 1.2;
}

export const isLand = (x: number, z: number, seed = DEFAULT_SEED) =>
  Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2 && heightAt(x, z, seed) > WATER_LEVEL + 0.25;

/** 0 = open meadow, 1 = deep grove. A smooth field shared by world generation (placement) and the viewer (ground tint). */
export function groveness(x: number, z: number, seed = DEFAULT_SEED): number {
  const n = valueNoise(x * 0.05, z * 0.05, seed + 11) * 0.65 + valueNoise(x * 0.11, z * 0.11, seed + 12) * 0.35;
  return Math.max(0, Math.min(1, (n - 0.5) * 2.4 + 0.5));
}

export function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
