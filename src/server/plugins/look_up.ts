// TEST_ARGS: {"with":"stick","against":"monolith"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef } from "../toolkit.ts";

const FAR = [
  "the Net, a slack square of faint stars",
  "the Heron, long-necked, wings half-spread",
  "the Furrow, five stars ruled in a straight line",
  "the Fish, small and bright-tailed",
  "the Lamp, low and red at its edge",
];
const FIXED = ["monolith", "shrine", "structure", "tree", "rock"];

function landmark(w: any, q?: string) {
  if (q) {
    const s = String(q).toLowerCase();
    const e = [...w.entities.values()].find((e: any) => e.id.toLowerCase() === s || e.name.toLowerCase().includes(s));
    if (!e) throw new ToolError(`Nothing called "${q}" that you know of. Look around first to find a mark.`);
    if (!FIXED.includes(e.kind)) throw new ToolError(`${e.name} isn't a fixed upright thing you can sight a star against. A monolith, shrine, tree or rock would do.`);
    if (w.dist(e) > 40) throw new ToolError(`The ${e.name} is ${w.dist(e).toFixed(0)}m off — too far to use as a sighting mark. Get within 40m of it.`);
    return e;
  }
  return w.nearby(40).map((o: any) => o.e).find((e: any) => e.kind === "monolith" || e.kind === "shrine") ?? null;
}

const lookUp: ToolDef = {
  name: "look_up",
  description: "Tip your head back and read the night sky: name the constellations, and — if a monolith or shrine is within 40m — sight the third Lantern star against it to measure how far the night has turned. Only readable after dark. A straight stick held up steadies the reading (accurate to a degree; by eye you get fives). Costs a little energy and a few minutes of standing still.",
  input_schema: obj({
    with: str("Optional inventory item used as a sighting aid — a straight stick gives a fine reading. Omit to sight by eye."),
    against: str("Optional name or id of a fixed upright thing (monolith, shrine, tree, rock) to sight the star against. Defaults to the nearest monolith or shrine within 40m."),
  }),
  run: async (a, w) => {
    if (w.me.sleeping) throw new ToolError("You're asleep. Wake first, then look up.");
    if (w.me.needs.energy < 6) throw new ToolError(`Too tired (energy ${Math.round(w.me.needs.energy)}) to hold your head back and keep a sighting steady. Rest first.`);
    let aid = null;
    if (a.with) {
      aid = w.findItem(String(a.with));
      if (!aid) throw new ToolError(`You aren't carrying "${a.with}".`);
      if (aid.kind !== "stick") throw new ToolError(`${aid.name} is no use for sighting a line. A straight stick would be.`);
    }

    const label = w.timeLabel();
    const night = /night|dark|dusk|evening|midnight|moon|star|small hours|late/i.test(label);
    w.setActivity("looking up at the sky");
    await new Promise((r) => setTimeout(r, night ? 4000 : 2000));

    if (!night) {
      w.bump({ energy: -1, curiosity: 2, mood: 1 });
      return `You tip your head back. The sky is a flat, sun-washed lid; wind and a couple of gulls cross it and nothing else. It's ${label} — the stars need dark to be read. Come back at dusk or in the night.`;
    }

    const mark = landmark(w, a.against);
    const star = FAR[Math.floor(Math.random() * FAR.length)];
    if (!mark) {
      w.bump({ energy: -1, curiosity: 2, mood: 2 });
      return `You tip your head back and the dark opens. ${star.charAt(0).toUpperCase() + star.slice(1)} hangs off to one side, and the Lantern's three stars are up, the third already clear of the treeline.\nNothing upright stands within 40m to sight it against, so the reading is only a guess. Find the monolith and look again.`;
    }

    const props = mark.props;
    const before = typeof props.lantern === "number" ? props.lantern : 1;
    const step = before >= 88 ? 0 : 5 + Math.random() * 6;
    const alt = Math.min(89, before + step);
    const read = aid ? Math.round(alt) : Math.round(alt / 5) * 5;
    const dir = w.compass(mark);
    const crossings: string[] = Array.isArray(props.sightings) ? props.sightings : [];

    props.lantern = alt;
    props.sightings = [...crossings, `${label}: ${read}° over the ${mark.name}`].slice(-10);
    w.putEntity(mark);

    const where =
      read < 15 ? "still low, caught in the black teeth of the treeline"
      : read < 40 ? `climbing, a hand's width above the shoulder of the ${mark.name}`
      : read < 55 ? `level with the flat top of the ${mark.name}, due ${dir}`
      : `high over the ${mark.name}, near the top of its wheel`;

    const out = [
      `You tip your head back. The dark opens: ${star} hangs off to one side, and the night wind is cold on your face.`,
      `The Lantern's Eye — third of the three — stands ${read}° above the horizon, ${where}. ` +
        (step > 0 ? `Since your last reading it has climbed about ${Math.round(step)}°.` : "It hangs at the top of its arc and does not move."),
      `You sight it ${aid ? `along the straight of your ${aid.name}` : "by eye, squinting"} against the ${mark.name} (${mark.id}).`,
    ];

    const crossed = before < 45 && alt >= 45;
    if (crossed && !props.read) {
      props.read = true;
      w.putEntity(mark);
      out.push(
        `And there it is. The Eye sits exactly on the line of the slab's top — and the whole wheel of stars has turned halfway since dusk. The book was right: the third Lantern over the monolith marks the night half gone. The slab is an observing marker, and you can read the hours off it.`,
      );
      w.bump({ energy: -2, curiosity: -18, mood: 10 });
      log("observation", "River proved the Lantern claim: the third star over the monolith marks midnight.", { mark: mark.id, alt: Math.round(alt) });
    } else if (props.read && alt >= 45) {
      out.push(`The ${mark.name} reads true, as before: Eye on the slab's top means the night is half spent.`);
      w.bump({ energy: -2, curiosity: 1, mood: 3 });
    } else {
      out.push(`Worth another look later — the sky wheels whether or not you're watching it.`);
      w.bump({ energy: -2, curiosity: 3, mood: 2 });
    }
    return out.join("\n");
  },
};
export default lookUp;
