import type { Score } from "./music.ts";
import type { EmotionName } from "./emotions.ts";

export type EntityKind =
  | "tree" | "rock" | "bush" | "flower" | "mushroom" | "shell"
  | "library" | "shrine" | "monolith" | "campfire" | "pond_stone"
  | "book" | "item" | "sprout" | "structure" | "pit" | "animal" | "trace" | "char" | "grave" | "carcass";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  x: number;
  z: number;
  props: Record<string, any>;
}

export interface InventoryItem {
  id: string;
  kind: string;     // "berry", "stick", "book", or a crafted name
  name: string;
  desc: string;
  qty: number;
  props?: Record<string, any>;
}

export type Weather = "clear" | "cloudy" | "rain" | "fog" | "storm" | "windy";
export type FxKind = "meteor" | "lightning";

export interface Needs { energy: number; hunger: number; mood: number; curiosity: number; warmth: number }

export interface KeeperView { found: { idx: number; kind: string; text: string }[]; placed: number; total: number; complete: boolean }

export interface Worn { slot: "body" | "head" | "feet" | "neck"; garment: string; name: string; hex: string; warm: number; desc: string }

export interface Mark { part: string; side: "left" | "right"; kind: string; hex: string; alpha: number; sev: number; desc: string }
export interface BodyView { marks: Mark[]; shaking: number; limp: boolean; sensations: string[]; health: number; bleeding: boolean; infection: number; lives: number; dead: { cause: string; days: number } | null }

export interface AgentView {
  name: string;
  x: number; z: number; heading: number;
  activity: string;     // "walking to Old Library", "sleeping", "thinking"...
  speech: string | null;
  sleeping: boolean;
  needs: Needs;
  worldTime: number;    // fraction of day 0..1 (0 = midnight)
  weather: Weather;
  feelings: Partial<Record<EmotionName, number>>;
  day: number;
  thinking: boolean;
  worn: Worn[];
  body: BodyView;
}

export interface Desire { id: number; text: string; priority: number; status: "active" | "done" | "dropped"; created: number; outcome?: string }
export interface Interest { topic: string; weight: number; why: string; updated: number }

export type LogKind =
  | "thought" | "action" | "observation" | "speech" | "memory" | "reflection"
  | "web" | "request" | "human" | "system" | "need" | "desire" | "world" | "dream" | "inscription" | "feeling" | "moment";

export interface LogEntry { id: number; ts: number; kind: LogKind; text: string; data?: Record<string, any> }

export interface ToolInfo { name: string; description: string; status: "base" | "approved" | "locked" }
export interface ToolRequest {
  id: number; ts: number; name: string; reason: string;
  status: "pending" | "approved" | "denied"; custom: boolean; note?: string;
  /** built-in abilities that already do what River asked for (a shortlist, so you can grant one instead of building a duplicate) */
  matches?: { name: string; score: number }[];
}

export interface ForgedTool { name: string; request_id: number; status: "forging" | "staged" | "installed" | "failed" | "rejected"; code: string; log: string; ts: number }

export interface Place { id: number; name: string; x: number; z: number; note: string }
export interface JournalEntry { day: number; text: string; ts: number }

export interface Moment { id: number; ts: number; kind: "first" | "moment"; title: string; text: string; intensity: number; emotions: Partial<Record<EmotionName, number>>; x: number; z: number }

export interface CatalogEntry {
  id: string; name: string; kind: "structure" | "item" | "pack"; builtin: boolean; desc: string; text?: string; glow?: boolean; fixed?: boolean;
  /** available = in the box; in_world = placed; taken = placed, but River has picked it up or it is gone */
  status: "available" | "in_world" | "taken"; x?: number; z?: number; usual?: { x: number; z: number }; needs?: string[];
}

export interface Opinion { id: number; subject: string; stance: "love" | "like" | "dislike" | "hate"; why: string; ts: number; strength: number }
export interface PaletteColor { name: string; hex: string }
export interface Work { id: number; ts: number; name: string; shape: string; size: string; materials: Record<string, number>; colors: Record<string, string>; colorNames: Record<string, string>; x: number; z: number }
/** River's taste: what it likes and dislikes, the colours it has named, what it has made, and the style that shows in them. */
export interface TasteView { opinions: Opinion[]; palette: PaletteColor[]; works: Work[]; style: string }

export interface MemoryRow { id: number; ts: number; kind: string; text: string; importance: number; tags: string; x?: number | null; z?: number | null }

export interface ConfigDef { key: string; group: string; label: string; help: string; type: "number" | "toggle"; def: number | boolean; min?: number; max?: number; step?: number; unit?: string }
export interface ConfigView { defs: ConfigDef[]; values: Record<string, number | boolean> }

export interface Stats {
  cyclesLastHour: number; maxCyclesPerHour: number; paused: boolean; mock: boolean; model: string;
  /** the world clock: frozen, the tick it is at, and its speed (1 = the canonical 24-minute day) */
  worldPaused: boolean; simTick: number; simSpeed: number;
  tokensLastHour: number; tokensLast24h: number; maxTokensPerHour: number; cacheHitPct: number; offPeak: boolean;
}

export type ServerMsg =
  | { t: "init"; seed: number; entities: Entity[]; agent: AgentView; log: LogEntry[]; desires: Desire[]; interests: Interest[];
      inventory: InventoryItem[]; tools: ToolInfo[]; requests: ToolRequest[]; forged: ForgedTool[]; places: Place[]; journal: JournalEntry[]; keeper: KeeperView; catalog: CatalogEntry[]; taste: TasteView; moments: Moment[]; heat: number[]; scorch: number[]; stats: Stats; selfModel: string }
  | { t: "agent"; agent: AgentView }
  | { t: "config"; config: ConfigView }
  | { t: "fx"; kind: FxKind }
  | { t: "heat"; cells: number[]; scorch: number[] }
  | { t: "notice"; level: "ok" | "error"; text: string }
  | { t: "ack"; cid: string; status: "ok" | "error" | "duplicate"; result?: string }
  | { t: "score"; title: string; score: Score }
  | { t: "moment"; moment: Moment }
  | { t: "log"; entry: LogEntry }
  | { t: "entity"; op: "upsert"; entity: Entity }
  | { t: "entity"; op: "remove"; id: string }
  | { t: "state"; desires: Desire[]; interests: Interest[]; inventory: InventoryItem[]; tools: ToolInfo[]; requests: ToolRequest[]; forged: ForgedTool[]; places: Place[]; journal: JournalEntry[]; keeper: KeeperView; catalog: CatalogEntry[]; taste: TasteView;
      stats: Stats; selfModel: string };
export const HEAT_N = 60; // heat grid is HEAT_N x HEAT_N cells over the world

/** Every client message may carry `cid`, an id the client makes up. A cid the server has seen is acknowledged as a duplicate and not run again. */
export type ClientMsg = (
  | { t: "say"; text: string }
  | { t: "approve"; id: number; note?: string; builtin?: string }
  | { t: "deny"; id: number; note?: string }
  | { t: "pause"; paused: boolean }
  | { t: "sim_pause"; paused: boolean }
  | { t: "sim_speed"; speed: number }
  | { t: "dream_seed"; text: string }
  | { t: "reset_budget" }
  | { t: "reset_river"; code: string; world: boolean }
  | { t: "new_life" }
  | { t: "config_set"; key: string; value: number | boolean }
  | { t: "config_reset" }
  | { t: "skip_day" }
  | { t: "forge"; id: number }
  | { t: "install"; name: string }
  | { t: "reject"; name: string }
  | { t: "gift"; name: string; desc: string }
  | { t: "catalog_place"; id: string; x?: number; z?: number }
  | { t: "catalog_retrieve"; id: string }
  | { t: "catalog_add"; name: string; desc: string; text?: string; glow?: boolean; fixed?: boolean; place: boolean }
  | { t: "catalog_delete"; id: string }
) & { cid?: string };
