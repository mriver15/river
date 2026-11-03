// TEST_ARGS: {"mark":"sleep here, dry ground","on":"pine","toward":"campfire"}
import { log } from "../bus.ts";
import { ToolError, obj, str, type ToolDef, wait } from "../toolkit.ts";

const DRAWABLE = new Set(["rock", "monolith", "structure", "tree", "item", "book"]);
const CAP: Record<string, number> = { tree: 3, rock: 4, monolith: 4, structure: 3, item: 2, book: 2 };
const CHALK_NAMES = ["chalk", "lump of chalk", "piece of chalk", "chalk lump", "chalk stub", "white chalk"];

const isChalk = (it: any) => /chalk/i.test(String(it.kind)) || /chalk/i.test(String(it.name));

function findChalk(w: any, hint?: string) {
  if (hint) {
    const it = w.findItem(String(hint).trim());
    if (!it) throw new ToolError(`You aren't carrying anything called "${hint}".`);
    return it;
  }
  for (const n of CHALK_NAMES) {
    const it = w.findItem(n);
    if (it && isChalk(it)) return it;
  }
  return undefined;
}

function matches(e: any, q: string) {
  const k = q.toLowerCase().trim();
  return e.id.toLowerCase() === k || e.name.toLowerCase() === k || e.name.toLowerCase().includes(k);
}

const draw: ToolDef = {
  name: "draw",
  description:
    "Mark the world with chalk: a word, an arrow, a sign, a small picture, on stone, bark or something built. Uses up one piece of chalk per mark. Pass `toward` and the mark also records the bearing and distance to that place, so it reads back as a real map. Marks stay on the surface and show up when you inspect it.",
  input_schema: obj(
    {
      mark: str("What to draw: a word or two, or a simple shape (arrow, X, flower). Under ~80 characters."),
      on: str("Id or name of the nearby rock, tree, structure, book or loose item to draw on. Defaults to the nearest suitable surface in reach."),
      with: str("The chalk you draw with, if it's carried under an unusual name. Defaults to any chalk you hold."),
      toward: str("Optional: id or name of a place or thing to point at — its bearing and distance get chalked in beside the mark."),
    },
    ["mark"],
  ),

  run: async (a, w) => {
    if (w.me.sleeping) throw new ToolError("You're asleep. Wake up before you go looking for a place to write.");

    const text = String(a.mark ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new ToolError("Say what to draw — a word, an arrow, a shape. (mark: \"...\")");
    if (text.length > 80) throw new ToolError("Too much to fit legibly on a rock. Cut it down to a word or two, or a simple shape.");

    const chalk = findChalk(w, a.with);
    if (!chalk) throw new ToolError("You have nothing that marks. Break a piece off the chalk outcrop first, or pass with: <item name> if you carry chalk under another name.");
    if (!isChalk(chalk)) throw new ToolError(`${chalk.name} won't leave a mark — you need chalk.`);

    // Pick the surface: named, or the nearest thing you could write on.
    const near = w.nearby(5.5).map((o) => o.e);
    let target: any;
    if (a.on) {
      const q = String(a.on).trim();
      target = near.find((e) => matches(e, q));
      if (!target) {
        const far = [...w.entities.values()].find((e) => matches(e, q));
        if (far) throw new ToolError(`The ${far.name} is ${w.dist(far).toFixed(0)}m away — go and stand beside it.`);
        throw new ToolError(`Nothing called "${q}" is within reach.`);
      }
    } else {
      target = near.find((e) => DRAWABLE.has(e.kind));
      if (!target) throw new ToolError("No stone, bark or made thing within arm's reach. Find a rock, a tree, a post or a wall.");
    }
    if (!DRAWABLE.has(target.kind)) throw new ToolError(`Chalk won't hold on a ${target.name}. Only stone, bark or things people have made.`);
    if (!w.inReach(target)) throw new ToolError(`You'd have to step closer to the ${target.name} to reach it.`);

    // Optional bearing, chalked in beside the mark.
    let note = "";
    if (a.toward) {
      const q = String(a.toward).trim();
      const t = [...w.entities.values()].find((e) => matches(e, q));
      if (!t) throw new ToolError(`There's nothing called "${q}" out there to point at.`);
      if (t.id === target.id) throw new ToolError("You can't point a mark at the very thing you're drawing it on.");
      note = `${w.compass(t)} ${w.dist(t).toFixed(0)}m to the ${t.name}`;
    }

    const marks: any[] = Array.isArray(target.props.marks) ? target.props.marks.slice() : [];
    const cap = CAP[target.kind] ?? 3;
    const same = marks.findIndex((m) => String(m.text).toLowerCase() === text.toLowerCase());
    if (same >= 0) {
      marks[same] = { text, note, t: w.timeLabel(), by: "River" };
    } else {
      if (marks.length >= cap) throw new ToolError(`This ${target.name} already carries ${marks.length} marks — no clean space left. Draw somewhere else, or repeat an existing mark's words to write over it.`);
      marks.push({ text, note, t: w.timeLabel(), by: "River" });
    }

    const surface =
      target.kind === "tree" ? `the bark of the ${target.name}`
      : target.kind === "rock" || target.kind === "monolith" ? `the face of the ${target.name}`
      : `the ${target.name}`;

    w.setActivity(`drawing on the ${target.name}`);
    await wait(2500);

    const left = (Number(chalk.qty) || 1) - 1;
    w.takeItem(chalk.id, 1);
    w.bump({ energy: -2, mood: 4, curiosity: -3 });

    if (target.props.baseDesc === undefined) target.props.baseDesc = String(target.props.desc ?? "");
    target.props.marks = marks;
    const base = String(target.props.baseDesc);
    target.props.desc = `${base}${base ? " " : ""}Chalk marks here: ${marks.map((m) => `"${m.text}"${m.note ? ` (${m.note})` : ""}, ${m.t}`).join("; ")}.`;
    w.putEntity(target);

    log("world", `River chalked "${text}" onto the ${target.name}.`, { target: target.id, mark: text, note });

    return [
      `You wet the chalk on your tongue and work it across ${surface}. The white line comes out truer than you expected: "${text}"${note ? ` — ${note}` : ""}.`,
      `It will still be there after this cycle has worn out of you.`,
      left > 0
        ? `Your ${chalk.name} is worn down but still good — ${left} more in hand.`
        : `The last of the ${chalk.name} crumbles off your fingers. You'll need another piece from the outcrop before the next mark.`,
    ].join("\n");
  },
};

export default draw;
