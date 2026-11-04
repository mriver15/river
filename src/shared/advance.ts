// What an advance reports, shared by the server that runs it and the client that shows it.
export type StopReason = "target" | "death" | "decision" | "cancelled" | "budget" | "frozen";
export interface Summary {
  fromTick: number; toTick: number; simSeconds: number; fromDay: number; toDay: number;
  events: Record<string, number>; moments: string[]; deaths: number;
  items: { made: number; lost: number };
  decisions: { raised: Record<string, number>; taken: number; tokens: number };
  needs: { before: Record<string, number>; after: Record<string, number> };
}
export interface AdvanceResult { id: number; label: string; reason: StopReason; startTick: number; endTick: number; target: number; ticks: number; wallMs: number; ticksPerSec: number; summary: Summary; note?: string }
export interface AdvanceProgress { id: number; label: string; startTick: number; tick: number; target: number; pct: number; ticksPerSec: number }
