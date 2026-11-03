import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef } from "../toolkit.ts";

const FINDS = [
  { kind: "stone", name: "stone", desc: "A smooth, heavy stone.", w: 4 },
  { kind: "clay", name: "lump of clay", desc: "Cool, fine-grained clay. It holds a shape when pressed.", w: 3 },
  { kind: "root", name: "tough root", desc: "A pliable root, strong in the fibre. Good for twisting into cord.", w: 3 },
  { kind: "seed", name: "seed", desc: "A small seed. It could be planted.", w: 2 },
  { kind: "bone", name: "old bone", desc: "A small, very old bone, weathered smooth. Whose?", w: 1 },
];
const pickWeighted = () => { let r = Math.random() * FINDS.reduce((a, f) => a + f.w, 0); return FINDS.find((f) => (r -= f.w) < 0)!; };

const dig: ToolDef = {
  name: "dig",
  description: "Dig a small pit where you stand to see what lies beneath: roots, buried things, the fungal web under trees. Much better with a stick or stone as an implement; bare hands only scratch the surface.",
  input_schema: obj({ with: str("Inventory item to dig with (a stick or stone). Omit to dig by hand.") }),
  run: async (a, w) => {
    let tool = null;
    if (a.with) {
      tool = w.findItem(String(a.with));
      if (!tool) throw new ToolError("You don't have that item.");
      if (!["stick", "stone"].includes(tool.kind)) throw new ToolError(`${tool.name} isn't suited for digging. A stick or a stone is.`);
    }
    // Dig deeper in an existing pit instead of making a new one.
    let pit = w.nearby(1.8).map((o) => o.e).find((e) => e.kind === "pit");
    const depth = (pit?.props.depth ?? 0) + (tool ? 2 : 1);
    w.setActivity("digging");
    await new Promise((r) => setTimeout(r, tool ? 6000 : 9000));
    w.bump({ energy: tool ? -3 : -6 });

    if (pit) { pit.props.depth = depth; w.putEntity(pit); }
    else pit = w.spawn("pit", "small pit", w.me.x + Math.cos(w.me.heading) * 1.2, w.me.z + Math.sin(w.me.heading) * 1.2, { depth, desc: "A small pit someone dug." });

    const out: string[] = [`You dig ${tool ? `with the ${tool.name}` : "with your bare hands"}. The pit is now ${depth} spans deep.`];
    // The fungal web: only under/near trees, and only once you are past the leaf litter.
    const trees = w.nearby(7).filter(({ e }) => e.kind === "tree");
    if (trees.length && depth >= 3) {
      const t = trees[0].e;
      const other = [...w.entities.values()].filter((e) => e.kind === "tree" && e.id !== t.id)
        .map((e) => ({ e, d: Math.hypot(e.x - t.x, e.z - t.z) })).sort((x, y) => x.d - y.d)[0];
      out.push(`Below the leaf litter the soil is threaded with pale, fine filaments — mycelium. They wrap the roots of the ${t.name} (${t.id})` +
        (other ? ` and run off ${w.compass(other.e)}ward, toward the ${other.e.name} ${other.d.toFixed(0)}m away (${other.e.id}).` : "."));
      if (!pit.props.mycelium) { pit.props.mycelium = true; pit.props.desc = "A pit exposing a web of pale mycelium around tree roots."; w.putEntity(pit); log("observation", "River found the underground fungal web.", { pit: pit.id }); }
      w.bump({ curiosity: -15, mood: 8 });
    } else if (depth < 3) out.push("Just leaf litter and dark soil so far. Digging deeper would show more.");
    if (Math.random() < (tool ? 0.55 : 0.25)) {
      const f = pickWeighted();
      w.addItem(f.kind, f.name, f.desc);
      out.push(`You unearth: ${f.name}.`);
    }
    return out.join("\n");
  },
};
export default dig;
