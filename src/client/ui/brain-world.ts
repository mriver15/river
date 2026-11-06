// World: the clock and how to move it, what the last advance and any absence did, the parameters in force, what the engine spends its time on,
// and which plugins are running. The advance controls are also used by the overview.
import { el } from "../dom.ts";
import { send } from "../state.ts";
import type { AdvanceResult } from "../../shared/advance.ts";
import { bars, button, chip, clockParts, empty, getJson, h, mins, note, num, section, tile, type View } from "./brain-ui.ts";
import { mountProgress } from "./sim.ts";

const why: Record<string, string> = { target: "reached its target", death: "stopped: River died", decision: "stopped: an urgent decision was waiting", cancelled: "cancelled", budget: "stopped at its work limit", frozen: "the world is frozen" };

/** Buttons to run the world forward, with what to do when a decision is waiting, and a progress bar that fills while it runs. */
export function advanceControls(): HTMLElement {
  const box = el("div", "bt-advance");
  const row = el("div", "bt-actions");
  const policy = el("select") as HTMLSelectElement; policy.setAttribute("aria-label", "When River needs to decide something urgent");
  for (const [v, t] of [["stop", "Stop for urgent decisions"], ["wait", "Wait for them"], ["defer", "Carry on regardless"]]) { const o = el("option") as HTMLOptionElement; o.value = v; o.textContent = t; policy.append(o); }
  const go = (label: string, until: "dawn" | "minutes", amount?: number) => row.append(button(label, () => send({ t: "sim_advance", until, amount, decision: policy.value as "stop" | "wait" | "defer" })));
  go("To dawn", "dawn"); go("+10 min", "minutes", 10); go("+1 hour", "minutes", 60);
  const prog = el("div", "bt-progress"); prog.setAttribute("aria-live", "polite"); mountProgress(prog);
  box.append(row, policy, prog); return box;
}

function summary(title: string, s: AdvanceResult["summary"], extra?: string): HTMLElement {
  const c = el("div", "bt-card"); c.append(el("div", "bt-ct", title));
  c.append(note(`${mins(s.simSeconds)} of world time · day ${s.fromDay}${s.toDay !== s.fromDay ? ` to ${s.toDay}` : ""}${extra ? ` · ${extra}` : ""}`));
  const ev = Object.entries(s.events).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (ev.length) { const r = el("div", "bt-chips"); for (const [k, n] of ev) r.append(chip(`${n} ${k}`)); c.append(r); }
  if (s.moments.length) c.append(note(`Moments: ${s.moments.join("; ")}`));
  const d = s.decisions, raised = Object.entries(d.raised).map(([k, n]) => `${n} ${k}`).join(", ");
  c.append(note(`${d.taken} decisions${d.tokens ? ` (${num(d.tokens)} tokens)` : ""}${raised ? ` · called for: ${raised}` : ""} · ${s.items.made} things made or found, ${s.items.lost} used up${s.deaths ? " · River died" : ""}`));
  c.append(note((["energy", "hunger", "mood", "warmth"] as const).map((k) => `${k} ${Math.round(s.needs.before[k] ?? 0)}→${Math.round(s.needs.after[k] ?? 0)}`).join(" · ")));
  return c;
}

export function worldView(): View {
  let clock: HTMLElement, last: HTMLElement, params: HTMLElement, perf: HTMLElement, plugins: HTMLElement, preset: HTMLSelectElement | null = null, presetFor = "";
  return {
    live: true,
    mount(box) {
      const c = section("The world's clock"), a = section("Move time", { hint: "the same ticks, faster" }), l = section("What happened"), p = section("Parameters", { hint: "recorded, replayable", fold: true }), e = section("Where the engine's time goes", { fold: true }), pl = section("Plugins", { hint: "run in a sandbox", fold: true });
      clock = c.body; last = l.body; params = p.body; perf = e.body; plugins = pl.body;
      a.body.append(advanceControls());
      box.append(c.box, a.box, l.box, p.box, e.box, pl.box);
    },
    async refresh() {
      const [s, pl] = await Promise.all([getJson<any>("/api/sim"), getJson<any>("/api/plugins").catch(() => null)]);
      clock.replaceChildren(h("div", "bt-tiles",
        tile("Time", clockParts(s.timeLabel).time, clockParts(s.timeLabel).rest), tile("Speed", `${s.speed}×`, s.paused ? "world frozen" : "running", s.paused ? "warn" : ""),
        tile("Engine", s.ticksPerSec ? `${num(s.ticksPerSec)}/s` : "idle", `lag ${s.lagMs} ms`), tile("Decisions", s.decisions.thinking ? "one now" : String(s.decisions.queued), s.decisions.urgent ? "an urgent one is waiting" : "queued", s.decisions.urgent ? "warn" : "")));
      clock.append(note(`${s.ruleset} · parameters ${s.paramSet} · ${s.systems} systems, ${s.timers} timers`));
      last.replaceChildren();
      if (s.catchup) last.append(summary("While you were away", s.catchup.summary, `${Math.round(s.catchup.absentMs / 60_000)} min absent${s.catchup.deferredWallMs ? `, ${Math.round(s.catchup.deferredWallMs / 60_000)} min not simulated` : ""}`));
      if (s.advance.last) last.append(summary(`Last advance: ${why[s.advance.last.reason] ?? s.advance.last.reason}`, s.advance.last.summary, `${num(s.advance.last.ticksPerSec)} ticks/s`));
      if (!last.children.length) last.append(empty("Nothing yet. Run the world forward above, and what happened is summarised here."));
      // parameters: keep the picker (and what was chosen) between refreshes
      const key = s.presets.map((x: any) => x.id).join();
      if (!preset || presetFor !== key) {
        presetFor = key; preset = el("select") as HTMLSelectElement; preset.setAttribute("aria-label", "Preset");
        for (const x of s.presets) { const o = el("option") as HTMLOptionElement; o.value = x.id; o.textContent = `${x.label}: ${x.help}`; preset.append(o); }
      }
      const apply = button("Apply preset", () => { if (confirm("Apply this preset? It is recorded like any other change.")) send({ t: "config_preset", id: preset!.value }); });
      const hist = el("div", "bt-list");
      for (const h of s.params) { const r = el("div", "bt-item"); r.append(el("span", "bt-mono", h.hash), el("span", "bt-grow", h.cause), el("span", "bt-dim", `tick ${num(h.tick)}`)); hist.append(r); }
      params.replaceChildren(h("div", "bt-actions", preset, apply), note("Single settings are in the settings dialog. The sets below are what was in force, newest first."), hist);
      const total = s.perf.reduce((x: number, p: any) => x + p.ms, 0) || 1;
      perf.replaceChildren(s.perf.length ? bars(s.perf.slice(0, 8).map((p: any) => ({ label: p.name, share: p.ms / total, text: `${Math.round((p.ms / total) * 100)}%`, title: `${p.ms.toFixed(0)} ms over ${num(p.runs)} runs` }))) : empty("No measurements yet."));
      plugins.replaceChildren();
      if (pl) {
        const list = el("div", "bt-list");
        for (const p of pl.plugins as any[]) { const r = el("div", "bt-item"); r.append(chip(p.status, p.status === "active" ? "good" : "bad"), el("b", "", p.name), el("span", "bt-dim bt-grow", p.status === "active" ? p.capabilities.join(", ") : p.reason)); list.append(r); }
        plugins.append(list, note(`${pl.sandbox.runs} sandbox runs · ${pl.sandbox.timeouts} timeouts · ${pl.sandbox.crashes} crashes`));
      } else plugins.append(empty("Plugin status is not available."));
    },
  };
}
