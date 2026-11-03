// Helpers shared by built-in tools and plugins in src/server/plugins/.
import type { World } from "./world.ts";

/** Throw from a tool to report a normal in-world failure back to the agent (not a crash). */
export class ToolError extends Error {}
export type Args = Record<string, any>;

export interface ToolDef {
  name: string;
  /** Shown to the agent (and to you in the Tools tab). Say what it does and what it needs. */
  description: string;
  input_schema: { type: "object"; properties: Record<string, any>; required?: string[]; additionalProperties: false };
  run: (a: Args, w: World) => Promise<string> | string;
}

export const str = (d: string) => ({ type: "string", description: d });
export const num = (d: string) => ({ type: "number", description: d });
export const obj = (properties: Record<string, any>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false as const });
