import { $, ago, el } from "../dom.ts";
import { ctx, S } from "../state.ts";
import { EMOTIONS, type EmotionName } from "../../shared/emotions.ts";
import type { Sting } from "../audio.ts";
import type { Moment } from "../../shared/types.ts";
import { toast } from "./chrome.ts";

export const dominant = (m: Moment): EmotionName | null => (Object.entries(m.emotions).sort((a, b) => b[1] - a[1])[0]?.[0] as EmotionName) ?? null;
const stingFor = (n: EmotionName | null): Sting | null => n === "wonder" ? "wonder" : n === "pride" || n === "playfulness" ? "joy" : n === "grief" || n === "longing" || n === "loneliness" ? "sorrow" : n === "dread" || n === "frustration" ? "fear" : null;

/** Something mattered. The bigger it was, the more of these happen: a toast, the camera glances toward it, a short musical mark. */
export function onMoment(m: Moment) {
  S.moments.unshift(m); S.moments.length = Math.min(S.moments.length, 60);
  const d = dominant(m), color = d ? EMOTIONS[d].color : "var(--accent)";
  if (m.intensity >= 0.45) toast({ title: m.title, body: m.kind === "first" ? "A first for River." : m.text, color, ttl: 9000 });
  if (m.intensity >= 0.4) ctx.scene?.focusOn(m.x, m.z);
  const s = stingFor(d); if (s && m.intensity >= 0.6) ctx.audio?.sting(s);
  if ($("tab-story").classList.contains("active")) renderTurningPoints($("tab-story").querySelector<HTMLElement>("#turning"));
}

export function renderTurningPoints(box: HTMLElement | null) {
  if (!box) return; box.replaceChildren();
  if (!S.moments.length) return void box.append(el("div", "muted small", "Nothing has stirred River strongly yet."));
  for (const m of S.moments.slice(0, 8)) {
    const d = dominant(m), row = el("button", "moment"); row.style.setProperty("--c", d ? EMOTIONS[d].color : "var(--accent)");
    const top = el("div", "row"); top.append(el("span", "mt", m.title), el("span", "muted small", ago(m.ts)));
    const bar = el("span", "meter"); const i = el("i"); i.style.width = `${Math.round(m.intensity * 100)}%`; bar.append(i);
    row.append(top, bar); row.title = "Look at where it happened"; row.onclick = () => ctx.scene?.focusOn(m.x, m.z, 8000, true); box.append(row);
  }
}
