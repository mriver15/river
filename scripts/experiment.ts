// Scenario sweeps: run each scenario (a preset and/or parameter overrides) over several seeds for some simulated days, in parallel
// processes, and compare the outcomes. Every run is an advance of the real engine with the mock brain, so differences come from the
// parameters and the seed, not from model variance.
//   tsx scripts/experiment.ts [spec.json=scripts/experiments/example.json] [parallel=4]
// A spec: { "name": "...", "days": 1, "seeds": [1,2,3], "scenarios": [{ "name": "gentle", "preset": "gentle", "params": { "needsRate": 0.5 } }] }
// The first scenario is the baseline the others are compared to. Results are written to .fixtures/experiments/.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const specFile = path.resolve(process.argv[2] ?? "scripts/experiments/example.json"), parallel = Number(process.argv[3] ?? 4);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8")) as { name: string; days: number; seeds: number[]; scenarios: { name: string; preset?: string; params?: Record<string, number | boolean> }[] };
if (!spec.scenarios?.length || !spec.seeds?.length) throw new Error("a spec needs scenarios and seeds");
const dir = path.resolve(".fixtures/experiments"); fs.mkdirSync(dir, { recursive: true });
const work = fs.mkdtempSync(path.join(dir, "run-"));

interface Run { scenario: string; seed: number; r: any }
const jobs = spec.scenarios.flatMap((s) => spec.seeds.map((seed) => ({ s, seed })));
const results: Run[] = [];

function one(s: (typeof spec.scenarios)[number], seed: number): Promise<Run> {
  const file = path.join(work, `${s.name}-${seed}.db`);
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["--import", "tsx", "scripts/experiment-run.ts", JSON.stringify({ seed, days: spec.days, preset: s.preset, params: s.params, name: s.name }), file], { stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    c.on("exit", (code) => { const line = out.split("\n").find((l) => l.startsWith("RESULT ")); if (code !== 0 || !line) return reject(new Error(`${s.name} seed ${seed} failed (exit ${code})`)); resolve({ scenario: s.name, seed, r: JSON.parse(line.slice(7)) }); });
  });
}
const queue = [...jobs];
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
  for (let j = queue.shift(); j; j = queue.shift()) { const res = await one(j.s, j.seed); results.push(res); console.log(`  ${res.scenario} seed ${res.seed}: ${res.r.alive ? "alive" : "died"} after ${res.r.simDays} days (${res.r.ticksPerSec} ticks/s)`); }
}));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stat = (runs: Run[], f: (r: any) => number) => mean(runs.map((x) => f(x.r)));
const rows = spec.scenarios.map((s) => {
  const rs = results.filter((x) => x.scenario === s.name).sort((a, b) => a.seed - b.seed);
  return { scenario: s.name, runs: rs.length, survived: rs.filter((x) => x.r.alive).length, simDays: stat(rs, (r) => r.simDays), mood: stat(rs, (r) => r.needsMean.mood), hunger: stat(rs, (r) => r.needsMean.hunger), energy: stat(rs, (r) => r.needsMean.energy),
    minHealth: stat(rs, (r) => r.minHealth), peakDread: stat(rs, (r) => r.peakDread), peakGrief: stat(rs, (r) => r.peakGrief), items: stat(rs, (r) => r.items), works: stat(rs, (r) => r.works), moments: stat(rs, (r) => r.moments), ticksPerSec: stat(rs, (r) => r.ticksPerSec) };
});
const base = rows[0]!, f = (v: number, d = 1) => v.toFixed(d), delta = (v: number, b: number) => (b === 0 ? "" : ` (${v >= b ? "+" : ""}${f(((v - b) / b) * 100, 0)}%)`);
console.log(`\n${spec.name}: ${spec.days} simulated day(s), seeds ${spec.seeds.join(",")}; first scenario is the baseline\n`);
console.log(["scenario", "survived", "days", "mood", "hunger", "min health", "peak fear", "items", "works", "ticks/s"].map((h) => h.padEnd(16)).join(""));
for (const r of rows) console.log([r.scenario, `${r.survived}/${r.runs}`, f(r.simDays, 2), f(r.mood) + delta(r.mood, base.mood), f(r.hunger) + delta(r.hunger, base.hunger), f(r.minHealth), f(r.peakDread, 2), f(r.items) + delta(r.items, base.items), f(r.works), f(r.ticksPerSec, 0)].map((c) => String(c).padEnd(16)).join(""));
const outFile = path.join(dir, `${spec.name}-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify({ spec, rows, runs: results }, null, 1));
console.log(`\nwritten to ${outFile}`);
fs.rmSync(work, { recursive: true, force: true });
