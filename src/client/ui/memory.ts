import { $, el, ago } from "../dom.ts";

let timer: number | undefined;
let results: any[] = [];
let kinds = new Set<string>();
let info = "";

function draw() {
  const box = $("memlist"); box.replaceChildren();
  const present = [...new Set(results.map((m) => m.kind as string))];
  const chips = $("memkinds"); chips.replaceChildren();
  for (const k of present) { const b = el("button", `chipbtn${kinds.has(k) ? " on" : ""}`, k); b.onclick = () => { kinds.has(k) ? kinds.delete(k) : kinds.add(k); draw(); }; chips.append(b); }
  $("meminfo").textContent = info;
  const shown = results.filter((m) => !kinds.size || kinds.has(m.kind));
  if (!shown.length) return void box.append(el("div", "empty", "No memories match."));
  for (const m of shown) {
    const c = el("div", "card"), row = el("div", "row"), meta = el("span", "row");
    const imp = el("span", "imp"); imp.title = `importance ${m.importance}/10`; for (let i = 0; i < 5; i++) imp.append(el("i", i < Math.round(m.importance / 2) ? "on" : ""));
    meta.style.gap = "8px"; meta.append(el("span", "pill", m.kind), imp); row.append(meta, el("span", "muted small", ago(m.ts)));
    c.append(row, el("div", "", m.text)); c.lastElementChild!.setAttribute("style", "margin-top:6px"); box.append(c);
  }
}

export async function loadMemories(q = "") {
  const r = await (await fetch(`/api/memories?q=${encodeURIComponent(q)}`)).json();
  results = r.memories; info = `${r.total} memories · ${r.embedded} indexed by meaning · ${q ? `${r.memories.length} match` : "newest first"}`; draw();
}
export function initMemory() {
  const form = $("memform") as HTMLFormElement, inp = $("memq") as HTMLInputElement;
  form.onsubmit = (e) => { e.preventDefault(); void loadMemories(inp.value); };
  inp.oninput = () => { clearTimeout(timer); timer = window.setTimeout(() => void loadMemories(inp.value), 250); };
}
