// Timeline: what happened, from the stored records, filtered by who, what, which kind, or which event it came from.
import { el, store } from "../dom.ts";
import { button, chip, empty, getJson, h, note, num, section, type View } from "./brain-ui.ts";

interface Row { tick: number; source: string; actor: string; object?: string; event?: string; text: string }
const SOURCES = ["", "command", "activity", "item", "feeling", "log", "decision"], ACTORS = ["", "river", "human", "world", "system", "external"];
const F = store.get<{ source: string; actor: string; object: string; chain: string }>("timelineFilter", { source: "", actor: "", object: "", chain: "" });
const save = () => store.set("timelineFilter", F);

export function timelineView(): View {
  let bar: HTMLElement, out: HTMLElement, count: HTMLElement, live: HTMLInputElement, token = 0;
  const load = async () => {
    const mine = ++token, q = new URLSearchParams({ limit: "80" }); for (const [k, v] of Object.entries(F)) if (v.trim()) q.set(k, v.trim());
    out.setAttribute("aria-busy", "true");
    let rows: Row[]; try { rows = await getJson<Row[]>(`/api/timeline?${q}`); } catch { if (mine === token) { out.replaceChildren(empty("The timeline could not be loaded.", button("Try again", () => void load()))); } return; }
    if (mine !== token) return;                                    // a newer request has taken over
    out.removeAttribute("aria-busy"); out.replaceChildren(); count.textContent = `${rows.length} line${rows.length === 1 ? "" : "s"}`;
    if (!rows.length) return void out.append(empty(Object.values(F).some(Boolean) ? "Nothing matches these filters." : "Nothing has happened yet.", Object.values(F).some(Boolean) ? button("Clear filters", () => { Object.assign(F, { source: "", actor: "", object: "", chain: "" }); save(); sync(); void load(); }) : undefined));
    let lastTick = -1;
    for (const r of rows) {
      if (r.tick !== lastTick) { out.append(el("div", "bt-tick", `tick ${num(r.tick)}`)); lastTick = r.tick; }
      const row = h("div", `bt-item bt-tl-${r.source}`, chip(r.source), el("span", "bt-grow", r.text));
      if (r.object) { const o = chip(r.object, "info", "Show everything about this"); o.classList.add("btn-chip"); o.onclick = () => { F.object = r.object!; save(); sync(); void load(); }; row.append(o); }
      if (r.event) { const c = chip("follow", "good", "Follow this event to what it caused"); c.classList.add("btn-chip"); c.onclick = () => { F.chain = r.event!; save(); sync(); void load(); }; row.append(c); }
      out.append(row);
    }
  };
  let sel: { source: HTMLSelectElement; actor: HTMLSelectElement; object: HTMLInputElement; chain: HTMLInputElement };
  const sync = () => { sel.source.value = F.source; sel.actor.value = F.actor; sel.object.value = F.object; sel.chain.value = F.chain; };
  return {
    live: false,                                                   // the filters are being typed into; refresh when asked, or while "Live" is ticked
    mount(box) {
      const s = section("Timeline", { hint: "from the stored records" });
      const pick = (opts: string[], any: string, key: "source" | "actor") => { const e = el("select") as HTMLSelectElement; e.setAttribute("aria-label", any); for (const v of opts) { const o = el("option") as HTMLOptionElement; o.value = v; o.textContent = v || any; e.append(o); } e.onchange = () => { F[key] = e.value; save(); void load(); }; return e; };
      const text = (ph: string, key: "object" | "chain") => { const i = el("input") as HTMLInputElement; i.placeholder = ph; i.setAttribute("aria-label", ph); i.onchange = () => { F[key] = i.value; save(); void load(); }; return i; };
      sel = { source: pick(SOURCES, "any kind", "source"), actor: pick(ACTORS, "anyone", "actor"), object: text("a thing, id or name", "object"), chain: text("an event (loss:id)", "chain") };
      live = el("input") as HTMLInputElement; live.type = "checkbox"; live.setAttribute("aria-label", "Keep refreshing");
      count = el("span", "bt-dim"); out = el("div", "bt-list");
      bar = h("div", "bt-filters", sel.source, sel.actor, sel.object, sel.chain, button("Refresh", () => void load()), h("label", "bt-live", live, "Live"), count);
      s.body.append(bar, note("Lines marked “follow” can be followed to what came from them; chips filter by that thing."), out); box.append(s.box); sync();
    },
    async refresh() { if (!out.children.length || live.checked) await load(); },
  };
}
