// The Brain tab: five views of what is going on inside, one at a time, each built once and refreshed in place so nothing you were doing is lost.
//   Overview (at a glance, what needs you), Mind (decisions and tokens), Heart (feelings, attachments, beliefs), World (clock, parameters, plugins), Timeline.
import { $, el, segmented, store } from "../dom.ts";
import { isTab } from "../state.ts";
import { setBadge } from "./chrome.ts";
import { alerts, overviewView } from "./brain-overview.ts";
import { mindView } from "./brain-mind.ts";
import { heartView } from "./brain-heart.ts";
import { worldView } from "./brain-world.ts";
import { timelineView } from "./brain-timeline.ts";
import { button, empty, since, type View } from "./brain-ui.ts";

const ORDER = ["overview", "mind", "heart", "world", "timeline"] as const;
type Id = (typeof ORDER)[number];
const LABEL: Record<Id, string> = { overview: "Overview", mind: "Mind", heart: "Heart", world: "World", timeline: "Timeline" };
const FACTORY: Record<Id, () => View> = { overview: overviewView, mind: mindView, heart: heartView, world: worldView, timeline: timelineView };

const views = new Map<Id, { view: View; box: HTMLElement; ok: boolean }>();
const wantView = new URLSearchParams(location.search).get("view") ?? store.get("brainView", "overview");        // ?view=heart opens that view
let current = ((ORDER as readonly string[]).includes(wantView) ? wantView : "overview") as Id;
let shell: { nav: HTMLElement; fresh: HTMLElement; body: HTMLElement } | null = null;
let freshAt = 0, busy = false, timer = 0;

function ensureShell() {
  const root = $("brainview");
  if (shell && root.contains(shell.body)) return shell;
  root.replaceChildren(); views.clear();
  const nav = el("div", "bt-nav"), fresh = el("span", "bt-fresh"), body = el("div", "bt-views");
  root.append(nav, body); shell = { nav, fresh, body };
  drawNav();
  return shell;
}
function drawNav() {
  if (!shell) return;
  const seg = segmented(ORDER.map((id) => ({ id, label: LABEL[id] })), current, (id) => show(id));
  seg.setAttribute("role", "tablist"); seg.querySelectorAll("button").forEach((b, i) => { b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(ORDER[i] === current)); });
  seg.addEventListener("keydown", (e) => { const i = ORDER.indexOf(current); if (e.key === "ArrowRight") show(ORDER[(i + 1) % ORDER.length]!); else if (e.key === "ArrowLeft") show(ORDER[(i + ORDER.length - 1) % ORDER.length]!); });
  shell.nav.replaceChildren(seg, shell.fresh, button("Refresh", () => void refresh(true), "ghost"));
}
function show(id: Id) { current = id; store.set("brainView", id); drawNav(); void refresh(true); }

/** Mount the view if it is new, refresh it, and say how fresh it is. Failures stay on screen with a way to retry; the last good picture is kept. */
async function refresh(force = false) {
  const s = ensureShell(); if (busy || (!force && Date.now() - freshAt < 1500)) return;
  busy = true;
  try {
    let entry = views.get(current);
    if (!entry) { const view = FACTORY[current](), box = el("div", "bt-view"); view.mount(box); entry = { view, box, ok: false }; views.set(current, entry); s.body.append(box); }
    for (const [id, v] of views) v.box.hidden = id !== current;
    try { await entry.view.refresh(); entry.ok = true; freshAt = Date.now(); s.fresh.textContent = `updated ${since(freshAt)}`; s.fresh.classList.remove("bad"); entry.box.querySelector(".bt-error")?.remove(); }
    catch (e) {
      s.fresh.textContent = "could not update"; s.fresh.classList.add("bad");
      if (!entry.box.querySelector(".bt-error")) entry.box.prepend(Object.assign(empty(`This view could not be loaded (${(e as Error).message}).`, button("Try again", () => void refresh(true))), { className: "bt-empty bt-error" }));
    }
  } finally { busy = false; }
}

/** Called when the tab is shown and whenever the page's data changes; cheap, because refreshes are spaced out. */
export function loadBrain() { void refresh(); }

// While the tab is on screen and the view is one that can change under you, keep it fresh. Elsewhere, only the badge is kept up (from what the page already knows).
function tick() {
  const n = alerts().length; setBadge("brain", n);
  if (!isTab("brain") || document.hidden || !shell) return;
  if (shell.fresh.isConnected && freshAt) shell.fresh.textContent = `${shell.fresh.classList.contains("bad") ? "could not update" : "updated"} ${since(freshAt)}`;
  if (views.get(current)?.view.live ?? true) void refresh();
}
timer = window.setInterval(tick, 3000); void timer;
