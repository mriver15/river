// World and mind settings: every value is live. Sliders send on release; the server confirms and every open browser follows.
import { el, store } from "../dom.ts";
import { S, ctx, send } from "../state.ts";
import type { ConfigDef } from "../../shared/types.ts";

let host: HTMLElement | null = null;
let models: string[] = [];
/** The models the chosen server offers, offered as suggestions in the model boxes. */
async function loadModels() {
  try { models = ((await (await fetch("/api/llm/models")).json()) as { models: string[] }).models; } catch { models = []; }
  let dl = document.getElementById("llm-models") as HTMLDataListElement | null;
  if (!dl) { dl = document.createElement("datalist"); dl.id = "llm-models"; document.body.append(dl); }
  dl.replaceChildren(...models.map((m) => { const o = document.createElement("option"); o.value = m; return o; }));
}
/** A "Test" row: reach the server, find the model, ask it to call a tool, check the context window. */
function testRow(): HTMLElement {
  const r = el("div", "setrow"), out = el("div", "small"), b = el("button", "btn sm", "Test this setup");
  b.onclick = async () => {
    b.setAttribute("disabled", ""); out.replaceChildren(el("div", "muted small", "Testing… a local model may need a minute to load."));
    try {
      const t = (await (await fetch("/api/llm/test")).json()) as { ok: boolean; provider: string; model: string; steps: { name: string; ok: boolean; note: string }[] };
      out.replaceChildren(el("div", "", t.ok ? `Works: ${t.provider}${t.model ? `, ${t.model}` : ""}.` : "Not ready:"), ...t.steps.map((s) => el("div", "muted small", `${s.ok ? "✓" : "✗"} ${s.name}: ${s.note}`)));
    } catch (e) { out.textContent = `The test could not run: ${(e as Error).message}`; }
    b.removeAttribute("disabled");
  };
  r.append(b, out); return r;
}
const fmt = (d: ConfigDef, v: number) => `${Number.isInteger(d.step ?? 1) ? v : +v.toFixed(2)}${d.unit ? (d.unit === "×" || d.unit === "k" ? d.unit : ` ${d.unit}`) : ""}`;

function row(d: ConfigDef): HTMLElement {
  const val = S.config?.values[d.key] ?? d.def, r = el("div", "setrow"), top = el("div", "row");
  const lab = el("span", "", d.label); top.append(lab);
  if (d.type === "choice") {
    const sel = el("select") as HTMLSelectElement; sel.setAttribute("aria-label", d.label);
    for (const o of d.options ?? []) { const op = el("option") as HTMLOptionElement; op.value = o.value; op.textContent = o.label; sel.append(op); }
    sel.value = String(val); sel.onchange = () => { send({ t: "config_set", key: d.key, value: sel.value }); models = []; }; top.append(sel); r.append(top);
  } else if (d.type === "text") {
    const inp = el("input") as HTMLInputElement; inp.type = "text"; inp.value = String(val); inp.placeholder = d.placeholder ?? ""; inp.setAttribute("aria-label", d.label); inp.style.minWidth = "55%";
    if (d.key === "llmModel" || d.key === "forgeModel") { inp.setAttribute("list", "llm-models"); inp.onfocus = () => void loadModels(); }
    inp.onchange = () => send({ t: "config_set", key: d.key, value: inp.value }); top.append(inp); r.append(top);
  } else if (d.type === "toggle") {
    const sw = el("input"); sw.type = "checkbox"; sw.className = "switch"; sw.checked = !!val; sw.setAttribute("aria-label", d.label);
    sw.onchange = () => send({ t: "config_set", key: d.key, value: sw.checked }); top.append(sw); r.append(top);
  } else {
    const out = el("span", "muted small mono", fmt(d, Number(val))); top.append(out); r.append(top);
    const s = el("input"); s.type = "range"; s.min = String(d.min); s.max = String(d.max); s.step = String(d.step); s.value = String(val); s.setAttribute("aria-label", d.label);
    s.oninput = () => (out.textContent = fmt(d, Number(s.value))); s.onchange = () => send({ t: "config_set", key: d.key, value: Number(s.value) }); r.append(s);
  }
  r.append(el("div", "muted small", d.help));
  if (d.owner) r.append(el("div", "muted small", `${d.owner} · ${d.applies ?? "immediate"}${d.needs?.length ? ` · matters when ${d.needs.join(", ")} is on` : ""}`));
  if (d.key === "dayMinutes") { const b = el("button", "btn sm", "Run forward to the next dawn"); b.onclick = () => send({ t: "sim_advance", until: "dawn", decision: "stop" }); r.append(b); }
  return r;
}

/** Draw (or redraw) the settings into the open dialog. */
export function renderSettings() {
  if (!host) return; const cfg = S.config; host.replaceChildren();
  if (!cfg) return void host.append(el("p", "muted small", "Waiting for the server…"));
  const groups = new Map<string, ConfigDef[]>(); for (const d of cfg.defs) (groups.get(d.group) ?? groups.set(d.group, []).get(d.group)!).push(d);
  const order = [...groups].sort(([a], [b]) => (a === "AI provider" ? -1 : 0) - (b === "AI provider" ? -1 : 0));      // the provider comes first: it is what River cannot live without
  for (const [g, list] of order) { const det = el("details", "sect-d"); det.open = g === "Time & weather" || g === "Survival" || g === "AI provider"; det.append(el("summary", "", g)); for (const d of list) det.append(row(d)); if (g === "AI provider") det.append(testRow()); host.append(det); }
  const mine = el("details", "sect-d"); mine.append(el("summary", "", "This browser"));
  const cut = el("div", "setrow"), top = el("div", "row"), sw = el("input"); sw.type = "checkbox"; sw.className = "switch"; sw.checked = store.get("cutaways", true);
  sw.onchange = () => { store.set("cutaways", sw.checked); if (ctx.scene) ctx.scene.cutaways = sw.checked; };
  top.append(el("span", "", "Camera cutaways"), sw); cut.append(top, el("div", "muted small", "The camera glances at things that matter, then returns to River.")); mine.append(cut); host.append(mine);
  const rs = el("button", "btn sm", "Reset all settings to defaults"); rs.onclick = () => send({ t: "config_reset" }); host.append(rs);
}
export function settingsSection(): HTMLElement { const s = el("section", "sect"); s.append(el("h4", "", "Settings")); host = el("div", "settings"); s.append(host); renderSettings(); return s; }
export const closeSettings = () => { host = null; };
