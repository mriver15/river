// TEST_ARGS: {"with":"stick"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, rand, wait } from "../toolkit.ts";

const STEMS = ["stick", "reed", "hollow stem", "green stem", "cane", "stem"];
const EDGES = ["stone", "shell"];

async function blow(w: any, carved: boolean): Promise<string> {
  w.setActivity("blowing the reed whistle");
  await wait(1800);
  w.bump({ mood: 3, curiosity: -2, energy: -1 });
  const out: string[] = [carved
    ? "You wet the notch, set it to your lower lip and blow. The new whistle answers with a thin, bright note that startles you."
    : "You set the notch to your lip and blow. A thin, bright note cuts the air."];

  const beasts = w.nearby(30).filter((o: any) => o.e.kind === "animal");
  if (beasts.length) {
    const e = beasts[0].e;
    const dx = e.x - w.me.x, dz = e.z - w.me.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const ux = dx / d, uz = dz / d;
    const flees = rand() < 0.5;
    const move = flees ? Math.min(5, d) : -Math.min(3, Math.max(0, d - 2));
    e.x += ux * move; e.z += uz * move;
    w.putEntity(e);
    if (Math.abs(move) < 0.6) out.push(`The ${e.name} ${w.compass(e)} of you freezes, ears up, and does not move.`);
    else if (flees) out.push(`The ${e.name} ${w.compass(e)} of you starts at the sound and puts ${move.toFixed(0)}m more ground between you.`);
    else out.push(`The ${e.name} ${w.compass(e)} of you lifts its head, then drifts ${Math.abs(move).toFixed(0)}m closer to hear it again.`);
    w.bump({ curiosity: -3 });
  } else {
    out.push("Nothing living answers. The note goes out into the quiet and nothing comes back.");
  }

  const wall = w.nearby(20).find((o: any) => ["rock", "monolith", "shrine", "structure", "library"].includes(o.e.kind));
  if (wall) {
    out.push(`The note comes back off the ${wall.e.name} ${w.compass(wall.e)} of you, a half-beat late and a little changed.`);
    w.bump({ curiosity: -4, mood: 2 });
  }

  log("world", "A thin whistle note carries across the island.", { x: w.me.x, z: w.me.z });
  return out.join("\n");
}

const reedWhistle: ToolDef = {
  name: "reed_whistle",
  description: "Carve a whistle from a hollow stem and blow across the notch. Needs a stick (or a green stem from a bush you can reach) and, ideally, a stone or shell as a cutting edge — by hand it is slow and may split. If you already carry a reed whistle, this just plays it. Blowing carries: animals and stone faces answer.",
  input_schema: obj({
    with: str("Stem to carve, from your pack (a stick). Omit to use the first stick you carry, or to cut a green stem from a nearby bush."),
    edge: str("Cutting edge from your pack (a stone or shell). Omit to use the first you carry, or to work the reed by hand."),
  }),
  run: async (a, w) => {
    if (w.me.sleeping) throw new ToolError("You're asleep. Wake up before you carve anything.");

    const held = w.findItem("reed whistle");
    if (held && held.kind === "crafted") return await blow(w, false);

    // --- find a stem ---
    let stem: any = null;
    if (a.with) {
      stem = w.findItem(String(a.with));
      if (!stem) throw new ToolError(`You have no "${a.with}" in your pack.`);
      if (stem.kind !== "stick") throw new ToolError(`${stem.name} is too solid to make a whistle. You need a hollow stem — a stick, or a green stem cut from a bush.`);
    } else {
      for (const n of STEMS) { const it = w.findItem(n); if (it && it.kind === "stick") { stem = it; break; } }
    }
    let bush: any = null;
    if (!stem) {
      const found = w.nearby(5).find((o: any) => o.e.kind === "bush" && (o.e.props.stock ?? 0) > 0);
      if (!found) throw new ToolError("You need a hollow stem: a stick from your pack, or a bush within reach that still has stems to cut.");
      bush = found.e;
    }

    // --- find a cutting edge (optional) ---
    let edge: any = null;
    if (a.edge) {
      edge = w.findItem(String(a.edge));
      if (!edge) throw new ToolError(`You have no "${a.edge}".`);
      if (!EDGES.includes(edge.kind)) throw new ToolError(`${edge.name} won't cut reed. A stone or a shell will.`);
    } else {
      for (const n of EDGES) { const it = w.findItem(n); if (it && EDGES.includes(it.kind)) { edge = it; break; } }
    }

    // --- carve ---
    const clean = !!edge;
    w.setActivity(clean ? "whittling a reed whistle" : "worrying a stem into a whistle");
    await wait(clean ? 6000 : 9000);
    w.bump({ energy: clean ? -4 : -7, hunger: -1 });

    if (bush) {
      bush.props.stock = Math.max(0, (bush.props.stock ?? 1) - 1);
      bush.props.lastTake = w.timeLabel();
      w.putEntity(bush);
      log("world", "River cut a green stem from a bush.", { bush: bush.id });
    } else {
      w.takeItem(stem.id, 1);
    }

    if (!clean && rand() < 0.35) {
      w.bump({ mood: -6, curiosity: 4 });
      return [
        `You worry the ${bush ? "green stem" : stem.name} with your thumbnail and your teeth, trying to hollow it out.`,
        "It splits down the side with a wet crack and goes limp in your hands. The stem is ruined — you'd want a stone or a shell, and another stem.",
      ].join("\n");
    }

    const whistle = w.addItem(
      "crafted",
      "reed whistle",
      "A short reed whistle, notched at one end and hollowed down its length. Blown across the notch it gives a thin, carrying note.",
      1,
      { pitch: "thin" },
      { maker: true, note: clean ? "cut clean with a hard edge" : "hollowed by hand" },
    );
    w.bump({ mood: 6, curiosity: -6 });
    log("world", "River carved a reed whistle.", { whistle: whistle.id });

    const made = clean
      ? `You lay the stem across your knee and work the ${edge.name} along it: a notch at one end, the pith pushed out, the far end left open. Your thumb pays for it, but it holds.`
      : "Without a cutting edge you hollow the stem with your thumbnail and your teeth, slow and clumsy. It holds — barely.";
    return `${made} You have a reed whistle.\n${await blow(w, true)}`;
  },
};

export default reedWhistle;
