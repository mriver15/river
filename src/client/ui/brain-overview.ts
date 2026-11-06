// Overview: the state of things at a glance, what needs a human, and the controls used most.
import { el } from "../dom.ts";
import { S, send } from "../state.ts";
import { advanceControls } from "./brain-world.ts";
import { button, chip, clockParts, empty, getJson, h, note, num, section, tile, type Tone, type View } from "./brain-ui.ts";
import { showTab } from "./chrome.ts";

export interface Alert { tone: Tone; text: string; action?: { label: string; run: () => void } }
/** What a person should know about without looking: derived from what the page already has, so it is free to ask for. */
export function alerts(): Alert[] {
  const s = S.stats, out: Alert[] = []; if (!s) return out;
  const unmetered = s.maxTokensPerHour >= 1e8, pct = unmetered ? 0 : (s.tokensLastHour / s.maxTokensPerHour) * 100;
  if (s.paused) out.push({ tone: "warn", text: "River's mind is paused: it will not think until you resume it.", action: { label: "Resume", run: () => send({ t: "pause", paused: false }) } });
  if (s.worldPaused) out.push({ tone: "warn", text: "The world is frozen: nothing moves until you thaw it.", action: { label: "Thaw", run: () => send({ t: "sim_pause", paused: false }) } });
  if (!unmetered && pct >= 100) out.push({ tone: "bad", text: "The hourly token budget is spent. River waits for tokens to free up." });
  else if (!unmetered && pct >= 85) out.push({ tone: "warn", text: `The token budget is ${Math.round(pct)}% used; River will slow down.` });
  const pending = S.requests.filter((r) => r.status === "pending").length;
  if (pending) out.push({ tone: "info", text: `${pending} tool request${pending === 1 ? " is" : "s are"} waiting for your decision.`, action: { label: "Review", run: () => showTab("tools") } });
  if (S.agent?.body?.dead) out.push({ tone: "bad", text: "River has died." });
  return out;
}

export function overviewView(): View {
  let tiles: HTMLElement, attn: HTMLElement, now: HTMLElement;
  return {
    live: true,
    mount(box) {
      const t = section("At a glance"), a = section("Needs your attention"), n = section("Right now"), q = section("Move time");
      tiles = t.body; attn = a.body; now = n.body; q.body.append(advanceControls());
      box.append(t.box, a.box, n.box, q.box);
    },
    async refresh() {
      const [sim, b] = await Promise.all([getJson<any>("/api/sim"), getJson<any>("/api/brain")]), st = S.stats, bud = b.budget, unmetered = bud.max >= 1e8, pct = Math.min(100, Math.round(bud.fill * 100));
      const mind = st?.paused ? "Paused" : S.agent?.thinking ? "Thinking" : b.queue.length ? "Waking" : "Resting";
      tiles.replaceChildren(h("div", "bt-tiles",
        tile("World", clockParts(sim.timeLabel).time, `${clockParts(sim.timeLabel).rest} · ${sim.speed}×${sim.paused ? " · frozen" : ""}`, sim.paused ? "warn" : ""),
        tile("Mind", mind, st?.model ?? "", st?.paused ? "warn" : ""),
        tile("Tokens", unmetered ? "local" : `${pct}%`, unmetered ? `${num(bud.tokensLastHour)}/h, no limit` : `${num(bud.tokensLastHour)} of ${num(bud.max)}`, bud.exhausted ? "bad" : pct >= 85 ? "warn" : ""),
        tile("Engine", sim.ticksPerSec ? `${num(sim.ticksPerSec)}/s` : "idle", `lag ${sim.lagMs} ms`)));
      const list = alerts(); attn.replaceChildren();
      if (!list.length) attn.append(empty("Nothing. All quiet."));
      for (const a of list) attn.append(h("div", `bt-item bt-alert ${a.tone}`, el("span", "bt-grow", a.text), ...(a.action ? [button(a.action.label, a.action.run)] : [])));
      now.replaceChildren();
      const a = S.agent; if (a) now.append(h("div", "bt-item", el("b", "", a.name), el("span", "bt-grow", a.sleeping ? "sleeping" : a.progress ? `${a.progress.label} · ${Math.round(a.progress.pct * 100)}%` : a.activity)));
      if (b.queue.length) now.append(h("div", "bt-chips", ...b.queue.map((t: any) => chip(`${t.kind}${t.count > 1 ? ` ×${t.count}` : ""}`, t.priority <= 1 ? "bad" : t.priority <= 2 ? "warn" : ""))), note(`Waiting to be decided: ${b.queue[0].texts[0] ?? ""}`));
      else now.append(note("No decision is waiting."));
      const d = b.decisions[0]; if (d) now.append(note(`Last decision: woken by ${d.kinds}, ${d.calls} call${d.calls === 1 ? "" : "s"}, ${num(d.in_tokens + d.out_tokens)} tokens.`));
    },
  };
}
