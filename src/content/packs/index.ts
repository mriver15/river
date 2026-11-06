// Content packs for the physical world: materials, kinds of thing and recipes, as plain data. Each of items.ts, materials.ts and recipes.ts adds its own part
// when it loads, so a pack needs no change to the engine. (Packs of strange happenings live in src/server/packs.)
import type { Material } from "../materials.ts";
import type { ItemSpec } from "../items.ts";
import type { Recipe } from "../recipes.ts";
import { handwork } from "./handwork.ts";

export interface ContentPack {
  id: string; title: string;
  /** what it draws on, for people reading the pack (River is never told) */
  inspiration: string[];
  materials?: Record<string, Omit<Material, "id">>;
  items?: ItemSpec[];
  recipes?: Recipe[];
  /** where the raw stuff is found: seeded into the island once, the same way every time for a given island */
  deposits?: { name: string; kind: "rock" | "bush"; count: number; height: [number, number]; props: Record<string, any> }[];
}
export const CONTENT_PACKS: ContentPack[] = [handwork];
