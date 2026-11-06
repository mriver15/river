// Small pieces the Brain tab's views are built from, so they look and behave alike.
import { el } from "../dom.ts";

/** An element with children: h("div", "cls", a, b, c). */
export const h = (tag: keyof HTMLElementTagNameMap, cls: string, ...kids: (Node | string)[]): HTMLElement => { const e = el(tag, cls); e.append(...kids); return e; };
export type Tone = "good" | "warn" | "bad" | "info" | "";
export const num = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString());
export const mins = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} h` : s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
export const getJson = async <T,>(url: string): Promise<T> => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json() as Promise<T>; };

/** A titled block. Returns the box and the body to fill. `fold` makes it collapsible, remembering nothing: it opens on each visit. */
export function section(title: string, o: { hint?: string; fold?: boolean; open?: boolean; right?: HTMLElement } = {}): { box: HTMLElement; body: HTMLElement } {
  if (o.fold) {
    const box = el("details", "bt-sec") as HTMLDetailsElement; box.open = o.open ?? false;
    const sum = el("summary", "", title); if (o.hint) sum.append(el("span", "bt-hint", o.hint)); box.append(sum);
    const body = el("div", "bt-body"); box.append(body); return { box, body };
  }
  const box = el("section", "bt-sec"), head = el("div", "bt-head"); head.append(el("h3", "", title));
  if (o.hint) head.append(el("span", "bt-hint", o.hint)); if (o.right) head.append(o.right);
  const body = el("div", "bt-body"); box.append(head, body); return { box, body };
}
export const chip = (text: string, tone: Tone = "", title?: string) => { const c = el("span", `bt-chip ${tone}`, text); if (title) c.title = title; return c; };
export const note = (text: string) => el("div", "bt-note", text);
export const empty = (text: string, action?: HTMLElement) => { const d = el("div", "bt-empty", text); if (action) d.append(action); return d; };
export const button = (label: string, onClick: () => void, cls = "") => { const b = el("button", `btn sm ${cls}`, label); b.type = "button"; b.onclick = onClick; return b; };

/** A number with a label, big enough to read at a glance. */
export function tile(label: string, value: string, sub = "", tone: Tone = ""): HTMLElement {
  const t = el("div", `bt-tile ${tone}`); t.append(el("div", "bt-tl", label), el("div", "bt-tv", value)); if (sub) t.append(el("div", "bt-ts", sub)); return t;
}
/** A horizontal gauge, optionally with a marker (where the reserve begins). */
export function gauge(pct: number, o: { tone?: Tone; mark?: number; label?: string } = {}): HTMLElement {
  const g = el("div", `bt-gauge ${o.tone ?? ""}`); g.setAttribute("role", "progressbar"); g.setAttribute("aria-valuenow", String(Math.round(pct))); g.setAttribute("aria-valuemin", "0"); g.setAttribute("aria-valuemax", "100"); if (o.label) g.setAttribute("aria-label", o.label);
  const i = el("i"); i.style.width = `${Math.max(0, Math.min(100, pct))}%`; g.append(i);
  if (o.mark !== undefined) { const m = el("b"); m.style.left = `${o.mark}%`; m.title = "Kept for urgent matters"; g.append(m); }
  return g;
}
/** Labelled bars: a label, a bar of `share` (0..1), and the figures beside it. */
export function bars(rows: { label: string; share: number; text: string; color?: string; title?: string }[]): HTMLElement {
  const box = el("div", "bt-bars");
  for (const r of rows) {
    const row = el("div", "bt-bar"); if (r.title) row.title = r.title; if (r.color) row.style.setProperty("--c", r.color);
    const g = gauge(r.share * 100); g.classList.add("thin");
    row.append(el("span", "bt-bl", r.label), g, el("span", "bt-bt", r.text)); box.append(row);
  }
  return box;
}
/** "Day 12, 06:40 (dawn)" into the time to show big and the rest to show small. */
export function clockParts(label: string): { time: string; rest: string } {
  const m = /Day (\d+), (\d{2}:\d{2}) \(([^)]*)\)/.exec(label); return m ? { time: m[2]!, rest: `day ${m[1]} · ${m[3]}` } : { time: label, rest: "" };
}
/** "2 s ago", for the freshness line. */
export const since = (ts: number) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 2 ? "just now" : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };

/** A view of the Brain tab. `mount` builds its skeleton once (so controls keep their state); `refresh` fills it with fresh data. */
export interface View { mount(box: HTMLElement): void; refresh(): Promise<void>; /** poll while shown? Views with inputs the person is typing into say no. */ live: boolean }
