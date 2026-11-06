// TEST_ARGS: {"sticks": 10, "bark": 6}
import { log } from "../bus.ts";
import { ToolError, obj, str, num, type ToolDef, wait } from "../toolkit.ts";

const MIN_STICKS = 6;   // below this there is no frame at all
const MAX_STICKS = 18;  // a one-person lean-to needs no more

const STICK_NAMES = ["stick", "sticks", "branch", "branches"];
const BARK_NAMES = ["bark", "strip of bark", "strips of bark", "bark strip", "bark strips"];

/** The only way to look at what River carries is findItem(idOrName); probe the names we know and dedupe. */
function gather(w: any, names: string[], re: RegExp): any[] {
  const out: any[] = [];
  for (const n of names) {
    const it = w.findItem(n);
    if (!it || (it.qty ?? 1) <= 0) continue;
    if (out.some((o) => o.id === it.id)) continue;
    if (re.test(String(it.kind ?? "")) || re.test(String(it.name ?? ""))) out.push(it);
  }
  return out;
}

const total = (items: any[]) => items.reduce((s, i) => s + (i.qty ?? 1), 0);

function spend(w: any, items: any[], want: number): number {
  let left = want;
  for (const it of items) {
    if (left <= 0) break;
    const q = Math.min(left, it.qty ?? 1);
    w.takeItem(it.id, q);
    left -= q;
  }
  return want - left;
}

function describe(sticks: number, bark: number, coverage: number, repaired: boolean): string {
  return `A small lean-to${repaired ? ", patched and re-braced" : ""}: ${sticks} sticks angled into a low frame${bark ? `, the back wall woven with ${bark} overlapping strips of bark` : ", its back still open to the weather"}. ` +
    `${coverage >= 70 ? "Crawl in and it is noticeably still and dim." : coverage >= 40 ? "It cuts the wind but lets the rain in at an angle." : "Skeletal so far; a strong gust would shift it."}`;
}

const build_lean_to: ToolDef = {
  name: "build_lean_to",
  description:
    "Stack and lean sticks (and bark strips, if you have them) against a tree trunk or a boulder to make a small lean-to you can crawl under — a windbreak and a rain-shed, the shelter around a hearth. Needs at least 6 sticks and a tree or rock within a few metres to brace against. Building again on an existing lean-to adds to it instead of starting over.",
  input_schema: obj({
    anchor: str("Optional id or name of the tree or rock to lean the frame against (default: the nearest one)."),
    sticks: num(`How many sticks to use (${MIN_STICKS}-${MAX_STICKS} for a new lean-to; default as many as are useful).`),
    bark: num("How many strips of bark to weave into the back wall. Default: all you can spare."),
  }),
  run: async (a, w) => {
    for (const k of ["sticks", "bark"]) {
      if (a[k] !== undefined && !Number.isFinite(Number(a[k]))) throw new ToolError(`"${k}" must be a number.`);
    }

    const stickItems = gather(w, STICK_NAMES, /stick|branch/i);
    const haveSticks = total(stickItems);
    if (haveSticks < 2) throw new ToolError("You have no sticks at all. Gather some wood first — nothing holds a frame without it.");
    const barkItems = gather(w, BARK_NAMES, /bark/i);
    const haveBark = total(barkItems);

    // Already a lean-to here? Then this is repair and thickening, not a fresh build.
    const existing = w.nearby(3.5).map((o) => o.e).find((e) => e.kind === "structure" && e.props?.leanTo) ?? null;

    let anchor: any = null;
    if (!existing) {
      const near = w.nearby(6).map((o) => o.e);
      if (a.anchor) {
        anchor = near.find((e) => e.id === String(a.anchor) || e.name === String(a.anchor)) ?? null;
        if (!anchor) throw new ToolError(`Nothing called "${a.anchor}" is within six paces to lean against.`);
        if (anchor.kind !== "tree" && anchor.kind !== "rock") throw new ToolError(`${anchor.name} is too slight to brace a frame against. A tree trunk or a boulder would hold.`);
      } else {
        anchor = near.find((e) => e.kind === "tree") ?? near.find((e) => e.kind === "rock") ?? null;
      }
      if (!anchor) throw new ToolError("There is no tree or boulder within reach — a lean-to needs something solid to lean against. Walk to one first.");
      if (haveSticks < MIN_STICKS) throw new ToolError(`You have only ${haveSticks} sticks; a frame that stays up needs at least ${MIN_STICKS}.`);
    }

    const cap = existing ? 8 : MAX_STICKS;
    const wanted = a.sticks ?? (existing ? 4 : Math.min(12, haveSticks));
    const useSticks = Math.max(existing ? 1 : MIN_STICKS, Math.min(cap, haveSticks, Math.round(Number(wanted))));
    if (!existing && useSticks < MIN_STICKS) throw new ToolError(`A frame needs at least ${MIN_STICKS} sticks; you would be using ${useSticks}.`);
    const useBark = Math.max(0, Math.min(haveBark, Math.round(Number(a.bark ?? (existing ? 3 : 8)))));

    w.setActivity(existing ? "thickening the lean-to" : "building a lean-to");
    const ms = existing ? 1500 + useSticks * 220 + useBark * 120 : 3500 + useSticks * 260 + useBark * 160;
    await wait(Math.min(13000, ms));
    w.bump({ energy: -(3 + Math.round(useSticks * 0.45 + useBark * 0.3)), mood: existing ? 3 : 7, curiosity: -3 });

    spend(w, stickItems, useSticks);
    if (useBark) spend(w, barkItems, useBark);

    const out: string[] = [];
    let shelter: any;

    if (existing) {
      const p = existing.props;
      p.sticks = (p.sticks ?? 0) + useSticks;
      p.bark = (p.bark ?? 0) + useBark;
      p.coverage = Math.min(100, (p.coverage ?? 20) + useSticks * 5 + useBark * 5);
      p.shelter = p.coverage;
      p.desc = describe(p.sticks, p.bark, p.coverage, true);
      w.putEntity(existing);
      shelter = existing;
      out.push(`You wedge ${useSticks} more stick${useSticks === 1 ? "" : "s"} into the frame${useBark ? ` and weave in ${useBark} strip${useBark === 1 ? "" : "s"} of bark` : ""}. The lean-to stiffens against your hand, less rattle in it now. Coverage: ${p.coverage}%.`);
    } else {
      const dx = w.me.x - anchor.x, dz = w.me.z - anchor.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = anchor.x + (dx / len) * 1.5, pz = anchor.z + (dz / len) * 1.5;
      const rockPair = anchor.kind === "rock" && w.nearby(7).some(({ e }) => e.kind === "rock" && e.id !== anchor.id);
      const coverage = Math.min(100, useSticks * 6 + useBark * 5 + (rockPair ? 6 : 0));
      shelter = w.spawn("structure", "lean-to", px, pz, { leanTo: true, sleepSpot: true, shelter: coverage, coverage, sticks: useSticks, bark: useBark, anchorId: anchor.id, desc: describe(useSticks, useBark, coverage, false) });
      out.push(`You drag the longest sticks up against the ${anchor.name} (${anchor.id}), butt them into the soil, and lash the cross-pieces across with bark fibre.${useBark ? ` Then you weave ${useBark} strip${useBark === 1 ? "" : "s"} of bark down the back, overlapping like scales.` : " Without bark the back stays open; wind will comb straight through."}${rockPair ? " The second boulder pins the far side — the whole thing feels solid." : ""}`);
      out.push(`Coverage ${coverage}%.${coverage >= 70 ? " Crouched inside, the wind stops at your back." : coverage >= 40 ? " It breaks the worst of the wind, not all of it." : " It is a thin thing yet — more sticks would thicken it."}`);
    }

    // A fire inside the shelter is what makes it a hearth.
    const fire = w.nearby(6).map((o) => o.e).find((e) => e.kind === "campfire");
    if (fire) {
      shelter.props.hearth = fire.id;
      w.putEntity(shelter);
      w.bump({ mood: 4 });
      out.push(`The campfire (${fire.id}) sits just inside the opening. With the wall at your back the heat will pool instead of sliding away into the dark.`);
    } else {
      out.push("No fire close by yet — until there is, this is only a break against the wind.");
    }
    out.push("You could sleep here tonight; the ground is still bare earth.");
    log("world", existing ? "River thickened the lean-to." : "River built a lean-to shelter.", { shelter: shelter.id, sticks: shelter.props.sticks, bark: shelter.props.bark, coverage: shelter.props.coverage });
    return out.join("\n");
  },
};

export default build_lean_to;
