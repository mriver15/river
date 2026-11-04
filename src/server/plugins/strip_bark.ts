// TEST_ARGS: {"strips":2}
import { log } from "../bus.ts";
import { ToolError, num, obj, str, type ToolDef, rand, wait } from "../toolkit.ts";

const SHARP = /knife|blade|shard|flake|axe|chisel|sharp/i;
const MAX_WOUNDS = 4; // a trunk ringed past this is girdled and dies

const stripBark: ToolDef = {
  name: "strip_bark",
  description:
    "Peel long fibres of bark off a tree you're standing at — lengthwise, never in a ring, or the tree dies. A sharp stone or blade gives long clean strips fast; bare fingers and teeth give short ragged ones and take twice as long. Each trunk can only lose so much bark before it's girdled; check how much sound bark is left.",
  input_schema: obj({
    tree: str("Tree to strip, by name or id. Defaults to the nearest tree within reach."),
    with: str("Item to cut with: a sharp stone, blade or knife. Omit to use fingers and teeth."),
    strips: num("How many strips to try for (1-3). More takes longer and costs more energy."),
  }),
  run: async (a, w) => {
    const want = Math.max(1, Math.min(3, Math.floor(Number(a.strips ?? 1)) || 1));

    // ---- pick a tree ----
    let tree;
    if (a.tree) {
      const key = String(a.tree).toLowerCase();
      const all = [...w.entities.values()];
      tree = all.find((e) => e.id === a.tree) ?? all.find((e) => e.kind === "tree" && e.name.toLowerCase().includes(key));
      if (!tree) throw new ToolError(`You can't find any tree called "${a.tree}".`);
      if (tree.kind !== "tree") throw new ToolError(`${tree.name} is a ${tree.kind}; bark needs a trunk.`);
      if (!w.inReach(tree)) throw new ToolError(`${tree.name} is ${w.dist(tree).toFixed(0)}m away, ${w.compass(tree)}. Walk over to it first.`);
    } else {
      tree = w.nearby(5).map((o) => o.e).find((e) => e.kind === "tree");
      if (!tree) throw new ToolError("No tree within reach. Find a trunk, stand beside it, and try again.");
    }

    const wounds = Number(tree.props.wounds ?? 0);
    const left = MAX_WOUNDS - wounds;
    if (left <= 0) throw new ToolError(`The ${tree.name} is already ringed with pale scars; its bark is gone and the wood is dying. Leave it and find a sound trunk.`);

    // ---- the cutting edge ----
    let tool = null;
    if (a.with) {
      tool = w.findItem(String(a.with));
      if (!tool) throw new ToolError(`You aren't carrying anything called "${a.with}".`);
      if (!w.items.canDo(tool.id, "cuts"))                        // what it can do, not what it is called
        throw new ToolError(`${tool.name} won't bite into bark. Use a sharp stone or a blade — or your hands.`);
    }

    const take = Math.min(want, left);
    w.setActivity(tool ? `stripping bark from the ${tree.name}` : `picking at the ${tree.name}'s bark`);
    await wait((tool ? 2500 : 4500) * take);
    w.bump({ energy: -(tool ? 2 : 4) * take });

    const base = tree.name.replace(/\s*(tree|sapling|trunk)$/i, "").trim() || tree.name;
    const out = [
      tool
        ? `You set the ${tool.name} to the ${tree.name} and draw it down in one long pull, lengthwise. The bark lifts away in a wet, green-white ribbon; sap beads along the cut.`
        : `You worry at the ${tree.name}'s bark with a nail, then your teeth, peeling upward in short tugs. The fibres come reluctantly, sticky with sap.`,
    ];

    let got = 0;
    for (let i = 0; i < take; i++) {
      if (!tool && rand() < 0.3) continue; // torn into a useless shred
      const long = !!tool;
      w.addItem(
        "crafted",
        long ? `long strip of ${base} bark` : `ragged strip of ${base} bark`,
        long
          ? `A palm-wide ribbon of ${base} bark, damp and green-white inside. Soaked soft and twisted against its own twist, it would twist into cord.`
          : `A short, torn ribbon of ${base} bark, ragged at the edges. Too short for rope, but the fibres are sound.`,
        1,
        { fibre: "bark", wood: base, length: long ? 60 : 25, wet: true },
        { sources: [tree.id], maker: true, note: `stripped from the ${tree.name}` }
      );
      got++;
    }

    tree.props.wounds = wounds + take;
    const girdled = tree.props.wounds >= MAX_WOUNDS;
    if (girdled) {
      tree.props.desc = `A ${base} whose trunk is cut in a pale ring of scars; the leaves above are already dulling.`;
      tree.props.dying = true;
    } else {
      tree.props.desc = `A ${base} with ${tree.props.wounds} lengthwise scarf${tree.props.wounds > 1 ? "s" : ""} where bark was peeled away.`;
    }
    w.putEntity(tree);

    out.push(got ? `You come away with ${got} strip${got > 1 ? "s" : ""} of bark.` : `Every strip you pull tears into shreds too short to use.`);
    if (girdled) {
      out.push(`You've cut the bark clean around the ${tree.name}. Nothing passes between root and leaf now — this trunk will die, and slowly.`);
      w.bump({ mood: -6 });
      log("observation", "River girdled a tree while stripping bark.", { tree: tree.id, kind: tree.kind });
    } else {
      const rest = MAX_WOUNDS - tree.props.wounds;
      out.push(`The trunk is scarred but alive; there's room for ${rest} more strip${rest > 1 ? "s" : ""} before you'd ring it.`);
    }
    return out.join("\n");
  },
};

export default stripBark;
