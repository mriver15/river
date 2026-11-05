import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("three simulated days unattended stay inside the declared resource limits", { timeout: 300_000 }, () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/unattended.ts", "3"], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stdout.slice(-800) + r.stderr.slice(-300));
  const m = JSON.parse(r.stdout.match(/MEASURED (.*)/)![1]!);
  assert.equal(m.ticks, 43_200); assert.equal(m.sandbox.active, 0); assert.equal(m.newLives, 0);
});
