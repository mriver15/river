// Timed live-model baseline on a fixture copy. Usage:
//   tsx scripts/baseline.ts [minutes=12] [fixture=new-life] [port=8799]
// Copies .fixtures/<fixture>.db to a uniquely named file (never overwrites), runs the real server against it for the
// given wall time, stops it, then reads token usage from that DB and appends a line to .fixtures/run/results.jsonl.
// Needs DEEPSEEK_API_KEY (or LLM_API_KEY / a local LLM_BASE_URL). Never touches data/.
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const minutes = Number(process.argv[2] ?? 12), fixture = process.argv[3] ?? "new-life", port = process.argv[4] ?? "8799";
if (!(minutes > 0)) throw new Error("minutes must be positive");
if (process.env.MOCK_LLM === "1") throw new Error("MOCK_LLM=1 spends no tokens; unset it for a baseline");
if (!process.env.DEEPSEEK_API_KEY && !process.env.LLM_API_KEY && !process.env.LLM_BASE_URL) throw new Error("no LLM key or LLM_BASE_URL in the environment");

const src = path.resolve(`.fixtures/${fixture}.db`), runDir = path.resolve(".fixtures/run");
if (!fs.existsSync(src)) throw new Error(`missing ${src}; run npm run fixtures first`);
fs.mkdirSync(runDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-"), dbFile = path.join(runDir, `${fixture}-${stamp}-p${port}.db`);
fs.copyFileSync(src, dbFile, fs.constants.COPYFILE_EXCL);

console.log(`running ${minutes} min on ${dbFile} (port ${port})`);
const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], { env: { ...process.env, RIVER_DB: dbFile, PORT: port }, stdio: ["ignore", fs.openSync(dbFile + ".log", "w"), "inherit"] });
let exited = false; child.on("exit", () => { exited = true; });

setTimeout(async () => {
  child.kill("SIGTERM");
  for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 200));
  if (!exited) { child.kill("SIGKILL"); await new Promise((r) => setTimeout(r, 500)); }

  const db = new DatabaseSync(dbFile);
  const kv = (k: string) => { const r = db.prepare("SELECT v FROM kv WHERE k=?").get(k) as { v: string } | undefined; return r ? JSON.parse(r.v) : undefined; };
  const recs: { inp: number; out: number; hit: number }[] = kv("usage") ?? [];
  const cycles = kv("cycleCount") ?? 0;
  const agent = kv("agent");
  const memories = (db.prepare("SELECT COUNT(*) n FROM memories").get() as { n: number }).n;
  type D = { kinds: string; calls: number; in_tokens: number; out_tokens: number; packet_tokens: number; latency_ms: number; tools: string; note: string };
  let decisions: D[] = []; try { decisions = db.prepare("SELECT kinds, calls, in_tokens, out_tokens, packet_tokens, latency_ms, tools, note FROM brain_decisions ORDER BY id").all() as unknown as D[]; } catch { /* a database from before the decision log */ }
  const byConsumer: Record<string, { calls: number; tokens: number }> = {};
  for (const r of recs as any[]) { const c = (byConsumer[r.c ?? "decision"] ??= { calls: 0, tokens: 0 }); c.calls++; c.tokens += r.inp + r.out; }
  const kinds: Record<string, number> = {}; for (const d of decisions) for (const k of d.kinds.split(",")) kinds[k.replace(/×\d+$/, "")] = (kinds[k.replace(/×\d+$/, "")] ?? 0) + 1;
  const tools: Record<string, number> = {}; for (const d of decisions) for (const t of d.tools.split(",").filter(Boolean)) tools[t.replace("✗", "")] = (tools[t.replace("✗", "")] ?? 0) + 1;
  const actions = Object.values(tools).reduce((a, n) => a + n, 0);
  db.close();

  const inp = recs.reduce((a, r) => a + r.inp, 0), out = recs.reduce((a, r) => a + r.out, 0), hit = recs.reduce((a, r) => a + r.hit, 0);
  const simDays = minutes / 24;   // 1x speed; fixture dayMinutes default is 24
  const row = { when: new Date().toISOString(), fixture, minutes, simDays: +simDays.toFixed(3), calls: recs.length, cycles, inputTokens: inp, outputTokens: out, cacheHitTokens: hit,
    tokensPerSimDay: Math.round((inp + out) / simDays), tokensPerCycle: cycles ? Math.round((inp + out) / cycles) : null, memories, decisions: decisions.length, callsPerDecision: decisions.length ? +(decisions.reduce((a, d) => a + d.calls, 0) / decisions.length).toFixed(2) : null, tokensPerDecision: decisions.length ? Math.round((inp + out) / decisions.length) : null, avgPacketTokens: decisions.length ? Math.round(decisions.reduce((a, d) => a + d.packet_tokens, 0) / decisions.length) : null, avgLatencyMs: decisions.length ? Math.round(decisions.reduce((a, d) => a + d.latency_ms, 0) / decisions.length) : null, wokenBy: kinds, actions, toolsUsed: tools, byConsumer, endedAt: agent && { x: +agent.x.toFixed(1), z: +agent.z.toFixed(1) }, db: path.relative(process.cwd(), dbFile) };
  fs.appendFileSync(path.join(runDir, "results.jsonl"), JSON.stringify(row) + "\n");
  console.log(row);
  if (!recs.length) { console.error("no usage recorded: check", dbFile + ".log"); process.exit(1); }
}, minutes * 60_000);
