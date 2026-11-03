import { $, el } from "../dom.ts";
import { HALF, WORLD_SIZE, WATER_LEVEL, heightAt } from "../../shared/noise.ts";
import { S, ctx } from "../state.ts";

const LANDMARKS: Record<string, string> = { library: "📚", shrine: "⛩", monolith: "◆", campfire: "🔥", structure: "⌂" };
let base: HTMLCanvasElement | null = null;
let baseSize = 0;
export let lastMap = 0;

export function drawMap() {
  const cv = $("mapc") as HTMLCanvasElement, wrap = $("mapwrap");
  const size = Math.min(900, Math.max(260, Math.round(wrap.clientWidth * Math.min(2, devicePixelRatio || 1))));
  if (cv.width !== size) { cv.width = size; cv.height = size; }
  const c = cv.getContext("2d")!, W = size, H = size; lastMap = Date.now();
  const px = (x: number) => ((x + HALF) / WORLD_SIZE) * W, pz = (z: number) => ((z + HALF) / WORLD_SIZE) * H, k = W / 340;
  if (!base || baseSize !== size) {                                    // terrain, drawn once per size
    baseSize = size; base = document.createElement("canvas"); base.width = W; base.height = H;
    const g = base.getContext("2d")!, img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = heightAt((x / W) * WORLD_SIZE - HALF, (y / H) * WORLD_SIZE - HALF, ctx.seed), i = (y * W + x) * 4;
      const [r, gg, b] = h < WATER_LEVEL ? [24, 62, 96] : h < 0.5 ? [196, 182, 128] : h < 3.6 ? [86, 138, 74] : h < 5.8 ? [70, 112, 62] : [140, 140, 128];
      const sh = h > 0 ? Math.min(30, h * 4) : 0; img.data.set([r + sh, gg + sh, b + sh, 255], i);
    }
    g.putImageData(img, 0, 0);
  }
  c.drawImage(base, 0, 0);
  const n = Math.round(Math.sqrt(S.heat.length)) || 1, cw = W / n;
  for (let i = 0; i < S.heat.length; i++) if (S.heat[i] > 0.8) { c.fillStyle = `rgba(150,104,56,${Math.min(0.8, S.heat[i] / 14)})`; c.fillRect((i % n) * cw, Math.floor(i / n) * cw, cw + 0.5, cw + 0.5); }
  for (let i = 0; i < S.scorch.length; i++) if (S.scorch[i] > 0.15) { c.fillStyle = `rgba(14,12,10,${Math.min(0.85, S.scorch[i] / 1.4)})`; c.fillRect((i % n) * cw, Math.floor(i / n) * cw, cw + 0.5, cw + 0.5); }
  c.textAlign = "center"; c.font = `${13 * k}px system-ui`;
  for (const e of ctx.scene?.entityData.values() ?? []) { if (e.props.burning) { c.fillText("🔥", px(e.x), pz(e.z) + 4 * k); continue; } if (LANDMARKS[e.kind]) c.fillText(LANDMARKS[e.kind], px(e.x), pz(e.z) + 4 * k); }
  c.font = `${12 * k}px system-ui`; c.fillStyle = "#f5e6b8";
  for (const e of ctx.scene?.entityData.values() ?? []) if (e.props.catalog && !LANDMARKS[e.kind] && e.kind !== "book" && e.kind !== "rock") c.fillText("◇", px(e.x), pz(e.z) + 4 * k);
  c.font = `600 ${11 * k}px system-ui`; c.lineWidth = 3 * k; c.strokeStyle = "rgba(10,14,20,.85)"; c.fillStyle = "#ffe9a8";
  for (const p of S.places) { c.beginPath(); c.arc(px(p.x), pz(p.z), 3 * k, 0, 7); c.fill(); c.strokeText(p.name, px(p.x), pz(p.z) - 7 * k); c.fillText(p.name, px(p.x), pz(p.z) - 7 * k); }
  if (S.agent) { c.fillStyle = "#ff6b5e"; c.strokeStyle = "#fff"; c.lineWidth = 2 * k; c.beginPath(); c.arc(px(S.agent.x), pz(S.agent.z), 5 * k, 0, 7); c.fill(); c.stroke(); }
  const lg = $("maplegend"); lg.replaceChildren();
  for (const t of [`${S.places.length} named place${S.places.length === 1 ? "" : "s"}`, "brown: worn paths", "black: burnt", "📚 library  ⛩ shrine  ◆ monolith", "🔥 fire", `● ${S.agent?.name ?? "River"}`]) lg.append(el("span", "", t));
}
