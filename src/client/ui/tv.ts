// The TV view: River's world as something to watch from across a room. The panels go away; a slow camera director takes over; and what matters is
// said large and plainly: where River is, what it is doing, what it thinks and says, how it is, what has just happened, and (when things are
// quiet) what it carries, wants and remembers. Everything here reads what the page already knows. Nothing is added to the simulation.
import { $, el, store } from "../dom.ts";
import { S, ctx } from "../state.ts";
import { NEEDS } from "./chrome.ts";
import { dominant } from "./moments.ts";
import { EMOTIONS, EMOTION_ORDER, intensityWord } from "../../shared/emotions.ts";
import type { AgentView, LogEntry, Moment } from "../../shared/types.ts";
import { Pager, dwellFor } from "./tv-pager.ts";

let on = false, root: HTMLElement | null = null, timer = 0, cursorTimer = 0, cardTimer = 0, cardIdx = 0, resizeTimer = 0;
/** One pager for each region that can have more to say than fits. */
const pg: { vitals?: Pager; card?: Pager; said?: Pager; moment?: Pager; ticker?: Pager } = {};

// ---------- captions: what River thinks and says, one at a time, held long enough to read ----------
interface Caption { who: string; text: string; kind: string; at: number }
const queue: Caption[] = []; let showing: (Caption & { until: number }) | null = null;
const CAPTION_KINDS: Record<string, string> = { thought: "River thinks", speech: "River says", dream: "River dreams", human: "A voice from outside", inscription: "River writes", reflection: "River reflects", world: "", need: "" };
let demoing = false, feeding = false;
export function tvLog(e: LogEntry) {
  if (!on || (demoing && !feeding)) return;
  const who = CAPTION_KINDS[e.kind]; if (who === undefined) return;
  if (e.kind === "world" && e.data?.perceived === false) return;                        // what River did not notice is not shown as news
  const text = e.text.replace(/^Human: /, "").replace(/^.*? dreams: /, "").trim(); if (!text) return;
  if (who === "") return void pushTicker(e);
  queue.push({ who, text, kind: e.kind, at: Date.now() });
  if (queue.length > 4) queue.splice(0, queue.length - 4);                              // if it is racing ahead, show the latest, not a backlog
  if (e.kind !== "thought" && e.kind !== "speech") pushTicker(e);
}

// ---------- a ticker of what has just happened ----------
const ticker: { text: string; at: number }[] = [];
function pushTicker(e: LogEntry) { ticker.unshift({ text: e.text, at: Date.now() }); ticker.length = Math.min(ticker.length, 6); }

// ---------- moments: the big cards ----------
let momentUntil = 0;
export function tvMoment(m: Moment) {
  if (!on || !root || m.intensity < 0.4 || (demoing && !feeding)) return;
  const d = dominant(m), card = root.querySelector<HTMLElement>(".tv-moment")!;
  card.style.setProperty("--c", d ? EMOTIONS[d].color : "var(--accent)");
  card.querySelector(".tv-k")!.textContent = m.kind === "first" ? "A first" : d ? EMOTIONS[d].noun : "A moment";
  card.querySelector(".tv-t")!.textContent = m.title;
  card.classList.add("on"); root.classList.add("tv-moment-on");
  pg.moment!.setText(m.kind === "first" ? "Something River has never done before." : m.text, (t) => document.createTextNode(t), `${m.id}:${m.title}`);
  momentUntil = Date.now() + Math.max(11_000, pg.moment!.total() + 1500);                  // long enough to read every page of it
}

// ---------- the rotating information card ----------
type Card = () => { title: string; lines: string[] } | null;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const CARDS: Card[] = [
  () => { const inv = S.inventory.slice(0, 8), worn = (S.agent?.worn ?? []).map((g) => g.name); return inv.length || worn.length ? { title: "River is carrying", lines: [...inv.map((i) => `${i.qty > 1 ? `${i.qty} × ` : ""}${i.name}`), ...(worn.length ? [`Wearing: ${worn.join(", ")}`] : [])] } : { title: "River is carrying", lines: ["Nothing at all."] }; },
  () => { const d = S.desires.filter((x) => x.status === "active").slice(0, 3); return d.length ? { title: "What River wants", lines: d.map((x) => clip(x.text, 110)) } : null; },
  () => { const i = S.interests.slice(0, 4); return i.length ? { title: "What River is curious about", lines: i.map((x) => x.topic) } : null; },
  () => { const j = S.journal[0]; return j ? { title: `From River's journal, day ${j.day}`, lines: [clip(j.text, 330)] } : null; },
  () => S.places.length ? { title: "Places River has named", lines: S.places.slice(0, 5).map((p) => `${p.name}${p.note ? ` — ${clip(p.note, 60)}` : ""}`) } : null,
  () => S.keeper.total ? { title: "The Keeper's story", lines: [`${S.keeper.found.length} of ${S.keeper.total} pieces found`, ...(S.keeper.complete ? ["The story is whole."] : [])] } : null,
  () => { const m = S.moments[0]; return m ? { title: "The last thing that stirred River", lines: [m.title] } : null; },
  () => { const b = S.agent?.body; return b && (b.sensations.length || b.marks.length) ? { title: "How River feels in its body", lines: b.sensations.slice(0, 4).map((s) => clip(s, 90)).concat(b.marks.slice(0, 2).map((m) => clip(m.desc, 90))) } : null; },
];
function nextCard() {
  if (!root) return;
  const card = root.querySelector<HTMLElement>(".tv-card")!;
  clearTimeout(cardTimer);
  for (let tries = 0; tries < CARDS.length; tries++) {
    const c = CARDS[cardIdx++ % CARDS.length]!(); if (!c) continue;
    card.classList.remove("on");
    setTimeout(() => {
      card.querySelector(".tv-k")!.textContent = c.title;
      pg.card!.setItems(c.lines.map((l) => el("div", "tv-l", l)), `${c.title}|${c.lines.join("|")}`);
      card.classList.add("on");
      cardTimer = window.setTimeout(nextCard, Math.max(14_000, pg.card!.total() + 2000));      // the next card waits until every page of this one has been read
    }, 700);
    return;
  }
  cardTimer = window.setTimeout(nextCard, 8000);
}

// ---------- drawing ----------
const timeText = (wt: number) => { const h = wt * 24; return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`; };
const partOfDay = (wt: number) => { const h = wt * 24; return h < 5 ? "Deep night" : h < 8 ? "Dawn" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 20 ? "Evening" : "Night"; };

const needNodes = new Map<string, HTMLElement>(), feelNodes = new Map<string, HTMLElement>();
function build() {
  root = el("div", ""); root.id = "tv";
  root.innerHTML = `
    <div class="tv-bar top"></div><div class="tv-bar bottom"></div><div class="tv-vignette"></div>
    <div class="tv-frame">
      <div class="tv-clock"><div class="tv-day"></div><div class="tv-time"></div><div class="tv-sub"></div></div>
      <div class="tv-vitals"><div class="tv-pg tv-vbody"></div><div class="tv-dots" hidden></div></div>
      <div class="tv-lower">
        <div class="tv-who"></div><div class="tv-doing"></div><div class="tv-progress"><i></i></div>
        <div class="tv-moment"><div class="tv-k"></div><div class="tv-t"></div><div class="tv-pg tv-x"></div><div class="tv-dots" hidden></div></div>
        <div class="tv-caption"><span class="tv-by"></span><div class="tv-pg tv-said"></div><div class="tv-dots" hidden></div></div>
      </div>
      <div class="tv-right">
        <div class="tv-card"><div class="tv-k"></div><div class="tv-pg tv-cbody"></div><div class="tv-dots" hidden></div></div>
        <div class="tv-ticker"><div class="tv-pg tv-tbody"></div><div class="tv-dots" hidden></div></div>
      </div>
    </div>
    <div class="tv-hint">Esc to leave the TV view</div>`;
  document.body.append(root);
  const mk = (box: string, dots: string, dwell: (p: Node[]) => number = dwellFor) => new Pager(root!.querySelector<HTMLElement>(box)!, { dots: root!.querySelector<HTMLElement>(dots)!, dwell });
  pg.vitals = mk(".tv-vbody", ".tv-vitals .tv-dots", (p) => 6500 + p.length * 150);
  pg.card = mk(".tv-cbody", ".tv-card .tv-dots");
  pg.said = mk(".tv-said", ".tv-caption .tv-dots");
  pg.moment = mk(".tv-x", ".tv-moment .tv-dots");
  pg.ticker = mk(".tv-tbody", ".tv-ticker .tv-dots", (p) => 5000 + p.length * 400);
  for (const n of NEEDS) { const d = el("div", "tv-need"); d.dataset.k = n.k; d.style.setProperty("--c", n.color); d.innerHTML = `<div class="tv-l">${n.label}</div><span class="tv-meter"><i></i></span>`; needNodes.set(n.k, d); }
}

/** Demo mode only: what to pretend River's state is, whatever the server says. */
let fake: Partial<AgentView> | null = null;
function render() {
  if (!root || !S.agent) return; const a: AgentView = fake ? { ...S.agent, ...fake } : S.agent;
  const q = <T extends HTMLElement>(s: string) => root!.querySelector<T>(s)!;
  q(".tv-clock .tv-day").textContent = `Day ${a.day}`; q(".tv-clock .tv-time").textContent = timeText(a.worldTime);
  q(".tv-clock .tv-sub").textContent = `${partOfDay(a.worldTime)} · ${a.weather[0]!.toUpperCase()}${a.weather.slice(1)}${S.stats?.worldPaused ? " · world frozen" : ""}`;
  // vitals: every need, every feeling, how the body is: as many pages as it takes
  for (const n of NEEDS) { const d = needNodes.get(n.k)!, v = a.needs[n.k]; d.querySelector<HTMLElement>("i")!.style.width = `${v}%`; d.classList.toggle("tv-low", v < 20 && n.k !== "curiosity"); }
  const items: Node[] = [...needNodes.values()], keys: string[] = ["needs"];
  const hp = a.body?.health ?? 100;
  if (hp < 95) { let d = needNodes.get("health"); if (!d) { d = el("div", "tv-need"); d.style.setProperty("--c", "#ff7a70"); d.innerHTML = `<div class="tv-l">Health</div><span class="tv-meter"><i></i></span>`; needNodes.set("health", d); } d.querySelector<HTMLElement>("i")!.style.width = `${hp}%`; d.classList.toggle("tv-low", hp < 40); items.push(d); keys.push("health"); }
  const feels = EMOTION_ORDER.map((n) => [n, a.feelings?.[n] ?? 0] as const).filter(([, v]) => v >= 0.1).sort((x, y) => y[1] - x[1]);
  for (const [n, v] of feels) { let c = feelNodes.get(n); if (!c) { c = el("span", "tv-feel"); c.style.setProperty("--c", EMOTIONS[n].color); feelNodes.set(n, c); } c.textContent = `${intensityWord(v)} ${EMOTIONS[n].label}`; items.push(c); keys.push(n); }
  const body = [...(a.body?.sensations ?? []), ...(a.body?.marks ?? []).map((m) => m.desc)];
  for (const t of body) { items.push(el("div", "tv-line", t)); keys.push(t); }
  pg.vitals!.setItems(items, keys.join("|"));
  q(".tv-lower .tv-who").textContent = a.name;
  const doing = a.sleeping ? "Sleeping" : a.progress ? a.progress.label : a.thinking && a.activity === "thinking" ? "Thinking…" : a.activity;
  q(".tv-lower .tv-doing").textContent = doing[0]!.toUpperCase() + doing.slice(1);
  const prog = q(".tv-lower .tv-progress"); prog.hidden = !a.progress || a.sleeping; prog.querySelector<HTMLElement>("i")!.style.width = `${Math.round((a.progress?.pct ?? 0) * 100)}%`;
  q(".tv-lower").classList.toggle("dead", !!a.body?.dead);
  // the caption
  const now = Date.now(), cap = q(".tv-lower .tv-caption");
  if (showing && now > showing.until) { showing = null; cap.classList.remove("on"); }
  if (!showing && queue.length) {
    const c = queue.shift()!, text = c.kind === "speech" ? `“${c.text}”` : c.text;
    cap.querySelector(".tv-by")!.textContent = c.who; cap.dataset.kind = c.kind; cap.classList.add("on");
    pg.said!.setText(text, (t) => document.createTextNode(t), `${c.at}:${text}`);
    showing = { ...c, until: now + pg.said!.total() };                                       // held until every page of it has been shown
  } else if (!showing && a.speech) {                                                       // what River is saying aloud right now, if no caption is waiting
    cap.querySelector(".tv-by")!.textContent = "River says"; cap.classList.add("on"); pg.said!.setText(`“${a.speech}”`, (t) => document.createTextNode(t));
  }
  const mom = q(".tv-moment"); if (momentUntil && now > momentUntil) { momentUntil = 0; mom.classList.remove("on"); root.classList.remove("tv-moment-on"); }
  const recent = ticker.filter((t) => now - t.at < 90_000);
  pg.ticker!.setItems(recent.map((t) => el("div", "tv-tk", t.text)), recent.map((t) => `${t.at}`).join());
}

// ---------- on and off ----------
const wake = () => { document.body.classList.remove("tv-idle"); clearTimeout(cursorTimer); cursorTimer = window.setTimeout(() => document.body.classList.add("tv-idle"), 3500); };
export const tvOn = () => on;
export function setTv(next: boolean, opts: { fullscreen?: boolean } = {}) {
  if (next === on) return; on = next;
  document.body.classList.toggle("tv", on);
  if (on) {
    if (!root) build(); root!.hidden = false;
    ctx.scene?.setInset(0); ctx.scene?.setCinema(true); if (ctx.scene) { ctx.scene.follow = true; ctx.scene.cutaways = true; }
    render(); if (/[?&]demo\b/.test(location.search)) demo();
    for (const p of Object.values(pg)) p?.relayout();                                        // (re)start every pager
    timer = window.setInterval(render, 400); nextCard();
    addEventListener("mousemove", wake); addEventListener("keydown", wake); wake();
    if (opts.fullscreen && document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
    store.set("tv", true);
  } else {
    if (root) root.hidden = true; clearInterval(timer); clearTimeout(cardTimer); for (const p of Object.values(pg)) p?.stop();
    removeEventListener("mousemove", wake); removeEventListener("keydown", wake); document.body.classList.remove("tv-idle");
    ctx.scene?.setCinema(false); window.dispatchEvent(new Event("resize"));              // the side panel's inset comes back
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    store.set("tv", false);
  }
}
/** `?tv&demo` fills every region with the longest things it can hold, to check that nothing lands on anything else. */
function demo() {
  demoing = true; feeding = true;                                                           // from here the real world is ignored, so the picture is the same every time
  const long = "I keep thinking about the sound the stone made when I struck it, and whether the thing I felt was fear or only wonder dressed up as fear, because my hands would not stop shaking, and the more I turn it over the less I can tell the two apart, and perhaps that is what wonder is: fear that has decided to stay.";
  tvLog({ id: 1, ts: Date.now(), kind: "thought", text: long });
  for (const t of ["A deer steps out of cover and lifts its head, thirteen metres to the north-east, and does not move.", "Thunder rolls over the hill and the whole clearing goes quiet for a long moment.", "A crow lands on the shrine and looks at River.", "Rain begins, soft at first.", "The fire at the old camp has burnt down to coals.", "A new star is out over the sea."]) pushTicker({ id: 2, ts: Date.now(), kind: "world", text: t });
  if (!/nomoment/.test(location.search)) { tvMoment({ id: 1, ts: Date.now(), kind: "moment", title: "Overwhelming wonder: the stone sang when I struck it with the other stone", text: long, intensity: 0.9, emotions: { wonder: 0.8 }, x: 0, z: 0 }); momentUntil = Date.now() + 3_600_000; }
  fake = { feelings: { wonder: 0.9, dread: 0.6, longing: 0.55, pride: 0.5, playfulness: 0.4, grief: 0.35, loneliness: 0.3, boredom: 0.2, frustration: 0.15 },
    body: { health: 62, sensations: ["Your left forearm throbs where the fox clawed it.", "A dull ache has settled in your right ankle.", "You are shivering, and your fingers will not close properly.", "Your mouth is dry."], marks: [] } as unknown as AgentView["body"] };
  S.inventory.splice(0, S.inventory.length, ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, kind: "stick", name: `a very long name for carried thing number ${i + 1}`, desc: "", qty: 3 })));
  CARDS.unshift(() => ({ title: "River is carrying a great many things", lines: S.inventory.map((i) => `${i.qty} × ${i.name}`) })); cardIdx = 0; nextCard(); feeding = false;
}
export const toggleTv = () => setTv(!on, { fullscreen: true });
/** `?tv` in the address opens the TV view as soon as the world has arrived (a browser will not go fullscreen without a click, so that part waits for one). */
export function wantsTvFromUrl() { return /[?&#]tv\b/.test(location.search + location.hash); }
addEventListener("keydown", (e) => { if (on && e.key === "Escape") setTv(false); });
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => { if (on) for (const p of Object.values(pg)) p?.relayout(); }, 250); });   // a different screen shape: measure again
void $;
