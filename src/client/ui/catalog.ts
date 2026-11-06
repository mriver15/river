// The catalog: everything that isn't nature. Entries are "available" (in the box) or "in world". Place them near River, at their
// usual spot, or anywhere by clicking the map.
import { $, clamped, el, icon } from "../dom.ts";
import { S, send } from "../state.ts";
import { HALF, WORLD_SIZE } from "../../shared/noise.ts";
import { ask, toast } from "./chrome.ts";
import type { CatalogEntry } from "../../shared/types.ts";

let picking: { id: string; name: string } | null = null;

export async function addGift(placeNow: boolean) {
  const v = await ask(placeNow ? "Leave something for River" : "Add to the catalog", [
    { key: "name", label: "What is it?", placeholder: "a brass key" },
    { key: "item", label: "Or a real thing River can use (optional)", placeholder: "stone, cord, lamp, bowl, berry…" },
    { key: "desc", label: "What River sees when it looks closely", placeholder: "Warm, as if recently held.", multiline: true },
    { key: "text", label: "Words on it, if it can be read (optional)", placeholder: "Engraved: for the door that isn't here.", multiline: true },
    { key: "fixed", type: "checkbox", label: "Fixed in place (a structure; it can't be picked up)" },
    { key: "glow", type: "checkbox", label: "It glows (gives light and warmth)" },
  ], placeNow ? "Leave it near River" : "Add");
  if (!v?.name && !v?.item) return;
  send({ t: "catalog_add", name: v.name || "", item: v.item || undefined, desc: v.desc || "", text: v.text || undefined, fixed: v.fixed === "true", glow: v.glow === "true", place: placeNow });
  toast({ title: placeNow ? "Left for River" : "Added", body: placeNow ? `"${v.name || v.item}" appears a few paces from River.` : `"${v.name || v.item}" is in the catalog, available to place.`, ttl: 5000 });
}

/** Choosing a spot happens on the map, so bring the map into view first. */
function startPick(c: CatalogEntry) { picking = { id: c.id, name: c.name }; $("mapc").classList.add("picking"); renderCatalog(); $("tab-map").scrollTo({ top: 0, behavior: "smooth" }); }
const cancel = () => { if (!picking) return; picking = null; $("mapc").classList.remove("picking"); renderCatalog(); };
export function initCatalog() {
  $("mapc").addEventListener("click", (e) => {
    if (!picking) return;
    const r = $("mapc").getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * WORLD_SIZE - HALF, z = ((e.clientY - r.top) / r.height) * WORLD_SIZE - HALF;
    send({ t: "catalog_place", id: picking.id, x, z }); cancel();
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });
}

function row(c: CatalogEntry): HTMLElement {
  const d = el("div", `card catrow${c.status === "in_world" ? " live" : ""}`);
  const top = el("div", "row"); top.append(el("b", "", c.name), el("span", `pill ${c.status === "in_world" ? "good" : c.status === "taken" ? "warn" : ""}`, c.status === "in_world" ? "in world" : c.status === "taken" ? "taken" : "available"));
  d.append(top, clamped(c.desc, 2, "sub"));
  if (c.kind === "pack" && c.needs) d.append(el("div", "sub muted", `Some pieces need: ${c.needs.join(", ")}.`));
  if (c.status === "in_world" && c.x != null && c.kind !== "pack") d.append(el("div", "sub muted mono", `at (${c.x.toFixed(0)}, ${c.z!.toFixed(0)})`));
  if (c.status === "taken") d.append(el("div", "sub muted", "River has picked it up, or it is gone from where it was put."));
  const b = el("div", "btns"), btn = (label: string, fn: () => void, cls = "btn sm") => { const x = el("button", cls, label); x.onclick = fn; b.append(x); return x; };
  if (c.kind === "pack") {
    if (c.status === "available") btn("Switch on", () => send({ t: "catalog_place", id: c.id }), "btn sm ok"); else btn("Switch off", () => send({ t: "catalog_retrieve", id: c.id }));
  } else if (c.status === "available") {
    btn("Near River", () => send({ t: "catalog_place", id: c.id }), "btn sm ok");
    btn("On the map…", () => startPick(c));
    if (c.usual) btn("Usual spot", () => send({ t: "catalog_place", id: c.id, x: c.usual!.x, z: c.usual!.z }));
    if (!c.builtin) btn("Delete", () => send({ t: "catalog_delete", id: c.id }), "btn sm no");
  } else {
    btn("Move on the map…", () => startPick(c));
    btn(c.status === "taken" ? "Put back" : "Take out of the world", () => send({ t: "catalog_retrieve", id: c.id }));
  }
  d.append(b); return d;
}

export function renderCatalog() {
  const root = $("catalog"); root.replaceChildren();
  const head = el("div", "cathead"); head.append(el("h3", "", "Structures & gifts"));
  const add = el("button", "btn sm", "Add a gift…"); add.prepend(icon("gift", 14)); add.onclick = () => void addGift(false); head.append(add); root.append(head);
  if (picking) { const p = el("div", "pickbanner"); p.append(document.createTextNode(`Click the map to put “${picking.name}” there.  `), Object.assign(el("button", "link", "Cancel (Esc)"), { onclick: cancel })); root.append(p); }
  const live = S.catalog.filter((c) => c.status !== "available"), box = S.catalog.filter((c) => c.status === "available");
  const group = (title: string, items: CatalogEntry[], open: boolean) => { if (!items.length) return; const d = el("details", "group"); d.open = open; const sm = el("summary"); sm.append(document.createTextNode(`${title} `), el("span", "n", `(${items.length})`)); d.append(sm); items.forEach((c) => d.append(row(c))); root.append(d); };
  group("In the world", live, true); group("Available", box, true);
  if (!S.catalog.length) root.append(el("div", "empty", "Nothing in the catalog yet."));
}
