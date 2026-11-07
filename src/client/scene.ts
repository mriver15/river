import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HALF, WORLD_SIZE, groveness, heightAt, hash2 } from "../shared/noise.ts";
import type { AgentView, Entity, FxKind, Weather } from "../shared/types.ts";
import { buildItem, buildWorn, disposeItem, setLod } from "./renderers/items.ts";
import { defForKind } from "../content/items.ts";
import { RULES, type SeasonId } from "../sim/seasons.ts";
import { NEW_LOOK, VISUAL_VERSION, type VisualPacket } from "../content/visuals.ts";
import { NEUTRAL_POSTURE, postureOf, type Posture } from "../shared/posture.ts";

const col = (h: number) => new THREE.Color(h);

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function label(text: string, opts: { color?: string; size?: number; bubble?: boolean } = {}) {
  const size = opts.size ?? 28, pad = 14;
  const lines = wrap(text, opts.bubble ? 26 : 40);
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  g.font = `600 ${size}px system-ui, sans-serif`;
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + pad * 2;
  const h = lines.length * size * 1.25 + pad * 2;
  c.width = w; c.height = h;
  g.font = `600 ${size}px system-ui, sans-serif`;
  g.fillStyle = opts.bubble ? "rgba(255,255,255,0.95)" : "rgba(10,14,20,0.6)";
  g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill();
  g.fillStyle = opts.bubble ? "#151a22" : opts.color ?? "#e6e9ef";
  g.textBaseline = "top";
  lines.forEach((l, i) => g.fillText(l, pad, pad + i * size * 1.25));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.renderOrder = 10;
  const k = opts.bubble ? 0.0105 : 0.0085;
  s.scale.set(w * k, h * k, 1);
  return s;
}
function wrap(t: string, n: number) {
  const out: string[] = []; let cur = "";
  for (const word of t.split(/\s+/)) { if ((cur + " " + word).trim().length > n) { out.push(cur); cur = word; } else cur = (cur + " " + word).trim(); }
  if (cur) out.push(cur);
  return out.slice(0, 6);
}

let smokeTex: THREE.CanvasTexture | null = null;
function smokeTexture() {
  if (smokeTex) return smokeTex;
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (smokeTex = new THREE.CanvasTexture(c));
}

/** Things River built: real shapes, in the colours it chose (or the colours of what they are made of). */
function buildStructure(e: Entity, g: THREE.Group) {
  const p = e.props, size = ({ small: 1, medium: 1.6, large: 2.4 } as Record<string, number>)[p.size] ?? 1, col = (part: string) => new THREE.Color(p.colors?.[part] ?? "#8a6a45");
  const M = (part: string, extra: THREE.MeshStandardMaterialParameters = {}) => mat(col(part).getHex(), { roughness: 1, ...extra }), box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z);
  const path = p.path as { x1: number; z1: number; x2: number; z2: number; width?: number } | undefined;
  const len = path ? Math.hypot(path.x2 - path.x1, path.z2 - path.z1) : 0;
  switch (p.shape) {
    case "hut": {
      const w = 2.2 * size, h = 1.3 + 0.25 * size;
      g.add(box(w, h, w, M("walls"), 0, h / 2, 0)); g.add(box(w * 1.06, 0.16, w * 1.06, M("trim"), 0, 0.08, 0));
      const roof = mesh(new THREE.ConeGeometry(w * 0.82, 0.8 + 0.3 * size, 4), M("roof"), 0, h + (0.4 + 0.15 * size), 0); roof.rotation.y = Math.PI / 4; g.add(roof);
      g.add(box(0.05, h * 0.62, 0.5 * Math.min(1.4, size + 0.3), mat(0x1c1612), w / 2 + 0.01, h * 0.31, 0));                 // the door, facing the way it was built to face
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(box(0.14, h, 0.14, M("trim"), (x * w) / 2, h / 2, (z * w) / 2)); break;
    }
    case "lean-to": {
      const w = 2.4 * size, h = 1.5 * size;
      g.add(box(0.12, h, w, M("walls"), -w * 0.3, h / 2, 0));
      const roof = box(w * 0.9, 0.1, w, M("roof"), 0, h * 0.8, 0); roof.rotation.z = 0.5; roof.position.x = -0.1 * w; g.add(roof);
      for (const z of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, h * 0.9, 6), M("trim"), w * 0.28, h * 0.45, (z * w) / 2.2)); break;
    }
    case "bench": { const w = 1.5 * size; g.add(box(w, 0.12, 0.5 * Math.sqrt(size), M("walls"), 0, 0.46, 0)); for (const x of [-1, 1]) g.add(box(0.12, 0.46, 0.4, M("trim"), (x * w) / 2.6, 0.23, 0)); break; }
    case "cairn": { const n = Math.round(4 + size * 1.5); for (let i = 0; i < n; i++) { const r = (0.55 - (i / n) * 0.38) * Math.sqrt(size), s = mesh(new THREE.DodecahedronGeometry(r, 0), M("walls", { flatShading: true }), (hash2(i, 5, 9) - 0.5) * 0.1, i * r * 0.95 + r * 0.7, (hash2(i, 7, 3) - 0.5) * 0.1); s.rotation.set(i, i * 2, 0); g.add(s); } break; }
    case "tower": { const h = 3 + 1.4 * size, r = 0.6 * Math.sqrt(size); g.add(mesh(new THREE.CylinderGeometry(r * 0.8, r * 1.15, h, 8), M("walls"), 0, h / 2, 0)); g.add(mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.18, 8), M("trim"), 0, h + 0.05, 0)); g.add(box(0.05, 0.9, 0.4, mat(0x1c1612), r * 1.1, 0.5, 0)); break; }
    case "platform": { const w = 3 * size; g.add(box(w, 0.18, w, M("deck"), 0, 0.4, 0)); for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 6), M("trim"), (x * w) / 2.2, 0.2, (z * w) / 2.2)); break; }
    case "wall": g.add(box(len, 0.95, 0.45, M("walls", { flatShading: true }), 0, 0.47, 0)); g.add(box(len, 0.12, 0.58, M("trim"), 0, 1.0, 0)); break;
    case "fence": { const n = Math.max(2, Math.round(len)); for (let i = 0; i <= n; i++) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.05, 6), M("trim"), -len / 2 + (len * i) / n, 0.5, 0)); for (const y of [0.4, 0.8]) g.add(box(len, 0.07, 0.07, M("walls"), 0, y, 0)); break; }
    case "bridge": {
      const wd = path?.width ?? 1.8; g.add(box(len, 0.18, wd, M("deck"), 0, 0, 0));
      for (let i = 1; i < Math.floor(len / 0.45); i++) g.add(box(0.03, 0.2, wd * 1.01, mat(0x2a1f14), -len / 2 + i * 0.45, 0.01, 0));      // plank seams
      for (const z of [-1, 1]) { g.add(box(len, 0.08, 0.08, M("trim"), 0, 0.62, (z * wd) / 2)); const n = Math.max(2, Math.round(len / 1.6)); for (let i = 0; i <= n; i++) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 6), M("trim"), -len / 2 + (len * i) / n, 0.3, (z * wd) / 2)); }
      for (let i = 1; i < Math.floor(len / 3); i++) for (const z of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.8, 6), M("trim"), -len / 2 + i * 3, -0.9, (z * wd) / 2.3)); break;
    }
    default: return false;
  }
  if (p.unfinished) { const k = 0.3 + 0.7 * (p.progress ?? 0); for (const c of g.children) { c.scale.y *= k; c.position.y *= k; } }       // an unfinished structure stands only as high as the work done
  const lb = label(p.unfinished ? `${e.name} (unfinished)` : e.name, { size: 24 }); lb.position.y = (p.shape === "tower" ? 4.6 : p.shape === "bridge" ? 1.4 : p.shape === "cairn" ? 2.2 : 2.6); g.add(lb);
  // orientation: line shapes lie along their path; doors face the way they were built to face
  g.userData.rot = path ? -Math.atan2(path.z2 - path.z1, path.x2 - path.x1) : -(p.heading ?? 0);
  return true;
}

/** Flames, glow and smoke for anything with props.burning. Animated in Scene3D.frame() via userData. */
function addFlames(g: THREE.Group, e: Entity) {
  const [h, w] = e.kind === "tree" ? [3.4, 1.5] : e.kind === "structure" ? [1.8, 1.4] : e.kind === "bush" ? [1.2, 0.9] : [0.55, 0.4];
  const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false } as const;
  for (let i = 0; i < 6; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(w * 0.32, h * 0.6, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffc23a : 0xff6a14, opacity: 0.85, ...add }));
    const a = (i / 6) * Math.PI * 2;
    cone.position.set(Math.cos(a) * w * 0.55, h * (e.kind === "tree" ? 0.35 + (i % 3) * 0.28 : 0.3), Math.sin(a) * w * 0.55);
    cone.userData.flameCone = { phase: i * 1.7, base: 0.8 + (i % 3) * 0.2 };
    g.add(cone);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: 0xff7a1a, opacity: 0.55, ...add }));
  glow.position.y = h * 0.5; glow.scale.setScalar(w * 5); glow.userData.glow = w * 5; g.add(glow);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: 0x555555, transparent: true, opacity: 0.3, depthWrite: false }));
    s.userData.smoke = { phase: i / 5, h, w }; g.add(s);
  }
  g.userData.burning = true;
}

const mat = (c: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9, ...extra });
/** Foliage: remembers its summer colour so the seasons can lean it toward gold or grey and back. */
const leafMat = (c: number) => { const m = mat(c); m.userData.leaf = c; return m; };
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };

const WILDLIFE: Record<string, true> = { snake: true, beetle: true, butterfly: true, midges: true, fish: true, gull: true, heron: true, owl: true, songbird: true, wolf: true, boar: true, bear: true };
/** Wild animals, built along +x like the deer. userData tags drive their animation (wings, tails, snake body, swarm). */
function wildMesh(g: THREE.Group, sp: string, dark: (c: number) => THREE.MeshStandardMaterial, r: number) {
  const add = (geo: THREE.BufferGeometry, c: number, x: number, y: number, z: number) => { const m = mesh(geo, dark(c), x, y, z); g.add(m); return m; };
  const S = THREE.SphereGeometry, B = THREE.BoxGeometry, C = THREE.CylinderGeometry, K = THREE.ConeGeometry;
  const wings = (c: number, span: number, y: number, x = 0, len = 0.3) => { for (const s of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(x, y, 0); piv.userData.flap = s; const wing = mesh(new B(len, 0.02, span), dark(c), 0, 0, s * span / 2); piv.add(wing); g.add(piv); } };
  if (sp === "snake") {
    const segs: THREE.Mesh[] = [];
    for (let i = 0; i < 9; i++) { const m = mesh(new S(0.075 - i * 0.004, 7, 6), dark(i % 2 ? 0x6b5a34 : 0x4f4528), 0, 0.07, 0); g.add(m); segs.push(m); }
    segs[0].scale.set(1.5, 1, 1.2); g.userData.segs = segs;
  } else if (sp === "beetle") { add(new S(0.07, 7, 6), 0x151a2a, 0, 0.06, 0).scale.set(1.4, 0.8, 1); add(new S(0.04, 6, 5), 0x0a0c14, 0.1, 0.06, 0); }
  else if (sp === "butterfly") { add(new C(0.015, 0.015, 0.14, 4), 0x3a2a1a, 0, 0, 0).rotation.z = Math.PI / 2; wings(0xe0952c, 0.16, 0.01, 0, 0.14); }
  else if (sp === "midges") { for (let i = 0; i < 18; i++) { const m = mesh(new S(0.025, 4, 4), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), 0, 0, 0); m.userData.midge = i * 1.7; m.castShadow = false; g.add(m); } }
  else if (sp === "fish") {
    const body = add(new S(0.2, 8, 6), 0xb9c9d6, 0, 0, 0); body.scale.set(1.8, 0.7, 0.5);
    const tail = new THREE.Group(); tail.position.x = -0.34; tail.userData.tail = 1; const f = mesh(new K(0.13, 0.22, 4), dark(0x8fa6b8), 0, 0, 0); f.rotation.z = Math.PI / 2; f.position.x = -0.1; tail.add(f); g.add(tail);
    add(new K(0.05, 0.12, 4), 0x8fa6b8, 0, 0.12, 0);
  } else if (sp === "gull") {
    add(new S(0.14, 8, 6), 0xf4f4f0, 0, 0.18, 0).scale.set(1.6, 0.9, 0.9); add(new S(0.07, 6, 5), 0xf4f4f0, 0.22, 0.24, 0); add(new K(0.025, 0.1, 4), 0xe8a020, 0.31, 0.24, 0).rotation.z = -Math.PI / 2;
    wings(0xe4e6e8, 0.55, 0.22, 0, 0.2); add(new B(0.18, 0.03, 0.12), 0x5a5e66, -0.2, 0.2, 0);
  } else if (sp === "heron") {
    add(new S(0.16, 8, 6), 0x8a98a8, 0, 0.75, 0).scale.set(1.5, 1, 0.8); add(new C(0.025, 0.025, 0.5, 5), 0x8a98a8, 0.2, 1.05, 0).rotation.z = -0.3; add(new S(0.06, 6, 5), 0xdde4ea, 0.3, 1.32, 0);
    add(new K(0.025, 0.2, 4), 0xd8a030, 0.45, 1.3, 0).rotation.z = -Math.PI / 2; for (const z of [-0.05, 0.05]) add(new C(0.015, 0.015, 0.7, 4), 0x60584a, 0, 0.35, z);
    wings(0x7a8898, 0.5, 0.8, 0, 0.25);
  } else if (sp === "owl") {
    add(new S(0.17, 8, 7), 0xcbbfa6, 0, 0.3, 0).scale.set(1, 1.3, 1); add(new S(0.13, 8, 7), 0xd8ccb2, 0.02, 0.58, 0);
    for (const z of [-0.06, 0.06]) add(new S(0.04, 6, 5), 0xffd860, 0.11, 0.6, z); wings(0xb0a58e, 0.4, 0.34, 0, 0.18);
  } else if (sp === "songbird") {
    add(new S(0.07, 7, 6), 0x8a6a48, 0, 0.1, 0).scale.set(1.4, 1, 1); add(new S(0.045, 6, 5), 0x9a7a58, 0.1, 0.14, 0); add(new K(0.015, 0.05, 4), 0xe0b040, 0.15, 0.14, 0).rotation.z = -Math.PI / 2; wings(0x6e5238, 0.22, 0.12, 0, 0.1);
  } else if (sp === "wolf") {
    add(new B(0.95, 0.34, 0.3), 0x7c8088, 0, 0.62, 0); add(new B(0.34, 0.28, 0.24), 0x8a8e96, 0.6, 0.7, 0); add(new B(0.2, 0.12, 0.14), 0x6a6e76, 0.82, 0.64, 0);
    for (const z of [-0.07, 0.07]) { add(new K(0.05, 0.12, 4), 0x6a6e76, 0.56, 0.9, z); add(new S(0.025, 4, 4), 0xe8e0a0, 0.74, 0.74, z * 1.4); }
    add(new C(0.06, 0.03, 0.55, 5), 0x7c8088, -0.6, 0.55, 0).rotation.z = 1.1;
    for (const [x, z] of [[-0.32, -0.1], [-0.32, 0.1], [0.32, -0.1], [0.32, 0.1]]) add(new C(0.045, 0.035, 0.5, 5), 0x555960, x, 0.25, z);
  } else if (sp === "boar") {
    add(new B(1.0, 0.5, 0.52), 0x4a3a2c, 0, 0.55, 0); add(new B(0.42, 0.34, 0.34), 0x3e3024, 0.62, 0.5, 0); add(new B(0.18, 0.18, 0.22), 0x5a4a3a, 0.88, 0.42, 0);
    for (const z of [-0.13, 0.13]) add(new K(0.03, 0.16, 4), 0xe8dcb0, 0.84, 0.5, z).rotation.z = -0.9;
    add(new B(0.7, 0.14, 0.14), 0x2a2018, 0, 0.84, 0);
    for (const [x, z] of [[-0.35, -0.17], [-0.35, 0.17], [0.35, -0.17], [0.35, 0.17]]) add(new C(0.06, 0.05, 0.36, 5), 0x2a2018, x, 0.18, z);
  } else if (sp === "bear") {
    add(new B(1.5, 0.85, 0.8), 0x5a3e28, 0, 1.0, 0); add(new B(0.5, 0.5, 0.46), 0x4e3422, 0.95, 1.25, 0); add(new B(0.22, 0.2, 0.26), 0x8a6a4a, 1.25, 1.13, 0);
    for (const z of [-0.18, 0.18]) add(new S(0.09, 6, 5), 0x3a2616, 0.98, 1.55, z);
    for (const [x, z] of [[-0.55, -0.28], [-0.55, 0.28], [0.55, -0.28], [0.55, 0.28]]) add(new C(0.14, 0.12, 0.7, 6), 0x3a2616, x, 0.35, z);
  }
  g.userData.wild = sp;
}

/** The server sends every ground item with its look; an item from an older server is drawn from its kind. */
function itemPacket(e: Entity): VisualPacket {
  const sent = e.props.visual as VisualPacket | undefined; if (sent) return sent;
  const d = defForKind(String(e.props.item ?? e.name));
  return { recipeId: d.visual, version: VISUAL_VERSION, seed: Math.round(e.x * 131 + e.z * 17) >>> 0, parameters: { variant: d.id }, defId: d.id, mats: d.parts.map((p) => p.material), look: NEW_LOOK };
}

function buildEntity(e: Entity): THREE.Object3D {
  const g = new THREE.Group();
  const r = hash2(Math.round(e.x * 10), Math.round(e.z * 10), 7);
  switch (e.kind) {
    case "tree": {
      const pine = e.name.includes("pine"), s = 0.8 + r * 0.7;
      g.add(mesh(new THREE.CylinderGeometry(0.18, 0.28, 2 * s, 6), mat(0x6b4a2f), 0, s, 0));
      const leaf = e.name.includes("birch") ? 0x8cc06a : e.name.includes("willow") ? 0x5fa07a : pine ? 0x2f6b46 : 0x3f8a4a;
      if (pine) for (let i = 0; i < 3; i++) g.add(mesh(new THREE.ConeGeometry(1.5 * s - i * 0.35, 1.8 * s, 7), leafMat(leaf), 0, 2.2 * s + i * 1.0 * s, 0));
      else { g.add(mesh(new THREE.IcosahedronGeometry(1.4 * s, 0), leafMat(leaf), 0, 2.9 * s, 0)); g.add(mesh(new THREE.IcosahedronGeometry(0.9 * s, 0), leafMat(leaf), 0.8 * s, 2.3 * s, 0.3)); }
      break;
    }
    case "rock": { const m = mesh(new THREE.DodecahedronGeometry(0.7 + r * 0.5, 0), mat(e.name.includes("mossy") ? 0x6f8a6a : e.name.includes("clay") ? 0xb5714a : e.name.includes("chalk") ? 0xe6e2d6 : e.name.includes("lookout") ? 0x9a978f : 0x8d9199), 0, 0.3, 0); m.scale.y = 0.65; g.add(m); break; }
    case "bush": {
      g.add(mesh(new THREE.IcosahedronGeometry(0.8, 0), mat(0x3d7d3f), 0, 0.5, 0));
      if ((e.props.stock ?? 0) > 0) for (let i = 0; i < Math.min(5, e.props.stock + 1); i++) g.add(mesh(new THREE.SphereGeometry(0.1, 6, 6), mat(0xd23c4a), Math.cos(i * 1.9) * 0.7, 0.6 + (i % 2) * 0.25, Math.sin(i * 1.9) * 0.7));
      break;
    }
    case "flower": {
      const c = e.name.includes("blue") ? 0x5b8bff : e.name.includes("yellow") ? 0xffd84a : e.name.includes("violet") ? 0xb18cff : 0xe84a4a;
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), mat(0x3d7d3f), 0, 0.25, 0));
      g.add(mesh(new THREE.SphereGeometry(0.16, 6, 6), mat(c, { emissive: c, emissiveIntensity: 0.15 }), 0, 0.55, 0));
      break;
    }
    case "mushroom": {
      const glow = e.name.includes("glow");
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), mat(0xe8dcc0), 0, 0.15, 0));
      g.add(mesh(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(glow ? 0x40ffd0 : 0x9a6a45, glow ? { emissive: 0x20c0a0, emissiveIntensity: 1 } : {}), 0, 0.3, 0));
      if (glow) { const l = new THREE.PointLight(0x40ffd0, 1.2, 5); l.position.y = 0.5; g.add(l); }
      break;
    }
    case "shell": g.add(mesh(new THREE.TorusKnotGeometry(0.1, 0.04, 24, 6, 2, 3), mat(0xf2c9c0), 0, 0.12, 0)); break;
    case "library": {
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (i === 3) continue; const h = 1.6 + hash2(i, 3, 5) * 1.4; const w = mesh(new THREE.BoxGeometry(1.4, h, 0.5), mat(0x9a9488), Math.cos(a) * 2.7, h / 2, Math.sin(a) * 2.7); w.rotation.y = -a + Math.PI / 2; g.add(w); }
      const lb = label("Old Library", { size: 30 }); lb.position.y = 4.4; g.add(lb); break;
    }
    case "shrine": {
      [1.4, 1.0, 0.65, 0.35].forEach((s, i) => g.add(mesh(new THREE.BoxGeometry(s, 0.35, s), mat(0xa9a59b), 0, 0.18 + i * 0.35, 0)));
      const l = new THREE.PointLight(0xffd68a, 2, 10); l.position.y = 2; g.add(l);
      const lb = label("Hilltop Shrine"); lb.position.y = 3; g.add(lb); break;
    }
    case "monolith": {
      g.add(mesh(new THREE.BoxGeometry(1.2, 4.2, 0.5), mat(0x15171c, { emissive: 0x5a3cff, emissiveIntensity: Math.min(0.5, 0.22 + 0.04 * (e.props.resonance ?? 0)), roughness: 0.3 }), 0, 2.1, 0));
      const l = new THREE.PointLight(0x7a5cff, 1.6, 12); l.position.y = 3; l.userData.pulse = true; g.add(l);
      const lb = label("Humming Monolith"); lb.position.y = 5.2; g.add(lb); break;
    }
    case "campfire": {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(mesh(new THREE.DodecahedronGeometry(0.22, 0), mat(0x3a3836), Math.cos(a) * 0.8, 0.12, Math.sin(a) * 0.8)); }
      if (e.props.lit === false) { const ash = mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.04, 10), mat(0x4a4743), 0, 0.03, 0); ash.castShadow = false; g.add(ash); break; }   // a cold hearth
      const f = mesh(new THREE.ConeGeometry(0.3, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a2e }), 0, 0.45, 0); f.userData.flame = true; g.add(f);
      const l = new THREE.PointLight(0xff8a30, 2.5, 14); l.position.y = 1; l.userData.flicker = true; g.add(l); break;
    }
    case "book": g.add(mesh(new THREE.BoxGeometry(0.4, 0.1, 0.55), mat([0x8a3a3a, 0x3a5a8a, 0x3a7a5a, 0x8a6a2a][Math.floor(r * 4)]), 0, 0.08, 0)); break;
    case "item": g.add(buildItem(itemPacket(e), { ground: true })); break;
    case "pit": { const d = mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.06, 10), mat(0x3b2a1c), 0, 0.02, 0); d.castShadow = false; g.add(d); g.add(mesh(new THREE.TorusGeometry(0.55, 0.12, 5, 10), mat(0x6a4a30), 0, 0.06, 0)).children[1].rotation.x = Math.PI / 2; break; }
    case "animal": {
      const sp = e.props.species as string;
      const dark = (c: number) => mat(c, { flatShading: true });
      if (sp === "deer") {
        g.add(mesh(new THREE.BoxGeometry(1.1, 0.55, 0.45), dark(0x9a6a40), 0, 0.85, 0));
        g.add(mesh(new THREE.BoxGeometry(0.28, 0.5, 0.28), dark(0x9a6a40), 0.6, 1.2, 0));
        g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.22), dark(0xb58a5c), 0.8, 1.45, 0));
        for (const [x, z] of [[-0.4, -0.15], [-0.4, 0.15], [0.4, -0.15], [0.4, 0.15]]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.7, 5), dark(0x6a4a2a), x, 0.35, z));
      } else if (sp === "rabbit") {
        g.add(mesh(new THREE.SphereGeometry(0.2, 7, 6), dark(0xb9ab98), 0, 0.2, 0));
        g.add(mesh(new THREE.SphereGeometry(0.12, 6, 5), dark(0xb9ab98), 0.2, 0.3, 0));
        for (const z of [-0.04, 0.04]) g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 4), dark(0xb9ab98), 0.22, 0.5, z));
      } else if (sp === "crow") {
        g.add(mesh(new THREE.SphereGeometry(0.16, 7, 6), dark(0x15161a), 0, 0.22, 0));
        g.add(mesh(new THREE.ConeGeometry(0.04, 0.12, 5), dark(0x3a3320), 0.2, 0.28, 0));
      } else if (sp === "fox") {
        g.add(mesh(new THREE.BoxGeometry(0.8, 0.3, 0.28), dark(0xc2602a), 0, 0.4, 0));
        g.add(mesh(new THREE.BoxGeometry(0.25, 0.22, 0.2), dark(0xd9743a), 0.5, 0.5, 0));
        g.add(mesh(new THREE.ConeGeometry(0.1, 0.5, 5), dark(0xe9e4da), -0.6, 0.42, 0));
        for (const [x, z] of [[-0.25, -0.1], [-0.25, 0.1], [0.25, -0.1], [0.25, 0.1]]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.3, 4), dark(0x2a2018), x, 0.15, z));
      } else if (WILDLIFE[sp]) { wildMesh(g, sp, dark, r);
      } else { // firefly
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xc8ff7a }));
        f.position.y = 1.1; f.userData.firefly = r * 6.28; g.add(f);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshBasicMaterial({ color: 0xc8ff7a, transparent: true, opacity: 0.18 }));
        glow.position.y = 1.1; g.add(glow);
      }
      g.userData.animal = true;
      return g;                                  // animals keep their own heading (set per frame)
    }
    case "grave": {
      g.add(mesh(new THREE.SphereGeometry(1.0, 8, 6), mat(0x6a5a44), 0, 0, 0)).children[0].scale.set(1.1, 0.28, 0.6);
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.9, 0.55), mat(0x8d9199), 0.9, 0.45, 0));
      const c = mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat(0x6b4a2a), -0.85, 0.5, 0); const arm = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), mat(0x6b4a2a), -0.85, 0.65, 0); g.add(c, arm); break;
    }
    case "carcass": {
      const col = ({ wolf: 0x7c8088, boar: 0x4a3a2c, bear: 0x5a3e28 } as Record<string, number>)[e.props.species] ?? 0x6a5a4a;
      const b = mesh(new THREE.BoxGeometry(1.0, 0.3, 0.5), mat(col), 0, 0.2, 0); b.rotation.z = 0.08; g.add(b);
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), mat(col), 0.7, 0.15, 0.1));
      for (const [x, z] of [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]]) { const l = mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.4, 5), mat(0x2a2018), x, 0.15, z); l.rotation.z = 1.4; g.add(l); }
      break;
    }
    case "person": {                                                                          // a visitor: a small, plain figure in their own colour
      const col = Number(e.props.hue ?? 0x888888), skin = 0xd2a679, cloth = (c: number) => mat(c, { flatShading: true });
      g.add(mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.95, 7), cloth(col), 0, 0.95, 0));
      g.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), cloth(skin), 0, 1.62, 0));
      for (const x of [-0.12, 0.12]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 5), cloth(0x3a3026), x, 0.25, 0));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.45, 0.2), cloth(0x6a5236), 0, 1.1, -0.28));      // a pack
      const lb = label(String(e.props.who ?? e.name), { size: 24 }); lb.position.y = 2.2; g.add(lb);
      break;
    }
    case "char": {
      const k = e.props.wasKind, tall = k === "tree" ? 1.3 + r * 1.1 : k === "structure" ? 0.5 : 0.3;
      const dark = (c: number) => mat(c, { roughness: 1 });
      const ash = mesh(new THREE.CylinderGeometry(k === "tree" ? 1.6 : 1, k === "tree" ? 1.8 : 1.1, 0.04, 10), dark(0x4a4642), 0, 0.03, 0); ash.castShadow = false; g.add(ash);
      if (k === "structure") for (let i = 0; i < 4; i++) { const b = mesh(new THREE.BoxGeometry(1.3, 0.14, 0.18), dark(0x1c1a18), 0, 0.12 + i * 0.1, 0); b.rotation.y = i * 0.9; g.add(b); }
      else {
        g.add(mesh(new THREE.CylinderGeometry(k === "tree" ? 0.17 : 0.04, k === "tree" ? 0.3 : 0.07, tall, 6), dark(0x1b1917), 0, tall / 2, 0));
        for (let i = 0; i < (k === "tree" ? 3 : 4); i++) { const t = mesh(new THREE.CylinderGeometry(0.02, 0.05, tall * 0.5, 4), dark(0x22201d), Math.cos(i * 2.1) * 0.22, tall * 0.7, Math.sin(i * 2.1) * 0.22); t.rotation.set(Math.sin(i * 2.1) * 0.7, 0, -Math.cos(i * 2.1) * 0.7); g.add(t); }
      }
      break;
    }
    case "trace": if (e.props.mark) {                                                          // a pigment mark on the face of something: a coloured patch standing on edge
      const r = (e.props.span ?? 1.2) / 2, d = mesh(new THREE.CircleGeometry(r, 18), mat(parseInt(String(e.props.hex).slice(1), 16), { roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }), 0, e.props.h ?? 1, 0);
      d.rotation.y = Math.PI / 2 - (e.props.face ?? 0); d.castShadow = false; g.add(d); break;
    } else { const d = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 12), mat(0x3a3328, { transparent: true, opacity: 0.55 }), 0, 0.02, 0); d.castShadow = false; d.scale.set(1, 1, 0.55); g.add(d); break; }
    case "sprout": g.add(mesh(new THREE.ConeGeometry(0.12, 0.45, 5), mat(0x7ad06a), 0, 0.22, 0)); break;
    case "structure": if (e.props.shape && buildStructure(e, g)) { break; } else if (e.props.glow) {            // the Keeper's lamp: a stone post, a lit lamp, and a warm light that pushes the dark back
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 7), mat(0x8a857a), 0, 0.75, 0));
      g.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd58a }), 0, 1.75, 0));
      const l = new THREE.PointLight(0xffc06a, 2.4, 24); l.position.y = 1.8; l.userData.flicker = true; g.add(l);
      const lb = label(e.name, { size: 26 }); lb.position.y = 3; g.add(lb); break;
    } else {
      const c = [0x8a6a45, 0xa88a60, 0x7a7468][Math.floor(r * 3)];
      g.add(mesh(new THREE.BoxGeometry(1.8, 0.9, 1.8), mat(c), 0, 0.45, 0));
      const roof = mesh(new THREE.ConeGeometry(1.6, 0.9, 4), mat(0x6a4a30), 0, 1.3, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
      const lb = label(e.name, { size: 26 }); lb.position.y = 2.6; g.add(lb); break;
    }
  }
  if (e.props.burning) addFlames(g, e);
  g.rotation.y = g.userData.rot ?? r * Math.PI * 2;
  return g;
}

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3a4a30, 0.7);
  stars: THREE.Points;
  entityObjs = new Map<string, THREE.Object3D>();
  entityData = new Map<string, Entity>();
  follow = true;
  private terrainMat?: THREE.MeshStandardMaterial;
  private season: SeasonId | null = null;
  /** The route River has walked since the page opened (or since cleared), drawn as a line that shifts from night-blue to day-gold with the hour. */
  private trail?: { line: THREE.LineSegments; pos: THREE.BufferAttribute; col: THREE.BufferAttribute; n: number; last: { x: number; z: number } | null };
  private static TRAIL_MAX = 12000;
  cutaways = true;
  onPick: (e: Entity | null) => void = () => {};

  private terrainGeo!: THREE.PlaneGeometry;
  private baseColors!: Float32Array;
  private agentGroup = new THREE.Group();
  private limbs: THREE.Group[] = [];
  private garb!: THREE.Group;
  private head!: THREE.Group;
  private posture: Posture = { ...NEUTRAL_POSTURE };
  private wornKey = "";
  private markKey = "";
  private marksG: THREE.Group[] = [];
  private body: THREE.Group;
  private bubble: THREE.Sprite | null = null;
  private bubbleText = "";
  private target = new THREE.Vector3();
  private agent?: AgentView;
  private clock = new THREE.Clock();
  private ray = new THREE.Raycaster();
  private zzz: THREE.Sprite;
  private weather: Weather = "clear";
  private wk = { grey: 0, fogNear: 60, fogFar: 190, dark: 1, rain: 0 };   // smoothed weather look
  private rain!: THREE.LineSegments;
  private moon!: THREE.Mesh;
  private flash = 0;
  private meteors: { line: THREE.Line; t: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];

  constructor(canvas: HTMLCanvasElement, private seed: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camera.position.set(14, 12, 14);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minDistance = 4; this.controls.maxDistance = 120;
    this.controls.addEventListener("start", () => { this.userAt = Date.now(); this.focus = null; });   // the person at the keyboard always wins

    this.scene.fog = new THREE.Fog(0x9fc4e8, 60, 190);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });

    this.buildTerrain();
    this.stars = this.buildStars();
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8ecf6, fog: false }));
    this.scene.add(this.moon);
    const rp = new Float32Array(1400 * 6);
    for (let i = 0; i < 1400; i++) { const x = rand(-30, 30), y = rand(0, 30), z = rand(-30, 30); rp.set([x, y, z, x - 0.15, y - 1.1, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8cce6, transparent: true, opacity: 0.45, fog: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);

    // agent
    this.body = new THREE.Group();
    const skin = mat(0xe3b48a, { flatShading: false, roughness: 0.7 }), hair = mat(0x4a3224, { roughness: 0.95 }), dark = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    this.body.add(mesh(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), skin, 0, 1.0, 0));              // torso
    this.head = new THREE.Group(); this.head.position.set(0, 1.4, 0); this.body.add(this.head);       // pivots at the neck so it can lift and hang
    this.head.add(mesh(new THREE.SphereGeometry(0.3, 14, 12), skin, 0, 0.28, 0));                    // head
    const cap = mesh(new THREE.SphereGeometry(0.325, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.29, -0.02); cap.rotation.x = -0.25; this.head.add(cap);
    this.head.add(mesh(new THREE.SphereGeometry(0.31, 12, 10, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.2), hair, 0, 0.32, -0.08));   // hair falling behind
    for (const sx of [-0.1, 0.1]) this.head.add(mesh(new THREE.SphereGeometry(0.04, 6, 6), dark, sx, 0.3, 0.27));
    this.head.add(mesh(new THREE.SphereGeometry(0.045, 6, 6), skin, 0, 0.24, 0.3));                  // nose
    this.body.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), skin, 0, 1.4, 0));                       // neck
    const limb = (x: number, y: number, len: number, r: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); g.add(mesh(new THREE.CapsuleGeometry(r, len, 4, 8), skin, 0, -len / 2 - r, 0)); this.body.add(g); return g; };
    this.limbs = [limb(-0.36, 1.2, 0.5, 0.08), limb(0.36, 1.2, 0.5, 0.08), limb(-0.13, 0.62, 0.4, 0.1), limb(0.13, 0.62, 0.4, 0.1)];
    this.garb = new THREE.Group(); this.body.add(this.garb);
    this.marksG = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];   // one per limb, plus the torso
    this.limbs.forEach((l, i) => l.add(this.marksG[i])); this.body.add(this.marksG[4]);
    this.agentGroup.add(this.body);
    this.zzz = label("z z z", { size: 30 }); this.zzz.position.y = 2.5; this.zzz.visible = false; this.agentGroup.add(this.zzz);
    this.scene.add(this.agentGroup);

    canvas.addEventListener("pointerdown", (ev) => this.downAt = [ev.clientX, ev.clientY]);
    canvas.addEventListener("pointerup", (ev) => { if (Math.hypot(ev.clientX - this.downAt[0], ev.clientY - this.downAt[1]) < 4) this.pick(ev); });
    addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }
  private downAt: [number, number] = [0, 0];

  private buildTerrain() {
    const seg = 160, geo = new THREE.PlaneGeometry(WORLD_SIZE + 60, WORLD_SIZE + 60, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z, this.seed);
      pos.setY(i, Math.max(h, -2.5));
      const n = hash2(Math.round(x * 3), Math.round(z * 3), 3) * 0.06;
      const c = h < -0.3 ? col(0x6b6a55) : h < 0.5 ? col(0xd9c88f) : h < 3.6 ? col(0x6fae55) : h < 5.8 ? col(0x58934a) : col(0x9a9a8d);
      if (h > 0.5) { const t = groveness(x, z, this.seed) - 0.5; c.r *= 1 - t * 0.2; c.g *= 1 + t * 0.03; c.b *= 1 + t * 0.12; }   // groves sit darker and cooler, meadows warmer and brighter
      colors.set([c.r + n, c.g + n, c.b + n], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.terrainGeo = geo; this.baseColors = colors.slice();
    geo.computeVertexNormals();
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    const terrain = new THREE.Mesh(geo, this.terrainMat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f7fb8, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1 }));
    water.position.y = -0.05; this.scene.add(water);
  }
  private buildStars() {
    const n = 600, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, b = Math.random() * 1.4, r = 300; p.set([Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r + 20, Math.sin(a) * Math.cos(b) * r], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const s = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    return s;
  }

  /** Wear paths into the ground where River walks. cells: HEAT_N x HEAT_N grid of seconds walked. */
  setHeat(cells: number[], scorch: number[] = []) {
    const n = Math.round(Math.sqrt(cells.length)); if (!n || !this.terrainGeo) return;
    const pos = this.terrainGeo.attributes.position, col = this.terrainGeo.attributes.color as THREE.BufferAttribute, path = new THREE.Color(0x8a6c46);
    const at = (cx: number, cz: number) => cells[Math.max(0, Math.min(n - 1, cz)) * n + Math.max(0, Math.min(n - 1, cx))] ?? 0;
    for (let i = 0; i < pos.count; i++) {
      const gx = ((pos.getX(i) + HALF) / WORLD_SIZE) * n - 0.5, gz = ((pos.getZ(i) + HALF) / WORLD_SIZE) * n - 0.5;
      const x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
      const h = at(x0, z0) * (1 - fx) * (1 - fz) + at(x0 + 1, z0) * fx * (1 - fz) + at(x0, z0 + 1) * (1 - fx) * fz + at(x0 + 1, z0 + 1) * fx * fz;
      const y = pos.getY(i);
      const wear = y < 0.4 ? 0 : Math.min(0.85, h / 12);            // no paths in the water
      let r = this.baseColors[i * 3], g = this.baseColors[i * 3 + 1], b = this.baseColors[i * 3 + 2];
      r += (path.r - r) * wear; g += (path.g - g) * wear; b += (path.b - b) * wear;
      if (scorch.length === cells.length) {                        // burnt ground, drawn over everything
        const sx = (j: number, k: number) => scorch[Math.max(0, Math.min(n - 1, k)) * n + Math.max(0, Math.min(n - 1, j))] ?? 0;
        const sv = sx(x0, z0) * (1 - fx) * (1 - fz) + sx(x0 + 1, z0) * fx * (1 - fz) + sx(x0, z0 + 1) * (1 - fx) * fz + sx(x0 + 1, z0 + 1) * fx * fz;
        const burn = y < 0.4 ? 0 : Math.min(0.92, sv / 1.2);
        r += (0.11 - r) * burn; g += (0.1 - g) * burn; b += (0.095 - b) * burn;
      }
      col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
  }

  setEntities(list: Entity[]) { list.forEach((e) => this.upsert(e)); }
  /** Make the world match `list` exactly: drop anything not in it (used after a reset), then add/update the rest. */
  syncEntities(list: Entity[]) {
    const keep = new Set(list.map((e) => e.id));
    for (const id of [...this.entityObjs.keys()]) if (!keep.has(id)) this.remove(id);
    this.setEntities(list);
  }
  upsert(e: Entity) {
    const existing = this.entityObjs.get(e.id);
    if (existing && e.kind === "animal") {                       // animals glide; don't rebuild the mesh
      this.entityData.set(e.id, e);
      existing.userData.tx = e.x; existing.userData.tz = e.z; existing.userData.heading = e.props.heading ?? 0; existing.userData.alt = e.props.alt ?? 0; existing.userData.swim = !!e.props.swim;
      if (e.props.leap && e.props.leap !== existing.userData.leap) { existing.userData.leap = e.props.leap; existing.userData.leapT = 0; }
      return;
    }
    this.remove(e.id);
    const o = buildEntity(e);
    o.position.set(e.x, e.props.deckY ?? heightAt(e.x, e.z, this.seed), e.z);
    o.userData.id = e.id;
    if (e.kind === "animal") { o.userData.tx = e.x; o.userData.tz = e.z; o.userData.heading = e.props.heading ?? 0; o.userData.alt = e.props.alt ?? 0; o.userData.swim = !!e.props.swim; }
    this.scene.add(o); this.entityObjs.set(e.id, o); if (this.season && e.kind === "tree") { const r = RULES[this.season], t = new THREE.Color(r.leaf); o.traverse((x) => { const m = (x as THREE.Mesh).material as THREE.Material | undefined; if (m?.userData.leaf !== undefined) this.leaf(m as THREE.MeshStandardMaterial, t, r.leafMix); }); } this.entityData.set(e.id, e);
  }
  remove(id: string) {
    const o = this.entityObjs.get(id);
    if (o) { this.scene.remove(o); o.traverse((c) => { if (c.userData.matKeys) disposeItem(c); }); this.entityObjs.delete(id); this.entityData.delete(id); }
  }

  private growTrail(a: AgentView) {
    const M = Scene3D.TRAIL_MAX;
    if (!this.trail) {
      const g = new THREE.BufferGeometry(), pos = new THREE.BufferAttribute(new Float32Array(M * 6), 3), col = new THREE.BufferAttribute(new Float32Array(M * 6), 3);
      g.setAttribute("position", pos); g.setAttribute("color", col); g.setDrawRange(0, 0);
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, fog: false, depthTest: false }));
      line.frustumCulled = false; line.visible = false; line.renderOrder = 5; this.scene.add(line); this.trail = { line, pos, col, n: 0, last: null };
    }
    const t = this.trail, l = t.last, d = l ? Math.hypot(a.x - l.x, a.z - l.z) : 0;
    if (l && d < 0.6) return;
    if (l && d < 30) {                                                // a jump (a new life, a long fall) is a gap, not a line
      if (t.n >= M) { t.pos.array.copyWithin(0, 6); t.col.array.copyWithin(0, 6); t.n = M - 1; }
      const day = Math.cos((a.worldTime - 0.5) * Math.PI * 2) * 0.5 + 0.5, c = [0.25 + 0.75 * day, 0.35 + 0.6 * day, 0.9 - 0.55 * day], i = t.n * 6;
      t.pos.array.set([l.x, heightAt(l.x, l.z, this.seed) + 0.25, l.z, a.x, heightAt(a.x, a.z, this.seed) + 0.25, a.z], i); t.col.array.set([...c, ...c], i);
      t.n++; t.pos.needsUpdate = t.col.needsUpdate = true; t.line.geometry.setDrawRange(0, t.n * 2);
    }
    t.last = { x: a.x, z: a.z };
  }
  showTrail(on: boolean) { if (!this.trail) this.growTrail(this.agent ?? ({ x: 0, z: 0, worldTime: 0.5 } as AgentView)); if (this.trail) this.trail.line.visible = on; }
  get trailShown() { return !!this.trail?.line.visible; }
  clearTrail() { if (this.trail) { this.trail.n = 0; this.trail.last = null; this.trail.line.geometry.setDrawRange(0, 0); } }

  /** Lean the land toward the season: the foliage, the ground and (in updateSky) the light. */
  private setSeason(id: SeasonId) {
    if (id === this.season) return;
    this.season = id; const r = RULES[id], target = new THREE.Color(r.leaf);
    this.terrainMat?.color.setRGB(...r.ground);
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m?.userData.leaf !== undefined) this.leaf(m as THREE.MeshStandardMaterial, target, r.leafMix); });
  }
  private leaf(m: THREE.MeshStandardMaterial, target: THREE.Color, mix: number) { m.color.set(m.userData.leaf).lerp(target, mix); }

  setAgent(a: AgentView) {
    this.growTrail(a);
    if (a.season) this.setSeason(a.season.id);
    this.dress(a.worn ?? []); this.mark(a.body?.marks ?? []);
    const first = !this.agent;
    this.agent = a;
    this.target.set(a.x, heightAt(a.x, a.z, this.seed), a.z);
    if (first) { this.agentGroup.position.copy(this.target); this.controls.target.copy(this.target); this.camera.position.copy(this.target).add(new THREE.Vector3(9, 8, 9)); }
    if (a.speech !== this.bubbleText) {
      this.bubbleText = a.speech ?? "";
      if (this.bubble) { this.agentGroup.remove(this.bubble); (this.bubble.material as THREE.SpriteMaterial).map?.dispose(); this.bubble = null; }
      if (a.speech) { this.bubble = label(a.speech, { bubble: true, size: 26 }); this.bubble.position.y = 3.2; this.agentGroup.add(this.bubble); }
    }
    this.zzz.visible = a.sleeping;
    this.weather = a.weather;
  }

  fx(kind: FxKind) {
    if (kind === "lightning") { this.flash = 1; return; }
    const p = this.agentGroup.position, a = Math.random() * Math.PI * 2;
    const from = new THREE.Vector3(p.x + Math.cos(a) * 120, 90 + rand(0, 40), p.z + Math.sin(a) * 120);
    const to = from.clone().add(new THREE.Vector3(rand(-60, 60), -35, rand(-60, 60)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, from.clone()]), new THREE.LineBasicMaterial({ color: 0xffffff, fog: false }));
    line.frustumCulled = false; this.scene.add(line); this.meteors.push({ line, t: 0, from, to });
  }

  private pick(ev: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([...this.entityObjs.values()], true);
    for (const h of hits) { let o: THREE.Object3D | null = h.object; while (o && !o.userData.id) o = o.parent; if (o) return this.onPick(this.entityData.get(o.userData.id) ?? null); }
    this.onPick(null);
  }

  private inset = 0;
  private focus: { x: number; z: number; t0: number; hold: number } | null = null;
  private userAt = 0;
  private baseDist = 0;

  // ---------- the cinematic camera (TV view) ----------
  /** A director that never stops: slow orbits, low hero angles, high wide shots, a long lens, cutting between them every so often. */
  cinema = false;
  private shot = { t0: 0, dur: 1, a0: 0, a1: 0, d0: 10, d1: 10, h0: 3, h1: 3, name: "" };
  private shots = 0;
  private cinemaFov = 55;
  setCinema(on: boolean) {
    if (on === this.cinema) return;
    this.cinema = on;
    if (on) { this.cinemaFov = this.camera.fov; this.nextShot(true); } else { this.camera.fov = this.cinemaFov; this.camera.updateProjectionMatrix(); }
  }
  private nextShot(first = false) {
    const n = this.shots++, a = this.agent, heading = a ? -a.heading + Math.PI / 2 : 0, now = performance.now() / 1000, sweep = (deg: number) => ((deg * Math.PI) / 180) * (Math.random() < 0.5 ? -1 : 1);
    const here = Math.atan2(this.camera.position.z - this.controls.target.z, this.camera.position.x - this.controls.target.x);
    const kinds = ["close orbit", "wide", "low hero", "behind", "high"] as const, kind = a?.sleeping || a?.body?.dead ? "wide" : first ? "close orbit" : kinds[(n * 3 + Math.floor(Math.random() * 2)) % kinds.length]!;
    const s = this.shot; s.t0 = now; s.name = kind; s.a0 = here;
    const set = (dur: number, a1: number, d0: number, d1: number, h0: number, h1: number) => Object.assign(s, { dur, a1, d0, d1, h0, h1 });
    if (kind === "close orbit") set(24, here + sweep(70), 7, 5.5, 2.4, 2.0);
    else if (kind === "wide") set(30, here + sweep(28), 30, 36, 14, 18);
    else if (kind === "low hero") set(20, here + sweep(45), 8, 6.5, 0.9, 1.4);
    else if (kind === "behind") set(22, heading + Math.PI + sweep(18), 8.5, 7, 3.2, 3.6);
    else set(26, here + sweep(35), 18, 24, 24, 30);
  }
  private cinemaStep(dt: number) {
    if (!this.cinema || Date.now() - this.userAt < 12_000) return;            // a hand on the mouse always wins
    const now = performance.now() / 1000, s = this.shot, p = Math.min(1, (now - s.t0) / s.dur), e = p * p * (3 - 2 * p);
    if (p >= 1) return this.nextShot();
    const ang = s.a0 + (s.a1 - s.a0) * p, d = s.d0 + (s.d1 - s.d0) * e, h = s.h0 + (s.h1 - s.h0) * e, T = this.controls.target;
    const want = new THREE.Vector3(T.x + Math.cos(ang) * d, T.y + h, T.z + Math.sin(ang) * d);
    this.camera.position.lerp(want, 1 - Math.pow(0.04, dt));                                  // eased, so a cut is a glide, never a jump
    const fov = s.name === "wide" || s.name === "high" ? 34 : 42;                               // a longer lens than the everyday view
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * (1 - Math.pow(0.1, dt)); this.camera.updateProjectionMatrix(); }
    this.baseDist = 0;
  }
  /** Wings beat, tails sway, the snake undulates or coils, the midges swarm. */
  private animateWild(o: THREE.Object3D, t: number, dt: number) {
    const sp = o.userData.wild as string, e = this.entityData.get(o.userData.id), pose = e?.props.pose, speed = Math.hypot((o.userData.tx - o.position.x), (o.userData.tz - o.position.z)) / Math.max(dt, 1e-3);
    const airborne = ((o.userData.alt as number) ?? 0) > 0.6;
    o.traverse((c) => {
      if (c.userData.flap !== undefined) c.rotation.x = (c.userData.flap as number) * (sp === "butterfly" ? Math.sin(t * 14) * 0.9 : airborne ? Math.sin(t * 10) * 0.8 : 0.05);
      if (c.userData.tail) c.rotation.y = Math.sin(t * 8 + o.position.x) * 0.5;
      if (c.userData.midge !== undefined) { const k = c.userData.midge as number; c.position.set(Math.sin(t * 3 + k) * 0.6, Math.sin(t * 2.3 + k * 1.3) * 0.4, Math.cos(t * 2.7 + k * 0.8) * 0.6); }
    });
    const segs = o.userData.segs as THREE.Mesh[] | undefined;
    if (segs) segs.forEach((s, i) => {
      if (pose === "coiled") { const a = i * 0.95, rr = 0.16 - i * 0.008; s.position.set(Math.cos(a) * rr, 0.07 + (i > 6 ? (i - 6) * 0.07 : i * 0.012), Math.sin(a) * rr); }
      else s.position.set(-i * 0.13, 0.07, Math.sin(t * (speed > 0.05 ? 7 : 1.5) - i * 0.8) * 0.07 * (1 + i * 0.1));
    });
    if (sp === "bear" || sp === "boar" || sp === "wolf") o.rotation.z = pose === "charging" ? Math.sin(t * 14) * 0.03 : 0;
  }

  /** Clothes River has made and put on, in the colours it chose. */
  private dress(worn: { slot: string; garment: string; hex: string; visual?: VisualPacket }[]) {
    const key = JSON.stringify(worn.map((g) => [g.garment, g.hex, g.visual?.look])); if (key === this.wornKey) return; this.wornKey = key;
    for (const c of [...this.garb.children]) { this.garb.remove(c); disposeItem(c); }
    for (const g of worn) { const o = buildWorn(g.garment, g.visual ?? null, g.hex); if (o) this.garb.add(o); }       // the same recipe the garment has in the pack
  }

  /** Bruises, scrapes and burns, drawn on the skin where they are. Limb marks ride along as the limb swings. */
  private mark(marks: { part: string; side: string; hex: string; alpha: number; kind: string; sev: number }[]) {
    const key = JSON.stringify(marks.map((m) => [m.part, m.side, m.hex, m.alpha])); if (key === this.markKey) return; this.markKey = key;
    for (const g of this.marksG) for (const c of [...g.children]) { g.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    // limbs: 0 right arm, 1 left arm, 2 right leg, 3 left leg (River faces +z, so its left is +x). y is down the limb from its joint.
    const spots: Record<string, [boolean, number]> = { elbow: [true, -0.3], forearm: [true, -0.45], palm: [true, -0.68], knee: [false, -0.28], shin: [false, -0.45], ankle: [false, -0.62], foot: [false, -0.68] };
    for (const m of marks) {
      const mk = (r: number) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshStandardMaterial({ color: parseInt(m.hex.slice(1), 16), transparent: true, opacity: 0.35 + 0.55 * m.alpha, roughness: 1, flatShading: false })); return o; };
      const r = 0.05 + m.sev * 0.07;
      const torso: Record<string, [number, number, number]> = { hip: [0.24, 0.85, 0.12], side: [0.27, 1.0, 0.04], shoulder: [0.26, 1.28, 0.06], chest: [0.12, 1.12, 0.25], back: [0.1, 1.05, -0.25] };
      if (torso[m.part]) { const t = torso[m.part], o = mk(r * 1.2), sx = m.side === "left" ? 1 : -1; o.scale.z = 0.4; o.position.set(t[0] * sx, t[1], t[2]); this.marksG[4].add(o); continue; }
      const s = spots[m.part]; if (!s) continue;
      const idx = (s[0] ? 0 : 2) + (m.side === "left" ? 1 : 0), o = mk(r); o.scale.z = 0.4; o.position.set(0, s[1], m.part === "palm" ? 0.09 : s[0] ? 0.08 : 0.1); this.marksG[idx].add(o);
    }
  }

  /** The camera director: glance toward something that mattered, hold, then return to River. */
  focusOn(x: number, z: number, hold = 6500, force = false) {
    if (!this.cutaways || !this.follow || (!force && Date.now() - this.userAt < 8000)) return;
    this.focus = { x, z, t0: performance.now(), hold };
  }
  /** Shift the view so the focus sits centred in the part of the screen not covered by the side panel. */
  setInset(px: number) { this.inset = px; this.resize(); }
  private resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.inset > 0) this.camera.setViewOffset(w, h, this.inset / 2, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(0.1, this.clock.getDelta()), t = this.clock.elapsedTime;
    const a = this.agent;
    if (a) {
      const prev = this.agentGroup.position.clone();
      this.agentGroup.position.lerp(this.target, 1 - Math.pow(0.001, dt));
      const moving = prev.distanceTo(this.agentGroup.position) / Math.max(dt, 1e-3) > 0.4;
      const targetRot = -a.heading + Math.PI / 2;
      let d = targetRot - this.agentGroup.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.agentGroup.rotation.y += d * Math.min(1, dt * 8);
      const tp = postureOf(a.feelings ?? {}, a.needs, a.body ?? { health: 100 }), P = this.posture, ease = Math.min(1, dt * 1.5);
      for (const k of ["tension", "gaze", "gait", "slump"] as const) P[k] += (tp[k] - P[k]) * ease;                  // feelings move the body slowly, not in jumps
      this.body.position.y = moving ? Math.abs(Math.sin(t * 10 * P.gait)) * 0.12 * P.gait : Math.sin(t * 2) * 0.02;
      const down = a.sleeping || !!a.body?.dead;
      this.body.rotation.z += ((a.body?.dead ? Math.PI / 2 : down ? Math.PI / 2.4 : 0) - this.body.rotation.z) * Math.min(1, dt * 4);
      this.body.position.y += down ? (a.body?.dead ? -0.45 : -0.1) : 0;
      const sh = a.body?.shaking ?? 0; if (sh > 0.05 && !down) { this.body.position.x = Math.sin(t * 55) * 0.012 * sh * 3; this.body.rotation.y = Math.sin(t * 47) * 0.02 * sh * 3; } else { this.body.position.x = 0; this.body.rotation.y = 0; }
      if (a.body?.limp && moving && !down) this.body.rotation.z = Math.sin(t * 5) * 0.07;
      const sw = moving ? Math.sin(t * 10 * P.gait) * 0.6 * (0.6 + 0.4 * P.gait) : 0; this.limbs.forEach((l, i) => { l.rotation.x += ((i % 2 ? sw : -sw) * (i < 2 ? 1 : -1) - l.rotation.x) * Math.min(1, dt * 12); });
      this.limbs.forEach((l, i) => { if (i < 2) l.rotation.z += ((i ? 1 : -1) * P.tension * 0.2 - l.rotation.z) * Math.min(1, dt * 6); });     // braced shoulders lift the arms a little
      this.body.rotation.x += ((down ? 0 : P.slump * 0.28) - this.body.rotation.x) * Math.min(1, dt * 4);
      this.head.rotation.x += ((down ? 0 : P.slump * 0.35 - P.gaze * 0.3) - this.head.rotation.x) * Math.min(1, dt * 4);
      this.zzz.position.y = 2.2 + Math.sin(t * 2) * 0.15;
      if (this.follow) {
        const desired = this.agentGroup.position.clone(); let k = 0;
        if (this.focus) {
          const t = performance.now() - this.focus.t0, hold = this.focus.hold, ease = (x: number) => x * x * (3 - 2 * x);
          if (t > 1200 + hold + 1500) this.focus = null;
          else {
            k = t < 1200 ? ease(t / 1200) : t < 1200 + hold ? 1 : 1 - ease((t - 1200 - hold) / 1500);
            const f = this.focus; desired.lerp(new THREE.Vector3(f.x, heightAt(f.x, f.z, this.seed), f.z), 0.5 * k);
          }
        }
        const delta = desired.sub(this.controls.target).multiplyScalar(1 - Math.pow(0.0005, dt));   // eased, so cuts feel like a glide
        this.controls.target.add(delta); this.camera.position.add(delta);
        // pull back a little to take in both River and the event, then settle to wherever the viewer had the camera
        const off = this.camera.position.clone().sub(this.controls.target), len = off.length();
        if (!this.focus && k === 0) this.baseDist = len; else if (this.baseDist) this.camera.position.copy(this.controls.target).add(off.setLength(len + (this.baseDist * (1 + 0.45 * k) - len) * (1 - Math.pow(0.002, dt))));
      }
      this.updateSky(a.worldTime);
    }
    for (const [id, o] of this.entityObjs) if (this.entityData.get(id)?.kind === "item") setLod(o.children[0]!, this.camera.position.distanceTo(o.position));
    for (const o of this.entityObjs.values()) {
      if (!o.userData.burning) continue;
      o.traverse((c) => {
        const fc = c.userData.flameCone;
        if (fc) { const k = fc.base * (0.75 + 0.35 * Math.sin(t * 11 + fc.phase) + 0.15 * Math.sin(t * 23 + fc.phase * 2)); c.scale.set(1, k, 1); c.rotation.y = t * 2 + fc.phase; }
        if (c.userData.glow) (c as THREE.Sprite).scale.setScalar(c.userData.glow * (0.92 + 0.1 * Math.sin(t * 9)));
        const sm = c.userData.smoke;
        if (sm) { const k = (t * 0.22 + sm.phase) % 1; c.position.set(Math.sin(k * 6 + sm.phase * 9) * sm.w * 0.5 + k * 0.8, sm.h * 0.7 + k * 5, Math.cos(k * 5 + sm.phase * 7) * sm.w * 0.4); const s = (sm.w * 1.4 + k * 3.2); c.scale.set(s, s, 1); (c as THREE.Sprite).material.opacity = 0.34 * Math.sin(Math.PI * Math.min(1, k * 1.15)); }
      });
    }
    for (const o of this.entityObjs.values()) {
      if (!o.userData.animal) continue;
      const tx: number = o.userData.tx, tz: number = o.userData.tz, k = 1 - Math.pow(0.02, dt);
      o.position.x += (tx - o.position.x) * k; o.position.z += (tz - o.position.z) * k;
      const ground = Math.max(0, heightAt(o.position.x, o.position.z, this.seed)), alt = (o.userData.alt as number) ?? 0;
      o.userData.y = (o.userData.y ?? ground) + (((o.userData.swim ? -0.3 : ground + alt) as number) - (o.userData.y ?? ground)) * Math.min(1, dt * 3);
      o.position.y = o.userData.swim ? o.userData.y : Math.max(o.userData.y, heightAt(o.position.x, o.position.z, this.seed));
      if (o.userData.leapT !== undefined) { o.userData.leapT += dt; const u = o.userData.leapT / 0.8; if (u < 1) o.position.y += Math.sin(u * Math.PI) * 0.9; else o.userData.leapT = undefined; }
      if (o.userData.wild) this.animateWild(o, t, dt);
      const want = -(o.userData.heading as number);
      let dr = want - o.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); o.rotation.y += dr * Math.min(1, dt * 6);
      o.traverse((c) => { if (c.userData.firefly !== undefined) { c.position.y = 1.1 + Math.sin(t * 1.5 + c.userData.firefly) * 0.35; (c as THREE.Mesh).visible = Math.sin(t * 3 + c.userData.firefly) > -0.4; } });
    }
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 2) {
        const dy = (this.weather === "storm" ? 42 : 30) * dt;
        let y = pos.getY(i) - dy; const ny = y < 0 ? y + 30 : y;
        pos.setY(i, ny); pos.setY(i + 1, ny - 1.1);
      }
      pos.needsUpdate = true;
      this.rain.position.set(this.controls.target.x, this.controls.target.y - 3, this.controls.target.z);
    }
    for (const m of this.meteors) {
      m.t += dt / 1.1; const head = m.from.clone().lerp(m.to, Math.min(1, m.t)), tail = m.from.clone().lerp(m.to, Math.max(0, m.t - 0.25));
      m.line.geometry.setFromPoints([tail, head]);
      if (m.t > 1.3) { this.scene.remove(m.line); m.line.geometry.dispose(); }
    }
    this.meteors = this.meteors.filter((m) => m.t <= 1.3);
    this.scene.traverse((o) => {
      if (o instanceof THREE.PointLight) {
        if (o.userData.flicker) o.intensity = 2.3 + Math.sin(t * 17) * 0.3 + Math.sin(t * 9.3) * 0.25;
        if (o.userData.pulse) o.intensity = 1.2 + Math.sin(t * 1.3) * 0.6;
      }
      if (o.userData.flame) o.scale.y = 0.9 + Math.sin(t * 14) * 0.15;
    });
    this.cinemaStep(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSky(wt: number) {
    const ang = (wt - 0.25) * Math.PI * 2;              // sunrise at 06:00
    const sunH = Math.sin(ang);                          // -1..1
    const day = THREE.MathUtils.smoothstep(sunH, -0.12, 0.25);
    const dusk = 1 - Math.abs(THREE.MathUtils.clamp(sunH * 4, -1, 1));
    const sky = new THREE.Color(0x0a1022).lerp(new THREE.Color(0x8cc3f0), day).lerp(new THREE.Color(0xff9a5a), dusk * 0.45 * (day > 0.02 ? 1 : 0.5));
    const target = { clear: [0, 60, 190, 1, 0], cloudy: [0.45, 50, 170, 0.75, 0], rain: [0.6, 35, 130, 0.6, 1], fog: [0.7, 4, 55, 0.7, 0], windy: [0.2, 55, 180, 0.9, 0], storm: [0.8, 25, 100, 0.4, 1] }[this.weather];
    const wk = this.wk, ease = 0.02;
    wk.grey += (target[0] - wk.grey) * ease; wk.fogNear += (target[1] - wk.fogNear) * ease; wk.fogFar += (target[2] - wk.fogFar) * ease; wk.dark += (target[3] - wk.dark) * ease; wk.rain += (target[4] - wk.rain) * ease;
    const grey = new THREE.Color(0x8a919b).multiplyScalar(0.25 + 0.75 * day);
    if (this.season) sky.lerp(new THREE.Color(RULES[this.season].sky), 0.14 * day);                // the year in the light
    sky.lerp(grey, wk.grey);
    this.flash = Math.max(0, this.flash - 0.06);
    if (this.flash > 0) sky.lerp(new THREE.Color(0xe8f0ff), this.flash * 0.8);
    this.scene.background = sky;
    const fog = this.scene.fog as THREE.Fog; fog.color.copy(sky); fog.near = wk.fogNear; fog.far = wk.fogFar;
    this.rain.visible = wk.rain > 0.3;
    const sunk = THREE.MathUtils.clamp(-sunH, 0, 1);
    this.moon.position.set(this.agentGroup.position.x - Math.cos(ang) * 250, 60 + sunk * 160, this.agentGroup.position.z - 60);
    this.moon.visible = sunH < 0.05; (this.moon.material as THREE.MeshBasicMaterial).opacity = 1;
    const p = this.agentGroup.position;
    this.sun.position.set(p.x + Math.cos(ang) * 60, Math.max(sunH, 0.05) * 70 + 5, p.z + 20);
    this.sun.target.position.copy(p);
    this.sun.intensity = (2.2 * day + 0.05) * this.wk.dark + this.flash * 2;
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0xffb27a), dusk * 0.6);
    this.hemi.intensity = (0.25 + 0.6 * day) * (0.6 + 0.4 * this.wk.dark) + this.flash * 0.8;
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - THREE.MathUtils.smoothstep(day, 0.0, 0.5)) * (1 - this.wk.grey);
  }
}
