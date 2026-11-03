// A "moment" is something that mattered: a feeling moved a lot, or happened for the first time. They are the unit the viewer
// perceives (camera, sound, toast) and the raw material of each day's story.
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import type { Moment } from "../shared/types.ts";

const row = (r: any): Moment => ({ id: r.id, ts: r.ts, kind: r.kind, title: r.title, text: r.text, intensity: r.intensity, emotions: JSON.parse(r.emotions), x: r.x, z: r.z });

export function recordMoment(m: Omit<Moment, "id" | "ts">): Moment {
  const ts = Date.now();
  const r = db.prepare("INSERT INTO moments(ts, kind, title, text, intensity, emotions, x, z) VALUES(?,?,?,?,?,?,?,?)").run(ts, m.kind, m.title, m.text, m.intensity, JSON.stringify(m.emotions), m.x, m.z);
  const moment: Moment = { ...m, id: Number(r.lastInsertRowid), ts };
  log("moment", m.title, { intensity: m.intensity, kind: m.kind, emotions: m.emotions });
  bus.emit("moment", { t: "moment", moment });
  return moment;
}
export const recentMoments = (n = 30): Moment[] => (db.prepare("SELECT * FROM moments ORDER BY id DESC LIMIT ?").all(n) as any[]).map(row);
export const momentsBetween = (from: number, to: number, n = 6): Moment[] =>
  (db.prepare("SELECT * FROM moments WHERE ts >= ? AND ts < ? ORDER BY intensity DESC LIMIT ?").all(from, to, n) as any[]).map(row).sort((a, b) => a.ts - b.ts);
