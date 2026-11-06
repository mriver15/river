import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "river-paritytest-")), "t.db");
const { BASE_TOOLS, GATED_TOOLS } = await import("../src/server/tools.ts");
type Feature = { id: string; feature: string; owner: string; tools: string[]; evidence: { test: string; title: string }[]; coverage: string };
const matrix = JSON.parse(fs.readFileSync("docs/parity.json", "utf8")).features as Feature[];

test("every tool River can use, built in or plugin, is assigned to a feature", () => {
  // the plugins that ship with the release: a tool River's own smith wrote and installed in this checkout is its own, not part of what the release must account for
  let shipped: string[] | null = null;
  try { shipped = execFileSync("git", ["ls-files", "src/server/plugins"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".ts")).map((f) => path.basename(f, ".ts")); } catch { /* not a git checkout: use the directory */ }
  const plugins = shipped?.length ? shipped : fs.readdirSync("src/server/plugins").filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
  const all = [...BASE_TOOLS.map((t) => t.name), ...GATED_TOOLS.map((t) => t.name), ...plugins];
  const assigned = new Set(matrix.flatMap((f) => f.tools));
  const orphan = all.filter((t) => !assigned.has(t));
  assert.deepEqual(orphan, [], `tools with no feature in docs/parity.json: ${orphan.join(", ")}`);
  for (const t of assigned) assert.ok(all.includes(t), `docs/parity.json names a tool that does not exist: ${t}`);
});

test("every feature has an owner that exists and evidence that exists: a test file with a test of that title", () => {
  for (const f of matrix) {
    assert.ok(f.owner && f.evidence.length > 0, `${f.id} has no owner or no evidence`);
    for (const piece of f.owner.split(",").map((s) => s.trim())) {
      const candidates = [path.join("src/server", piece), path.join("src", piece), path.join("src/server", piece.replace(/\/$/, ""))];
      assert.ok(candidates.some((c) => fs.existsSync(c)), `${f.id}: owner ${piece} does not exist`);
    }
    for (const e of f.evidence) {
      assert.ok(fs.existsSync(e.test), `${f.id}: ${e.test} does not exist`);
      assert.ok(fs.readFileSync(e.test, "utf8").includes(`"${e.title}"`) || fs.readFileSync(e.test, "utf8").includes(`\`${e.title}\``) || fs.readFileSync(e.test, "utf8").includes(e.title), `${f.id}: no test titled "${e.title}" in ${e.test}`);
    }
  }
});

test("the matrix says plainly which features rest on the soak alone", () => {
  const soak = matrix.filter((f) => f.coverage === "soak");
  assert.ok(soak.every((f) => f.evidence.length > 0));
  assert.ok(matrix.length >= 20);
});
