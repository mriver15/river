// TEST_ARGS: {"text":"dawn; 6 hums; cloud low from the west; 3 strokes","with":"stick"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, wait } from "../toolkit.ts";

const CAP = 10;
const HEAD = "A damp clay tablet, scored with dated lines:";

/** Lines are stored in the item's desc so the ledger is readable by plain inspection too. */
const readLines = (it: { desc?: string }): string[] => {
  const d = String(it?.desc ?? "");
  const i = d.indexOf(HEAD);
  if (i < 0) return [];
  return d.slice(i + HEAD.length).split("\n").map((s) => s.trim()).filter(Boolean);
};

const inscribe: ToolDef = {
  name: "inscribe",
  description:
    "Write a dated line into a durable record instead of trusting memory. With a lump of clay you press a line into a carried tablet (holds 10 lines); with a stone point you cut straight into a rock or monolith within 4m (permanent, can't be carried). Needs a stick (clay only) or a stone point. Call it with no `text` to read your tablet back aloud.",
  input_schema: obj({
    text: str("The line to record; the time is stamped on automatically. Omit to read a tablet back instead."),
    with: str("Item to write with: a stick (clay only) or a stone point (clay or stone). Defaults to a stick or stone you carry."),
    on: str("'clay' for a carried tablet, 'stone' to cut into a nearby rock or monolith."),
    tablet: str("Which tablet to write in / read. Default 'clay tablet'."),
    leave: { type: "boolean", description: "Set the finished tablet down open on the ground here rather than carrying it." },
  }, []),
  run: async (a, w) => {
    const name = String(a.tablet ?? "clay tablet").trim() || "clay tablet";
    const text = String(a.text ?? "").trim();
    const mode = String(a.on ?? "").toLowerCase();

    // ---- read back ----
    if (!text) {
      const carried = w.findItem(name);
      const lying = w.nearby(4).map((o) => o.e)
        .find((e) => e.kind === "item" && String(e.props?.desc ?? "").includes(HEAD));
      const held = carried ? readLines(carried) : [];
      const onGround = lying ? readLines({ desc: String(lying.props.desc) }) : [];
      const ls = held.length ? held : onGround;
      if (!ls.length) throw new ToolError(`No "${name}" with writing on it is in your hands or within 4m. Write a line first.`);
      w.setActivity("reading back my ledger");
      w.bump({ curiosity: -2, mood: 2 });
      return `You read back ${ls.length} line${ls.length === 1 ? "" : "s"} of the ${name}:\n` + ls.map((l) => "  " + l).join("\n");
    }

    // ---- what are we writing with ----
    const stylus = a.with ? w.findItem(String(a.with)) : (w.findItem("stick") ?? w.findItem("stone"));
    if (!stylus) throw new ToolError(a.with ? `You have no "${a.with}" to write with.` : "You need something to write with: a stick for clay, or a stone point for rock.");
    if (!["stick", "stone"].includes(stylus.kind)) throw new ToolError(`${stylus.name} leaves no mark. Use a stick or a stone point.`);

    const carriedTablet = w.findItem(name);
    const clay = w.findItem("clay");
    const stoneWay = mode === "stone" || (mode !== "clay" && !carriedTablet && !clay);

    // ---- cut into stone ----
    if (stoneWay) {
      if (stylus.kind !== "stone") throw new ToolError("A stick won't scratch stone. Bring a stone point for that, or write on clay.");
      const spot = w.nearby(4).map((o) => o.e)
        .filter((e) => e.kind === "rock" || e.kind === "monolith")
        .sort((x, y) => w.dist(x) - w.dist(y))[0];
      if (!spot) throw new ToolError("No flat rock or standing stone within 4m to cut into. Make a clay tablet, or walk to one.");
      w.setActivity("cutting a line into stone");
      await wait(6500);
      w.bump({ energy: -7, curiosity: -5, mood: 3 });
      const entry = `[${w.timeLabel()}] ${text}`;
      const marks: string[] = Array.isArray(spot.props.inscriptions) ? spot.props.inscriptions : [];
      marks.push(entry);
      spot.props.inscriptions = marks;
      spot.props.desc = `${spot.props.desc ?? "An old stone."} Its face is scored with ${marks.length} cut line${marks.length === 1 ? "" : "s"}; the newest reads: "${text}".`;
      w.putEntity(spot);
      log("inscription", `River cut a line into ${spot.name}.`, { id: spot.id, text });
      return `You kneel at the ${spot.name} (${spot.id}) and cut with the ${stylus.name}, grit spraying, until the line is deep enough to survive rain. The ${spot.name} now carries ${marks.length} lines:\n`
        + marks.map((m) => "  " + m).join("\n");
    }

    // ---- press into clay ----
    let tablet = carriedTablet;
    if (!tablet) {
      if (!clay) throw new ToolError("You have no lump of clay for a tablet. Dig for clay, or cut into a rock instead (on: 'stone').");
      w.takeItem(clay.id, 1);
      w.addItem("crafted", name, HEAD, 1, { lines: [] }, { maker: true });
      tablet = w.findItem(name);
      if (!tablet) throw new ToolError("The clay crumbled before it would hold a shape. Try another lump.");
    }
    const lines = readLines(tablet);
    if (lines.length >= CAP) throw new ToolError(`"${name}" is full at ${CAP} lines. Give a new tablet a new name (tablet: "clay tablet 2") and start it with a fresh lump of clay.`);

    w.setActivity("pressing a line into the clay tablet");
    await wait(2600);
    w.bump({ energy: -2, curiosity: -4, mood: 2 });

    const entry = `[${w.timeLabel()}] ${text}`;
    const all = [...lines, entry];
    const desc = `${HEAD}\n${all.join("\n")}`;
    w.takeItem(tablet.id, 1);
    w.addItem("crafted", name, desc, 1, { lines: all }, { maker: true });

    let tail = "";
    if (a.leave) {
      const held = w.findItem(name);
      if (held) w.takeItem(held.id, 1);
      const p = w.spotNearMe(1.4);
      w.spawn("item", name, p.x, p.z, { takeable: true, desc, lines: all });
      tail = `\nYou set the ${name} down open on the ground here, face up, so it can be read without picking it up.`;
    }
    log("inscription", `River wrote a line in ${name}.`, { text });
    return `You press the ${stylus.name} into the damp clay, steadier than you feel. The ${name} now holds ${all.length}/${CAP} lines:\n`
      + all.map((l) => "  " + l).join("\n") + tail;
  },
};
export default inscribe;
