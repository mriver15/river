// Settings the human can change while River lives. Values are read at the moment they are used, so a change takes effect at once.
// Defaults come from the environment (so existing .env files still work); changes made in the UI are stored and win over them.
import { kvGet, kvSet } from "./db.ts";
import type { ConfigDef, ConfigView } from "../shared/types.ts";

const env = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] !== undefined && Number.isFinite(v) ? v : d; };

export const DEFS: ConfigDef[] = [
  { key: "dayMinutes", group: "Time & weather", label: "Length of a day", help: "Real minutes for one full day and night. Changing it keeps the current time of day.", type: "number", def: 24, min: 2, max: 240, step: 1, unit: "min" },
  { key: "weather", group: "Time & weather", label: "Weather", help: "Off means clear skies always.", type: "toggle", def: true },
  { key: "ambientRate", group: "Time & weather", label: "World events", help: "How often strange and beautiful things happen. 0 is none.", type: "number", def: env("AMBIENT_RATE", 1), min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "prey", group: "Wildlife", label: "Deer, rabbits, crows, foxes", help: "The gentle, tameable animals.", type: "toggle", def: true },
  { key: "smallWild", group: "Wildlife", label: "Snakes, bugs, fish, birds", help: "Includes the snakes and midges that bite.", type: "toggle", def: true },
  { key: "predators", group: "Wildlife", label: "Predators", help: "Wolves, boars and bears.", type: "toggle", def: true },
  { key: "damageScale", group: "Wildlife", label: "Animal damage", help: "How hard creatures hit. 0 is harmless.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "lethal", group: "Survival", label: "Death", help: "Off means River can be brought to the edge but never dies.", type: "toggle", def: process.env.RIVER_LETHAL !== "0" },
  { key: "needsRate", group: "Survival", label: "Hunger, tiredness and cold", help: "How fast they build. 0 means River never needs to eat or sleep.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },
  { key: "fallRate", group: "Survival", label: "Falls and stumbles", help: "0 means River never trips.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "thinkSeconds", group: "River's mind", label: "Pause between thoughts", help: "Longer is cheaper.", type: "number", def: env("THINK_INTERVAL_MS", 8000) / 1000, min: 1, max: 120, step: 1, unit: "s" },
  { key: "maxSteps", group: "River's mind", label: "Steps per thought", help: "0 means no limit.", type: "number", def: env("MAX_STEPS_PER_CYCLE", 0), min: 0, max: 40, step: 1 },
  { key: "temperature", group: "River's mind", label: "Temperature", help: "Higher is more adventurous and less predictable.", type: "number", def: env("RIVER_TEMPERATURE", 1.3), min: 0.5, max: 1.8, step: 0.05 },
  { key: "dreams", group: "River's mind", label: "Dreams per day", help: "0 turns dreaming off.", type: "number", def: env("MAX_DREAMS_PER_DAY", 4), min: 0, max: 10, step: 1 },

  { key: "tokensK", group: "Budget", label: "Tokens per hour", help: "Soft cap in thousands. River slows as it fills.", type: "number", def: env("MAX_TOKENS_PER_HOUR", 1_500_000) / 1000, min: 100, max: 6000, step: 100, unit: "k" },
  { key: "cycles", group: "Budget", label: "Thought cycles per hour", help: "Hard cap.", type: "number", def: env("MAX_CYCLES_PER_HOUR", 240), min: 30, max: 1000, step: 10 },
  { key: "offpeak", group: "Budget", label: "Off-peak multiplier", help: "Budget stretches by this much when the API is cheap.", type: "number", def: env("OFFPEAK_MULTIPLIER", 2), min: 1, max: 4, step: 0.5, unit: "×" },
];
const byKey = new Map(DEFS.map((d) => [d.key, d]));
let over: Record<string, number | boolean> = kvGet<Record<string, number | boolean>>("config", {});
const listeners: ((key: string, value: number | boolean, old: number | boolean) => void)[] = [];

export function cfg(key: "weather" | "prey" | "smallWild" | "predators" | "lethal"): boolean;
export function cfg(key: string): number;
export function cfg(key: string): any { const d = byKey.get(key); if (!d) throw new Error(`unknown setting ${key}`); const v = over[key]; return v === undefined ? d.def : v; }
export const onConfig = (fn: (key: string, value: number | boolean, old: number | boolean) => void) => { listeners.push(fn); };

export function setConfig(key: string, raw: unknown): boolean {
  const d = byKey.get(key); if (!d) return false;
  let v: number | boolean;
  if (d.type === "toggle") v = !!raw; else { const n = Number(raw); if (!Number.isFinite(n)) return false; v = Math.min(d.max!, Math.max(d.min!, Math.round(n / d.step!) * d.step!)); }
  const old = cfg(key); if (old === v) return true;
  over = { ...over, [key]: v }; if (v === d.def) delete over[key];
  kvSet("config", over); for (const f of listeners) f(key, v, old); return true;
}
export function resetConfig() { for (const d of DEFS) if (over[d.key] !== undefined) setConfig(d.key, d.def); over = {}; kvSet("config", {}); }
export const configView = (): ConfigView => ({ defs: DEFS, values: Object.fromEntries(DEFS.map((d) => [d.key, cfg(d.key)])) as Record<string, number | boolean> });
