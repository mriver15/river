// Consistent SQLite backup / restore / verify. Usage:
//   tsx scripts/db-backup.ts backup  <src.db> <dest.db>
//   tsx scripts/db-backup.ts verify  <a.db> [b.db]     integrity check; with two files, also compare row counts
//   tsx scripts/db-backup.ts restore <backup.db> <dest.db> --force
// Opens files directly; never imports src/server/db.ts, so it cannot create or touch data/river.db by accident.
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memories_fts%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}
export function rowCounts(file: string): Record<string, number> {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.fromEntries(tables(db).map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n])); }
  finally { db.close(); }
}
export function integrity(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check; }
  finally { db.close(); }
}
export async function backupDb(src: string, dest: string) {
  if (path.resolve(src) === path.resolve(dest)) throw new Error("source and destination are the same file");
  if (!fs.existsSync(src)) throw new Error(`no such database: ${src}`);
  if (fs.existsSync(dest)) throw new Error(`refusing to overwrite ${dest}`);
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  const db = new DatabaseSync(src, { readOnly: true });
  try { await backup(db, dest); } finally { db.close(); }
}
export function compare(a: string, b: string): string[] {
  const ca = rowCounts(a), cb = rowCounts(b), diffs: string[] = [];
  for (const t of new Set([...Object.keys(ca), ...Object.keys(cb)])) if (ca[t] !== cb[t]) diffs.push(`${t}: ${ca[t] ?? "missing"} vs ${cb[t] ?? "missing"}`);
  return diffs;
}

async function main() {
  const [cmd, a, b, flag] = process.argv.slice(2);
  if (cmd === "backup" && a && b) {
    await backupDb(a, b);
    const ic = integrity(b), diffs = compare(a, b);
    console.log(`backup ${b}: integrity ${ic}, ${diffs.length ? "MISMATCH " + diffs.join("; ") : "row counts match"}`);
    if (ic !== "ok" || diffs.length) process.exit(1);
  } else if (cmd === "verify" && a) {
    const ic = integrity(a); console.log(`${a}: integrity ${ic}`);
    const diffs = b ? compare(a, b) : [];
    if (b) console.log(diffs.length ? `MISMATCH ${diffs.join("; ")}` : "row counts match");
    if (ic !== "ok" || diffs.length) process.exit(1);
  } else if (cmd === "restore" && a && b) {
    if (flag !== "--force") throw new Error("restore replaces the destination; pass --force (stop the server first)");
    if (integrity(a) !== "ok") throw new Error("backup fails its integrity check");
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(b + ext, { force: true });
    await backupDb(a, b);
    console.log(`restored ${a} -> ${b}: ${compare(a, b).length ? "MISMATCH" : "row counts match"}`);
  } else {
    console.error("usage: db-backup.ts backup <src> <dest> | verify <a> [b] | restore <backup> <dest> --force");
    process.exit(2);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
