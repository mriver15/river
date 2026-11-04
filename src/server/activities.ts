// Activities: bounded, persisted procedures that carry out an intention over many ticks without further thought.
// An activity is data (definition id + version, a step name, a progress record, reservations, a deadline), never a closure,
// so it survives a restart: `resume()` loads the running one and the next tick carries on. Each step is small and deterministic.
// One activity runs at a time (River has one body); starting another interrupts the current one.
import { db } from "./db.ts";
import { bus, log } from "./bus.ts";
import { cfg } from "./config.ts";
import { every, simNow, simTick, simRng, STEP_MS } from "./sim.ts";
import { lifeGen } from "./lifecycle.ts";
import { available, takeLoose, takeOneUnit } from "./gathering.ts";
import { bodyApi } from "./body.ts";
import type { World } from "./world.ts";
import type { Entity } from "../shared/types.ts";

const sr = simRng("activities");

export type Status = "running" | "completed" | "failed" | "interrupted" | "cancelled";
export interface Reservation { entity: string; n: number }
export interface Outcome { ok: boolean; partial?: boolean; text: string; data?: Record<string, unknown> }
export interface Activity {
  id: string; gen: number; def: string; version: string; status: Status; intent: string; source: string;
  params: any; step: string; progress: any; startedTick: number; deadlineTick: number; reservations: Reservation[]; outcome?: Outcome; endedTick?: number;
}
export type DangerKind = "fire" | "injury" | "predator" | "collapse";
export interface Danger { kind: DangerKind; text: string; from?: { x: number; z: number; name: string } }
export class ActivityError extends Error {}

interface Ctx {
  w: World; eng: Activities;
  walk(a: Activity, x: number, z: number, label: string): { state: "moving" } | { state: "arrived" } | { state: "failed"; reason: string };
  /** Drop any walk in progress and its pending result. Called whenever an activity moves from one leg to the next. */
  stopWalk(a: Activity): void;
}
interface Def {
  id: string; version: string;
  /** which dangers stop it */
  interruptedBy: DangerKind[];
  validate(params: any, w: World): string | null;
  init(params: any, w: World): { progress: any; maxTicks: number; step?: string };
  step(a: Activity, c: Ctx): "continue" | Outcome;
  /** re-establish world state that lives outside the database (e.g. lying down) after a restart */
  resume?(a: Activity, w: World): void;
  label(a: Activity): string;
  pct(a: Activity, w: World): number;
}

const dist = (w: World, x: number, z: number) => Math.hypot(x - w.me.x, z - w.me.z);
const secs = (ticks: number) => Math.ceil((ticks * STEP_MS) / 1000);

// ---------- definitions ----------
const travel: Def = {
  id: "travel", version: "1", interruptedBy: ["predator", "injury", "collapse"],
  validate: (p, w) => (typeof p.x === "number" && typeof p.z === "number" && Number.isFinite(p.x + p.z) ? (w.walkable(p.x, p.z) ? null : "that spot is water or off the island") : "a destination is needed"),
  init: (p, w) => { const d = dist(w, p.x, p.z); return { progress: { d0: Math.max(1, d) }, maxTicks: Math.max(900, Math.ceil((d / 2) * 10) + 300) }; },
  step: (a, c) => {
    const r = c.walk(a, a.params.x, a.params.z, a.params.label ?? "there");
    if (r.state === "moving") return "continue";
    if (r.state === "arrived") return { ok: true, text: `Arrived at ${a.params.label ?? "the destination"}.`, data: { arrived: true } };
    return { ok: false, text: r.reason, data: { arrived: false } };
  },
  label: (a) => (a.intent.startsWith("escape") ? a.intent : `walking to ${a.params.label ?? "there"}`),
  pct: (a, w) => Math.max(0, Math.min(1, 1 - dist(w, a.params.x, a.params.z) / (a.progress.d0 || 1))),
};

const rest: Def = {
  id: "rest", version: "1", interruptedBy: ["fire", "injury", "predator"],
  validate: (p) => (Number.isFinite(p.seconds) ? null : "how long?"),
  init: (p, w) => {
    const s = Math.max(3, Math.min(60, Number(p.seconds))), until = simNow() + s * 1000;
    w.beginRest(until);
    return { progress: { until, total: s * 1000, from: simNow(), energy0: w.me.needs.energy }, maxTicks: s * 10 + 100 };
  },
  step: (a, c) => {
    const w = c.w, now = simNow();
    if (w.me.sleeping) return "continue";
    const e = w.me.needs.energy.toFixed(0);
    return now >= a.progress.until ? { ok: true, text: `You rested. Energy: ${e}/100.` }
      : { ok: true, partial: true, text: `You were woken before you were done. Energy: ${e}/100.`, data: { woken: true } };
  },
  resume: (a, w) => w.beginRest(a.progress.until),
  label: () => "resting",
  pct: (a) => Math.max(0, Math.min(1, (simNow() - a.progress.from) / a.progress.total)),
};

const HARVEST_TICKS = 30;               // 3 s for each unit taken
interface GatherProgress { phase: "choose" | "go" | "harvest" | "return"; got: number; want: number; what: string; entity: string | null; tx: number; tz: number; nextAt: number; start: { x: number; z: number } | null; skipped: string[]; items: Record<string, number> }

function matches(e: Entity, what: string): boolean {
  const q = what.toLowerCase().trim();
  return e.id === what || (e.props.yields as string[] | undefined)?.includes(q) === true || e.props.item === q || e.name.toLowerCase().includes(q) || String(e.props.itemName ?? "").toLowerCase().includes(q);
}
function pickSource(w: World, a: Activity, p: GatherProgress): Entity | null {
  const cands = [...w.entities.values()].filter((e) =>
    e.kind !== "animal" && w.isKnown(e) && !p.skipped.includes(e.id) && matches(e, p.what) &&
    ((e.props.yields && available(e, a.id) > 0) || (!e.props.yields && e.props.takeable)));
  cands.sort((x, y) => dist(w, x.x, x.z) - dist(w, y.x, y.z) || (x.id < y.id ? -1 : 1));
  return cands[0] ?? null;
}
function reserve(w: World, a: Activity, e: Entity, need: number) {
  const n = e.props.yields ? Math.min(need, available(e, a.id)) : 1;
  e.props.reserved = { ...(e.props.reserved ?? {}), [a.id]: n }; w.putEntity(e);
  a.reservations = [...a.reservations.filter((r) => r.entity !== e.id), { entity: e.id, n }];
}
function consumeReservation(w: World, a: Activity, e: Entity) {
  const r = a.reservations.find((x) => x.entity === e.id); if (!r) return;
  r.n--; if (e.props.reserved) { e.props.reserved[a.id] = r.n; if (r.n <= 0) delete e.props.reserved[a.id]; if (!Object.keys(e.props.reserved).length) delete e.props.reserved; w.putEntity(e); }
  if (r.n <= 0) a.reservations = a.reservations.filter((x) => x !== r);
}
function release(w: World, a: Activity, entityId?: string) {
  for (const r of a.reservations.filter((x) => !entityId || x.entity === entityId)) {
    const e = w.entities.get(r.entity);
    if (e?.props.reserved) { delete e.props.reserved[a.id]; if (!Object.keys(e.props.reserved).length) delete e.props.reserved; w.putEntity(e); }
  }
  a.reservations = entityId ? a.reservations.filter((x) => x.entity !== entityId) : [];
}
const summary = (p: GatherProgress) => Object.entries(p.items).map(([n, k]) => `${k} ${n}`).join(", ");

const gather: Def = {
  id: "gather", version: "1", interruptedBy: ["fire", "injury", "predator", "collapse"],
  validate: (p) => (typeof p.what !== "string" || !p.what.trim() ? "gather what?" : Number.isInteger(p.quantity) && p.quantity >= 1 && p.quantity <= 12 ? null : "quantity must be a whole number from 1 to 12"),
  init: (p, w): { progress: GatherProgress; maxTicks: number } => ({
    progress: { phase: "choose", got: 0, want: p.quantity, what: p.what.trim(), entity: null, tx: 0, tz: 0, nextAt: 0, start: p.returnToStart ? { x: w.me.x, z: w.me.z } : null, skipped: [], items: {} },
    maxTicks: 1200 + p.quantity * 900,
  }),
  step: (a, c) => {
    const w = c.w, p = a.progress as GatherProgress, tick = simTick();
    const finish = (why?: string): Outcome => {
      const partial = p.got < p.want;
      const text = p.got ? `You gathered ${summary(p)}${partial ? ` (wanted ${p.want}${why ? `; ${why}` : ""})` : ""}.` : `You gathered nothing${why ? `: ${why}` : ""}.`;
      return { ok: p.got > 0, partial: partial && p.got > 0, text, data: { got: p.got, want: p.want, items: p.items } };
    };
    switch (p.phase) {
      case "choose": {
        if (p.got >= p.want) { c.stopWalk(a); p.phase = "return"; return "continue"; }
        const src = pickSource(w, a, p);
        if (!src) { release(w, a); if (p.start && p.got) { c.stopWalk(a); p.phase = "return"; return "continue"; } return finish(p.got ? "nothing more you know of" : `you know of nothing to gather like that`); }
        reserve(w, a, src, p.want - p.got);
        const d = dist(w, src.x, src.z) || 1, k = Math.min(1, 2.4 / d);
        let x = src.x + (w.me.x - src.x) * k, z = src.z + (w.me.z - src.z) * k;
        if (!w.walkable(x, z)) { x = src.x; z = src.z; }
        c.stopWalk(a); p.entity = src.id; p.tx = x; p.tz = z; p.phase = "go"; return "continue";
      }
      case "go": {
        const e = p.entity ? w.entities.get(p.entity) : null;
        if (!e) { release(w, a); p.phase = "choose"; return "continue"; }
        if (w.inReach(e)) { c.stopWalk(a); p.phase = "harvest"; p.nextAt = tick + HARVEST_TICKS; return "continue"; }
        const r = c.walk(a, p.tx, p.tz, e.name);
        if (r.state === "moving") return "continue";
        if (r.state === "failed") { release(w, a); return finish(r.reason); }
        c.stopWalk(a); p.phase = "harvest"; p.nextAt = tick + HARVEST_TICKS; return "continue";
      }
      case "harvest": {
        const e = p.entity ? w.entities.get(p.entity) : null;
        if (!e) { release(w, a); p.phase = "choose"; return "continue"; }
        if (!w.inReach(e)) { c.stopWalk(a); p.phase = "go"; return "continue"; }
        if (tick < p.nextAt) return "continue";
        if (e.props.yields) {
          if (e.props.stock <= 0) { release(w, a, e.id); p.skipped.push(e.id); p.phase = "choose"; return "continue"; }    // picked clean: look elsewhere
          const got = takeOneUnit(w, e, p.what);
          consumeReservation(w, a, e); p.got++; p.items[got.name] = (p.items[got.name] ?? 0) + 1;
        } else { const name = e.name; takeLoose(w, e); release(w, a, e.id); p.got++; p.items[name] = (p.items[name] ?? 0) + 1; p.phase = "choose"; return "continue"; }
        p.nextAt = tick + HARVEST_TICKS;
        if (p.got >= p.want) { release(w, a); c.stopWalk(a); p.phase = "return"; }
        else if (!a.reservations.some((r) => r.entity === e.id)) p.phase = "choose";
        return "continue";
      }
      case "return": {
        if (!p.start) return finish();
        const r = c.walk(a, p.start.x, p.start.z, "where you started");
        if (r.state === "moving") return "continue";
        return finish(r.state === "failed" ? `you could not get back: ${r.reason}` : undefined);
      }
    }
  },
  label: (a) => `gathering ${a.progress.what} (${a.progress.got}/${a.progress.want})`,
  pct: (a) => a.progress.got / a.progress.want,
};

const DEFS: Record<string, Def> = { travel, rest, gather };

// ---------- the engine ----------
export class Activities {
  cur: Activity | null = null;
  private waiters = new Map<string, (o: Outcome) => void>();
  private walkDone = new Map<string, { arrived: boolean; reason?: string }>();
  private seq: number;
  private saved = "";
  private lastHealth = 100; private hurt = false; private lastEscape = -1e9;
  private danger: Danger | null = null;

  constructor(private w: World, private notify: (msg: string, wake?: boolean) => void, private threat: () => { name: string; d: number; x: number; z: number } | null = () => null) {
    this.seq = (db.prepare("SELECT COUNT(*) n FROM sim_activities").get() as { n: number }).n;
    bus.on("attacked", () => { this.hurt = true; });
    w.activities = this; this.ctx = this.makeCtx();
  }

  /** Pick up the activity that was running when the process stopped. */
  resume() {
    const row = db.prepare("SELECT * FROM sim_activities WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as any;
    if (!row) return;
    const a = this.fromRow(row);
    if (a.gen !== lifeGen()) { this.finish(a, "cancelled", { ok: false, text: "a new life began" }, false); return; }
    this.cur = a; this.saved = this.key(a);
    this.w.restoreWalk((r) => this.walkDone.set(a.id, r));      // the walk it was in the middle of, exactly as it was
    DEFS[a.def]?.resume?.(a, this.w);
  }
  start() { every(STEP_MS, () => this.tick(), "activities"); }

  view(): { id: string; kind: string; label: string; pct: number } | null {
    const a = this.cur; if (!a) return null;
    const d = DEFS[a.def]!; return { id: a.id, kind: a.def, label: d.label(a), pct: Math.round(d.pct(a, this.w) * 100) / 100 };
  }

  /** Begin an activity (interrupting the current one). Throws ActivityError if it cannot be done. */
  begin(defId: string, params: any, o: { intent: string; source: "brain" | "human" | "reflex" }): Activity {
    const d = DEFS[defId]; if (!d) throw new ActivityError(`unknown activity ${defId}`);
    const bad = d.validate(params, this.w); if (bad) throw new ActivityError(bad);
    if (this.w.me.sleeping && defId !== "rest") throw new ActivityError("you are asleep");
    if (this.cur) this.finish(this.cur, "cancelled", { ok: false, text: "you changed your mind" });
    const init = d.init(params, this.w);
    const a: Activity = { id: `act_${++this.seq}`, gen: lifeGen(), def: defId, version: d.version, status: "running", intent: o.intent, source: o.source, params, step: init.step ?? "run", progress: init.progress, startedTick: simTick(), deadlineTick: simTick() + init.maxTicks, reservations: [] };
    this.cur = a; this.persist(a); bus.emit("state");
    return a;
  }
  /** Resolves when the activity ends, however it ends. If nobody is waiting (after a restart), River is told instead. */
  completion(id: string): Promise<Outcome> { return new Promise((res) => this.waiters.set(id, res)); }
  cancel(reason = "you stopped"): boolean { if (!this.cur) return false; this.finish(this.cur, "cancelled", { ok: false, text: reason }); return true; }
  reset() {
    if (this.cur) this.finish(this.cur, "cancelled", { ok: false, text: "a new life began" }, false);
    db.exec("DELETE FROM sim_activities"); this.walkDone.clear(); this.waiters.clear(); this.hurt = false;
  }

  private key(a: Activity) { return JSON.stringify([a.step, a.progress, a.reservations]); }
  private persist(a: Activity) {
    db.prepare("INSERT OR REPLACE INTO sim_activities(id, gen, def, def_version, status, intent, source, params, step, progress, started_tick, deadline_tick, reservations, outcome, ended_tick) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(a.id, a.gen, a.def, a.version, a.status, a.intent, a.source, JSON.stringify(a.params), a.step, JSON.stringify(a.progress), a.startedTick, a.deadlineTick, JSON.stringify(a.reservations), a.outcome ? JSON.stringify(a.outcome) : null, a.endedTick ?? null);
    this.saved = this.key(a);
  }
  private fromRow(r: any): Activity {
    return { id: r.id, gen: r.gen, def: r.def, version: r.def_version, status: r.status, intent: r.intent, source: r.source, params: JSON.parse(r.params), step: r.step, progress: JSON.parse(r.progress), startedTick: r.started_tick, deadlineTick: r.deadline_tick, reservations: JSON.parse(r.reservations), outcome: r.outcome ? JSON.parse(r.outcome) : undefined, endedTick: r.ended_tick ?? undefined };
  }

  private ctx!: Ctx;
  private makeCtx(): Ctx {
    return {
    w: this.w, eng: this,
    stopWalk: (a) => { this.w.cancelWalk(); this.walkDone.delete(a.id); },
    walk: (a, x, z, label) => {
      const done = this.walkDone.get(a.id);
      if (done) { this.walkDone.delete(a.id); return done.arrived ? { state: "arrived" } : { state: "failed", reason: done.reason ?? "something stopped you" }; }
      if (!this.w.walk) {
        if (dist(this.w, x, z) < 0.7) return { state: "arrived" };
        this.w.beginWalk(x, z, label, (r) => this.walkDone.set(a.id, r));      // a walk that cannot even begin reports at once
        const early = this.walkDone.get(a.id);
        if (early) { this.walkDone.delete(a.id); return { state: "failed", reason: early.reason ?? "something stopped you" }; }
      }
      return { state: "moving" };
    },
    };
  }

  /** Fire, a wound, a charging predator, a collapse: the body reacts before any thinking. */
  private sense(): Danger | null {
    const w = this.w, me = w.me, health = bodyApi.health();
    const injured = this.hurt || health < this.lastHealth - 2; this.hurt = false; this.lastHealth = health;
    const t = this.threat();
    if (injured) return { kind: "injury", text: "you were hurt", from: t ?? undefined };
    if (t && t.d < 9) return { kind: "predator", text: `a ${t.name} is coming at you`, from: t };
    for (const e of w.entities.values()) if (e.props.burning && Math.hypot(e.x - me.x, e.z - me.z) < 4.5) return { kind: "fire", text: `fire is close (${e.name})`, from: { x: e.x, z: e.z, name: e.name } };
    if (me.sleeping) return { kind: "collapse", text: "you collapsed" };
    return null;
  }

  tick() {
    const a = this.cur, danger = this.sense();
    if (!a) return;
    const d = DEFS[a.def]!;
    if (a.gen !== lifeGen()) { this.finish(a, "cancelled", { ok: false, text: "a new life began" }, false); return; }
    // An instinctive escape is not stopped by what it is escaping from; only a collapse ends it.
    const stops = a.source === "reflex" ? danger?.kind === "collapse" : danger && d.interruptedBy.includes(danger.kind) && !(danger.kind === "collapse" && a.def === "rest");
    if (danger && stops) { this.interrupt(a, danger); return; }
    if (simTick() > a.deadlineTick) { this.finish(a, "failed", { ok: false, text: "it took too long" }); return; }
    const r = d.step(a, this.ctx);
    if (r !== "continue") { this.finish(a, r.ok || r.partial ? "completed" : "failed", r); return; }
    this.w.me.activity = d.label(a);
    if (this.key(a) !== this.saved) this.persist(a);
  }

  private interrupt(a: Activity, danger: Danger) {
    const part = a.def === "gather" && a.progress.got ? ` You had gathered ${summary(a.progress)}.` : "";
    this.finish(a, "interrupted", { ok: false, text: `You stopped: ${danger.text}.${part}`, data: { interrupted: danger.kind, ...(a.def === "gather" ? { got: a.progress.got } : {}) } });
    if (this.w.me.sleeping) this.w.wake();
    log("world", `${this.w.me.name} stopped what it was doing: ${danger.text}.`, { perceived: true });
    // The instinct to run: away from whatever is coming, a short way, without waiting to think.
    if ((danger.kind === "predator" || danger.kind === "injury") && danger.from && cfg("reflexEscape") && simTick() - this.lastEscape > 200) {
      this.lastEscape = simTick();
      const me = this.w.me, base = Math.atan2(me.z - danger.from.z, me.x - danger.from.x);
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const x = me.x + Math.cos(base + off) * 12, z = me.z + Math.sin(base + off) * 12;
        if (!this.w.walkable(x, z)) continue;
        try { this.begin("travel", { x, z, label: "somewhere safer" }, { intent: `escape from the ${danger.from.name}`, source: "reflex" }); } catch { /* nowhere to run */ }
        break;
      }
    }
  }

  private finish(a: Activity, status: Status, outcome: Outcome, announce = true) {
    release(this.w, a);
    if (this.cur === a) this.cur = null;
    if (this.w.walk && a.def !== "rest") this.w.cancelWalk();
    this.walkDone.delete(a.id);
    if (a.def === "rest" && this.w.me.sleeping && status !== "interrupted") this.w.wake();
    a.status = status; a.outcome = outcome; a.endedTick = simTick();
    this.persist(a);
    if (this.w.me.activity !== "thinking") this.w.me.activity = "idle";
    bus.emit("state");
    const waiter = this.waiters.get(a.id);
    if (waiter) { this.waiters.delete(a.id); waiter(outcome); }
    else if (announce && a.source !== "reflex") this.notify(`## Something you were doing has ended\n${DEFS[a.def]?.label(a) ?? a.def}: ${outcome.text}`, true);
  }
}

export const activitiesOf = (w: World): Activities => (w as any).activities as Activities;

/** Start an activity and wait for it to end. */
export async function runActivity(w: World, defId: string, params: any, intent: string): Promise<Outcome> {
  const A = activitiesOf(w);
  let act: Activity;
  try { act = A.begin(defId, params, { intent, source: "brain" }); } catch (e) { if (e instanceof ActivityError) return { ok: false, text: e.message }; throw e; }
  return A.completion(act.id);
}
void secs; void sr;
