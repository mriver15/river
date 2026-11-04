// Does moving the world faster than real time change what happens? Runs a fresh island two ways and prints the state hash at every
// checkpoint, so two runs can be compared.
//   tsx scripts/ff-equivalence.ts <prepare|step|advance|dawn> <ticks> <db>
//   prepare  create the database (clock base and seed); the runs below are each started from a copy of it, so they share a calendar
//   step     the ordinary host loop, at speed, until the tick is reached
//   advance  an advance by that many ticks
//   dawn     an advance to the next dawn (ticks is ignored; the target tick is printed)
// Both use the mock brain with the same seed, so every difference would be the advance's doing.
const [mode, ticksArg, db] = process.argv.slice(2);
if (!mode || !db) { console.error("usage: ff-equivalence.ts <step|advance|dawn> <ticks> <db>"); process.exit(2); }
Object.assign(process.env, { RIVER_DB: db, MOCK_LLM: "1", EMBED_DISABLED: "1" });
const ticks = Number(ticksArg);
const sim = await import("../src/server/sim.ts");
const { db: conn, kvSet } = await import("../src/server/db.ts");
if (mode === "prepare") { kvSet("seed", 7); sim.save(); conn.exec("PRAGMA wal_checkpoint(TRUNCATE)"); conn.close(); process.exit(0); }
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { targetFor } = await import("../src/server/advance.ts");
const rt = await createRuntime();
startSystems(rt); sim.start(); rt.agent.run();
let target = ticks;
if (mode === "dawn") target = targetFor(rt, { kind: "dawn" });
if (mode === "step") {
  sim.setSimSpeed(100);
  while (sim.simTick() < target) await new Promise((r) => setTimeout(r, 10));
  sim.setSimPaused(true);
} else {
  const r = await rt.advancer.run({ until: mode === "dawn" ? { kind: "dawn" } : { kind: "ticks", ticks }, decision: "defer", stopOnDeath: false });
  if (r.reason !== "target") throw new Error(`stopped early: ${r.reason}`);
  sim.setSimPaused(true);
}
await new Promise((r) => setTimeout(r, 50));
sim.stop();
const rows = conn.prepare("SELECT tick, hash FROM sim_checkpoints ORDER BY tick").all() as { tick: number; hash: string }[];
console.log(JSON.stringify({ mode, target, endTick: sim.simTick(), worldTime: +rt.world.worldTime().toFixed(4), day: rt.world.day(), checkpoints: Object.fromEntries(rows.map((r) => [r.tick, r.hash])) }));
process.exit(0);
