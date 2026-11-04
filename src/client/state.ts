import type { Scene3D } from "./scene.ts";
import type { Ambience } from "./audio.ts";
import type { AgentView, CatalogEntry, TasteView, ClientMsg, Desire, ForgedTool, Interest, InventoryItem, JournalEntry, KeeperView, Moment, Place, Stats, ToolInfo, ToolRequest, ConfigView } from "../shared/types.ts";

export const S = {
  agent: null as AgentView | null, desires: [] as Desire[], interests: [] as Interest[], inventory: [] as InventoryItem[],
  tools: [] as ToolInfo[], requests: [] as ToolRequest[], forged: [] as ForgedTool[], places: [] as Place[], journal: [] as JournalEntry[], moments: [] as Moment[], keeper: { found: [], placed: 0, total: 11, complete: false } as KeeperView, catalog: [] as CatalogEntry[], taste: { opinions: [], palette: [], works: [], style: "" } as TasteView,
  config: null as ConfigView | null, heat: [] as number[], scorch: [] as number[], stats: null as Stats | null, selfModel: "",
};
export const ctx = { scene: null as Scene3D | null, audio: null as Ambience | null, seed: 1337, live: false };

let socket: WebSocket | null = null;
export const setSocket = (w: WebSocket) => { socket = w; };
/** Each message gets an id, so a retry the server has already seen is not run twice. */
const makeCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const send = (m: ClientMsg) => socket?.readyState === 1 && socket.send(JSON.stringify({ cid: makeCid(), ...m }));

/** Each tab registers how to (re)draw itself; chrome calls it when the tab is shown or data changes. */
export const renderers: Record<string, () => void> = {};
export const TABS = ["log", "mind", "story", "map", "items", "tools", "memory", "brain"] as const;
export type TabName = (typeof TABS)[number];
export const isTab = (n: TabName) => document.getElementById(`tab-${n}`)?.classList.contains("active") ?? false;
