// The obituary, for the TV: when River dies the picture settles on the grave and the screen tells the life, slide by slide. Every slide that
// has more than fits is paginated, so nothing is cut off; the whole thing loops until a new life begins.
import { el } from "../dom.ts";
import { Pager, dwellFor } from "./tv-pager.ts";
import { iconFor } from "./life.ts";
import type { LifeSummary } from "../../shared/life.ts";

interface Slide { id: string; title: string; build: (body: HTMLElement) => Node[] | null; text?: string }
const frozenSlide = () => { const m = /[?&]slide=(\d+)/.exec(location.search); return m ? Number(m[1]) - 1 : null; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function slidesFor(s: LifeSummary): Slide[] {
  const out: Slide[] = [];
  const lines = (title: string, id: string, items: string[]) => { if (items.length) out.push({ id, title, build: () => items.map((t) => el("div", "tv-ol", t)) }); };
  out.push({ id: "title", title: "In memory", build: () => null });
  out.push({ id: "numbers", title: "A life in numbers", build: () => s.numbers.filter((n) => n.value > 0).map((n) => { const t = el("div", "tv-tile"); t.append(el("b", "", String(n.value)), el("span", "", n.label)); return t; }) });
  if (s.achievements.length) out.push({ id: "ach", title: `Achievements · ${s.achievements.length}`, build: () => s.achievements.map((a) => { const c = el("div", "tv-ach"); c.append(el("span", "ic", iconFor(a.icon)), h2(a.title, a.text)); return c; }) });
  lines("What it made", "made", [...s.built.map((b) => `Built ${b.name}`), ...s.crafted.map((c) => `Made ${c.qty > 1 ? `${c.qty} × ` : ""}${c.name}`)]);
  lines("What it found", "found", [...s.discoveries.firsts.map((f) => `A first: ${f}`), ...s.discoveries.places.map((p) => `Named ${p}`), ...s.discoveries.colours.map((c) => `Found the colour ${c}`), ...(s.discoveries.keeperPieces ? [`${plural(s.discoveries.keeperPieces, "piece")} of the Keeper's story`] : []), ...s.discoveries.things.slice(0, 6).map((t) => `Came to know ${plural(t.n, t.kind)}`)]);
  lines("The hunt and the water", "hunt", [...s.hunted.map((h) => `${cap(plural(h.n, h.species))} hunted`), ...(s.fished ? [`${plural(s.fished, "fish")} caught`] : []), ...(s.gathered ? [`${plural(s.gathered, "gathering trip")}`] : [])]);
  lines("Who it knew", "knew", s.bonds.map((b) => `${cap(b.name)}, a ${b.species} · ${Math.round(b.trust * 100)}% trust${b.alive ? "" : " · gone"}`));
  lines("Its tools and its music", "tools", [...(s.tools.requested ? [`Asked for ${plural(s.tools.requested, "tool")}, ${s.tools.granted} granted`] : []), ...s.tools.forged.map((f) => `Had a tool invented: ${f}`), ...s.tools.mostUsed.slice(0, 4).map((u) => `${cap(u.name)}, used ${u.n} times`), ...s.music.map((m) => `Composed “${m}”`)]);
  lines("What it felt most", "felt", s.feelings.map((f) => `${cap(f.emotion)} · ${Math.round(f.peak * 100)}% · ${f.why}`));
  out.push({ id: "last", title: "Remembered", build: () => null, text: s.wrote.lastEntry ?? s.moments[0]?.title ?? s.epitaph });
  return out;
}
const h2 = (a: string, b: string) => { const d = el("div", ""); d.append(el("b", "", a), el("span", "", b)); return d; };

let root: HTMLElement | null = null, key = "", idx = 0, timer = 0, pager: Pager | null = null, slides: Slide[] = [];

function ensure(parent: HTMLElement): HTMLElement {
  if (root && root.parentElement === parent) return root;
  root = el("div", "tv-obit"); root.innerHTML = `<div class="tv-obit-k"></div><div class="tv-obit-slide"></div><div class="tv-obit-dots"></div>`; root.hidden = true; parent.append(root); return root;
}

function show(s: LifeSummary, i: number) {
  const r = root!, box = r.querySelector<HTMLElement>(".tv-obit-slide")!, sl = slides[i]!;
  pager?.stop(); pager = null; clearTimeout(timer);
  r.querySelector(".tv-obit-k")!.textContent = sl.id === "title" ? "" : sl.title;
  r.querySelector<HTMLElement>(".tv-obit-dots")!.replaceChildren(...slides.map((_, j) => el("i", j === i ? "on" : "")));
  box.classList.remove("on"); box.replaceChildren();
  box.dataset.slide = sl.id;
  requestAnimationFrame(() => {
    let hold = 9000;
    if (sl.id === "title") {
      box.append(el("div", "tv-ot-k", "In memory"), el("div", "tv-ot-name", s.name), el("div", "tv-ot-days", `Day ${s.dayBorn} to day ${s.dayEnd}`), el("div", "tv-ot-lived", `Lived ${s.lived}`));
      if (s.cause) box.append(el("div", "tv-ot-cause", cap(s.cause)));
      const ep = el("div", "tv-pg tv-ot-ep"); const dots = el("div", "tv-dots"); box.append(ep, dots);
      box.classList.add("on"); const p = new Pager(ep, { dots, dwell: dwellFor }); p.setText(s.epitaph, (t) => document.createTextNode(t)); pager = p; hold = Math.max(10_000, p.total() + 1500);
    } else if (sl.id === "last") {
      const ep = el("div", "tv-pg tv-ot-quote"), dots = el("div", "tv-dots"); box.append(ep, dots, el("div", "tv-ot-end", "A new River can be born, bare and blank. It may find the grave."));
      box.classList.add("on"); const p = new Pager(ep, { dots, dwell: dwellFor }); p.setText(`“${sl.text}”`, (t) => document.createTextNode(t)); pager = p; hold = Math.max(10_000, p.total() + 1500);
    } else {
      const body = el("div", `tv-pg tv-obody tv-ob-${sl.id}`), dots = el("div", "tv-dots"); box.append(body, dots); box.classList.add("on");
      const p = new Pager(body, { dots, dwell: (page) => 4500 + page.length * 450 }); p.setItems(sl.build(body) ?? [], `${key}:${sl.id}`); pager = p; hold = Math.max(8000, p.total() + 1200);
    }
    if (frozenSlide() === null) timer = window.setTimeout(() => { idx = (idx + 1) % slides.length; show(s, idx); }, hold);
  });
}

/** Show the obituary (or keep showing it). Returns false if there is nothing to show yet. */
export function tvLifeShow(parent: HTMLElement, s: LifeSummary | null): boolean {
  const r = ensure(parent);
  if (!s) return false;
  const k = `${s.life}:${s.end}`;
  r.hidden = false;
  if (k !== key) { key = k; slides = slidesFor(s); idx = Math.min(Math.max(0, frozenSlide() ?? 0), slides.length - 1); show(s, idx); }
  return true;
}
export function tvLifeHide() { pager?.stop(); pager = null; clearTimeout(timer); key = ""; if (root) root.hidden = true; }
export const tvLifeSlides = () => slides.length;
