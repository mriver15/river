import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { bus, log, logBefore, recentLog } from "./bus.ts";
import { createRuntime, startSystems, humanCommand, REPLAYABLE } from "./runtime.ts";
import { recordCommand, finishCommand, snapshotBoot, admit, recoverCommands, commandsFrom, setRecording, setReplaying } from "./recorder.ts";
import { ReplayDriver } from "./replay-driver.ts";
import { DatabaseSync } from "node:sqlite";
import { afterCommit } from "./sim.ts";
import * as sim from "./sim.ts";
import { every, STEP_MS, speedForDayMinutes } from "./sim.ts";
import { db, kvGet, kvSet, DB_PATH } from "./db.ts";
import { saveSlot, listSlots } from "./slots.ts";
import { cfg, configView, onConfig, resetConfig, setConfig } from "./config.ts";
import { search, addMemory, embedPending, embeddingCoverage, setLocator } from "./memory.ts";
import { GATED, activeDesires, decideRequest, interests, requests, toolInfos } from "./mind.ts";
import { Agent } from "./agent.ts";
import { BASE_TOOLS, loadPlugins } from "./tools.ts";
import { forge, forgedList, install, reapInterrupted, reject } from "./smith.ts";
import { World } from "./world.ts";
import { Ambient } from "./ambient.ts";
import { listPlaces } from "./places.ts";
import { Fire } from "./fire.ts";
import { Emotions } from "./emotions.ts";
import { Creatures } from "./creatures.ts";
import { Story } from "./story.ts";
import { Catalog } from "./catalog.ts";
import { tasteView } from "./taste.ts";
import { bodyApi } from "./body.ts";
import { Wildlife } from "./wildlife.ts";
import { setupDeath } from "./death.ts";
import { checkCode, resetRiver } from "./reset.ts";
import { libraryForUi } from "./music.ts";
import { recentMoments } from "./moments.ts";
import { timeline } from "./timeline.ts";
import { lifeSoFar, obituaries, obituary } from "./life.ts";
import { listModels, testProvider } from "./provider-check.ts";
import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import { pluginRecords } from "./sandbox/plugin.ts";
import { sandboxStats } from "./sandbox/host.ts";
import { catchUp } from "./advance.ts";
import { paramHistory, paramSet, RULESET } from "./config.ts";
import { PRESETS } from "../content/presets.ts";
import { journalList, startJournal } from "./journal.ts";
import { plantSeed, startDreams } from "./dreams.ts";
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 8787);
// A read-only replay (scripts/replay-serve.ts) runs a recorded life from its snapshot, in a copy of the database, and shows it.
const REPLAY = process.env.RIVER_REPLAY ? (JSON.parse(process.env.RIVER_REPLAY) as { recorded: string; snapTick: number }) : null;
if (!REPLAY) recoverCommands();                   // whatever was running when the last process stopped is not running now
const snap = REPLAY ? { tick: sim.simTick(), hash: "replay" } : snapshotBoot();      // the state replay restores: taken before anything is constructed
const rt = await createRuntime();
const { world, emotions, agent, ambient, creatures, story, catalog, wildlife, fire } = rt;

const heatCells = () => Array.from(world.heat, (v) => Math.round(v * 10) / 10);
const scorchCells = () => Array.from(world.scorch, (v) => Math.round(v * 100) / 100);
const stateMsg = (): Extract<ServerMsg, { t: "state" }> => ({
  t: "state", desires: activeDesires(), interests: interests(), inventory: [...world.inventory.values()],
  tools: toolInfos(BASE_TOOLS), requests: requests(), forged: forgedList(), places: listPlaces(), journal: journalList(), keeper: story.view(), catalog: catalog.view(), taste: tasteView(), stats: { ...agent.stats() }, selfModel: agent.selfModel,
});

// ---------- HTTP (API + built client) ----------
const DIST = path.resolve("dist/client");
const SLOTS_DIR = path.join(path.dirname(DB_PATH), "slots");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/memories") return json({ ...embeddingCoverage(), memories: await search(url.searchParams.get("q") ?? "", 60) });
  if (url.pathname === "/api/music") return json(libraryForUi());
  if (url.pathname === "/api/brain") return json(agent.brainView());
  if (url.pathname === "/api/item") {                              // the item inspector: identity, place, condition, make-up, what it can do, where it came from
    const i = world.items.get(url.searchParams.get("id") ?? "");
    return json(i ? { ...world.items.describe(i), history: world.items.history(i.id) } : { error: "no such item" });
  }
  if (url.pathname === "/api/items") return json({ items: world.items.all().map((i) => ({ id: i.id, name: i.name, qty: i.qty, loc: i.loc.kind })), audit: world.items.audit() });
  if (url.pathname === "/api/mind") return json(rt.inner.view());                       // the inner life: relationships, beliefs with evidence, observations, and why feelings moved
  if (url.pathname === "/api/sim") {                                // the simulation panel: where the clock is, what it costs, what an advance did, which parameters are in force
    const info = sim.simInfo(), last = rt.advancer.last;
    return json({ ...info, day: world.day(), timeLabel: world.timeLabel(), brainPaused: agent.stats().paused, decisions: agent.decisionState(), advance: { current: rt.advancer.current, last }, catchup: kvGet("catchup", null),
      perf: sim.simPerf().slice(0, 12), ruleset: RULESET, paramSet: paramSet(), params: paramHistory().slice(0, 8).map((p) => ({ tick: p.tick, hash: p.hash, cause: p.cause })), presets: PRESETS.map(({ id, label, help }) => ({ id, label, help })) });
  }
  if (url.pathname === "/api/timeline") {
    const q = url.searchParams, n = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    return json(timeline({ actor: q.get("actor") ?? undefined, object: q.get("object") ?? undefined, activity: q.get("activity") ?? undefined, chain: q.get("chain") ?? undefined, source: q.get("source") ?? undefined, fromTick: n("from"), toTick: n("to"), limit: n("limit") }));
  }
  if (url.pathname === "/api/slots") {                              // save slots: list them, or take a copy of the world as it is now (POST)
    if (req.method === "POST") {
      let body = ""; for await (const c of req) { body += c; if (body.length > 10_000) break; }
      try { const o = JSON.parse(body || "{}"); return json({ slot: await saveSlot(DB_PATH, SLOTS_DIR, String(o.name ?? ""), { note: String(o.note ?? "") }) }); }
      catch (e: any) { res.statusCode = 400; return json({ error: String(e?.message ?? e) }); }
    }
    return json({ slots: listSlots(SLOTS_DIR), dir: SLOTS_DIR, current: DB_PATH });
  }
  if (url.pathname === "/api/llm/models") return json(await listModels());                // what the chosen server offers, for the settings pane
  if (url.pathname === "/api/llm/test") return json(await testProvider());                  // can it be reached, does it answer, does it call tools
  if (url.pathname === "/api/life") return json(lifeSoFar(world, bodyApi.born()));                      // this life, so far
  if (url.pathname === "/api/obituaries") return json(obituaries());                                  // every life that has ended
  if (url.pathname === "/api/obituary") return json(obituary(Number(url.searchParams.get("life")) || undefined) ?? { error: "no life has ended yet" });
  if (url.pathname === "/api/plugins") return json({ plugins: [...pluginRecords.values()].map(({ file: _f, ...p }) => p), sandbox: sandboxStats });
  if (url.pathname === "/api/moments") return json(recentMoments(100));
  if (url.pathname === "/api/log") return json(logBefore(Number(url.searchParams.get("before") ?? 1e12), 200));
  if (fs.existsSync(DIST)) {
    let f = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
    if (!f.startsWith(DIST) || !fs.existsSync(f)) f = path.join(DIST, "index.html");
    res.setHeader("content-type", MIME[path.extname(f)] ?? "application/octet-stream");
    return void res.end(fs.readFileSync(f));
  }
  res.statusCode = 404; res.end("Client not built. Run `npm run dev` (Vite on :5173) or `npm run build`.");
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: "/ws" });
const send = (ws: WebSocket, m: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
/** Nothing is announced before it is durable. */
let seq = 0;
const broadcast = (m: ServerMsg) => afterCommit(() => { const out = { ...m, seq: ++seq } as ServerMsg; wss.clients.forEach((c) => send(c, out)); });

const initMsg = (): ServerMsg => ({ t: "init", schema: PROTOCOL_VERSION, seq, moments: recentMoments(30), heat: heatCells(), scorch: scorchCells(), seed: world.seed, entities: [...world.entities.values()], agent: world.view(), log: recentLog(300), ...(() => { const { t, ...s } = stateMsg(); return s; })() });
let resetting = false;

// ---------- read-only replay ----------
const player = { seekTo: 0, speed: Number(process.env.REPLAY_SPEED) || 4, paused: false, done: false, checked: 0, diverged: 0, tick: 0, startTick: 0, endTick: 0, source: "", lastCheck: 0 };
const replayMsg = (): ServerMsg => ({ t: "replay", tick: sim.simTick(), startTick: player.startTick, endTick: player.endTick, speed: player.speed, paused: player.paused, done: player.done, checked: player.checked, diverged: player.diverged, source: player.source });
async function playReplay() {
  const src = new DatabaseSync(REPLAY!.recorded, { readOnly: true });
  setRecording(false); setReplaying(true);
  const cmds = commandsFrom(src as any, REPLAY!.snapTick);
  const live = new Map((src.prepare("SELECT tick, hash FROM sim_checkpoints WHERE tick > ?").all(REPLAY!.snapTick) as { tick: number; hash: string }[]).map((r) => [r.tick, r.hash]));
  const driver = new ReplayDriver(rt, cmds, Math.max(0, ...live.keys()));
  Object.assign(player, { startTick: REPLAY!.snapTick, endTick: driver.endTick, source: path.basename(REPLAY!.recorded), lastCheck: REPLAY!.snapTick });
  sim.setSimPaused(false);
  let last = performance.now(), carry = 0, lastSend = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 25));
    const now = performance.now(), dt = now - last; last = now;
    if (!player.paused && !player.done) {
      carry += (dt / 1000) * player.speed * 10;                                  // ten ticks to a world second
      const seeking = player.seekTo > sim.simTick();                              // jumping ahead: run flat out until the tick is reached, still showing progress
      if (!seeking) player.seekTo = 0;
      const n = seeking ? Math.min(player.seekTo - sim.simTick(), 3000) : Math.min(Math.floor(carry), 400); carry = seeking ? 0 : carry - n;
      for (let i = 0; i < n; i++) if (!(await driver.step())) { player.done = true; await driver.settle(); break; }
      for (const r of db.prepare("SELECT tick, hash FROM sim_checkpoints WHERE tick > ? ORDER BY tick").all(player.lastCheck) as { tick: number; hash: string }[]) {
        player.lastCheck = r.tick; if (live.has(r.tick)) { player.checked++; if (live.get(r.tick) !== r.hash) player.diverged++; }
      }
    }
    if (now - lastSend > 250) { lastSend = now; broadcast(replayMsg()); }
  }
}

wss.on("connection", (ws) => {
  send(ws, initMsg()); send(ws, { t: "config", config: configView() }); if (REPLAY) send(ws, replayMsg());
  ws.on("message", (raw) => {
    let m: ClientMsg; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === "resync") return void send(ws, initMsg());          // a client that missed something asks for the whole state
    if (REPLAY && m.t === "presence") return;                        // looking in on a recording changes nothing
    if (REPLAY) {                                                    // a replay is only watched: nothing a client sends changes the world
      if (m.t === "replay_speed") player.speed = Math.max(0.5, Math.min(512, Number(m.speed) || 1));
      else if (m.t === "replay_seek") player.seekTo = Math.max(0, Math.min(player.endTick, Math.floor(Number(m.tick) || 0)));       // forward only: a replay cannot run backwards
      else if (m.t === "replay_pause") player.paused = !!m.paused;
      else send(ws, { t: "notice", level: "error", text: "This is a replay of a recorded life. It can be watched, not changed." });
      return;
    }
    const cid = typeof m.cid === "string" ? m.cid.slice(0, 80) : undefined;
    const ack = (status: "ok" | "error" | "duplicate", result?: string) => { if (cid) afterCommit(() => send(ws, { t: "ack", cid, status, result })); };
    if (m.t === "sim_advance" || m.t === "skip_day") {            // moving faster than real time: the same ticks, in batches, with a way to stop
      if (rt.advancer.current) return void ack("error", "an advance is already running");
      const until = m.t === "skip_day" || m.until === "dawn" ? { kind: "dawn" as const } : m.until === "minutes" ? { kind: "minutes" as const, minutes: Math.max(0.1, Math.min(24 * 60, Number(m.amount) || 10)) } : { kind: "ticks" as const, ticks: Math.max(1, Math.min(14_400 * 3, Math.floor(Number(m.amount) || 600))) };
      const seq = recordCommand("external", "advance", { until, decision: m.t === "sim_advance" ? m.decision ?? "stop" : "stop", from: sim.simTick() });
      ack("ok");
      void rt.advancer.run({ until, decision: m.t === "sim_advance" ? m.decision ?? "stop" : "stop" }).then((r) => {
        finishCommand(seq, "ok", `${r.reason} after ${r.ticks} ticks`);
        const why = r.reason === "target" ? "" : ` (${r.reason === "decision" ? "stopped: a decision is waiting" : r.reason === "death" ? "stopped: River died" : r.reason === "cancelled" ? "cancelled" : r.reason === "budget" ? "stopped at its work limit" : "the world is frozen"})`;
        log("system", `Advanced ${Math.round(r.summary.simSeconds / 60)} world minutes in ${(r.wallMs / 1000).toFixed(1)} s (${r.ticksPerSec} ticks/s)${why}.`);
        broadcast({ t: "notice", level: r.reason === "target" || r.reason === "cancelled" ? "ok" : "error", text: `Advanced ${Math.round(r.summary.simSeconds / 60)} world minutes${why}.` });
      }).catch((e) => { finishCommand(seq, "error", String(e?.message ?? e)); broadcast({ t: "notice", level: "error", text: `Advance failed: ${e?.message ?? e}` }); });
    } else if (m.t === "sim_cancel") { rt.advancer.cancel(); ack("ok");
    } else if (REPLAYABLE.has(m.t)) {
      const { cid: _c, ...body } = m, adm = admit("human", m.t, body, cid);
      if (adm.duplicate) return void ack("duplicate", adm.result);       // already done: report the original outcome, do nothing
      const r = humanCommand(rt, m), failed = r.notice?.level === "error";
      finishCommand(adm.seq, failed ? "error" : "ok", r.notice?.text ?? "");
      if (m.t === "config_reset") broadcast({ t: "config", config: configView() });
      if (r.notice) (r.toAll ? broadcast : (x: ServerMsg) => afterCommit(() => send(ws, x)))({ t: "notice", ...r.notice });
      if (r.forge && process.env.RIVER_AUTO_FORGE !== "0") forge(r.forge).then(announce);
      ack(failed ? "error" : "ok", r.notice?.text);
    } else if (m.t === "reset_budget") {
      agent.restartCycles(); send(ws, { t: "notice", level: "ok", text: "Budget window reset. River is thinking again." });
    } else if (m.t === "reset_river") {
      const c = checkCode(String(m.code ?? ""));
      if (!c.ok) return void send(ws, { t: "notice", level: "error", text: c.error! });
      if (resetting) return void send(ws, { t: "notice", level: "error", text: "A reset is already in progress." });
      resetting = true;
      resetRiver({ world: !!m.world }, rt)
        .then((r) => { broadcast(initMsg()); broadcast({ t: "notice", level: "ok", text: `A new River has awakened. Your previous life is saved at ${r.backup}.` }); })
        .catch((e) => send(ws, { t: "notice", level: "error", text: `Reset failed: ${e.message}` }))
        .finally(() => { resetting = false; });
    } else if (m.t === "new_life") {
      if (!bodyApi.isDead()) return void send(ws, { t: "notice", level: "error", text: "River is alive." });
      if (resetting) return;
      resetting = true;
      resetRiver({ world: false }, rt)
        .then(() => { broadcast(initMsg()); broadcast({ t: "notice", level: "ok", text: "A new River has been born on the same island. Its predecessor's grave is where they fell." }); })
        .catch((e) => send(ws, { t: "notice", level: "error", text: `Could not begin a new life: ${e.message}` }))
        .finally(() => { resetting = false; });
    } else if (m.t === "dream_seed" && m.text?.trim()) {
      plantSeed(m.text.trim());
    } else if (m.t === "forge") {
      const r = requests(200).find((x) => x.id === m.id && x.status === "approved");
      if (r) forge(r).then(announce);
    } else if (m.t === "install") {
      const seq = recordCommand("human", "plugin_install", { t: "plugin_install", name: m.name });      // a controller command: it pins the source hash and capabilities the tool is given
      install(m.name).then((f) => { finishCommand(seq, f ? "ok" : "error", f ? f.log.split("\n").pop() ?? "" : "nothing staged under that name"); });      // (River is told by the "tool-installed" event, whoever installed it)
    } else if (m.t === "reject") reject(m.name);
    else if (m.t === "pause") agent.setPaused(m.paused);
  });
});

const announce = () => bus.emit("state");
// settings: tell every client, and make the ones that need a nudge take effect now
onConfig((key) => {
  broadcast({ t: "config", config: configView() });
  log("system", `Setting changed: ${key}.`);
});

// fan-out
bus.on("log", (entry) => broadcast({ t: "log", entry }));
bus.on("entity", (m) => broadcast(m));
bus.on("fx", (m) => broadcast(m));
bus.on("score", (m) => broadcast(m));
bus.on("moment", (m) => broadcast(m));
bus.on("heat", () => broadcast({ t: "heat", cells: heatCells(), scorch: scorchCells() }));
let stateTimer: NodeJS.Timeout | null = null;
bus.on("state", () => { stateTimer ??= setTimeout(() => { stateTimer = null; broadcast(stateMsg()); }, 150); });

// ---------- loops ----------
setInterval(() => broadcast({ t: "agent", agent: world.view() }), 200);
setInterval(() => bus.emit("state"), 5000); // needs/stats refresh

let lastProgress = 0;
rt.advancer.onProgress = (p, done) => { const now = Date.now(); if (p && !done && now - lastProgress < 150) return; lastProgress = now; broadcast({ t: "advance", progress: p, ...(done ? { done } : {}) }); };      // a few a second, whatever the speed
server.listen(PORT, async () => {
  console.log(`River ${REPLAY ? "replay" : "world"} on http://localhost:${PORT}  (dev client: http://localhost:5173)`);
  startSystems(rt);
  if (REPLAY) { void playReplay(); return; }
  const away = await catchUp(rt.advancer);            // an absence, if the human chose to have the world catch up (default: it waits, frozen)
  if (away) console.log(`Caught up ${away.ticksRun} of ${away.ticksOwed} ticks after ${Math.round(away.absentMs / 60_000)} minutes away.`);
  sim.start();
  agent.run();
  log("system", `Boot snapshot at tick ${snap.tick} (${snap.hash.slice(0, 8)}) for replay.`);
  void embedPending();                              // backfill vectors for older memories
  setInterval(() => void embedPending(), 60_000);
});
