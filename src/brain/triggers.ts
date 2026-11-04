// What wakes River's mind. The world runs on its own; the brain is asked to decide only when something warrants it.
// Triggers have a priority, an expiry, a coalescing key and a minimum spacing, so a burst of similar events becomes one
// decision, a threat is never queued behind trivia, and a stale event is dropped instead of acted on late.

export type TriggerKind = "danger" | "contact" | "need" | "failure" | "completion" | "emotion" | "novelty" | "idle";
/** Lower is more urgent. Reflexes act without waiting for any of these. */
export const PRIORITY: Record<TriggerKind, number> = { danger: 0, contact: 1, need: 2, failure: 2, completion: 3, emotion: 4, novelty: 4, idle: 5 };
/** Simulation ticks (100 ms each) before a trigger of this kind is no longer worth acting on. */
export const TTL_TICKS: Record<TriggerKind, number> = { danger: 600, contact: 6000, need: 3000, failure: 1200, completion: 1200, emotion: 600, novelty: 300, idle: 100 };
/** Simulation ticks that must pass between two decisions woken by this kind. */
export const MIN_SPACING_TICKS: Record<TriggerKind, number> = { danger: 30, contact: 0, need: 300, failure: 20, completion: 0, emotion: 200, novelty: 200, idle: 0 };

export interface Trigger {
  id: number; kind: TriggerKind; priority: number;
  /** triggers with the same key merge while pending */
  key: string;
  raisedAt: number; expiresAt: number;
  texts: string[]; count: number;
}

export class TriggerQueue {
  private pending: Trigger[] = [];
  private lastTaken = new Map<TriggerKind, number>();
  private seq = 1;

  /** Raise a trigger. A pending one with the same key absorbs it (texts merge, most urgent priority wins). */
  raise(kind: TriggerKind, text: string, now: number, o: { key?: string; ttl?: number } = {}): Trigger {
    const key = o.key ?? kind, ttl = o.ttl ?? TTL_TICKS[kind];
    const same = this.pending.find((t) => t.key === key);
    if (same) {
      same.count++; if (text && !same.texts.includes(text) && same.texts.length < 6) same.texts.push(text);
      same.expiresAt = Math.max(same.expiresAt, now + ttl);
      if (PRIORITY[kind] < same.priority) { same.kind = kind; same.priority = PRIORITY[kind]; }
      return same;
    }
    const t: Trigger = { id: this.seq++, kind, priority: PRIORITY[kind], key, raisedAt: now, expiresAt: now + ttl, texts: text ? [text] : [], count: 1 };
    this.pending.push(t);
    return t;
  }

  /** Drop what has expired. Returns how many were dropped. */
  expire(now: number): number { const n = this.pending.length; this.pending = this.pending.filter((t) => t.expiresAt > now); return n - this.pending.length; }

  /** Most urgent pending priority that is allowed to wake a decision now, or null. */
  peek(now: number): number | null {
    this.expire(now);
    const ok = this.pending.filter((t) => this.eligible(t, now));
    return ok.length ? Math.min(...ok.map((t) => t.priority)) : null;
  }
  /**
   * Take everything eligible as one batch (one decision answers them all), most urgent first.
   * Triggers that are still inside their minimum spacing stay pending.
   */
  take(now: number): Trigger[] {
    this.expire(now);
    const ok = this.pending.filter((t) => this.eligible(t, now)).sort((a, b) => a.priority - b.priority || a.raisedAt - b.raisedAt || a.id - b.id);
    if (!ok.length) return [];
    this.pending = this.pending.filter((t) => !ok.includes(t));
    for (const t of ok) this.lastTaken.set(t.kind, now);
    return ok;
  }
  private eligible(t: Trigger, now: number): boolean {
    const last = this.lastTaken.get(t.kind);
    return last === undefined || now - last >= MIN_SPACING_TICKS[t.kind] || t.priority <= 1;   // threats and a human voice never wait their turn
  }
  /** Ticks until the earliest pending trigger becomes eligible (0 if one is eligible now), or null if nothing is pending. */
  waitTicks(now: number): number | null {
    this.expire(now);
    if (!this.pending.length) return null;
    return Math.min(...this.pending.map((t) => { const last = this.lastTaken.get(t.kind); return this.eligible(t, now) || last === undefined ? 0 : last + MIN_SPACING_TICKS[t.kind] - now; }));
  }
  get size() { return this.pending.length; }
  list(): readonly Trigger[] { return this.pending; }
  clear() { this.pending = []; }
}

/**
 * A threshold that fires once on the way in and only re-arms after the value has come back out past a different line,
 * so a need that hovers near the edge does not wake the mind every tick.
 */
export class Hysteresis {
  private armed = true;
  constructor(readonly enter: number, readonly exit: number, readonly below = true) {}
  /** True exactly when the value crosses into the zone while armed. */
  update(v: number): boolean {
    const inZone = this.below ? v <= this.enter : v >= this.enter;
    const clear = this.below ? v >= this.exit : v <= this.exit;
    if (this.armed && inZone) { this.armed = false; return true; }
    if (!this.armed && clear) this.armed = true;
    return false;
  }
  reset() { this.armed = true; }
}
