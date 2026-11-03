// TEST_ARGS: {"action":"ring","fine":true,"label":"the half tone down"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, wait } from "../toolkit.ts";

const RODS = "set of tuning rods";
const STEPS = ["a unison", "a minor second", "a major second", "a minor third", "a major third", "a perfect fourth", "a tritone", "a perfect fifth", "a minor sixth", "a major sixth", "a minor seventh", "a major seventh"];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// A monolith's hum belongs to the stone: same id, same pitch, every visit.
const humOf = (id: string) => { const h = hash(id); return { semis: (h % 24) - 12, cents: ((h >>> 8) % 90) - 45 }; };
const take = (w: any, name: string, n: number, bag: any[]) => { let got = 0; while (got < n) { const it = w.findItem(name); if (!it) break; const q = Math.min(Number(it.qty ?? 1), n - got); w.takeItem(it.id, q); bag.push({ kind: it.kind, name: it.name, desc: it.desc, qty: q }); got += q; } return got; };
const give = (w: any, bag: any[]) => { for (const b of bag) w.addItem(b.kind, b.name, b.desc, b.qty); };

const pitchRods: ToolDef = {
  name: "pitch_rods",
  description: "Cut and tune a set of four pitch rods (four sticks plus a stone or shell striker), then ring them beside a monolith to measure its hum: which of the twelve steps of the octave it lies on, how far above or below your zero, and — with fine:true and more time — how many cents off the step. Readings are recorded on the monolith so a later visit can be compared note for note. action 'make' or 'ring'.",
  input_schema: obj({
    action: str("'make' to cut and tune a set, 'ring' to sound one you carry. Omit to make if you have none, else ring."),
    fine: { type: "boolean", description: "Spend longer to measure cents, not just the step." },
    label: str("Name to record with this reading."),
  }),
  run: async (a, w) => {
    const act = a.action === undefined ? undefined : String(a.action);
    if (act !== undefined && act !== "make" && act !== "ring") throw new ToolError("action must be 'make' or 'ring'.");
    const fine = a.fine === true;
    let rods = w.findItem(RODS);
    if (act === "make" || (act === undefined && !rods)) {
      if (rods) throw new ToolError("You already carry a set of tuning rods.");
      const bag: any[] = [];
      const sticks = take(w, "stick", 4, bag);
      if (sticks < 4) { give(w, bag); throw new ToolError(`Four straight sticks are needed to cut rods from; you have ${sticks}.`); }
      let striker = take(w, "stone", 1, bag);
      if (!striker) striker = take(w, "shell", 1, bag);
      if (!striker) { give(w, bag); throw new ToolError("You need a stone or a shell to strike the rods against."); }
      const strikerName = bag[bag.length - 1].name;
      w.setActivity("cutting and tuning pitch rods");
      await wait(7000);
      w.bump({ energy: -5, mood: 3, curiosity: -2 });
      w.addItem("crafted", RODS, "Four seasoned rods filed with twelve sliding marks apiece, and a hard striker. Between them, one octave step by step.", 1, { pitch: true });
      return `You cut four straight lengths from the sticks, file each with twelve marks, and tap them against the ${strikerName} until they ring clean. Four rods, one octave, held in two hands. Ring them beside a monolith and the hum becomes a number you can name.`;
    }
    rods = w.findItem(RODS);
    if (!rods) throw new ToolError("You carry no tuning rods. Use action 'make' with four sticks and a stone or shell.");
    const mono = [...w.entities.values()].filter((e) => e.kind === "monolith").map((e) => ({ e, d: w.dist(e) })).sort((x, y) => x.d - y.d)[0];
    if (!mono) throw new ToolError("There is no monolith here to ring against.");
    if (mono.d > 10) throw new ToolError(`The nearest monolith, ${mono.e.name}, is ${Math.round(mono.d)}m ${w.compass(mono.e)} — too far to match a hum. Walk closer.`);
    w.setActivity(fine ? "measuring the hum, rod by rod" : "ringing the pitch rods");
    await wait(fine ? 9000 : 4500);
    w.bump({ energy: fine ? -6 : -3, curiosity: fine ? -14 : -6, mood: 2 });
    const h = humOf(mono.e.id);
    const step = STEPS[((h.semis % 12) + 12) % 12];
    const dir = h.semis === 0 ? "level with your zero" : `${Math.abs(h.semis)} step${Math.abs(h.semis) === 1 ? "" : "s"} ${h.semis > 0 ? "above" : "below"} your zero`;
    const out = [`You ring the rods one after another against the ${mono.e.name} and find the fit: its hum sits at ${step}, ${dir}${h.semis === 0 ? "" : ` (${h.semis > 0 ? "+" : ""}${h.semis} semitones)`}.`];
    if (fine) out.push(`Held longer, the beats slow to ${Math.abs(h.cents)} cents ${h.cents > 0 ? "sharp of" : h.cents < 0 ? "flat of" : "dead on"} the ${step} mark.`);
    const props = mono.e.props ?? (mono.e.props = {});
    const prior: any[] = Array.isArray(props.readings) ? props.readings : [];
    const last = prior[prior.length - 1];
    const rec: any = { at: w.timeLabel(), label: a.label ? String(a.label) : undefined, semis: h.semis, step };
    if (fine) rec.cents = h.cents;
    if (last) {
      if (last.semis === h.semis) out.push(`The same step as your last reading${last.label ? ` (${last.label})` : ""} — the note repeats, the stone has not moved.`);
      else out.push(`Against your last reading${last.label ? ` (${last.label})` : ""} at ${last.step}, that is ${Math.abs(h.semis - last.semis)} step(s) ${h.semis > last.semis ? "higher" : "lower"}.`);
    }
    prior.push(rec);
    props.readings = prior.slice(-12);
    props.desc = `A monolith that hums. ${props.readings.length} measured reading(s) recorded on it, the latest ${step}.`;
    w.putEntity(mono.e);
    log("observation", "River measured the monolith's hum.", { monolith: mono.e.id, ...rec });
    out.push("You scratch the reading onto the stone with the striker, so it is there for the next visit.");
    return out.join("\n");
  },
};
export default pitchRods;
