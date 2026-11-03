import { $, clamped, el, hhmmss, icon, segmented, store } from "../dom.ts";
import type { LogEntry, LogKind } from "../../shared/types.ts";

const KINDS: LogKind[] = ["thought", "moment", "feeling", "dream", "speech", "world", "inscription", "desire", "reflection", "human", "need", "request", "action", "observation", "web", "memory", "system"];
const PRESETS = {
  life: ["thought", "moment", "feeling", "dream", "speech", "world", "inscription", "desire", "reflection", "human", "need", "request"],
  actions: ["action", "observation", "web"],
  all: KINDS,
} as Record<string, LogKind[]>;
type Preset = "life" | "actions" | "all" | "custom";

export const hooks = { notable: (_e: LogEntry) => {} };

let preset = store.get<Preset>("logPreset", "life");
let kinds = new Set<LogKind>(preset === "custom" ? store.get<LogKind[]>("logKinds", PRESETS.life) : PRESETS[preset]);
let query = "";
let unread = 0;
const box = () => $("log");

const stuck = () => box().scrollHeight - box().scrollTop - box().clientHeight < 70;
const toBottom = () => { box().scrollTop = box().scrollHeight; unread = 0; updateJump(); };
function updateJump() {
  const j = $("jump"); j.hidden = stuck();
  j.replaceChildren(icon("down", 14), document.createTextNode(unread ? ` ${unread} new` : " Latest"));
}

function entryNode(e: LogEntry): HTMLElement {
  const n = el("div", `entry k-${e.kind}`);
  n.dataset.kind = e.kind; n.dataset.id = String(e.id); n.dataset.text = e.text.toLowerCase();
  if (e.data?.perceived === false) { n.classList.add("unseen"); n.title = "River didn't notice this"; }
  const body = el("div", "body"); const tag = el("span", "tag", e.kind === "observation" ? "saw" : e.kind);
  const long = e.text.length > 280 || e.text.split("\n").length > 5;
  const tx = long ? clamped(e.text, 4, "tx") : el("span", "tx", e.text);
  if (e.kind === "action" || e.kind === "observation") body.append(tx); else body.append(tag, tx);
  n.append(el("span", "ts", hhmmss(e.ts)), body);
  n.hidden = !visible(n);
  return n;
}
const visible = (n: HTMLElement) => kinds.has(n.dataset.kind as LogKind) && (!query || n.dataset.text!.includes(query));
const refilter = () => { box().querySelectorAll<HTMLElement>(".entry").forEach((n) => (n.hidden = !visible(n))); stuck() || toBottom(); };

export function addLog(e: LogEntry, live: boolean) {
  const wasStuck = stuck(), n = entryNode(e);
  box().append(n);
  if (box().children.length > 1500) box().firstElementChild?.remove();
  if (wasStuck) toBottom(); else if (live && !n.hidden) { unread++; updateJump(); }
  if (live) hooks.notable(e);
}
export function resetLog(entries: LogEntry[]) { box().replaceChildren(...(entries.length >= 300 ? [olderBtn()] : [])); entries.forEach((e) => addLog(e, false)); toBottom(); }

function olderBtn() {
  const b = el("button", "btn ghost sm older", "Load older entries");
  b.onclick = async () => {
    const first = box().querySelector<HTMLElement>(".entry"); if (!first) return;
    const before = box().scrollHeight, older: LogEntry[] = await (await fetch(`/api/log?before=${first.dataset.id}`)).json();
    older.forEach((e) => first.before(entryNode(e))); box().scrollTop += box().scrollHeight - before;
  };
  return b;
}

function drawPresets() {
  const p = $("logpresets"); p.replaceChildren(segmented<Preset>([{ id: "life", label: "Life" }, { id: "actions", label: "Actions" }, { id: "all", label: "All" }].concat(preset === "custom" ? [{ id: "custom", label: "Custom" }] : []) as { id: Preset; label: string }[], preset, (id) => {
    preset = id; if (id !== "custom") kinds = new Set(PRESETS[id]); store.set("logPreset", id); drawPresets(); drawTray(); refilter();
  }));
}
function drawTray() {
  const t = $("kindtray"); t.replaceChildren();
  for (const k of KINDS) {
    const b = el("button", kinds.has(k) ? `on k-${k}` : `k-${k}`, k); b.type = "button";
    b.onclick = () => { kinds.has(k) ? kinds.delete(k) : kinds.add(k); preset = "custom"; store.set("logPreset", "custom"); store.set("logKinds", [...kinds]); drawPresets(); drawTray(); refilter(); };
    t.append(b);
  }
}

export function initLog() {
  drawPresets(); drawTray();
  $("logfilter").onclick = () => { const t = $("kindtray"); t.hidden = !t.hidden; $("logfilter").classList.toggle("on", !t.hidden); };
  let timer: number | undefined;
  ($("logsearch") as HTMLInputElement).oninput = (e) => { clearTimeout(timer); const v = (e.target as HTMLInputElement).value.toLowerCase().trim(); timer = window.setTimeout(() => { query = v; refilter(); }, 120); };
  box().addEventListener("scroll", () => { if (stuck()) unread = 0; updateJump(); });
  $("jump").onclick = toBottom;
  $("kindtray").hidden = true;
}
