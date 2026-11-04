import { el } from "../dom.ts";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const bar = (v: number) => { const b = el("span", ""); b.setAttribute("style", `display:inline-block;width:${Math.round(v * 60)}px;height:6px;border-radius:3px;background:var(--accent,#6a9);margin-right:6px;vertical-align:middle`); return b; };

/** The emotion inspector, relationship view and belief records: what River feels, why, who and what it is attached to, and what it believes. */
export async function loadHeart(into: HTMLElement) {
  let m: any;
  try { m = await (await fetch("/api/mind")).json(); } catch { return; }

  const fc = el("div", "card"); fc.append(el("div", "row", "Why feelings moved"));
  if (!m.feelings.length) fc.append(el("div", "muted small", "Nothing has stirred yet."));
  for (const t of m.feelings.slice(0, 14)) {
    const r = el("div", "muted small"); r.style.marginTop = "4px";
    const sign = t.delta >= 0 ? "+" : "", why = t.why || t.kind;
    const parts = t.data?.parts?.length ? ` · ${t.data.parts.map((p: any) => `${p.name} ×${p.mult}`).join(", ")}` : "";
    r.textContent = t.kind === "aggregate" ? `${t.emotion} ${sign}${(t.delta ?? 0).toFixed(2)} over ${t.data?.changes ?? "?"} small changes · ${why}` : t.kind === "appraisal"
      ? `${t.emotion} ${(t.prior ?? 0).toFixed(2)} → ${(t.result ?? 0).toFixed(2)} (${sign}${(t.delta ?? 0).toFixed(2)}) · ${why}${parts}` : `${t.kind}: ${why}`;
    fc.append(r);
  }
  into.append(fc);

  const rc = el("div", "card"); rc.append(el("div", "row", "Who and what River is attached to"));
  if (!m.relationships.length) rc.append(el("div", "muted small", "Nothing yet. Attachment grows from making, naming, using, caring for and spending time with something."));
  for (const l of m.relationships.slice(0, 20)) {
    const r = el("div", "muted small"); r.style.marginTop = "4px";
    r.append(bar(l.attachment), `${l.name} (${l.kind}) · attached ${pct(l.attachment)}, familiar ${pct(l.familiarity)}${l.evidence.length ? ` · ${l.evidence.slice(-3).map((e: any) => e.type).join(", ")}` : ""}`);
    rc.append(r);
  }
  into.append(rc);

  const bc = el("div", "card"); bc.append(el("div", "row", "What River believes"));
  if (!m.beliefs.length) bc.append(el("div", "muted small", "No beliefs recorded yet."));
  for (const b of m.beliefs.slice(0, 20)) {
    const r = el("div", "muted small"); r.style.marginTop = "4px";
    r.textContent = `${b.kind === "fact" ? "Fact" : "Hypothesis"} (${pct(b.confidence)}): ${b.proposition} · for: ${b.support.length}, against: ${b.contradict.length}`;
    bc.append(r);
  }
  if (m.unseen.length) bc.append(el("div", "muted small", `Not yet known to River (the inspector sees all): ${m.unseen.map((u: any) => `${u.subject} (${u.class})`).join(", ")}`));
  into.append(bc);
}
