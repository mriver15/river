import { EventEmitter } from "node:events";
import { db } from "./db.ts";
import type { LogEntry, LogKind } from "../shared/types.ts";
import { simNow } from "./sim.ts";

export const bus = new EventEmitter();

/** Append to the persistent action log and broadcast it. */
export function log(kind: LogKind, text: string, data?: Record<string, any>): LogEntry {
  const ts = simNow();
  const r = db.prepare("INSERT INTO events(ts, kind, text, data) VALUES(?,?,?,?)")
    .run(ts, kind, text, data ? JSON.stringify(data) : null);
  const entry: LogEntry = { id: Number(r.lastInsertRowid), ts, kind, text, data };
  bus.emit("log", entry);
  return entry;
}

export function recentLog(limit = 300): LogEntry[] {
  const rows = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as any[];
  return rows.reverse().map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, text: r.text, data: r.data ? JSON.parse(r.data) : undefined }));
}

export function logBefore(beforeId: number, limit = 200): LogEntry[] {
  const rows = db.prepare("SELECT * FROM events WHERE id < ? ORDER BY id DESC LIMIT ?").all(beforeId, limit) as any[];
  return rows.reverse().map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, text: r.text, data: r.data ? JSON.parse(r.data) : undefined }));
}
