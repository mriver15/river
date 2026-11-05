import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/server");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
const declared = JSON.parse(fs.readFileSync("docs/state-writers.json", "utf8")).tables as Record<string, { files: string[] }>;

/** Who writes what, found by reading the source. Plugins are not in src/server's writers at all: they run in the sandbox. */
function actual(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const f of walk(root)) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/\b(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)) (out[m[1]!] ??= new Set()).add(path.relative(root, f));
  }
  return out;
}

test("every table the engine writes has declared writers, and no file writes a table it was not declared for", () => {
  const found = actual();
  for (const [table, files] of Object.entries(found)) {
    assert.ok(declared[table], `table "${table}" is written but not declared in docs/state-writers.json`);
    for (const f of files) assert.ok(declared[table]!.files.includes(f), `${f} writes "${table}" but is not a declared writer of it`);
  }
  for (const [table, d] of Object.entries(declared)) for (const f of d.files) assert.ok(found[table]?.has(f), `docs/state-writers.json says ${f} writes "${table}", but it does not`);
});

test("plugins cannot write state at all: no plugin source touches the database, the engine, or a timer", () => {
  const dir = path.join(root, "plugins");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b\s+\w/.test(s.replace(/\/\/.*$/gm, "")) || !/db\.prepare/.test(s), `${f} writes the database`);
    for (const imp of s.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) assert.ok(["../toolkit.ts", "../bus.ts"].includes(imp[1]!), `${f} imports ${imp[1]}`);
  }
});
