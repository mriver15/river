// Draws items from their visual packets. One builder serves the ground, the pack previews and the body, so a thing looks like itself everywhere.
// Geometry is shared across every item, materials are shared by look and counted, and nothing is kept once the last item using it is gone.
import * as THREE from "three";
import { BODY_SOCKETS, groundScale, orient, resolve, wornDesign, type Component, type Style, type VisualPacket } from "../../content/visuals.ts";
import { defById } from "../../content/items.ts";

const geos = new Map<string, THREE.BufferGeometry>();         // a handful of unit shapes, kept for the life of the page
function unit(k: Component): THREE.BufferGeometry {
  const key = `${k.shape}|${k.open ? 1 : 0}|${k.arc ?? 1}`;
  let g = geos.get(key);
  if (!g) {
    g = k.shape === "box" ? new THREE.BoxGeometry(1, 1, 1)
      : k.shape === "sphere" ? new THREE.SphereGeometry(0.5, 10, 8)
      : k.shape === "cylinder" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, !!k.open, 0, (k.arc ?? 1) * Math.PI * 2)
      : k.shape === "cone" ? new THREE.ConeGeometry(0.5, 1, 12, 1, !!k.open)
      : new THREE.TorusGeometry(0.375, 0.125, 8, 18);
    geos.set(key, g);
  }
  return g;
}

const mats = new Map<string, { m: THREE.MeshStandardMaterial; refs: number }>();
const matKey = (s: Style, double: boolean) => `${s.color}|${s.roughness.toFixed(2)}|${s.metalness}|${s.opacity}|${s.emissive}|${s.emissiveIntensity}|${double ? 1 : 0}`;
function acquire(s: Style, double: boolean): { key: string; m: THREE.MeshStandardMaterial } {
  const key = matKey(s, double);
  let e = mats.get(key);
  if (!e) {
    e = { refs: 0, m: new THREE.MeshStandardMaterial({ color: s.color, roughness: s.roughness, metalness: s.metalness, transparent: s.opacity < 1, opacity: s.opacity, emissive: s.emissive, emissiveIntensity: s.emissiveIntensity, side: double ? THREE.DoubleSide : THREE.FrontSide, flatShading: false }) };
    mats.set(key, e);
  }
  e.refs++; return { key, m: e.m };
}
/** Give back what an item was using. Materials nobody uses any more are disposed. */
export function disposeItem(o: THREE.Object3D) {
  const keys = o.userData.matKeys as string[] | undefined;
  if (!keys) return;
  for (const k of keys) { const e = mats.get(k); if (e && --e.refs <= 0) { e.m.dispose(); mats.delete(k); } }
  o.userData.matKeys = undefined;
}
export const liveMaterials = () => mats.size;

function addParts(into: THREE.Group, comps: Component[], style: Record<string, Style>, keys: string[]) {
  for (const k of comps) {
    const { key, m } = acquire(style[k.channel]!, !!k.open); keys.push(key);
    const o = orient(k), mesh = new THREE.Mesh(unit(k), m);
    mesh.scale.set(...o.scale); mesh.rotation.set(...o.rot); mesh.position.set(...k.pos);
    mesh.castShadow = k.channel !== "glow";
    into.add(mesh);
  }
}

export interface BuiltItem extends THREE.Group { userData: { matKeys?: string[]; near: THREE.Group; far: THREE.Group; diagnostic?: string; halfHeight: number } }
/** Past this distance (metres from the camera) an item is drawn from only its major parts. */
export const LOD_FAR = 32;

export function buildItem(p: VisualPacket, opts: { ground?: boolean } = {}): BuiltItem {
  const r = resolve(p), g = new THREE.Group() as BuiltItem, keys: string[] = [];
  const near = new THREE.Group(), far = new THREE.Group();
  addParts(near, r.components, r.style, keys);
  const major = r.components.filter((k) => k.major); addParts(far, major.length ? major : r.components.slice(0, 1), r.style, keys);
  far.visible = false; g.add(near, far);
  if (opts.ground) g.scale.setScalar(groundScale(defById(p.defId).dims));
  g.userData = { matKeys: keys, near, far, diagnostic: r.diagnostic, halfHeight: r.bounds.size[1] / 2 };
  if (r.diagnostic) console.warn(`[visuals] ${p.defId}: ${r.diagnostic}`);
  return g;
}
export function setLod(o: THREE.Object3D, dist: number) {
  const u = o.userData as Partial<BuiltItem["userData"]>; if (!u.near || !u.far) return;
  const far = dist > LOD_FAR; if (u.far.visible !== far) { u.far.visible = far; u.near.visible = !far; }
}

/** A garment as worn, anchored where its slot's socket is on the body. */
export function buildWorn(garment: string, p: VisualPacket | null, hex: string): THREE.Group | null {
  const w = wornDesign(garment); if (!w) return null;
  const base = p ?? { recipeId: "garment", version: "1", seed: 1, parameters: {}, defId: "garment", mats: ["hide"], look: { wet: 0, char: 0, damage: 0, hot: false, repaired: false } };
  const r = resolve({ ...base, parameters: { ...base.parameters, hex } }), g = new THREE.Group(), keys: string[] = [];
  const s = BODY_SOCKETS[w.slot]!; g.position.set(...s);
  addParts(g, w.components, r.style, keys); g.userData.matKeys = keys;
  return g;
}
