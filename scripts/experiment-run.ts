// One run of an experiment: a fresh island from a seed, a scenario's parameters, the mock brain, an advance for N days, and a line of
// metrics. Started by scripts/experiment.ts, one process per run so runs cannot affect each other.
//   tsx scripts/experiment-run.ts '<{"seed":1,"days":1,"preset":"gentle","params":{"needsRate":0.5}}>' <db>
const [specArg, db] = process.argv.slice(2);
const spec = JSON.parse(specArg ?? "{}") as { seed: number; days: number; preset?: string; params?: Record<string, number | boolean>; name?: string };
Object.assign(process.env, { RIVER_DB: db, MOCK_LLM: "1", EMBED_DISABLED: "1" });
const sim = await import("../src/server/sim.ts");
const { db: conn, kvSet } = await import("../src/server/db.ts");
kvSet("seed", spec.seed);
const { applyPreset, setConfig, paramSet } = await import("../src/server/config.ts");
if (spec.preset) applyPreset(spec.preset);
for (const [k, v] of Object.entries(spec.params ?? {})) if (!setConfig(k, v)) throw new Error(`unknown parameter ${k}`);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { bodyApi } = await import("../src/server/body.ts");
const rt = await createRuntime();
startSystems(rt); sim.start(); rt.agent.run();
const w = rt.world, E = rt.emotions;
// sample River's state once per batch
const keys = ["energy", "hunger", "mood", "warmth", "curiosity"] as const;
const sum: Record<string, number> = {}, min: Record<string, number> = {}; let samples = 0, peakDread = 0, peakGrief = 0, minHealth = 100;
rt.advancer.onProgress = (p) => {
  if (!p) return; samples++;
  for (const k of keys) { const v = w.me.needs[k]; sum[k] = (sum[k] ?? 0) + v; min[k] = Math.min(min[k] ?? 100, v); }
  peakDread = Math.max(peakDread, E.level.dread); peakGrief = Math.max(peakGrief, E.level.grief); minHealth = Math.min(minHealth, bodyApi.health());
};
const start = sim.simTick();
const r = await rt.advancer.run({ until: { kind: "ticks", ticks: Math.round(spec.days * 14_400) }, decision: "defer", stopOnDeath: true, batch: 100 });
const n = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
const out = {
  name: spec.name ?? "", seed: spec.seed, paramSet: paramSet(), reason: r.reason, alive: !bodyApi.isDead(), ticks: r.ticks, simDays: +(r.ticks / 14_400).toFixed(2),
  wallSec: +(r.wallMs / 1000).toFixed(1), ticksPerSec: r.ticksPerSec,
  needsMean: Object.fromEntries(keys.map((k) => [k, +((sum[k] ?? 0) / Math.max(1, samples)).toFixed(1)])), needsMin: Object.fromEntries(keys.map((k) => [k, +(min[k] ?? 0).toFixed(1)])),
  minHealth: +minHealth.toFixed(1), peakDread: +peakDread.toFixed(2), peakGrief: +peakGrief.toFixed(2),
  items: n("SELECT COUNT(*) n FROM item_events WHERE type = 'created'"), works: n("SELECT COUNT(*) n FROM works"), moments: n("SELECT COUNT(*) n FROM moments"),
  decisions: n("SELECT COUNT(*) n FROM brain_decisions"), injuries: n("SELECT COUNT(*) n FROM events WHERE kind = 'need'"), startTick: start,
};
sim.setSimPaused(true); sim.stop();
console.log("RESULT " + JSON.stringify(out));
process.exit(0);
