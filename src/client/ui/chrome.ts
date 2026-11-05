import { closeSettings, settingsSection } from "./settings.ts";
import { $, el, icon, setIcon, store, type IconName } from "../dom.ts";
import { S, ctx, TABS, renderers, send, type TabName } from "../state.ts";
import { EMOTIONS, EMOTION_ORDER, intensityWord } from "../../shared/emotions.ts";
import type { AgentView, Entity } from "../../shared/types.ts";

const TAB_LABEL: Record<TabName, string> = { log: "Log", mind: "Mind", story: "Story", map: "Map", items: "Items", tools: "Tools", memory: "Memory", brain: "Brain" };
const TAB_ICON: Record<TabName, IconName> = { log: "log", mind: "mind", story: "story", map: "map", items: "items", tools: "tools", memory: "memory", brain: "brain" };
const badges: Partial<Record<TabName, number>> = {};

// ---------- tabs ----------
export function showTab(n: TabName) {
  if (document.body.dataset.side === "closed") setSide(true);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", (b as HTMLElement).dataset.tab === n));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${n}`));
  store.set("tab", n);
  renderers[n]?.();
}
export function setBadge(tab: TabName, count: number) {
  badges[tab] = count;
  const b = document.querySelector<HTMLElement>(`#tabs button[data-tab="${tab}"] .badge`); if (!b) return;
  b.hidden = !count; b.textContent = String(count);
}

// ---------- sidebar ----------
const sideWidth = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w")) || 410;
const applyInset = () => ctx.scene?.setInset(document.body.dataset.side === "open" && innerWidth > 860 ? sideWidth() + 24 : 0);
export function setSide(open: boolean) {
  document.body.dataset.side = open ? "open" : "closed";
  store.set("sideOpen", open); applyInset();
}

function initResizer() {
  const r = $("resizer"); const saved = store.get<number>("sideW", 0); if (saved) document.documentElement.style.setProperty("--sidebar-w", `${saved}px`);
  r.onpointerdown = (e) => {
    r.setPointerCapture(e.pointerId); r.classList.add("drag");
    const move = (m: PointerEvent) => { const w = Math.max(340, Math.min(640, innerWidth - m.clientX - 12)); document.documentElement.style.setProperty("--sidebar-w", `${w}px`); applyInset(); };
    const up = () => { r.classList.remove("drag"); r.removeEventListener("pointermove", move); r.removeEventListener("pointerup", up); store.set("sideW", sideWidth()); };
    r.addEventListener("pointermove", move); r.addEventListener("pointerup", up);
  };
}

// ---------- HUD ----------
const NEEDS: { k: keyof AgentView["needs"]; label: string; color: string }[] = [
  { k: "energy", label: "Energy", color: "var(--accent)" }, { k: "hunger", label: "Fed", color: "var(--orange)" },
  { k: "mood", label: "Mood", color: "var(--violet)" }, { k: "curiosity", label: "Curious", color: "var(--cyan)" }, { k: "warmth", label: "Warm", color: "#ff9a6b" },
];
export function renderHud(a: AgentView) {
  $("name").textContent = a.name;
  const base = a.sleeping ? "sleeping…" : a.thinking && a.activity === "thinking" ? "thinking…" : a.activity;
  $("activity").textContent = a.progress && !a.sleeping ? `${a.progress.label} · ${Math.round(a.progress.pct * 100)}%` : base;
  $("activity").title = a.progress ? "Cancel with the Stop button" : "";
  $("dot").className = "dot " + (a.sleeping ? "sleep" : a.thinking ? "think" : "live");
  const box = $("needs");
  if (!box.children.length) for (const n of NEEDS) {
    const d = el("div", "need"); d.dataset.k = n.k; d.style.setProperty("--c", n.color); d.title = n.label;
    d.innerHTML = `<div class="l">${n.label}</div><span class="meter"><i></i></span>`; box.append(d);
  }
  for (const n of NEEDS) {
    const d = box.querySelector<HTMLElement>(`[data-k="${n.k}"]`)!, v = a.needs[n.k];
    d.title = `${n.label}: ${v.toFixed(0)} / 100`; d.querySelector<HTMLElement>("i")!.style.width = `${v}%`;
    d.classList.toggle("low", v < 20 && n.k !== "curiosity");   // (low warmth is as urgent as low energy)
  }
  const feels = $("feels"), top = EMOTION_ORDER.map((n) => [n, a.feelings?.[n] ?? 0] as const).filter(([, v]) => v >= 0.2).sort((x, y) => y[1] - x[1]).slice(0, 3);
  feels.replaceChildren(...top.map(([n, v]) => { const p = el("span", "feel", EMOTIONS[n].label); p.style.setProperty("--c", EMOTIONS[n].color); p.style.opacity = String(0.6 + 0.4 * v); p.title = `${intensityWord(v)} ${EMOTIONS[n].label}: ${EMOTIONS[n].felt}`; return p; }));
  feels.hidden = !top.length;
  const h = a.worldTime * 24, night = a.worldTime < 0.23 || a.worldTime > 0.78;
  $("chip-time").textContent = `${night ? "☾" : "☀"}  Day ${a.day} · ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  $("chip-weather").textContent = a.weather[0].toUpperCase() + a.weather.slice(1);
}

export function renderBudget() {
  const s = S.stats, chip = $("chip-budget"); if (!s) return;
  const pct = Math.min(100, Math.round((s.tokensLastHour / s.maxTokensPerHour) * 100));
  chip.querySelector<HTMLElement>("i")!.style.width = `${pct}%`;
  const unmetered = s.maxTokensPerHour >= 1e8;                      // a local model: the hourly caps do not apply
  chip.querySelector<HTMLElement>(".lbl")!.textContent = s.mock ? "mock brain" : unmetered ? `local · ${(s.tokensLastHour / 1000).toFixed(0)}k/h` : `${pct}%${s.offPeak ? " · ½ price" : ""}`;
  chip.classList.toggle("high", pct >= 70 && pct < 95); chip.classList.toggle("full", pct >= 95);
  chip.title = `${s.mock ? "Mock brain" : s.model}\n${unmetered ? `${(s.tokensLastHour / 1000).toFixed(0)}k tokens this hour (no limit on a local model)` : `${(s.tokensLastHour / 1000).toFixed(0)}k of ${(s.maxTokensPerHour / 1000).toFixed(0)}k tokens this hour`}\n${s.cyclesLastHour} cycles\n${s.offPeak ? "Off-peak (half price, budget doubled)" : "Peak pricing"}${s.cacheHitPct ? `\n${s.cacheHitPct}% of input cached` : ""}`;
  const p = $("btn-pause"); setIcon(p, s.paused ? "play" : "pause"); p.classList.toggle("on", s.paused); p.title = s.paused ? "Resume River (P)" : "Pause River (P)";
  const fz = $("btn-freeze"); fz.classList.toggle("on", s.worldPaused); fz.title = s.worldPaused ? "Thaw the world (W)" : "Freeze the whole world (W)";
}

export function setConn(live: boolean) { const c = $("conn"); c.textContent = live ? "live" : "offline"; c.className = `conn ${live ? "good" : "bad"}`; }

function initActions() {
  const box = $("actions");
  const btn = (id: string, name: IconName, label: string, fn: () => void) => { const b = el("button", "iconbtn"); b.id = id; b.type = "button"; b.append(icon(name)); b.title = label; b.setAttribute("aria-label", label); b.onclick = fn; box.append(b); return b; };
  const conn = el("span", "conn bad", "offline"); conn.id = "conn"; box.append(conn);
  btn("btn-follow", "follow", "Camera follows River (F)", toggleFollow).classList.add("on");
  btn("btn-sound", "volume", "Ambient sound (M)", toggleSound);
  btn("btn-pause", "pause", "Pause River (P)", () => send({ t: "pause", paused: !S.stats?.paused }));
  btn("btn-stop", "stop", "Stop what River is doing", () => send({ t: "activity_cancel" }));
  btn("btn-freeze", "freeze", "Freeze the whole world (W)", () => send({ t: "sim_pause", paused: !S.stats?.worldPaused }));
  box.append(el("span", "sep"));
  btn("btn-nextday", "sunrise", "Run the world forward to the next dawn", () => { if (confirm("Run the world forward to the next dawn? It runs every tick, quickly, and stops if something urgent needs River.")) send({ t: "sim_advance", until: "dawn", decision: "stop" }); });
  btn("btn-controls", "sliders", "Controls: budget, new River", openControls);
  btn("btn-panel", "panel", "Hide panel (\\)", () => setSide(document.body.dataset.side !== "open"));
}
const toggleFollow = () => { if (!ctx.scene) return; ctx.scene.follow = !ctx.scene.follow; $("btn-follow").classList.toggle("on", ctx.scene.follow); };
/** Turn sound on if it isn't (call from a click: browsers only allow audio after a gesture). */
export function ensureSound(): boolean { if (!ctx.audio) return false; if (!ctx.audio.on) toggleSound(); return ctx.audio.on; }
const toggleSound = () => { const on = ctx.audio?.toggle(); const b = $("btn-sound"); b.classList.toggle("on", !!on); setIcon(b, on ? "volume" : "mute"); };

// ---------- toasts ----------
export function toast(o: { title: string; body?: string; color?: string; action?: { label: string; fn: () => void }; ttl?: number }) {
  const box = $("toasts"); while (box.children.length >= 3) box.firstElementChild?.remove();
  const t = el("div", "toast"); if (o.color) t.style.setProperty("--c", o.color);
  const head = el("div", "t"); head.append(el("span", "", o.title)); const x = el("button", "x"); x.append(icon("x", 14)); x.setAttribute("aria-label", "Dismiss"); x.onclick = () => t.remove(); head.append(x); t.append(head);
  if (o.body) t.append(el("div", "b", o.body));
  if (o.action) { const b = el("button", "btn sm", o.action.label); b.onclick = () => { o.action!.fn(); t.remove(); }; const w = el("div", "btns"); w.append(b); t.append(w); }
  box.append(t); setTimeout(() => t.remove(), o.ttl ?? 10000);
}

// ---------- entity inspector ----------
export function inspect(e: Entity | null) {
  const p = $("inspector"); if (!e) return void (p.hidden = true);
  p.replaceChildren();
  const hd = el("div", "hd"); const nm = el("div"); nm.append(el("div", "nm", e.name), el("div", "muted small mono", `${e.id} · ${e.x.toFixed(0)}, ${e.z.toFixed(0)}`));
  const x = el("button", "iconbtn"); x.append(icon("x", 15)); x.setAttribute("aria-label", "Close"); x.style.cssText = "width:26px;height:26px"; x.onclick = () => inspect(null); hd.append(nm, x); p.append(hd);
  if (e.props.desc) p.append(el("div", "ds", e.props.desc));
  const chips = el("div", "props");
  if (e.props.burning) chips.append(el("span", "pill bad", "burning"));
  if (e.kind === "campfire") chips.append(el("span", `pill ${e.props.lit === false ? "" : "warn"}`, e.props.lit === false ? "cold" : "lit"));
  for (const k of (e.props.creature ? ["species"] : ["stock", "resonance", "shifts", "depth", "species"]) as ("stock" | "resonance" | "shifts" | "depth" | "species")[]) if (e.props[k] !== undefined) chips.append(el("span", "pill", `${k} ${e.props[k]}`));
  if (e.kind === "animal" && e.props.creature) {
    const t = Number(e.props.trust ?? 0), stage = t >= 0.9 ? "a friend" : t >= 0.7 ? "trusting" : t >= 0.35 ? "familiar" : "wary";
    chips.append(el("span", `pill ${t >= 0.7 ? "good" : ""}`, stage), el("span", "pill", String(e.props.trait ?? "")), el("span", "pill", `met ${e.props.met ?? 0}×`));
  }
  if (e.props.shape && e.props.colors) for (const [part, hex] of Object.entries(e.props.colors as Record<string, string>)) if (part !== "deck" || e.props.shape === "bridge" || e.props.shape === "platform") { const c = el("span", "pill swatchpill"); c.append(Object.assign(el("i"), { style: `background:${hex}` }), document.createTextNode(` ${part}`)); c.title = `${e.props.colorNames?.[part] ?? hex}`; chips.append(c); }
  if (e.props.glow) chips.append(el("span", "pill warn", "lit"));
  if (e.props.takeable) chips.append(el("span", "pill good", "can be picked up"));
  if (chips.children.length) p.append(chips);
  p.hidden = false;
}

// ---------- dialogs ----------
interface Field { key: string; label: string; placeholder?: string; multiline?: boolean; type?: "text" | "password" | "checkbox"; checked?: boolean }
export function ask(title: string, fields: Field[], submit = "Done", o: { intro?: string; danger?: boolean; error?: string } = {}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const d = el("dialog", "dlg"), f = el("form"); f.method = "dialog"; f.append(el("h2", "", title));
    if (o.intro) f.append(el("p", "intro", o.intro));
    if (o.error) f.append(el("p", "err", o.error));
    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
    for (const fl of fields) {
      const l = el("label", fl.type === "checkbox" ? "check" : "");
      const i = fl.multiline ? el("textarea") : el("input");
      if (fl.type && !fl.multiline) (i as HTMLInputElement).type = fl.type;
      if (fl.type === "checkbox") { (i as HTMLInputElement).checked = !!fl.checked; l.append(i, el("span", "", fl.label)); }
      else { l.append(el("span", "", fl.label), i); i.placeholder = fl.placeholder ?? ""; }
      if (fl.type === "password") { i.setAttribute("inputmode", "numeric"); i.autocomplete = "off"; }
      inputs[fl.key] = i; f.append(l);
    }
    const cancel = el("button", "btn ghost", "Cancel"); cancel.type = "button"; cancel.onclick = () => { d.close("cancel"); };
    const ok = el("button", `btn ${o.danger ? "no" : "ok"}`, submit); ok.value = "ok";
    const row = el("div", "btns"); row.append(cancel, ok); f.append(row); d.append(f); document.body.append(d);
    d.addEventListener("close", () => {
      const v = d.returnValue === "ok" ? Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i instanceof HTMLInputElement && i.type === "checkbox" ? String(i.checked) : i.value.trim()])) : null;
      d.remove(); resolve(v);
    });
    d.showModal(); (Object.values(inputs).find((i) => !(i instanceof HTMLInputElement && i.type === "checkbox")) ?? Object.values(inputs)[0])?.focus();
  });
}

/** Replies from the server to a reset request arrive as notices; the confirmation flow waits for them. */
let awaitingReset: ((n: { level: string; text: string }) => void) | null = null;
export function handleNotice(n: { level: string; text: string }): boolean { if (!awaitingReset) return false; awaitingReset(n); awaitingReset = null; return true; }

export async function startNewRiver(prev?: { world: boolean; error?: string }): Promise<void> {
  const v = await ask("Start a new River", [
    { key: "world", type: "checkbox", checked: prev?.world ?? true, label: "Also generate a new island (new layout; erases everything built, burnt or walked)" },
    { key: "code", type: "password", label: "Confirmation code", placeholder: "••••" },
  ], "Erase and begin again", {
    danger: true, error: prev?.error,
    intro: "This erases River's memories, desires, interests, dreams, stories, places, tunes, inventory, log, and every tool it has unlocked or requested. The tool code stays on disk, locked until the new River asks for it. A backup of the whole database is saved first.",
  });
  if (!v) return;
  send({ t: "reset_river", code: v.code, world: v.world === "true" });
  const n = await new Promise<{ level: string; text: string }>((res) => { awaitingReset = res; });
  if (n.level === "error") return startNewRiver({ world: v.world === "true", error: n.text });
  toast({ title: "A new River", body: n.text, color: "var(--accent)", ttl: 14000 });
}

export function openControls() {
  const d = el("dialog", "dlg"); d.append(el("h2", "", "Controls"));
  const s = S.stats, used = s ? (s.maxTokensPerHour >= 1e8 ? `${(s.tokensLastHour / 1000).toFixed(0)}k tokens · ${s.cyclesLastHour} cycles this hour (no limit on a local model)` : `${(s.tokensLastHour / 1000).toFixed(0)}k of ${(s.maxTokensPerHour / 1000).toFixed(0)}k tokens · ${s.cyclesLastHour} of ${s.maxCyclesPerHour} cycles this hour`) : "";
  const b1 = el("section", "sect"); b1.append(el("h4", "", "Budget & cycles"), el("p", "intro", `${used}. Resetting clears the local counters, ends any error backoff, and starts River thinking again right away. It doesn't change what a hosted provider bills.`));
  const rb = el("button", "btn", "Reset budget & restart cycles"); rb.onclick = () => { send({ t: "reset_budget" }); d.close(); }; b1.append(rb);
  const b2 = el("section", "sect danger"); b2.append(el("h4", "", "Danger zone"), el("p", "intro", "Begin again with a brand-new River. Needs a confirmation code, and the old life is backed up first."));
  const nr = el("button", "btn no", "Start a new River…"); nr.onclick = () => { d.close(); void startNewRiver(); }; b2.append(nr);
  const close = el("button", "btn ghost", "Close"); close.onclick = () => d.close(); const row = el("div", "btns"); row.append(el("span", "grow"), close);
  d.classList.add("wide"); d.append(settingsSection(), b1, b2, row); document.body.append(d); d.addEventListener("close", () => { closeSettings(); d.remove(); }); d.showModal();
}

// ---------- keyboard ----------
function initKeys() {
  addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement; if (t.closest("input, textarea, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= TABS.length) return void showTab(TABS[n - 1]);
    if (e.key === "\\") setSide(document.body.dataset.side !== "open");
    else if (e.key === "f") toggleFollow(); else if (e.key === "m") toggleSound();
    else if (e.key === "p") send({ t: "pause", paused: !S.stats?.paused });
    else if (e.key === "w") send({ t: "sim_pause", paused: !S.stats?.worldPaused });
    else if (e.key === "/") { e.preventDefault(); showTab("log"); $("logsearch").focus(); }
    else if (e.key === "Escape") inspect(null);
  });
}

export function initChrome() {
  const nav = $("tabs");
  TABS.forEach((n, i) => {
    const b = el("button"); b.dataset.tab = n; b.role = "tab"; b.title = `${TAB_LABEL[n]} (${i + 1})`;
    b.append(icon(TAB_ICON[n], 18), el("span", "", TAB_LABEL[n])); const bd = el("span", "badge"); bd.hidden = true; b.append(bd);
    b.onclick = () => showTab(n); nav.append(b);
  });
  initActions(); initResizer(); initKeys();
  setIcon($("seedbtn"), "moon"); setIcon($("giftbtn"), "gift"); setIcon(document.querySelector<HTMLElement>(".iconbtn.send")!, "send");
  setIcon($("logfilter"), "filter"); $("logsearch-ico").append(icon("search", 15)); $("memsearch-ico").append(icon("search", 15));
  if (!store.get("sideOpen", true)) setSide(false);
  addEventListener("resize", applyInset);
  showTab(store.get<TabName>("tab", "log"));
}
