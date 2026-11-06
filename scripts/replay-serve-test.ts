// Record a short life with the real server, then watch it back through the read-only replay server and check that the replay is
// read-only, advances, and matches every recorded checkpoint.
//   tsx scripts/replay-serve-test.ts
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = path.resolve(".fixtures/run"); fs.mkdirSync(dir, { recursive: true });
const rec = path.join(dir, `replay-serve-${Date.now()}.db`);
fs.copyFileSync(path.resolve(".fixtures/new-life.db"), rec);
const boot = (script: string, args: string[], port: number, env: Record<string, string> = {}): ChildProcess =>
  spawn(process.execPath, ["--import", "tsx", script, ...args], { env: { ...process.env, PORT: String(port), MOCK_LLM: "1", EMBED_DISABLED: "1", ...env }, stdio: ["ignore", "ignore", "inherit"] });
const connect = async (port: number) => { const ws = new WebSocket(`ws://localhost:${port}/ws`); await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); }); return ws; };
const fail = (m: string): never => { console.error(`FAIL ${m}`); process.exit(1); };

// 1. record
const live = boot("src/server/index.ts", [], 8861, { RIVER_DB: rec });
await sleep(5000);
const lw = await connect(8861);
lw.send(JSON.stringify({ t: "sim_speed", speed: 100 }));
for (let i = 1; i <= 4; i++) { await sleep(3000); lw.send(JSON.stringify({ t: "gift", name: `gift ${i}`, desc: "a gift" })); lw.send(JSON.stringify({ t: "say", text: `hello ${i}` })); }
await sleep(2500);
lw.close(); live.kill("SIGTERM"); await sleep(1500);

// 2. watch it back
const viewer = boot("scripts/replay-serve.ts", [rec, "", "8862"], 8862);
await sleep(4000);
const ws = await connect(8862);
let last: any = null, notices: string[] = [];
ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.t === "replay") last = m; if (m.t === "notice") notices.push(m.text); });
await sleep(800);
if (!last) fail("the replay server never reported its state");
const start = last.tick;
ws.send(JSON.stringify({ t: "replay_speed", speed: 1 }));
const mid = Math.floor((last.startTick + last.endTick) / 2);
ws.send(JSON.stringify({ t: "replay_seek", tick: mid }));            // jumping ahead runs the same ticks, flat out
for (let i = 0; i < 20 && last.tick < mid; i++) await sleep(500);
if (last.tick < mid) fail(`seeking to ${mid} stopped at ${last.tick}`);
ws.send(JSON.stringify({ t: "presence" }));                         // looking in on a recording changes nothing and is not an error
ws.send(JSON.stringify({ t: "replay_speed", speed: 64 }));
ws.send(JSON.stringify({ t: "say", text: "I should not be able to change anything" }));     // read-only
ws.send(JSON.stringify({ t: "config_set", key: "needsRate", value: 3 }));
for (let i = 0; i < 80 && !last.done; i++) await sleep(500);
ws.close(); viewer.kill("SIGTERM");
if (notices.length !== 2 || !notices.every((t) => /watched, not changed/.test(t))) fail("a command was accepted by a read-only replay");
if (!last.done) fail(`the replay did not finish (tick ${last.tick} of ${last.endTick})`);
if (last.tick <= start) fail("the replay did not advance");
if (last.checked < 5) fail(`only ${last.checked} checkpoints were compared`);
if (last.diverged !== 0) fail(`${last.diverged} of ${last.checked} checkpoints differ from the recording`);
console.log(`PASS replayed ${last.endTick - last.startTick} ticks; ${last.checked} checkpoints matched; commands from the client were refused; a jump ahead to tick ${mid} landed`);
for (const e of ["", "-wal", "-shm"]) fs.rmSync(rec + e, { force: true });
process.exit(0);
