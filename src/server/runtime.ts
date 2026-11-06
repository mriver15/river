// The world and everything that acts in it, built the same way for the live server and for headless replay.
// Nothing here opens a socket or calls a model.
import { applyPreset, cfg, onConfig, resetConfig, setConfig } from "./config.ts";
import { kvSet } from "./db.ts";
import { bus, log } from "./bus.ts";
import { addMemory, setLocator, setSalience } from "./memory.ts";
import { InnerLife } from "./inner.ts";
import { Advancer } from "./advance.ts";
import { startLife } from "./life.ts";
import { Agent } from "./agent.ts";
import { loadPlugins } from "./tools.ts";
import { reapInterrupted } from "./smith.ts";
import { World } from "./world.ts";
import { Ambient } from "./ambient.ts";
import { Fire } from "./fire.ts";
import { Emotions } from "./emotions.ts";
import { Creatures } from "./creatures.ts";
import { Story } from "./story.ts";
import { Catalog } from "./catalog.ts";
import { bodyApi } from "./body.ts";
import { Wildlife } from "./wildlife.ts";
import { weatherStructures } from "./building.ts";
import { Knowledge } from "./knowledge.ts";
import { Activities } from "./activities.ts";
import { setupDeath } from "./death.ts";
import { startDreams } from "./dreams.ts";
import { startJournal } from "./journal.ts";
import { every, STEP_MS, setSimPaused, setSimSpeed, speedForDayMinutes, inject } from "./sim.ts";
import { CHECKPOINT_EVERY, checkpoint, registerState, recordCommand, finishCommand, isReplaying } from "./recorder.ts";
import { simTick } from "./sim.ts";
import { autoDecision, decideRequest, GATED, pendingRequests } from "./mind.ts";
import { forge } from "./smith.ts";
import type { ClientMsg, ToolRequest } from "../shared/types.ts";

export async function createRuntime() {
  await loadPlugins();
  reapInterrupted();
  const world = new World();
  world.init();
  const emotions = new Emotions(world);
  const agent = new Agent(world, emotions);
  const ambient = new Ambient(world, (msg) => agent.notify(msg, false));
  ambient.emotions = emotions;
  const creatures = new Creatures(world, ambient.say);
  ambient.creatures = creatures; world.creatures = creatures;
  const story = new Story(world); story.emotions = emotions; world.story = story;
  const catalog = new Catalog(world); catalog.story = story; catalog.sync();
  bodyApi.attach(world, emotions, (msg) => agent.notify(msg, true, "danger"));
  setupDeath(world, agent); if (bodyApi.isDead()) agent.setPaused(true, true);
  const wildlife = new Wildlife(world, emotions, ambient.say, (msg) => agent.notify(msg, true, "danger"));
  const fire = new Fire(world, ambient.say, (msg) => agent.notify(msg, true, "danger"));
  world.fire = fire;
  const knowledge = new Knowledge(world);
  const inner = new InnerLife(world, emotions);
  startLife(world);
  const activities = new Activities(world, (msg, wake, kind) => agent.notify(msg, wake, kind), () => wildlife.threat());
  // When the token budget runs out the brain may ask for the world to wait; it goes through the journal like any other freeze.
  agent.setWorldPaused = (p, why) => void inject(() => { const m = { t: "sim_pause" as const, paused: p }; const seq = recordCommand("human", "sim_pause", m); humanCommand({ world, agent, emotions, ambient, creatures, story, catalog, wildlife, fire, knowledge, activities } as Runtime, m); finishCommand(seq, "ok", why); });
  activities.resume();
  const advancer = new Advancer({ world, agent });
  const made = { world, emotions, inner, advancer, agent, ambient, creatures, story, catalog, wildlife, fire, knowledge, activities };
  bus.on("tool-request", (req: ToolRequest) => autoHandle(made, req));
  bus.on("tool-installed", (f: { name: string }) => { agent.notify(`Your new tool "${f.name}" has been built and is now usable. Try it!`); addMemory(`The tool "${f.name}" was built for me and is now available.`, 7, ["tools"]); });
  return made;
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;

/** Register every periodic system, in a fixed order (the order decides each system's phase within a second). Does not start the clock. */
export function startSystems(rt: Runtime) {
  const { world, emotions, agent, ambient, creatures, story, wildlife, fire } = rt;
  registerState("emotions", () => emotions.state());
  registerState("inner", () => rt.inner.state());
  setSalience(() => emotions.salience());
  registerState("creatures", () => [...rt.creatures.rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));   // the live rows, not the table (which is written at commit)
  every(STEP_MS, () => world.tick(STEP_MS / 1000), "world");
  rt.knowledge.start();
  rt.inner.start();
  rt.activities.start();
  setSimSpeed(speedForDayMinutes(cfg("dayMinutes")));
  onConfig((key, v) => {
    if (key === "autoApprove" || key === "autoApproveWeb" || key === "autoApproveMax") sweepPending(rt);                 // switching it on answers what is already waiting
    if (key === "dayMinutes") setSimSpeed(speedForDayMinutes(Number(v)));   // day length is the clock speed; the calendar never moves
    if (key === "weather" && !cfg("weather")) { world.weather = "clear"; kvSet("weather", { w: "clear", until: 0 }); }
    if (key === "predators" || key === "smallWild") wildlife.refresh();
    if (key === "prey") ambient.refreshWildlife();
  });
  // slow upkeep of how things stand: weather wets what lies out in it, warmth dries it, temperatures drift toward the air's
  every(5000, () => {
    const t = world.worldTime(), night = t < 0.23 || t > 0.78, wet = world.weather === "storm" ? 1.5 : world.weather === "rain" ? 1 : world.weather === "fog" ? 0.3 : 0;
    const hot = [...world.entities.values()].filter((e) => (e.kind === "campfire" && e.props.lit !== false) || e.props.burning);
    weatherStructures(world, 5);
    world.items.tickCondition(5, wet, (night ? 8 : 18) - (wet > 0 ? 3 : 0), (x, z) => hot.reduce((h, e) => { const d = Math.hypot(e.x - x, e.z - z); return d < 4 ? Math.max(h, 1 - d / 4) : h; }, 0));
  }, "items");
  ambient.start();
  fire.start();
  bus.on("gift_taken", (e: { id: string; name: string }) => {             // River took up something left for it: that it came from someone is part of what it holds
    addMemory(`I picked up ${e.name}. Someone I cannot see left it where I would find it.`, 6, ["gift", "human"]);
    emotions.contact(0.3); emotions.bump("wonder", 0.25, "something was left for me"); bus.emit("deed", { kind: "gift", name: e.name });
  });
  setLocator(() => ({ x: world.me.x, z: world.me.z }));
  emotions.start(); bodyApi.start(); wildlife.start(); creatures.start(); story.start();
  startDreams(world, (msg) => agent.notify(msg, false), { feelings: () => emotions.describe(), after: () => emotions.afterDream() });
  startJournal(world);
  every(STEP_MS, () => { if (simTick() % CHECKPOINT_EVERY === 0) checkpoint(world); }, "checkpoint");
}

/**
 * A tool request is decided (by a human, or automatically), River is told, and, if it was a new tool that was approved, the smith is to build it.
 * One path for both, so what River hears and remembers is the same whoever decided.
 */
function decideAndTell(rt: { agent: Agent }, id: number, approve: boolean, note?: string, builtin?: string): { forge?: ToolRequest } {
  const r = decideRequest(id, approve, note, approve ? builtin : undefined);
  if (!r) return {};
  const granted = approve && builtin && builtin in GATED ? builtin : null;
  const verdict = approve
    ? (granted ? `Your request "${r.name}" was APPROVED. You can now do it with the ability called "${granted}": ${GATED[granted]}`
      : r.name in GATED ? `Your request for "${r.name}" was APPROVED. You can now use it: ${GATED[r.name]}` : `Your idea for a new tool "${r.name}" was approved in principle — the human may build it; it isn't usable yet.`)
    : `Your request for "${r.name}" was DENIED.`;
  rt.agent.notify(`${verdict}${note && !note.startsWith("auto-approved") ? ` The human added: "${note}"` : ""}`, true, "contact");
  addMemory(verdict, 6, ["tools"]);
  // Building a new tool calls a model and writes a file: not replayed.
  return approve && !granted && !(r.name in GATED) ? { forge: r } : {};
}
/** Automatic approval, when the human has turned it on: answer a request at once, from the settings alone, so a replay answers the same way. */
function autoHandle(rt: { agent: Agent }, req: ToolRequest) {
  const v = autoDecision(req); if (!v) return;
  log("request", `Auto-approved "${req.name}": ${v.why}.`, { id: req.id });
  const out = decideAndTell(rt, req.id, true, `auto-approved: ${v.why}`, v.builtin);
  if (out.forge && !isReplaying()) void forge(out.forge);
}
/** Whatever is already waiting when automatic approval is switched on. */
function sweepPending(rt: { agent: Agent }) { for (const r of pendingRequests()) autoHandle(rt, r); }

/** Human commands that change the world. Live and replay both run them through here. */
export const REPLAYABLE = new Set(["say", "presence", "skip_day", "config_preset", "config_set", "config_reset", "sim_pause", "sim_speed", "gift", "catalog_add", "catalog_place", "catalog_retrieve", "catalog_delete", "approve", "deny", "activity_cancel"]);
export interface HumanResult { notice?: { level: "ok" | "error"; text: string }; toAll?: boolean; forge?: ToolRequest }

export function humanCommand(rt: Runtime, m: ClientMsg): HumanResult {
  const { world, agent, emotions, catalog } = rt;
  /** If something appears close to River, River notices; far away it's simply there to be found. */
  const arrived = (name: string, at: { x: number; z: number }) => { if (Math.hypot(at.x - world.me.x, at.z - world.me.z) < 15) agent.notify(`## News\nSomething new has appeared near you: "${name}". It wasn't there before.`, true, "contact"); };
  try {
    switch (m.t) {
      case "say": {
        const text = (m.text ?? "").trim().slice(0, 500); if (!text) return {};
        log("human", `Human: ${text}`); emotions.contact(); bus.emit("loud", { text: "a voice from outside spoke to you" });
        addMemory(`A voice from outside said to me: "${text}"`, 6, ["human"], "human");
        agent.notify(`## Voice from outside\nA human speaks to you: "${text}"`, true, "contact");
        return {};
      }
      case "presence": bodyApi.watched(); return {};
      case "skip_day": {
        const day = world.skipToDawn(); log("system", `A human moved time forward: it is now dawn on day ${day}.`); bus.emit("state");
        return { notice: { level: "ok", text: `Skipped ahead to dawn on day ${day}.` }, toAll: true };
      }
      case "config_set": return setConfig(String(m.key), m.value) ? {} : { notice: { level: "error", text: `Unknown or invalid setting: ${m.key}` } };
      case "config_preset": {
        const changed = applyPreset(String(m.id));
        if (!changed) return { notice: { level: "error", text: `There is no preset called "${m.id}".` } };
        log("system", `Preset "${m.id}" applied${changed.length ? `: ${changed.join(", ")}` : " (nothing needed to change)"}.`); return { notice: { level: "ok", text: `Preset "${m.id}" applied.` }, toAll: true };
      }
      case "config_reset": resetConfig(); log("system", "Settings reset to defaults."); return {};
      case "sim_pause": setSimPaused(!!m.paused); log("system", m.paused ? "The world was frozen." : "The world was thawed."); bus.emit("state"); return {};
      case "sim_speed": setSimSpeed(Number(m.speed)); log("system", `World speed set to ${Number(m.speed)}x.`); return {};
      case "approve": case "deny": {
        const out = decideAndTell(rt, m.id, m.t === "approve", m.note, m.t === "approve" ? (m as any).builtin : undefined);
        return out.forge ? { forge: out.forge } : {};
      }
      case "activity_cancel": rt.activities.cancel("a human told you to stop"); return {};
      case "gift": {
        if (!m.name?.trim() && !m.item?.trim()) return {};
        const id = catalog.add({ name: m.name, desc: m.desc || "A gift left by the human.", item: m.item }), at = catalog.place(id), given = catalog.nameOf(id);
        log("human", `Human left a gift nearby: ${given}`); emotions.contact(0.5); emotions.bump("wonder", 0.3, "a gift appeared"); arrived(given, at);
        return {};
      }
      case "catalog_add": {
        if (!m.name?.trim() && !m.item?.trim()) return {};
        const id = catalog.add({ name: m.name, desc: m.desc ?? "", text: m.text, glow: m.glow, fixed: m.fixed, item: m.item }), given = catalog.nameOf(id);
        if (m.place) { const at = catalog.place(id); log("human", `Human placed "${given}" in the world.`); arrived(given, at); }
        return {};
      }
      case "catalog_place": {
        const at = catalog.place(m.id, m.x != null && m.z != null ? { x: m.x, z: m.z } : undefined), v = catalog.view().find((c) => c.id === m.id)!;
        log("human", `Human placed "${v.name}" in the world.`); if (v.kind !== "pack") arrived(v.name, at);
        return {};
      }
      case "catalog_retrieve": { const v = catalog.view().find((c) => c.id === m.id); catalog.retrieve(m.id); if (v) log("human", `Human took "${v.name}" out of the world.`); return {}; }
      case "catalog_delete": catalog.remove(m.id); return {};
    }
  } catch (e: any) { return { notice: { level: "error", text: e.message } }; }
  return {};
}
