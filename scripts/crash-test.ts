// Kill the server with SIGKILL right after it acknowledges commands, then check that nothing acknowledged was lost,
// the database is consistent (journal and clock agree), and a retry after restart is recognised as a duplicate.
//   tsx scripts/crash-test.ts [gifts=25] [rounds=3]
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";

const gifts = Number(process.argv[2] ?? 25), rounds = Number(process.argv[3] ?? 3), port = 8830;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = path.resolve(".fixtures/run");
fs.mkdirSync(dir, { recursive: true });
const dbFile = path.join(dir, `crash-${Date.now()}.db`);
fs.copyFileSync(path.resolve(".fixtures/new-life.db"), dbFile);
{ const d = new DatabaseSync(dbFile); d.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES('paused','true')").run(); d.close(); }   // the brain would pick the gifts up; this test is about the commands

const boot = (): ChildProcess => spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: dbFile, PORT: String(port), MOCK_LLM: "1" }, stdio: "ignore" });
async function connect() {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise((r, j) => { ws.on("open", r); ws.on("error", j); });
  const acks = new Map<string, string>();
  ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.t === "ack") acks.set(m.cid, m.status); });
  const until = async (cid: string) => { for (let i = 0; i < 200 && !acks.has(cid); i++) await sleep(25); return acks.get(cid); };
  return { ws, until, send: (m: object) => ws.send(JSON.stringify(m)) };
}
const rows = <T>(sql: string, ...a: any[]) => { const d = new DatabaseSync(dbFile, { readOnly: true }); try { return d.prepare(sql).all(...a) as T[]; } finally { d.close(); } };
const fail = (msg: string): never => { console.error("FAIL " + msg); process.exit(1); };

const acked: string[] = [];
let child = boot();
for (let round = 1; round <= rounds; round++) {
  await sleep(4000);
  const c = await connect();
  for (let i = 0; i < gifts; i++) {
    const cid = `r${round}-g${i}`;
    c.send({ t: "gift", name: `gift ${cid}`, desc: "a test gift", cid });
    if (await c.until(cid) !== "ok") fail(`gift ${cid} was not acknowledged ok`);
    acked.push(cid);
    if (i === 3) { c.send({ t: "gift", name: `gift ${cid}`, desc: "a test gift", cid }); await sleep(100); }   // a retry mid-stream
  }
  child.kill("SIGKILL");                                  // no chance to flush anything
  await sleep(800);
  c.ws.terminate();

  const have = new Set(rows<{ command_id: string }>("SELECT command_id FROM sim_commands WHERE status != 'interrupted' OR command_id IS NOT NULL").map((r) => r.command_id));
  const lost = acked.filter((id) => !have.has(id));
  if (lost.length) fail(`round ${round}: acknowledged commands missing from the journal: ${lost.slice(0, 5).join(", ")}`);
  const ents = rows<{ name: string }>("SELECT name FROM entities WHERE name LIKE 'gift r%'").map((r) => r.name);
  const missing = acked.filter((id) => !ents.includes(`gift ${id}`));
  if (missing.length) fail(`round ${round}: acknowledged gifts missing from the world: ${missing.slice(0, 5).join(", ")}`);
  const dup = ents.length - new Set(ents).size;
  if (dup) fail(`round ${round}: ${dup} duplicated gift entities (a retry ran twice)`);
  const clock = JSON.parse(rows<{ v: string }>("SELECT v FROM kv WHERE k='sim'")[0]!.v).tick as number;
  const maxCmd = (rows<{ t: number | null }>("SELECT MAX(tick) t FROM sim_commands")[0]!.t) ?? 0;
  if (maxCmd > clock) fail(`round ${round}: journal is ahead of the clock (command tick ${maxCmd} > clock ${clock})`);
  const ic = rows<{ integrity_check: string }>("PRAGMA integrity_check")[0]!.integrity_check;
  if (ic !== "ok") fail(`round ${round}: integrity_check says ${ic}`);
  console.log(`round ${round}: killed after ${acked.length} acked commands; none lost, none duplicated, clock ${clock} >= journal ${maxCmd}, integrity ok`);

  child = boot();                                         // restart on the crashed database
  await sleep(4000);
  const d = await connect();
  d.send({ t: "gift", name: `gift ${acked[0]}`, desc: "a test gift", cid: acked[0] });             // a retry from before the crash
  const st = await d.until(acked[0]!);
  if (st !== "duplicate") fail(`round ${round}: a retry after restart was ${st}, expected duplicate`);
  d.ws.close();
}
child.kill("SIGTERM"); await sleep(1000);
const final = rows<{ name: string }>("SELECT name FROM entities WHERE name LIKE 'gift r%'");
if (final.length !== acked.length) fail(`expected ${acked.length} gifts in the world, found ${final.length}`);
console.log(`PASS ${rounds} crashes, ${acked.length} acknowledged commands, ${final.length} gifts, retries across restarts recognised`);
