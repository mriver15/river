// The known world: entities River has actually perceived. Activities choose targets from this set, and the route planner
// only avoids obstacles in it, so nothing River has not seen can be walked to, gathered from, or revealed by a plan.
import { db } from "./db.ts";
import { every, simTick, STEP_MS } from "./sim.ts";
import type { World } from "./world.ts";
import type { Entity } from "../shared/types.ts";

export class Knowledge {
  ids = new Set<string>();
  constructor(private w: World) {
    for (const r of db.prepare("SELECT id FROM known_entities").all() as { id: string }[]) this.ids.add(r.id);
    // A world that existed before knowledge was tracked: River has seen what is near it, not the whole island.
    if (!this.ids.size && w.entities.size && (db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n > 0) {
      for (const e of w.entities.values()) if (Math.hypot(e.x - w.me.x, e.z - w.me.z) < 60) this.add(e.id);
    }
    w.isKnown = (e: Entity) => this.ids.has(e.id);
    w.learnNearby = (e: Entity) => this.add(e.id);
  }
  has(id: string) { return this.ids.has(id); }
  private add(id: string) { if (this.ids.has(id)) return; this.ids.add(id); db.prepare("INSERT OR IGNORE INTO known_entities(id, tick) VALUES(?,?)").run(id, simTick()); }
  /** Everything within sight becomes known. */
  observe() {
    const r = this.w.sightRadius(), me = this.w.me;
    for (const e of this.w.entities.values()) if (Math.hypot(e.x - me.x, e.z - me.z) <= r) this.add(e.id);
  }
  /** Mark things known by other means: placed in River's hands, announced, seen from a height. */
  learn(e: Entity) { this.add(e.id); }
  /** Every tick, so what River can see is always already known when it is described or asked about. */
  start() { every(STEP_MS, () => this.observe(), "knowledge"); }
  reset() { this.ids.clear(); db.exec("DELETE FROM known_entities"); }
}
