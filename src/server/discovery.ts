// How River comes to know what it can do. Abilities are not handed out and not listed: one dawns when River is in the situation it fits (it holds the seed, it
// stands at the water with fish in reach, it is hurt), or when it tries something and the world allows it. A try that cannot work yet is answered with what is
// missing, in the world's words. Only the web stays with the human. The human can switch discovery off to go back to granting everything by hand.
import { bus, log } from "./bus.ts";
import { cfg } from "./config.ts";
import { every, simNow } from "./sim.ts";
import { isApproved, grantTool } from "./mind.ts";
import { bodyApi, bodyView } from "./body.ts";
import { ABILITIES, HUMAN_ONLY, abilityById, type Ability, type Situation } from "../content/abilities.ts";
import { capabilitiesOf, defForKind } from "../content/items.ts";
import { isLand } from "../shared/noise.ts";
import { obj, str, ToolError, type ToolDef } from "./toolkit.ts";
import type { World } from "./world.ts";

const SPECIES_PREDATORS = new Set(["wolf", "boar", "bear"]);
const GAP = 45_000;                                           // a new thing dawns at most this often, so a life does not begin in a flood of realisations

export class Discovery {
  private streak = new Map<string, number>();
  private lastDawn = -Infinity;
  constructor(private w: World, private tell: (msg: string) => void) {}
  start() { every(2000, () => this.tick(), "discovery"); }
  reset() { this.streak.clear(); this.lastDawn = -Infinity; }

  situation(): Situation {
    const w = this.w, me = w.me, near = w.nearby(8).map(({ e }) => ({ kind: e.kind, species: e.props.species as string | undefined, name: e.name, d: w.dist(e) }));
    const carried = [...w.inventory.values()].map((i) => ({ kind: i.kind, qty: i.qty, caps: capabilitiesOf(defForKind(i.kind)) }));
    const atShore = [0, 1, 2, 3, 4, 5, 6, 7].some((k) => !isLand(me.x + Math.cos((k * Math.PI) / 4) * 3, me.z + Math.sin((k * Math.PI) / 4) * 3, w.seed));
    const t = w.worldTime(), view = bodyView();
    const predators = [...w.entities.values()].some((e) => e.kind === "animal" && SPECIES_PREDATORS.has(e.props.species) && w.dist(e) < 18);
    return {
      carried, near, atShore, fishNear: near.some((n) => n.species === "fish" && n.d < 5), hurt: bodyApi.pain() > 0.1 || view.bleeding, threatened: predators || bodyApi.pain() > 0.5,
      visitorNear: near.some((n) => n.kind === "person" && n.d < 8), fireNear: near.some((n) => (n.kind === "campfire" || n.kind === "char") && n.d < 8),
      litFireNear: [...w.entities.values()].some((e) => e.kind === "campfire" && e.props.lit !== false && w.dist(e) < 8), warmth: me.needs.warmth, night: t < 0.23 || t > 0.78,
    };
  }

  private known(a: Ability) { return isApproved(a.id); }
  private open(a: Ability): boolean { return !HUMAN_ONLY.has(a.id) && !this.known(a); }

  /** Open an ability: it is River's now, and it is told in the world's words. */
  private dawn(a: Ability) {
    grantTool(a.id); this.lastDawn = simNow();
    log("world", a.dawn, { perceived: true }); bus.emit("deed", { kind: "discovered", name: a.id }); bus.emit("state");
    return a.dawn;
  }

  private tick() {
    if (!cfg("discovery") || bodyApi.isDead() || this.w.me.sleeping) return;
    const s = this.situation();
    for (const a of ABILITIES) {
      if (!this.open(a)) { this.streak.delete(a.id); continue; }
      const spont = typeof a.spontaneous === "function" ? a.spontaneous(s) : !!a.spontaneous;
      const now = spont && a.when(s);
      this.streak.set(a.id, now ? (this.streak.get(a.id) ?? 0) + 1 : 0);
    }
    if (simNow() - this.lastDawn < GAP) return;
    const ready = ABILITIES.find((a) => (this.streak.get(a.id) ?? 0) >= 2 && this.open(a));      // it has held for a few seconds, not for an instant
    if (ready) this.tell(`## Something has come to you\n${this.dawn(ready)}`);
  }

  /** River tries something. The world answers: it opens, or it says what is missing, or nothing comes of it. */
  attempt(text: string): string {
    if (!cfg("discovery")) return "You try it, as well as you can, and nothing comes of it.";
    const t = text.trim(); if (!t) throw new ToolError("Say what you try to do.");
    const s = this.situation(), hits = ABILITIES.filter((a) => !HUMAN_ONLY.has(a.id) && a.intent.test(t));
    if (!hits.length) return "You try it, in your head and with your hands, and nothing comes of it. Perhaps it is not something that can be done with what is here, or not yet.";
    const out: string[] = [];
    for (const a of hits) {
      if (this.known(a)) { out.push(`You already know how to do something like this.`); continue; }
      if (a.when(s)) out.push(this.dawn(a)); else out.push(a.lack || "It does not come yet.");
    }
    return [...new Set(out)].join("\n");
  }
  /** Which abilities are known right now (for the human's view). */
  view() { return ABILITIES.map((a) => ({ id: a.id, known: this.known(a), human_only: HUMAN_ONLY.has(a.id) })); }
}

const discovery = (w: World) => (w as any).discovery as Discovery;
export const TRY_TOOL: ToolDef = {
  name: "try",
  description: "Try to do something you don't yet know how to do, with what you are carrying or what is near you: say what you attempt, in your own words. The world answers: you may find that you can, or find what is missing. If it truly cannot be done here, you can ask a human with request_tool.",
  input_schema: obj({ attempt: str("What you try to do, in your own words, e.g. 'tie these sticks together'") }, ["attempt"]),
  run: (a, w) => discovery(w).attempt(String(a.attempt ?? "")),
};
void abilityById;
