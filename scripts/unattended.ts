// An unattended run: a fresh island, the mock brain, three simulated days with nobody watching, and the resource limits it must stay inside.
//   tsx scripts/unattended.ts [days=3]
// Limits are declared in docs/RUNBOOK.md (Resource limits) and checked here. Prints the measurements either way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const days = Number(process.argv[2] ?? 3);
const LIMITS = { rssMb: 700, stepP95Ms: 10, minTicksPerSec: 100, dbMbPerDay: 25, eventsPerDay: 25_000, wallSec: 600 };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-unattended-")), file = path.join(dir, "u.db");
Object.assign(process.env, { RIVER_DB: file, MOCK_LLM: "1", EMBED_DISABLED: "1" });
const sim = await import("../src/server/sim.ts");
const { db, kvSet } = await import("../src/server/db.ts");
kvSet("seed", 99);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { sandboxStats } = await import("../src/server/sandbox/host.ts");
const { bodyApi } = await import("../src/server/body.ts");
const { setConfig } = await import("../src/server/config.ts");
setConfig("lethal", false);                                                            // the mock brain is a poor survivor; this run measures what three continuous days cost, not whether it lives
const rt = await createRuntime(); startSystems(rt); sim.start(); rt.agent.run();
let peakRss = 0, lives = 0;
rt.advancer.onProgress = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss / 1048576); };
const t0 = performance.now(), target = Math.round(days * 14_400);
let ran = 0;
while (ran < target) {                                                                  // a death ends a life, not the run: a new one begins, as an unattended owner would want
  const r = await rt.advancer.run({ until: { kind: "ticks", ticks: target - ran }, decision: "defer", stopOnDeath: true, batch: 200 });
  ran += r.ticks;
  if (r.reason === "death" && ran < target) { lives++; const { resetRiver } = await import("../src/server/reset.ts"); await resetRiver({ world: false }, rt); }
  else if (r.reason !== "target") break;
}
sim.setSimPaused(true); await new Promise((r) => setTimeout(r, 100)); sim.stop();
const wallSec = (performance.now() - t0) / 1000;
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
const dbMb = fs.statSync(file).size / 1048576, events = (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n;
const step = sim.simStepStats(), m = {
  days, ticks: ran, wallSec: +wallSec.toFixed(1), ticksPerSec: Math.round(ran / wallSec), speedVsRealTime: Math.round(ran / wallSec / 10), peakRssMb: Math.round(peakRss), stepP95Ms: step.p95, stepMaxMs: step.max,
  dbMb: +dbMb.toFixed(1), dbMbPerDay: +(dbMb / days).toFixed(2), eventsPerDay: Math.round(events / days), newLives: lives, dead: bodyApi.isDead(), sandbox: sandboxStats,
};
const fails: string[] = [];
if (m.peakRssMb > LIMITS.rssMb) fails.push(`memory ${m.peakRssMb} MB > ${LIMITS.rssMb}`);
if (m.stepP95Ms > LIMITS.stepP95Ms) fails.push(`step p95 ${m.stepP95Ms} ms > ${LIMITS.stepP95Ms}`);
if (m.ticksPerSec < LIMITS.minTicksPerSec) fails.push(`speed ${m.ticksPerSec} ticks/s < ${LIMITS.minTicksPerSec}`);
if (m.dbMbPerDay > LIMITS.dbMbPerDay) fails.push(`database grows ${m.dbMbPerDay} MB/day > ${LIMITS.dbMbPerDay}`);
if (m.eventsPerDay > LIMITS.eventsPerDay) fails.push(`${m.eventsPerDay} log rows/day > ${LIMITS.eventsPerDay}`);
if (m.wallSec > LIMITS.wallSec) fails.push(`took ${m.wallSec}s > ${LIMITS.wallSec}`);
if (sandboxStats.active !== 0) fails.push(`${sandboxStats.active} sandbox processes left running`);
console.log("MEASURED " + JSON.stringify(m)); console.log("LIMITS " + JSON.stringify(LIMITS));
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails.length ? `FAIL ${fails.join("; ")}` : `PASS ${days} simulated days unattended inside every limit`);
process.exit(fails.length ? 1 : 0);
