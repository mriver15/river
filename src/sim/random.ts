// Seeded, serializable random streams (sfc32). Independent streams derive from world seed + a stable key.
export type StreamState = [number, number, number, number];

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export class RandomStream {
  constructor(public state: StreamState) {}
  static derive(seed: number, key: string): RandomStream {
    const base = hash32(`${seed}:${key}`);
    const s = new RandomStream([base, hash32(key + "a"), hash32(key + "b") ^ seed, 1]);
    for (let i = 0; i < 12; i++) s.next();
    return s;
  }
  /** uniform in [0, 1) */
  next(): number {
    let [a, b, c, d] = this.state;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    this.state = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return (t >>> 0) / 4294967296;
  }
  range(lo: number, hi: number) { return lo + this.next() * (hi - lo); }
}

/** Lazily-created named streams whose states persist in snapshots. */
export class Streams {
  private map = new Map<string, RandomStream>();
  constructor(readonly seed: number, saved: Record<string, StreamState> = {}) {
    for (const [k, s] of Object.entries(saved)) this.map.set(k, new RandomStream([...s] as StreamState));
  }
  get(key: string): RandomStream {
    let s = this.map.get(key);
    if (!s) { s = RandomStream.derive(this.seed, key); this.map.set(key, s); }
    return s;
  }
  save(): Record<string, StreamState> {
    return Object.fromEntries([...this.map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, s]) => [k, [...s.state] as StreamState]));
  }
}
