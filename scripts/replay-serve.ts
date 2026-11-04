// Watch a recorded life: the same world, run from its boot snapshot through its command journal, shown in the normal client.
//   tsx scripts/replay-serve.ts <recorded.db> [snapshotTick] [port=8790]
// Read-only: nothing the client sends changes anything, no model or network is used, and the recording is never written to. The page
// shows how far it has got and whether every checkpoint so far matched what was recorded.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [recordedArg, snapArg, portArg] = process.argv.slice(2);
if (!recordedArg) { console.error("usage: replay-serve.ts <recorded.db> [snapshotTick] [port]"); process.exit(2); }
const recorded = path.resolve(recordedArg);
const src = new DatabaseSync(recorded, { readOnly: true });
const snap = (snapArg ? src.prepare("SELECT * FROM sim_snapshots WHERE tick = ?").get(Number(snapArg)) : src.prepare("SELECT * FROM sim_snapshots ORDER BY tick DESC LIMIT 1").get()) as { tick: number; file: string } | undefined;
if (!snap) throw new Error("no boot snapshot recorded in that database");
const file = fs.existsSync(snap.file) ? snap.file : path.join(path.dirname(recorded), "snapshots", path.basename(snap.file));
if (!fs.existsSync(file)) throw new Error(`snapshot file missing: ${snap.file}`);
src.close();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-replay-serve-"));
const work = path.join(dir, "replay.db");
fs.copyFileSync(file, work);
Object.assign(process.env, { RIVER_DB: work, MOCK_LLM: "1", EMBED_DISABLED: "1", PORT: portArg ?? "8790", RIVER_REPLAY: JSON.stringify({ recorded, snapTick: snap.tick }) });
globalThis.fetch = (() => { throw new Error("network is disabled during replay"); }) as typeof fetch;
await import("../src/server/index.ts");
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
