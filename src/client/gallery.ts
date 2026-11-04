// The visual gallery: every definition in every condition, every garment on the body slots, and the fallback. It is the fixture that
// screenshot checks run against, and the page reports its own findings in window.__gallery so a check does not depend on pixels alone.
import * as THREE from "three";
import { ITEM_DEFS } from "../content/items.ts";
import { GARMENT_SPECS } from "../content/recipes.ts";
import { NEW_LOOK, VISUAL_VERSION, boundsOf, collisionBounds, designOf, resolve, type Look, type VisualPacket } from "../content/visuals.ts";
import { buildItem, buildWorn, liveMaterials, disposeItem } from "./renderers/items.ts";
import { previewOf, renderObject } from "./renderers/preview.ts";

const CONDITIONS: [string, Look][] = [
  ["new", NEW_LOOK], ["wet", { ...NEW_LOOK, wet: 1 }], ["burnt", { ...NEW_LOOK, char: 1 }], ["hot", { ...NEW_LOOK, hot: true }],
  ["worn", { ...NEW_LOOK, damage: 1 }], ["cracked", { ...NEW_LOOK, damage: 2 }], ["broken", { ...NEW_LOOK, damage: 3 }], ["repaired", { ...NEW_LOOK, damage: 1, repaired: true }],
];
const root = document.getElementById("root")!;
const report: { tiles: { id: string; section: string; ok: boolean; note?: string }[]; materials: number; fallbacks: string[] } = { tiles: [], materials: 0, fallbacks: [] };
(window as any).__gallery = report;

const only = new URLSearchParams(location.search).get("only");                   // ?only=worn shows one section, for screenshots
const section = (title: string, key = "items") => { const h = document.createElement("h2"), g = document.createElement("div"); h.textContent = title; g.className = "grid"; if (!only || only === key) root.append(h, g); return g; };
function tile(into: HTMLElement, id: string, sec: string, caption: string, src: string | (() => string), check?: () => string | null) {
  const f = document.createElement("figure"), cap = document.createElement("figcaption"), img = new Image();
  let note: string | null = null, url = "";
  try { url = typeof src === "string" ? src : src(); note = check?.() ?? null; } catch (e) { note = String(e); }
  img.src = url; img.alt = caption; cap.textContent = caption; f.dataset.id = id; f.dataset.section = sec;
  if (note) { f.classList.add("bad"); cap.textContent += ` — ${note}`; }
  f.append(img, cap); into.append(f); report.tiles.push({ id, section: sec, ok: !note, note: note ?? undefined });
}

const packetFor = (defId: string, look: Look, extra: Record<string, unknown> = {}): VisualPacket => {
  const d = ITEM_DEFS.find((x) => x.id === defId)!;
  return { recipeId: d.visual, version: VISUAL_VERSION, seed: 20260101, parameters: { variant: d.id, ...(d.id === "garment" ? { garment: "tunic" } : {}), ...extra }, defId, mats: d.parts.map((p) => p.material), look };
};
const sizeOk = (p: VisualPacket) => () => {
  const b = boundsOf(designOf(p)), want = collisionBounds(ITEM_DEFS.find((d) => d.id === p.defId)!).size;
  return b.size.every((v, i) => Math.abs(v - want[i]!) < 1e-6 * Math.max(1, want[i]!)) ? null : "size disagrees with definition";
};

for (const d of ITEM_DEFS) {
  const g = section(`${d.name} (${d.id} → ${d.visual})`);
  for (const [name, look] of CONDITIONS) { const p = packetFor(d.id, look); tile(g, `${d.id}:${name}`, "items", name, () => previewOf(p, 96), sizeOk(p)); }
}

{
  const g = section("Garments in the pack, dyed", "garments");
  for (const name of Object.keys(GARMENT_SPECS)) { const p = packetFor("garment", NEW_LOOK, { garment: name, hex: "#b5533c" }); tile(g, `garment:${name}`, "garments", name, () => previewOf(p, 96), sizeOk(p)); }
}

{
  const g = section("Worn on the body (one tile per garment, and wet / damaged)", "worn");
  const skin = new THREE.MeshStandardMaterial({ color: 0xe3b48a, roughness: 0.7 });
  const mannequin = () => {
    const m = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, skin); o.position.set(x, y, z); m.add(o); };
    add(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), 0, 1.0, 0); add(new THREE.SphereGeometry(0.3, 14, 12), 0, 1.68, 0);
    for (const x of [-0.36, 0.36]) add(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), x, 0.95, 0);
    for (const x of [-0.13, 0.13]) add(new THREE.CapsuleGeometry(0.1, 0.4, 4, 8), x, 0.3, 0);
    return m;
  };
  for (const name of Object.keys(GARMENT_SPECS)) for (const [cond, look] of [["new", NEW_LOOK], ["wet", { ...NEW_LOOK, wet: 1 }], ["worn", { ...NEW_LOOK, damage: 2 }]] as [string, Look][]) {
    tile(g, `worn:${name}:${cond}`, "worn", `${name} · ${cond}`, () => {
      const m = mannequin(), w = buildWorn(name, packetFor("garment", look, { garment: name }), "#b5533c"); if (!w) throw new Error("no worn design");
      m.add(w); const url = renderObject(m, 120, -0.5); m.remove(w); disposeItem(w); return url;
    });
  }
}

{
  const g = section("Fallback: unknown recipe, unknown version", "fallback");
  for (const bad of [{ recipeId: "from-the-future" }, { version: "99" }]) {
    const p = { ...packetFor("flute", NEW_LOOK), ...bad } as VisualPacket, r = resolve(p);
    if (r.diagnostic) report.fallbacks.push(r.diagnostic);
    tile(g, `fallback:${Object.keys(bad)[0]}`, "fallback", r.diagnostic ?? "(no diagnostic)", () => { const o = buildItem(p); const u = renderObject(o, 96); disposeItem(o); return u; }, () => (r.diagnostic ? null : "fallback did not say why"));
  }
}

report.materials = liveMaterials();
document.title = `Item gallery (${report.tiles.length} tiles, ${report.tiles.filter((t) => !t.ok).length} problems)`;
