// Tending a wound is something River has to learn and be given. Bleeding stops faster when it is bound; an open wound left
// dirty turns hot and foul; a twisted joint heals sooner in a splint. None of it is explained to River beyond what the tool says.
import { bodyApi } from "./body.ts";
import { isLand } from "../shared/noise.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { World } from "./world.ts";
import { simSleep } from "./sim.ts";
import { gate } from "./activities.ts";

export const TEND_TOOL: ToolDef = {
  name: "tend",
  description:
    "Look after your injuries. `examine`: study your wounds closely. `clean`: wash open wounds in the sea water (you must stand at the water's edge). " +
    "`bandage`: bind wounds with moss, bark or hide (`with`); moss is clean and soothing. It slows bleeding a great deal. `splint`: bind a sprained joint with two sticks and a strip of bark or hide. " +
    "A wound that is left open and dirty can turn foul.",
  input_schema: obj({ action: { type: "string", enum: ["examine", "clean", "bandage", "splint"], description: "what to do" }, with: str("bandage: moss, bark or hide to bind with") }, ["action"]),
  run: async (a, w: World) => {
    const act = String(a.action ?? ""), list = bodyApi.wounds();
    if (act === "examine") {
      if (!list.length) return "You look yourself over. There is nothing wrong that you can find.";
      return "You look yourself over:\n" + list.map((x) => `- ${x.text}${x.bleeding ? ", still bleeding" : ""}${x.open ? (x.dressed ? ", bound" : x.cleaned ? ", clean" : ", open and dirty") : ""}`).join("\n");
    }
    if (act === "clean") {
      const me = w.me, edge = [[2, 0], [-2, 0], [0, 2], [0, -2], [1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]].some(([dx, dz]) => !isLand(me.x + dx, me.z + dz, w.seed));
      if (!edge) throw new ToolError("You need water to wash a wound. The sea's edge is the nearest you know.");
      if (!list.some((x) => x.open && !x.cleaned)) throw new ToolError("There's no dirty open wound to wash.");
      gate(w, 4000, "washing a wound");
      const n = bodyApi.cleanWounds(); w.bump({ mood: -2, energy: -2 });
      return `You kneel and flush ${n} wound${n > 1 ? "s" : ""} with cold salt water. It stings fiercely, and then it is clean.`;
    }
    if (act === "bandage") {
      const mat = a.with ? w.findItem(String(a.with)) : [...w.inventory.values()].find((i) => ["moss", "hide", "bark"].includes(i.kind));
      if (!mat || !["moss", "bark", "hide"].includes(mat.kind)) throw new ToolError("You need moss, bark or hide to bind with.");
      const open = list.filter((x) => x.open && !x.dressed);
      if (!open.length) throw new ToolError("There is no open wound left to bind.");
      const n = Math.min(open.length, mat.qty, 3);
      gate(w, 4000, "binding wounds"); w.takeItem(mat.id, n);
      const k = bodyApi.dress(n, mat.kind === "moss"); w.bump({ mood: 3 });
      return `You press the ${mat.name} to ${k} wound${k > 1 ? "s" : ""} and bind ${k > 1 ? "them" : "it"} tight. The bleeding slows.`;
    }
    if (act === "splint") {
      if (!list.some((x) => x.kind === "sprain")) throw new ToolError("There is no twisted joint to splint.");
      const sticks = w.findItem("stick"), bind = [...w.inventory.values()].find((i) => i.kind === "bark" || i.kind === "hide");
      if (!sticks || sticks.qty < 2 || !bind) throw new ToolError("A splint takes two sticks and a strip of bark or hide to bind them.");
      gate(w, 4000, "binding a splint"); w.takeItem(sticks.id, 2); w.takeItem(bind.id, 1);
      bodyApi.splint(); return "You lay a stick either side of the joint and bind them. It aches, but it holds.";
    }
    throw new ToolError("Use examine, clean, bandage or splint.");
  },
};
