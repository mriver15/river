// World and mind settings: every value is live. Sliders send on release; the server confirms and every open browser follows.
import { el, store } from "../dom.ts";
import { S, ctx, send } from "../state.ts";
import type { ConfigDef } from "../../shared/types.ts";

let host: HTMLElement | null = null;
const fmt = (d: ConfigDef, v: number) => `${Number.isInteger(d.step ?? 1) ? v : +v.toFixed(2)}${d.unit ? (d.unit === "×" || d.unit === "k" ? d.unit : ` ${d.unit}`) : ""}`;

function row(d: ConfigDef): HTMLElement {
  const val = S.config?.values[d.key] ?? d.def, r = el("div", "setrow"), top = el("div", "row");
  const lab = el("span", "", d.label); top.append(lab);
  if (d.type === "toggle") {
    const sw = el("input"); sw.type = "checkbox"; sw.className = "switch"; sw.checked = !!val; sw.setAttribute("aria-label", d.label);
    sw.onchange = () => send({ t: "config_set", key: d.key, value: sw.checked }); top.append(sw); r.append(top);
  } else {
    const out = el("span", "muted small mono", fmt(d, Number(val))); top.append(out); r.append(top);
    const s = el("input"); s.type = "range"; s.min = String(d.min); s.max = String(d.max); s.step = String(d.step); s.value = String(val); s.setAttribute("aria-label", d.label);
    s.oninput = () => (out.textContent = fmt(d, Number(s.value))); s.onchange = () => send({ t: "config_set", key: d.key, value: Number(s.value) }); r.append(s);
  }
  r.append(el("div", "muted small", d.help));
  if (d.key === "dayMinutes") { const b = el("button", "btn sm", "Skip to the next dawn"); b.onclick = () => send({ t: "skip_day" }); r.append(b); }
  return r;
}

/** Draw (or redraw) the settings into the open dialog. */
export function renderSettings() {
  if (!host) return; const cfg = S.config; host.replaceChildren();
  if (!cfg) return void host.append(el("p", "muted small", "Waiting for the server…"));
  const groups = new Map<string, ConfigDef[]>(); for (const d of cfg.defs) (groups.get(d.group) ?? groups.set(d.group, []).get(d.group)!).push(d);
  for (const [g, list] of groups) { const det = el("details", "sect-d"); det.open = g === "Time & weather" || g === "Survival"; det.append(el("summary", "", g)); for (const d of list) det.append(row(d)); host.append(det); }
  const mine = el("details", "sect-d"); mine.append(el("summary", "", "This browser"));
  const cut = el("div", "setrow"), top = el("div", "row"), sw = el("input"); sw.type = "checkbox"; sw.className = "switch"; sw.checked = store.get("cutaways", true);
  sw.onchange = () => { store.set("cutaways", sw.checked); if (ctx.scene) ctx.scene.cutaways = sw.checked; };
  top.append(el("span", "", "Camera cutaways"), sw); cut.append(top, el("div", "muted small", "The camera glances at things that matter, then returns to River.")); mine.append(cut); host.append(mine);
  const rs = el("button", "btn sm", "Reset all settings to defaults"); rs.onclick = () => send({ t: "config_reset" }); host.append(rs);
}
export function settingsSection(): HTMLElement { const s = el("section", "sect"); s.append(el("h4", "", "Settings")); host = el("div", "settings"); s.append(host); renderSettings(); return s; }
export const closeSettings = () => { host = null; };
