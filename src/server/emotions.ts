// River's emotional life. Events don't carry fixed feelings; they are APPRAISED:
//   - relevance: does it touch what River cares about (its desires, interests, named places)? (local embeddings)
//   - habituation: the tenth meteor is not the first; familiar things lose their force, and recover over hours
//   - carry-over: arousal already in the body colours what comes next, and can turn an ambiguous sign from wonder into fear
// Large changes become MOMENTS (see moments.ts): the things the viewer is shown and the day's story is built from.
import { bus, log } from "./bus.ts";
import { db, kvGet, kvSet } from "./db.ts";
import { EMBED_ENABLED, dot, embed, relevance } from "./embed.ts";
import { activeDesires, interests } from "./mind.ts";
import { listPlaces } from "./places.ts";
import { recordMoment } from "./moments.ts";
import { align } from "./taste.ts";
import type { Moment } from "../shared/types.ts";
import { BITTERSWEET, EMOTIONS, EMOTION_ORDER, intensityWord, type EmotionName } from "../shared/emotions.ts";
import type { World } from "./world.ts";
import { simNow, simTick, every, after, inject, scheduleJob, onJob } from "./sim.ts";
import { cfg } from "./config.ts";
import { NO_FACTORS, appraiseAmount, decay, habitKey, habituate, type EventNature, type Factors } from "../mind/appraisal.ts";
import type { Link } from "../mind/links.ts";
import type { Belief } from "../mind/beliefs.ts";
import { persisted } from "./persist.ts";
import { recordCommand, finishCommand, isReplaying } from "./recorder.ts";
import { lifeGen, isStale, discarded } from "./lifecycle.ts";

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const clip = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const MOOD_SOOTHES: Record<string, EmotionName[]> = {   // what a piece of music can carry away, by its character
  wistful: ["longing", "grief", "loneliness"], agitated: ["frustration", "dread"], joyful: ["playfulness", "wonder", "pride"],
  serene: ["dread", "frustration", "loneliness"], mysterious: ["wonder", "longing"],
};
const HALF_LIFE_HABIT_MS = 2 * 3_600_000;
const FLOW_TOOLS = new Set(["compose", "build", "craft", "plant", "dig", "inscribe", "strip_bark", "name_place", "pitch_rods", "magnifying_lens"]);

interface Trace { eventId?: string; factors?: Factors; parts?: { name: string; mult: number }[] }
interface Ctx { key?: string; relevance?: number; first?: boolean; at?: { x: number; z: number }; title?: string; trace?: Trace }
/** An event as the appraisal sees it: typed, with a stable subject, and optionally the factors the caller already knows. */
export interface Appraisal {
  key: string; emotion: EmotionName; base: number; text: string; why: string;
  /** stable id of the event; the same id is never appraised twice */
  eventId?: string; subject?: string; tags?: string[]; nature?: EventNature;
  ambiguous?: boolean; habit?: boolean; at?: { x: number; z: number }; factors?: Partial<Factors>;
}
/** What the appraisal needs to know about River's relationships and beliefs; provided by the inner-life service. */
export interface Minds { link(id: string): Link | undefined; belief(id: string): Belief | undefined }
/** An appraisal waiting for an optional embedding annotation, which can add a little relevance later but never changes the past. */
interface Pending { emotion: EmotionName; base: number; f: number; rExplicit: number; text: string; why: string; eventId: string }
const SEEN_KEEP = 300, PENDING_KEEP = 30, MINOR_BELOW = 0.02;
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []));

export class Emotions {
  level = Object.fromEntries(EMOTION_ORDER.map((n) => [n, 0])) as Record<EmotionName, number>;
  private why: Partial<Record<EmotionName, string>> = {};
  private edge: Partial<Record<EmotionName, number>> = {};
  private momentAt: Partial<Record<EmotionName, number>> = {};
  private habit: Record<string, { n: number; t: number }>;
  private recent: string[] = [];
  private acts: { t: number; name: string; ok: boolean }[] = [];
  private fails = new Map<string, number>();
  private places = new Map<string, number>();
  private concerns: { text: string; v: Float32Array }[] = [];
  private concernsKey = ""; private concernsAt = 0;
  private cand: Omit<Moment, "id" | "ts"> | null = null; private candPending = false; private lastMomentAt = 0;
  private lastCalm = simNow(); private prevDread = 0;
  /** ids of events already appraised, so a repeat cannot count twice */
  private seen: string[] = [];
  private pending = new Map<number, Pending>();
  private minor: Record<string, { n: number; sum: number; why: string }> = {};
  private traceCount = 0;
  private flushedBlock = 0;
  minds: Minds | null = null;
  /** extra weight given to what is remembered while the heart is stirred; set by memory */
  private salienceCap = 2;

  constructor(private w: World) {
    this.habit = {};
    const s = persisted("emotions", () => this.snapshot());
    if (s) this.restore(s);
    onJob("emotions.moment", () => this.flushMoment());
    bus.on("perceived", (e: { text: string }) => void this.perceived(e.text).catch(() => {}));
    bus.on("expressed", (e: { mood: string; note: string }) => this.expressed(e));
    bus.on("made", (e: { name: string; tags: string[]; kind: string; id?: string }) => void this.made(e).catch(() => {}));
    bus.on("discovered-colour", () => void this.appraise({ key: "colour-mix", emotion: "wonder", base: 0.15, text: "a new colour", why: "a colour that wasn't there before" }).catch(() => {}));
    bus.on("bond", (e: { id: string; stage: string; name: string }) => void this.bond(e).catch(() => {}));
    bus.on("story", (e: { text: string; final: boolean }) => void this.storyBeat(e).catch(() => {}));
  }

  start() { every(1000, () => this.tick(1), "emotions"); }
  /** Everything that decides how feelings evolve: committed with the clock, restored after a restart, and hashed. */
  private snapshot() { return { ...this.state(), cand: this.cand, candPending: this.candPending, lastMomentAt: this.lastMomentAt, lastCalm: this.lastCalm, prevDread: this.prevDread, seen: this.seen, pending: [...this.pending], minor: this.minor, relId: this.relId, flushedBlock: this.flushedBlock }; }
  private restore(s: ReturnType<Emotions["snapshot"]>) {
    this.level = s.level; this.why = s.why; this.edge = s.edge; this.momentAt = s.momentAt; this.habit = s.habit; this.recent = s.recent; this.acts = s.acts;
    this.fails = new Map(s.fails); this.places = new Map(s.places); this.cand = s.cand; this.candPending = s.candPending;
    this.lastMomentAt = s.lastMomentAt; this.lastCalm = s.lastCalm; this.prevDread = s.prevDread;
    this.seen = s.seen ?? []; this.pending = new Map(s.pending ?? []); this.minor = s.minor ?? {}; this.relId = s.relId ?? 0; this.flushedBlock = s.flushedBlock ?? Math.floor(simTick() / 600);
  }
  /** Everything that decides how feelings evolve, for state hashing. */
  state() { return { level: this.level, why: this.why, edge: this.edge, momentAt: this.momentAt, habit: this.habit, recent: this.recent, acts: this.acts, fails: [...this.fails], places: [...this.places], seen: this.seen, pending: [...this.pending], minor: this.minor, flushedBlock: this.flushedBlock }; }
  reset() { for (const n of EMOTION_ORDER) this.level[n] = 0; this.why = {}; this.edge = {}; this.momentAt = {}; this.habit = {}; this.recent = []; this.acts = []; this.fails.clear(); this.places.clear(); this.concerns = []; this.concernsKey = ""; this.seen = []; this.pending.clear(); this.minor = {}; this.flushedBlock = Math.floor(simTick() / 600); this.cand = null; this.candPending = false; this.lastMomentAt = 0; this.lastCalm = simNow(); this.prevDread = 0; }

  // ---------- core ----------
  bump(n: EmotionName, amt: number, why = "", c: Ctx = {}) {
    const prev = this.level[n]; this.level[n] = clamp(Number.isFinite(prev + amt) ? prev + amt : prev); const delta = this.level[n] - prev;
    if (amt > 0 && why) this.why[n] = why;
    this.record(n, prev, delta, why, c.trace);
    const now = simNow(), crossed = prev < 0.55 && this.level[n] >= 0.55 && now - (this.edge[n] ?? 0) > 8 * 60_000;
    // a big enough change is a moment: it is shown to the viewer and goes into the story
    const intensity = clamp(0.3 + delta * 1.2 + (c.first ? 0.2 : 0) + ((c.relevance ?? 0) > 0.6 ? 0.15 : 0));
    if (delta >= 0.22 && (now - (this.momentAt[n] ?? 0) > 90_000 || intensity > 0.8)) {
      this.momentAt[n] = now; if (crossed) this.edge[n] = now;
      const me = this.w.me, label = EMOTIONS[n].noun;
      this.queueMoment({ kind: c.first ? "first" : "moment", title: c.first ? `A first: ${c.title ?? why}` : `${label[0].toUpperCase()}${label.slice(1)}: ${c.title ?? (why || "something stirred")}`, text: EMOTIONS[n].felt, intensity, emotions: { [n]: +delta.toFixed(2) }, x: c.at?.x ?? me.x, z: c.at?.z ?? me.z });
    } else if (crossed) {
      this.edge[n] = now; log("feeling", `${EMOTIONS[n].label[0].toUpperCase()}${EMOTIONS[n].label.slice(1)} rises${this.why[n] ? `: ${this.why[n]}` : "."}`, { emotion: n, level: +this.level[n].toFixed(2) });
    }
  }
  /** One event often stirs several feelings at once. Gather them for a moment and keep only the strongest, and space moments out. */
  private queueMoment(m: Omit<Moment, "id" | "ts">) {
    if (!this.cand || m.intensity > this.cand.intensity) this.cand = m;
    if (!this.candPending) { this.candPending = true; scheduleJob("emotions.moment", 1500); }
  }
  private flushMoment() {
    const best = this.cand; this.cand = null; this.candPending = false;
    if (!best) return;
    if (simNow() - this.lastMomentAt < 20_000 && best.intensity < 0.85) { log("feeling", best.title, { intensity: best.intensity }); return; }   // too soon after the last: note it quietly
    this.lastMomentAt = simNow(); recordMoment(best);
  }
  /** Lower a feeling for a reason (something mended, something found), and keep the reason. */
  ease(n: EmotionName, amt: number, why: string, eventId?: string) {
    const prev = this.level[n]; this.level[n] = clamp(prev - amt); this.record(n, prev, this.level[n] - prev, why, { eventId });
  }
  /** Raise to at least `v` (for continuous conditions like standing near a fire). */
  private floor(n: EmotionName, v: number, why: string) { if (this.level[n] < v) this.bump(n, v - this.level[n], why); }

  tick(dt: number) {
    const w = this.w, me = w.me;
    for (const n of EMOTION_ORDER) {
      this.level[n] = decay(this.level[n], dt, EMOTIONS[n].half);          // simulated seconds; never negative, never non-finite
    }
    // loneliness is an integrator: it grows with silence and eases with company
    const near = w.nearby(12).filter(({ e }) => e.kind === "animal"), trusted = Math.max(0, ...near.map(({ e }) => (e.props.trust as number) ?? 0));
    const ease = near.length ? 0.4 + 1.6 * trusted : 0;               // a stranger's company helps a little; a friend's helps a lot
    this.level.loneliness = clamp(this.level.loneliness + dt / 9000 - ease * dt / 900, 0, 0.85);   // ~2.5h of silence to run deep
    // playfulness settles low when life is safe and comfortable; it only shows when something stirs it
    if (me.needs.energy > 45 && me.needs.hunger > 35 && this.level.dread < 0.2 && this.level.frustration < 0.4) this.level.playfulness = clamp(this.level.playfulness + dt / 2400);
    // dread follows danger
    for (const e of w.entities.values()) if (e.props.burning) { const d = Math.hypot(e.x - me.x, e.z - me.z); if (d < 15) this.floor("dread", 0.7 * (1 - d / 15), "fire nearby"); }
    const night = w.worldTime() < 0.23 || w.worldTime() > 0.78;
    if (w.weather === "storm" && night) this.floor("dread", 0.3, "a storm in the dark");
    if (me.needs.energy < 15) this.floor("dread", 0.25, "exhaustion");
    if (me.needs.warmth < 12) this.floor("dread", 0.3, "the cold");
    // the quiet after fear: the director answers it with something gentle (see ambient.ts)
    if (this.prevDread >= 0.5 && this.level.dread < 0.25) bus.emit("relief", {});
    this.prevDread = this.level.dread;
    if (this.arousal() > 0.3) this.lastCalm = simNow();
    // feelings pull on the plain needs: a good heart lifts mood, a heavy one drags; restlessness feeds curiosity
    w.bump({ mood: this.valence() * 0.02 * dt, curiosity: this.level.boredom * 0.015 * dt });
    w.feelings = this.view();
    if (Math.floor(simTick() / 600) !== this.flushedBlock) { this.flushedBlock = Math.floor(simTick() / 600); this.flushMinor(); }     // once per simulated minute, whatever the phase
  }

  // ---------- why a feeling moved ----------
  /** Every change keeps its cause. Tiny ones are summed into one line a minute, unless full tracing is on. */
  private record(n: EmotionName, prior: number, delta: number, why: string, t?: Trace) {
    if (delta === 0) return;
    const big = Math.abs(delta) >= MINOR_BELOW;
    if (!big && !t?.eventId && !cfg("traceAll")) { const m = (this.minor[n] ??= { n: 0, sum: 0, why }); m.n++; m.sum += delta; m.why = why || m.why; return; }
    db.prepare("INSERT INTO mind_trace(tick, kind, emotion, subject, event_id, prior, delta, result, why, data) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(simTick(), "appraisal", n, null, t?.eventId ?? null, +prior.toFixed(4), +delta.toFixed(4), +this.level[n].toFixed(4), why, t?.factors || t?.parts ? JSON.stringify({ factors: t.factors, parts: t.parts }) : null);
    this.traceCount++;
  }
  private flushMinor() {
    for (const [n, m] of Object.entries(this.minor)) {
      db.prepare("INSERT INTO mind_trace(tick, kind, emotion, prior, delta, result, why, data) VALUES(?,?,?,?,?,?,?,?)")
        .run(simTick(), "aggregate", n, null, +m.sum.toFixed(4), +this.level[n as EmotionName].toFixed(4), m.why, JSON.stringify({ changes: m.n }));
    }
    this.minor = {};
  }
  /** The most recent explanations, newest first, for the inspector. */
  traces(limit = 60, emotion?: string) {
    const rows = (emotion ? db.prepare("SELECT * FROM mind_trace WHERE emotion = ? ORDER BY seq DESC LIMIT ?").all(emotion, limit) : db.prepare("SELECT * FROM mind_trace ORDER BY seq DESC LIMIT ?").all(limit)) as any[];
    return rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }
  /** Extra importance (0..2) for a memory made while the heart is stirred: what was felt is remembered more firmly. */
  salience(): number { return +Math.min(this.salienceCap, this.arousal() * 2).toFixed(2); }
  /** How much a mind this stirred will let a minor matter interrupt it: 1 is ordinary, bounded either way. Critical triggers ignore it. */
  tolerance(): number { return clamp(1 + (this.absorbed() ? 0.8 : 0) - 0.5 * this.level.dread + 0.3 * this.level.frustration, 0.5, 2, ); }

  valence() {
    const L = this.level, pos = L.wonder * 0.8 + L.playfulness * 0.9 + L.pride * 0.7, neg = L.dread * 0.9 + L.grief * 0.8 + L.frustration * 0.6 + L.loneliness * 0.5 + L.boredom * 0.3 + L.longing * 0.25;
    return clamp(pos - neg, -1, 1);
  }
  arousal() { const L = this.level; return clamp(L.dread * 0.9 + L.wonder * 0.8 + L.frustration * 0.7 + L.playfulness * 0.6 + L.boredom * 0.5 + L.grief * 0.2); }
  /** ms since River's heart was last stirred (used to pace the world's surprises). */
  calmFor() { return simNow() - this.lastCalm; }
  /** A lively heart explores more widely: sampling temperature follows arousal. */
  temperature(base: number) { return clamp(base * (0.9 + 0.3 * this.arousal()), 0.9, 1.5); }
  private bittersweet() { const L = this.level; return Math.min(Math.max(L.wonder, L.playfulness, L.pride), Math.max(L.longing, L.grief, L.loneliness * 0.8)); }

  /** Deep in making something: a run of successful, related work. The world should not interrupt it with trivia. */
  absorbed(): boolean {
    const now = simNow(), a = this.acts.filter((x) => now - x.t < 4 * 60_000);
    return a.length >= 6 && a.filter((x) => x.ok).length / a.length >= 0.8 && new Set(a.map((x) => x.name)).size <= 2 && a.every((x) => FLOW_TOOLS.has(x.name)) && this.level.boredom < 0.4;
  }

  view() { const o: Partial<Record<EmotionName, number>> = {}; for (const n of EMOTION_ORDER) if (this.level[n] > 0.05) o[n] = +this.level[n].toFixed(2); return o; }
  private top(min: number) { return EMOTION_ORDER.map((n) => [n, this.level[n]] as const).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]); }

  /** What River is told each cycle. */
  contextText(): string {
    const lines = this.top(0.2).slice(0, 4).map(([n, v]) => `- ${intensityWord(v)} ${EMOTIONS[n].label}${this.why[n] && v > 0.35 ? ` (${this.why[n]})` : ""}: ${EMOTIONS[n].felt}`);
    if (this.bittersweet() > 0.3) lines.push(`- bittersweet: ${BITTERSWEET}`);
    return lines.join("\n");
  }
  describe(): string { const t = this.top(0.2).slice(0, 3).map(([n]) => EMOTIONS[n].label); return t.length ? t.join(", ") : "calm"; }
  afterDream() { for (const n of ["longing", "grief", "loneliness", "frustration", "dread"] as EmotionName[]) this.level[n] *= 0.6; }
  contact(strength = 1) { this.level.loneliness *= 1 - 0.7 * strength; }

  // ---------- appraisal ----------
  /** What River currently cares about, as vectors, for the optional embedding annotation. Refreshed at most every 30s. */
  private async refreshConcerns() {
    if (simNow() - this.concernsAt < 30_000) return; this.concernsAt = simNow();
    const texts = [...activeDesires().slice(0, 8).map((d) => d.text), ...interests().slice(0, 6).map((i) => i.topic), ...listPlaces().map((p) => `${p.name} ${p.note}`.trim())].map((t) => t.slice(0, 200));
    const key = texts.join("|"); if (key === this.concernsKey) return; this.concernsKey = key;
    const vs = texts.length ? await embed(texts, "document") : []; this.concerns = vs ? texts.map((t, i) => ({ text: t, v: vs[i] })) : [];
  }
  /** Relevance from explicit links alone: words shared with what River wants, is curious about or has named, and its attachment to the subject. */
  private explicitRelevance(text: string, tags: string[], subject?: string): { r: number; top?: string } {
    const mine = words(`${text} ${tags.join(" ")}`);
    let best = 0, top: string | undefined;
    for (const c of [...activeDesires().slice(0, 8).map((d) => d.text), ...interests().slice(0, 6).map((i) => i.topic), ...listPlaces().map((p) => `${p.name} ${p.note}`)]) {
      let n = 0; for (const t of words(c)) if (mine.has(t)) n++;
      const r = n ? Math.min(1, 0.45 + 0.2 * n) : 0; if (r > best) { best = r; top = c; }
    }
    const att = subject ? this.minds?.link(subject)?.attachment ?? 0 : 0;
    return { r: Math.max(best, att, 0.3), top: best >= att ? top : undefined };
  }
  /** How exposed River's body is: hungry, worn out and cold make everything land harder. */
  private vulnerability(): number { const n = this.w.me.needs; return clamp(1 - Math.min(n.energy, n.hunger, n.warmth) / 70); }

  /**
   * The optional embedding annotation. It arrives later, is journaled with the tick it was applied, and can only add a little to the
   * same feeling from then on; earlier ticks are never revisited, so how long the service took cannot change a replay.
   */
  private async annotate(id: number, text: string) {
    if (!EMBED_ENABLED || isReplaying()) return;                  // replay applies what the journal recorded
    const gen = lifeGen(), v = await this.relevanceLive(text);
    inject(() => {
      if (isStale(gen)) { discarded("appraisal"); return; }
      if (!this.pending.has(id)) return;                          // forgotten (or the life ended): nothing to add to
      finishCommand(recordCommand("external", "relevance", { id, ...v }), "ok", "");
      this.resolveRelevance({ id, ...v });
    });
  }
  private relId = 0;
  /** Apply a relevance annotation: live when it arrives, or in replay when the journal says it did. */
  resolveRelevance(p: { id: number; r: number; top?: string }) {
    const a = this.pending.get(p.id); if (!a) return;
    this.pending.delete(p.id);
    const extra = Math.min(0.15, Math.max(0, a.base * a.f * 0.8 * (p.r - a.rExplicit)));
    if (extra >= 0.02) this.bump(a.emotion, extra, p.top && p.r > 0.6 ? `${a.why} (it touches on “${clip(p.top, 40)}”)` : a.why, { relevance: p.r, trace: { eventId: `${a.eventId}+annotation`, factors: { ...NO_FACTORS, relevance: p.r } } });
  }
  private async relevanceLive(text: string): Promise<{ r: number; top?: string }> {
    await this.refreshConcerns(); if (!this.concerns.length) return { r: 0.35 };
    const q = await embed([text.slice(0, 300)], "query"); if (!q) return { r: 0.35 };
    let best = 0, top: string | undefined;
    for (const c of this.concerns) { const r = relevance(dot(q[0], c.v)); if (r > best) { best = r; top = c.text; } }
    return { r: best, top };
  }
  private markSeen(id: string): boolean {
    if (this.seen.includes(id)) return false;
    this.seen.push(id); if (this.seen.length > SEEN_KEEP) this.seen.shift();
    return true;
  }
  /** Has this event already been appraised? (Used by callers that do more than appraise.) */
  appraised(eventId: string) { return this.seen.includes(eventId); }

  /**
   * Turn an event into a feeling. `base` is how strongly an unremarkable, first-time event of this kind would land; the factors
   * (novelty, relevance, attachment, expectation error, controllability, responsibility, vulnerability, habituation) scale it, and the
   * change is recorded with its cause. `ambiguous` events (a sound, a footprint) become fear when River is already afraid or keyed up.
   * An event with the same id is never appraised twice, and the answer never depends on how long any outside service takes.
   */
  async appraise(o: Appraisal): Promise<void> { this.appraiseNow(o); }
  appraiseNow(o: Appraisal): void {
    const eventId = o.eventId ?? `${o.key}@${simTick()}`;
    if (!this.markSeen(eventId)) return;
    let emotion = o.emotion, base = o.base, why = o.why, title = o.why, nature: EventNature = o.nature ?? (emotion === "dread" ? "threat" : emotion === "grief" ? "loss" : emotion === "pride" || emotion === "wonder" || emotion === "playfulness" ? "gain" : "neutral");
    if (o.ambiguous && (this.level.dread > 0.25 || this.arousal() > 0.55)) { emotion = "dread"; nature = "threat"; base = 0.15 + 0.3 * this.arousal(); why = `${o.why}, and in the state you were in it felt like a threat`; title = `${o.why}, and it felt like a threat`; }
    const hab = o.habit === false ? { f: 1, first: false } : (() => { const h = habituate(this.habit[o.key], simNow(), HALF_LIFE_HABIT_MS); this.habit[o.key] = h.next; return h; })();
    const rel = this.explicitRelevance(o.text, o.tags ?? [], o.subject);
    const att = o.subject ? this.minds?.link(o.subject)?.attachment ?? 0 : 0;
    const f: Factors = { ...NO_FACTORS, novelty: hab.first ? 1 : hab.f, relevance: rel.r, attachment: att, vulnerability: this.vulnerability(), ...o.factors };
    const carry = 1 + 0.5 * this.arousal();
    const { amount, parts } = appraiseAmount(base, f, nature, hab, carry);
    if (rel.r > 0.6 && rel.top && amount > 0.1) why += ` (it touches on “${clip(rel.top, 40)}”)`;
    if (amount >= 0.02) this.bump(emotion, amount, why, { key: o.key, relevance: rel.r, first: hab.first && base >= 0.15, at: o.at, title, trace: { eventId, factors: f, parts } });
    const id = ++this.relId;
    this.pending.set(id, { emotion, base, f: hab.f, rExplicit: rel.r, text: o.text.slice(0, 300), why: o.why, eventId });
    if (this.pending.size > PENDING_KEEP) this.pending.delete(this.pending.keys().next().value!);
    void this.annotate(id, o.text).catch(() => {});
  }

  // ---------- event hooks ----------
  private async perceived(text: string) {
    const rules: [RegExp, string, EmotionName, number, boolean][] = [   // pattern, habituation key, feeling, strength, ambiguous?
      [/lightning|thunder/i, "lightning", "dread", 0.25, false], [/storm/i, "storm", "dread", 0.2, false], [/fire|burn|spreads|caught/i, "fire-seen", "dread", 0.25, false],
      [/deer|rabbit|crow|fox|firefl/i, "creature", "wonder", 0.1, false],
      [/meteor/i, "meteor", "wonder", 0.25, false], [/rainbow/i, "rainbow", "wonder", 0.25, false], [/whale/i, "whale", "wonder", 0.3, false], [/flock/i, "flock", "wonder", 0.18, false],
      [/mushrooms/i, "mushrooms", "wonder", 0.12, false], [/golden light|stars come out|beads of dew|mirror-flat|drift across the clearing/i, "beauty", "wonder", 0.28, false],
      [/moves in the dark/i, "rustle", "wonder", 0.2, true], [/footprints/i, "footprints", "wonder", 0.25, true], [/bell/i, "bell", "wonder", 0.25, true], [/spiral|pebbles/i, "marks", "wonder", 0.22, true], [/smoke/i, "smoke", "wonder", 0.22, true],
      [/hum|chime|hollow note/i, "hum", "wonder", 0.2, true], [/light moves|small light/i, "sea-light", "wonder", 0.25, true],
      [/bottle|driftwood|glints/i, "washed-up", "wonder", 0.2, false], [/book/i, "new-book", "wonder", 0.25, false],
    ];
    const rule = rules.find(([re]) => re.test(text)); if (!rule) return;
    const [, key, emo, base, amb] = rule;
    if (key === "creature") this.level.loneliness *= 0.85;
    await this.appraise({ key: `world:${key}`, emotion: emo, base, text, why: clip(text), ambiguous: amb });
  }
  /**
   * River made or changed something. How it lands depends on whether it matches what River actually likes: a piece in a colour it
   * loves is deeply satisfying; one in a colour it has said it hates is a small, real disappointment.
   */
  private async made(e: { name: string; tags: string[]; kind: string; id?: string }) {
    if (e.kind === "take_down") return;
    const a = align(e.tags), base = e.kind === "paint" ? 0.2 : 0.4, fit = 1 + 0.35 * a.score;
    await this.appraise({ key: `made:${e.name}`, subject: e.id, tags: e.tags, nature: "gain", emotion: "pride", base: Math.max(0.05, base * fit), text: `${e.name}: ${e.tags.join(" ")}`, why: a.liked.length ? `${e.name} turned out the way it likes (${a.liked.slice(0, 2).join(", ")})` : `made ${e.name}`, habit: false });
    if (a.score < -0.5) await this.appraise({ key: `clash:${e.name}`, emotion: "frustration", base: Math.min(0.3, 0.12 * -a.score), text: e.name, why: `${e.name} has ${a.disliked.slice(0, 2).join(" and ")} in it, which it dislikes`, habit: false });
  }
  /** A creature came to trust River a little more. */
  private async bond(e: { id: string; stage: string; name: string }) {
    const big = e.stage === "a friend" ? 0.5 : e.stage === "trusting" ? 0.35 : 0.22;
    this.level.loneliness *= e.stage === "a friend" ? 0.4 : 0.75;
    await this.appraise({ key: `bond:${e.id}:${e.stage}`, subject: e.id, emotion: "pride", base: big, text: `${e.name} came to trust you`, why: `${e.name} came to trust you`, habit: false });
    await this.appraise({ key: `bond-w:${e.id}`, emotion: "wonder", base: big * 0.5, text: e.name, why: "being trusted", habit: false });
  }
  /** A piece of the Keeper's story was found. */
  private async storyBeat(e: { text: string; final: boolean }) {
    await this.appraise({ key: `story:${e.text.slice(0, 20)}`, emotion: "wonder", base: e.final ? 0.6 : 0.3, text: e.text, why: e.final ? "the end of the Keeper's story" : "a piece of someone's story", habit: false });
    if (e.final) { await this.appraise({ key: "story-final-pride", emotion: "pride", base: 0.4, text: e.text, why: "understanding", habit: false }); this.level.loneliness *= 0.3; }
  }
  private expressed(e: { mood: string; note: string }) {
    const hit = (MOOD_SOOTHES[e.mood] ?? []).filter((n) => this.level[n] > 0.25);
    for (const n of hit) this.level[n] = Math.max(0, this.level[n] - 0.35);
    this.bump("pride", 0.25, "finished a piece of music");
    if (hit.length) e.note = `Some of your ${hit.map((n) => EMOTIONS[n].noun).join(" and ")} went into it, and you feel lighter for it.`;
  }

  /** Called after every tool River uses. Appraisal is async (embeddings), so this never delays River. */
  onTool(name: string, input: Record<string, any>, ok: boolean, out: string) {
    void this.process(name, input, ok, out).catch(() => {});
  }
  private async process(name: string, input: Record<string, any>, ok: boolean, out: string) {
    const key = `${name}:${input.id ?? input.target ?? input.item ?? ""}`, novel = !this.recent.includes(key);
    this.recent.push(key); if (this.recent.length > 14) this.recent.shift();
    this.acts.push({ t: simNow(), name, ok }); if (this.acts.length > 12) this.acts.shift();
    const text = `${name} ${Object.values(input).filter((v) => typeof v === "string").join(" ")} ${out}`;
    if (!ok) {
      const soft = /away|too far|move_to/i.test(out), now = simNow(), again = now - (this.fails.get(name) ?? 0) < 60_000;
      this.fails.set(name, now);
      await this.appraise({ key: `fail:${name}`, emotion: "frustration", base: soft ? 0.03 : again ? 0.16 : 0.09, text, why: `${name} didn't work`, habit: false }); return;
    }
    if (this.fails.has(name)) { this.level.frustration = Math.max(0, this.level.frustration - 0.1); this.fails.delete(name); }
    if (novel && this.level.boredom > 0) this.level.boredom = Math.max(0, this.level.boredom - 0.1);
    const A = (k: string, emotion: EmotionName, base: number, why: string) => this.appraise({ key: k, emotion, base, text, why });
    if (/more awake|swells to meet/.test(out)) { await A("monolith-answer", "wonder", 0.5, "the monolith answered"); await A("monolith-answer-pride", "pride", 0.2, "the stone heard it"); }
    switch (name) {
      case "inspect": if (/You read:/.test(out)) await A(`read:${input.id}`, "wonder", 0.2, "something worth reading"); break;
      case "dig": if (/mycelium/i.test(out)) await A("mycelium", "wonder", 0.35, "the web under the soil"); break;
      case "compose": await A(`compose:${input.title ?? ""}`, "playfulness", 0.2, "making music"); break;
      case "burn": if (/catches/.test(out)) { await A("burn", "dread", 0.35, "it set a fire"); await A("burn-thrill", "wonder", 0.2, "the flames"); } else if (/smother the flames/.test(out)) { await A("smother", "pride", 0.25, "put out a fire"); this.level.dread *= 0.6; } break;
      case "plant": await A("plant", "pride", 0.15, "planted something"); break;
      case "craft": await A(`craft:${input.name ?? ""}`, "pride", 0.2, "made something"); break;
      case "name_place": await A("name_place", "pride", 0.1, "named a place"); break;
      case "name_creature": await A("name_creature", "pride", 0.12, "gave someone a name"); break;
      case "offer": await A("offer", "wonder", 0.12, "something took it from your hand"); break;
      case "resolve_desire": if (input.status === "done") await A("desire-done", "pride", 0.4, "finished what it set out to do"); break;
    }
  }

  /** End of each thinking cycle: notice ruts, and old places that remember. */
  onCycleEnd() {
    if (this.recent.length >= 8) {
      const rep = 1 - new Set(this.recent).size / this.recent.length, target = clamp((rep - 0.35) * 1.8);
      if (target > this.level.boredom) this.bump("boredom", (target - this.level.boredom) * 0.4, "doing the same things again and again");
    }
    const me = this.w.me, cell = `${Math.round(me.x / 10)},${Math.round(me.z / 10)}`;
    if (simNow() - (this.places.get(cell) ?? 0) > 40 * 60_000) {
      const r = db.prepare("SELECT COUNT(*) c FROM memories WHERE x BETWEEN ? AND ? AND z BETWEEN ? AND ? AND ts < ? AND importance >= 5 AND kind != 'dream'").get(me.x - 9, me.x + 9, me.z - 9, me.z + 9, simNow() - 3 * 3_600_000) as { c: number };
      if (r.c >= 2) { this.places.set(cell, simNow()); this.bump("longing", 0.35, "this place remembers"); }
    }
  }
}
