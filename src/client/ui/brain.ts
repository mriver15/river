import { $, el, ago } from "../dom.ts";
import { loadHeart } from "./heart.ts";

const n = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString());

/** The decision inspector: what woke River's mind, what each decision cost, and where the token budget stands. */
export async function loadBrain() {
  const box = $("brainview"); let b: any;
  try { b = await (await fetch("/api/brain")).json(); } catch { return void (box.textContent = "The brain's log is not available."); }
  box.replaceChildren();

  const bud = b.budget, card = el("div", "card"), pct = Math.min(100, Math.round(bud.fill * 100));
  card.append(el("div", "row", `Budget this hour: ${n(bud.tokensLastHour)} of ${n(bud.max)} tokens (${pct}%)`));
  const bar = el("div", ""); bar.setAttribute("style", `height:6px;border-radius:3px;background:var(--line,#8884);margin:6px 0;position:relative;overflow:hidden`);
  const fill = el("div", ""); fill.setAttribute("style", `height:100%;width:${pct}%;background:${bud.exhausted ? "var(--bad,#c44)" : "var(--accent,#6a9)"}`); bar.append(fill);
  const line = el("div", ""); line.setAttribute("style", `position:absolute;top:0;bottom:0;left:${100 - bud.reservePct}%;width:2px;background:var(--fg,#fff8)`); bar.append(line);
  card.append(bar, el("div", "muted small", `${bud.reservePct}% is kept for a human's words and for danger. ${bud.exhausted ? "Spent: " : "If it runs out: "}${bud.pauseWhenSpent ? "the world waits at the next decision." : "the world carries on without new decisions."}`));
  box.append(card);

  const cs = Object.entries(b.consumers as Record<string, any>).sort((x, y) => y[1].input + y[1].output - (x[1].input + x[1].output));
  const cc = el("div", "card"); cc.append(el("div", "row", "Where the tokens went (24 h)"));
  if (!cs.length) cc.append(el("div", "muted small", "Nothing spent yet."));
  for (const [name, c] of cs) cc.append(el("div", "muted small", `${name}: ${c.calls} calls · ${n(c.input)} in (${n(c.cached)} cached) · ${n(c.output)} out${c.calls ? ` · ${Math.round(c.ms / c.calls / 100) / 10}s each` : ""}`));
  box.append(cc);

  if (b.queue.length) {
    const qc = el("div", "card"); qc.append(el("div", "row", "Waiting to be decided"));
    for (const t of b.queue) qc.append(el("div", "muted small", `${t.kind}${t.count > 1 ? ` ×${t.count}` : ""}${t.texts[0] ? ` — ${t.texts[0]}` : ""}`));
    box.append(qc);
  }

  const dc = el("div", "card"); dc.append(el("div", "row", "Recent decisions"));
  if (!b.decisions.length) dc.append(el("div", "muted small", "None yet."));
  for (const d of b.decisions.slice(0, 25)) {
    const r = el("div", "muted small"); r.style.marginTop = "4px";
    r.textContent = `${ago(d.wall_ts)} · woken by ${d.kinds} · ${d.calls} call${d.calls === 1 ? "" : "s"} · ${n(d.in_tokens)}→${n(d.out_tokens)} tokens · packet ${n(d.packet_tokens)} · ${Math.round(d.latency_ms / 100) / 10}s${d.tools ? ` · ${d.tools.split(",").join(", ")}` : ""}${d.note ? ` · ${d.note}` : ""}`;
    dc.append(r);
  }
  box.append(dc);
  await loadHeart(box);
}
