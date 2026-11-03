// River's emotional life. Events don't carry fixed feelings; they are APPRAISED:
//   - relevance: does it touch what River cares about (its desires, interests, named places)? (local embeddings)
//   - habituation: the tenth meteor is not the first; familiar things lose their force, and recover over hours
//   - carry-over: arousal already in the body colours what comes next, and can turn an ambiguous sign from wonder into fear
// Large changes become MOMENTS (see moments.ts): the things the viewer is shown and the day's story is built from.
import { bus, log } from "./bus.ts";
import { db, kvGet, kvSet } from "./db.ts";
import { dot, embed, relevance } from "./embed.ts";
import { activeDesires, interests } from "./mind.ts";
import { listPlaces } from "./places.ts";
import { recordMoment } from "./moments.ts";
import { align } from "./taste.ts";
import type { Moment } from "../shared/types.ts";
import { BITTERSWEET, EMOTIONS, EMOTION_ORDER, intensityWord, type EmotionName } from "../shared/emotions.ts";
import type { World } from "./world.ts";
import { simNow, every, after } from "./sim.ts";
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

interface Ctx { key?: string; relevance?: number; first?: boolean; at?: { x: number; z: number }; title?: string }

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
  private cand: Omit<Moment, "id" | "ts"> | null = null; private candTimer: number | null = null; private lastMomentAt = 0;
  private lastSave = 0; private lastCalm = simNow(); private prevDread = 0;

  constructor(private w: World) {
    const s = kvGet<{ level?: Partial<Record<EmotionName, number>>; why?: Partial<Record<EmotionName, string>> } | null>("emotions", null);
    if (s?.level) Object.assign(this.level, s.level); if (s?.why) this.why = s.why;
    this.habit = kvGet("habit", {});
    bus.on("perceived", (e: { text: string }) => void this.perceived(e.text).catch(() => {}));
    bus.on("loss", (e: { name: string; kind: string; x: number; z: number; named?: boolean; trust?: number }) => void this.loss(e).catch(() => {}));
    bus.on("expressed", (e: { mood: string; note: string }) => this.expressed(e));
    bus.on("made", (e: { name: string; tags: string[]; kind: string }) => void this.made(e).catch(() => {}));
    bus.on("discovered-colour", () => void this.appraise({ key: "colour-mix", emotion: "wonder", base: 0.15, text: "a new colour", why: "a colour that wasn't there before" }).catch(() => {}));
    bus.on("bond", (e: { id: string; stage: string; name: string }) => void this.bond(e).catch(() => {}));
    bus.on("story", (e: { text: string; final: boolean }) => void this.storyBeat(e).catch(() => {}));
  }

  start() { every(1000, () => this.tick(1), "emotions"); }
  reset() { for (const n of EMOTION_ORDER) this.level[n] = 0; this.why = {}; this.edge = {}; this.momentAt = {}; this.habit = {}; this.recent = []; this.acts = []; this.fails.clear(); this.places.clear(); this.concerns = []; this.concernsKey = ""; kvSet("emotions", { level: this.level, why: this.why }); kvSet("habit", {}); }

  // ---------- core ----------
  bump(n: EmotionName, amt: number, why = "", c: Ctx = {}) {
    const prev = this.level[n]; this.level[n] = clamp(prev + amt); const delta = this.level[n] - prev;
    if (amt > 0 && why) this.why[n] = why;
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
    this.candTimer ??= after(1500, () => {
      const best = this.cand!; this.cand = null; this.candTimer = null;
      if (simNow() - this.lastMomentAt < 20_000 && best.intensity < 0.85) { log("feeling", best.title, { intensity: best.intensity }); return; }   // too soon after the last: note it quietly
      this.lastMomentAt = simNow(); recordMoment(best);
    });
  }
  /** Raise to at least `v` (for continuous conditions like standing near a fire). */
  private floor(n: EmotionName, v: number, why: string) { if (this.level[n] < v) this.bump(n, v - this.level[n], why); }

  tick(dt: number) {
    const w = this.w, me = w.me;
    for (const n of EMOTION_ORDER) {
      const half = EMOTIONS[n].half; if (Number.isFinite(half)) this.level[n] *= Math.pow(0.5, dt / half);
      if (this.level[n] < 0.01) this.level[n] = 0;
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
    if (simNow() - this.lastSave > 15_000) { this.lastSave = simNow(); kvSet("emotions", { level: this.level, why: this.why }); kvSet("habit", this.habit); }
  }

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
  /** What River currently cares about, as vectors. Refreshed at most every 30s, only re-embedded when it changes. */
  private async refreshConcerns() {
    if (simNow() - this.concernsAt < 30_000) return; this.concernsAt = simNow();
    const texts = [...activeDesires().slice(0, 8).map((d) => d.text), ...interests().slice(0, 6).map((i) => i.topic), ...listPlaces().map((p) => `${p.name} ${p.note}`.trim())].map((t) => t.slice(0, 200));
    const key = texts.join("|"); if (key === this.concernsKey) return; this.concernsKey = key;
    const vs = texts.length ? await embed(texts, "document") : []; this.concerns = vs ? texts.map((t, i) => ({ text: t, v: vs[i] })) : [];
  }
  /** 0..1: how much does this text bear on what River cares about? Unknown (no embeddings, nothing cared about yet) is neutral-ish. */
  private async relevanceOf(text: string): Promise<{ r: number; top?: string } | null> {
    // The embedding service is an outside input. Live, its answer is journaled when it arrives; in replay it is waited for and supplied.
    const id = ++this.relId;
    if (isReplaying()) return new Promise((res) => this.relWaiting.set(id, res));
    const gen = lifeGen(), v = await this.relevanceLive(text);
    if (isStale(gen)) { discarded("appraisal"); return null; }          // the life it was about has ended
    finishCommand(recordCommand("external", "relevance", { id, ...v }), "ok", "");
    return v;
  }
  private relId = 0;
  private relWaiting = new Map<number, (v: { r: number; top?: string }) => void>();
  /** Replay: deliver a recorded relevance result to the appraisal that is waiting for it. */
  resolveRelevance(p: { id: number; r: number; top?: string }) { this.relWaiting.get(p.id)?.({ r: p.r, top: p.top }); this.relWaiting.delete(p.id); }
  private async relevanceLive(text: string): Promise<{ r: number; top?: string }> {
    await this.refreshConcerns(); if (!this.concerns.length) return { r: 0.35 };
    const q = await embed([text.slice(0, 300)], "query"); if (!q) return { r: 0.35 };
    let best = 0, top: string | undefined;
    for (const c of this.concerns) { const r = relevance(dot(q[0], c.v)); if (r > best) { best = r; top = c.text; } }
    return { r: best, top };
  }
  private habituate(key: string): { f: number; first: boolean } {
    const now = simNow(), h = this.habit[key], eff = h ? h.n * Math.pow(0.5, (now - h.t) / HALF_LIFE_HABIT_MS) : 0;
    this.habit[key] = { n: eff + 1, t: now };
    return { f: 1 / (1 + 0.7 * eff), first: !h };
  }

  /**
   * Turn an event into a feeling. `base` is how strongly an unremarkable, first-time event of this kind would land.
   * `ambiguous` events (a sound, a footprint) become fear when River is already afraid or keyed up, wonder otherwise.
   */
  async appraise(o: { key: string; emotion: EmotionName; base: number; text: string; why: string; ambiguous?: boolean; habit?: boolean; at?: { x: number; z: number } }) {
    let emotion = o.emotion, base = o.base, why = o.why, title = o.why;
    if (o.ambiguous && (this.level.dread > 0.25 || this.arousal() > 0.55)) { emotion = "dread"; base = 0.15 + 0.3 * this.arousal(); why = `${o.why}, and in the state you were in it felt like a threat`; title = `${o.why}, and it felt like a threat`; }
    const hab = o.habit === false ? { f: 1, first: false } : this.habituate(o.key);
    const rel = await this.relevanceOf(o.text);
    if (!rel) return;                                   // stale: the life this was about has ended
    const carry = 1 + 0.5 * this.arousal();
    let amt = Math.min(base * hab.f * (0.7 + 0.8 * rel.r) * carry * (hab.first ? 1.4 : 1), base * 2.5, 0.9);
    if (rel.r > 0.6 && rel.top && amt > 0.1) why += ` (it touches on “${clip(rel.top, 40)}”)`;
    if (amt >= 0.02) this.bump(emotion, amt, why, { key: o.key, relevance: rel.r, first: hab.first && base >= 0.15, at: o.at, title });
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
  private async loss(e: { name: string; kind: string; x: number; z: number; named?: boolean; trust?: number }) {
    const d = Math.hypot(e.x - this.w.me.x, e.z - this.w.me.z), near = d < 30 ? 1 : 0.4;
    if (e.kind === "creature") {      // somebody, not something: grief follows who they were to River
      const base = 0.25 + (e.named ? 0.3 : 0) + 0.45 * (e.trust ?? 0);
      this.level.loneliness = clamp(this.level.loneliness + 0.15 * (e.trust ?? 0));
      return void (await this.appraise({ key: `loss:creature:${e.name}`, emotion: "grief", base: base * near, text: `${e.name} died`, why: `${e.name} is gone`, at: { x: e.x, z: e.z }, habit: false }));
    }
    const base = e.kind === "book" ? 0.4 : e.kind === "structure" ? 0.45 : e.kind === "tree" ? 0.2 : 0.1;
    await this.appraise({ key: `loss:${e.kind}`, emotion: "grief", base: base * near, text: `${e.name} burnt away`, why: `${e.kind === "tree" ? `the ${e.name}` : `the ${e.name}`} burnt away`, at: { x: e.x, z: e.z } });
  }
  /**
   * River made or changed something. How it lands depends on whether it matches what River actually likes: a piece in a colour it
   * loves is deeply satisfying; one in a colour it has said it hates is a small, real disappointment.
   */
  private async made(e: { name: string; tags: string[]; kind: string }) {
    if (e.kind === "take_down") return;
    const a = align(e.tags), base = e.kind === "paint" ? 0.2 : 0.4, fit = 1 + 0.35 * a.score;
    await this.appraise({ key: `made:${e.name}`, emotion: "pride", base: Math.max(0.05, base * fit), text: `${e.name}: ${e.tags.join(" ")}`, why: a.liked.length ? `${e.name} turned out the way it likes (${a.liked.slice(0, 2).join(", ")})` : `made ${e.name}`, habit: false });
    if (a.score < -0.5) await this.appraise({ key: `clash:${e.name}`, emotion: "frustration", base: Math.min(0.3, 0.12 * -a.score), text: e.name, why: `${e.name} has ${a.disliked.slice(0, 2).join(" and ")} in it, which it dislikes`, habit: false });
  }
  /** A creature came to trust River a little more. */
  private async bond(e: { id: string; stage: string; name: string }) {
    const big = e.stage === "a friend" ? 0.5 : e.stage === "trusting" ? 0.35 : 0.22;
    this.level.loneliness *= e.stage === "a friend" ? 0.4 : 0.75;
    await this.appraise({ key: `bond:${e.id}:${e.stage}`, emotion: "pride", base: big, text: `${e.name} came to trust you`, why: `${e.name} came to trust you`, habit: false });
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
