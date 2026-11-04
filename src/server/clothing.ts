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
import { recipeById, GARMENT_SPECS } from "../content/recipes.ts";
import { checkRecipe, craftNow } from "./crafting.ts";

type Slot = Worn["slot"];
/** what each garment is, where it goes on the body, what it takes, and how much cold it keeps off */
const GARMENTS = GARMENT_SPECS as Record<string, { slot: Slot; need: number; warm: number }>;
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
      const recipe = recipeById(`sew_${a.garment}`)!;
      const have = w.items.carried().filter((i) => w.items.canDo(i.id, "fibre"));
      const holding = have.length ? have.map((i) => `${i.name}×${i.qty}`).join(", ") : "nothing you could sew with";
      const want: Record<string, number> = a.materials ?? {};
      if (!Object.keys(want).length) throw new ToolError(`A ${a.garment} takes about ${spec.need} pieces of bark, moss or hide. You are carrying ${holding}. Say what to use in \`materials\`.`);
      const only: string[] = []; let total = 0;
      for (const [ref, nRaw] of Object.entries(want)) {
        const n = Math.max(1, Math.round(Number(nRaw))), it = w.findItem(ref);
        if (!it) throw new ToolError(`You aren't carrying anything called "${ref}". You have ${holding}.`);
        if (!w.items.canDo(it.id, "fibre")) throw new ToolError(`${it.name} can't be sewn into clothing. Bark, hide and moss can.`);
        if (it.qty < n) throw new ToolError(`You only have ${it.qty} ${it.name}.`);
        only.push(it.id); total += n;
      }
      if (total < spec.need) throw new ToolError(`A ${a.garment} needs about ${spec.need} pieces; you offered ${total}.`);
      if (total > Math.ceil(spec.need * 1.5)) throw new ToolError(`That's more than a ${a.garment} could use (${total}). About ${spec.need} will do.`);
      let dye: ReturnType<typeof w.findItem>;
      if (a.colour) {
        dye = w.findItem(String(a.colour));
        if (!dye || dye.kind !== "pigment" || !dye.props?.hex) throw new ToolError(`You aren't holding a pigment called "${a.colour}".`);
      }
      checkRecipe(w, recipe, only, only);                          // everything checked, nothing touched
      gate(w, recipe.durationMs, `sewing a ${a.garment}`);
      // the recipe uses exactly the pieces a garment takes, from what River offered; the dye is spent with them, once the work is done
      const made = craftNow(w, recipe, only, { only });
      let hex = made.item.props.hex as string, dyed = "";
      if (dye) { hex = dye.props!.hex; dyed = ` dyed ${dye.name.replace(/ pigment \(.*\)$/, "")}`; w.takeItem(dye.id, 1); }
      const mats = [...new Set(made.used.map((u) => (/moss/i.test(u.name) ? "moss" : /hide/i.test(u.name) ? "hide" : "bark")))];
      const name = String(a.name ?? "").trim().slice(0, 40) || `${describeColour(hex)} ${a.garment}`;
      w.items.rename(made.item.id, name);
      w.items.patch(made.item.id, { props: { hex }, desc: `A ${a.garment}${dyed} (${describeColour(hex)}), sewn from ${mats.join(" and ")}. It goes on your ${spec.slot}.`, sources: dye ? [dye.id] : [] });
      w.bump({ mood: 6, curiosity: -4 });
      bus.emit("made", { name, tags: [String(a.garment), "clothing", ...mats, describeColour(hex)], kind: "garment" });
      log("world", `River made ${name}.`, { perceived: true });
      return `You work the ${mats.join(" and ")} until it holds together. You have made "${name}": ${describeColour(hex)}, for your ${spec.slot}. You are carrying it; \`wear\` it when you like.${total > spec.need ? ` (It took ${spec.need} pieces; the rest you keep.)` : ""}`;
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
