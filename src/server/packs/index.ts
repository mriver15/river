// Content packs: sets of strange happenings (and the books that go with them) that the world's director draws from, each written after something from stories
// and psychology. A pack is a plain data file; adding one needs no change to the engine. Everything in a pack is a stimulus: it describes what River perceives and
// never says what to do, what it means, or what it is worth.
import type { Ctx, Theme, Tone, WEvent } from "../ambient.ts";
import { zone } from "./zone.ts";
import { mind } from "./mind.ts";

export interface PackEvent extends WEvent { tone: Tone; theme: Theme }
export interface Pack {
  id: string; title: string;
  /** what it draws on, for people reading the pack (River is never told) */
  inspiration: string[];
  events: PackEvent[];
  /** [title, topic, text]: books that can turn up in the Old Library */
  books?: [string, string, string][];
}
export type { Ctx };

export const PACKS: Pack[] = [zone, mind];
export const packIds = () => PACKS.map((p) => p.id);
/** Which packs are switched on: a comma-separated list, or "all". */
export const enabledPacks = (setting: string): Pack[] => {
  const want = setting.trim().toLowerCase(); if (!want || want === "none") return [];
  if (want === "all") return PACKS;
  const ids = new Set(want.split(/[\s,]+/).filter(Boolean));
  return PACKS.filter((p) => ids.has(p.id));
};
export const packOfEvent = (name: string): Pack | undefined => PACKS.find((p) => p.events.some((e) => e.name === name));
