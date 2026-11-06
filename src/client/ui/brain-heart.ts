// Heart: how River feels now, why each feeling moved, who and what it is attached to, and what it believes.
import { ago, el, store } from "../dom.ts";
import { S } from "../state.ts";
import { EMOTIONS, EMOTION_ORDER, intensityWord, type EmotionName } from "../../shared/emotions.ts";
import { chip, empty, gauge, getJson, h, note, section, type View } from "./brain-ui.ts";

let pick = store.get<string>("heartEmotion", "");
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function heartView(): View {
  let now: HTMLElement, why: HTMLElement, rel: HTMLElement, bel: HTMLElement;
  return {
    live: true,
    mount(box) {
      const n = section("How River feels", { hint: "now" }), w = section("Why feelings moved"), r = section("Who and what River is attached to"), b = section("What River believes", { hint: "with its evidence" });
      now = n.body; why = w.body; rel = r.body; bel = b.body; box.append(n.box, w.box, r.box, b.box);
    },
    async refresh() {
      const f = S.agent?.feelings ?? {};
      now.replaceChildren(...EMOTION_ORDER.map((n) => {
        const v = f[n] ?? 0, row = h("div", `bt-feel${v >= 0.2 ? " on" : ""}`); row.style.setProperty("--c", EMOTIONS[n].color);
        row.title = v >= 0.2 ? `${intensityWord(v)}: ${EMOTIONS[n].felt}` : "";
        row.append(el("span", "bt-fl", EMOTIONS[n].label), gauge(v * 100), el("span", "bt-dim", v >= 0.05 ? pct(v) : "")); return row;
      }));
      const m = await getJson<any>("/api/mind");
      // why: filter chips by emotion, then the most recent changes
      const chips = h("div", "bt-chips"), all = chip("All", pick ? "" : "info"); all.classList.add("btn-chip"); all.onclick = () => { pick = ""; store.set("heartEmotion", ""); void this.refresh(); }; chips.append(all);
      const seen = new Set<string>((m.feelings as any[]).map((t) => t.emotion).filter(Boolean));
      for (const e of EMOTION_ORDER.filter((e) => seen.has(e))) { const c = chip(EMOTIONS[e].label, pick === e ? "info" : ""); c.classList.add("btn-chip"); c.onclick = () => { pick = e; store.set("heartEmotion", e); void this.refresh(); }; chips.append(c); }
      const rows = (m.feelings as any[]).filter((t) => !pick || t.emotion === pick).slice(0, 14);
      why.replaceChildren(chips);
      if (!rows.length) why.append(empty("Nothing has stirred yet."));
      for (const t of rows) {
        const e = t.emotion as EmotionName | null, d = t.delta ?? 0, c = e ? EMOTIONS[e].color : "var(--muted)";
        const head = h("div", "bt-dhead", el("span", "bt-dot"), el("b", "", e ? EMOTIONS[e].label : t.kind), chip(t.kind === "aggregate" ? `${t.data?.changes ?? "?"} small changes` : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`, d > 0 ? "warn" : "good"), el("span", "bt-grow"), el("span", "bt-dim", e && t.kind !== "unseen" ? `${(t.prior ?? 0).toFixed(2)} → ${(t.result ?? 0).toFixed(2)}` : ""));
        (head.firstChild as HTMLElement).style.background = c;
        const card = h("div", "bt-card", head, el("div", "bt-why", t.why || t.kind));
        const parts = t.data?.parts as { name: string; mult: number }[] | undefined;
        if (parts?.length) card.append(h("div", "bt-chips", ...parts.map((p) => chip(`${p.name} ×${p.mult}`, p.mult > 1 ? "warn" : "good", "How much this changed the size of the feeling"))));
        why.append(card);
      }
      rel.replaceChildren();
      if (!m.relationships.length) rel.append(empty("Nothing yet. Attachment grows from making, naming, using, caring for and spending time with something."));
      for (const l of m.relationships.slice(0, 16)) {
        const ev = (l.evidence as { type: string }[]).slice(-3).map((x) => x.type);
        rel.append(h("div", "bt-card", h("div", "bt-dhead", el("b", "", l.name), chip(l.kind), el("span", "bt-grow"), el("span", "bt-dim", `attached ${pct(l.attachment)}`)), gauge(l.attachment * 100), note(`familiar ${pct(l.familiarity)}${ev.length ? ` · ${ev.join(", ")}` : ""}`)));
      }
      bel.replaceChildren();
      if (!m.beliefs.length) bel.append(empty("No beliefs recorded yet."));
      for (const b of m.beliefs.slice(0, 14)) bel.append(h("div", "bt-card", h("div", "bt-dhead", chip(b.kind === "fact" ? "fact" : "hypothesis", b.kind === "fact" ? "good" : "info"), el("span", "bt-grow"), el("span", "bt-dim", pct(b.confidence))), el("div", "bt-why", b.proposition), gauge(b.confidence * 100), note(`${b.support.length} observation${b.support.length === 1 ? "" : "s"} for, ${b.contradict.length} against`)));
      if (m.unseen.length) bel.append(note(`Not yet known to River (you can see everything; it cannot): ${m.unseen.map((u: any) => `${u.subject} (${u.class})`).join(", ")}`));
    },
  };
}
