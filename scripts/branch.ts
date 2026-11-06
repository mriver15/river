// Branch a recorded world at an earlier moment: restore the boot snapshot, replay the recorded commands up to the tick, and write the result as a new database
// that can be started on its own (RIVER_DB=<out> npm start) and goes its own way from there. The original is only read.
//   tsx scripts/branch.ts <recorded.db> <tick> <out.db>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [recordedArg, tickArg, outArg] = process.argv.slice(2), at = Number(tickArg);
if (!recordedArg || !outArg || !Number.isFinite(at)) { console.error("usage: branch.ts <recorded.db> <tick> <out.db>"); process.exit(2); }
const recorded = path.resolve(recordedArg), out = path.resolve(outArg);
if (fs.existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(1); }

const src = new DatabaseSync(recorded, { readOnly: true });
const snap = src.prepare("SELECT * FROM sim_snapshots WHERE tick <= ? ORDER BY tick DESC LIMIT 1").get(at) as { tick: number; file: string } | undefined;
if (!snap) throw new Error(`no boot snapshot at or before tick ${at}`);
const file = fs.existsSync(snap.file) ? snap.file : path.join(path.dirname(recorded), "snapshots", path.basename(snap.file));
if (!fs.existsSync(file)) throw new Error(`snapshot file missing: ${snap.file}`);
const last = (src.prepare("SELECT MAX(tick) t FROM sim_checkpoints").get() as { t: number | null }).t ?? 0;
if (at > last) throw new Error(`the recording only reaches tick ${last}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-branch-")), work = path.join(dir, "branch.db");
fs.copyFileSync(file, work);
Object.assign(process.env, { RIVER_DB: work, MOCK_LLM: "1", EMBED_DISABLED: "1" });
globalThis.fetch = (() => { throw new Error("network is disabled while branching"); }) as typeof fetch;

const sim = await import("../src/server/sim.ts");
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { ReplayDriver } = await import("../src/server/replay-driver.ts");
const { commandsFrom, setRecording, setReplaying } = await import("../src/server/recorder.ts");
setRecording(false); setReplaying(true);
const cmds = commandsFrom(src as any, snap.tick).filter((c: any) => c.tick <= at);
const rt = await createRuntime(); startSystems(rt); sim.setSimPaused(false);
const driver = new ReplayDriver(rt, cmds, at);
while (await driver.step());
await driver.settle();
sim.save();                                              // the clock row is written at commits; write it as it stands now

// prove it is the same world: the last checkpoint at or before the tick must equal the recording's
const cp = src.prepare("SELECT tick, hash FROM sim_checkpoints WHERE tick <= ? ORDER BY tick DESC LIMIT 1").get(at) as { tick: number; hash: string } | undefined;
const mine = new DatabaseSync(work, { readOnly: true });
const mc = cp && (mine.prepare("SELECT hash FROM sim_checkpoints WHERE tick = ?").get(cp.tick) as { hash: string } | undefined);
mine.close();
const ok = !cp || (!!mc && mc.hash === cp.hash);
if (ok) {
  const { DatabaseSync: D } = await import("node:sqlite");
  const w = new D(work); w.exec("PRAGMA wal_checkpoint(TRUNCATE)"); fs.mkdirSync(path.dirname(out), { recursive: true }); w.prepare("VACUUM INTO ?").run(out); w.close();
  const o = new D(out); o.prepare("DELETE FROM sim_snapshots").run(); o.prepare("DELETE FROM sim_checkpoints").run(); o.prepare("DELETE FROM sim_commands").run(); o.close();   // a branch starts its own recording
}
console.log(JSON.stringify({ branchedAt: at, from: snap.tick, commandsReplayed: driver.ci, checkpointChecked: cp?.tick ?? null, identical: ok, out: ok ? out : null }));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
