// Starting over. Two operations:
//   restartCycles(): clear the local token/cycle accounting and wake River (non-destructive).
//   resetRiver():    erase River's mind and optionally the world, behind a confirmation code. Always backs the database up first.
import { bodyApi } from "./body.ts";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, db, kvGet } from "./db.ts";
import { beginGeneration, persistGeneration } from "./lifecycle.ts";
import { suspendTx, resumeTx, resetJobs } from "./sim.ts";
import { forgetPersisted } from "./persist.ts";
import { recordCommand } from "./recorder.ts";
import { log } from "./bus.ts";
import { clearMemoryCaches } from "./memory.ts";
import { resetDreams } from "./dreams.ts";
import type { Agent } from "./agent.ts";
import type { Ambient } from "./ambient.ts";
import type { Emotions } from "./emotions.ts";
import type { Creatures } from "./creatures.ts";
import type { Story } from "./story.ts";
import type { Catalog } from "./catalog.ts";
import type { World } from "./world.ts";

const CODE = process.env.RIVER_RESET_CODE ?? "2888";
let wrong = 0, lockedUntil = 0;

/** Constant-ish time compare plus a lockout, so the code can't simply be guessed. */
export function checkCode(code: string): { ok: boolean; error?: string } {
  if (Date.now() < lockedUntil) return { ok: false, error: `Too many wrong codes. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.` };
  if (code.length === CODE.length && [...code].every((c, i) => c === CODE[i]) ) { wrong = 0; return { ok: true }; }
  if (++wrong >= 5) { wrong = 0; lockedUntil = Date.now() + 60_000; }
  return { ok: false, error: "That code isn't right." };
}

function backup(): string {
  const dir = path.join(path.dirname(path.resolve(DB_PATH)), "backups"); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let file = path.join(dir, `${path.basename(DB_PATH, ".db")}-${stamp}.db`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${path.basename(DB_PATH, ".db")}-${stamp}-${n}.db`);   // never overwrite or collide
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);       // a consistent snapshot, safe with WAL and a live server
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith("..") ? file : rel;
}

async function resetInner(opts: { world: boolean }, d: { agent: Agent; world: World; ambient: Ambient; emotions: Emotions; inner?: { reset(): void }; visitors?: { reset(): void }; ecology?: { reset(): void }; creatures: Creatures; story: Story; catalog: Catalog; wildlife?: { reset(): void }; activities?: { reset(): void }; knowledge?: { reset(): void } }): Promise<{ backup: string }> {
  const file = backup();
  log("system", `A new River is beginning. Database backed up to ${file}.`);
  await d.agent.halt();                                       // let the current cycle finish; nothing new starts
  recordCommand("human", "reset_apply", { world: opts.world });   // the moment of the wipe is what replay repeats (the wait above can span ticks)
  resetApply(opts, d);
  return { backup: file };
}

type Deps = Parameters<typeof resetInner>[1];
/** The wipe itself: synchronous, so it happens at one instant of the simulation. Live and replay both run it. */
export function resetApply(opts: { world: boolean }, d: Deps): void {
  // 1. wipe the database
  const tables = ["memories", "events", "desires", "interests", "places", "journal", "tunes", "compositions", "moments", "creatures", "catalog", "opinions", "palette", "works", "tools", "tool_requests", "forged", "inventory", "mind_trace", "life_deeds"];
  if (opts.world) tables.push("entities");
  db.exec("BEGIN");
  try {
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map((t) => `'${t}'`).join(",")})`);  // ids start again at 1
    const keep = opts.world ? ["sim", "epochOnSim"] : ["sim", "epochOnSim", "seed", "epoch", "nextId", "heat", "scorch", "weather", "config"];      // the clock is never wiped: a new life or a new world goes on from the same moment
    db.exec(keep.length ? `DELETE FROM kv WHERE k NOT IN (${keep.map((k) => `'${k}'`).join(",")})` : "DELETE FROM kv");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); d.agent.resume(false); throw e; }

  // 2. clear leftovers on disk and in memory
  const plugins = path.resolve("src/server/plugins");
  for (const f of fs.readdirSync(plugins)) if (f.startsWith("_staged_")) fs.rmSync(path.join(plugins, f), { force: true });
  clearMemoryCaches(); resetDreams();
  d.activities?.reset(); d.knowledge?.reset(); resetJobs(); forgetPersisted();   // timers and committed state belong to the old life
  d.world.reset(opts.world);
  d.creatures.reset(); d.visitors?.reset(); if (opts.world) d.ecology?.reset(); d.story.reset(); d.catalog.reset(); d.ambient.reset(); d.emotions.reset(); d.inner?.reset(); bodyApi.reset(); d.wildlife?.reset();
  d.agent.resume(true);
  log("system", `A new River awakens${opts.world ? " on a new island" : ""}.`);
  void kvGet;                                                 // (kv helpers re-seed themselves lazily)
}

/**
 * A new life. Starts a new generation first, so every in-flight model answer, dream and appraisal from the old life is discarded when it lands.
 * The clock's open transaction is committed and held off meanwhile: the backup and the wipe manage their own.
 */
export async function resetRiver(...args: Parameters<typeof resetInner>) {
  beginGeneration(); recordCommand("human", "reset_start", {});   // fences the old life now; replay repeats it at the same tick
  suspendTx();
  try { return await resetInner(...args); }
  finally { persistGeneration(); resumeTx(); }
}
