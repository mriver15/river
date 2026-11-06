// Visitors: now and then someone comes ashore, stays a while, and goes. River can speak to them and trade with them. They are stimuli, never instructions:
// they have their own wants and goods, they do not explain the island or set River goals, and River may ignore them entirely.
// Their bodies and trades are scripted and deterministic. Their words can be given a voice by a small, capped model call, made *before* the action so the answer
// is journaled with it and replays exactly; with no model (or no budget) they speak from their own authored lines, so a visit never costs more than River's own turns.
import { bus, log } from "./bus.ts";
import { cfg } from "./config.ts";
import { chat } from "./llm.ts";
import { decisionModel } from "./provider.ts";
import { MOCK } from "./agent.ts";
import { simNow, simRng, every, DAY_MS } from "./sim.ts";
import { persisted } from "./persist.ts";
import { bodyApi } from "./body.ts";
import { ARCHETYPES, archetypeById, type Archetype } from "../content/visitors.ts";
import { defForKind, defById } from "../content/items.ts";
import { isLand } from "../shared/noise.ts";
import { ToolError, obj, str, num, type ToolDef } from "./toolkit.ts";
import type { World } from "./world.ts";
import type { Entity } from "../shared/types.ts";

const sr = simRng("visitors");
const rand = (a: number, b: number) => a + sr() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(sr() * xs.length)]!;
export const REACH_TALK = 6, VOICE_PER_VISIT = 6;

interface Here { id: string; arch: string; name: string; leaveAt: number; leaving: boolean; spoke: boolean; voiced: number; said: string[] }
interface Rec { met: number; trades: number; talked: number; trust: number; last: number }
interface State { next: number; here: Here | null; ledger: Record<string, Rec>; voiceDay: number; voiceUsed: number; lastArch: string }

export class Visitors {
  st: State = { next: 0, here: null, ledger: {}, voiceDay: 0, voiceUsed: 0, lastArch: "" };

  constructor(private w: World, private say: (text: string, at?: { x: number; z: number }, r?: number) => boolean) {
    const saved = persisted("visitors", () => this.st);
    if (saved) this.st = { ...this.st, ...saved };
    else this.st.next = simNow() + this.gap();
    if (this.st.here && !w.entities.has(this.st.here.id)) this.st.here = null;                // the world it was in is gone
  }

  private gap() { const d = cfg("visitorDays"); return d > 0 ? rand(0.6, 1.4) * d * DAY_MS : Infinity; }
  start() { every(1000, () => this.tick(), "visitors"); }
  /** A new life meets no one it has met before; whoever is here stays where they are. */
  reset() { this.st.ledger = {}; this.st.next = simNow() + this.gap(); if (this.st.here) { this.st.here.spoke = false; this.st.here.voiced = 0; this.st.here.said = []; } }

  get here(): Entity | null { const h = this.st.here; return h ? this.w.entities.get(h.id) ?? null : null; }
  arch(): Archetype | undefined { return this.st.here ? archetypeById(this.st.here.arch) : undefined; }
  rec(name: string): Rec { return (this.st.ledger[name] ??= { met: 0, trades: 0, talked: 0, trust: 0, last: 0 }); }

  // ---------- coming and going ----------
  private tick() {
    const now = simNow(), w = this.w, h = this.st.here;
    if (!h) { if (now >= this.st.next && cfg("visitorDays") > 0 && !this.dead() && !this.night()) this.arrive(now); return; }
    const e = this.here; if (!e) { this.st.here = null; return; }
    const a = archetypeById(h.arch)!;
    if (!h.leaving && now >= h.leaveAt) {
      h.leaving = true;
      const line = pick(a.lines.farewell); if (w.dist(e) < 25) this.say(`${e.props.who} says, to no one in particular: ${line}`, e, 25);
    }
    // walk: toward River until a few paces off, or away from the island's middle when leaving
    const me = w.me, d = w.dist(e), speed = h.leaving ? 1.6 : 1.2;
    let tx = me.x, tz = me.z, go = d > 6;
    if (h.leaving) { const ang = Math.atan2(e.z, e.x); tx = e.x + Math.cos(ang) * 10; tz = e.z + Math.sin(ang) * 10; go = true; }
    if (go) {
      const a2 = Math.atan2(tz - e.z, tx - e.x), nx = e.x + Math.cos(a2) * speed, nz = e.z + Math.sin(a2) * speed;
      if (isLand(nx, nz, w.seed)) { e.x = nx; e.z = nz; e.props.heading = a2; w.putEntity(e); }
      else if (h.leaving) { this.depart(e); return; }
    } else { e.props.heading = Math.atan2(me.z - e.z, me.x - e.x); w.putEntity(e); }
    if (h.leaving && w.dist(e) > 90) this.depart(e);
  }
  private depart(e: Entity) { this.w.removeEntity(e.id); this.st.here = null; this.st.next = simNow() + this.gap(); log("world", `${e.props.who} has gone.`, { perceived: false }); }
  private dead() { return bodyApi.isDead(); }
  private night() { const t = this.w.worldTime(); return t < 0.25 || t > 0.78; }

  private arrive(now: number) {
    const w = this.w, pool = ARCHETYPES.filter((a) => a.id !== this.st.lastArch), a = pick(pool.length ? pool : ARCHETYPES), who = pick(a.names);
    for (let i = 0; i < 80; i++) {
      const ang = rand(0, Math.PI * 2), r = rand(38, 62), x = w.me.x + Math.cos(ang) * r, z = w.me.z + Math.sin(ang) * r;
      if (!isLand(x, z, w.seed)) continue;
      const e = w.spawn("person", `${who}, a ${a.title}`, x, z, { visitor: a.id, who, desc: a.appearance, hue: a.hue, heading: ang + Math.PI });
      this.st.here = { id: e.id, arch: a.id, name: who, leaveAt: now + rand(...a.stay) * 60_000, leaving: false, spoke: false, voiced: 0, said: [] };
      this.st.lastArch = a.id;
      this.say(`Someone is coming up from the shore to the ${w.compass(e)}. ${a.appearance}`, e, 90);
      return;
    }
    this.st.next = now + 30 * 60_000;
  }

  // ---------- meeting ----------
  /** The visitor River means: by id or by name, near enough to speak to. */
  target(ref: string): Entity {
    const e = this.here, h = this.st.here;
    if (!e || !h) throw new ToolError("There is no one here to speak to.");
    const r = String(ref).trim().toLowerCase();
    if (r && r !== e.id.toLowerCase() && !e.name.toLowerCase().includes(r) && !h.name.toLowerCase().includes(r) && !["them", "visitor", "stranger", "person"].includes(r)) throw new ToolError(`You don't see anyone like "${ref}". ${e.name} is ${this.w.dist(e).toFixed(0)}m away.`);
    if (this.w.dist(e) > REACH_TALK) throw new ToolError(`${e.name} is ${this.w.dist(e).toFixed(0)}m away. Move closer to speak.`);
    return e;
  }

  private warm(rec: Rec, a: Archetype, ev: "met" | "shared") {
    rec.trust = Math.min(1, rec.trust + (ev === "met" ? 0.04 : 0.1) * (0.5 + a.warmth));
    bus.emit("attach", { id: `visitor:${this.st.here!.name}`, kind: "human", name: this.st.here!.name, evidence: ev });
  }

  /** What they say back with no model: chosen by what kind of thing River said, and by whether they have met before. */
  scripted(a: Archetype, rec: Rec, text: string): string {
    const h = this.st.here!, t = text.trim();
    if (t.length < 2) return pick(a.lines.short);
    if (!h.spoke) return rec.met > 0 ? pick(a.lines.remember) : pick(a.lines.greet);
    if (/\?|^(who|where|what|why|how|are you|do you|did you)\b/i.test(t)) return pick(a.lines.ask);
    return pick(a.lines.talk);
  }

  /** Called before the action begins: asks a model for their line, if there is room. Never throws; the answer, if any, is journaled with the command. */
  async voice(text: string): Promise<{ line: string } | undefined> {
    const h = this.st.here, a = this.arch(); if (!h || !a || MOCK) return undefined;
    const cap = cfg("visitorVoice"); if (cap <= 0 || h.voiced >= VOICE_PER_VISIT) return undefined;
    const day = this.w.day(); if (this.st.voiceDay === day && this.st.voiceUsed >= cap) return undefined;
    const rec = this.rec(h.name);
    try {
      const r = await chat({
        consumer: "visitor", reason: a.id, maxTokens: 110, temperature: 0.9, model: decisionModel(["idle"]),
        messages: [
          { role: "system", content: `You are ${h.name}, ${a.persona}\nYou have come ashore on a small island where a being called ${this.w.me.name} lives. Reply in one or two short sentences, in character, with no stage directions. Never tell ${this.w.me.name} what to do or what to look for, never explain the island, and never mention being an AI or a game. You know only what a visitor would. ${rec.met > 0 ? `You have met before (${rec.met} time${rec.met === 1 ? "" : "s"}${rec.trades ? `, and traded ${rec.trades}` : ""}).` : "You have not met before."}` },
          ...(h.said.length ? [{ role: "assistant" as const, content: h.said.slice(-3).join(" ") }] : []),
          { role: "user", content: `${this.w.me.name} says: "${text.slice(0, 300)}"` },
        ],
      });
      const line = r.text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, 260);
      return line ? { line: `"${line}"` } : undefined;
    } catch { return undefined; }
  }

  /** The conversation itself: deterministic given what the model returned (or that it returned nothing). */
  speak(ref: string, text: string, ext?: { line?: string }): string {
    const e = this.target(ref), h = this.st.here!, a = archetypeById(h.arch)!, rec = this.rec(h.name);
    const first = !h.spoke, line = ext?.line ?? this.scripted(a, rec, text);
    if (ext?.line) { h.voiced++; const day = this.w.day(); if (this.st.voiceDay !== day) { this.st.voiceDay = day; this.st.voiceUsed = 0; } this.st.voiceUsed++; }
    h.said = [...h.said, line].slice(-4);
    if (first) { rec.met++; this.warm(rec, a, "met"); }
    h.spoke = true; rec.talked++; rec.last = simNow();
    return `${e.props.who} answers: ${line}`;
  }

  /** What River could have, and what they want for it. */
  describeOffers(): string {
    const a = this.arch(), h = this.st.here; if (!a || !h) return "";
    const t = this.rec(h.name).trust;
    return `${h.name} has: ${a.offers.map((o) => `${o.qty} × ${o.name} (${this.price(o, t)} worth)`).join("; ")}. ${h.name} would value: ${Object.entries(a.wants).map(([d, v]) => `${defById(d).name} (${v})`).join(", ")}.`;
  }
  private price(o: { cost: number }, trust: number) { return Math.max(1, Math.round(o.cost * (1 - 0.25 * trust))); }

  trade(ref: string, give: string, want: string, qty = 1): string {
    const e = this.target(ref), h = this.st.here!, a = archetypeById(h.arch)!, rec = this.rec(h.name);
    const it = this.w.findItem(give); if (!it) throw new ToolError("You don't have that.");
    const q = Math.max(1, Math.min(Math.floor(qty), it.qty)), unit = a.wants[defForKind(it.kind).id] ?? 0;
    const o = a.offers.find((x) => x.def === want.toLowerCase() || x.name.toLowerCase().includes(want.toLowerCase()) || defById(x.def).aliases.includes(want.toLowerCase()));
    if (!o) throw new ToolError(`${h.name} has nothing like "${want}". ${this.describeOffers()}`);
    if (!unit) return `${e.props.who} turns the ${it.name} over and hands it back. ${pick(a.lines.trade_no)}`;
    const value = unit * q, price = this.price(o, rec.trust);
    if (value < price) return `${e.props.who} weighs it, shaking their head: ${q} ${it.name} is worth about ${value} to them; the ${o.name} is ${price}. ${pick(a.lines.trade_no)}`;
    this.w.takeItem(it.id, q);
    this.w.addItem(o.def, o.name, defById(o.def).desc ?? "", o.qty, undefined, { sources: [e.id] });
    rec.trades++; rec.last = simNow(); h.spoke = true; this.warm(rec, a, "shared");
    bus.emit("deed", { kind: "trade", name: o.name, qty: o.qty });
    return `${e.props.who} takes ${q} ${it.name} and gives you ${o.qty} ${o.name}. ${pick(a.lines.trade_yes)}`;
  }
}

const visitors = (w: World) => (w as any).visitors as Visitors;

export const SPEAK_TO_TOOL: ToolDef = {
  name: "speak_to",
  description: "Say something to a person who is near you (within a few paces), and hear what they answer. Use their name or id. People who come ashore have their own business and their own way of talking.",
  input_schema: obj({ target: str("Their name or id, or 'them' for whoever is nearest"), text: str("What you say to them") }, ["target", "text"]),
  external: async (a, w) => { try { visitors(w).target(String(a.target)); } catch { return undefined; } return visitors(w).voice(String(a.text ?? "")); },
  run: (a, w, ext) => visitors(w).speak(String(a.target), String(a.text ?? ""), ext as { line?: string } | undefined),
};

export const TRADE_TOOL: ToolDef = {
  name: "trade",
  description: "Trade with a person near you: give something from your inventory for something they have. Say `want: list` to hear what they have and what they would value. They value what they value, and not everything is worth the same to everyone.",
  input_schema: obj({ target: str("Their name or id, or 'them'"), give: str("Inventory item id or name to give (ignored for `list`)"), want: str("What you want from them, by name, or 'list'"), quantity: num("How many of what you give (default 1)") }, ["target", "want"]),
  run: (a, w) => {
    const v = visitors(w);
    if (String(a.want).toLowerCase() === "list") { v.target(String(a.target)); return v.describeOffers(); }
    if (!a.give) throw new ToolError("Say what you give.");
    return v.trade(String(a.target), String(a.give), String(a.want), a.quantity === undefined ? 1 : Number(a.quantity));
  },
};
