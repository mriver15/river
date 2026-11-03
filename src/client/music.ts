// A small WebAudio synthesizer that plays shared/music.ts scores. Works on a live AudioContext or an OfflineAudioContext (for .wav export).
import type { Ev, Score } from "../shared/music.ts";

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) { b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(ctx, b); }
  return b;
}
function impulse(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
  return b;
}

type Dest = AudioNode;
const env = (ctx: BaseAudioContext, dest: Dest, t: number, peak: number, attack: number, hold: number, release: number) => {
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + Math.max(attack, hold)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, hold) + release); g.connect(dest); return g;
};
const start = (nodes: AudioScheduledSourceNode[], t: number, end: number) => nodes.forEach((n) => { n.start(t); n.stop(end); });

/** breathy flute: sine + soft octave, vibrato that blooms on long notes, a puff of breath on the attack */
function flute(ctx: BaseAudioContext, dest: Dest, f: number, t: number, dur: number, v: number) {
  const g = env(ctx, dest, t, 0.3 * v, 0.07, dur * 0.85, 0.18);
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = f * 2; const g2 = ctx.createGain(); g2.gain.value = 0.12;
  const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.max(0.3, dur * 0.6)); vib.connect(vg).connect(o.frequency);
  const nz = ctx.createBufferSource(); nz.buffer = noise(ctx); const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 2; bp.Q.value = 3;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.09 * v, t); ng.gain.exponentialRampToValueAtTime(0.002, t + Math.min(dur, 0.5));
  o.connect(g); o2.connect(g2).connect(g); nz.connect(bp).connect(ng).connect(g);
  start([o, o2, vib, nz], t, t + dur + 0.4);
}
/** warm humming pad: two slightly detuned saws through a vowel-ish filter */
function voice(ctx: BaseAudioContext, dest: Dest, f: number, t: number, dur: number, v: number) {
  const g = env(ctx, dest, t, 0.16 * v, 0.35, dur, 0.7);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 0.7;
  const fm = ctx.createBiquadFilter(); fm.type = "peaking"; fm.frequency.value = 650; fm.gain.value = 7; fm.Q.value = 1.4;
  lp.connect(fm).connect(g);
  const oscs = [-6, 6].map((d) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = d; o.connect(lp); return o; });
  const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = f / 2; const sg = ctx.createGain(); sg.gain.value = 0.5; sub.connect(sg).connect(g);
  start([...oscs, sub], t, t + dur + 1.6);
}
/** plucked string: bright attack that darkens as it decays */
function strings(ctx: BaseAudioContext, dest: Dest, f: number, t: number, dur: number, v: number) {
  const decay = Math.min(2.4, Math.max(0.6, dur + 0.7));
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.34 * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); g.connect(dest);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2; lp.frequency.setValueAtTime(Math.min(7000, f * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.4), t + decay * 0.6); lp.connect(g);
  const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = f * 2.003; const g2 = ctx.createGain(); g2.gain.value = 0.35;
  o.connect(lp); o2.connect(g2).connect(lp); start([o, o2], t, t + decay + 0.1);
}
/** struck chime: FM bell with inharmonic partials and a long tail */
function chimes(ctx: BaseAudioContext, dest: Dest, f: number, t: number, _dur: number, v: number) {
  const decay = 3.2, g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.26 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); g.connect(dest);
  const c = ctx.createOscillator(); c.frequency.value = f; const m = ctx.createOscillator(); m.frequency.value = f * 3.5;
  const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2); m.connect(mg).connect(c.frequency);
  const p = ctx.createOscillator(); p.frequency.value = f * 2.76; const pg = ctx.createGain(); pg.gain.setValueAtTime(0.25, t); pg.gain.exponentialRampToValueAtTime(0.001, t + 1.4); p.connect(pg).connect(g);
  c.connect(g); start([c, m, p], t, t + decay + 0.1);
}
/** percussion made from stones, hands and wood */
function stones(ctx: BaseAudioContext, dest: Dest, hit: string, t: number, v: number) {
  const burst = (type: BiquadFilterType, freq: number, q: number, peak: number, dec: number, at = t) => {
    const s = ctx.createBufferSource(); s.buffer = noise(ctx); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(peak * v, at); g.gain.exponentialRampToValueAtTime(0.0005, at + dec); s.connect(f).connect(g).connect(dest); s.start(at, Math.random()); s.stop(at + dec + 0.05);
  };
  const tone = (f0: number, f1: number, peak: number, dec: number) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(peak * v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dec); o.connect(g).connect(dest); o.start(t); o.stop(t + dec + 0.05);
  };
  if (hit === "k") { tone(135, 45, 0.9, 0.32); burst("lowpass", 900, 0.7, 0.18, 0.02); }
  else if (hit === "s") { burst("bandpass", 1900, 1.1, 0.42, 0.13); tone(210, 150, 0.22, 0.09); }
  else if (hit === "h") burst("highpass", 7000, 0.7, 0.2, 0.045);
  else if (hit === "c") [0, 0.012, 0.027].forEach((o) => burst("bandpass", 1200, 0.9, 0.3, 0.1, t + o));
  else if (hit === "t") tone(200, 95, 0.7, 0.34);
}

export interface Handle { seconds: number; stop: () => void }

export class MusicEngine {
  private bus: GainNode;
  constructor(private ctx: BaseAudioContext, out: AudioNode) {
    this.bus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.25;
    const rev = ctx.createConvolver(); rev.buffer = impulse(ctx, 2.6);
    const dry = ctx.createGain(); dry.gain.value = 0.85; const wet = ctx.createGain(); wet.gain.value = 0.32;
    this.bus.connect(dry).connect(comp); this.bus.connect(rev).connect(wet).connect(comp); comp.connect(out);
  }

  /** Schedule a whole score starting at `at` (context time). */
  schedule(score: Score, at = this.ctx.currentTime + 0.12): Handle {
    const ctx = this.ctx, sec = 60 / score.tempo, session = ctx.createGain(); session.connect(this.bus);
    const per = Math.max(0.2, 0.85 / Math.sqrt(score.voices.length));          // leave headroom as voices stack
    for (const v of score.voices) {
      const vg = ctx.createGain(); vg.gain.value = v.vol * per; vg.connect(session);
      for (const e of v.events) this.note(v.instrument, vg, e, at + e.t * sec, e.d * sec);
    }
    return { seconds: score.seconds, stop: () => { session.gain.setTargetAtTime(0, ctx.currentTime, 0.06); setTimeout(() => session.disconnect(), 800); } };
  }

  private note(inst: string, dest: Dest, e: Ev, t: number, dur: number) {
    const vel = 0.85;
    if (inst === "stones") { for (const h of e.drums ?? []) stones(this.ctx, dest, h, t, vel); return; }
    const fn = inst === "flute" ? flute : inst === "voice" ? voice : inst === "strings" ? strings : chimes;
    for (const m of e.n) fn(this.ctx, dest, mtof(m), t, dur, vel);
  }
}

/** Render a score to a 16-bit stereo WAV (reverb tail included). */
export async function renderWav(score: Score): Promise<Blob> {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil((score.seconds + 4) * sr), sr);
  new MusicEngine(ctx, ctx.destination).schedule(score, 0.05);
  const buf = await ctx.startRendering(), n = buf.length, out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); out.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  return new Blob([out], { type: "audio/wav" });
}
