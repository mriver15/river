// A small picture of an item, drawn from the same recipe as the one in the world. One shared renderer makes all of them.
import * as THREE from "three";
import { buildItem, disposeItem } from "./items.ts";
import type { VisualPacket } from "../../content/visuals.ts";

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene, camera: THREE.OrthographicCamera;
const cache = new Map<string, string>();
const KEEP = 200;

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.shadowMap.enabled = false;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a4a40, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
}

/** Draw any object to a data URL, framed to fill the picture whatever its size. The object is added to the scene only for the draw. */
export function renderObject(obj: THREE.Object3D, px: number, yaw = -0.6): string {
  setup(); const r = renderer!;
  r.setSize(px, px, false);
  const holder = new THREE.Group(); holder.add(obj); holder.rotation.y = yaw; holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), reach = Math.max(size.x, size.y, size.z) * 0.9 + 1e-4;
  scene.add(holder);
  camera.left = -reach; camera.right = reach; camera.top = reach; camera.bottom = -reach; camera.updateProjectionMatrix();
  camera.position.set(c.x + reach * 2.2, c.y + reach * 1.6, c.z + reach * 2.2); camera.lookAt(c);
  r.render(scene, camera);
  const url = r.domElement.toDataURL("image/png");
  scene.remove(holder); holder.remove(obj);
  return url;
}

/** A data URL of the item. Pictures are kept, so a pack that redraws does not re-render. */
export function previewOf(p: VisualPacket, px = 96): string {
  const key = `${px}|${JSON.stringify(p)}`, hit = cache.get(key); if (hit) return hit;
  const item = buildItem(p), url = renderObject(item, px);
  disposeItem(item);
  if (cache.size >= KEEP) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}
