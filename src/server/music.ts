// River's composing: a multi-voice piece in text notation (see shared/music.ts), saved to a library, performed in the world.
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import { addMemory } from "./memory.ts";
import { touchInterest } from "./mind.ts";
import { ToolError, obj, num, str, type ToolDef } from "./toolkit.ts";
import { INSTRUMENTS, MusicError, analyze, compile, noteName, type ComposeSpec, type Score } from "../shared/music.ts";
import type { World } from "./world.ts";
import { simNow } from "./sim.ts";
import { gate, secondPass } from "./activities.ts";

/** The monolith hums A1 and drops a semitone with each shift; this is the pitch class it is on now. */
const humPitchClass = (shifts: number) => (((9 - shifts) % 12) + 12) % 12;
/** Wind instruments aren't handed out. River needs to have found or made something to blow through. */
const windInstrument = (w: World) => [...w.inventory.values()].find((i) => /flute|pipe|whistle|reed|horn|ocarina/i.test(`${i.name} ${i.kind}`));

export interface Saved { id: number; title: string; spec: ComposeSpec; ts: number; plays: number }
const rowOf = (r: any): Saved => ({ id: r.id, title: r.title, spec: JSON.parse(r.spec), ts: r.ts, plays: r.plays });
export const library = (): Saved[] => (db.prepare("SELECT * FROM compositions ORDER BY ts DESC").all() as any[]).map(rowOf);
const byTitle = (t: string) => { const r = db.prepare("SELECT * FROM compositions WHERE title = ?").get(t.trim()); return r ? rowOf(r) : null; };

/** For the UI: every saved piece, compiled, with its analysis. */
export function libraryForUi() {
  return library().flatMap((s) => { try { const score = compile(s.spec); return [{ id: s.id, title: s.title, ts: s.ts, plays: s.plays, score, analysis: analyze(score).text }]; } catch { return []; } });
}

const NOTATION = "Notation per voice: notes like D4 F#3 Bb5 (octave 1-7), `:n` holds n beats (0.25-16, default 1), `_` rest, `[D3 F3 A3]:4` chord, `(D4 E4 F4)x2` repeat a group. " +
  "stones (percussion) use k kick, s snap, h tick, c clap, t tom, `_` rest, `+` for together (k+h).";

export const COMPOSE_TOOL: ToolDef = {
  name: "compose",
  description:
    "Compose and perform a piece of music with several voices playing together; pieces are saved to your library so you can replay or rework them. " +
    "Actions: `write` (compose a new piece, or rewrite one with the same title; you perform it at once), `play` (perform a saved piece by title), `list` (your library). " +
    "Voices: voice (your own warm humming), strings (plucked), chimes (struck, bell-like), stones (percussion), and flute (a wind sound, only if you are carrying something to blow through). Up to 6 voices, up to 150 seconds. " +
    "`tempo` is beats per minute (40-200); `repeat` plays the whole piece again; a voice with `loop` true keeps repeating to fill the piece (good for drones and rhythms). " +
    NOTATION + " Each voice's notation is counted in beats: voices of different lengths just end at different times. After writing, you are told how the piece is built (its key, range, contour, repetition), since you can't hear it from outside. " +
    "The mood of a piece lives in its mode, tempo and register (slow minor and low sounds mournful; quick major and high sounds bright). Performing takes real time and the island hears it.",
  input_schema: obj({
    action: { type: "string", enum: ["write", "play", "list"], description: "write a new piece, play a saved one, or list your library" },
    title: str("Title of the piece (required for write and play)"),
    tempo: num("Beats per minute, 40-200 (default 90)"),
    repeat: num("Play the whole piece this many times (1-8, default 1)"),
    voices: { type: "array", description: "The voices, 1-6", items: { type: "object", additionalProperties: false, required: ["instrument", "notes"], properties: {
      instrument: { type: "string", enum: [...INSTRUMENTS] }, name: str("Optional name for this voice, e.g. 'melody' or 'drone'"), notes: str("This voice's notation"),
      volume: num("0.1-1 (optional)"), loop: { type: "boolean", description: "Repeat this voice to fill the whole piece" } } } },
  }, ["action"]),
  run: async (a, w: World) => {
    const action = String(a.action ?? "write");
    if (action === "list") {
      const l = library();
      return l.length ? l.map((s) => { try { const sc = compile(s.spec); return `- "${s.title}": ${Math.round(sc.seconds)}s, ${sc.tempo} bpm, ${sc.voices.map((v) => v.instrument).join("+")}, played ${s.plays}×`; } catch { return `- "${s.title}" (damaged)`; } }).join("\n") : "You haven't composed anything yet.";
    }
    if (!a.title?.toString().trim()) throw new ToolError("Give the piece a title.");
    let spec: ComposeSpec, fresh = false;
    if (action === "play") { const s = byTitle(String(a.title)); if (!s) throw new ToolError(`No piece called "${a.title}". Your library: ${library().map((x) => x.title).join(", ") || "empty"}.`); spec = s.spec; }
    else if (action === "write") {
      if (!Array.isArray(a.voices) || !a.voices.length) throw new ToolError("A piece needs voices: an array of {instrument, notes}.");
      spec = { title: String(a.title), tempo: a.tempo, repeat: a.repeat, voices: a.voices.map((v: any) => ({ instrument: v?.instrument, name: v?.name, notes: String(v?.notes ?? ""), volume: v?.volume, loop: !!v?.loop })) };
      fresh = true;
    } else throw new ToolError(`Unknown action "${a.action}". Use write, play or list.`);

    let score: Score;
    try { score = compile(spec); } catch (e: any) { throw new ToolError(e instanceof MusicError ? e.message : `Could not read that piece: ${e.message}`); }
    if (score.voices.some((v) => v.instrument === "flute") && !windInstrument(w)) throw new ToolError("A wind voice needs something to blow through, and you aren't carrying anything like that. Your own voice, strings, chimes and stones are always with you.");
    const an = analyze(score);
    // Starting the performance (writing it down, counting the play, the audio) happens once; the end of it, after the wait, applies the rest.
    const again = secondPass();
    let plays: number;
    if (again) plays = again.extra.plays;
    else {
      if (fresh) db.prepare("INSERT INTO compositions(title, spec, ts) VALUES(?,?,?) ON CONFLICT(title) DO UPDATE SET spec = excluded.spec, ts = excluded.ts").run(score.title, JSON.stringify(spec), simNow());
      const row = byTitle(score.title)!; plays = row.plays;
      db.prepare("UPDATE compositions SET plays = plays + 1 WHERE id = ?").run(row.id);
      bus.emit("score", { t: "score", title: score.title, score });
      log("action", `River ${fresh ? "composes and performs" : "performs"} "${score.title}" (${Math.round(score.seconds)}s, ${score.voices.map((v) => v.instrument).join(" + ")})`, { analysis: an.text });
    }
    gate(w, Math.min(score.seconds, 90) * 1000, `performing "${score.title}"`, { plays });

    // the island listens
    const heard: string[] = [], now = simNow();
    const animals = w.nearby(26).map((o) => o.e).filter((e) => e.kind === "animal"), species = new Map<string, number>();
    for (const e of animals) { e.props.calmUntil = now + 90_000 + score.seconds * 1000; species.set(e.props.species, (species.get(e.props.species) ?? 0) + 1); }
    for (const [sp, n] of species) heard.push(sp === "firefly" ? "fireflies gather and drift in time with it" : `${n > 1 ? `${n} ${sp}s` : `a ${sp}`} stop${n > 1 ? "" : "s"} to listen`);
    const mono = w.nearby(45).map((o) => o.e).find((e) => e.kind === "monolith");
    if (mono) {
      const pc = humPitchClass(mono.props.shifts ?? 0);
      if (an.pcWeight[pc] >= 0.12 || an.longHeld[pc] >= 1) {
        mono.props.resonance = (mono.props.resonance ?? 0) + 1;
        mono.props.desc = String(mono.props.desc).replace(/ It has answered a flute \d+ times?\./, "").replace(/ It has answered music \d+ times?\./, "") + ` It has answered music ${mono.props.resonance} time${mono.props.resonance === 1 ? "" : "s"}.`;
        w.putEntity(mono); log("world", "The monolith answered the music.", { resonance: mono.props.resonance });
        heard.push(`the monolith's hum rises to meet the ${noteName(60 + pc).replace(/\d+$/, "")} in it, swells, and settles — the stone looks more awake than before`);
      }
    }
    const expr = { mood: an.mood, note: "" }; bus.emit("expressed", expr);      // the Emotions system lets music carry feelings away
    const first = plays === 0;
    w.bump({ mood: first ? Math.min(10, 3 + score.seconds / 12) : 1.5, curiosity: -3, energy: -1 });
    touchInterest("music", `composing "${score.title}"`, first ? 1 : 0.3);
    if (fresh) addMemory(`I composed "${score.title}": ${an.text}.${heard.length ? ` ${heard.join("; ")}.` : ""}`, 6, ["music", "composition"]);
    return `${fresh ? "You wrote and performed" : "You performed"} "${score.title}".\nHow it's built: ${an.text}.${heard.length ? `\nThe island heard it: ${heard.join("; ")}.` : ""}${expr.note ? `\n${expr.note}` : ""}`;
  },
};
