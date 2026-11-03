import { $, clamped, ago, el, icon, segmented, store } from "../dom.ts";
import { S, send } from "../state.ts";
import { setBadge } from "./chrome.ts";
import type { ForgedTool, ToolInfo, ToolRequest } from "../../shared/types.ts";

type Sub = "requests" | "toolbox" | "smith";
let sub = store.get<Sub>("toolsSub", "requests");
let query = "";
const notes = new Map<number, string>();        // typed notes survive re-renders
const noteOpen = new Set<number>();
const openTools = new Set<string>();            // expanded toolbox rows

export function openToolsSub(s: Sub) { sub = s; store.set("toolsSub", s); }
const pending = () => S.requests.filter((r) => r.status === "pending");
const needsReview = () => S.forged.filter((f) => f.status === "staged");
const typing = () => { const a = document.activeElement; return !!a && a.tagName === "INPUT" && $("tab-tools").contains(a); };

export function renderTools() {
  setBadge("tools", pending().length + needsReview().length);
  const root = $("tab-tools");
  if (!root.classList.contains("active") || typing()) return;
  const keepScroll = root.scrollTop;
  const counts = { requests: pending().length, toolbox: S.tools.length, smith: S.forged.filter((f) => f.status !== "rejected").length };
  const nav = el("div", "subnav");
  const seg = segmented<Sub>([{ id: "requests", label: "Requests", count: counts.requests }, { id: "toolbox", label: "Toolbox", count: counts.toolbox }, { id: "smith", label: "Smith", count: counts.smith }], sub, (id) => { sub = id; store.set("toolsSub", id); renderTools(); });
  seg.querySelector("button:first-child .n")?.classList.toggle("alert", counts.requests > 0);
  nav.append(seg);
  const body = el("div", "toolsbody");
  root.replaceChildren(nav, body);
  if (sub === "requests") drawRequests(body); else if (sub === "toolbox") drawToolbox(body); else drawSmith(body);
  root.scrollTop = keepScroll;
}

// ---------- requests ----------
function requestCard(r: ToolRequest) {
  const c = el("div", "card alert");
  const top = el("div", "row"); top.append(el("b", "mono", r.name), el("span", `pill ${r.custom ? "warn" : ""}`, r.custom ? "new idea" : "catalog"));
  c.append(top, clamped(r.reason, 4, "sub"));
  c.append(el("div", "sub muted", r.custom ? "A new ability starts the tool smith, which writes it for your review." : "Approving unlocks it immediately."));
  if (r.matches?.length) {
    const box = el("div", "matches"); box.append(el("div", "sub", "This sounds like something that already exists. Grant it as is, or have a new one built:"));
    for (const m of r.matches) {
      const info = S.tools.find((t) => t.name === m.name), row = el("div", "matchrow"), left = el("div");
      left.append(Object.assign(el("div", "row"), { innerHTML: `<span class="mono">${m.name}</span><span class="muted small">${Math.round(m.score * 100)}% match</span>` }), clamped(info?.description ?? "", 2, "sub"));
      const g = el("button", "btn ok sm", "Grant"); g.onclick = () => { const n = notes.get(r.id); notes.delete(r.id); noteOpen.delete(r.id); send({ t: "approve", id: r.id, note: n || undefined, builtin: m.name }); };
      row.append(left, g); box.append(row);
    }
    c.append(box);
  }
  const note = el("input", "note"); note.placeholder = "Note back to River (optional)"; note.value = notes.get(r.id) ?? ""; note.oninput = () => notes.set(r.id, note.value);
  note.hidden = !noteOpen.has(r.id);
  const addNote = el("button", "btn ghost sm", "Add note"); addNote.onclick = () => { noteOpen.add(r.id); note.hidden = false; addNote.hidden = true; note.focus(); }; addNote.hidden = noteOpen.has(r.id);
  const decide = (t: "approve" | "deny") => { const n = notes.get(r.id); notes.delete(r.id); noteOpen.delete(r.id); send({ t, id: r.id, note: n || undefined }); };
  const ok = el("button", r.matches?.length ? "btn" : "btn ok", r.matches?.length ? "Build a new one" : "Approve"); if (!r.matches?.length) ok.prepend(icon("check", 14)); ok.onclick = () => decide("approve");
  const no = el("button", "btn no", "Deny"); no.onclick = () => decide("deny");
  const row = el("div", "btns"); row.append(ok, no, el("span", "grow"), addNote);
  c.append(note, row); return c;
}
function drawRequests(root: HTMLElement) {
  const p = pending();
  if (!p.length) root.append(el("div", "empty", "No requests waiting. River asks for tools when its interests call for one."));
  p.forEach((r) => root.append(requestCard(r)));
  const done = S.requests.filter((r) => r.status !== "pending");
  if (!done.length) return;
  const d = el("details", "group"); d.open = store.get("histOpen", false); d.ontoggle = () => store.set("histOpen", d.open);
  const sm = el("summary"); sm.append(document.createTextNode("History "), el("span", "n", `(${done.length})`)); d.append(sm);
  for (const r of done) {
    const h = el("div", "hist"); h.append(el("span", "mono", r.name), el("span", `pill ${r.status === "approved" ? "good" : "bad"}`, r.status));
    const sub = el("div", "sub muted", `${ago(r.ts)}${r.note ? ` · “${r.note}”` : ""}`); h.append(sub);
    const built = S.forged.some((f) => f.name === r.name && !["failed", "rejected"].includes(f.status)) || S.tools.some((x) => x.name === r.name && x.status === "approved");
    if (r.custom && r.status === "approved" && !built) { const b = el("button", "btn sm", "Build with tool smith"); b.onclick = () => send({ t: "forge", id: r.id }); h.append(b); }
    d.append(h);
  }
  root.append(d);
}

// ---------- toolbox ----------
function toolRow(t: ToolInfo) {
  const r = el("div", `toolrow ${t.status}${openTools.has(t.name) ? " open" : ""}`); r.append(el("span", "st"), el("span", "nm", t.name), el("span", "ds", t.description));
  r.title = t.status === "base" ? "Built in" : t.status === "approved" ? "Unlocked" : "Locked: River can request it";
  r.onclick = () => { openTools.has(t.name) ? openTools.delete(t.name) : openTools.add(t.name); r.classList.toggle("open"); }; return r;
}
function drawToolbox(root: HTMLElement) {
  const s = el("div", "search wide"); const ico = el("span"); ico.append(icon("search", 15)); const inp = el("input"); inp.placeholder = "Filter tools…"; inp.value = query; s.append(ico, inp);
  const list = el("div"); root.append(s, list);
  const draw = () => {
    const q = query.toLowerCase(); list.replaceChildren();
    const match = (t: ToolInfo) => !q || t.name.includes(q) || t.description.toLowerCase().includes(q);
    const groups: [string, ToolInfo[], boolean][] = [
      ["Unlocked", S.tools.filter((t) => t.status === "approved" && match(t)), true],
      ["Locked", S.tools.filter((t) => t.status === "locked" && match(t)), true],
      ["Built in", S.tools.filter((t) => t.status === "base" && match(t)), !!q],
    ];
    for (const [name, items, open] of groups) {
      if (!items.length) continue;
      const d = el("details", "group"); d.open = open; const sm = el("summary"); sm.append(document.createTextNode(`${name} `), el("span", "n", `(${items.length})`)); d.append(sm);
      items.forEach((t) => d.append(toolRow(t))); list.append(d);
    }
    if (!list.children.length) list.append(el("div", "empty", "No tools match."));
  };
  inp.oninput = () => { query = inp.value; draw(); }; draw();
}

// ---------- smith ----------
function smithCard(f: ForgedTool) {
  const c = el("div", `card${f.status === "staged" ? " alert" : ""}`);
  const label = { forging: "writing…", staged: "ready for review", installed: "installed", failed: "failed", rejected: "rejected" }[f.status];
  const top = el("div", "row"); top.append(el("b", "mono", f.name), el("span", `pill ${f.status === "installed" ? "good" : f.status === "staged" ? "warn" : f.status === "failed" ? "bad" : ""}`, label)); c.append(top);
  if (f.status === "forging") c.append(el("div", "sub muted", "The smith is writing and testing this tool…"));
  if (f.code || f.log) { const d = el("details"); d.append(el("summary", "sub", f.code ? "Code & test results" : "Log")); if (f.code) d.append(el("pre", "", f.code)); d.append(el("pre", "", f.log)); d.style.marginTop = "6px"; c.append(d); }
  const row = el("div", "btns");
  if (f.status === "staged") { const ok = el("button", "btn ok", "Install"), no = el("button", "btn no", "Reject"); ok.onclick = () => send({ t: "install", name: f.name }); no.onclick = () => send({ t: "reject", name: f.name }); row.append(ok, no); }
  if (f.status === "failed") { const b = el("button", "btn sm", "Retry"); b.onclick = () => send({ t: "forge", id: f.request_id }); row.append(b); }
  if (row.children.length) c.append(row);
  return c;
}
function drawSmith(root: HTMLElement) {
  const list = S.forged.filter((f) => f.status !== "rejected");
  if (!list.length) return void root.append(el("div", "empty", "Nothing built yet. When you approve a new tool idea, the smith writes it here for your review."));
  const order = { staged: 0, forging: 1, failed: 2, installed: 3, rejected: 4 };
  const active = list.filter((f) => f.status !== "installed").sort((a, b) => order[a.status] - order[b.status]);
  active.forEach((f) => root.append(smithCard(f)));
  const done = list.filter((f) => f.status === "installed");
  if (!done.length) return;
  const d = el("details", "group"); d.open = !active.length || store.get("smithOpen", false); d.ontoggle = () => store.set("smithOpen", d.open);
  const sm = el("summary"); sm.append(document.createTextNode("Installed "), el("span", "n", `(${done.length})`)); d.append(sm);
  for (const f of done) {
    const row = el("div", "hist"); row.append(el("span", "mono", f.name), el("span", "pill good", "installed"));
    const code = el("details"); code.className = "sub"; code.append(el("summary", "", "Code & test results"), el("pre", "", f.code), el("pre", "", f.log)); row.append(code); d.append(row);
  }
  root.append(d);
}
