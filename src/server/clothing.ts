// River is born bare. Clothing is something it has to want, ask for, and make from what it gathers: strips of bark and moss,
// coloured with pigments it has ground itself. What it wears keeps it warmer and shows on its body in the world.
import { bus, log } from "./bus.ts";
import { kvGet, kvSet } from "./db.ts";
import { describeColour } from "./colour.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { World } from "./world.ts";
import type { Worn } from "../shared/types.ts";
import type { ItemInstance, ItemRegistry } from "./items.ts";
import { simSleep } from "./sim.ts";
import { gate } from "./activities.ts";

type Slot = Worn["slot"];
/** what each garment is, where it goes on the body, what it takes, and how much cold it keeps off */
const GARMENTS: Record<string, { slot: Slot; need: number; warm: number }> = {
  wrap: { slot: "body", need: 3, warm: 0.18 }, cloak: { slot: "body", need: 5, warm: 0.3 }, tunic: { slot: "body", need: 5, warm: 0.26 }, skirt: { slot: "body", need: 3, warm: 0.12 },
  hat: { slot: "head", need: 2, warm: 0.1 }, band: { slot: "head", need: 1, warm: 0.02 }, sandals: { slot: "feet", need: 3, warm: 0.08 }, scarf: { slot: "neck", need: 2, warm: 0.07 },
};
const FIBRE: Record<string, { hex: string; word: string }> = { bark: { hex: "#7a6246", word: "bark" }, moss: { hex: "#5a8a46", word: "moss" }, hide: { hex: "#7a5c3e", word: "hide" } };

/** What River wears is whatever garments are in its body slots: the registry decides, not a separate list. */
let registry: ItemRegistry | null = null;
export const attachItems = (r: ItemRegistry) => { registry = r; };
const asWorn = (i: ItemInstance): Worn => ({ slot: i.props.slot, garment: i.props.garment, name: i.name, hex: i.props.hex, warm: i.props.warm * (0.5 + 0.5 * i.condition.durability) * (1 - 0.3 * i.condition.wetness), desc: `${i.name} (${describeColour(i.props.hex)} ${i.props.garment})` });
export const worn = (): Worn[] => (registry?.equipped() ?? []).filter((i) => i.kind === "garment").map(asWorn);
/** fraction of weather and night chill that clothing turns away */
export const warmthFactor = () => Math.min(0.55, worn().reduce((s, g) => s + g.warm, 0));

/** The plain fact of its body, shown every cycle. It states what is, and says nothing about what to do. */
export function bodyText(): string {
  const l = worn();
  if (!l.length) return "You have no clothes. Nothing covers you at all; your skin is bare to the air, the sun, the rain and the night.";
  const parts = l.map((g) => `${g.desc} on your ${g.slot}`);
  const bare = (["body", "head", "feet"] as Slot[]).filter((s) => !l.some((g) => g.slot === s));
  return `You are wearing ${parts.join("; ")}.${bare.length ? ` Your ${bare.join(" and ")} ${bare.length > 1 || bare[0] === "feet" ? "are" : "is"} bare.` : ""}`;
}

export const CLOTHE_TOOL: ToolDef = {
  name: "clothe",
  description:
    "Make things to wear, and wear them. `make`: sew a garment (wrap, cloak, tunic, skirt, hat, band, sandals or scarf) from bark, moss and hide you are carrying; say how many of each in `materials`. " +
    "`wear`: put on a garment you are carrying. `take_off`: take off something you are wearing. Garments keep out the cold and wet, and others can see them. " +
    "With a pigment you hold you can colour a garment (`colour`); without, it shows the colour of what it is made of. You decide what to make, how it looks and what you like to wear.",
  input_schema: obj({
    action: { type: "string", enum: ["make", "wear", "take_off"], description: "make, wear or take_off" },
    garment: { type: "string", enum: Object.keys(GARMENTS), description: "make: what kind of garment" },
    name: str("make: your own name for it. wear / take_off: the garment's name"),
    materials: { type: "object", description: "make: how many of each, e.g. {\"bark\": 4, \"moss\": 1}", additionalProperties: { type: "number" } },
    colour: str("make: a pigment you hold, to dye it"),
  }, ["action"]),
  run: async (a, w: World) => {
    const act = String(a.action ?? "");
    if (act === "make") {
      const spec = GARMENTS[String(a.garment ?? "")];
      if (!spec) throw new ToolError(`Choose what to make: ${Object.keys(GARMENTS).join(", ")}.`);
      const have = [...w.inventory.values()].filter((i) => FIBRE[i.kind]);
      const holding = have.length ? have.map((i) => `${i.name}×${i.qty}`).join(", ") : "nothing you could sew with";
      const want: Record<string, number> = a.materials ?? {};
      if (!Object.keys(want).length) throw new ToolError(`A ${a.garment} takes about ${spec.need} pieces of bark, moss or hide. You are carrying ${holding}. Say what to use in \`materials\`.`);
      const used: { it: NonNullable<ReturnType<World["findItem"]>>; n: number }[] = []; let total = 0;
      for (const [ref, nRaw] of Object.entries(want)) {
        const n = Math.max(1, Math.round(Number(nRaw))), it = w.findItem(ref);
        if (!it) throw new ToolError(`You aren't carrying anything called "${ref}". You have ${holding}.`);
        if (!FIBRE[it.kind]) throw new ToolError(`${it.name} can't be sewn into clothing. Bark, hide and moss can.`);
        if (it.qty < n) throw new ToolError(`You only have ${it.qty} ${it.name}.`);
        used.push({ it, n }); total += n;
      }
      if (total < spec.need) throw new ToolError(`A ${a.garment} needs about ${spec.need} pieces; you offered ${total}.`);
      if (total > Math.ceil(spec.need * 1.5)) throw new ToolError(`That's more than a ${a.garment} could use (${total}). About ${spec.need} will do.`);
      let hex = FIBRE[used.sort((x, y) => y.n - x.n)[0].it.kind].hex, dyed = "";
      let dye: ReturnType<typeof w.findItem>;
      if (a.colour) {
        dye = w.findItem(String(a.colour));
        if (!dye || dye.kind !== "pigment" || !dye.props?.hex) throw new ToolError(`You aren't holding a pigment called "${a.colour}".`);
        hex = dye.props.hex; dyed = ` dyed ${dye.name.replace(/ pigment \(.*\)$/, "")}`;
      }
      gate(w, 3500, `sewing a ${a.garment}`);
      const made = [...used.map((u) => u.it.id), ...(dye ? [dye.id] : [])];           // what it is made of, recorded before it is spent
      if (dye) w.takeItem(dye.id, 1);                              // the dye is spent with the rest, once the work is done
      for (const u of used) w.takeItem(u.it.id, u.n);
      const name = String(a.name ?? "").trim().slice(0, 40) || `${describeColour(hex)} ${a.garment}`;
      const mats = used.map((u) => FIBRE[u.it.kind].word);
      w.addItem("garment", name, `A ${a.garment}${dyed} (${describeColour(hex)}), sewn from ${[...new Set(mats)].join(" and ")}. It goes on your ${spec.slot}.`, 1, { garment: a.garment, slot: spec.slot, hex, warm: spec.warm }, { sources: made, maker: true });
      w.bump({ mood: 6, curiosity: -4, energy: -3 });
      bus.emit("made", { name, tags: [String(a.garment), "clothing", ...mats, describeColour(hex)], kind: "garment" });
      log("world", `River made ${name}.`, { perceived: true });
      return `You work the ${[...new Set(mats)].join(" and ")} until it holds together. You have made "${name}": ${describeColour(hex)}, for your ${spec.slot}. You are carrying it; \`wear\` it when you like.`;
    }
    if (act === "wear") {
      const it = w.findItem(String(a.name ?? ""));
      if (!it || it.kind !== "garment") throw new ToolError(`You aren't carrying a garment called "${a.name}".`);
      const slot = it.props!.slot as Slot, old = worn().find((g) => g.slot === slot);
      w.items.equip(it.id, slot);                              // the same garment, now on the body; what was there goes back to the pack
      w.bump({ mood: 3 });
      return `You put on ${it.name}.${old ? ` ${old.name} goes back in your pack.` : ""} ${bodyText()}`;
    }
    if (act === "take_off") {
      const cur = worn(), ref = String(a.name ?? "").toLowerCase(), g = cur.find((x) => x.name.toLowerCase().includes(ref) || x.slot === ref);
      if (!g) throw new ToolError(cur.length ? `You are wearing ${cur.map((x) => x.name).join(", ")}.` : "You have nothing on.");
      w.items.unequip((i) => i.kind === "garment" && i.name === g.name && i.props.slot === g.slot);
      return `You take off ${g.name} and carry it. ${bodyText()}`;
    }
    throw new ToolError("Use make, wear or take_off.");
  },
};
