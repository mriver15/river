// The timeline: one list of what happened, drawn from the committed records (commands, activities, item histories, feeling traces, the
// log, decisions), filterable by who did it, what it was done to, which activity it belonged to, and which event it came from.
// Nothing here is generated: every line is a stored row, so "why did that happen" is answered from the record, not by a model.
import { db } from "./db.ts";
import { simNow, simTick, STEP_MS } from "./sim.ts";

export interface TimelineEntry {
  tick: number;
  source: "command" | "activity" | "item" | "feeling" | "log" | "decision";
  actor: string;
  object?: string;
  activity?: string;
  /** the event this line came from, so a chain can be followed */
  event?: string;
  text: string;
}
export interface TimelineFilter { actor?: string; object?: string; activity?: string; chain?: string; source?: string; fromTick?: number; toTick?: number; limit?: number }

const all = <T,>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const root = (id: string) => id.split(/[#+]/)[0]!;

export function timeline(f: TimelineFilter = {}): TimelineEntry[] {
  const base = simNow() - simTick() * STEP_MS, toTick = (ts: number) => Math.round((ts - base) / STEP_MS);
  const lo = f.fromTick ?? 0, hi = f.toTick ?? Number.MAX_SAFE_INTEGER, cap = 400;
  const out: TimelineEntry[] = [];

  for (const r of all<{ tick: number; source: string; type: string; payload: string; status: string; result: string | null }>("SELECT tick, source, type, payload, status, result FROM sim_commands WHERE tick BETWEEN ? AND ? ORDER BY seq DESC LIMIT ?", lo, hi, cap)) {
    let p: any = {}; try { p = JSON.parse(r.payload); } catch { /* keep empty */ }
    const name = r.type === "tool" ? String(p.name ?? "") : r.type, input = p.input ?? p, obj = input.id ?? input.target ?? input.item ?? input.name ?? p.id;
    out.push({ tick: r.tick, source: "command", actor: r.source === "brain" ? "river" : r.source, object: obj === undefined ? undefined : String(obj), text: `${name}${obj !== undefined ? ` ${obj}` : ""} (${r.status})${r.result ? `: ${clip(r.result, 100)}` : ""}` });
  }
  for (const r of all<{ id: string; def: string; status: string; intent: string; params: string; started_tick: number; ended_tick: number | null; outcome: string | null }>("SELECT id, def, status, intent, params, started_tick, ended_tick, outcome FROM sim_activities ORDER BY started_tick DESC LIMIT ?", cap)) {
    let params: any = {}; try { params = JSON.parse(r.params); } catch { /* keep empty */ }
    const obj = params.what ?? params.target ?? params.name ?? params.recipe;
    if (r.started_tick >= lo && r.started_tick <= hi) out.push({ tick: r.started_tick, source: "activity", actor: "river", object: obj === undefined ? undefined : String(obj), activity: r.id, text: `began ${r.def}${obj !== undefined ? ` (${obj})` : ""}: ${r.intent}` });
    if (r.ended_tick !== null && r.ended_tick >= lo && r.ended_tick <= hi) { let o: any = null; try { o = r.outcome ? JSON.parse(r.outcome) : null; } catch { /* plain */ } out.push({ tick: r.ended_tick, source: "activity", actor: "river", object: obj === undefined ? undefined : String(obj), activity: r.id, text: `${r.def} ${r.status}${o?.text ? `: ${clip(String(o.text), 100)}` : ""}` }); }
  }
  for (const r of all<{ tick: number; item: string; type: string; detail: string }>("SELECT tick, item, type, detail FROM item_events WHERE tick BETWEEN ? AND ? ORDER BY seq DESC LIMIT ?", lo, hi, cap)) {
    out.push({ tick: r.tick, source: "item", actor: "world", object: r.item, text: `${r.item} ${r.type}${r.detail && r.detail !== "{}" ? ` ${clip(r.detail, 80)}` : ""}` });
  }
  for (const r of all<{ tick: number; kind: string; emotion: string | null; subject: string | null; event_id: string | null; prior: number | null; delta: number | null; result: number | null; why: string }>("SELECT tick, kind, emotion, subject, event_id, prior, delta, result, why FROM mind_trace WHERE tick BETWEEN ? AND ? ORDER BY seq DESC LIMIT ?", lo, hi, cap)) {
    const move = r.emotion && r.delta !== null ? `${r.emotion} ${(r.prior ?? 0).toFixed(2)} → ${(r.result ?? 0).toFixed(2)}` : r.kind;
    out.push({ tick: r.tick, source: "feeling", actor: "river", object: r.subject ?? undefined, event: r.event_id ?? undefined, text: `${move}: ${r.why}` });
  }
  for (const r of all<{ ts: number; kind: string; text: string }>("SELECT ts, kind, text FROM events WHERE ts BETWEEN ? AND ? ORDER BY id DESC LIMIT ?", base + lo * STEP_MS, base + Math.min(hi, simTick() + 1) * STEP_MS, cap)) {
    out.push({ tick: toTick(r.ts), source: "log", actor: r.kind === "human" ? "human" : r.kind === "system" ? "system" : "world", text: `${r.kind}: ${clip(r.text)}` });
  }
  for (const r of all<{ tick: number; kinds: string; calls: number; in_tokens: number; out_tokens: number; tools: string }>("SELECT tick, kinds, calls, in_tokens, out_tokens, tools FROM brain_decisions WHERE tick BETWEEN ? AND ? ORDER BY id DESC LIMIT ?", lo, hi, cap)) {
    out.push({ tick: r.tick, source: "decision", actor: "river", text: `decided (woken by ${r.kinds}; ${r.calls} call${r.calls === 1 ? "" : "s"}, ${r.in_tokens + r.out_tokens} tokens)` });
  }

  let list = out;
  if (f.activity) {
    const a = all<{ id: string; started_tick: number; ended_tick: number | null }>("SELECT id, started_tick, ended_tick FROM sim_activities WHERE id = ?", f.activity)[0];
    list = a ? list.filter((e) => e.activity === a.id || (e.source === "command" && e.actor === "river" && e.tick >= a.started_tick && e.tick <= (a.ended_tick ?? simTick()))) : [];
  }
  if (f.chain) {
    const id = root(f.chain), subject = id.includes(":") ? id.split(":").slice(1).join(":").replace(/@.*/, "") : id;
    list = list.filter((e) => (e.event && root(e.event) === id) || (e.source === "item" && e.object === subject) || (e.source === "feeling" && e.object === subject));
  }
  if (f.actor) { const a = f.actor.toLowerCase(); list = list.filter((e) => e.actor === a); }
  if (f.source) list = list.filter((e) => e.source === f.source);
  if (f.object) { const o = f.object.toLowerCase(); list = list.filter((e) => e.object?.toLowerCase() === o || e.object?.toLowerCase().includes(o) || e.text.toLowerCase().includes(o)); }
  return list.sort((a, b) => b.tick - a.tick || (a.source < b.source ? -1 : 1)).slice(0, f.limit ?? 200);
}
