// Pagination for the TV view. A region of the screen has a fixed size; if what it has to say does not fit, it says it in pages, one after the
// other, each held long enough to read, with a row of dots showing which page it is on. Nothing is cut off and nothing is left out.
// Fit is measured, not guessed: content is added to the real box until the box overflows, so the same code is right on any screen.
import { el } from "../dom.ts";

export interface PagerOpts {
  /** the row of dots, shown only when there is more than one page */
  dots: HTMLElement;
  /** how long a page is held, in ms */
  dwell: (page: Node[]) => number;
}
const FADE = 380;
/** `?page=2` (with `?demo`) holds every pager on that page, so each page can be photographed. */
const frozenPage = () => { const m = /[?&]page=(\d+)/.exec(location.search); return m ? Number(m[1]) - 1 : null; };

export class Pager {
  pages: Node[][] = [];
  idx = 0;
  private key = "";
  private timer = 0;
  private src: { kind: "items"; items: Node[] } | { kind: "text"; text: string; make: (t: string) => Node } | null = null;
  constructor(readonly box: HTMLElement, private o: PagerOpts) {}

  /** Show these nodes, in as many pages as it takes. Does nothing if `key` is what it already shows (so a refresh does not restart the page). */
  setItems(items: Node[], key: string) {
    if (key === this.key && this.src?.kind === "items") return;
    this.key = key; this.src = { kind: "items", items }; this.layout();
  }
  /** Show this text, broken at word boundaries into pages that each fill the box. */
  setText(text: string, make: (t: string) => Node, key = text) {
    if (key === this.key && this.src?.kind === "text") return;
    this.key = key; this.src = { kind: "text", text, make }; this.layout();
  }
  /** The screen changed shape: measure again, keeping the page if it still exists. */
  relayout() { if (this.src) this.layout(true); }
  stop() { clearTimeout(this.timer); }
  /** How long it takes to show every page once: what a caller waits for before moving on. */
  total(): number { return this.pages.reduce((a, p) => a + this.o.dwell(p) + FADE, 0); }

  /** Is the box being drawn at all? (An empty box has no height, so height cannot tell.) */
  private laidOut = () => this.box.isConnected && this.box.getClientRects().length > 0;
  /** Does the content run past the box? A couple of pixels of slack: italic and descender overshoot make a line report a pixel or two more than its box. A real extra line is far more. */
  private over = () => this.box.scrollHeight > this.box.clientHeight + 3;

  private layout(keep = false) {
    clearTimeout(this.timer);
    const was = keep ? this.idx : 0, s = this.src!;
    this.box.classList.remove("tv-out"); this.box.replaceChildren();
    if (s.kind === "items") this.pages = this.splitItems(s.items); else this.pages = this.splitText(s.text, s.make);
    if (!this.pages.length) this.pages = [[]];
    this.idx = Math.min(was, this.pages.length - 1);
    const f = frozenPage(); if (f !== null) this.idx = Math.min(Math.max(0, f), this.pages.length - 1);
    this.paint(); this.dots(); this.schedule();
  }
  private splitItems(items: Node[]): Node[][] {
    const pages: Node[][] = []; let cur: Node[] = [];
    if (!this.laidOut()) return [items];                                       // not on screen yet (hidden): one page, measured again when it is shown
    for (const it of items) {
      this.box.append(it);
      if (this.over() && cur.length) { pages.push(cur); cur = []; this.box.replaceChildren(it); }     // that one starts the next page
      cur.push(it);
    }
    if (cur.length) pages.push(cur);
    this.box.replaceChildren(); return pages;
  }
  private splitText(text: string, make: (t: string) => Node): Node[][] {
    const words = text.split(/\s+/).filter(Boolean), cut = (a: number, b: number, first: boolean) => `${first ? "" : "… "}${words.slice(a, b).join(" ")} …`;   // measured with both marks: the last page drops its mark and so only gets shorter
    if (!this.laidOut() || !words.length) return [[make(text)]];
    const chunks: [number, number][] = []; let start = 0;
    const node = make(""); this.box.replaceChildren(node);
    while (start < words.length) {
      let end = start + 1;
      const set = (n: number) => { (node as Text | HTMLElement).textContent = cut(start, n, start === 0); };
      set(end);
      while (end < words.length) { set(end + 1); if (this.over()) break; end++; }
      chunks.push([start, end]); start = end;
    }
    this.box.replaceChildren();
    return chunks.map(([a, b], i) => [make(`${i === 0 ? "" : "… "}${words.slice(a, b).join(" ")}${i === chunks.length - 1 ? "" : " …"}`)]);
  }
  private paint() { this.box.replaceChildren(...(this.pages[this.idx] ?? [])); }
  private dots() {
    const n = this.pages.length, d = this.o.dots;
    d.hidden = n < 2; d.setAttribute("aria-label", n > 1 ? `page ${this.idx + 1} of ${n}` : "");
    d.replaceChildren(...this.pages.map((_, i) => el("i", i === this.idx ? "on" : "")));
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.pages.length < 2 || frozenPage() !== null) return;
    this.timer = window.setTimeout(() => {
      this.box.classList.add("tv-out");
      this.timer = window.setTimeout(() => { this.idx = (this.idx + 1) % this.pages.length; this.paint(); this.dots(); this.box.classList.remove("tv-out"); this.schedule(); }, FADE);
    }, this.o.dwell(this.pages[this.idx]!));
  }
}

/** Reading time: a few seconds to take a page in, and a little for each word, whatever is on it. */
export const dwellFor = (page: Node[]) => 4200 + (page.reduce((n, p) => n + (p.textContent?.length ?? 0), 0)) * 55;
