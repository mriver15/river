// Save slots: named, complete copies of a world that can be put back later or branched into a second world. A slot is an ordinary database file
// plus a small description beside it. Nothing here opens the live database for writing: a copy is taken through a second, read-only connection.
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface SlotMeta { name: string; note: string; savedAt: number; tick: number; day: number; lives: number; seed: number; bytes: number; branchOf?: string; branchTick?: number }
const DAY_MS = 1_440_000, STEP_MS = 100;

export const slotName = (s: string) => s.trim().replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, "-").replace(/^[-.]+/, "").slice(0, 48);
const files = (dir: string, name: string) => ({ db: path.join(dir, `${name}.db`), meta: path.join(dir, `${name}.json`) });

/** Where the world stands in a database file: clock tick, world day, lives lived, island seed. Read-only. */
export function describeDb(file: string): Pick<SlotMeta, "tick" | "day" | "lives" | "seed"> {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const kv = (k: string) => { try { const r = d.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined; return r ? JSON.parse(r.v) : undefined; } catch { return undefined; } };
    const sim = kv("sim") as { base: number; tick: number } | undefined, epoch = kv("epoch") as number | undefined;
    const day = sim && epoch && kv("epochOnSim") ? Math.max(1, Math.floor((sim.base + sim.tick * STEP_MS - epoch) / DAY_MS) + 1) : 1;
    let lives = 1; try { lives = (d.prepare("SELECT COUNT(*) n FROM lives").get() as { n: number }).n + 1; } catch { /* none yet */ }
    return { tick: sim?.tick ?? 0, day, lives, seed: Number(kv("seed") ?? 0) };
  } finally { d.close(); }
}

/** Copy a database (the live one, safely, or any file) into a named slot. Refuses to overwrite unless asked. */
export async function saveSlot(srcFile: string, dir: string, rawName: string, o: { note?: string; overwrite?: boolean; branchOf?: string; branchTick?: number } = {}): Promise<SlotMeta> {
  const name = slotName(rawName); if (!name) throw new Error("a slot needs a name (letters, digits, spaces, - _ .)");
  const f = files(dir, name);
  if (fs.existsSync(f.db) && !o.overwrite) throw new Error(`there is already a slot called "${name}"`);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${f.db}.partial`; fs.rmSync(tmp, { force: true });
  const src = new DatabaseSync(srcFile, { readOnly: true });
  try { await backup(src, tmp); } finally { src.close(); }
  { const c = new DatabaseSync(tmp); try { c.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE"); } finally { c.close(); } }          // a slot is one file, not a file and its journal
  fs.renameSync(tmp, f.db);
  const meta: SlotMeta = { name, note: (o.note ?? "").slice(0, 300), savedAt: Date.now(), ...describeDb(f.db), bytes: fs.statSync(f.db).size, ...(o.branchOf ? { branchOf: o.branchOf, branchTick: o.branchTick } : {}) };
  fs.writeFileSync(f.meta, JSON.stringify(meta, null, 1));
  return meta;
}

export function listSlots(dir: string): SlotMeta[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => { try { return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SlotMeta]; } catch { return []; } }).sort((a, b) => b.savedAt - a.savedAt);
}
export const slotFile = (dir: string, name: string) => { const f = files(dir, slotName(name)).db; if (!fs.existsSync(f)) throw new Error(`no slot called "${name}"`); return f; };
export function deleteSlot(dir: string, name: string) { const f = files(dir, slotName(name)); for (const p of [f.db, f.meta]) fs.rmSync(p, { force: true }); }

/** Put a slot back as a database file. The server must be stopped; the old file and its journal are removed only with `force`. */
export async function restoreSlot(dir: string, name: string, dest: string, force = false) {
  const src = slotFile(dir, name);
  if (fs.existsSync(dest) && !force) throw new Error(`${dest} exists; pass --force (stop the server first)`);
  for (const e of ["", "-wal", "-shm"]) fs.rmSync(dest + e, { force: true });
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  const s = new DatabaseSync(src, { readOnly: true });
  try { await backup(s, dest); } finally { s.close(); }
}
