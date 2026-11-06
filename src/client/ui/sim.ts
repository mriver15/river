import { el, setIcon } from "../dom.ts";
import { ctx, send } from "../state.ts";
import type { AdvanceProgress, AdvanceResult } from "../../shared/advance.ts";

const num = (v: number) => v.toLocaleString();
const mins = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const why: Record<string, string> = { target: "reached its target", death: "stopped: River died", decision: "stopped: an urgent decision was waiting", cancelled: "cancelled", budget: "stopped at its work limit", frozen: "the world is frozen" };

let progressBox: HTMLElement | null = null;
/** Where an advance shows how far it has got: set by whichever view is on screen. */
export function mountProgress(box: HTMLElement) { progressBox = box; }
/** An advance reports in; show how far it has got. */
export function onAdvance(p: AdvanceProgress | null, done?: AdvanceResult) {
  if (!progressBox || !progressBox.isConnected) return;
  progressBox.replaceChildren();
  if (p) {
    const bar = el("div", "bt-gauge"); const fill = el("i"); fill.style.width = `${Math.round(p.pct * 100)}%`; bar.append(fill);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuenow", String(Math.round(p.pct * 100)));
    const cancel = el("button", "btn sm no", "Stop"); cancel.onclick = () => send({ t: "sim_cancel" });
    const row = el("div", "bt-actions"); row.append(el("span", "bt-dim bt-grow", `${p.label}: ${Math.round(p.pct * 100)}% · ${num(p.ticksPerSec)} ticks/s`), cancel);
    progressBox.append(row, bar);
  } else if (done) progressBox.append(el("div", "bt-note", `${why[done.reason] ?? done.reason}: ${mins(done.summary.simSeconds)} of world time in ${(done.wallMs / 1000).toFixed(1)} s.`));
}

/** The banner for a read-only replay: play/pause, speed up to a day in a few seconds, a scrubber that jumps ahead (a replay cannot run backwards), and the route walked. Built once and updated in place so dragging works. */
let bar: { root: HTMLElement; title: HTMLElement; status: HTMLElement; pause: HTMLButtonElement; speed: HTMLSelectElement; seek: HTMLInputElement; paused: boolean; dragging: boolean } | null = null;
export function onReplay(m: { tick: number; startTick: number; endTick: number; speed: number; paused: boolean; done: boolean; checked: number; diverged: number; source: string }) {
  if (!bar) {
    const root = el("div", ""); root.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:50;background:var(--s2,#222);border:1px solid var(--line2,#555);border-radius:10px;padding:6px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:94vw;font-size:12px");
    const title = el("b", "", "Replay"), status = el("span", "muted"), pause = el("button", "btn sm") as HTMLButtonElement, speed = el("select") as HTMLSelectElement;
    for (const v of [1, 4, 16, 64, 256, 512]) { const o = el("option") as HTMLOptionElement; o.value = String(v); o.textContent = `${v}×`; speed.append(o); }
    const seek = el("input") as HTMLInputElement; seek.type = "range"; seek.min = "0"; seek.max = "1000"; seek.style.width = "min(320px, 60vw)"; seek.title = "Jump ahead (a replay cannot run backwards)";
    const trail = el("button", "btn sm", "Route") as HTMLButtonElement; trail.title = "Show the route River has walked, shaded by the hour"; setIcon(trail, "route");
    trail.onclick = () => { const on = !ctx.scene?.trailShown; ctx.scene?.showTrail(on); trail.classList.toggle("on", on); };
    const state = { root, title, status, pause, speed, seek, paused: false, dragging: false }; bar = state;
    pause.onclick = () => send({ t: "replay_pause", paused: !state.paused });
    speed.onchange = () => send({ t: "replay_speed", speed: Number(speed.value) });
    seek.onpointerdown = () => { state.dragging = true; };
    seek.onchange = () => { state.dragging = false; const span = Number(seek.dataset.span ?? 0), start = Number(seek.dataset.start ?? 0); send({ t: "replay_seek", tick: Math.round(start + (Number(seek.value) / 1000) * span) }); };
    root.append(title, status, pause, speed, seek, trail); document.body.append(root);
    ctx.scene?.showTrail(true); trail.classList.add("on");
  }
  const b = bar, span = Math.max(1, m.endTick - m.startTick), pct = Math.round(((m.tick - m.startTick) / span) * 100);
  b.paused = m.paused; b.pause.textContent = m.paused ? "Play" : "Pause"; b.speed.value = String(m.speed);
  b.seek.dataset.span = String(span); b.seek.dataset.start = String(m.startTick); if (!b.dragging) b.seek.value = String(Math.round(((m.tick - m.startTick) / span) * 1000));
  b.status.textContent = `${m.source} · ${pct}%${m.done ? " · finished" : ""} · ${m.diverged ? `⚠ ${m.diverged} of ${m.checked} checkpoints differ` : `${m.checked} checkpoints match`}`;
  b.status.className = m.diverged ? "" : "muted";
}
