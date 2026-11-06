// TEST_ARGS: {"anchor": "rock"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, wait } from "../toolkit.ts";

const NAMES: Record<string, string[]> = {
  stick: ["stick", "sticks", "branch", "bough"],
  bark: ["bark", "strip of bark", "strips of bark", "bark strip"],
  stone: ["stone", "stones", "rock"],
  chalk: ["chalk", "lump of chalk", "chalk lump"],
};

/** First inventory stack that looks like the wanted material. */
function stack(w: any, kind: string) {
  for (const n of NAMES[kind]) {
    const it = w.findItem(n);
    if (it && it.qty > 0 && (it.kind === kind || String(it.name).toLowerCase().includes(kind))) return it;
  }
  return undefined;
}

/** Take up to `want` of a material, remembering what was taken so it can be put back. */
function grab(w: any, kind: string, want: number) {
  const taken: { kind: string; name: string; desc: string; qty: number }[] = [];
  let left = want;
  while (left > 0) {
    const it = stack(w, kind);
    if (!it) break;
    const n = Math.min(it.qty, left);
    taken.push({ kind: it.kind, name: it.name, desc: it.desc, qty: n });
    w.takeItem(it.id, n);
    left -= n;
  }
  return { got: want - left, taken };
}

function restore(w: any, taken: { kind: string; name: string; desc: string; qty: number }[]) {
  for (const t of taken) w.addItem(t.kind, t.name, t.desc, t.qty, undefined, { note: "put back" });
}

function findAnchor(w: any, q?: string) {
  const cands = w.nearby(8)
    .map((o: any) => o.e)
    .filter((e: any) => ["rock", "tree", "monolith", "structure"].includes(e.kind) && !e.props?.shelter);
  if (!cands.length) return undefined;
  if (!q) return cands[0];
  const s = q.toLowerCase();
  return cands.find((e: any) => e.id === q)
    ?? cands.find((e: any) => String(e.name).toLowerCase().includes(s))
    ?? cands.find((e: any) => e.kind === s);
}

const buildShelter: ToolDef = {
  name: "build_shelter",
  description: "Lean sticks against a rock, big tree or monolith and shingle them with bark strips to make a dry lean-to you can curl up under. Needs at least 6 sticks and 2 strips of bark in your pack, and an anchor within a few metres. Extra sticks, bark and stones make a tighter, drier roof.",
  input_schema: obj({ anchor: str("Name or id of the rock/tree/monolith to lean the roof against. Omit to use the nearest one.") }),
  run: async (a, w) => {
    if (w.me.sleeping) throw new ToolError("You're asleep. Wake up first.");
    if (w.me.needs.energy < 15) throw new ToolError("You're too worn out to wrestle a frame of sticks together. Eat or rest first.");

    const anchor = findAnchor(w, a.anchor ? String(a.anchor) : undefined);
    if (!anchor) throw new ToolError("Nothing within reach to lean a roof against. Find a rock, a big tree or a monolith first, and name it with `anchor`.");
    if (!w.inReach(anchor) && w.dist(anchor) > 6) throw new ToolError(`The ${anchor.name} is ${w.dist(anchor).toFixed(0)}m away — too far to build against. Walk closer.`);

    const existing = w.nearby(9).map((o) => o.e).find((e) => e.kind === "structure" && e.props?.shelter);
    if (existing) throw new ToolError(`A shelter already stands here (${existing.id}), ${w.dist(existing).toFixed(0)}m ${w.compass(existing)}. Building a second roof next to it would just waste your sticks — sleep in that one, or build somewhere else.`);

    const sticks = grab(w, "stick", 12);
    const bark = grab(w, "bark", 5);
    if (sticks.got < 6 || bark.got < 2) {
      restore(w, sticks.taken);
      restore(w, bark.taken);
      throw new ToolError(`You need at least 6 sticks and 2 strips of bark for a roof that holds. You only have ${sticks.got} stick(s) and ${bark.got} bark strip(s) on you.`);
    }
    const stones = grab(w, "stone", 2);
    const chalk = stack(w, "chalk");

    const q = Math.min(1, 0.3 + sticks.got * 0.04 + bark.got * 0.06 + stones.got * 0.08);

    w.setActivity("building a lean-to");
    await wait(9000 + Math.round(q * 3000));
    w.bump({ energy: -14, hunger: -3, mood: 10, curiosity: -4 });

    const dx = w.me.x - anchor.x, dz = w.me.z - anchor.z;
    const len = Math.hypot(dx, dz) || 1;
    const x = anchor.x + (dx / len) * 1.5;
    const z = anchor.z + (dz / len) * 1.5;
    const dry = q >= 0.6;
    const desc = `A lean-to of ${sticks.got} sticks braced against the ${anchor.name} and shingled with ${bark.got} strips of bark` +
      (stones.got ? `, weighted down with ${stones.got} stone(s)` : "") +
      (dry ? ". Tight enough to keep the rain off." : ". Serviceable, but the shingling is thin and rain will find gaps.");

    const sh = w.spawn("structure", "lean-to shelter", x, z, {
      shelter: true, anchor: anchor.id, quality: Number(q.toFixed(2)), dry, capacity: 1, desc,
    });
    anchor.props.shelterId = sh.id;
    w.putEntity(anchor);

    log("world", `River built a lean-to shelter against the ${anchor.name}.`, { shelter: sh.id, quality: Number(q.toFixed(2)) });

    const out = [
      `You wedge the first thick sticks into the ${anchor.name} at the angle you want to sleep at, then lean the rest against them, weaving the tips together so the frame stops rattling.`,
      `Bark strips go over the ribs like shingles, each one overlapping the one below, and the last of the light shows through fewer and fewer gaps.` +
        (stones.got ? ` You set the ${stones.got === 1 ? "stone" : "stones"} on the bark ends to stop the wind lifting them.` : ""),
    ];
    if (chalk) out.push(`You mark a chalk line across the floor at the dry edge of the roof — the side to lay your head on.`);
    out.push(dry
      ? `A lean-to stands against the ${anchor.name} (${sh.id}): low, tight and dry. Curling up under it will keep the night's damp off you.`
      : `The shelter stands (${sh.id}), though you can already feel air moving through the roof. More bark or a second layer of sticks would make it drier.`);
    return out.join("\n");
  },
};
export default buildShelter;
