// Command journal, checkpoint hashes and boot snapshots: the inputs and evidence replay needs.
// Replay = restore the boot snapshot, rerun the recorded commands at their recorded ticks, and compare checkpoint hashes.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { db, DB_PATH, kvGet } from "./db.ts";
import { simTick, rngState, save as saveSim } from "./sim.ts";
import { canonicalHash } from "../sim/hash.ts";
import { bodyView } from "./body.ts";
import type { World } from "./world.ts";

export const CHECKPOINT_EVERY = 300;               // ticks (30 simulation seconds)
const BRAIN_STREAMS = new Set(["agent"]);          // consumed by the (replay-less) mock brain, so not part of the physical state
let recording = true;
export const setRecording = (on: boolean) => { recording = on; };
/** True in the replay process: systems that call a model or other outside service stay quiet; their recorded results are applied instead. */
let replaying = false;
export const setReplaying = (on: boolean) => { replaying = on; };
export const isReplaying = () => replaying;

export function recordCommand(source: "brain" | "human" | "external", type: string, payload: unknown, commandId?: string): number {
  if (!recording) return 0;
  return Number(db.prepare("INSERT INTO sim_commands(tick, source, type, payload, command_id) VALUES(?,?,?,?,?)").run(simTick(), source, type, JSON.stringify(payload), commandId ?? null).lastInsertRowid);
}
/**
 * Idempotent admission. A command id seen before is not run again: the caller gets the original outcome back.
 * `seq` is the new journal row for a first-time command.
 */
export type Admission = { duplicate: false; seq: number } | { duplicate: true; status: string; result: string };
export function admit(source: "brain" | "human", type: string, payload: unknown, commandId?: string): Admission {
  if (commandId) {
    const row = db.prepare("SELECT status, result FROM sim_commands WHERE command_id = ?").get(commandId) as { status: string; result: string | null } | undefined;
    if (row) return { duplicate: true, status: row.status, result: row.result ?? "" };
  }
  return { duplicate: false, seq: recordCommand(source, type, payload, commandId) };
}
/** After a restart nothing that was running is still running. */
export function recoverCommands(): number {
  return Number(db.prepare("UPDATE sim_commands SET status = 'interrupted' WHERE status = 'running'").run().changes);
}
export function finishCommand(seq: number, status: "ok" | "error", result: string) {
  if (seq) db.prepare("UPDATE sim_commands SET status=?, result=? WHERE seq=?").run(status, result.slice(0, 2000), seq);
}

export interface Cmd { seq: number; tick: number; source: string; type: string; payload: any; status: string; result: string | null }
/** Commands in the order they were admitted, from `tick` on. Read from any database file. */
export function commandsFrom(d: { prepare: typeof db.prepare }, tick: number): Cmd[] {
  return (d.prepare("SELECT seq, tick, source, type, payload, status, result FROM sim_commands WHERE tick >= ? ORDER BY seq").all(tick) as any[]).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

const extraState = new Map<string, () => unknown>();
/** A system registers state that belongs in the hash (replay checks it at every checkpoint). */
export const registerState = (name: string, fn: () => unknown) => { extraState.set(name, fn); };
/** Tables written only through journaled paths (tools and human commands). Memories, desires and interests are not here:
 *  the brain loop writes them (thoughts, reflections), and replay has no brain. */
const TABLES = ["places", "tunes", "compositions", "works", "palette", "opinions", "lives", "catalog", "tools", "moments", "sim_activities", "known_entities"];

/** Hash of everything physical, in named parts so a mismatch says where it diverged. */
export function stateParts(w: World): Record<string, string> {
  const rng = Object.fromEntries(Object.entries(rngState()).filter(([k]) => !BRAIN_STREAMS.has(k)));
  const ents = [...w.entities.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const inv = [...w.inventory.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const m = w.me;
  let body: unknown = null; try { body = bodyView(); } catch { /* not attached */ }
  return {
    rng: canonicalHash(rng),
    entities: canonicalHash(ents),
    inventory: canonicalHash(inv),
    me: canonicalHash({ x: m.x, z: m.z, heading: m.heading, needs: m.needs, activity: m.activity, sleeping: m.sleeping, sleepUntil: m.sleepUntil }),
    world: canonicalHash({ weather: w.weather, epoch: w.epoch, nextId: kvGet("nextId", 0) }),
    heat: canonicalHash(Array.from(w.heat)),
    scorch: canonicalHash(Array.from(w.scorch)),
    body: canonicalHash(body),
    ...Object.fromEntries(TABLES.map((t) => [`t_${t}`, canonicalHash(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())])),
    ...Object.fromEntries([...extraState].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, fn]) => [k, canonicalHash(fn())])),
  };
}
/** Keys starting with "_" are readable diagnostics stored beside the hashes; they are not part of the comparison. */
export const stateHash = (parts: Record<string, string>) => canonicalHash(Object.fromEntries(Object.entries(parts).filter(([k]) => k[0] !== "_")));

export function checkpoint(w: World) {
  const parts = { ...stateParts(w), ...Object.fromEntries([...extraState].map(([k, fn]) => [`_raw_${k}`, JSON.stringify(fn())])), _me: JSON.stringify({ x: w.me.x, z: w.me.z, activity: w.me.activity, sleeping: w.me.sleeping, needs: w.me.needs }) };
  db.prepare("INSERT OR REPLACE INTO sim_checkpoints(tick, hash, parts) VALUES(?,?,?)").run(simTick(), stateHash(parts), JSON.stringify(parts));
}

/**
 * Copy the database exactly as the process found it, before any system is constructed. Construction and hydration are part of
 * what replay repeats, so the snapshot must not include their effects.
 */
export function snapshotBoot(): { tick: number; file: string; hash: string } {
  saveSim();
  const tick = simTick(), dir = path.join(path.dirname(DB_PATH), "snapshots"), file = path.join(dir, `${path.basename(DB_PATH)}.snapshot-${tick}.db`);   // named for its database: several worlds may share a directory
  fs.mkdirSync(dir, { recursive: true }); fs.rmSync(file, { force: true });
  db.prepare("VACUUM INTO ?").run(file);
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  db.prepare("INSERT OR REPLACE INTO sim_snapshots(tick, file, hash, created_at) VALUES(?,?,?,?)").run(tick, file, hash, Date.now());
  return { tick, file, hash };
}
