// When River dies, the world stops and waits for a human to begin a new life. The old one is kept: its grave stays on the island.
import { el } from "../dom.ts";
import { S, send } from "../state.ts";

let box: HTMLElement | null = null;
export function renderDeath() {
  const d = S.agent?.body?.dead;
  if (!d) { box?.remove(); box = null; return; }
  if (box) return;
  const card = el("div", "death-card"); box = el("div", "death-overlay"); box.append(card);
  const btn = el("button", "primary", "Begin a new life"); btn.onclick = () => { btn.disabled = true; btn.textContent = "Beginning…"; send({ t: "new_life" }); };
  card.append(el("h2", "", "River has died"), el("p", "", `${d.cause[0].toUpperCase()}${d.cause.slice(1)}. ${S.agent!.name} lived ${d.days < 1 ? "less than a day" : `${d.days} days`}.`),
    el("p", "muted small", "Its grave and what it carried are left where it fell. A new River will be born bare and blank, and may find them."), btn);
  document.body.append(box);
}
