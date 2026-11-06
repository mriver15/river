// The record of a life, and its summary. While River lives, what it does is noted as it happens (a ledger of deeds); everything else
// is read back from the tables the world already keeps (works, moments, places, journal, creatures, tool requests...). When it dies the
// summary is written down in full, because starting a new life wipes those tables. Counted, not composed: no model writes any of it.
import { bus } from "./bus.ts";
import { db } from "./db.ts";
import { simNow, simTick, STEP_MS } from "./sim.ts";
import type { World } from "./world.ts";
import type { Achievement, LifeSummary } from "../shared/life.ts";

const DAY = 1_440_000;
const q = <T,>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];
const one = <T,>(sql: string, ...a: unknown[]) => q<T>(sql, ...a)[0];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "3 days and 4 hours", in world time (a day is 24 minutes, shown as 24 hours). */
export function livedText(days: number): string {
  const h = Math.round(days * 24);
  if (h < 1) return "less than an hour";
  if (h < 24) return plural(h, "hour");
  const d = Math.floor(h / 24), r = h % 24;
  return `${plural(d, "day")}${r ? ` and ${plural(r, "hour")}` : ""}`;
}

export function startLife(w: World) {
  // what River does is noted as it is done
  bus.on("deed", (e: { kind: string; name: string; qty?: number; detail?: unknown }) => note(e.kind, e.name, e.qty ?? 1, e.detail));
  bus.on("made", (e: { name: string; kind: string; tags?: string[] }) => { if (e.kind === "build" || e.kind === "garment") note(e.kind === "build" ? "built" : "sewed", e.name, 1); });
  bus.on("restored", (e: { name: string }) => note("repaired", e.name, 1));
  bus.on("bond", (e: { name: string; stage: string }) => note("befriended", e.name, 1, { stage: e.stage }));
  void w;
}
const note = (kind: string, name: string, qty: number, detail?: unknown) =>
  db.prepare("INSERT INTO life_deeds(ts, kind, name, qty, detail) VALUES(?,?,?,?,?)").run(simNow(), kind, name, qty, detail === undefined ? null : JSON.stringify(detail));

type Rule = { id: string; title: string; text: string; icon: string; when: (s: Facts) => boolean };
interface Facts { days: number; nights: number; built: number; crafted: number; hunted: number; predators: number; fished: number; places: number; songs: number; wrote: number; tools: number; forged: number; friends: number; named: number; firsts: number; desires: number; keeper: number; repaired: number; colours: number; clothes: number; survivedInjury: boolean }
const PREDATORS = new Set(["wolf", "boar", "bear"]);
/** The things worth being proud of, each a plain rule over the counts. */
const RULES: Rule[] = [
  { id: "survivor", title: "Survivor", text: "Lived through its first night.", icon: "moon", when: (s) => s.nights >= 1 },
  { id: "week", title: "A week on the island", text: "Lasted seven days.", icon: "sun", when: (s) => s.days >= 7 },
  { id: "roof", title: "A roof of its own", text: "Raised something with its own hands.", icon: "home", when: (s) => s.built >= 1 },
  { id: "village", title: "A small settlement", text: "Built three or more things.", icon: "village", when: (s) => s.built >= 3 },
  { id: "maker", title: "Maker", text: "Made ten things that were not there before.", icon: "tools", when: (s) => s.crafted >= 10 },
  { id: "dressed", title: "Clothed", text: "Sewed something to wear.", icon: "shirt", when: (s) => s.clothes >= 1 },
  { id: "hunter", title: "Hunter", text: "Brought down an animal.", icon: "spear", when: (s) => s.hunted >= 1 },
  { id: "predator", title: "Faced the dark things", text: "Killed a wolf, a boar or a bear.", icon: "claw", when: (s) => s.predators >= 1 },
  { id: "fisher", title: "Fisher", text: "Caught a fish with its bare hands.", icon: "fish", when: (s) => s.fished >= 1 },
  { id: "friend", title: "Not alone", text: "Won the trust of a wild animal.", icon: "heart", when: (s) => s.friends >= 1 },
  { id: "namer", title: "Namer of things", text: "Named three or more places or creatures.", icon: "tag", when: (s) => s.named >= 3 },
  { id: "mapmaker", title: "Cartographer", text: "Named five places.", icon: "map", when: (s) => s.places >= 5 },
  { id: "musician", title: "Musician", text: "Composed a piece of music.", icon: "music", when: (s) => s.songs >= 1 },
  { id: "writer", title: "Writer", text: "Kept a journal or inscribed something.", icon: "pen", when: (s) => s.wrote >= 1 },
  { id: "smith", title: "Tool-maker", text: "Had a tool of its own invented.", icon: "wrench", when: (s) => s.forged >= 1 },
  { id: "asked", title: "Resourceful", text: "Asked for tools it needed.", icon: "key", when: (s) => s.tools >= 1 },
  { id: "firsts", title: "Firsts", text: "Did something it had never done before.", icon: "star", when: (s) => s.firsts >= 1 },
  { id: "dreamer", title: "Purposeful", text: "Finished what it set out to do.", icon: "flag", when: (s) => s.desires >= 1 },
  { id: "keeper", title: "Listener", text: "Found a piece of the Keeper's story.", icon: "book", when: (s) => s.keeper >= 1 },
  { id: "mender", title: "Mender", text: "Mended something that was wearing away.", icon: "mend", when: (s) => s.repaired >= 1 },
  { id: "painter", title: "Colourist", text: "Found a colour no one had named.", icon: "palette", when: (s) => s.colours >= 1 },
];

/** Summarise the life that began at `born` and ended at `end` (now, if it has not). */
export function summarise(w: World, o: { born: number; end: number; cause?: string; at?: { x: number; z: number }; alive: boolean; life: number }): LifeSummary {
  const { born, end } = o, range = [born, end] as const;
  const base = simNow() - simTick() * STEP_MS, tick0 = Math.max(0, Math.round((born - base) / STEP_MS));
  const days = (end - born) / DAY, dayBorn = Math.floor((born - w.epoch) / DAY) + 1, dayEnd = Math.floor((end - w.epoch) / DAY) + 1;
  // nights lived: dusk (0.78) each day that fell between birth and end
  let nights = 0; for (let d = Math.floor((born - w.epoch) / DAY); d <= Math.floor((end - w.epoch) / DAY); d++) { const dusk = w.epoch + (d + 0.78) * DAY; if (dusk > born && dusk <= end) nights++; }

  const deeds = q<{ kind: string; name: string; qty: number }>("SELECT kind, name, SUM(qty) qty FROM life_deeds WHERE ts BETWEEN ? AND ? GROUP BY kind, name", ...range);
  const sum = (k: string) => deeds.filter((d) => d.kind === k).reduce((a, d) => a + d.qty, 0);
  const crafted = deeds.filter((d) => d.kind === "crafted").sort((a, b) => b.qty - a.qty).map((d) => ({ name: d.name, qty: d.qty }));
  const hunted = deeds.filter((d) => d.kind === "hunt").sort((a, b) => b.qty - a.qty).map((d) => ({ species: d.name, n: d.qty }));
  const works = q<{ name: string; shape: string }>("SELECT name, shape FROM works WHERE ts BETWEEN ? AND ? ORDER BY ts", ...range);
  const moments = q<{ kind: string; title: string; intensity: number }>("SELECT kind, title, intensity FROM moments WHERE ts BETWEEN ? AND ? ORDER BY intensity DESC", ...range);
  const places = q<{ name: string }>("SELECT name FROM places WHERE ts BETWEEN ? AND ? ORDER BY ts", ...range).map((p) => p.name);
  const songs = q<{ title: string }>("SELECT title FROM compositions WHERE ts BETWEEN ? AND ? ORDER BY ts", ...range).map((c) => c.title);
  const journal = q<{ day: number; text: string }>("SELECT day, text FROM journal WHERE ts BETWEEN ? AND ? ORDER BY day", ...range);
  const colours = q<{ name: string }>("SELECT name FROM palette WHERE ts BETWEEN ? AND ?", ...range).map((c) => c.name);
  const requests = q<{ name: string; status: string }>("SELECT name, status FROM tool_requests WHERE ts BETWEEN ? AND ?", ...range);
  const forged = q<{ name: string }>("SELECT name FROM forged WHERE status = 'installed'").map((f) => f.name);
  const used = q<{ name: string; n: number }>("SELECT json_extract(payload, '$.name') name, COUNT(*) n FROM sim_commands WHERE type = 'tool' AND source = 'brain' AND status = 'ok' AND tick >= ? GROUP BY name ORDER BY n DESC LIMIT 6", tick0).filter((u) => u.name && !["look", "say", "stop", "remember", "recall", "inspect", "move_to"].includes(u.name));
  const gathered = (one<{ n: number }>("SELECT COUNT(*) n FROM sim_activities WHERE def = 'gather' AND status = 'done' AND started_tick >= ?", tick0)?.n) ?? 0;
  const things = new Map<string, number>(); for (const r of q<{ id: string }>("SELECT id FROM known_entities WHERE tick >= ?", tick0)) { const k = r.id.replace(/[_-]?\d+$/, "") || r.id; things.set(k, (things.get(k) ?? 0) + 1); }
  const bonds = q<{ name: string | null; species: string; trust: number; alive: number }>("SELECT name, species, trust, alive FROM creatures WHERE trust >= 0.3 OR name IS NOT NULL ORDER BY trust DESC LIMIT 6").map((c) => ({ name: c.name ?? `a ${c.species}`, species: c.species, trust: +c.trust.toFixed(2), alive: !!c.alive }));
  const feelings = q<{ emotion: string; peak: number; why: string }>("SELECT emotion, MAX(result) peak, why FROM mind_trace WHERE kind = 'appraisal' AND emotion IS NOT NULL GROUP BY emotion ORDER BY peak DESC LIMIT 4").map((f) => ({ emotion: f.emotion, peak: +f.peak.toFixed(2), why: f.why }));
  const desiresDone = q<{ text: string }>("SELECT text FROM desires WHERE status = 'done' ORDER BY id LIMIT 8").map((d) => d.text);
  const keeper = (() => { try { return (w.story as { view(): { found: unknown[] } } | undefined)?.view().found.length ?? 0; } catch { return 0; } })();

  const facts: Facts = {
    days, nights, built: 0, crafted: crafted.reduce((a, c) => a + c.qty, 0), hunted: sum("hunt"), predators: hunted.filter((h) => PREDATORS.has(h.species)).reduce((a, h) => a + h.n, 0), fished: sum("fish"),
    places: places.length, songs: songs.length, wrote: journal.length + deeds.filter((d) => d.kind === "crafted" && /book|tablet|inscri|note/i.test(d.name)).length, tools: requests.length, forged: forged.length,
    friends: bonds.filter((b) => b.trust >= 0.5).length, named: places.length + bonds.filter((b) => !b.name.startsWith("a ")).length, firsts: moments.filter((m) => m.kind === "first").length, desires: desiresDone.length, keeper, repaired: sum("repaired"), colours: colours.length, clothes: sum("sewed"), survivedInjury: false,
  };
  facts.built = Math.max(works.length, sum("built"));
  const achievements: Achievement[] = RULES.filter((r) => r.when(facts)).map(({ id, title, text, icon }) => ({ id, title, text, icon }));
  const lived = livedText(days);

  const numbers = [
    { label: "Nights survived", value: nights }, { label: "Things built", value: facts.built }, { label: "Things made", value: facts.crafted }, { label: "Animals hunted", value: facts.hunted },
    { label: "Fish caught", value: facts.fished }, { label: "Places named", value: places.length }, { label: "Tools asked for", value: facts.tools, note: forged.length ? `${forged.length} invented` : undefined },
    { label: "Pieces of music", value: songs.length }, { label: "Journal pages", value: journal.length }, { label: "Friends", value: facts.friends }, { label: "Things gathered", value: gathered }, { label: "Firsts", value: facts.firsts },
  ];
  const hunt = hunted.length ? `hunted ${hunted.map((h) => plural(h.n, h.species)).join(", ")}` : "";
  const bits = [facts.built ? `built ${plural(facts.built, "thing")}` : "", facts.crafted ? `made ${facts.crafted} more` : "", hunt, facts.friends ? `befriended ${bonds.filter((b) => b.trust >= 0.5)[0]!.name}` : "", songs.length ? `composed ${plural(songs.length, "piece")}` : ""].filter(Boolean);
  const epitaph = o.alive ? `${w.me.name} has lived ${lived} so far${bits.length ? `: ${bits.join(", ")}` : ""}.`
    : `${w.me.name} lived ${lived}${bits.length ? `: ${bits.join(", ")}` : ""}. ${o.cause ? `${o.cause[0]!.toUpperCase()}${o.cause.slice(1)} was the end of them.` : ""}`.trim();
  return {
    name: w.me.name, life: o.life, alive: o.alive, born, end, days: +days.toFixed(3), lived, dayBorn, dayEnd, nights, cause: o.cause ?? "", place: o.at ?? null, epitaph,
    numbers, achievements, built: works, crafted, hunted, fished: facts.fished, gathered, tools: { requested: requests.length, granted: requests.filter((r) => r.status === "approved").length, forged, mostUsed: used },
    discoveries: { firsts: moments.filter((m) => m.kind === "first").map((m) => m.title), places, things: [...things].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n).slice(0, 8), colours, keeperPieces: keeper },
    music: songs, wrote: { journal: journal.length, lastEntry: journal.at(-1)?.text ?? null }, bonds, feelings, desiresDone, moments: moments.slice(0, 6).map((m) => ({ title: m.title, intensity: +m.intensity.toFixed(2) })),
  };
}

/** River has died: write the life down, in full, before anything is wiped. */
export function recordObituary(w: World, d: { born: number; at: number; cause: string; x: number; z: number }): LifeSummary {
  const life = (one<{ n: number }>("SELECT COUNT(*) n FROM lives")?.n) ?? 1;
  const s = summarise(w, { born: d.born, end: d.at, cause: d.cause, at: { x: d.x, z: d.z }, alive: false, life });
  db.prepare("INSERT OR REPLACE INTO obituaries(life, name, died, summary) VALUES(?,?,?,?)").run(life, s.name, d.at, JSON.stringify(s));
  return s;
}
export const obituary = (life?: number): LifeSummary | null => { const r = life ? one<{ summary: string }>("SELECT summary FROM obituaries WHERE life = ?", life) : one<{ summary: string }>("SELECT summary FROM obituaries ORDER BY life DESC LIMIT 1"); return r ? (JSON.parse(r.summary) as LifeSummary) : null; };
export const obituaries = () => q<{ life: number; name: string; died: number; summary: string }>("SELECT life, name, died, summary FROM obituaries ORDER BY life DESC").map((r) => { const s = JSON.parse(r.summary) as LifeSummary; return { life: r.life, name: r.name, died: r.died, lived: s.lived, cause: s.cause, epitaph: s.epitaph, achievements: s.achievements.length }; });
/** The life that is under way: from its birth to now. */
export function lifeSoFar(w: World, born: number): LifeSummary {
  const life = ((one<{ n: number }>("SELECT COUNT(*) n FROM lives")?.n) ?? 0) + 1;
  return summarise(w, { born, end: simNow(), alive: true, life });
}
