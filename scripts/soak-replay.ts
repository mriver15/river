// Multi-seed soak: for each seed, generate a fresh island, run the mock brain for N simulated days at high speed with human
// commands, then replay offline and compare every checkpoint.
//   tsx scripts/soak-replay.ts [seeds=20] [days=3] [parallel=4]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";

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
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: file, PORT: String(port), MOCK_LLM: "1" }, stdio: "ignore" });
  await sleep(5000);
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  send({ t: "sim_speed", speed: 100 });
  let n = 0;
  while (maxCheckpoint(file) < targetTick && Date.now() - t0 < 20 * 60_000) {
    await sleep(3000); n++;
    if (n % 3 === 0) send({ t: "gift", name: `gift ${n}`, desc: "a gift" });
    if (n % 5 === 0) send({ t: "say", text: `hello ${n}` });
    if (n === 7) send({ t: "config_set", key: "predators", value: false });
    if (n === 12) send({ t: "config_set", key: "predators", value: true });
  }
  ws.close(); child.kill("SIGTERM"); await sleep(1500);
  const recorded = maxCheckpoint(file), wall = Math.round((Date.now() - t0) / 1000);
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/replay.ts", file], { encoding: "utf8", maxBuffer: 1 << 26 });
  let out: any = {}; try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))); } catch { /* reported */ }
  const ok = r.status === 0 && out.matched === out.checkpoints && out.checkpoints > 0 && recorded >= targetTick;
  console.log(`${ok ? "PASS" : "FAIL"} seed=${String(seed).padEnd(3)} ticks=${recorded} commands=${out.commandsReplayed ?? "?"} checkpoints=${out.matched ?? "?"}/${out.checkpoints ?? "?"} network=${out.networkAttempts ?? "?"} wall=${wall}s${ok ? "" : " " + JSON.stringify(out.firstDivergence ?? r.stderr.slice(-300))}`);
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
