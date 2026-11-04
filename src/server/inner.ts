// River's inner life beyond the feelings themselves: what it has actually observed, what it has come to care about, and what it believes.
//  - Perception: an event is not an observation. Something that happens out of River's sight and hearing stays unknown, and so cannot
//    be grieved, until River comes upon it (or is told). When it does, the appraisal runs then, with the belief it contradicts.
//  - Links: familiarity, trust, attachment and fear toward creatures, items, places and structures, grown only from what River does.
//  - Beliefs: claims with the observations that support or contradict them, revised only by explicit observation.
// Everything here is plain data committed with the clock and replayed from the journal, so it can be inspected and reproduced.
import { bus } from "./bus.ts";
import { db } from "./db.ts";
import { persisted } from "./persist.ts";
import { every, simNow, simTick, STEP_MS } from "./sim.ts";
import type { World } from "./world.ts";
import type { Emotions, Minds } from "./emotions.ts";
import { sense, type Modality, type Observation, type Observer, type Signature } from "../mind/perception.ts";
import { grow, lossWeight, newLink, type Evidence, type Link, type LinkKind } from "../mind/links.ts";
import { assertBelief, reviseBelief, type Belief } from "../mind/beliefs.ts";

export interface Subject { id: string; kind: string; name: string; named?: boolean; /** how much such a thing is worth to anyone */ worth?: number; trust?: number }
export interface WorldEvent { id: string; cls: "loss" | "restored" | "found"; subject: Subject; sig: Signature; responsibility?: number }

const REPORTED_KEEP = 300, UNSEEN_KEEP = 40, OBS_KEEP = 40;
/** what a lost thing of this kind is worth to anyone, before it means anything to River in particular */
const KIND_WORTH: Record<string, number> = { book: 0.4, structure: 0.45, tree: 0.2 };
/** how far the sound of its ending carries, in metres */
const LOUD: Record<string, number> = { tree: 25, structure: 30, creature: 25 };

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const LINK_KINDS: Record<string, LinkKind> = { creature: "creature", item: "item", structure: "structure", place: "place", human: "human" };

export class InnerLife implements Minds {
  private links = new Map<string, Link>();
  private beliefs = new Map<string, Belief>();
  private unseen = new Map<string, { ev: WorldEvent; tick: number }>();
  private reported: string[] = [];
  private obs: Observation[] = [];

  constructor(private w: World, private emo: Emotions) {
    emo.minds = this; w.attention = (id) => this.attention(id);
    const s = persisted("inner", () => this.state());
    if (s) {
      this.links = new Map(s.links); this.beliefs = new Map(s.beliefs); this.unseen = new Map(s.unseen); this.reported = s.reported; this.obs = s.obs;
    }
    bus.on("loss", (e: { id?: string; name: string; kind: string; x: number; z: number; named?: boolean; trust?: number; responsibility?: number }) => this.reportLoss(e));
    bus.on("restored", (e: { id: string; name: string; kind: string }) => this.restored(e));
    bus.on("attach", (e: { id: string; kind: string; name: string; evidence: Evidence }) => this.attach(e.id, e.kind, e.name, e.evidence));
    bus.on("placed", (e: { id: string; name: string; x: number; z: number }) => this.expect(e.id, e.name, e.x, e.z));
    bus.on("made", (e: { id?: string; name: string; kind: string }) => { if (e.id && e.kind === "build") { this.attach(e.id, "structure", e.name, "made"); const en = this.w.entities.get(e.id); if (en) this.expect(e.id, e.name, en.x, en.z); } });
    bus.on("bond", (e: { id: string; stage: string; name: string }) => this.attach(e.id, "creature", e.name, "cared"));
  }

  start() { every(STEP_MS * 10, () => this.tick(), "inner"); }
  state() { return { links: [...this.links], beliefs: [...this.beliefs], unseen: [...this.unseen], reported: this.reported, obs: this.obs }; }
  reset() { this.links.clear(); this.beliefs.clear(); this.unseen.clear(); this.reported = []; this.obs = []; }

  // ---------- what River is to things ----------
  link(id: string): Link | undefined { return this.links.get(id); }
  belief(id: string): Belief | undefined { return this.beliefs.get(id); }
  /** Something happened between River and a subject (it made it, named it, used it, cared for it, shared time with it). */
  attach(id: string, kind: string, name: string, ev: Evidence) {
    const k = LINK_KINDS[kind] ?? "item"; let l = this.links.get(id);
    if (!l) { l = newLink(id, k, name, simNow()); this.links.set(id, l); }
    l.name = name;
    const before = l.attachment;
    if (grow(l, ev, simNow()) && l.attachment !== before) this.note("link", id, `${ev}: attachment ${before.toFixed(2)} → ${l.attachment.toFixed(2)}`, { evidence: ev, attachment: l.attachment, familiarity: l.familiarity });
  }
  /** How strongly this subject draws attention: loved things and things that surprised River stand out. */
  attention(id: string): number { const l = this.links.get(id), b = this.beliefs.get(`at:${id}`); return +(1 + 1.5 * (l?.attachment ?? 0) + (b && b.contradict.length ? 0.5 : 0)).toFixed(2); }

  // ---------- what River believes ----------
  /** River put or built something here, and expects to find it. */
  expect(id: string, name: string, x: number, z: number) {
    const bid = `at:${id}`, o = `placed:${id}@${simTick()}`;
    this.beliefs.set(bid, { ...assertBelief(undefined, { id: bid, proposition: `${name} is at (${Math.round(x)}, ${Math.round(z)})`, subjects: [id], kind: "fact", confidence: 1, obs: o, now: simNow() }) });
  }

  // ---------- perception ----------
  private observer(): Observer {
    const me = this.w.me;
    return { x: me.x, z: me.z, asleep: !!me.sleeping, sightRadius: this.w.sightRadius(), hearing: this.w.weather === "storm" ? 0.5 : this.w.weather === "rain" ? 0.75 : 1 };
  }
  private reportLoss(e: { id?: string; name: string; kind: string; x: number; z: number; named?: boolean; trust?: number; responsibility?: number }) {
    const id = e.id ?? `${e.kind}:${e.name}:${Math.round(e.x)},${Math.round(e.z)}`;
    this.report({ id: `loss:${id}`, cls: "loss", subject: { id, kind: e.kind, name: e.name, named: e.named, trust: e.trust, worth: KIND_WORTH[e.kind] ?? 0.1 }, sig: { at: { x: e.x, z: e.z }, loudness: LOUD[e.kind] ?? 0, visible: true }, responsibility: e.responsibility });
  }
  /** An event happened in the world. River observes it only if it is in range, in light, awake, or loud; otherwise it waits to be discovered. */
  report(ev: WorldEvent) {
    if (this.reported.includes(ev.id)) return;              // the same event is never taken in twice
    this.reported.push(ev.id); if (this.reported.length > REPORTED_KEEP) this.reported.shift();
    const s = sense(ev.sig, this.observer());
    if (!s) { this.keepUnseen(ev); this.note("unseen", ev.subject.id, `${ev.subject.name}: ${ev.cls} out of sight and hearing`, { event: ev.id }); return; }
    if (s.modality === "hearing") {          // something was heard, but not what: unease, and the subject stays unknown until it is seen
      this.keepUnseen(ev);
      this.emo.appraiseNow({ key: `heard:${ev.subject.kind}`, eventId: `${ev.id}#heard`, emotion: "wonder", base: 0.12, text: `a ${ev.subject.kind} sound in the distance`, why: "a sound from somewhere out of sight", ambiguous: true, at: ev.sig.at });
      return;
    }
    this.observed(ev, s.modality, s.confidence, false);
  }
  private keepUnseen(ev: WorldEvent) {
    this.unseen.set(ev.subject.id, { ev, tick: simTick() });
    if (this.unseen.size > UNSEEN_KEEP) this.unseen.delete(this.unseen.keys().next().value!);
  }
  /** Something River did not know about becomes known (it came upon the place, or was told). */
  discover(id: string, modality: Modality = "sight", confidence = 0.85) {
    const u = this.unseen.get(id); if (!u) return;
    this.unseen.delete(id);
    this.observed(u.ev, modality, confidence, true);
  }

  private observed(ev: WorldEvent, modality: Modality, confidence: number, late: boolean) {
    const sub = ev.subject, o: Observation = { id: ev.id, subject: sub.id, modality, confidence, tick: simTick(), fact: `${sub.name}: ${ev.cls}`, late };
    this.obs.push(o); if (this.obs.length > OBS_KEEP) this.obs.shift();
    this.note("observation", sub.id, `${o.fact} (${modality}${late ? ", found out later" : ""})`, { event: ev.id, modality, confidence, late });
    if (ev.cls === "loss") return this.lost(ev, o);
    if (ev.cls === "found") return this.found(ev, o);
  }
  private lost(ev: WorldEvent, o: Observation) {
    const sub = ev.subject, l = this.links.get(sub.id), att = lossWeight(l);
    // what River expected to find, and finding otherwise
    const at = this.beliefs.get(`at:${sub.id}`), expectation = at ? at.confidence : 0;
    if (at) this.beliefs.set(at.id, reviseBelief(at, ev.id, false, o.confidence, simNow()));
    const gone = `gone:${sub.id}`;
    this.beliefs.set(gone, assertBelief(this.beliefs.get(gone), { id: gone, proposition: `${sub.name} is gone`, subjects: [sub.id], kind: o.modality === "sight" || o.modality === "contact" ? "fact" : "hypothesis", confidence: o.confidence, obs: ev.id, now: simNow() }));
    if (l) { l.last = simNow(); l.evidence.push({ type: "lost", at: simNow() }); if (l.evidence.length > 8) l.evidence.shift(); }
    const person = sub.kind === "creature";                         // somebody, not something
    const generic = person ? 0.25 + (sub.named ? 0.3 : 0) + 0.45 * (sub.trust ?? 0) : sub.worth ?? 0.1;
    const base = generic + 0.5 * att;                               // what it was worth to anyone, and what it was to River
    if (person) this.emo.bump("loneliness", 0.15 * Math.max(att, sub.trust ?? 0), `${sub.name} is gone`, { trace: { eventId: ev.id } });
    const at2 = ev.sig.at;
    this.emo.appraiseNow({
      key: `loss:${sub.kind}:${sub.id}`, eventId: ev.id, subject: sub.id, emotion: "grief", nature: "loss", base, habit: person || att > 0 ? false : undefined,
      text: `${sub.name} ${person ? "died" : "burnt away"}`, why: late(o) ? `${sub.name} turned out to be gone` : person ? `${sub.name} is gone` : `${sub.kind === "tree" ? "the " : ""}${sub.name} burnt away`, at: at2,
      factors: { attachment: att, expectationError: expectation, responsibility: ev.responsibility ?? 0, controllability: ev.responsibility ? 0.8 : 0.2 },
    });
  }
  private found(ev: WorldEvent, o: Observation) {
    const sub = ev.subject, l = this.links.get(sub.id), att = lossWeight(l), g = this.beliefs.get(`gone:${sub.id}`);
    if (g) this.beliefs.set(g.id, reviseBelief(g, ev.id, false, o.confidence, simNow()));
    this.attach(sub.id, sub.kind, sub.name, "found");
    const had = this.emo.level.grief > 0.05 && !!g;
    if (had) this.emo.ease("grief", 0.2 + 0.4 * att, `${sub.name} was not lost after all`, ev.id);
    this.emo.appraiseNow({ key: `found:${sub.id}`, eventId: ev.id, subject: sub.id, emotion: "wonder", nature: "gain", base: 0.15 + 0.3 * att, text: `${sub.name} found again`, why: `${sub.name} was here after all`, habit: false, factors: { expectationError: g ? g.confidence : 0 } });
  }
  /** River mended something. Its attachment grows; any grief for it eases, and a mended thing is never quite the old one, so some remains. */
  private restored(e: { id: string; name: string; kind: string }) {
    const prev = this.links.get(e.id), att0 = lossWeight(prev);
    this.attach(e.id, e.kind, e.name, "repaired");
    const att = lossWeight(this.links.get(e.id)), id = `restored:${e.id}@${simTick()}`;
    if (this.emo.level.grief > 0.05 && att0 > 0) { this.emo.ease("grief", 0.1 + 0.3 * att, `${e.name} is mended`, id); this.emo.bump("longing", 0.08 * att, `${e.name} is mended, but not as it was`, { trace: { eventId: id } }); }
    this.emo.appraiseNow({ key: `restored:${e.id}`, eventId: id, subject: e.id, emotion: "pride", nature: "gain", base: 0.12 + 0.3 * att, text: `mended ${e.name}`, why: `mended ${e.name}`, habit: false, factors: { responsibility: 1, controllability: 1 } });
    this.expect(e.id, e.name, this.w.entities.get(e.id)?.x ?? this.w.me.x, this.w.entities.get(e.id)?.z ?? this.w.me.z);
  }

  /** Once a second-ish: come upon what was out of sight; spend time with what is near. */
  tick() {
    const ob = this.observer();
    for (const [id, u] of [...this.unseen]) {
      const s = u.ev.sig.at ? sense({ at: u.ev.sig.at, visible: true }, ob) : null;
      if (s) this.discover(id, "sight", s.confidence);
    }
    for (const { e } of this.w.nearby(8)) if (e.kind === "animal" && e.props.creature) this.attach(String(e.props.creature), "creature", String(e.props.cname ?? e.name), "shared");
    for (const i of this.w.items.equipped()) this.attach(i.id, "item", i.name, "shared");
  }

  // ---------- inspection ----------
  private note(kind: string, subject: string, why: string, data: object) {
    db.prepare("INSERT INTO mind_trace(tick, kind, subject, event_id, why, data) VALUES(?,?,?,?,?,?)").run(simTick(), kind, subject, (data as any).event ?? null, why, JSON.stringify(data));
  }
  view() {
    return {
      relationships: [...this.links.values()].sort((a, b) => b.attachment - a.attachment || (a.id < b.id ? -1 : 1)),
      beliefs: [...this.beliefs.values()].sort((a, b) => b.revised - a.revised),
      unseen: [...this.unseen.values()].map((u) => ({ subject: u.ev.subject.name, id: u.ev.subject.id, class: u.ev.cls, since: u.tick })),
      observations: [...this.obs].reverse(),
      feelings: this.emo.traces(40),
    };
  }
}
const late = (o: Observation) => o.late;
