// TEST_ARGS: {"what":"wrap"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, wait, rand } from "../toolkit.ts";

const FIBRE = /bark|fibre|fiber|vine|moss|grass|reed|sedge|willow|nettle|root|sinew|stem/i;

const RECIPES: Record<string, { units: number; weaveMs: number; energy: number; label: string }> = {
  cord: { units: 2, weaveMs: 1800, energy: 2, label: "cord" },
  wrap: { units: 4, weaveMs: 3500, energy: 4, label: "wrap" },
  mat: { units: 6, weaveMs: 5000, energy: 6, label: "mat" },
  basket: { units: 7, weaveMs: 6000, energy: 7, label: "basket" },
};

const TIERS = [
  { min: 0.82, word: "fine", note: "fine and tight, the twist as even as a plait" },
  { min: 0.6, word: "sound", note: "sound work — tight twist, straight edges" },
  { min: 0.35, word: "rough", note: "rough, but the twist holds when you pull it" },
  { min: 0, word: "crude", note: "lumpy and uneven, ends poking out, but it holds" },
];

/** How much weaving River has actually done. */
function skillOf(w: any): number {
  const me: any = w.me;
  let xp = typeof me.weaveXp === "number" ? me.weaveXp : -1;
  if (xp < 0) {
    xp = 0;
    for (const e of w.entities.values()) if (e.props && e.props.woven) xp++;
  }
  return Math.min(8, xp);
}

const weave: ToolDef = {
  name: "weave",
  description:
    "Weave plant fibre by hand into something to wear or carry. Stand at a tree to peel bark strips, or at a bush to strip fibre (or name fibre you already carry). Slow, tiring hand-work: you start clumsy and get better with practice. Makes cord, a body wrap, a mat or a basket. Needs energy and fibrous material.",
  input_schema: obj(
    {
      what: str("What to weave: 'cord' (2 lengths), 'wrap' (4 lengths, something to wear), 'mat' (6 lengths), 'basket' (7 lengths)."),
      material: str("Optional: name of a fibrous item you already carry (bark strips, vine, moss) to use instead of harvesting."),
    },
    ["what"],
  ),
  run: async (a, w) => {
    if (w.me.sleeping) throw new ToolError("You can't weave in your sleep. Wake first.");
    const what = String(a.what ?? "").toLowerCase().trim();
    const recipe = RECIPES[what];
    if (!recipe) throw new ToolError(`You don't know how to weave a "${a.what}". You could try cord, wrap, mat or basket.`);
    if (w.me.needs.energy < 12) throw new ToolError("You're too tired — the strands keep slipping out of your fingers. Rest, then weave.");

    const need = recipe.units;
    let have = 0;
    let carried: any = null;
    if (a.material) {
      carried = w.findItem(String(a.material));
      if (!carried) throw new ToolError(`You aren't carrying anything called "${a.material}".`);
      if (!FIBRE.test(`${carried.name} ${carried.kind}`))
        throw new ToolError(`${carried.name} won't twist into cord. You need bark, vine, moss or similar fibre.`);
      have = Math.min(need, carried.qty ?? 1);
    }
    const cap = (e: any) =>
      e.kind === "tree" ? Math.max(0, 3 - (e.props?.barkTaken ?? 0)) : Math.max(0, 4 - (e.props?.fibreTaken ?? 0));
    const sources = w.nearby(6)
      .filter(({ e }) => (e.kind === "tree" || e.kind === "bush") && w.inReach(e))
      .map(({ e }) => e);
    let avail = have;
    for (const s of sources) avail += cap(s);
    if (avail < need)
      throw new ToolError(
        `A ${what} needs ${need} good lengths of fibre. You have ${have} to hand and ${avail - have} more within reach. ` +
          `Stand at a tree to peel bark or a bush to strip fibre (a tree gives about 3 strips, a bush about 4).`,
      );

    const out: string[] = [];
    if (carried && have > 0) {
      w.takeItem(carried.id, have);
      out.push(`You pull ${have} length${have > 1 ? "s" : ""} of ${carried.name} from your things.`);
    }
    let left = need - have;
    let gathered = 0;
    const peeled: string[] = [];
    for (const s of sources) {
      if (left <= 0) break;
      const take = Math.min(cap(s), left);
      if (take <= 0) continue;
      if (s.kind === "tree") s.props.barkTaken = (s.props.barkTaken ?? 0) + take;
      else s.props.fibreTaken = (s.props.fibreTaken ?? 0) + take;
      w.putEntity(s);
      left -= take;
      gathered += take;
      peeled.push(`${take} strip${take > 1 ? "s" : ""} from the ${s.name}`);
    }

    w.setActivity(`weaving a ${what}`);
    if (gathered) {
      await wait(Math.min(4000, gathered * 800));
      w.bump({ energy: -gathered });
      out.push(`You peel ${peeled.join(" and ")}. The sap is cool, the strips supple — they bend without cracking.`);
    }
    await wait(recipe.weaveMs);
    w.bump({ energy: -recipe.energy });

    const skill = skillOf(w);
    (w.me as any).weaveXp = skill + 1;
    const q = Math.max(0.05, Math.min(1, 0.22 + skill * 0.11 + rand() * 0.34));
    const tier = TIERS.find((t) => q >= t.min)!;

    if ((what === "mat" || what === "basket") && rand() < Math.max(0, 0.45 - skill * 0.08)) {
      w.bump({ mood: -3, curiosity: -2 });
      log("world", `River's attempt at a woven ${what} fell apart.`, { quality: q });
      out.push(
        `You try to hold the shape of a ${what}, but the weave keeps opening and the whole thing slumps into a heap of loose strips. ` +
          `The fibre is spent. Cord and a wrap are simpler places for these hands to start.`,
      );
      return out.join("\n\n");
    }

    const props: any = { woven: true, quality: Math.round(q * 100) / 100 };
    let name: string;
    let desc: string;
    if (what === "cord") {
      name = "coil of twisted cord";
      desc = `A coil of two-ply cord twisted from plant fibre — ${tier.note}. It lashes, ties and binds.`;
    } else if (what === "wrap") {
      name = "woven bark-and-moss wrap";
      desc = `A wrap woven from bark strips and packed with moss, tied across one shoulder. ${tier.note[0].toUpperCase() + tier.note.slice(1)}. It covers your back and chest and cuts the wind.`;
      props.worn = true;
      props.warmth = Math.round(3 + q * 7);
    } else if (what === "mat") {
      name = "woven mat";
      desc = `A flat mat of woven strips — ${tier.note}. Something to sit or sleep on, off the cold ground.`;
    } else {
      name = "woven basket";
      desc = `A round basket of woven strips — ${tier.note}. It will carry what your hands cannot.`;
    }
    w.addItem("crafted", name, desc, 1, props, { maker: true, ...(what === "basket" ? { defId: "basket" } : {}) });   // a woven basket really is one: it holds things

    w.bump({ mood: Math.round(2 + q * 8), curiosity: -4 });
    if (what === "wrap")
      out.push(`Your ${name} comes off the work ${tier.word}. You tie it around yourself — the moss is soft against your skin and the wind stops reaching you.`);
    else out.push(`You sit with the fibre across your knees and work it. The ${what} comes out ${tier.word}: ${tier.note}.`);

    if (skill === 0) {
      out.push("This is the first thing you have ever woven. Your fingers are clumsy, but they are learning.");
      log("world", "River wove something for the first time.", { what, quality: props.quality });
    } else if (q >= 0.6) out.push("Practice is telling — each pass of the weft sits where you mean it to.");
    return out.join("\n\n");
  },
};
export default weave;
