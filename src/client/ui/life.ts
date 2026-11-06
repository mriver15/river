// A life, told: what River did and made and found. Used by the death card, the Story tab ("this life so far"), and the TV view's obituary.
import { el } from "../dom.ts";
import type { LifeSummary } from "../../shared/life.ts";

const ICON: Record<string, string> = { moon: "☾", sun: "☀", home: "⌂", village: "⌂⌂", tools: "⚒", shirt: "◈", spear: "↗", claw: "✦", fish: "≈", heart: "♥", tag: "❖", map: "◎", music: "♪", pen: "✎", wrench: "⚙", key: "⚿", star: "★", flag: "⚑", book: "❡", mend: "✚", palette: "◐" };
export const iconFor = (name: string) => ICON[name] ?? "★";

export async function fetchLife(which: "now" | "last"): Promise<LifeSummary | null> {
  try {
    const r = await fetch(which === "now" ? "/api/life" : "/api/obituary"); const j = await r.json();
    return j && !j.error ? (j as LifeSummary) : null;
  } catch { return null; }
}

const list = (items: string[]) => { const ul = el("ul", "life-list"); for (const t of items) ul.append(el("li", "", t)); return ul; };
const block = (title: string, ...kids: (Node | string)[]) => { const d = el("section", "life-sec"); d.append(el("h4", "", title)); d.append(...kids); return d; };

/** The whole summary as one scrolling page of cards. */
export function lifeBody(s: LifeSummary): HTMLElement {
  const root = el("div", "life");
  const head = el("div", "life-head");
  head.append(el("div", "life-k", s.alive ? "This life so far" : "In memory"), el("h2", "", s.name), el("div", "life-lived", `${s.alive ? "has lived" : "lived"} ${s.lived}`), el("div", "life-ep", s.epitaph));
  if (!s.alive && s.cause) head.append(el("div", "life-cause", `${s.cause[0]!.toUpperCase()}${s.cause.slice(1)}.`));
  root.append(head);
  const tiles = el("div", "life-tiles"); for (const n of s.numbers.filter((n) => n.value > 0 || ["Nights survived", "Things built", "Things made"].includes(n.label))) { const t = el("div", "life-tile"); t.append(el("b", "", String(n.value)), el("span", "", n.label)); if (n.note) t.title = n.note; tiles.append(t); }
  root.append(block("A life in numbers", tiles));
  if (s.achievements.length) { const g = el("div", "life-ach"); for (const a of s.achievements) { const c = el("div", "life-a"); c.append(el("span", "ic", iconFor(a.icon)), el("div", "", "")); (c.lastChild as HTMLElement).append(el("b", "", a.title), el("span", "", a.text)); g.append(c); } root.append(block(`Achievements (${s.achievements.length})`, g)); }
  else root.append(block("Achievements", el("p", "muted small", "None yet.")));
  const made = [...s.built.map((b) => `Built ${b.name} (${b.shape})`), ...s.crafted.slice(0, 12).map((c) => `Made ${c.qty > 1 ? `${c.qty} × ` : ""}${c.name}`)];
  if (made.length) root.append(block("What it made", list(made)));
  const found = [...s.discoveries.firsts.map((f) => `First: ${f}`), ...s.discoveries.places.map((p) => `Named a place: ${p}`), ...s.discoveries.colours.map((c) => `Found a colour: ${c}`), ...(s.discoveries.keeperPieces ? [`Found ${s.discoveries.keeperPieces} piece${s.discoveries.keeperPieces === 1 ? "" : "s"} of the Keeper's story`] : []), ...s.discoveries.things.slice(0, 5).map((t) => `Came to know ${t.n} ${t.kind}${t.n === 1 ? "" : "s"}`)];
  if (found.length) root.append(block("What it found", list(found)));
  const hunted = [...s.hunted.map((h) => `Hunted ${h.n} ${h.species}${h.n === 1 ? "" : "s"}`), ...(s.fished ? [`Caught ${s.fished} fish`] : [])];
  if (hunted.length) root.append(block("What it hunted", list(hunted)));
  const tools = [...(s.tools.requested ? [`Asked for ${s.tools.requested} tool${s.tools.requested === 1 ? "" : "s"}, ${s.tools.granted} granted`] : []), ...s.tools.forged.map((f) => `Had a tool invented: ${f}`), ...s.tools.mostUsed.slice(0, 4).map((u) => `Used ${u.name} ${u.n} times`)];
  if (tools.length) root.append(block("Its tools", list(tools)));
  const knew = [...s.bonds.map((b) => `${b.name} the ${b.species} (${Math.round(b.trust * 100)}% trust${b.alive ? "" : ", gone"})`)];
  if (knew.length) root.append(block("Who it knew", list(knew)));
  if (s.music.length) root.append(block("What it played", list(s.music)));
  if (s.feelings.length) root.append(block("What it felt most", list(s.feelings.map((f) => `${f.emotion} (${Math.round(f.peak * 100)}%): ${f.why}`))));
  if (s.wrote.lastEntry) root.append(block("Its last journal page", el("p", "life-quote", s.wrote.lastEntry)));
  return root;
}

let modal: HTMLElement | null = null;
export function openLife(s: LifeSummary) {
  modal?.remove();
  const m = el("div", "life-modal"), card = el("div", "life-card"), close = el("button", "iconbtn life-x", "×"); close.setAttribute("aria-label", "Close"); close.onclick = () => { m.remove(); modal = null; };
  card.append(close, lifeBody(s)); m.append(card); m.onclick = (e) => { if (e.target === m) close.click(); };
  addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close.click(); removeEventListener("keydown", esc); } });
  document.body.append(m); modal = m;
}
