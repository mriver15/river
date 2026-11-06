import { el } from "../dom.ts";
import { send } from "../state.ts";
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
