// Multi-seed soak: for each seed, generate a fresh island, run the mock brain for N simulated days at high speed with human
// commands, then replay offline and compare every checkpoint.
//   tsx scripts/soak-replay.ts [seeds=20] [days=3] [parallel=4]
//   SOAK_LIVE=1 uses the real model (12x speed; spends tokens) instead of the mock brain; the replay is offline either way.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { behaviourReport } from "../src/server/behaviour.ts";

const seeds = Number(process.argv[2] ?? 20), days = Number(process.argv[3] ?? 3), parallel = Number(process.argv[4] ?? 4);
const targetTick = days * 14_400;                          // 1,440,000 ms canonical day / 100 ms ticks
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = path.resolve(".fixtures/run/soak"); fs.mkdirSync(dir, { recursive: true });

function newDb(seed: number): string {
  const file = path.join(dir, `seed-${seed}-${Date.now()}.db`);
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", `const m = await import("./src/server/db.ts"); m.kvSet("seed", ${seed}); m.db.close();`], { env: { ...process.env, RIVER_DB: file }, stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not create database");
  return file;
}
const maxCheckpoint = (file: string) => { try { const d = new DatabaseSync(file, { readOnly: true }); const t = (d.prepare("SELECT MAX(tick) t FROM sim_checkpoints").get() as any).t as number | null; d.close(); return t ?? 0; } catch { return 0; } };

async function one(seed: number, port: number) {
  const t0 = Date.now(), file = newDb(seed);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: file, PORT: String(port), ...(process.env.SOAK_LIVE ? {} : { MOCK_LLM: "1" }) }, stdio: "ignore" });
  await sleep(5000);
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  send({ t: "sim_speed", speed: process.env.SOAK_LIVE ? 12 : 100 });   // live: the model keeps a realistic pace relative to the world
  let n = 0;
  while (maxCheckpoint(file) < targetTick && Date.now() - t0 < 30 * 60_000) {
    await sleep(3000); n++;
    if (n % 3 === 0) send({ t: "gift", name: `gift ${n}`, desc: "a gift" });
    if (n % 5 === 0) send({ t: "say", text: `hello ${n}` });
    if (n === 7) send({ t: "config_set", key: "predators", value: false });
    if (n === 12) send({ t: "config_set", key: "predators", value: true });
    if (n === 2) send({ t: "config_set", key: "autoApprove", value: "catalog" });                 // automatic approval of built-in abilities: its decisions must replay too
    if (n === 9) send({ t: "config_set", key: "autoApprove", value: "off" });
    if (n === 6) send({ t: "config_preset", id: "gentle" });                                    // parameters change as recorded commands
    if (n === 14) send({ t: "config_preset", id: "default" });
    if (n === 10) send({ t: "sim_advance", until: "minutes", amount: 20, decision: "defer" });   // and so does running the world forward: the replay steps the same ticks
    if (n === 5) send({ t: "approve", id: 1, note: "yes" });                                    // the mock brain asks for web_search early on
    if (n === 8) send({ t: "reset_river", code: process.env.RIVER_RESET_CODE ?? "2888", world: seed % 3 === 0 });   // a new life, and every third seed a new island
  }
  ws.close(); child.kill("SIGTERM"); await sleep(1500);
  const cnt = (() => { const d = new DatabaseSync(file, { readOnly: true }); const q = (t: string) => (d.prepare("SELECT COUNT(*) n FROM sim_commands WHERE type = ?").get(t) as any).n as number; const r = { resets: q("reset_apply"), approvals: q("approve") }; d.close(); return r; })();
  const recorded = maxCheckpoint(file), wall = Math.round((Date.now() - t0) / 1000);
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/replay.ts", file], { encoding: "utf8", maxBuffer: 1 << 26 });
  let out: any = {}; try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))); } catch { /* reported */ }
  const ok = r.status === 0 && out.matched === out.checkpoints && out.checkpoints > 0 && recorded >= targetTick;
  console.log(`${ok ? "PASS" : "FAIL"} seed=${String(seed).padEnd(3)} ticks=${recorded} commands=${out.commandsReplayed ?? "?"} resets=${cnt.resets} approvals=${cnt.approvals} checkpoints=${out.matched ?? "?"}/${out.checkpoints ?? "?"} network=${out.networkAttempts ?? "?"} wall=${wall}s${ok ? "" : " " + JSON.stringify(out.firstDivergence ?? r.stderr.slice(-300))}`);
  try { const d = new DatabaseSync(file, { readOnly: true }), b = behaviourReport(d); d.close(); console.log(`     behaviour seed=${seed}: ${b.activities.total} activities, ${b.activities.distinct} kinds, variety ${b.activities.variety}, loop ${b.activities.loopShare}, ${b.goals.total} desires, ${b.lives.count} lives${b.warnings.length ? ", warnings: " + b.warnings.map((x) => x.split(":")[0]).join("/") : ""}`); } catch { /* the report is extra */ }
  if (ok) for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true });
  return ok;
}

const queue = Array.from({ length: seeds }, (_, i) => i + 1);
let failed = 0;
await Promise.all(Array.from({ length: parallel }, async (_, w) => {
  for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) if (!(await one(seed, 8840 + w))) failed++;
}));
console.log(failed ? `${failed} of ${seeds} seeds FAILED` : `all ${seeds} seeds replayed exactly over ${days} simulated days`);
process.exit(failed ? 1 : 0);
