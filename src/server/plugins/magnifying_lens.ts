// TEST_ARGS: {"stone":"smooth stone"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef } from "../toolkit.ts";

const DETAILS = [
  "One bundle of twelve is cut left-handed — every stroke leans the other way. A different hand, or the same hand standing on the other side.",
  "Between two bundles there's a gap wide enough for a thirteenth stroke that was never cut. A count that stopped short, or a step that never came.",
  "In the deepest groove a hairline of paler stone shows where the tool skidded and was corrected. Whoever cut this was still learning the marks.",
  "The strokes follow the hum, not the reading: the lowest stroke of each bundle is cut deepest, as though struck on the beat.",
  "There is one bundle of thirteen. Every other is twelve. You check it three times and it stays thirteen.",
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const looksLikeLens = (it: any) =>
  /lens|clear|glass|quartz|crystal|polish/i.test(`${it.name} ${it.desc ?? ""}`);

const magnifyingLens: ToolDef = {
  name: "magnifying_lens",
  description:
    "Grind a stone into a small lens (or use one you already carry), then hold it and a clay rubbing against the fine scratches of a monolith in daylight to read what the blurred marks really are. Needs a stone to grind (it is used up) or a lens item, daylight, and a carved monolith within arm's reach.",
  input_schema: obj({
    stone: str("Name of a stone in your pack to grind into a lens. It is consumed."),
    lens: str("Name of a lens or clear, ground stone you already carry."),
    rubbing: str("Optional: name of a clay rubbing to hold beside the original at true size."),
  }),
  run: async (a, w) => {
    let rubbing: any = null;
    if (a.rubbing) {
      rubbing = w.findItem(String(a.rubbing));
      if (!rubbing) throw new ToolError(`You aren't carrying "${a.rubbing}". Name the rubbing as it reads in your pack, or leave it out.`);
    }

    const mono = w.nearby(6)
      .filter(({ e, d }) => e.kind === "monolith" && d <= 5)
      .map(({ e }) => e)
      .sort((x, y) => (/hum/i.test(y.name) ? 1 : 0) - (/hum/i.test(x.name) ? 1 : 0))[0];

    if (mono && /night|midnight|small hours|dark/i.test(w.timeLabel()))
      throw new ToolError("It's dark. A lens gathers light, it doesn't make it — wait for daylight and come back to the scratches.");

    const out: string[] = [];
    let lens: any = null;

    if (a.lens) {
      lens = w.findItem(String(a.lens));
      if (!lens) throw new ToolError(`You aren't carrying "${a.lens}". Name a lens you actually have, or name a stone to grind one from.`);
      if (!looksLikeLens(lens)) throw new ToolError(`${lens.name} won't bend light into a sharp image. A lens, a clear ground stone, or a drop held in a rim would.`);
    } else if (a.stone) {
      const s = w.findItem(String(a.stone));
      if (!s) throw new ToolError(`You aren't carrying "${a.stone}". Name a stone from your pack.`);
      if (!(s.kind === "stone" || /stone|flint|quartz/i.test(s.name)))
        throw new ToolError(`${s.name} won't grind down clear. You need a stone — something hard and fine-grained.`);
      w.setActivity("grinding a stone lens");
      await sleep(8000);
      w.takeItem(s.id, 1);
      w.bump({ energy: -6, mood: -2 });
      w.addItem("crafted", "ground lens", "A disc of stone ground thin and wet-polished; light bends through its middle and makes small things large.", 1, { lens: true });
      lens = w.findItem("ground lens") ?? null;
      out.push(`You grind the ${s.name} flat against a hard rock, thinner and thinner, wetting it with spit until light bends through the middle of it. Your arms ache. You have a lens.`);
    } else {
      throw new ToolError("You have nothing to look through. Name a `stone` to grind into a lens, or a `lens` you already carry.");
    }

    if (!mono) {
      out.push("Nothing carved is within arm's reach here. Carry the lens to the monolith and look again.");
      return out.join("\n");
    }

    const p = mono.props as any;
    const first = !p.fine_read;
    if (!p.tally) { p.tally = 9 * 12 + 1; p.bundles = 10; }
    p.readings = Array.isArray(p.readings) ? p.readings : [];
    const fresh = DETAILS.filter((d) => !p.readings.includes(d));
    const detail = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
    if (detail) p.readings.push(detail);
    p.fine_read = true;
    p.read_by = p.read_by ?? "River";
    p.last_read = w.timeLabel();
    w.putEntity(mono);

    w.setActivity("reading the fine scratches");
    await sleep(5500);
    w.bump(first ? { energy: -3, curiosity: -18, mood: 8 } : { energy: -2, curiosity: -5, mood: 3 });

    if (first) {
      out.push(
        "Cheek almost to the stone, you hold the lens between the scratches and the sky until the fine marks swim into focus, and lay your copy beside the original at true size. The blur was never your clay: the fine marks are not letters and not ornament. They are tally strokes, cut in bundles of twelve — twelve steps to a hum's returning.",
        `Nine bundles are complete. The tenth holds a single stroke and stops. ${p.tally} in all.`,
        "The stone is counting. It is counting its own hum.",
      );
      log("observation", "River read the fine tally strokes on the monolith.", { monolith: mono.id, tally: p.tally });
    } else {
      out.push(`You set the lens to the scratches again. Still ${p.tally} strokes: nine bundles of twelve and one stroke more.`);
    }

    if (rubbing) out.push(`Your rubbing laid against the stone matches groove for groove — the only blur was where the clay was too wet.`);
    if (detail) out.push(detail);
    else if (!first) out.push("Nothing new shows itself this time; the marks are what they were.");
    out.push("You could look again with different light, or find who else has stood here.");
    return out.join("\n");
  },
};

export default magnifyingLens;
