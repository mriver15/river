import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, rand, wait } from "../toolkit.ts";

// TEST_ARGS: {"action":"carve"}

const findWhistle = (w: any) => w.findItem("reed whistle") ?? w.findItem("whistle");

const reedWhistle: ToolDef = {
  name: "reed_whistle",
  description:
    "Carve a whistle from a supple green stick (a reed stem) and blow across it. Carving needs a stick in your pack, or a bush within reach to snap a shoot from, and costs effort; the whistle then stays with you. Blowing it costs breath, lifts your mood and settles curiosity — and animals, and standing stone, answer it.",
  input_schema: obj({
    action: str('"carve" or "blow". Defaults to carve if you carry no whistle, otherwise blow.'),
    with: str("Which item to carve from, if you carry more than one stick. Optional."),
  }),
  run: async (a, w) => {
    const held = findWhistle(w);
    let action = String(a.action ?? "").toLowerCase().trim();
    if (!action) action = held ? "blow" : "carve";
    if (action !== "carve" && action !== "blow") throw new ToolError('action must be "carve" or "blow".');

    if (action === "carve") {
      if (held) throw new ToolError(`You already carry a ${held.name} (${held.id}) — blow it instead of carving another.`);
      let stem = a.with ? w.findItem(String(a.with)) : w.findItem("stick");
      if (a.with && !stem) throw new ToolError(`You have no ${a.with}.`);
      if (stem && stem.kind !== "stick") throw new ToolError(`${stem.name} won't carve — you need a green stick, something with a little give.`);
      const sources: string[] = [];
      if (!stem) {
        const b = w.nearby(5).find(({ e }) => e.kind === "bush" && (e.props.stock ?? 0) > 0);
        if (!b) throw new ToolError("You need a supple green stick. Find one with gather, or stand within reach of a leafy bush to snap a shoot from.");
        b.e.props.stock = (b.e.props.stock ?? 0) - 1;
        b.e.props.lastTake = w.timeLabel();
        w.putEntity(b.e);
        sources.push(b.e.id);
      }
      w.setActivity("carving a reed whistle");
      await wait(5000);
      w.bump({ energy: -4, curiosity: -2 });
      if (rand() < 0.16) {
        if (stem) w.takeItem(stem.id, 1);
        w.bump({ mood: -4 });
        return "You cut the notch too deep and the stem splits along the grain with a dry crack. Nothing for it but another stem.";
      }
      const q = Math.min(1, 0.3 + rand() * 0.65);
      const lip = q > 0.75 ? "its notch clean and true" : q > 0.5 ? "a little rough at the lip" : "the notch ragged and uncertain";
      if (stem) { w.takeItem(stem.id, 1); sources.push(stem.id); }
      w.addItem(
        "crafted", "reed whistle",
        `A short whistle carved from a green stem, ${lip}. Blow across the hole to sound it.`,
        1, { quality: Number(q.toFixed(2)), blows: 0 },
        { sources, maker: true, note: `carved at ${w.timeLabel()}` },
      );
      log("world", "River carved a reed whistle.", { quality: Number(q.toFixed(2)) });
      return `You shave the green stem into a hollow tube, cut a notch at one end and blow across it. ` +
        (q > 0.75 ? "The note that comes back is clean and high — a real instrument." : q > 0.5 ? "The note is thin but true. It will do." : "The note is breathy and imprecise, but it is a whistle.") +
        (stem ? "" : " You snapped the shoot from a nearby bush for it.");
    }

    const whistle = held!;
    if (w.me.needs.energy < 6) throw new ToolError("Your breath is too short for the whistle. Sit, rest, then try again.");
    const props: any = (whistle as any).props ?? {};
    const q = Number(props.quality ?? 0.5);
    const blows = Number(props.blows ?? 0) + 1;
    (whistle as any).props = { ...props, blows };
    w.setActivity("blowing the reed whistle");
    await wait(2000);
    w.bump({ energy: -2 });
    const tired = blows > 14;
    const moodGain = tired ? 1 : Math.max(1, Math.round(2 + q * 5 - Math.max(0, blows - 8)));
    w.bump({ mood: moodGain, curiosity: -Math.max(2, Math.round(3 + q * 4)) });

    const lines: string[] = [
      q > 0.75 ? "The note comes out clean and high and hangs in the air a moment longer than it should."
        : q > 0.5 ? "A thin, wavering note, half breath and half sound."
        : "The whistle wheezes — more air than note.",
    ];
    if (tired) lines.push("Your lips are going numb and the sound is thinning. You should stop soon.");

    const animals = w.nearby(25).filter(({ e }) => e.kind === "animal");
    if (animals.length) {
      const near = animals[0];
      if (q < 0.5 || blows > 8 || rand() < 0.4) {
        for (const { e } of animals) {
          const dx = e.x - w.me.x, dz = e.z - w.me.z, d = Math.hypot(dx, dz) || 1;
          e.x += (dx / d) * 2.5; e.z += (dz / d) * 2.5;
          w.putEntity(e);
        }
        lines.push(`The ${near.e.name} (${near.e.id}) flinches and moves off ${w.compass(near.e)}ward, away from the sound.`);
      } else {
        lines.push(`The ${near.e.name} (${near.e.id}) lifts its head ${w.compass(near.e)} of you and listens, unafraid.`);
        w.bump({ curiosity: -3 });
      }
    }

    const stone = w.nearby(20).map((o) => o.e).find((e) => ["monolith", "shrine", "structure", "library"].includes(e.kind));
    if (stone) {
      if (!stone.props.whistleEcho) {
        stone.props.whistleEcho = true;
        w.putEntity(stone);
        log("observation", "The stone returned River's whistle a fifth lower, and then again, fainter.", { entity: stone.id });
        w.bump({ curiosity: -10 });
        lines.push(`The note comes back off the ${stone.name} (${stone.id}) a fifth lower, and then again, fainter — as if something under it were answering.`);
      } else {
        lines.push(`The ${stone.name} (${stone.id}) gives the note back, flat and slow.`);
      }
    }

    const tree = w.nearby(15).find(({ e }) => e.kind === "tree");
    if (tree && rand() < 0.45) lines.push(`Something in the ${tree.e.name} (${tree.e.id}) answers with two notes of its own.`);
    return lines.join("\n");
  },
};

export default reedWhistle;
