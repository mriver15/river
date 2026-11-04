// Deterministic route planning over the island: A* on a 1 m grid, eight neighbours, stable tie-breaks, then string-pulled.
// Obstacles are only the ones River knows about (see knowledge.ts); an unknown obstruction is discovered by walking into it.
import { HALF, WORLD_SIZE } from "../shared/noise.ts";
import type { Entity } from "../shared/types.ts";
import type { World } from "./world.ts";

export interface Pt { x: number; z: number }
const N = WORLD_SIZE;                                          // 1 m cells
const cellOf = (v: number) => Math.max(0, Math.min(N - 1, Math.floor(v + HALF)));
const centre = (c: number) => c - HALF + 0.5;
const NB: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];   // fixed order = stable plans

/** A route from `from` to `to` as waypoints (last one is `to`), or null if the known world offers none. */
export function planPath(w: World, from: Pt, to: Pt, known: (e: Entity) => boolean): Pt[] | null {
  const memo = new Uint8Array(N * N);                          // 0 = not computed, 1 = free, 2 = blocked
  const blockedAt = (x: number, z: number) => w.isBlocked(x, z, known);
  const free = (c: number) => { let m = memo[c]!; if (!m) { m = memo[c] = blockedAt(centre(c % N), centre(Math.floor(c / N))) ? 2 : 1; } return m === 1; };

  /** nearest free cell to a point, searching rings outward; ties broken by cell index */
  const nearestFree = (p: Pt): number | null => {
    const cx = cellOf(p.x), cz = cellOf(p.z);
    for (let r = 0; r <= 4; r++) {
      let best: number | null = null, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const c = z * N + x; if (!free(c)) continue;
        const d = Math.hypot(centre(x) - p.x, centre(z) - p.z);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && c < best)) { best = c; bestD = d; }
      }
      if (best !== null) return best;
    }
    return null;
  };

  const s = nearestFree(from), g = nearestFree(to);
  if (s === null || g === null) return null;
  const gx = g % N, gz = Math.floor(g / N);
  const h = (c: number) => { const dx = Math.abs((c % N) - gx), dz = Math.abs(Math.floor(c / N) - gz); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };

  const gs = new Float64Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  const heap: number[] = [];                                   // cell indices, ordered by (f, h, index)
  const f = (c: number) => gs[c]! + h(c);
  const less = (a: number, b: number) => { const fa = f(a), fb = f(b); if (fa !== fb) return fa < fb; const ha = h(a), hb = h(b); if (ha !== hb) return ha < hb; return a < b; };
  const push = (c: number) => { heap.push(c); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; } };
  const pop = () => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l]!, heap[m]!)) m = l; if (r < heap.length && less(heap[r]!, heap[m]!)) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m; } } return top; };

  gs[s] = 0; push(s);
  let found = false;
  while (heap.length) {
    const c = pop(); if (closed[c]) continue; closed[c] = 1;
    if (c === g) { found = true; break; }
    const cx = c % N, cz = Math.floor(c / N);
    for (const [dx, dz] of NB) {
      const x = cx + dx, z = cz + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const n = z * N + x; if (closed[n] || !free(n)) continue;
      if (dx !== 0 && dz !== 0 && (!free(cz * N + x) || !free(z * N + cx))) continue;     // no cutting corners
      const ng = gs[c]! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      if (ng < gs[n]! - 1e-12) { gs[n] = ng; came[n] = c; push(n); }
    }
  }
  if (!found) return null;

  const cells: Pt[] = [];
  for (let c = g; c !== -1; c = came[c]!) cells.push({ x: centre(c % N), z: centre(Math.floor(c / N)) });
  cells.reverse();
  const pts = [from, ...cells.slice(1)];
  const clear = (a: Pt, b: Pt) => { const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.4)); for (let i = 1; i <= n; i++) if (blockedAt(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return false; return true; };
  const out: Pt[] = []; let i = 0;
  while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !clear(pts[i]!, pts[j]!)) j--; out.push(pts[j]!); i = j; }
  if (!out.length) out.push(pts[pts.length - 1]!);
  const last = out[out.length - 1]!;
  if (!blockedAt(to.x, to.z) && Math.hypot(last.x - to.x, last.z - to.z) > 0.01) out.push({ x: to.x, z: to.z });   // end exactly on the target when it is standable
  return out;
}
