// Mind, Items, Story: the smaller read-only panels.
import { fetchLife, openLife } from "./life.ts";
import { previewOf } from "../renderers/preview.ts";
import { $, clamped, el } from "../dom.ts";
import { S, isTab } from "../state.ts";
import { renderTurningPoints } from "./moments.ts";
import { pieceCount, renderCompositions, tick as musicTick } from "./music.ts";
import { store } from "../dom.ts";
import { EMOTIONS, EMOTION_ORDER, intensityWord } from "../../shared/emotions.ts";

/** A word for the state only when it's notable; the number is always shown. */
const NEED_ROWS: { k: "energy" | "hunger" | "mood" | "curiosity" | "warmth"; label: string; word: (v: number) => string; color: string }[] = [
  { k: "energy", label: "Energy", word: (v) => (v < 20 ? "exhausted" : v < 40 ? "tired" : ""), color: "var(--accent)" },
  { k: "hunger", label: "Fed", word: (v) => (v < 20 ? "starving" : v < 40 ? "hungry" : ""), color: "var(--orange)" },
  { k: "mood", label: "Mood", word: (v) => (v < 25 ? "low" : v > 80 ? "bright" : ""), color: "var(--violet)" },
  { k: "curiosity", label: "Curiosity", word: (v) => (v > 80 ? "restless" : ""), color: "var(--cyan)" },
  { k: "warmth", label: "Warmth", word: (v) => (v < 15 ? "freezing" : v < 35 ? "cold" : ""), color: "#ff9a6b" },
];
let needsBox: HTMLElement | null = null;
let feelBox: HTMLElement | null = null;
let picked: string | null = null;

export function renderFeelings() {
  if (!feelBox || !S.agent) return;
  const f = S.agent.feelings ?? {}, list = EMOTION_ORDER.map((n) => [n, f[n] ?? 0] as const).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]);
  if (!list.length) return void feelBox.replaceChildren(el("div", "muted small", "Steady. Nothing is stirring."));
  feelBox.replaceChildren(...list.map(([n, v]) => {
    const row = el("div", "meterrow"), top = el("div", "row"); top.title = EMOTIONS[n].felt;
    top.append(el("span", "", EMOTIONS[n].label), el("span", "muted small", `${intensityWord(v)} · ${Math.round(v * 100)}`));
    const m = el("span", "meter lg"); m.style.setProperty("--c", EMOTIONS[n].color); const i = el("i"); i.style.width = `${v * 100}%`; m.append(i); row.append(top, m); return row;
  }));
}

let bodyBox: HTMLElement | null = null;
function renderBody() {
  if (!bodyBox) return; const b = S.agent?.body;
  if (!b || (!b.marks.length && !b.sensations.length)) { bodyBox.replaceChildren(el("div", "empty", "Nothing marks it. It feels well.")); return; }
  bodyBox.replaceChildren(...b.marks.map((m) => { const c = el("div", "card row"), sw = el("i", "swatch"); sw.style.background = m.hex; sw.style.opacity = String(0.4 + 0.6 * m.alpha); c.append(sw, el("span", "small", m.desc)); return c; }),
    ...b.sensations.map((s) => el("div", "muted small", s)));
}

export function renderNeeds() {
  renderFeelings(); renderBody();
  if (!needsBox || !S.agent) return;
  const hp = S.agent.body?.health ?? 100, hrow = el("div", "meterrow"), htop = el("div", "row");
  htop.append(el("span", "", "Health"), el("span", "muted small", `${hp < 15 ? "dying" : hp < 35 ? "gravely hurt" : hp < 60 ? "badly hurt" : hp < 85 ? "hurt" : ""}${S.agent.body?.bleeding ? " · bleeding" : ""}${(S.agent.body?.infection ?? 0) > 0.3 ? " · fever" : ""} · ${hp}`.replace(/^ · /, "")));
  const hm = el("span", "meter lg"); hm.style.setProperty("--c", hp < 35 ? "var(--bad)" : "#e8707a"); const hi = el("i"); hi.style.width = `${hp}%`; hm.append(hi); hrow.append(htop, hm);
  needsBox.replaceChildren(hrow, ...NEED_ROWS.map((n) => {
    const v = S.agent!.needs[n.k], row = el("div", "meterrow"), top = el("div", "row");
    const w = n.word(v); top.append(el("span", "", n.label), el("span", "muted small", w ? `${w} · ${v.toFixed(0)}` : v.toFixed(0)));
    const m = el("span", "meter lg"); m.style.setProperty("--c", n.color); const i = el("i"); i.style.width = `${v}%`; m.append(i); row.append(top, m); return row;
  }));
}

export function renderMind() {
  const t = $("tab-mind"), keep = t.scrollTop; t.replaceChildren();
  t.append(el("h3", "", "Needs")); needsBox = el("div"); t.append(needsBox);
  t.append(el("h3", "", "Feelings")); feelBox = el("div"); t.append(feelBox); t.append(el("h3", "", "Body")); bodyBox = el("div"); t.append(bodyBox); renderNeeds();
  t.append(el("h3", "", "Self-image"));
  const self = el("div", "card"); self.append(clamped(S.selfModel || "Not yet reflected.", 4)); t.append(self);
  t.append(Object.assign(el("h3"), { innerHTML: `Desires <span class="n">${S.desires.length}</span>` }));
  if (!S.desires.length) t.append(el("div", "empty", "No desires yet."));
  for (const d of S.desires) {
    const c = el("div", "card desire"), left = el("div"); left.append(clamped(d.text, 3));
    const pr = el("div", "prio"); pr.title = `priority ${d.priority}`; for (let i = 0; i < 5; i++) pr.append(el("i", i < Math.ceil(d.priority / 2) ? "on" : "")); left.append(pr);
    c.append(left, el("span", "pill", `p${d.priority}`)); t.append(c);
  }
  t.append(Object.assign(el("h3"), { innerHTML: `Interests <span class="n">${S.interests.length}</span>` }));
  if (!S.interests.length) t.append(el("div", "empty", "No interests yet."));
  const cloud = el("div", "cloud"); const why = el("div", "why"); why.hidden = true;
  for (const i of S.interests) {
    const b = el("button", `tag${picked === i.topic ? " sel" : ""}`, i.topic); b.style.fontSize = `${12 + Math.min(4, i.weight * 0.9)}px`; b.style.opacity = String(0.6 + Math.min(0.4, i.weight / 8));
    b.onclick = () => { picked = picked === i.topic ? null : i.topic; renderMind(); }; cloud.append(b);
    if (picked === i.topic && i.why) { why.hidden = false; why.textContent = `${i.topic}: ${i.why}`; }
  }
  t.append(cloud, why);
  // ---- taste: what River likes and dislikes, the colours it has named, what it has made
  const T = S.taste;
  if (T.opinions.length || T.palette.length || T.works.length) {
    t.append(Object.assign(el("h3"), { innerHTML: `Tastes <span class="n">${T.opinions.length}</span>` }));
    if (!T.opinions.length) t.append(el("div", "empty", "No opinions yet."));
    for (const o of T.opinions) {
      const c = el("div", `card opinion ${o.stance}`), top = el("div", "row");
      top.append(el("span", "", o.subject), el("span", `pill ${o.stance === "love" || o.stance === "like" ? "good" : "bad"}`, o.stance));
      c.append(top); if (o.why) c.append(el("div", "sub", o.why)); t.append(c);
    }
    if (T.palette.length) {
      t.append(Object.assign(el("h3"), { innerHTML: `Its colours <span class="n">${T.palette.length}</span>` }));
      const row = el("div", "swatches"); for (const c of T.palette) { const s = el("div", "swatch-card"); s.append(Object.assign(el("span", "swatch lg"), { style: `background:${c.hex}` }), el("span", "", c.name)); s.title = c.hex; row.append(s); } t.append(row);
    }
    if (T.works.length) {
      t.append(Object.assign(el("h3"), { innerHTML: `What it has made <span class="n">${T.works.length}</span>` }));
      if (T.style) t.append(el("div", "why", T.style));
      for (const wk of T.works) {
        const c = el("div", "card"), top = el("div", "row"), sw = el("span", "swatches inline");
        for (const hex of new Set(Object.values(wk.colors))) sw.append(Object.assign(el("span", "swatch"), { style: `background:${hex}` }));
        top.append(el("b", "", wk.name), sw); c.append(top, el("div", "sub muted", `${wk.size} ${wk.shape} · ${Object.entries(wk.materials).map(([k, n]) => `${n} ${k}`).join(", ")}`)); t.append(c);
      }
    }
  }
  t.scrollTop = keep;
}

export function renderItems() {
  const t = $("tab-items"); t.replaceChildren();
  if (!S.inventory.length) return void t.append(el("div", "empty", "River isn't carrying anything."));
  t.append(Object.assign(el("h3"), { innerHTML: `Carrying <span class="n">${S.inventory.reduce((a, i) => a + i.qty, 0)}</span>` }));
  const g = el("div", "grid2");
  for (const i of S.inventory) {
    const c = el("div", "card"), top = el("div", "row"); top.append(el("b", "", i.name)); if (i.qty > 1) top.append(el("span", "qty", `×${i.qty}`));
    if (i.visual) { const img = el("img", "preview") as HTMLImageElement; img.width = img.height = 56; img.alt = ""; try { img.src = previewOf(i.visual, 112); } catch { /* no GL here: the card is still complete */ } top.prepend(img); }
    c.append(top, clamped(i.desc, 2, "sub"));
    const more = el("details"); more.style.marginTop = "6px"; const sum = el("summary", "sub", "What it is"); more.append(sum);
    more.ontoggle = async () => {                                  // the inspector: only what the world knows
      if (!more.open || more.querySelector(".facts")) return;
      const d = await (await fetch(`/api/item?id=${encodeURIComponent(i.id)}`)).json(), f = el("div", "sub facts");
      if (d.error) { f.textContent = d.error; more.append(f); return; }
      const cond = d.condition, lines = [
        `${d.id} · ${d.definition}`,
        `Made of ${[...new Set(d.materials.map((m: any) => m.material))].join(" and ")}, about ${d.massKg} kg`,
        `Condition: ${Math.round(cond.durability * 100)}% sound, ${Math.round(cond.wetness * 100)}% wet, ${Math.round(cond.temperatureC)}°C`,
        d.capabilities.length ? `It can: ${d.capabilities.join(", ")}` : "It has no use beyond being what it is",
        d.provenance.unknown ? "Origin: not known" : `Made or found at tick ${d.provenance.createdAtTick}${d.provenance.sourceIds.length ? ` from ${d.provenance.sourceIds.join(", ")}` : ""}`,
        ...(d.lineage.splitFrom ? [`Split from ${d.lineage.splitFrom}`] : []), ...(d.lineage.mergedFrom?.length ? [`Joined by ${d.lineage.mergedFrom.join(", ")}`] : []),
        ...(d.contents.length ? [`Inside: ${d.contents.map((c: any) => `${c.qty} ${c.name}`).join(", ")}`] : []),
      ];
      for (const l of lines) f.append(el("div", "", l));
      more.append(f);
    };
    c.append(more); if (i.props?.text) { const d = el("details"); d.style.marginTop = "6px"; d.append(el("summary", "sub", "Read"), el("div", "sub", `“${i.props.text}”`)); c.append(d); }
    g.append(c);
  }
  t.append(g);
}

/** A collapsible section whose open/closed state is remembered. */
function section(key: string, title: string, count: string, openByDefault: boolean, build: (body: HTMLElement) => void): HTMLElement {
  const d = el("details", "sect-d"); d.open = store.get(`story:${key}`, openByDefault); d.ontoggle = () => store.set(`story:${key}`, d.open);
  const sm = el("summary"); sm.append(el("span", "st", title), ...(count ? [el("span", "n", count)] : [])); d.append(sm);
  const body = el("div", "sect-body"); build(body); d.append(body); return d;
}

export function renderStory() {
  const t = $("tab-story"), keep = t.scrollTop; t.replaceChildren();
  const k = S.keeper;
  const life = el("button", "btn sm", "Read this life so far"); life.style.margin = "4px 0 10px"; life.onclick = async () => { const s = await fetchLife("now"); if (s) openLife(s); }; t.append(life);
  t.append(section("turning", "Turning points", S.moments.length ? String(Math.min(8, S.moments.length)) : "", true, (b) => { const tp = el("div"); tp.id = "turning"; b.append(tp); renderTurningPoints(tp); }));
  t.append(section("music", "Music", pieceCount() ? String(pieceCount()) : "", pieceCount() > 0, (b) => renderCompositions(b)));
  if (k.placed > 0 || k.found.length) t.append(section("keeper", "The Keeper's trail", `${k.found.length} of ${k.total}`, true, (b) => {
    const box = el("div", "card trail");
    k.found.forEach((f) => box.append(Object.assign(el("div", "piece-line"), { innerHTML: `<span class="pk">${f.kind}</span>` }), el("div", "story-text small", f.text)));
    const hidden = k.placed - k.found.length;
    if (!k.complete) box.append(el("div", "muted small", hidden > 0 ? `${hidden} more ${hidden === 1 ? "piece lies" : "pieces lie"} out in the world, not yet found.` : k.placed < k.total ? "Nothing waiting to be found right now. More will appear in time." : ""));
    else box.append(el("div", "muted small", "The trail is complete. A lamp burns at the shrine."));
    b.append(box);
  }));
  t.append(section("days", "The days", S.journal.length ? String(S.journal.length) : "", true, (b) => {
    if (!S.journal.length) return void b.append(el("div", "empty", "No story yet. At each sunrise, River's previous day is written up here."));
    for (const j of S.journal) { const c = el("div", "card"); c.append(el("div", "story-day", `Day ${j.day}`), el("div", "story-text", j.text)); b.append(c); }
  }));
  t.scrollTop = keep; musicTick();
}

export const needsLive = () => { if (isTab("mind")) renderNeeds(); };
