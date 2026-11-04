// Moving the world faster than real time, and across an absence. Both run the very same fixed ticks as ordinary play (sim.runBatch is the
// host loop's own step with the wall clock taken out), so an advanced world and a stepped one agree tick for tick; nothing is skipped or
// estimated. An advance runs in small batches and yields between them, so a cancel is heard within one batch, and it stops at the
// conditions the human chose: a target, a death, an unresolved urgent decision, or a work budget.
import { db } from "./db.ts";
import { log } from "./bus.ts";
import { cfg } from "./config.ts";
import { simTick, simNow, simPaused, runBatch, setAdvancing, STEP_MS, DAY_MS, lastCommit } from "./sim.ts";
import { recordCommand, finishCommand } from "./recorder.ts";
import { bodyApi } from "./body.ts";
import { kvSet } from "./db.ts";
import type { World } from "./world.ts";
import type { Agent } from "./agent.ts";

/** What an advance needs of the running world. */
export interface AdvanceDeps { world: World; agent: Agent }

export type Until = { kind: "dawn" } | { kind: "ticks"; ticks: number } | { kind: "minutes"; minutes: number };
export interface AdvanceOptions {
  until: Until;
  /** what to do when a decision is unresolved: stop and hand back, wait (bounded) for it to be made, or let it queue and carry on */
  decision?: "stop" | "wait" | "defer";
  /** triggers at or above this urgency (lower number = more urgent) count as critical; default 2 (danger, contact, need) */
  criticalPriority?: number;
  stopOnDeath?: boolean;
  maxWallMs?: number;
  maxTicks?: number;
  batch?: number;
  waitMs?: number;
  label?: string;
}
export type { StopReason, Summary, AdvanceResult, AdvanceProgress } from "../shared/advance.ts";
import type { StopReason, Summary, AdvanceResult, AdvanceProgress } from "../shared/advance.ts";

const nextDawnTick = (rt: AdvanceDeps) => {
  const w = rt.world, f = w.worldTime(), ms = (f < 0.25 ? 0.25 - f : 1.25 - f) * DAY_MS;
  return simTick() + Math.ceil(ms / STEP_MS);
};
export const targetFor = (rt: AdvanceDeps, u: Until) => u.kind === "dawn" ? nextDawnTick(rt) : u.kind === "ticks" ? simTick() + Math.max(0, Math.floor(u.ticks)) : simTick() + Math.ceil((u.minutes * 60_000) / STEP_MS);

const tick = () => new Promise<void>((r) => setImmediate(r));
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Advancer {
  current: AdvanceProgress | null = null;
  last: AdvanceResult | null = null;
  onProgress: (p: AdvanceProgress | null, done?: AdvanceResult) => void = () => {};
  private cancelled = false;
  private seq = 0;
  constructor(private rt: AdvanceDeps) {}

  /** Ask a running advance to stop. It does so before its next batch. */
  cancel() { this.cancelled = true; }

  async run(o: AdvanceOptions): Promise<AdvanceResult> {
    const rt = this.rt, w = rt.world, agent = rt.agent;
    if (this.current) throw new Error("an advance is already running");
    const id = ++this.seq, label = o.label ?? (o.until.kind === "dawn" ? "advance to dawn" : "advance");
    const startTick = simTick(), target = targetFor(rt, o.until), t0 = performance.now(), batch = Math.max(1, o.batch ?? 100);
    const policy = o.decision ?? "stop", crit = o.criticalPriority ?? 2, stopOnDeath = o.stopOnDeath ?? true;
    const before = this.snapshot(), raised0 = { ...agent.raised };
    let reason: StopReason = "target", note: string | undefined;
    this.cancelled = false;
    this.current = { id, label, startTick, tick: startTick, target, pct: 0, ticksPerSec: 0 };
    setAdvancing(true);
    try {
      // an unresolved decision that was already there when we began is not a reason to stop; a new one is
      let armed = !(agent.decisionState(crit).urgent && policy === "stop");
      const critical = () => { const u = agent.decisionState(crit).urgent; if (!u) armed = true; return policy === "stop" && armed && u; };
      const stopNow = () => (stopOnDeath && bodyApi.isDead()) || critical();
      if (simPaused() && target > startTick) reason = "frozen";
      else if (stopOnDeath && bodyApi.isDead()) reason = "death";
      else while (simTick() < target) {
        if (this.cancelled) { reason = "cancelled"; break; }
        if (o.maxTicks !== undefined && simTick() - startTick >= o.maxTicks) { reason = "budget"; break; }
        if (o.maxWallMs !== undefined && performance.now() - t0 >= o.maxWallMs) { reason = "budget"; break; }
        const ran = await runBatch(Math.min(batch, target - simTick(), o.maxTicks !== undefined ? o.maxTicks - (simTick() - startTick) : Infinity), stopNow);
        const dt = Math.max(1, performance.now() - t0), ticks = simTick() - startTick;
        this.current = { id, label, startTick, tick: simTick(), target, pct: Math.min(1, ticks / Math.max(1, target - startTick)), ticksPerSec: Math.round((ticks * 1000) / dt) };
        this.onProgress(this.current);
        if (ran === 0) { reason = "frozen"; break; }
        if (stopOnDeath && bodyApi.isDead()) { reason = "death"; break; }
        if (policy === "stop" && armed && agent.decisionState(crit).urgent) { reason = "decision"; break; }
        if (policy === "wait" && agent.decisionState(crit).thinking) {          // let the decision be made, within a bound, then carry on
          const until = performance.now() + (o.waitMs ?? 20_000);
          while (agent.decisionState(crit).thinking && performance.now() < until && !this.cancelled) await pause(20);
          if (agent.decisionState(crit).thinking) { reason = "decision"; note = "the decision was still being made when the wait ended"; break; }
        }
        await tick();                                       // yield: a cancel, a command or a reply from the model can arrive here
      }
    } finally { setAdvancing(false); this.current = null; }
    const endTick = simTick(), wallMs = Math.round(performance.now() - t0), ticks = endTick - startTick;
    const result: AdvanceResult = {
      id, label, reason, startTick, endTick, target, ticks, wallMs, ticksPerSec: Math.round((ticks * 1000) / Math.max(1, wallMs)),
      summary: this.summarise(startTick, endTick, before, raised0), ...(note ? { note } : {}),
    };
    this.last = result; this.onProgress(null, result);
    return result;
  }

  private snapshot() { const w = this.rt.world; return { day: w.day(), needs: { ...w.me.needs } as Record<string, number> }; }
  private summarise(from: number, to: number, before: { day: number; needs: Record<string, number> }, raised0: Record<string, number | undefined>): Summary {
    const w = this.rt.world, t1 = simNow(), t0 = t1 - (to - from) * STEP_MS;
    const q = <T,>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...a as any[]) as T[];
    const events: Record<string, number> = {};
    for (const r of q<{ kind: string; n: number }>("SELECT kind, COUNT(*) n FROM events WHERE ts > ? AND ts <= ? GROUP BY kind", t0, t1)) events[r.kind] = r.n;
    const moments = q<{ title: string }>("SELECT title FROM moments WHERE ts > ? AND ts <= ? ORDER BY intensity DESC LIMIT 5", t0, t1).map((m) => m.title);
    const made = (q<{ n: number }>("SELECT COUNT(*) n FROM item_events WHERE tick > ? AND tick <= ? AND type IN ('created','adopted')", from, to)[0]?.n) ?? 0;
    const lost = (q<{ n: number }>("SELECT COUNT(*) n FROM item_events WHERE tick > ? AND tick <= ? AND type = 'consumed'", from, to)[0]?.n) ?? 0;
    const dec = q<{ n: number; tok: number | null }>("SELECT COUNT(*) n, SUM(in_tokens + out_tokens) tok FROM brain_decisions WHERE tick > ? AND tick <= ?", from, to)[0];
    const raised: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.rt.agent.raised)) { const d = (v ?? 0) - (raised0[k] ?? 0); if (d > 0) raised[k] = d; }
    return {
      fromTick: from, toTick: to, simSeconds: Math.round(((to - from) * STEP_MS) / 1000), fromDay: before.day, toDay: w.day(),
      events, moments, deaths: bodyApi.isDead() ? 1 : 0, items: { made, lost }, decisions: { raised, taken: dec?.n ?? 0, tokens: dec?.tok ?? 0 },
      needs: { before: before.needs, after: { ...w.me.needs } },
    };
  }
}

export interface CatchUp { at: number; absentMs: number; speed: number; ticksOwed: number; ticksRun: number; deferredWallMs: number; reason: StopReason; summary: Summary }

/**
 * After an absence: if the human chose to have the world catch up, advance it by the time that passed (at the speed it was running),
 * bounded to a number of days. What is beyond the bound is reported as not simulated, never silently dropped or silently run.
 * The brain is not running yet, so what would have needed a decision is counted, not decided.
 */
export async function catchUp(adv: Advancer, now = Date.now()): Promise<CatchUp | null> {
  if (!cfg("offlineCatchup") || !lastCommit.wall || lastCommit.paused) return null;
  const absentMs = now - lastCommit.wall;
  if (absentMs < 60_000) return null;                                           // a restart is not an absence
  const owed = Math.floor((absentMs * lastCommit.speed) / STEP_MS), cap = Math.round(cfg("catchupMaxDays") * (DAY_MS / STEP_MS));
  const ticks = Math.min(owed, cap), deferredWallMs = Math.round(((owed - ticks) * STEP_MS) / lastCommit.speed);
  const seq = recordCommand("external", "catchup", { absentMs, speed: lastCommit.speed, owed, ticks });
  const r = await adv.run({ until: { kind: "ticks", ticks }, decision: "defer", stopOnDeath: true, label: "catching up" });
  const out: CatchUp = { at: now, absentMs, speed: lastCommit.speed, ticksOwed: owed, ticksRun: r.ticks, deferredWallMs, reason: r.reason, summary: r.summary };
  finishCommand(seq, "ok", `${r.ticks} of ${owed} ticks`);
  kvSet("catchup", out);
  log("system", `While you were away (${Math.round(absentMs / 60_000)} min), the world ran ${Math.round(r.summary.simSeconds / 60)} minutes forward${deferredWallMs ? `; ${Math.round(deferredWallMs / 60_000)} minutes of absence were not simulated` : ""}.`);
  return out;
}
