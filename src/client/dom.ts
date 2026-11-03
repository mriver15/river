export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
}

// Small stroke-icon set (24x24 viewBox, drawn with currentColor).
const ICONS = {
  log: "M4 6h16M4 12h16M4 18h10", mind: "M12 3a6 6 0 0 0-6 6c0 2 1 3 2 4v2h8v-2c1-1 2-2 2-4a6 6 0 0 0-6-6zM9 19h6M10 22h4",
  story: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM8 17h11", map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  items: "M6 8h12l1 12H5L6 8zM9 8V6a3 3 0 0 1 6 0v2", tools: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.7-.7-2.2 2.4-2.6z",
  memory: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  pause: "M8 5v14M16 5v14", play: "M7 4v16l13-8z", volume: "M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  mute: "M11 5 6 9H3v6h3l5 4V5zM16 9l5 6M21 9l-5 6", follow: "M12 3v4M12 17v4M3 12h4M17 12h4M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z", gift: "M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C9 7 8 3.5 10 3c1.5-.3 2 2 2 4zM12 7c3 0 4-3.5 2-4-1.5-.3-2 2-2 4z",
  sunrise: "M12 3v4M5.6 7.6l2.8 2.8M18.4 7.6l-2.8 2.8M3 17h18M7 17a5 5 0 0 1 10 0M5 21h14", music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z", download: "M12 4v11M7 11l5 5 5-5M5 20h14", stop: "M6 6h12v12H6z", panel: "M3 5h18v14H3zM15 5v14", sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4", warn: "M12 3 2 21h20L12 3zM12 10v5M12 18h.01", send: "M4 12l16-8-6 16-3-7-7-1z", search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  x: "M6 6l12 12M18 6 6 18", down: "M6 9l6 6 6-6", check: "M5 12l5 5L20 7", filter: "M4 5h16l-6 8v6l-4-2v-4L4 5z", flame: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
} as const;
export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", String(size)); s.setAttribute("height", String(size));
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[name]); s.append(p);
  return s;
}

export function setIcon(btn: HTMLElement, name: IconName, size = 18) { btn.querySelector("svg")?.remove(); btn.prepend(icon(name, size)); }

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const hhmmss = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });
export const ago = (ts: number) => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** Text that clamps to N lines and can be expanded in place. */
export function clamped(text: string, lines = 3, cls = ""): HTMLElement {
  const wrap = el("div", `clamp ${cls}`); const t = el("div", "clamp-text", text); t.style.setProperty("--lines", String(lines));
  const more = el("button", "link", "more"); more.hidden = true;
  more.onclick = () => { const open = t.classList.toggle("open"); more.textContent = open ? "less" : "more"; };
  wrap.append(t, more);
  requestAnimationFrame(() => { more.hidden = !(t.scrollHeight > t.clientHeight + 2); });
  return wrap;
}

/** A segmented control; returns the element and a setter. */
export function segmented<T extends string>(options: { id: T; label: string; count?: number }[], current: T, onPick: (id: T) => void): HTMLElement {
  const box = el("div", "seg");
  for (const o of options) {
    const b = el("button", o.id === current ? "on" : "", o.label); b.type = "button";
    if (o.count !== undefined) b.append(el("span", "n", String(o.count)));
    b.onclick = () => onPick(o.id); box.append(b);
  }
  return box;
}
