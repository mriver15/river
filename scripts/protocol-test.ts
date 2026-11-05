// Start the real server and check the wire protocol: the first message names the schema and the sequence, every broadcast is one more
// than the last, a resync request returns the whole state, and a repeated client command id is acknowledged as a duplicate, not run twice.
//   tsx scripts/protocol-test.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = path.resolve(".fixtures/run"); fs.mkdirSync(dir, { recursive: true });
const db = path.join(dir, `protocol-${Date.now()}.db`); fs.copyFileSync(path.resolve(".fixtures/new-life.db"), db);
const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: db, PORT: "8863", MOCK_LLM: "1", EMBED_DISABLED: "1" }, stdio: ["ignore", "ignore", "inherit"] });
const fail = (m: string): never => { console.error(`FAIL ${m}`); child.kill("SIGTERM"); process.exit(1); };
await sleep(5000);
const ws = new WebSocket("ws://localhost:8863/ws"); await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
const got: any[] = []; ws.on("message", (raw) => got.push(JSON.parse(String(raw))));
await sleep(500);
const init = got.find((m) => m.t === "init");
if (!init || typeof init.schema !== "number" || typeof init.seq !== "number") fail("the first message does not carry a schema version and a sequence");
ws.send(JSON.stringify({ t: "sim_speed", speed: 100 }));
for (let i = 0; i < 4; i++) { ws.send(JSON.stringify({ t: "say", text: `hello ${i}`, cid: `c${i}` })); await sleep(700); }
ws.send(JSON.stringify({ t: "say", text: "hello 0", cid: "c0" }));                      // a retry of a command the server has already run
await sleep(800);
const seqs = got.filter((m) => m.seq !== undefined && m.t !== "init").map((m) => m.seq as number);
if (seqs.length < 5) fail(`only ${seqs.length} sequenced broadcasts seen`);
for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1]! + 1) fail(`sequence jumped from ${seqs[i - 1]} to ${seqs[i]}`);
if (seqs[0]! <= init.seq) fail("a broadcast carried a sequence older than the snapshot");
const acks = got.filter((m) => m.t === "ack" && m.cid === "c0");
if (acks.length !== 2 || acks[1].status !== "duplicate") fail(`a repeated command id was not acknowledged as a duplicate (${JSON.stringify(acks.map((a) => a.status))})`);
const before = got.filter((m) => m.t === "init").length; ws.send(JSON.stringify({ t: "resync" })); await sleep(600);
if (got.filter((m) => m.t === "init").length !== before + 1) fail("a resync request did not return the whole state");
ws.close(); child.kill("SIGTERM"); await sleep(1000);
for (const e of ["", "-wal", "-shm"]) fs.rmSync(db + e, { force: true });
console.log(`PASS schema ${init.schema}; ${seqs.length} broadcasts in order; a retried command was a duplicate; resync returned the state`);
process.exit(0);
