import { el, ago } from "../dom.ts";
import { send } from "../state.ts";
import type { AdvanceProgress, AdvanceResult } from "../../shared/advance.ts";

const num = (v: number) => v.toLocaleString();
const mins = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const why: Record<string, string> = { target: "reached its target", death: "stopped: River died", decision: "stopped: an urgent decision was waiting", cancelled: "cancelled", budget: "stopped at its work limit", frozen: "the world is frozen" };

let progressBox: HTMLElement | null = null;
/** An advance reports in; show how far it has got. */
export function onAdvance(p: AdvanceProgress | null, done?: AdvanceResult) {
  if (!progressBox || !progressBox.isConnected) return;
  progressBox.replaceChildren();
  if (p) {
    const bar = el("div", ""); bar.setAttribute("style", "height:6px;border-radius:3px;background:var(--line,#8884);overflow:hidden;margin:6px 0");
    const fill = el("div", ""); fill.setAttribute("style", `height:100%;width:${Math.round(p.pct * 100)}%;background:var(--accent,#6a9)`); bar.append(fill);
    const cancel = el("button", "btn sm no", "Stop"); cancel.onclick = () => send({ t: "sim_cancel" });
    const row = el("div", "row"); row.append(el("span", "muted small", `${p.label}: ${Math.round(p.pct * 100)}% · ${num(p.ticksPerSec)} ticks/s`), cancel);
    progressBox.append(row, bar);
  } else if (done) progressBox.append(el("div", "muted small", `${why[done.reason] ?? done.reason}: ${mins(done.summary.simSeconds)} of world time in ${(done.wallMs / 1000).toFixed(1)} s.`));
}

function summaryCard(title: string, s: AdvanceResult["summary"], note?: string): HTMLElement {
  const c = el("div", "card"); c.append(el("div", "row", title));
  c.append(el("div", "muted small", `${mins(s.simSeconds)} of world time · day ${s.fromDay}${s.toDay !== s.fromDay ? ` to day ${s.toDay}` : ""}${note ? ` · ${note}` : ""}`));
  const ev = Object.entries(s.events).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${n} ${k}`).join(", ");
  if (ev) c.append(el("div", "muted small", `What was logged: ${ev}`));
  if (s.moments.length) c.append(el("div", "muted small", `Moments: ${s.moments.join("; ")}`));
  const d = s.decisions, raised = Object.entries(d.raised).map(([k, n]) => `${n} ${k}`).join(", ");
  c.append(el("div", "muted small", `Decisions: ${d.taken} made${d.tokens ? ` (${num(d.tokens)} tokens)` : ""}${raised ? ` · called for: ${raised}` : ""}`));
  c.append(el("div", "muted small", `Items: ${s.items.made} made or found, ${s.items.lost} used up${s.deaths ? " · River died" : ""}`));
  const ch = (["energy", "hunger", "mood", "warmth"] as const).map((k) => `${k} ${Math.round(s.needs.before[k] ?? 0)}→${Math.round(s.needs.after[k] ?? 0)}`).join(", ");
  c.append(el("div", "muted small", `Needs: ${ch}`));
  return c;
}

/** The simulation panel, the timeline and the parameter controls. */
export async function loadSim(into: HTMLElement) {
  let s: any;
  try { s = await (await fetch("/api/sim")).json(); } catch { return; }
  const clock = el("div", "card"); clock.append(el("div", "row", "The world's clock"));
  clock.append(el("div", "muted small", `${s.timeLabel} · tick ${num(s.tick)} · ${s.speed}× · ${s.paused ? "world frozen" : "running"} · River's mind ${s.brainPaused ? "paused" : "running"}`));
  clock.append(el("div", "muted small", `Engine: ${s.ticksPerSec ? `${num(s.ticksPerSec)} ticks/s at last turn` : "idle"} · lag ${s.lagMs} ms · ${s.systems} systems · ${s.timers} timers · ${s.ruleset} · parameters ${s.paramSet}`));
  const d = s.decisions; clock.append(el("div", "muted small", `Decisions: ${d.thinking ? "one being made" : "none in flight"}${d.urgent ? " · an urgent one is waiting" : ""} · ${d.queued} queued`));
  const act = el("div", "row"); act.style.marginTop = "8px"; act.style.justifyContent = "flex-start"; act.style.flexWrap = "wrap";
  const policy = el("select") as HTMLSelectElement; policy.setAttribute("aria-label", "When a decision is waiting");
  for (const [v, t] of [["stop", "stop for urgent decisions"], ["wait", "wait for them"], ["defer", "carry on regardless"]]) { const o = el("option") as HTMLOptionElement; o.value = v; o.textContent = t; policy.append(o); }
  const go = (label: string, until: "dawn" | "minutes", amount?: number) => { const b = el("button", "btn sm", label); b.onclick = () => send({ t: "sim_advance", until, amount, decision: policy.value as "stop" | "wait" | "defer" }); act.append(b); };
  go("To the next dawn", "dawn"); go("10 min", "minutes", 10); go("1 hour", "minutes", 60); act.append(policy);
  clock.append(act);
  progressBox = el("div", ""); clock.append(progressBox);
  if (s.advance.current) onAdvance(s.advance.current);
  into.append(clock);
  if (s.catchup) into.append(summaryCard("While you were away", s.catchup.summary, `${Math.round(s.catchup.absentMs / 60_000)} min absent${s.catchup.deferredWallMs ? `, ${Math.round(s.catchup.deferredWallMs / 60_000)} min not simulated` : ""}`));
  if (s.advance.last) into.append(summaryCard(`Last advance (${why[s.advance.last.reason] ?? s.advance.last.reason}, ${num(s.advance.last.ticksPerSec)} ticks/s)`, s.advance.last.summary));

  const pc = el("div", "card"); pc.append(el("div", "row", "Parameters"));
  const sel = el("select") as HTMLSelectElement; sel.setAttribute("aria-label", "Preset");
  for (const p of s.presets) { const o = el("option") as HTMLOptionElement; o.value = p.id; o.textContent = `${p.label}: ${p.help}`; sel.append(o); }
  const apply = el("button", "btn sm", "Apply preset"); apply.onclick = () => { if (confirm("Apply this preset? It is recorded like any other change.")) send({ t: "config_preset", id: sel.value }); };
  const pr = el("div", "row"); pr.style.justifyContent = "flex-start"; pr.append(sel, apply); pc.append(pr);
  for (const h of s.params) pc.append(el("div", "muted small", `tick ${num(h.tick)} · ${h.hash} · ${h.cause}`));
  into.append(pc);

  const perf = el("div", "card"); perf.append(el("div", "row", "Where the engine's time goes"));
  const total = s.perf.reduce((a: number, p: any) => a + p.ms, 0) || 1;
  for (const p of s.perf.slice(0, 8)) perf.append(el("div", "muted small", `${p.name}: ${Math.round((p.ms / total) * 100)}% · ${p.ms.toFixed(0)} ms over ${num(p.runs)} runs`));
  into.append(perf);

  await loadTimeline(into);
}

async function loadTimeline(into: HTMLElement) {
  const box = el("div", "card"); box.append(el("div", "row", "Timeline"));
  const f = el("div", "row"); f.style.justifyContent = "flex-start"; f.style.flexWrap = "wrap";
  const mk = (ph: string) => { const i = el("input") as HTMLInputElement; i.placeholder = ph; i.setAttribute("aria-label", ph); i.style.maxWidth = "120px"; return i; };
  const object = mk("object or id"), chain = mk("event (loss:id)"), activity = mk("activity id");
  const actor = el("select") as HTMLSelectElement, source = el("select") as HTMLSelectElement;
  for (const [sel, opts] of [[actor, ["", "river", "human", "world", "system", "external"]], [source, ["", "command", "activity", "item", "feeling", "log", "decision"]]] as const) for (const v of opts) { const o = el("option") as HTMLOptionElement; o.value = v; o.textContent = v || (sel === actor ? "any actor" : "any kind"); sel.append(o); }
  const list = el("div", ""); const show = el("button", "btn sm", "Show");
  const run = async () => {
    const q = new URLSearchParams({ limit: "60" }); for (const [k, v] of [["object", object.value], ["chain", chain.value], ["activity", activity.value], ["actor", actor.value], ["source", source.value]] as const) if (v.trim()) q.set(k, v.trim());
    const rows: any[] = await (await fetch(`/api/timeline?${q}`)).json(); list.replaceChildren();
    if (!rows.length) list.append(el("div", "muted small", "Nothing matches."));
    for (const r of rows) { const d = el("div", "muted small"); d.style.marginTop = "3px"; d.textContent = `${num(r.tick)} · ${r.actor}/${r.source} · ${r.text}`; if (r.event) { d.style.cursor = "pointer"; d.title = "Follow this event"; d.onclick = () => { chain.value = r.event; void run(); }; } list.append(d); }
  };
  show.onclick = () => void run();
  f.append(object, chain, activity, actor, source, show); box.append(f, list, el("div", "muted small", `Lines with an event id can be clicked to follow what came from it.`));
  into.append(box); void run();
}

/** The banner for a read-only replay. */
let bar: HTMLElement | null = null;
export function onReplay(m: { tick: number; startTick: number; endTick: number; speed: number; paused: boolean; done: boolean; checked: number; diverged: number; source: string }) {
  if (!bar) {
    bar = el("div", ""); bar.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:50;background:var(--s2,#222);border:1px solid var(--line2,#555);border-radius:10px;padding:6px 12px;display:flex;gap:10px;align-items:center;font-size:12px");
    document.body.append(bar);
  }
  bar.replaceChildren();
  const pct = Math.round(((m.tick - m.startTick) / Math.max(1, m.endTick - m.startTick)) * 100);
  const pause = el("button", "btn sm", m.paused ? "Play" : "Pause"); pause.onclick = () => send({ t: "replay_pause", paused: !m.paused });
  const sp = el("select") as HTMLSelectElement; for (const v of [1, 4, 16, 64]) { const o = el("option") as HTMLOptionElement; o.value = String(v); o.textContent = `${v}×`; if (v === m.speed) o.selected = true; sp.append(o); }
  sp.onchange = () => send({ t: "replay_speed", speed: Number(sp.value) });
  bar.append(el("b", "", "Replay"), el("span", "muted", `${m.source} · ${pct}%${m.done ? " · finished" : ""}`), pause, sp, el("span", m.diverged ? "" : "muted", m.diverged ? `⚠ ${m.diverged} of ${m.checked} checkpoints differ` : `${m.checked} checkpoints match`));
}
