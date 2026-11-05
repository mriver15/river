import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { makeLegacyDb } from "../scripts/legacy-fixture.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-migtest-"));
const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("a legacy database is backed up, converted as a copy, booted and checked; the original is never touched and rollback is rehearsed", { timeout: 200_000 }, () => {
  const legacy = path.join(dir, "legacy.db"); makeLegacyDb(legacy);
  const before = sha(legacy);
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate-legacy.ts", legacy, path.join(dir, "out")], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stdout + r.stderr.slice(-500));
  assert.equal(sha(legacy), before, "the original is byte for byte what it was");
  const reportFile = r.stdout.match(/report: (.*)/)![1]!;
  const rep = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(rep.ok, true); assert.deepEqual(rep.problems, []);
  const x = rep.report;
  assert.ok(x.migrations.includes("0001_baseline") && x.migrations.includes("0011_plugin_installs"), "every migration ran, in order");
  assert.equal(x.preClock, true, "the report says this database predates the simulation clock");
  assert.ok(rep.notes.some((n: string) => /approximate/.test(n)) && rep.notes.some((n: string) => /origin marked unknown/.test(n)));
  assert.deepEqual(x.items.audit, []); assert.equal(x.items.unknownOrigin, x.items.live, "nothing was given a history it did not have");
  assert.ok(x.worn.includes("bark wrap"), "the clothes River was wearing are worn again");
  assert.ok(x.carried >= 3, "the pack came across as separate, identified things");
  const granted = x.grants.filter((g: { approved: number }) => g.approved).map((g: { name: string }) => g.name).sort();
  assert.deepEqual(granted, ["dig", "fire", "legacy_forged", "weave"], "existing grants survive exactly, none added");
  const forged = x.forged.find((f: { name: string }) => f.name === "legacy_forged");
  assert.match(forged.state, /disabled/, "a plugin from the old smith does not run until it is adapted and installed again");
  const backup = rep.steps.backup, rollback = rep.steps.rollback;
  assert.equal(sha(rollback.file), backup.sha256, "rolling back restores the backup exactly");
  const converted = fs.readdirSync(path.join(dir, "out")).find((f) => f.startsWith("converted-"))!;
  assert.notEqual(sha(path.join(dir, "out", converted)), before, "the conversion happened to the copy");
});

test("a database that fails its own integrity check is refused before anything is converted", { timeout: 60_000 }, () => {
  const bad = path.join(dir, "bad.db"); fs.writeFileSync(bad, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4000, 7)]));
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate-legacy.ts", bad, path.join(dir, "out2")], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
});
