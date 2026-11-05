// Convert an existing database to the current version, safely: back it up and prove the backup restores, convert a COPY (never the original),
// check the invariants, boot the converted copy and run it, and rehearse the rollback. Writes a report. The original is never opened for writing.
//   tsx scripts/migrate-legacy.ts <database> [outDir=.fixtures/migration]
// Cutover itself (stop the server, take the final backup, convert, start) is in docs/RUNBOOK.md; this is the rehearsal and the verification.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const counts = (f: string) => { const d = new DatabaseSync(f, { readOnly: true }); const out: Record<string, number> = {}; for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all() as { name: string }[]) out[t.name] = (d.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get() as { n: number }).n; d.close(); return out; };

if (process.argv[2] === "--convert") {
  // child: the converted copy, brought up as the real engine would
  const file = process.argv[3]!;
  Object.assign(process.env, { RIVER_DB: file, MOCK_LLM: "1", EMBED_DISABLED: "1" });
  const sim = await import("../src/server/sim.ts");
  const { db } = await import("../src/server/db.ts");
  const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
  const { pluginRecords } = await import("../src/server/sandbox/plugin.ts");
  const rt = await createRuntime(); startSystems(rt); sim.runTicks(300);
  const q = <T,>(s: string) => db.prepare(s).all() as T[];
  const grants = q<{ name: string; approved: number }>("SELECT name, approved FROM tools ORDER BY name");
  const plugins = [...pluginRecords.values()].map((p) => ({ name: p.name, status: p.status, shipped: p.shipped, capabilities: p.capabilities, reason: p.reason }));
  const forged = q<{ name: string; status: string }>("SELECT name, status FROM forged").map((f) => {
    const onDisk = fs.existsSync(path.resolve("src/server/plugins", `${f.name}.ts`)), rec = pluginRecords.get(f.name);
    return { name: f.name, status: f.status, state: rec ? rec.status : onDisk ? "not loaded" : "disabled: its file is not in src/server/plugins", reason: rec?.reason ?? "" };
  });
  const inst = q<{ id: string; prov: string }>("SELECT id, prov FROM item_instances WHERE ended_tick IS NULL");
  const report = {
    migrations: q<{ id: string }>("SELECT id FROM sim_migrations ORDER BY id").map((m) => m.id),
    preClock: sim.isFreshClock, tick: sim.simTick(),
    items: { live: inst.length, unknownOrigin: inst.filter((i) => JSON.parse(i.prov).unknown).length, audit: rt.world.items.audit() },
    inventoryRows: (db.prepare("SELECT COUNT(*) n FROM inventory").get() as { n: number }).n, carried: rt.world.items.carried().length,
    worn: rt.world.items.equipped().map((i) => i.name), entities: rt.world.entities.size, grants, plugins, forged,
  };
  sim.stop(); console.log("REPORT " + JSON.stringify(report)); process.exit(0);
}

const src = path.resolve(process.argv[2] ?? ""), outDir = path.resolve(process.argv[3] ?? ".fixtures/migration");
if (!process.argv[2] || !fs.existsSync(src)) { console.error("usage: migrate-legacy.ts <database> [outDir]"); process.exit(2); }
if ((src + path.sep).startsWith(path.resolve("data") + path.sep) && process.env.MIGRATE_ALLOW_LIVE !== "1") console.error("note: the original is only read, never written; the copy is converted.");
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now(), backup = path.join(outDir, `backup-${stamp}.db`), copy = path.join(outDir, `converted-${stamp}.db`), restored = path.join(outDir, `restored-${stamp}.db`);
const problems: string[] = [], steps: Record<string, unknown> = {};
const check = (ok: boolean, what: string) => { if (!ok) problems.push(what); return ok; };

// 1. consistent backup, and proof that it restores
const srcSha0 = sha(src);
{ const d = new DatabaseSync(src, { readOnly: true }); check((d.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check === "ok", "the original fails its integrity check"); d.prepare("VACUUM INTO ?").run(backup); d.close(); }
const before = counts(src), backed = counts(backup);
check(JSON.stringify(before) === JSON.stringify(backed), "the backup has different row counts from the original");
fs.copyFileSync(backup, restored);
{ const d = new DatabaseSync(restored, { readOnly: true }); check((d.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check === "ok", "the restored backup fails its integrity check"); d.close(); }
check(sha(restored) === sha(backup), "restoring the backup did not give back the same bytes");
steps.backup = { file: backup, sha256: sha(backup), tables: before };

// 2. convert a copy, boot it, run it
fs.copyFileSync(backup, copy);
const r = spawnSync(process.execPath, ["--import", "tsx", process.argv[1]!, "--convert", copy], { encoding: "utf8", maxBuffer: 1 << 26 });
const line = r.stdout.split("\n").find((l) => l.startsWith("REPORT "));
let report: any = null;
if (r.status !== 0 || !line) problems.push(`the converted copy did not start: ${(r.stderr || r.stdout).slice(-400)}`); else report = JSON.parse(line.slice(7));
if (report) {
  check(report.items.audit.length === 0, `the item audit found problems: ${report.items.audit.slice(0, 3).join("; ")}`);
  check(report.carried >= before.inventory!, `River carried ${before.inventory} stacks before and ${report.carried} items after`);
  const was = new Set((() => { const d = new DatabaseSync(backup, { readOnly: true }); const s = (d.prepare("SELECT name FROM tools WHERE approved = 1").all() as { name: string }[]).map((t) => t.name); d.close(); return s; })());
  const now = new Set((report.grants as { name: string; approved: number }[]).filter((g) => g.approved).map((g) => g.name));
  check([...was].every((n) => now.has(n)), `a grant was lost: ${[...was].filter((n) => !now.has(n)).join(", ")}`);
  check([...now].every((n) => was.has(n)), "a grant appeared that was never given");
  check(report.entities >= before.entities!, "entities were lost");
  check(report.migrations.length >= 10, "not every migration ran");
}
// 3. the original is untouched, and rolling back is just putting the backup back
check(sha(src) === srcSha0, "THE ORIGINAL CHANGED");
const rollback = path.join(outDir, `rollback-${stamp}.db`); fs.copyFileSync(backup, rollback);
check(sha(rollback) === srcSha0 || JSON.stringify(counts(rollback)) === JSON.stringify(before), "the rollback copy does not match the original");
steps.rollback = { file: rollback, matchesBackup: sha(rollback) === sha(backup) };

const out = { source: src, ok: problems.length === 0, problems, steps, report, notes: [
  report?.preClock ? "This database predates the simulation clock: the clock started at tick 0 with the calendar origin kept from the old epoch. Historical events keep their original wall timestamps and are approximate in simulation time; no exact ticks were invented." : "This database already had a simulation clock.",
  "Items on the ground and in the pack became instances with their origin marked unknown; identical old names were not assumed to be the same object.",
  "Plugins written by the old tool smith are not loaded unless their file is present and installed through the review flow; granted tools stay granted.",
] };
const file = path.join(outDir, `report-${stamp}.json`); fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(out.ok ? `PASS converted ${path.basename(src)}: ${report.migrations.length} migrations, ${report.items.live} items, ${report.grants.filter((g: any) => g.approved).length} grants kept, rollback rehearsed` : `FAIL ${problems.join("; ")}`);
console.log(`report: ${file}`);
process.exit(out.ok ? 0 : 1);
