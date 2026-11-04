// State that lives in memory but must survive a restart, committed together with the clock.
// A system registers a getter for its state; every commit writes it if it changed. On construction the system asks for what was
// saved last. Values are plain JSON (use arrays for Maps); binary data goes through `persistedBlob`.
import { db } from "./db.ts";

interface Entry { get: () => unknown; last: string }
interface BlobEntry { get: () => Uint8Array; last: string }
const entries = new Map<string, Entry>();
const blobs = new Map<string, BlobEntry>();
const flushers: (() => void)[] = [];

const readKv = (key: string): string | undefined => (db.prepare("SELECT v FROM kv WHERE k = ?").get("st:" + key) as { v: string } | undefined)?.v;

/** Register state to commit. Returns what was saved last time, if anything, for the caller to restore from. */
export function persisted<T>(key: string, get: () => T): T | undefined {
  const raw = readKv(key);
  entries.set(key, { get, last: raw ?? "" });
  return raw === undefined ? undefined : (JSON.parse(raw) as T);
}
/** Same for a block of bytes (a grid, say). */
export function persistedBlob(key: string, get: () => Uint8Array): Uint8Array | undefined {
  const row = db.prepare("SELECT v FROM sim_blobs WHERE k = ?").get(key) as { v: Uint8Array } | undefined;
  blobs.set(key, { get, last: row ? Buffer.from(row.v).toString("base64") : "" });
  return row ? new Uint8Array(row.v) : undefined;
}
/** For writes that cannot be expressed as one value (rows of a table): called at every commit. */
export function onFlush(fn: () => void) { flushers.push(fn); }

export function flushPersisted() {
  for (const [key, e] of entries) {
    const j = JSON.stringify(e.get());
    if (j !== e.last) { e.last = j; db.prepare("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run("st:" + key, j); }
  }
  for (const [key, e] of blobs) {
    const b = e.get(), s = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64");
    if (s !== e.last) { e.last = s; db.prepare("INSERT INTO sim_blobs(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(key, b); }
  }
  for (const f of flushers) f();
}
/** After a reset wiped the key-value table: everything must be written again. */
export function forgetPersisted() { for (const e of entries.values()) e.last = ""; for (const e of blobs.values()) e.last = ""; }
