// Save slots from the command line. The server's own copy of "now" is the Controls pane; these work on any database file.
//   tsx scripts/slots.ts list [dir]
//   tsx scripts/slots.ts save <db> <name> [note] [--dir dir]       a named, complete copy
//   tsx scripts/slots.ts load <name> <dest.db> --force [--dir dir]  put a slot back (stop the server first)
//   tsx scripts/slots.ts delete <name> [--dir dir]
//   tsx scripts/slots.ts branch <recorded.db> <tick> <name> [--dir dir]   a new world from an earlier moment of a recorded one
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSlot, listSlots, restoreSlot, deleteSlot } from "../src/server/slots.ts";

const args = process.argv.slice(2), di = args.indexOf("--dir"), dir = path.resolve(di >= 0 ? args.splice(di, 2)[1] : "data/slots");
const force = args.includes("--force"); const [cmd, a, b, c] = args.filter((x) => x !== "--force");
const fmt = (m: ReturnType<typeof listSlots>[number]) => `${m.name.padEnd(24)} day ${String(m.day).padEnd(4)} tick ${String(m.tick).padEnd(8)} lives ${m.lives}  ${(m.bytes / 1e6).toFixed(1)} MB  ${new Date(m.savedAt).toLocaleString()}${m.branchOf ? `  (branch of ${m.branchOf} at tick ${m.branchTick})` : ""}${m.note ? `  — ${m.note}` : ""}`;

try {
  if (cmd === "list") { const l = listSlots(a ? path.resolve(a) : dir); console.log(l.length ? l.map(fmt).join("\n") : "no slots"); }
  else if (cmd === "save" && a && b) console.log(fmt(await saveSlot(a, dir, b, { note: c })));
  else if (cmd === "load" && a && b) { await restoreSlot(dir, a, b, force); console.log(`restored "${a}" to ${b}; start with RIVER_DB=${b} npm start`); }
  else if (cmd === "delete" && a) { deleteSlot(dir, a); console.log(`deleted "${a}"`); }
  else if (cmd === "branch" && a && b && c) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-slot-")), "branch.db");
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/branch.ts", a, b, tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    if (r.status !== 0) throw new Error(`could not branch: ${r.stdout.trim()}`);
    console.log(fmt(await saveSlot(tmp, dir, c, { note: `branched from ${path.basename(a)}`, branchOf: path.basename(a), branchTick: Number(b) })));
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  } else { console.error("usage: slots.ts list | save <db> <name> [note] | load <name> <dest.db> --force | delete <name> | branch <recorded.db> <tick> <name>"); process.exit(2); }
} catch (e: any) { console.error(e.message ?? e); process.exit(1); }
