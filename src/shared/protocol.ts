// Protocol compatibility: a version in the first message, and a sequence number on every broadcast, so a client that missed one asks for
// the whole state instead of drawing a world with a hole in it. A reconnect cannot repeat a command: every client message carries an id
// the server remembers (see `cid` in ClientMsg).
export const PROTOCOL_VERSION = 2;

export type SeqVerdict = "ok" | "gap" | "stale";
export class SeqTracker {
  last: number | null = null;
  /** Start from a full snapshot taken at `seq`. */
  reset(seq: number) { this.last = seq; }
  /** Judge the next broadcast: the one after the last (ok), an older one (stale, ignore), or one with others missing (gap, resync). */
  accept(seq: number): SeqVerdict {
    if (this.last === null) return "gap";                  // nothing to build on yet: ask for the whole state
    if (seq <= this.last) return "stale";
    if (seq !== this.last + 1) return "gap";
    this.last = seq; return "ok";
  }
}
