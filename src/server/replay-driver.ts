// Replaying a recorded life: restore its boot snapshot, then run its command journal at the recorded ticks through the same runtime.
// Used by scripts/replay.ts (verification: run to the end and compare every checkpoint) and by the read-only visual replay (the same
// stepping, paced for watching, with the client drawing what the world does). Nothing here calls a model or the network.
import * as sim from "./sim.ts";
import { humanCommand, type Runtime } from "./runtime.ts";
import { applyDream } from "./dreams.ts";
import { resetApply } from "./reset.ts";
import { beginGeneration } from "./lifecycle.ts";
import type { Cmd } from "./recorder.ts";

const drain = () => new Promise<void>((r) => setImmediate(r));

export class ReplayDriver {
  ci = 0;
  readonly pending: Promise<unknown>[] = [];
  constructor(private rt: Runtime, readonly cmds: Cmd[], readonly endTick: number) {}

  /** One command, the way the live world received it. */
  private apply(c: Cmd) {
    const rt = this.rt;
    if (c.type === "tool" && c.source === "brain") this.pending.push(rt.agent.execNow(c.payload.name, c.payload.input, undefined, undefined, { status: c.status, result: c.result }, c.payload.ext));
    else if (c.source === "external" && c.type === "relevance") rt.emotions.resolveRelevance(c.payload);
    else if (c.source === "external" && c.type === "dream") applyDream(rt.world, c.payload, () => {}, { feelings: () => rt.emotions.describe(), after: () => rt.emotions.afterDream() });
    else if (c.source === "brain") rt.agent.applyBrain(c.payload);
    else if (c.source === "human" && c.type === "reset_start") beginGeneration();
    else if (c.source === "human" && c.type === "reset_apply") resetApply(c.payload, rt);
    else if (c.source === "human") humanCommand(rt, c.payload);
  }

  /** Admit what is due at this tick, then run one tick. Returns false when there is nothing more to do. */
  async step(): Promise<boolean> {
    if (sim.simTick() >= this.endTick) return false;
    while (this.ci < this.cmds.length && this.cmds[this.ci]!.tick <= sim.simTick()) { this.apply(this.cmds[this.ci++]!); await drain(); }   // one at a time: live ran them in sequence
    if (sim.simPaused()) return this.ci < this.cmds.length;                      // a frozen world does not tick; the journal says when it thaws
    sim.runTicks(1);
    await drain();
    return true;
  }
  /** Let what the journal started finish (tool calls in flight at the end). */
  async settle(ms = 2000) { await Promise.race([Promise.allSettled(this.pending), new Promise((r) => setTimeout(r, ms))]); }
}
