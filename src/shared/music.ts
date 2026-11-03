// Music notation, compilation and analysis. Shared by the server (River's `compose` tool) and the client (playback).
//
// A piece is a few voices, each a line of notation:
//   D4 F4 A4:2 _ [D3 F3 A3]:4     notes (octave 1-7, #/b), ":n" = n beats (0.25..16, default 1), "_" rest, [..] chord
//   (D4 E4 F4 E4)x2               repeat a group
//   k _ s _ k+h s                 (stones/percussion) k kick, s snap, h tick, c clap, t tom; "+" hits together
export type Instrument = "flute" | "voice" | "strings" | "chimes" | "stones";
export const INSTRUMENTS: Instrument[] = ["flute", "voice", "strings", "chimes", "stones"];
export const DEFAULT_VOL: Record<Instrument, number> = { flute: 0.9, voice: 0.55, strings: 0.8, chimes: 0.6, stones: 0.8 };

export interface Ev { t: number; d: number; n: number[]; drums?: string[] }          // times and lengths in beats
export interface Voice { name: string; instrument: Instrument; vol: number; events: Ev[] }
export interface Score { title: string; tempo: number; beats: number; seconds: number; voices: Voice[] }
export interface VoiceSpec { name?: string; instrument: Instrument; notes: string; volume?: number; loop?: boolean }
export interface ComposeSpec { title: string; tempo?: number; voices: VoiceSpec[]; repeat?: number }

export class MusicError extends Error {}

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
export const pitchClassName = (pc: number) => NAMES[((pc % 12) + 12) % 12];

const MAX_EVENTS = 4000, MAX_SECONDS = 150;
const DRUMS = new Set(["k", "s", "h", "c", "t"]);

function len(s: string | undefined): number {
  if (s === undefined) return 1;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0.25 || v > 16) throw new MusicError(`Length ":${s}" isn't valid. Use 0.25 to 16 beats.`);
  return v;
}
function note(tok: string): number {
  const m = /^([A-Ga-g])([#b]?)([1-7])$/.exec(tok);
  if (!m) throw new MusicError(`"${tok}" isn't a note. Write notes like D4 F#3 Bb5 (octave 1-7).`);
  return 12 * (Number(m[3]) + 1) + SEMI[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

interface Item { d: number; n: number[]; drums?: string[] }

/** Parse one line of notation into items (rests are items with no notes). */
function parseSeq(src: string, drum: boolean, budget: { left: number }): Item[] {
  const out: Item[] = []; let i = 0;
  const take = (it: Item) => { if (--budget.left < 0) throw new MusicError("That piece is too long. Keep each voice under about 1500 notes in total."); out.push(it); };
  while (i < src.length) {
    const c = src[i];
    if (/[\s,|]/.test(c)) { i++; continue; }
    if (c === "(") {
      let depth = 1, j = i + 1;
      while (j < src.length && depth) { if (src[j] === "(") depth++; else if (src[j] === ")") depth--; j++; }
      if (depth) throw new MusicError("A '(' is never closed.");
      const inner = src.slice(i + 1, j - 1), rep = /^x(\d{1,2})/.exec(src.slice(j));
      if (!rep) throw new MusicError("A repeated group needs a count after it, like (D4 E4)x2.");
      const times = Number(rep[1]); if (times < 1 || times > 32) throw new MusicError("Repeat counts go from 1 to 32.");
      const items = parseSeq(inner, drum, budget);
      for (let r = 0; r < times; r++) for (const it of items) take(it);
      i = j + rep[0].length; continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i); if (j < 0) throw new MusicError("A '[' is never closed.");
      const inner = src.slice(i + 1, j).split(/[\s,]+/).filter(Boolean), tail = /^:([\d.]+)/.exec(src.slice(j + 1));
      const d = len(tail?.[1]);
      take(drum ? { d, n: [], drums: inner.map((x) => dr(x)) } : { d, n: inner.map(note) });
      i = j + 1 + (tail ? tail[0].length : 0); continue;
    }
    let j = i; while (j < src.length && !/[\s,|(\[]/.test(src[j])) j++;
    const tok = src.slice(i, j); i = j;
    const m = /^([^:]+)(?::([\d.]+))?$/.exec(tok); if (!m) throw new MusicError(`Can't read "${tok}".`);
    const d = len(m[2]);
    if (m[1] === "_" || m[1] === "-") take({ d, n: [] });
    else if (drum) take({ d, n: [], drums: m[1].split("+").map(dr) });
    else take({ d, n: [note(m[1])] });
  }
  return out;
}
function dr(x: string): string { const k = x.toLowerCase(); if (!DRUMS.has(k)) throw new MusicError(`"${x}" isn't a percussion sound. Use k (kick), s (snap), h (tick), c (clap), t (tom), or _ for rest.`); return k; }

export function compile(spec: ComposeSpec): Score {
  if (!spec.voices?.length) throw new MusicError("A piece needs at least one voice.");
  if (spec.voices.length > 6) throw new MusicError("At most 6 voices.");
  const tempo = Math.max(40, Math.min(200, Math.round(spec.tempo ?? 90)));
  const repeat = Math.max(1, Math.min(8, Math.round(spec.repeat ?? 1)));
  const budget = { left: MAX_EVENTS };
  const raw = spec.voices.map((v, idx) => {
    if (!INSTRUMENTS.includes(v.instrument)) throw new MusicError(`Unknown instrument "${v.instrument}". Choose from: ${INSTRUMENTS.join(", ")}.`);
    const items = parseSeq(String(v.notes ?? ""), v.instrument === "stones", budget);
    if (!items.length) throw new MusicError(`Voice ${idx + 1} (${v.instrument}) has no notes.`);
    return { spec: v, idx, items, beats: items.reduce((a, it) => a + it.d, 0) };
  });
  const one = Math.max(...raw.map((r) => r.beats)), total = one * repeat;
  if ((total * 60) / tempo > MAX_SECONDS) throw new MusicError(`That would run ${Math.round((total * 60) / tempo)}s. The limit is ${MAX_SECONDS}s: shorten it, speed it up, or reduce repeat.`);
  const voices: Voice[] = raw.map((r) => {
    const events: Ev[] = []; let t = 0;
    // every voice plays through `repeat` times; looping voices also refill to the full length
    const cycle = r.spec.loop ? total : r.beats * repeat;
    while (t < cycle - 1e-9) {
      for (const it of r.items) { if (t >= cycle - 1e-9) break; if (it.n.length || it.drums?.length) events.push({ t, d: Math.min(it.d, cycle - t), n: it.n, drums: it.drums }); t += it.d; }
      if (events.length > MAX_EVENTS) throw new MusicError("That piece is too dense.");
    }
    return { name: r.spec.name?.trim().slice(0, 24) || `${r.spec.instrument}${r.idx + 1}`, instrument: r.spec.instrument, vol: Math.max(0.1, Math.min(1, r.spec.volume ?? DEFAULT_VOL[r.spec.instrument])), events };
  });
  return { title: spec.title.trim().slice(0, 60) || "Untitled", tempo, beats: total, seconds: (total * 60) / tempo, voices };
}

// ---------- analysis (River can't hear its own music, so we describe it) ----------
export function analyze(s: Score): { text: string; pcWeight: number[]; longHeld: number[]; mood: string } {
  const pitched = s.voices.filter((v) => v.instrument !== "stones");
  const hist = new Array(12).fill(0), held = new Array(12).fill(0); let all = 0, lo = 999, hi = -1;
  for (const v of pitched) for (const e of v.events) for (const m of e.n) { hist[m % 12] += e.d; all += e.d; lo = Math.min(lo, m); hi = Math.max(hi, m); if (e.d >= 2) held[m % 12]++; }
  const out: string[] = []; let mood = "mysterious";
  out.push(`${Math.round(s.seconds)}s, ${s.tempo} bpm, ${s.voices.length} voice${s.voices.length === 1 ? "" : "s"} (${s.voices.map((v) => v.instrument).join(", ")})`);
  if (all > 0) {
    // tonic: the pitch class with most weight, plus a bonus for where the lowest voice ends
    const bass = [...pitched].sort((a, b) => avg(a) - avg(b))[0], last = bass?.events[bass.events.length - 1]?.n[0];
    const score = hist.map((h, pc) => h + (last !== undefined && last % 12 === pc ? all * 0.15 : 0));
    const tonic = score.indexOf(Math.max(...score)), m3 = hist[(tonic + 3) % 12], M3 = hist[(tonic + 4) % 12];
    const mode = m3 > M3 * 1.2 ? "minor" : M3 > m3 * 1.2 ? "major" : "modal";
    mood = mode === "minor" ? (s.tempo <= 84 ? "wistful" : "agitated") : mode === "major" ? (s.tempo >= 100 ? "joyful" : "serene") : "mysterious";
    out.push(`centred on ${pitchClassName(tonic)} (${mode}), ranging ${noteName(lo)} to ${noteName(hi)}`);
    const lead = [...pitched].filter((v) => v.instrument !== "voice").sort((a, b) => b.events.length - a.events.length)[0] ?? pitched[0];
    const seq = lead.events.filter((e) => e.n.length).map((e) => e.n[e.n.length - 1]);
    if (seq.length > 3) {
      const iv = seq.slice(1).map((m, i) => m - seq[i]), step = iv.filter((x) => Math.abs(x) <= 2).length / iv.length, leap = iv.filter((x) => Math.abs(x) >= 5).length / iv.length;
      out.push(`lead line (${lead.name}) moves ${step > 0.65 ? "mostly by step" : leap > 0.4 ? "in wide leaps" : "by a mix of steps and leaps"}`);
      const third = Math.max(1, Math.floor(seq.length / 3)), a = mean(seq.slice(0, third)), b = mean(seq.slice(third, 2 * third)), c = mean(seq.slice(-third));
      out.push(`contour ${c - a > 2 ? "rises" : a - c > 2 ? "falls" : b - (a + c) / 2 > 2 ? "arches up and returns" : (a + c) / 2 - b > 2 ? "dips and returns" : "stays level"}`);
      const grams = new Map<string, number>(); for (let i = 0; i + 4 <= iv.length; i++) { const k = iv.slice(i, i + 4).join(","); grams.set(k, (grams.get(k) ?? 0) + 1); }
      const rep = [...grams.values()].filter((n) => n > 1).reduce((x, n) => x + n, 0) / Math.max(1, iv.length - 3);
      out.push(rep > 0.5 ? "heavily repeated, almost a chant" : rep > 0.15 ? "has recurring motifs" : "rarely repeats itself");
      out.push(`${new Set(lead.events.map((e) => e.d)).size} different note lengths`);
    }
  }
  const dr = s.voices.find((v) => v.instrument === "stones"); if (dr) out.push(`percussion plays ${dr.events.length} hits`);
  out.push(`reads as ${mood}`);
  const w = hist.map((h) => (all ? h / all : 0));
  return { text: out.join("; "), pcWeight: w, longHeld: held, mood };
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const avg = (v: Voice) => mean(v.events.flatMap((e) => e.n));
