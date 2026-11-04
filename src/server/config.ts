// Settings the human can change while River lives. Values are read at the moment they are used, so a change takes effect at once.
// Defaults come from the environment (so existing .env files still work); changes made in the UI are stored and win over them.
import { db, kvGet, kvSet } from "./db.ts";
import { simTick } from "./sim.ts";
import { canonicalHash } from "../sim/hash.ts";
import { PRESETS, presetById } from "../content/presets.ts";
import { RULES_VERSION } from "../content/materials.ts";
import type { ConfigDef, ConfigView } from "../shared/types.ts";

const env = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] !== undefined && Number.isFinite(v) ? v : d; };

export const DEFS: ConfigDef[] = [
  { key: "dayMinutes", group: "Time & weather", label: "Length of a day", help: "Real minutes for one full day and night. Changing it keeps the current time of day.", type: "number", def: 24, min: 2, max: 240, step: 1, unit: "min" },
  { key: "sightDay", group: "Perception", label: "How far River sees by day", help: "Metres in clear daylight. Fog, storms and rain shorten it; a fire lengthens the night.", type: "number", def: 32, min: 10, max: 80, step: 1, unit: "m" },
  { key: "sightNight", group: "Perception", label: "How far River sees at night", help: "Metres in the dark, away from any light.", type: "number", def: 11, min: 4, max: 40, step: 1, unit: "m" },
  { key: "emotionSpeed", group: "Feelings", label: "How fast feelings fade", help: "Scales every feeling's half-life: 2 means they fade twice as fast, 0.5 half as fast. Loneliness has no half-life and is unaffected.", type: "number", def: 1, min: 0.25, max: 4, step: 0.25, unit: "×" },
  { key: "offlineCatchup", group: "Time & weather", label: "Catch up after an absence", help: "Off: the world waits, frozen, while the server is not running. On: when it starts again, the world runs forward by the time that passed, up to the limit below, and tells you what happened.", type: "toggle", def: false },
  { key: "catchupMaxDays", group: "Time & weather", label: "Longest catch-up", help: "World days, at most, simulated after an absence. Time beyond this is reported as not simulated.", type: "number", def: 1, min: 0.1, max: 7, step: 0.1, unit: "days" },
  { key: "weather", group: "Time & weather", label: "Weather", help: "Off means clear skies always.", type: "toggle", def: true },
  { key: "ambientRate", group: "Time & weather", label: "World events", help: "How often strange and beautiful things happen. 0 is none.", type: "number", def: env("AMBIENT_RATE", 1), min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "prey", group: "Wildlife", label: "Deer, rabbits, crows, foxes", help: "The gentle, tameable animals.", type: "toggle", def: true },
  { key: "smallWild", group: "Wildlife", label: "Snakes, bugs, fish, birds", help: "Includes the snakes and midges that bite.", type: "toggle", def: true },
  { key: "predators", group: "Wildlife", label: "Predators", help: "Wolves, boars and bears.", type: "toggle", def: true },
  { key: "damageScale", group: "Wildlife", label: "Animal damage", help: "How hard creatures hit. 0 is harmless.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "lethal", group: "Survival", label: "Death", help: "Off means River can be brought to the edge but never dies.", type: "toggle", def: process.env.RIVER_LETHAL !== "0" },
  { key: "needsRate", group: "Survival", label: "Hunger, tiredness and cold", help: "How fast they build. 0 means River never needs to eat or sleep.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },
  { key: "reflexEscape", group: "Survival", label: "Instinct to flee", help: "On: River runs a short way from a charging animal before it has time to think. Off: it stands its ground until it decides otherwise.", type: "toggle", def: true },
  { key: "reflexFire", group: "Instincts", label: "Fire that stops River", help: "How close a burning thing must be, in metres, before River stops what it is doing.", type: "number", def: 4.5, min: 1, max: 12, step: 0.5, unit: "m" },
  { key: "reflexThreat", group: "Instincts", label: "Charging animal that stops River", help: "How close a charging predator must be, in metres, before River stops and runs.", type: "number", def: 9, min: 3, max: 25, step: 1, unit: "m" },
  { key: "reflexEscapeDistance", group: "Instincts", label: "How far River runs", help: "The length of the instinctive run away from danger, in metres.", type: "number", def: 12, min: 4, max: 30, step: 1, unit: "m" },
  { key: "harvestSeconds", group: "Instincts", label: "Time to take one thing", help: "Seconds of world time to gather one unit.", type: "number", def: 3, min: 0.5, max: 15, step: 0.5, unit: "s" },
  { key: "fallRate", group: "Survival", label: "Falls and stumbles", help: "0 means River never trips.", type: "number", def: 1, min: 0, max: 3, step: 0.25, unit: "×" },

  { key: "thinkSeconds", group: "River's mind", label: "Pause between thoughts", help: "Longer is cheaper.", type: "number", def: env("THINK_INTERVAL_MS", 8000) / 1000, min: 1, max: 120, step: 1, unit: "s" },
  { key: "followUpSeconds", group: "River's mind", label: "Pause after acting", help: "How long River waits, after doing something, before deciding what to do next. Shorter means more actions and more tokens.", type: "number", def: 2, min: 0.5, max: 60, step: 0.5, unit: "s" },
  { key: "maxSteps", group: "River's mind", label: "Calls per decision", help: "How many times the model may be asked within one decision (it can give several actions per reply). Information gathering allows a follow-up; any action ends the decision. 0 means no limit.", type: "number", def: env("MAX_STEPS_PER_CYCLE", 3), min: 0, max: 40, step: 1 },
  { key: "packetTokens", group: "River's mind", label: "Size of what River is shown", help: "Input tokens for one decision, including its abilities. State, observations and memories share what the fixed parts leave; danger and a human's words are never cut.", type: "number", def: env("PACKET_TOKENS", 7000), min: 2000, max: 24000, step: 500 },
  { key: "reflectMinutes", group: "River's mind", label: "Longest time between reflections", help: "River reflects when enough has happened to it, or after this many world minutes, whichever comes first.", type: "number", def: 45, min: 5, max: 600, step: 5, unit: "min" },
  { key: "traceAll", group: "River's mind", label: "Full feeling traces", help: "Record every small change to a feeling instead of summing the tiny ones. For debugging; the log grows faster.", type: "toggle", def: false },
  { key: "temperature", group: "River's mind", label: "Temperature", help: "Higher is more adventurous and less predictable.", type: "number", def: env("RIVER_TEMPERATURE", 1.3), min: 0.5, max: 1.8, step: 0.05 },
  { key: "dreams", group: "River's mind", label: "Dreams per day", help: "0 turns dreaming off.", type: "number", def: env("MAX_DREAMS_PER_DAY", 4), min: 0, max: 10, step: 1 },

  { key: "reservePct", group: "Budget", label: "Kept for urgent matters", help: "Share of the hourly tokens only a human's words and danger may use.", type: "number", def: 20, min: 0, max: 50, step: 5, unit: "%" },
  { key: "budgetPause", group: "Budget", label: "Freeze the world when the budget is spent", help: "On: the world waits at the next decision until tokens free up. Off: the world carries on, River just stops deciding.", type: "toggle", def: true },
  { key: "tokensK", group: "Budget", label: "Tokens per hour", help: "Soft cap in thousands. River slows as it fills.", type: "number", def: env("MAX_TOKENS_PER_HOUR", 1_500_000) / 1000, min: 100, max: 6000, step: 100, unit: "k" },
  { key: "cycles", group: "Budget", label: "Thought cycles per hour", help: "Hard cap.", type: "number", def: env("MAX_CYCLES_PER_HOUR", 240), min: 30, max: 1000, step: 10 },
  { key: "offpeak", group: "Budget", label: "Off-peak multiplier", help: "Budget stretches by this much when the API is cheap.", type: "number", def: env("OFFPEAK_MULTIPLIER", 2), min: 1, max: 4, step: 0.5, unit: "×" },
];
/** Who owns each parameter, and what it only means when something else is on. Everything here takes effect the next time it is read. */
const OWNER: Record<string, string> = { "Time & weather": "clock", Wildlife: "wildlife", Survival: "body", Instincts: "activities", "River's mind": "brain", Budget: "brain", Perception: "perception", Feelings: "emotions" };
const NEEDS: Record<string, string[]> = { reflexEscapeDistance: ["reflexEscape"], damageScale: ["predators"], catchupMaxDays: ["offlineCatchup"] };
export const RULESET = `rules-${RULES_VERSION}`;
for (const d of DEFS) { d.owner ??= OWNER[d.group] ?? "world"; d.applies ??= "immediate"; d.ruleset ??= RULESET; if (NEEDS[d.key]) d.needs ??= NEEDS[d.key]; }
const byKey = new Map(DEFS.map((d) => [d.key, d]));
let over: Record<string, number | boolean> = kvGet<Record<string, number | boolean>>("config", {});
const listeners: ((key: string, value: number | boolean, old: number | boolean) => void)[] = [];

export function cfg(key: "weather" | "prey" | "smallWild" | "predators" | "lethal" | "traceAll" | "offlineCatchup"): boolean;
export function cfg(key: string): number;
export function cfg(key: string): any { const d = byKey.get(key); if (!d) throw new Error(`unknown setting ${key}`); const v = over[key]; return v === undefined ? d.def : v; }
export const onConfig = (fn: (key: string, value: number | boolean, old: number | boolean) => void) => { listeners.push(fn); };

/** The values now in force, as one immutable set identified by its hash. A snapshot or a checkpoint names the set it ran under. */
export const effective = (): Record<string, number | boolean> => Object.fromEntries(DEFS.map((d) => [d.key, cfg(d.key)]));
export const paramSet = (): string => canonicalHash({ ruleset: RULESET, values: effective() }).slice(0, 16);
/** Remember the set in force and when it began, so a past run can be matched to the parameters it ran under. */
export function recordParams(cause: string) {
  const hash = paramSet(), last = db.prepare("SELECT hash FROM sim_param_log ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  db.prepare("INSERT OR IGNORE INTO sim_param_sets(hash, ruleset, json, first_tick) VALUES(?,?,?,?)").run(hash, RULESET, JSON.stringify(effective()), simTick());
  if (last?.hash !== hash) db.prepare("INSERT INTO sim_param_log(tick, hash, cause) VALUES(?,?,?)").run(simTick(), hash, cause);
}
export const paramHistory = () => db.prepare("SELECT l.tick, l.hash, l.cause, s.json FROM sim_param_log l JOIN sim_param_sets s ON s.hash = l.hash ORDER BY l.seq DESC LIMIT 50").all() as { tick: number; hash: string; cause: string; json: string }[];

export function setConfig(key: string, raw: unknown): boolean {
  const d = byKey.get(key); if (!d) return false;
  let v: number | boolean;
  if (d.type === "toggle") v = !!raw; else { const n = Number(raw); if (!Number.isFinite(n)) return false; v = Math.min(d.max!, Math.max(d.min!, Math.round(n / d.step!) * d.step!)); }
  const old = cfg(key); if (old === v) return true;
  over = { ...over, [key]: v }; if (v === d.def) delete over[key];
  kvSet("config", over); recordParams(`${key} = ${v}`); for (const f of listeners) f(key, v, old); return true;
}
/** Apply a named preset: each value in it, as one change. Returns the keys it changed. */
export function applyPreset(id: string): string[] | null {
  const p = presetById(id); if (!p) return null;
  const changed: string[] = [];
  if (id === "default") { resetConfig(); return ["(all)"]; }
  for (const [k, v] of Object.entries(p.values)) if (cfg(k) !== v && setConfig(k, v)) changed.push(k);
  return changed;
}
export function resetConfig() { for (const d of DEFS) if (over[d.key] !== undefined) setConfig(d.key, d.def); over = {}; kvSet("config", {}); recordParams("reset to defaults"); }
export const configView = (): ConfigView => ({ defs: DEFS, values: effective(), paramSet: paramSet(), ruleset: RULESET, presets: PRESETS.map(({ id, label, help }) => ({ id, label, help })) });
