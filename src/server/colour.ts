// Colour is something River works out, not something it is told. It grinds pigments from things it finds, mixes them, and names them
// in its own words; the names are its vocabulary, and the hex values underneath are what the world actually shows.
import { bus } from "./bus.ts";
import { db } from "./db.ts";
import { ToolError, num, obj, str, type ToolDef } from "./toolkit.ts";
import type { World } from "./world.ts";
import { simNow, simSleep } from "./sim.ts";
import { gate } from "./activities.ts";

export const hexToRgb = (h: string): [number, number, number] => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
/** A colour in plain words, the way someone with no names for colours might say it. */
export function describeColour(hex: string): string {
  const [h, s, l] = hsl(hex);
  if (s < 0.1) return l < 0.15 ? "black" : l < 0.4 ? "dark grey" : l < 0.7 ? "grey" : l < 0.9 ? "pale grey" : "white";
  const hue = h < 15 || h >= 350 ? "red" : h < 40 ? "orange" : h < 65 ? "yellow" : h < 90 ? "yellow-green" : h < 160 ? "green" : h < 195 ? "teal" : h < 255 ? "blue" : h < 300 ? "violet" : h < 335 ? (l < 0.45 ? "plum" : "pink") : l < 0.45 ? "wine red" : "pink";
  const brownish = h >= 10 && h < 50 && l < 0.5 && s < 0.7;
  const name = brownish ? (l < 0.3 ? "dark brown" : "brown") : hue;
  const light = l < 0.18 ? "very dark " : l < 0.32 ? "dark " : l > 0.82 ? "very pale " : l > 0.66 ? "pale " : "", sat = s < 0.3 ? "dull " : s > 0.75 && l > 0.3 && l < 0.7 ? "vivid " : "";
  return `${sat}${light}${name}`.trim();
}

/** What each thing gives when ground. Flowers keep their own colour. */
const SOURCES: { test: (n: string, k: string) => boolean; hex: string }[] = [
  { test: (n) => /blue starflower/.test(n), hex: "#4a6fd8" }, { test: (n) => /yellow buttercup/.test(n), hex: "#e8c53a" },
  { test: (n) => /pale violet/.test(n), hex: "#a68ad8" }, { test: (n) => /red poppy/.test(n), hex: "#d6382b" },
  { test: (n) => /windflower/.test(n), hex: "#cfe0f0" }, { test: (n) => /fireweed/.test(n), hex: "#c0508a" },
  { test: (n, k) => k === "mushroom" && /glow/.test(n), hex: "#3fd8b8" }, { test: (_, k) => k === "mushroom", hex: "#7a5a3a" },
  { test: (_, k) => k === "berry", hex: "#8b2a4a" }, { test: (_, k) => k === "clay", hex: "#b5714a" }, { test: (_, k) => k === "chalk", hex: "#ece8de" },
  { test: (_, k) => k === "charcoal", hex: "#1c1a18" }, { test: (_, k) => k === "moss", hex: "#5a8a46" }, { test: (_, k) => k === "shell", hex: "#e8c4c0" },
  { test: (_, k) => k === "flower", hex: "#b88ad0" },
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
/** Nature isn't uniform: each batch comes out a shade differently, which is what makes finding a colour you like feel like finding it. */
const jitter = (hex: string, seed: string) => { const rgb = hexToRgb(hex), h = hash(seed + Math.floor(simNow() / 3_600_000)); return rgbToHex(rgb[0] * (1 + (((h >> 3) % 17) - 8) / 100), rgb[1] * (1 + (((h >> 7) % 17) - 8) / 100), rgb[2] * (1 + (((h >> 11) % 17) - 8) / 100)); };

export const palette = (): { name: string; hex: string }[] => db.prepare("SELECT name, hex FROM palette ORDER BY ts").all() as any;
export const pigmentHex = (it: { props?: Record<string, any> } | undefined) => (it?.props?.hex as string | undefined);

const pigments = (w: World) => [...w.inventory.values()].filter((i) => i.kind === "pigment");
const findPigment = (w: World, ref: string) => { const it = w.findItem(ref); return it?.kind === "pigment" ? it : undefined; };
const sourceOf = (w: World, ref: string) => { const it = w.findItem(ref); return it ? { it, src: SOURCES.find((s) => s.test(it.name.toLowerCase(), it.kind)) } : null; };

export const COLOUR_TOOL: ToolDef = {
  name: "colour",
  description:
    "Work with colour. `grind`: crush something you are carrying (a berry, a flower, clay, chalk, charcoal, moss, a mushroom, a shell) into a pigment, a few portions of whatever colour it gives. " +
    "`mix`: blend two pigments you hold, in whatever proportion you like, to make a new one. `name`: give a pigment a name of your own; names you give are how you will talk about colours. " +
    "Pigments can be used to colour things you make.",
  input_schema: obj({
    action: { type: "string", enum: ["grind", "mix", "name"], description: "Make a pigment, blend two, or name one." },
    item: str("grind: the thing to crush (name or id from your inventory)"),
    a: str("mix: first pigment"), b: str("mix: second pigment"),
    amount_of_a: num("mix: how much of the mixture is the first pigment, 0 to 1 (default 0.5)"),
    pigment: str("name: the pigment to name"), name: str("name: your name for it, e.g. 'dusk' or 'the red of the shore'"),
  }, ["action"]),
  run: async (a, w: World) => {
    const act = String(a.action);
    if (act === "grind") {
      const s = sourceOf(w, String(a.item ?? "")); if (!s) throw new ToolError("You aren't carrying that.");
      if (!s.src) throw new ToolError(`Crushing the ${s.it.name} gives nothing that would stain.`);
      gate(w, 2500, "grinding a pigment");
      const from = [s.it.id]; w.takeItem(s.it.id, 1);
      const hex = jitter(s.src.hex, s.it.name), words = describeColour(hex);
      w.addItem("pigment", `${words} pigment (${hex.slice(1)})`, `A little pile of ground colour: ${words} (${hex}). It stains whatever it touches.`, 3, { hex }, { sources: from, maker: true });
      w.bump({ curiosity: -4 });
      return `You crush the ${s.it.name} on a flat stone until it is a smear. The stain is ${words} (${hex}). You have 3 portions.`;
    }
    if (act === "mix") {
      const A = findPigment(w, String(a.a ?? "")), B = findPigment(w, String(a.b ?? ""));
      if (!A || !B) throw new ToolError("You need two pigments you are holding. Grind something first.");
      if (A.id === B.id) throw new ToolError("That is one pigment; mixing it with itself changes nothing.");
      const t = Math.max(0.05, Math.min(0.95, Number(a.amount_of_a ?? 0.5))), ca = hexToRgb(A.props!.hex), cb = hexToRgb(B.props!.hex);
      const [ha] = hsl(A.props!.hex), [hb] = hsl(B.props!.hex), clash = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb)) > 70 ? 0.9 : 1;     // opposites make mud: pigments, not light
      const mix = ca.map((v, i) => (v * t + cb[i] * (1 - t)) * clash), hex = rgbToHex(mix[0], mix[1], mix[2]), words = describeColour(hex);
      gate(w, 2000, "mixing colours");
      const from = [A.id, B.id]; w.takeItem(A.id, 1); w.takeItem(B.id, 1);
      w.addItem("pigment", `${words} pigment (${hex.slice(1)})`, `A mixed colour: ${words} (${hex}).`, 2, { hex }, { sources: from, maker: true });
      w.bump({ curiosity: -5 });
      bus.emit("discovered-colour", { hex });
      return `You work the ${A.name} and the ${B.name} together. It comes out ${words} (${hex}). You have 2 portions of it.`;
    }
    if (act === "name") {
      const p = findPigment(w, String(a.pigment ?? "")); if (!p) throw new ToolError("You aren't holding a pigment like that.");
      const name = String(a.name ?? "").trim().replace(/[^\p{L}\p{N}' -]/gu, "").slice(0, 30);
      if (name.length < 2) throw new ToolError("Give it a name of at least two letters.");
      const hex = p.props!.hex as string; db.prepare("INSERT INTO palette(name, hex, ts) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET hex = excluded.hex").run(name, hex, simNow());
      w.renameItem(p.id, name); bus.emit("state");
      return `From now on this colour is "${name}" to you (${describeColour(hex)}, ${hex}).`;
    }
    throw new ToolError(`Unknown action "${a.action}". Use grind, mix or name.`);
  },
};
export { pigments };
