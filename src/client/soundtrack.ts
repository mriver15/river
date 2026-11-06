// Background music: a few long, slow pieces that drift in under the ambience and crossfade as the mood of the island changes.
import type { AgentView } from "../shared/types.ts";

export type Mood = "calm" | "uneasy" | "tense";
const TRACKS: { id: string; url: string; mood: Mood }[] = [
  { id: "dawn", url: "/music/dawn.mp3", mood: "calm" },
  { id: "dusk", url: "/music/dusk.mp3", mood: "uneasy" },
  { id: "night", url: "/music/night.mp3", mood: "tense" },
];
const LEVEL = 0.32, FADE = 6;                 // under the ambience; seconds to cross from one piece to the next

/** What the moment feels like: danger and night are tense, dusk and low spirits uneasy, otherwise calm. */
export function moodFor(a: AgentView): Mood {
  const night = a.worldTime < 0.23 || a.worldTime > 0.78, dusk = (a.worldTime >= 0.68 && a.worldTime <= 0.78) || (a.worldTime >= 0.2 && a.worldTime < 0.26);
  const hurt = a.body.health < 40 || a.body.bleeding || (a.feelings.dread ?? 0) > 0.5;
  if (hurt || a.weather === "storm" || (night && !a.sleeping)) return "tense";
  if (night || dusk || a.weather === "fog" || a.needs.mood < 30) return "uneasy";
  return "calm";
}

export class Soundtrack {
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private out: GainNode;
  private cur: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private want: string | null = null;
  private busy = false;
  enabled = true;

  constructor(private ctx: BaseAudioContext, dest: AudioNode) { this.out = ctx.createGain(); this.out.gain.value = LEVEL; this.out.connect(dest); }

  private load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      const t = TRACKS.find((x) => x.id === id)!;
      p = fetch(t.url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => this.ctx.decodeAudioData(b)).catch(() => { this.buffers.delete(id); return null; });
      this.buffers.set(id, p);
    }
    return p;
  }

  /** Called with the current surroundings; switches pieces when the mood calls for another (never mid-way through one that still fits). */
  update(a: AgentView) {
    if (!this.enabled) return;
    const mood = moodFor(a), here = this.cur && TRACKS.find((t) => t.id === this.cur!.id)!.mood;
    if (here === mood) return;
    const next = TRACKS.find((t) => t.mood === mood); if (next) void this.play(next.id);
  }

  private async play(id: string) {
    if (this.busy || this.cur?.id === id) return;
    this.busy = true; this.want = id;
    try {
      const buf = await this.load(id); if (!buf || this.want !== id) return;
      const c = this.ctx, t = c.currentTime, old = this.cur;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = c.createGain(); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + FADE);
      src.connect(gain).connect(this.out); src.start();
      if (old) { old.gain.gain.cancelScheduledValues(t); old.gain.gain.setValueAtTime(old.gain.gain.value, t); old.gain.gain.linearRampToValueAtTime(0, t + FADE); old.src.stop(t + FADE + 0.1); }
      this.cur = { id, src, gain };
    } finally { this.busy = false; }
  }

  /** Silence it for good (sound turned off): the pieces fade away and the next update starts fresh. */
  stop() {
    this.want = null; const c = this.cur; this.cur = null; if (!c) return;
    const t = this.ctx.currentTime; c.gain.gain.cancelScheduledValues(t); c.gain.gain.setTargetAtTime(0, t, 0.3); c.src.stop(t + 1.5);
  }
}
