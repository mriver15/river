import { db } from "./db.ts";
import { bus, log } from "./bus.ts";
import type { Place } from "../shared/types.ts";

const row = (r: any): Place => ({ id: r.id, name: r.name, x: r.x, z: r.z, note: r.note });
export const listPlaces = (): Place[] => (db.prepare("SELECT * FROM places ORDER BY id").all() as any[]).map(row);

export function addPlace(name: string, x: number, z: number, note = ""): Place {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (clean.length < 2) throw new Error("A place needs a name.");
  const near = placeNear(x, z, 8);
  if (near) throw new Error(`You are already at "${near.name}" (named earlier). Pick another spot.`);
  if (db.prepare("SELECT 1 FROM places WHERE name = ?").get(clean)) throw new Error(`Another place is already called "${clean}".`);
  const r = db.prepare("INSERT INTO places(name, x, z, note, ts) VALUES(?,?,?,?,?)").run(clean, x, z, note.slice(0, 200), Date.now());
  log("desire", `Named a place: ${clean}${note ? ` — ${note}` : ""}`, { x, z });
  bus.emit("state");
  return row(db.prepare("SELECT * FROM places WHERE id = ?").get(r.lastInsertRowid));
}

/** nearest named place within r metres */
export function placeNear(x: number, z: number, r = 10): Place | null {
  let best: Place | null = null, bd = r;
  for (const p of listPlaces()) { const d = Math.hypot(p.x - x, p.z - z); if (d <= bd) { best = p; bd = d; } }
  return best;
}
export const findPlace = (name: string): Place | undefined => {
  const n = name.trim().toLowerCase();
  return listPlaces().find((p) => p.name.toLowerCase() === n) ?? listPlaces().find((p) => p.name.toLowerCase().includes(n));
};
