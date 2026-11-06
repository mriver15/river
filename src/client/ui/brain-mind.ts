// Mind: what wakes River's thinking, what each decision cost, and where the tokens go.
import { ago, el } from "../dom.ts";
import { bars, button, chip, empty, gauge, getJson, h, note, num, section, tile, type Tone, type View } from "./brain-ui.ts";

const KIND_TONE: Record<string, Tone> = { danger: "bad", contact: "info", need: "warn", failure: "warn", completion: "good", emotion: "", novelty: "", idle: "" };
let shown = 12;

export function mindView(): View {
  let top: HTMLElement, budget: HTMLElement, queue: HTMLElement, spend: HTMLElement, list: HTMLElement;
  return {
    live: true,
    mount(box) {
      const t = section("Now"), b = section("Token budget", { hint: "this hour" }), q = section("Waiting to be decided"), s = section("Where the tokens went", { hint: "last 24 hours" }), d = section("Recent decisions");
      top = t.body; budget = b.body; queue = q.body; spend = s.body; list = d.body;
      box.append(t.box, b.box, q.box, s.box, d.box);
    },
    async refresh() {
      const b = await getJson<any>("/api/brain"), bud = b.budget, unmetered = bud.max >= 1e8, pct = Math.min(100, Math.round(bud.fill * 100));
      const tone: Tone = bud.exhausted ? "bad" : pct >= 85 ? "warn" : "";
      top.replaceChildren(h("div", "bt-tiles", tile("Decisions", String(b.decisions.length ? b.decisions.length : 0), "logged"), tile("Queued", String(b.queue.length), b.queue.length ? "waiting" : "nothing waiting"), tile("Budget", unmetered ? "local" : `${pct}%`, unmetered ? "no limit" : `${num(bud.tokensLastHour)} of ${num(bud.max)}`, tone)));
      budget.replaceChildren();
      if (unmetered) budget.append(note(`${num(bud.tokensLastHour)} tokens this hour. A local model has no hourly limit (change this in Settings → AI provider).`));
      else {
        budget.append(gauge(pct, { tone, mark: 100 - bud.reservePct, label: "Tokens used this hour" }), note(`${num(bud.tokensLastHour)} of ${num(bud.max)} tokens. The last ${bud.reservePct}% is kept for a human's words and for danger. ${bud.exhausted ? "Spent: " : "If it runs out: "}${bud.pauseWhenSpent ? "the world waits at the next decision until tokens free up." : "the world carries on and River stops deciding."}`));
      }
      queue.replaceChildren();
      if (!b.queue.length) queue.append(empty("Nothing is waiting. River is acting on what it already decided."));
      for (const t of b.queue) queue.append(h("div", "bt-item", chip(t.kind, KIND_TONE[t.kind] ?? ""), el("span", "bt-grow", `${t.texts[0] ?? ""}${t.texts.length > 1 ? ` (+${t.texts.length - 1})` : ""}`), el("span", "bt-dim", t.count > 1 ? `×${t.count}` : "")));
      const cs = Object.entries(b.consumers as Record<string, any>).sort((x, y) => y[1].input + y[1].output - (x[1].input + x[1].output)), tot = cs.reduce((a, [, c]) => a + c.input + c.output, 0) || 1;
      spend.replaceChildren(cs.length ? bars(cs.map(([name, c]) => ({ label: name, share: (c.input + c.output) / tot, text: `${num(c.input + c.output)}`, title: `${c.calls} calls · ${num(c.input)} in (${num(c.cached)} cached) · ${num(c.output)} out${c.calls ? ` · ${(c.ms / c.calls / 1000).toFixed(1)} s each` : ""}` }))) : empty("Nothing spent yet."));
      list.replaceChildren();
      if (!b.decisions.length) return void list.append(empty("River has not made a decision yet."));
      for (const d of b.decisions.slice(0, shown)) {
        const kinds = String(d.kinds).split(",").filter(Boolean), tools = String(d.tools ?? "").split(",").filter(Boolean);
        const head = h("div", "bt-dhead", ...kinds.map((k) => chip(k, KIND_TONE[k] ?? "")), el("span", "bt-grow"), el("span", "bt-dim", ago(d.wall_ts)));
        const body = h("div", "bt-chips", ...(tools.length ? tools.map((t) => chip(t, t.endsWith("✗") ? "bad" : "")) : [el("span", "bt-dim", "no action")]));
        const det = el("details", "bt-more") as HTMLDetailsElement; det.append(el("summary", "", `${d.calls} call${d.calls === 1 ? "" : "s"} · ${num(d.in_tokens)}→${num(d.out_tokens)} tokens · ${(d.latency_ms / 1000).toFixed(1)} s`));
        det.append(note(`What River was shown: ${num(d.packet_tokens)} tokens${d.cache_tokens ? `, ${num(d.cache_tokens)} cached` : ""}.${d.dropped ? ` Left out to fit: ${d.dropped}.` : ""}${d.note ? ` ${d.note}` : ""}`));
        list.append(h("div", "bt-card", head, body, det));
      }
      if (b.decisions.length > shown) list.append(button(`Show ${Math.min(10, b.decisions.length - shown)} more`, () => { shown += 10; void this.refresh(); }));
    },
  };
}
