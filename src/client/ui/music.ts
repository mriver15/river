import { $, ago, clamped, el, icon } from "../dom.ts";
import { ctx, renderers } from "../state.ts";
import { DEMO } from "../demo.ts";
import { renderWav } from "../music.ts";
import { ensureSound, showTab, toast } from "./chrome.ts";

export const pieceCount = () => pieces.length;
import type { Score } from "../../shared/music.ts";

interface Piece { key: string; title: string; score: Score; analysis?: string; plays?: number; ts?: number }
let pieces: Piece[] = [];
let loaded = false;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const demoPiece: Piece = { key: "demo", title: DEMO.title, score: DEMO, analysis: "Built in, so there is something to hear before River has composed anything." };

export async function loadMusic() {
  try { const r: any[] = await (await fetch("/api/music")).json(); pieces = r.map((p) => ({ key: `p${p.id}`, title: p.title, score: p.score, analysis: p.analysis, plays: p.plays, ts: p.ts })); loaded = true; } catch { /* offline */ }
  if ($("tab-story").classList.contains("active")) renderers.story?.();
}

export function playScore(score: Score) { if (!ensureSound()) return; ctx.audio?.perform(score); tick(); }
const stop = () => { ctx.audio?.stopMusic(); tick(); };

/** River's compositions, plus a built-in piece to test the speakers with. Appended into the Story tab. */
export function renderCompositions(root: HTMLElement) {
  if (!loaded) void loadMusic();
  if (!pieces.length) root.append(el("div", "empty", "River hasn't composed anything yet. Pieces appear here when it does, and you can listen, or save them as .wav."));
  for (const p of pieces) root.append(card(p));
  const demo = el("details", "demo"); demo.append(el("summary", "sub", "Test your speakers with a built-in piece")); demo.append(card(demoPiece)); root.append(demo);
}

function card(p: Piece): HTMLElement {
  const c = el("div", "card piece"); c.dataset.title = p.title;
  const top = el("div", "row"); top.append(el("b", "", p.title)); c.append(top);
  c.append(el("div", "meta", `${mmss(p.score.seconds)} · ${p.score.tempo} bpm${p.plays !== undefined ? ` · performed ${p.plays}×` : ""}${p.ts ? ` · ${ago(p.ts)}` : ""}`));
  const vc = el("div", "voicechips"); for (const v of p.score.voices) vc.append(el("span", `vc ${v.instrument}`, v.name === v.instrument || /^\w+\d$/.test(v.name) ? v.instrument : `${v.name} · ${v.instrument}`)); c.append(vc);
  if (p.analysis) c.append(clamped(p.analysis, 3, "sub"));
  const btns = el("div", "btns"), play = el("button", "btn ok play"); play.onclick = () => (ctx.audio?.playing?.title === p.score.title ? stop() : playScore(p.score));
  const wav = el("button", "btn"); wav.append(icon("download", 14), document.createTextNode("Save .wav"));
  wav.onclick = async () => { wav.disabled = true; wav.lastChild!.textContent = "Rendering…"; try { const b = await renderWav(p.score), a = el("a"); a.href = URL.createObjectURL(b); a.download = `${p.title.replace(/[^\w]+/g, "-")}.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); } finally { wav.disabled = false; wav.lastChild!.textContent = "Save .wav"; } };
  btns.append(play, wav); c.append(btns, el("div", "prog")); return c;
}

/** Keep play buttons, progress bars and the header chip in step with what is actually playing. */
export function tick() {
  const now = ctx.audio?.playing ?? null, chip = $("chip-music");
  document.querySelectorAll<HTMLElement>(".piece").forEach((c) => {
    const on = !!now && c.dataset.title === now.title, play = c.querySelector<HTMLElement>(".play")!;
    c.classList.toggle("playing", on); play.replaceChildren(icon(on ? "stop" : "play", 14), document.createTextNode(on ? "Stop" : "Play"));
    c.querySelector<HTMLElement>(".prog")!.style.width = on ? `${Math.min(100, ((Date.now() - now!.started) / 1000 / now!.seconds) * 100)}%` : "0";
  });
  chip.hidden = !now; if (now) chip.textContent = `${now.title.replace(/^Demo: /, "")} · ${mmss(Math.min(now.seconds, (Date.now() - now.started) / 1000))}`;
}

/** River began performing: play it in sync if sound is on, otherwise offer to listen (a click lets the browser start audio). */
export function onRiverScore(title: string, score: Score) {
  void loadMusic();
  if (ctx.audio?.on) return void (ctx.audio.perform(score), tick());
  toast({ title: "River is playing music", body: `“${title}” · ${mmss(score.seconds)}`, color: "var(--accent)", ttl: 15000, action: { label: "Listen", fn: () => playScore(score) } });
}
export function initMusic() { $("chip-music").onclick = () => showTab("story"); setInterval(tick, 500); }
