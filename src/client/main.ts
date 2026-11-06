import { PROTOCOL_VERSION, SeqTracker } from "../shared/protocol.ts";
import { Scene3D } from "./scene.ts";
import { Ambience } from "./audio.ts";
import { $, clip, store } from "./dom.ts";
import { S, ctx, isTab, renderers, send, setSocket } from "./state.ts";
import { ask, handleNotice, initChrome, inspect, renderBudget, renderHud, setConn, showTab, toast } from "./ui/chrome.ts";
import { addLog, hooks, initLog, resetLog } from "./ui/log.ts";
import { drawMap, lastMap } from "./ui/map.ts";
import { initMemory, loadMemories } from "./ui/memory.ts";
import { loadBrain } from "./ui/brain.ts";
import { onAdvance, onReplay } from "./ui/sim.ts";
import { setTv, tvLog, tvMoment, wantsTvFromUrl } from "./ui/tv.ts";
import { fetchLife, openLife } from "./ui/life.ts";
import { initMusic, onRiverScore } from "./ui/music.ts";
import { onMoment } from "./ui/moments.ts";
import { renderDeath } from "./ui/death.ts";
import { renderSettings } from "./ui/settings.ts";
import { addGift, initCatalog, renderCatalog } from "./ui/catalog.ts";
import { needsLive, renderItems, renderMind, renderStory } from "./ui/panels.ts";
import { openToolsSub, renderTools } from "./ui/tools.ts";
import type { AgentView, ServerMsg } from "../shared/types.ts";

let lastAudio = 0;

// ---------- rendering ----------
renderers.log = () => {}; renderers.mind = renderMind; renderers.story = renderStory; renderers.map = () => { drawMap(); renderCatalog(); };
renderers.items = renderItems; renderers.tools = renderTools; renderers.memory = () => void loadMemories(($("memq") as HTMLInputElement).value);
renderers.brain = () => void loadBrain();
/** Someone is looking in: tell the server (it makes River faintly aware, a few times a day at most). Only while the tab is actually in view. */
let seenAt = 0;
function announcePresence() {
  if (document.visibilityState !== "visible" || Date.now() - seenAt < 60_000) return;
  seenAt = Date.now(); send({ t: "presence" });
}
document.addEventListener("visibilitychange", announcePresence);

function renderAll() {
  renderBudget(); renderTools();                       // tools always runs: it keeps the tab badge fresh
  for (const t of ["mind", "story", "map", "items"] as const) if (isTab(t)) renderers[t]();
  if (isTab("brain")) renderers.brain();
}

function setAgent(a: AgentView) {
  S.agent = a; ctx.scene?.setAgent(a); renderHud(a); needsLive(); renderDeath();
  if (Date.now() - lastAudio > 500) { lastAudio = Date.now(); ctx.audio?.update(a); }
  if (isTab("map") && Date.now() - lastMap > 1000) drawMap();
}

// ---------- things worth interrupting you for ----------
hooks.notable = (e) => {
  tvLog(e);
  if (e.kind === "request" && /^Requested tool/.test(e.text)) toast({ title: "River is asking for a tool", body: clip(e.text.replace(/^Requested tool /, ""), 160), color: "var(--warn)", action: { label: "Review", fn: () => { openToolsSub("requests"); showTab("tools"); } } });
  else if (e.kind === "system" && /ready for review/.test(e.text)) toast({ title: "A new tool is ready", body: e.text.replace("Tool smith: ", ""), color: "var(--warn)", action: { label: "Review", fn: () => { openToolsSub("smith"); showTab("tools"); } } });
  else if (e.kind === "dream") toast({ title: "River dreamed", body: clip(e.text.replace(/^.*? dreams: /, ""), 170), color: "var(--violet)", ttl: 14000 });
  else if (e.kind === "need" && /scorch/i.test(e.text)) toast({ title: "River is in danger", body: e.text, color: "var(--bad)" });
  else if (e.kind === "world" && /(alight|Lightning|catches fire|fire spreads)/i.test(e.text)) toast({ title: "Fire", body: e.text, color: "var(--orange)" });
};

// ---------- connection ----------
function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  setSocket(ws);
  ws.onopen = () => setConn(true);
  ws.onclose = () => { ctx.live = false; setConn(false); setTimeout(connect, 2000); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMsg);
}

const seqs = new SeqTracker();
function handle(m: ServerMsg) {
  if (m.t === "init") {
    if (m.schema !== PROTOCOL_VERSION) { toast({ title: "Reload this page", body: "The server speaks a newer version of the protocol than this page does.", color: "var(--warn)", ttl: 60000 }); return; }
    seqs.reset(m.seq ?? 0);
  } else if (m.seq !== undefined) {                          // a broadcast: in order, or ask for the whole state again
    const v = seqs.accept(m.seq);
    if (v === "stale") return;
    if (v === "gap") { send({ t: "resync" }); return; }
  }
  switch (m.t) {
    case "init": {
      if (ctx.scene && m.seed !== ctx.seed) return void location.reload();   // a new island: rebuild the terrain from scratch
      if (!ctx.scene) {
        ctx.scene = new Scene3D($("c") as HTMLCanvasElement, m.seed); ctx.seed = m.seed;
        ctx.scene.onPick = inspect; ctx.audio = new Ambience(m.seed, () => ctx.scene!.entityData.values()); ctx.scene.cutaways = store.get("cutaways", true);
        dispatchEvent(new Event("resize"));              // lets the sidebar inset the camera
      }
      S.heat = m.heat; S.scorch = m.scorch; ctx.scene.setHeat(m.heat, m.scorch); ctx.scene.syncEntities(m.entities);
      Object.assign(S, { desires: m.desires, interests: m.interests, inventory: m.inventory, tools: m.tools, requests: m.requests, forged: m.forged, places: m.places, journal: m.journal, moments: m.moments, keeper: m.keeper, catalog: m.catalog, taste: m.taste, stats: m.stats, selfModel: m.selfModel });
      ctx.live = false; resetLog(m.log); ctx.live = true;
      setAgent(m.agent); renderAll(); announcePresence(); if (wantsTvFromUrl() || store.get("tvAuto", false)) setTv(true); if (/[?&]life\b/.test(location.search)) void fetchLife("now").then((l) => l && openLife(l)); break;
    }
    case "agent": setAgent(m.agent); break;
    case "config": S.config = m.config; renderSettings(); break;
    case "advance": onAdvance(m.progress, m.done); break;
    case "replay": onReplay(m); break;
    case "log": addLog(m.entry, ctx.live); break;
    case "fx": ctx.scene?.fx(m.kind); m.kind === "lightning" ? ctx.audio?.thunder() : ctx.audio?.meteor(); break;
    case "notice": if (!handleNotice(m)) toast({ title: m.level === "ok" ? "Done" : "Couldn't do that", body: m.text, color: m.level === "ok" ? "var(--accent)" : "var(--bad)", ttl: 7000 }); break;
    case "moment": onMoment(m.moment); tvMoment(m.moment); break;
    case "score": onRiverScore(m.title, m.score); break;
    case "heat": S.heat = m.cells; S.scorch = m.scorch; ctx.scene?.setHeat(m.cells, m.scorch); if (isTab("map")) drawMap(); break;
    case "entity": if (m.op === "upsert") ctx.scene?.upsert(m.entity); else ctx.scene?.remove(m.id); break;
    case "state": Object.assign(S, m); renderAll(); break;
  }
}

// ---------- composer ----------
($("speak") as HTMLFormElement).onsubmit = (e) => {
  e.preventDefault(); const i = $("speakin") as HTMLInputElement;
  if (i.value.trim()) send({ t: "say", text: i.value }); i.value = "";
};
$("seedbtn").onclick = async () => {
  const v = await ask("Plant a thought", [{ key: "text", label: "A thought for River's next dream. It may never mention it.", placeholder: "a door in the sea", multiline: true }], "Plant");
  if (v?.text) { send({ t: "dream_seed", text: v.text }); toast({ title: "Thought planted", body: "It will drift into River's next dream.", color: "var(--violet)", ttl: 5000 }); }
};
$("giftbtn").onclick = () => void addGift(true);

initChrome(); initLog(); initMemory(); initMusic(); initCatalog();
connect();
setInterval(renderBudget, 3000);
