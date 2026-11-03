// Child process: run a staged plugin once in a throwaway world (RIVER_DB points at a temp db).
// usage: tsx smoke.ts <plugin file> '<args json>'
import { pathToFileURL } from "node:url";
const [file, argsJson] = process.argv.slice(2);
const { World } = await import("./world.ts");
const { ToolError } = await import("./toolkit.ts");

const w = new World(); w.init();
for (const [kind, name] of [["stick", "stick"], ["stone", "stone"], ["seed", "seed"], ["berry", "wild berry"], ["flower", "blue starflower"], ["mushroom", "brown mushroom"]])
  w.addItem(kind, name, `A ${name}.`, 3);
const tree = [...w.entities.values()].find((e) => e.kind === "tree")!;
w.me.x = tree.x + 1.5; w.me.z = tree.z;

try {
  const tool = (await import(pathToFileURL(file).href)).default;
  const out = await tool.run(JSON.parse(argsJson || "{}"), w);
  if (typeof out !== "string" || !out.trim()) throw new Error("run() must return a non-empty string");
  console.log("RESULT " + JSON.stringify({ ok: true, out }));
} catch (e: any) {
  if (e instanceof ToolError) console.log("RESULT " + JSON.stringify({ ok: true, out: `(ToolError, handled) ${e.message}` }));
  else console.log("RESULT " + JSON.stringify({ ok: false, out: String(e?.stack ?? e).slice(0, 800) }));
}
process.exit(0);
