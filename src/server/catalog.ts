// The catalog: everything the world could contain that isn't simply nature. The island starts with none of it.
// Each entry is "available" (in the box) or "in world" (placed, at a spot you choose). Built-in landmarks and your own gifts live here alike.
import { db } from "./db.ts";
import { bus } from "./bus.ts";
import { isLand, mulberry32, heightAt } from "../shared/noise.ts";
import type { CatalogEntry, Entity } from "../shared/types.ts";
import type { Story } from "./story.ts";
import type { World } from "./world.ts";

export const BOOKS: [string, string, string][] = [
  ["On Tides", "tides", "The sea breathes in and out twice a day, pulled by a moon that never touches it. Fishers say the best things wash up an hour after the lowest ebb."],
  ["A Field Guide to Fungi", "fungi", "Mushrooms are only the fruit. Beneath the soil a pale web connects whole forests, passing sugar from tree to tree like gossip. Some glow faintly in the dark."],
  ["Star Charts of the Northern Sky", "astronomy", "The old navigators named seven bright stars the Lanterns. When the third Lantern rises above the monolith, they wrote, the night is exactly half over."],
  ["The Making of Rope", "craft", "Any fibre will do if you twist it against its own twist. Strength is not in the strand but in the opposition of strands."],
  ["Songs for Empty Rooms", "music", "A hollow place wants to be sung to. Hum until the room hums back; that note is the room's name. Every ruin has one."],
  ["A History of Lighthouses", "lighthouses", "A lighthouse is a promise made of stone: someone will be awake. The keepers kept journals of ships that never knew they were watched."],
];

type Kind = "structure" | "item" | "pack";
interface Spec { key?: string; desc: string; text?: string; glow?: boolean; fixed?: boolean; usual?: { x: number; z: number } | null; needs?: string[] }
interface Row { id: string; name: string; kind: Kind; builtin: boolean; spec: Spec; status: "available" | "in_world"; x: number | null; z: number | null; ids: string[]; ts: number }

const BUILTINS: { key: string; name: string; kind: Kind; desc: string; needs?: string[] }[] = [
  { key: "library", name: "Old Library", kind: "structure", desc: "A roofless stone hut with shelves still standing, and six old books on the floor (tides, fungi, star charts, rope, music, lighthouses)." },
  { key: "shrine", name: "Hilltop Shrine", kind: "structure", desc: "A small shrine of stacked stones. Offerings have been left here for a very long time." },
  { key: "monolith", name: "Humming Monolith", kind: "structure", desc: "A black stone slab twice a person's height, with symbols scratched into its base. It hums, faintly, and the hum changes." },
  { key: "campfire", name: "Campfire Ring", kind: "structure", desc: "A ring of blackened stones with a fire in it. A place someone has stayed." },
  { key: "lookout1", name: "Lookout stone", kind: "structure", desc: "A flat stone set on a rise, worn smooth by someone sitting. The view from it is wide." },
  { key: "lookout2", name: "Lookout stone (second)", kind: "structure", desc: "A second flat stone on another rise, worn smooth in the same way." },
  { key: "keeper", name: "The Keeper's trail", kind: "pack", desc: "Eleven pieces of someone's story, left around the island over a couple of hours: bottles, a collapsed camp, logbooks, marks, a letter. Some pieces need the Old Library, the Humming Monolith and the Hilltop Shrine to exist; they wait until they do.", needs: ["Old Library", "Humming Monolith", "Hilltop Shrine"] },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "thing";

export class Catalog {
  private rows = new Map<string, Row>();
  story?: Story;
  constructor(private w: World) { this.load(); }

  private load() {
    this.rows.clear();
    for (const r of db.prepare("SELECT * FROM catalog ORDER BY ts, id").all() as any[])
      this.rows.set(r.id, { id: r.id, name: r.name, kind: r.kind, builtin: !!r.builtin, spec: JSON.parse(r.spec), status: r.status, x: r.x, z: r.z, ids: JSON.parse(r.ids), ts: r.ts });
  }
  private save(r: Row) { db.prepare("INSERT INTO catalog(id,name,kind,builtin,spec,status,x,z,ids,ts) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,spec=excluded.spec,status=excluded.status,x=excluded.x,z=excluded.z,ids=excluded.ids").run(r.id, r.name, r.kind, r.builtin ? 1 : 0, JSON.stringify(r.spec), r.status, r.x, r.z, JSON.stringify(r.ids), r.ts); }

  /** Make sure the built-ins exist, and adopt any structures that are already in this world (a world made before the catalog existed). */
  sync() {
    this.load();
    for (const b of BUILTINS) {
      let r = this.rows.get(`b_${b.key}`);
      if (!r) { r = { id: `b_${b.key}`, name: b.name, kind: b.kind, builtin: true, spec: { key: b.key, desc: b.desc, needs: b.needs, usual: b.kind === "pack" ? null : this.usualSpot(b.key) }, status: "available", x: null, z: null, ids: [], ts: Date.now() }; this.rows.set(r.id, r); this.save(r); }
    }
    const ents = [...this.w.entities.values()], taken = new Set([...this.rows.values()].flatMap((r) => r.ids));
    const adopt = (key: string, pick: (e: Entity) => boolean, more: (e: Entity) => string[] = () => []) => {
      const r = this.rows.get(`b_${key}`)!; if (r.status === "in_world") return;
      const e = ents.find((x) => pick(x) && !taken.has(x.id)); if (!e) return;
      r.status = "in_world"; r.x = e.x; r.z = e.z; r.ids = [e.id, ...more(e)]; r.ids.forEach((i) => taken.add(i)); this.save(r);
    };
    adopt("library", (e) => e.kind === "library", (l) => ents.filter((b) => b.kind === "book" && Math.hypot(b.x - l.x, b.z - l.z) < 4).map((b) => b.id));
    adopt("shrine", (e) => e.kind === "shrine"); adopt("monolith", (e) => e.kind === "monolith"); adopt("campfire", (e) => e.name === "Campfire Ring");
    adopt("lookout1", (e) => e.kind === "rock" && !!e.props.vista); adopt("lookout2", (e) => e.kind === "rock" && !!e.props.vista);
    const k = this.rows.get("b_keeper")!; if (k.status !== "in_world" && this.story?.enabled) { k.status = "in_world"; this.save(k); }
    bus.emit("state");
  }

  /** Where each landmark used to be generated: a sensible spot for it (offered as "its usual place"). */
  private usualSpot(key: string): { x: number; z: number } | null {
    const w = this.w, rng = mulberry32(w.seed ^ [...key].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    if (key === "campfire") return { x: 2, z: 2 };
    let best: { x: number; z: number; h: number } | null = null;
    for (let i = 0; i < 500; i++) {
      const x = (rng() * 2 - 1) * (key === "monolith" ? 50 : 40), z = (rng() * 2 - 1) * (key === "monolith" ? 50 : 40), h = heightAt(x, z, w.seed);
      if (!isLand(x, z, w.seed)) continue;
      if (key === "shrine") { if (!best || h > best.h) best = { x, z, h }; }
      else if (key === "library") { if (h > 1 && Math.hypot(x, z) < 30) return { x, z }; }
      else if (key === "monolith") { if (Math.hypot(x, z) > 18) return { x, z }; }
      else if (h >= 3.6) return { x, z };                                              // lookouts: on a rise
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  // ---------- the human's operations ----------
  view(): CatalogEntry[] {
    return [...this.rows.values()].map((r) => {
      const present = r.kind === "pack" ? r.status === "in_world" : r.ids.some((i) => this.w.entities.has(i));
      return { id: r.id, name: r.name, kind: r.kind, builtin: r.builtin, desc: r.spec.desc, text: r.spec.text, glow: r.spec.glow, fixed: r.spec.fixed, needs: r.spec.needs,
        status: r.status === "available" ? "available" : present ? "in_world" : "taken", x: r.x ?? undefined, z: r.z ?? undefined, usual: r.spec.usual ?? undefined };
    });
  }

  add(o: { name: string; desc: string; text?: string; glow?: boolean; fixed?: boolean }): string {
    const name = o.name.trim().slice(0, 60); if (!name) throw new Error("Give it a name.");
    const id = `c_${slug(name)}_${Date.now().toString(36)}`;
    const r: Row = { id, name, kind: o.fixed || o.glow ? "structure" : "item", builtin: false, spec: { desc: o.desc.trim().slice(0, 400) || "Something that wasn't here before.", text: o.text?.trim().slice(0, 1200) || undefined, glow: !!o.glow, fixed: !!o.fixed }, status: "available", x: null, z: null, ids: [], ts: Date.now() };
    this.rows.set(id, r); this.save(r); bus.emit("state"); return id;
  }

  /** Put an entry into the world at (x, z); with no spot, a few paces from River. Returns where it went. */
  place(id: string, at?: { x: number; z: number }): { x: number; z: number } {
    const r = this.rows.get(id); if (!r) throw new Error("No such entry.");
    if (r.status === "in_world" && this.view().find((v) => v.id === id)?.status === "in_world") this.retrieve(id);          // moving it
    const w = this.w, p = at ?? (() => { const q = w.spotNearMe(3.2); return { x: q.x, z: q.z }; })();
    if (r.kind === "pack") { this.story?.setEnabled(true); r.status = "in_world"; this.save(r); bus.emit("state"); return p; }
    if (!isLand(p.x, p.z, w.seed)) throw new Error("That spot is water or off the island.");
    const ids: string[] = [], s = r.spec, mk = (kind: any, name: string, x: number, z: number, props: Record<string, any>) => { const e = w.spawn(kind, name, x, z, { catalog: id, ...props }); ids.push(e.id); return e; };
    switch (s.key) {
      case "library": mk("library", "Old Library", p.x, p.z, { desc: "A roofless stone hut, shelves still standing. Books lie scattered on the floor." });
        BOOKS.forEach(([title, topic, text], i) => { const a = (i / BOOKS.length) * Math.PI * 2; mk("book", `book: ${title}`, p.x + Math.cos(a) * 2.2, p.z + Math.sin(a) * 2.2, { takeable: true, item: "book", desc: `A worn book titled "${title}".`, text, topic, title }); }); break;
      case "shrine": mk("shrine", "Hilltop Shrine", p.x, p.z, { desc: "A small shrine of stacked stones. Offerings have been left here for a very long time. The view is wide." }); break;
      case "monolith": mk("monolith", "Humming Monolith", p.x, p.z, { desc: "A black stone slab twice your height. It hums very faintly, and the hum changes with the time of day. Strange symbols are scratched into the base." }); break;
      case "campfire": mk("campfire", "Campfire Ring", p.x, p.z, { desc: "A ring of blackened stones with a fire in it. Someone has been camping here." }); break;
      case "lookout1": case "lookout2": mk("rock", "lookout stone", p.x, p.z, { desc: "A flat stone set on a rise, worn smooth by someone sitting. The view is wide.", vista: true }); break;
      default:
        if (s.fixed || s.glow || r.kind === "structure") mk("structure", r.name, p.x, p.z, { desc: s.desc, glow: !!s.glow, text: s.text });
        else mk("item", r.name, p.x, p.z, { takeable: true, item: slug(r.name), itemName: r.name, desc: s.desc, text: s.text });
    }
    r.status = "in_world"; r.x = p.x; r.z = p.z; r.ids = ids; this.save(r); bus.emit("state"); return p;
  }

  /** Back into the box. */
  retrieve(id: string) {
    const r = this.rows.get(id); if (!r) return;
    if (r.kind === "pack") this.story?.setEnabled(false);
    for (const e of r.ids) if (this.w.entities.has(e)) this.w.removeEntity(e);
    r.status = "available"; r.x = null; r.z = null; r.ids = []; this.save(r); bus.emit("state");
  }

  remove(id: string) {
    const r = this.rows.get(id); if (!r || r.builtin) return;
    this.retrieve(id); this.rows.delete(id); db.prepare("DELETE FROM catalog WHERE id = ?").run(id); bus.emit("state");
  }

  /** A new life: everything goes back in the box (the table was wiped by the reset). */
  reset() { this.rows.clear(); this.sync(); }
  isPlaced(key: string) { return this.rows.get(`b_${key}`)?.status === "in_world"; }
}
