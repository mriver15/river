// Ambient sound for the island, plus the music player. Off until the user clicks (browsers require a gesture).
import { heightAt, WATER_LEVEL } from "../shared/noise.ts";
import type { Score } from "../shared/music.ts";
import type { AgentView, Entity } from "../shared/types.ts";
import { MusicEngine, type Handle } from "./music.ts";
import { compile } from "../shared/music.ts";
import { Soundtrack } from "./soundtrack.ts";

/** Short musical stings for moments that matter, by the feeling at their heart. */
const STINGS = {
  wonder: compile({ title: "wonder", tempo: 78, voices: [{ instrument: "chimes", notes: "A4 E5 A5:3" }, { instrument: "voice", notes: "[A3 E4]:4", volume: 0.4 }] }),
  joy: compile({ title: "joy", tempo: 112, voices: [{ instrument: "chimes", notes: "C5 E5 G5 C6:3" }, { instrument: "strings", notes: "[C4 G4]:2 [E4 C5]:2", volume: 0.6 }] }),
  sorrow: compile({ title: "sorrow", tempo: 62, voices: [{ instrument: "voice", notes: "[D3 F3 A3]:6" }, { instrument: "chimes", notes: "_ A4:4", volume: 0.4 }] }),
  fear: compile({ title: "fear", tempo: 74, voices: [{ instrument: "stones", notes: "t:2 t:1 t:3", volume: 0.9 }, { instrument: "voice", notes: "[C3 F#3]:6", volume: 0.5 }] }),
} as const;
export type Sting = keyof typeof STINGS;

function noiseBuffer(ctx: BaseAudioContext, secs = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export interface Playing { title: string; started: number; seconds: number; stop: () => void }

export class Ambience {
  ctx: BaseAudioContext | null = null;
  master!: GainNode;
  private g: Record<string, GainNode> = {};
  private hum?: OscillatorNode;
  private engine?: MusicEngine;
  private track?: Soundtrack;
  playing: Playing | null = null;
  on = false;

  constructor(private seed: number, private entities: () => Iterable<Entity>) {}

  private noise(name: string, type: BiquadFilterType, freq: number, q = 0.7) {
    const c = this.ctx!, src = c.createBufferSource(); src.buffer = noiseBuffer(c); src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master); src.start();
    this.g[name] = g; return { f, g };
  }

  toggle(): boolean {
    if (!this.ctx) { const c = new AudioContext(); this.buildFor(c, c.destination); }
    this.on = !this.on;
    this.master.gain.setTargetAtTime(this.on ? 1 : 0, this.ctx!.currentTime, 0.4);
    if (!this.on) { this.stopMusic(); this.track?.stop(); }
    if (this.on && this.ctx instanceof AudioContext) void this.ctx.resume();
    return this.on;
  }

  /** Build the graph on any context (an OfflineAudioContext in tests). */
  buildFor(c: BaseAudioContext, dest: AudioNode) {
    this.ctx = c; this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(dest);
    this.track = c instanceof AudioContext ? new Soundtrack(c, this.master) : undefined;      // not in the offline renders used by tests
    this.noise("wind", "bandpass", 420, 0.6);
    this.noise("rain", "highpass", 2400, 0.4);
    const surf = this.noise("surf", "lowpass", 700, 0.5);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 250; lfo.connect(lg).connect(surf.f.frequency); lfo.start();
    this.noise("fire", "bandpass", 3200, 2.5);
    // night insects: a quiet high tone whose loudness pulses. The level (`bugs`) feeds a stage whose gain is the pulse,
    // so with the level at zero it is truly silent. (A tremolo wired straight into the level gain made an always-on shrill tone.)
    const o = c.createOscillator(); o.frequency.value = 3300;
    const level = c.createGain(); level.gain.value = 0;
    const pulse = c.createGain(); pulse.gain.value = 0.5;
    const t = c.createOscillator(); t.frequency.value = 38; const tg = c.createGain(); tg.gain.value = 0.5; t.connect(tg).connect(pulse.gain);
    o.connect(level).connect(pulse).connect(this.master); o.start(); t.start(); this.g.bugs = level;
    // monolith hum
    this.hum = c.createOscillator(); this.hum.type = "sine"; this.hum.frequency.value = 55;
    const h2 = c.createOscillator(); h2.type = "sine"; h2.frequency.value = 110.7; const h2g = c.createGain(); h2g.gain.value = 0.35;
    const hg = c.createGain(); hg.gain.value = 0; this.hum.connect(hg); h2.connect(h2g).connect(hg); hg.connect(this.master); this.hum.start(); h2.start(); this.g.hum = hg;
  }

  /** Called a couple of times a second with what River's surroundings are. */
  update(a: AgentView) {
    if (!this.ctx || !this.on) return;
    this.track?.update(a);
    const t = this.ctx.currentTime, set = (n: string, v: number) => this.g[n]?.gain.setTargetAtTime(v, t, 1.2);
    const night = a.worldTime < 0.23 || a.worldTime > 0.78;
    const wet = a.weather === "rain" ? 1 : a.weather === "storm" ? 1.4 : 0;
    set("rain", 0.16 * wet);
    set("wind", { windy: 0.28, storm: 0.36, cloudy: 0.11, fog: 0.09, rain: 0.12, clear: 0.07 }[a.weather]);
    set("bugs", night && wet === 0 ? 0.007 : 0);
    let water = 0; for (let i = 0; i < 8; i++) if (heightAt(a.x + Math.cos(i * Math.PI / 4) * 12, a.z + Math.sin(i * Math.PI / 4) * 12, this.seed) < WATER_LEVEL) water++;
    set("surf", 0.09 + 0.26 * (water / 8));
    let fire = 0, hum = 0, shifts = 0;
    for (const e of this.entities()) {
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (e.kind === "campfire" && e.props.lit !== false) fire = Math.max(fire, 1 - d / 14);
      if (e.props.burning) fire = Math.max(fire, 1 - d / 22);
      if (e.kind === "monolith") { hum = Math.max(hum, 1 - d / 45); shifts = e.props.shifts ?? 0; }
    }
    set("fire", Math.max(0, fire) * 0.16);
    set("hum", Math.max(0, hum) * 0.26);
    this.hum?.frequency.setTargetAtTime(55 * Math.pow(2, -shifts / 12), t, 2);   // each shift drops it a semitone
  }

  // ---------- music ----------
  perform(score: Score): Playing | null {
    if (!this.on || !this.ctx) return null;
    this.stopMusic();
    this.engine ??= new MusicEngine(this.ctx, this.master);
    const h: Handle = this.engine.schedule(score);
    const p: Playing = { title: score.title, started: Date.now(), seconds: score.seconds, stop: h.stop };
    this.playing = p; setTimeout(() => { if (this.playing === p) this.playing = null; }, score.seconds * 1000 + 3500);
    return p;
  }
  stopMusic() { this.playing?.stop(); this.playing = null; }

  /** A brief musical mark for a moment that mattered. Doesn't interrupt anything already playing. */
  sting(kind: Sting) {
    if (!this.on || !this.ctx) return;
    this.engine ??= new MusicEngine(this.ctx, this.master); this.engine.schedule(STINGS[kind]);
  }

  thunder() { if (this.on) this.burst(0.5, "lowpass", 160, 2.4); }
  meteor() { if (this.on) this.burst(0.06, "highpass", 3000, 0.9); }
  private burst(vol: number, type: BiquadFilterType, freq: number, dur: number) {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = noiseBuffer(c, 1); s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + dur);
    s.connect(f).connect(g).connect(this.master); s.start(); s.stop(c.currentTime + dur);
  }
}
