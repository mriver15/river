import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { bus, log, logBefore, recentLog } from "./bus.ts";
import { createRuntime, startSystems, humanCommand, REPLAYABLE } from "./runtime.ts";
import { recordCommand, finishCommand, snapshotBoot } from "./recorder.ts";
import * as sim from "./sim.ts";
import { every, STEP_MS, speedForDayMinutes } from "./sim.ts";
import { kvGet, kvSet } from "./db.ts";
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
import { journalList, startJournal } from "./journal.ts";
import { plantSeed, startDreams } from "./dreams.ts";
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 8787);
const snap = snapshotBoot();                      // the state replay restores: taken before anything is constructed
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
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (o: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/memories") return json({ ...embeddingCoverage(), memories: await search(url.searchParams.get("q") ?? "", 60) });
  if (url.pathname === "/api/music") return json(libraryForUi());
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
const broadcast = (m: ServerMsg) => wss.clients.forEach((c) => send(c, m));

const initMsg = (): ServerMsg => ({ t: "init", moments: recentMoments(30), heat: heatCells(), scorch: scorchCells(), seed: world.seed, entities: [...world.entities.values()], agent: world.view(), log: recentLog(300), ...(() => { const { t, ...s } = stateMsg(); return s; })() });
let resetting = false;

wss.on("connection", (ws) => {
  send(ws, initMsg()); send(ws, { t: "config", config: configView() });
  ws.on("message", (raw) => {
    let m: ClientMsg; try { m = JSON.parse(String(raw)); } catch { return; }
    if (REPLAYABLE.has(m.t)) {
      const seq = recordCommand("human", m.t, m), r = humanCommand(rt, m);
      finishCommand(seq, r.notice?.level === "error" ? "error" : "ok", r.notice?.text ?? "");
      if (m.t === "config_reset") broadcast({ t: "config", config: configView() });
      if (r.notice) (r.toAll ? broadcast : (x: ServerMsg) => send(ws, x))({ t: "notice", ...r.notice });
    } else if (m.t === "approve" || m.t === "deny") {
      const r = decideRequest(m.id, m.t === "approve", m.note, m.t === "approve" ? m.builtin : undefined);
      if (r) {
        const granted = m.t === "approve" && m.builtin && m.builtin in GATED ? m.builtin : null;
        const verdict = m.t === "approve"
          ? (granted ? `Your request "${r.name}" was APPROVED. You can now do it with the ability called "${granted}": ${GATED[granted]}`
            : r.name in GATED ? `Your request for "${r.name}" was APPROVED. You can now use it: ${GATED[r.name]}` : `Your idea for a new tool "${r.name}" was approved in principle — the human may build it; it isn't usable yet.`)
          : `Your request for "${r.name}" was DENIED.`;
        agent.notify(`${verdict}${m.note ? ` The human added: "${m.note}"` : ""}`);
        addMemory(verdict, 6, ["tools"]);
        if (m.t === "approve" && !granted && !(r.name in GATED) && process.env.RIVER_AUTO_FORGE !== "0") forge(r).then(announce);
      }
    } else if (m.t === "reset_budget") {
      agent.restartCycles(); send(ws, { t: "notice", level: "ok", text: "Budget window reset. River is thinking again." });
    } else if (m.t === "reset_river") {
      const c = checkCode(String(m.code ?? ""));
      if (!c.ok) return void send(ws, { t: "notice", level: "error", text: c.error! });
      if (resetting) return void send(ws, { t: "notice", level: "error", text: "A reset is already in progress." });
      resetting = true;
      resetRiver({ world: !!m.world }, { agent, world, ambient, emotions, creatures, story, catalog, wildlife })
        .then((r) => { broadcast(initMsg()); broadcast({ t: "notice", level: "ok", text: `A new River has awakened. Your previous life is saved at ${r.backup}.` }); })
        .catch((e) => send(ws, { t: "notice", level: "error", text: `Reset failed: ${e.message}` }))
        .finally(() => { resetting = false; });
    } else if (m.t === "new_life") {
      if (!bodyApi.isDead()) return void send(ws, { t: "notice", level: "error", text: "River is alive." });
      if (resetting) return;
      resetting = true;
      resetRiver({ world: false }, { agent, world, ambient, emotions, creatures, story, catalog, wildlife })
        .then(() => { broadcast(initMsg()); broadcast({ t: "notice", level: "ok", text: "A new River has been born on the same island. Its predecessor's grave is where they fell." }); })
        .catch((e) => send(ws, { t: "notice", level: "error", text: `Could not begin a new life: ${e.message}` }))
        .finally(() => { resetting = false; });
    } else if (m.t === "dream_seed" && m.text?.trim()) {
      plantSeed(m.text.trim());
    } else if (m.t === "forge") {
      const r = requests(200).find((x) => x.id === m.id && x.status === "approved");
      if (r) forge(r).then(announce);
    } else if (m.t === "install") {
      install(m.name).then((f) => { if (f) { agent.notify(`Your new tool "${f.name}" has been built and is now usable. Try it!`); addMemory(`The tool "${f.name}" was built for me and is now available.`, 7, ["tools"]); } });
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

server.listen(PORT, () => {
  console.log(`River world on http://localhost:${PORT}  (dev client: http://localhost:5173)`);
  startSystems(rt);
  sim.start();
  agent.run();
  log("system", `Boot snapshot at tick ${snap.tick} (${snap.hash.slice(0, 8)}) for replay.`);
  void embedPending();                              // backfill vectors for older memories
  setInterval(() => void embedPending(), 60_000);
});
