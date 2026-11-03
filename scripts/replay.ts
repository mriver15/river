// Replay a recorded life offline and verify it. Usage:
//   tsx scripts/replay.ts <recorded.db> [snapshotTick]
// Restores the boot snapshot recorded in <recorded.db>, reruns its command journal at the recorded ticks through the same
// runtime, and compares every checkpoint hash. Makes no network calls (fetch is blocked) and never writes to <recorded.db>.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [recordedArg, snapArg] = process.argv.slice(2);
if (!recordedArg) { console.error("usage: replay.ts <recorded.db> [snapshotTick]"); process.exit(2); }
const recorded = path.resolve(recordedArg);

const src = new DatabaseSync(recorded, { readOnly: true });
const snap = (snapArg
  ? src.prepare("SELECT * FROM sim_snapshots WHERE tick = ?").get(Number(snapArg))
  : src.prepare("SELECT * FROM sim_snapshots ORDER BY tick DESC LIMIT 1").get()) as { tick: number; file: string; hash: string } | undefined;
if (!snap) throw new Error("no boot snapshot recorded in that database");
const file = fs.existsSync(snap.file) ? snap.file : path.join(path.dirname(recorded), "snapshots", path.basename(snap.file));
if (!fs.existsSync(file)) throw new Error(`snapshot file missing: ${snap.file}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-replay-"));
const work = path.join(dir, "replay.db");
fs.copyFileSync(file, work);
Object.assign(process.env, { RIVER_DB: work, MOCK_LLM: "1", EMBED_DISABLED: "1" });   // scripted stand-ins for generated prose; offline
let netCalls = 0;
globalThis.fetch = (() => { netCalls++; throw new Error("network is disabled during replay"); }) as typeof fetch;

const sim = await import("../src/server/sim.ts");
const { createRuntime, startSystems, humanCommand } = await import("../src/server/runtime.ts");
const { commandsFrom, setRecording, setReplaying } = await import("../src/server/recorder.ts");
const { applyDream } = await import("../src/server/dreams.ts");
setRecording(false); setReplaying(true);

const cmds = commandsFrom(src as any, snap.tick);
const liveCps = new Map((src.prepare("SELECT tick, hash, parts FROM sim_checkpoints WHERE tick > ? ORDER BY tick").all(snap.tick) as any[]).map((r) => [r.tick as number, r]));
const endTick = Math.max(0, ...liveCps.keys());

const rt = await createRuntime();
startSystems(rt);
sim.setSimPaused(false);
const drain = () => new Promise<void>((r) => setImmediate(r));
const pending: Promise<unknown>[] = [];
const apply = (c: (typeof cmds)[number]) => {
  if (c.type === "tool" && c.source === "brain") pending.push(rt.agent.exec(c.payload.name, c.payload.input));
  else if (c.source === "external" && c.type === "relevance") rt.emotions.resolveRelevance(c.payload);
  else if (c.source === "external" && c.type === "dream") applyDream(rt.world, c.payload, () => {}, { feelings: () => rt.emotions.describe(), after: () => rt.emotions.afterDream() });
  else if (c.source === "brain") rt.agent.applyBrain(c.payload);
  else if (c.source === "human") humanCommand(rt, c.payload);
};

if (sim.simTick() !== snap.tick) throw new Error(`restored tick ${sim.simTick()} != snapshot tick ${snap.tick}`);
let ci = 0;
while (sim.simTick() < endTick) {
  while (ci < cmds.length && cmds[ci]!.tick <= sim.simTick()) { apply(cmds[ci++]!); await drain(); }   // one at a time: live ran them in sequence
  sim.runTicks(1);
  await drain();
}
await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 2000))]);

const mine = new DatabaseSync(work, { readOnly: true });
const replayCps = new Map((mine.prepare("SELECT tick, hash, parts FROM sim_checkpoints WHERE tick > ? ORDER BY tick").all(snap.tick) as any[]).map((r) => [r.tick as number, r]));
let matched = 0, firstBad: { tick: number; parts: string[] } | null = null;
for (const [tick, live] of liveCps) {
  const mineRow = replayCps.get(tick);
  if (mineRow && mineRow.hash === live.hash) { matched++; continue; }
  if (!firstBad) { const a = JSON.parse(live.parts), b = mineRow ? JSON.parse(mineRow.parts) : {}; firstBad = { tick, parts: Object.keys(a).filter((k) => k[0] !== "_" && a[k] !== b[k]), liveMe: a._me && JSON.parse(a._me), replayMe: b._me && JSON.parse(b._me) } as any; }
}
const dump = process.env.REPLAY_DUMP; if (dump) fs.writeFileSync(dump, JSON.stringify([...replayCps.values()].map((r) => ({ tick: r.tick, hash: r.hash, parts: JSON.parse(r.parts) })), null, 1));
console.log(JSON.stringify({ snapshotTick: snap.tick, endTick, commandsReplayed: ci, checkpoints: liveCps.size, matched, networkAttempts: netCalls, firstDivergence: firstBad }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(firstBad || netCalls ? 1 : 0);
