// The plugin contract: what a plugin may ask of the world, and what the engine checks before any of it happens.
// A plugin never touches the world. It runs in an isolated process against a read-only snapshot of what River perceives and answers
// with a result: text, and a list of PROPOSALS (small typed operations). The engine validates the whole list against this contract and
// against the plugin's pinned capabilities, and applies it atomically at a tick boundary, or rejects it and changes nothing.
// This file is the single definition of that contract: the host, the runner's facade, the tests and docs/PLUGIN_SDK.md all follow it.

export const SDK_VERSION = 1;

/** Hard limits on one run. Exceeding any is a typed rejection, never a partial result. */
export const LIMITS = {
  wallMs: 3000,              // real time for the whole run, then the process is killed
  cpuMs: 1000,               // synchronous CPU inside the sandbox (vm timeout)
  heapMb: 64,                // --max-old-space-size of the sandbox process
  ops: 200,                  // proposals per run
  textChars: 4000,           // the answer River reads
  resultBytes: 96_000,       // the whole serialised result
  propsBytes: 8_000,         // one entity's or item's props
  waitMs: 60_000,            // virtual time a run may spend waiting
  entities: 400,             // entities in the snapshot
  rng: 64,                   // random numbers supplied per run
} as const;

/** What a proposal needs permission for. A plugin is pinned to the set it declared at install; asking for another is refused. */
export type Capability = "items.add" | "items.take" | "entities.put" | "entities.spawn" | "entities.remove" | "needs.bump" | "log" | "activity";
export const CAPABILITIES: readonly Capability[] = ["items.add", "items.take", "entities.put", "entities.spawn", "entities.remove", "needs.bump", "log", "activity"];

/** The facade method that asks for each capability. Everything else the facade offers is a read of the snapshot. */
export const METHOD_CAPABILITY: Record<string, Capability> = {
  addItem: "items.add", takeItem: "items.take", putEntity: "entities.put", spawn: "entities.spawn", removeEntity: "entities.remove", bump: "needs.bump", setActivity: "activity",
};
/** Reads of the snapshot, available to every plugin. */
export const READ_API = new Set(["me", "nearby", "entities", "inReach", "dist", "compass", "findItem", "inventory", "timeLabel", "spotNearMe", "canDo", "items", "reach"]);
export const SDK_IMPORTS = new Set(["../toolkit.ts", "../bus.ts"]);

export type Op =
  | { op: "addItem"; tmp: string; kind: string; name: string; desc: string; qty: number; props?: Record<string, unknown>; opts?: { sources?: string[]; maker?: boolean; note?: string; defId?: string } }
  | { op: "takeItem"; id: string; qty: number }
  | { op: "putEntity"; id: string; name: string; x: number; z: number; props: Record<string, unknown> }
  | { op: "spawn"; tmp: string; kind: string; name: string; x: number; z: number; props: Record<string, unknown> }
  | { op: "removeEntity"; id: string }
  | { op: "bump"; delta: Partial<Record<"energy" | "hunger" | "mood" | "curiosity" | "warmth", number>> }
  | { op: "setActivity"; text: string }
  | { op: "log"; kind: string; text: string; data?: Record<string, unknown> };
export const OP_CAPABILITY: Record<Op["op"], Capability> = { addItem: "items.add", takeItem: "items.take", putEntity: "entities.put", spawn: "entities.spawn", removeEntity: "entities.remove", bump: "needs.bump", setActivity: "activity", log: "log" };

/** Entity kinds a plugin may create or change: the ones the client can draw. */
export const ENTITY_KINDS = new Set(["tree", "rock", "bush", "flower", "mushroom", "shell", "library", "shrine", "monolith", "campfire", "book", "item", "sprout", "structure", "pit", "trace"]);
export const LOG_KINDS = new Set(["world", "observation", "thought", "speech", "desire", "system", "need", "inscription"]);
export const NEEDS = ["energy", "hunger", "mood", "curiosity", "warmth"] as const;

/** What the sandbox hands back. The host never trusts it: everything is validated again. */
export interface RunResult {
  v: number; ok: boolean;
  text?: string; ops?: Op[]; waitMs?: number;
  /** a normal in-world failure (ToolError), a crash, or a limit hit */
  failure?: "tool" | "crash" | "limit" | "timeout" | "contract";
  message?: string;
}
/** What is journaled with the command, so a replay applies exactly this and never runs the sandbox. */
export interface Journaled extends RunResult { name: string; hash: string; gen: number; tick: number }

export class ContractError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const json = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return Infinity; } };
const WORLD = 220;                                  // the island's half-extent, with margin

function plain(v: unknown, depth = 0): boolean {      // data only: no functions, no cycles worth following, bounded depth
  if (depth > 6) return false;
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return typeof v !== "number" || Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 200 && v.every((x) => plain(x, depth + 1));
  if (isObj(v)) return Object.keys(v).length <= 100 && Object.entries(v).every(([k, x]) => k !== "__proto__" && k !== "constructor" && plain(x, depth + 1));
  return false;
}

/** Check one proposal's shape and sizes. Throws ContractError naming the problem. */
export function validateOp(o: unknown, i: number): asserts o is Op {
  const at = `proposal ${i + 1}`;
  if (!isObj(o) || typeof o.op !== "string" || !(o.op in OP_CAPABILITY)) throw new ContractError(`${at}: not a known operation`);
  const props = (v: unknown) => { if (!isObj(v) || !plain(v) || json(v) > LIMITS.propsBytes) throw new ContractError(`${at}: props must be plain data under ${LIMITS.propsBytes} bytes`); };
  switch (o.op as Op["op"]) {
    case "addItem":
      if (!str(o.kind, 40) || !o.kind || !str(o.name, 80) || !o.name || !str(o.desc, 600)) throw new ContractError(`${at}: an item needs a kind, a name and a description of sensible length`);
      if (!Number.isInteger(o.qty) || (o.qty as number) < 1 || (o.qty as number) > 99) throw new ContractError(`${at}: quantity must be a whole number from 1 to 99`);
      if (o.props !== undefined) props(o.props);
      if (o.opts !== undefined && (!isObj(o.opts) || !plain(o.opts) || json(o.opts) > 800)) throw new ContractError(`${at}: item options are not valid`);
      if (!str(o.tmp, 40)) throw new ContractError(`${at}: missing handle`); break;
    case "takeItem": if (!str(o.id, 60) || !Number.isInteger(o.qty) || (o.qty as number) < 1 || (o.qty as number) > 99) throw new ContractError(`${at}: taking needs an item and a whole quantity`); break;
    case "putEntity":
      if (!str(o.id, 60) || !str(o.name, 80) || !finite(o.x) || !finite(o.z) || Math.abs(o.x) > WORLD || Math.abs(o.z) > WORLD) throw new ContractError(`${at}: entity changes need an id, a name and a place on the island`);
      props(o.props); break;
    case "spawn":
      if (!str(o.kind, 20) || !ENTITY_KINDS.has(o.kind)) throw new ContractError(`${at}: ${typeof o.kind === "string" ? `"${o.kind}" cannot be created by a plugin` : "a new thing needs a kind"}`);
      if (!str(o.name, 80) || !o.name || !finite(o.x) || !finite(o.z) || Math.abs(o.x) > WORLD || Math.abs(o.z) > WORLD) throw new ContractError(`${at}: a new thing needs a name and a place on the island`);
      props(o.props); if (!str(o.tmp, 40)) throw new ContractError(`${at}: missing handle`); break;
    case "removeEntity": if (!str(o.id, 60)) throw new ContractError(`${at}: removal needs an id`); break;
    case "bump":
      if (!isObj(o.delta) || !Object.keys(o.delta).length || !Object.entries(o.delta).every(([k, v]) => (NEEDS as readonly string[]).includes(k) && finite(v) && Math.abs(v) <= 100)) throw new ContractError(`${at}: needs change by a number between -100 and 100`); break;
    case "setActivity": if (!str(o.text, 120)) throw new ContractError(`${at}: activity text is too long`); break;
    case "log":
      if (!str(o.kind, 20) || !LOG_KINDS.has(o.kind) || !str(o.text, 600)) throw new ContractError(`${at}: log kind must be one of ${[...LOG_KINDS].join(", ")}`);
      if (o.data !== undefined && (!isObj(o.data) || !plain(o.data) || json(o.data) > 1000)) throw new ContractError(`${at}: log data must be small plain data`); break;
  }
}

/** Validate a whole result from the sandbox, including that every proposal is something the plugin was pinned to do. */
export function validateResult(r: unknown, allowed: ReadonlySet<Capability>): asserts r is RunResult {
  if (!isObj(r) || r.v !== SDK_VERSION || typeof r.ok !== "boolean") throw new ContractError("the result is not in the expected form");
  if (json(r) > LIMITS.resultBytes) throw new ContractError("the result is too large");
  if (!r.ok) { if (!str(r.message ?? "", 600)) throw new ContractError("the failure message is too long"); return; }
  if (!str(r.text, LIMITS.textChars) || !(r.text as string).trim()) throw new ContractError("a plugin must answer with some text, not too long");
  if (!finite(r.waitMs) || (r.waitMs as number) < 0 || (r.waitMs as number) > LIMITS.waitMs) throw new ContractError(`waiting may not exceed ${LIMITS.waitMs / 1000} seconds`);
  if (!Array.isArray(r.ops) || r.ops.length > LIMITS.ops) throw new ContractError(`a run may make at most ${LIMITS.ops} proposals`);
  r.ops.forEach((o, i) => {
    validateOp(o, i);
    const cap = OP_CAPABILITY[(o as Op).op];
    if (!allowed.has(cap)) throw new ContractError(`proposal ${i + 1} needs the "${cap}" capability, which this plugin was not given`);
  });
}

/** Which capabilities a plugin's source asks for, and anything it uses that the contract does not offer. Static, so a pin can be made at install. */
export function scanSource(code: string): { capabilities: Capability[]; unsupported: string[]; imports: string[] } {
  const body = code.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const caps = new Set<Capability>(), unsupported = new Set<string>();
  for (const m of body.matchAll(/\bw\.([A-Za-z_]\w*)/g)) {
    const name = m[1]!;
    if (METHOD_CAPABILITY[name]) caps.add(METHOD_CAPABILITY[name]!); else if (!READ_API.has(name)) unsupported.add(`w.${name}`);
  }
  if (/\blog\s*\(/.test(body)) caps.add("log");
  const imports = [...code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
  for (const i of imports) if (!SDK_IMPORTS.has(i)) unsupported.add(`import of ${i}`);
  return { capabilities: [...caps].sort() as Capability[], unsupported: [...unsupported].sort(), imports };
}
