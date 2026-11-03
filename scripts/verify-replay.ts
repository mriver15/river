// Record a mock-brain run of a fixture (with human commands), then replay it offline and compare every checkpoint.
//   tsx scripts/verify-replay.ts [seconds=45] [fixture ...]     default fixtures: all
// VERIFY_LIVE=1 records with the real model instead of the mock brain (spends tokens); the replay is always offline.
// Exits nonzero if any fixture diverges. Uses .fixtures/ copies only; needs `npm run fixtures` first.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";

const secs = Number(process.argv[2] ?? 45);
const names = process.argv.slice(3).length ? process.argv.slice(3) : ["new-life", "injury", "fire", "crafting", "animals", "grants"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runDir = path.resolve(".fixtures/run");
fs.mkdirSync(runDir, { recursive: true });

async function record(name: string, port: number): Promise<string> {
  const src = path.resolve(`.fixtures/${name}.db`);
  if (!fs.existsSync(src)) throw new Error(`missing ${src}; run npm run fixtures`);
  const db = path.join(runDir, `verify-${name}-${Date.now()}.db`);
  fs.copyFileSync(src, db);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: db, PORT: String(port), ...(process.env.VERIFY_LIVE ? {} : { MOCK_LLM: "1" }) }, stdio: "ignore" });
  await sleep(4000);
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  const send = (m: object) => ws.send(JSON.stringify(m));
  send({ t: "config_set", key: "dayMinutes", value: 2.4 });                  // 10x, so a short run covers many checkpoints
  await sleep(secs * 250); send({ t: "gift", name: "polished pebble", desc: "A smooth grey pebble." });
  await sleep(secs * 250); send({ t: "say", text: "hello river" });
  await sleep(secs * 250); send({ t: "skip_day" });
  await sleep(secs * 250);
  ws.close(); child.kill("SIGTERM"); await sleep(1500);
  return db;
}

let failed = 0;
for (const [i, name] of names.entries()) {
  const db = await record(name, 8810 + i);
  const n = new DatabaseSync(db, { readOnly: true }).prepare("SELECT (SELECT COUNT(*) FROM sim_commands) c, (SELECT COUNT(*) FROM sim_checkpoints) k").get() as { c: number; k: number };
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/replay.ts", db], { encoding: "utf8" });
  const json = r.stdout.slice(r.stdout.indexOf("{"));
  let out: any = {}; try { out = JSON.parse(json); } catch { /* reported below */ }
  const ok = r.status === 0 && out.matched === out.checkpoints && out.checkpoints > 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name.padEnd(9)} commands=${n.c} checkpoints=${out.matched ?? "?"}/${out.checkpoints ?? n.k} network=${out.networkAttempts ?? "?"}${ok ? "" : "\n" + (out.firstDivergence ? JSON.stringify(out.firstDivergence) : r.stdout.slice(-400) + r.stderr.slice(-400))}`);
}
process.exit(failed ? 1 : 0);
