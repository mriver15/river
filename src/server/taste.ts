// River's taste. It can have opinions about anything (a colour, a material, the feel of a place, a sound), and those persist and are
// shown back to it. What it makes is recorded, and the habits that show in its work are reflected back as "your hand", so a personal
// style can be noticed, kept, or fought against. Whether a creation matches what River says it likes colours how it feels about it.
import { bus, log } from "./bus.ts";
import { db } from "./db.ts";
import { palette } from "./colour.ts";
import { ToolError, obj, str, type ToolDef } from "./toolkit.ts";
import type { Opinion, TasteView, Work } from "../shared/types.ts";

const SCORE = { love: 2, like: 1, dislike: -1, hate: -2 } as const;
const rowOp = (r: any): Opinion => ({ id: r.id, subject: r.subject, stance: r.stance, why: r.why, ts: r.ts, strength: r.strength });
export const opinions = (): Opinion[] => (db.prepare("SELECT * FROM opinions ORDER BY ts DESC").all() as any[]).map(rowOp);

export function setOpinion(subject: string, stance: Opinion["stance"], why: string): { op: Opinion; changed: boolean } {
  const s = subject.trim().replace(/\s+/g, " ").slice(0, 80); if (s.length < 2) throw new ToolError("Say what the opinion is about.");
  const prev = db.prepare("SELECT * FROM opinions WHERE subject = ?").get(s) as any;
  if (prev) {                        // holding an opinion again deepens it; reversing it is a change of heart
    const same = prev.stance === stance, strength = same ? prev.strength + 1 : 1;
    db.prepare("UPDATE opinions SET stance=?, why=?, ts=?, strength=? WHERE id=?").run(stance, why || prev.why, Date.now(), strength, prev.id);
    bus.emit("state"); return { op: rowOp(db.prepare("SELECT * FROM opinions WHERE id=?").get(prev.id)), changed: !same };
  }
  const r = db.prepare("INSERT INTO opinions(subject, stance, why, ts) VALUES(?,?,?,?)").run(s, stance, why.slice(0, 240), Date.now());
  log("desire", `Opinion: ${stance} ${s}${why ? ` — ${why}` : ""}`); bus.emit("state");
  return { op: rowOp(db.prepare("SELECT * FROM opinions WHERE id=?").get(r.lastInsertRowid)), changed: false };
}

/** How well does something match River's tastes? Positive: it matches what it likes. Negative: it clashes with what it dislikes. */
export function align(tags: string[]): { score: number; liked: string[]; disliked: string[] } {
  const hay = tags.map((t) => t.toLowerCase()), liked: string[] = [], disliked: string[] = []; let score = 0;
  for (const o of opinions()) {
    const subj = o.subject.toLowerCase(), words = subj.split(/\s+/).filter((w) => w.length > 2);
    const hit = hay.some((t) => t.includes(subj) || subj.includes(t) || words.some((w) => t.includes(w)));
    if (!hit) continue;
    const v = SCORE[o.stance] * (1 + Math.min(1, Math.log2(o.strength + 1) / 3));          // an opinion held repeatedly counts for more
    score += v; (v > 0 ? liked : disliked).push(o.subject);
  }
  return { score: Math.max(-3, Math.min(3, score)), liked, disliked };
}

// ---------- what River has made ----------
export function addWork(w: Omit<Work, "id" | "ts">, entity: string) {
  db.prepare("INSERT INTO works(ts,name,shape,size,materials,colors,color_names,x,z,entity) VALUES(?,?,?,?,?,?,?,?,?,?)").run(Date.now(), w.name, w.shape, w.size, JSON.stringify(w.materials), JSON.stringify(w.colors), JSON.stringify(w.colorNames), w.x, w.z, entity);
  bus.emit("state");
}
export const works = (n = 12): Work[] => (db.prepare("SELECT * FROM works ORDER BY id DESC LIMIT ?").all(n) as any[]).map((r) => ({ id: r.id, ts: r.ts, name: r.name, shape: r.shape, size: r.size, materials: JSON.parse(r.materials), colors: JSON.parse(r.colors), colorNames: JSON.parse(r.color_names), x: r.x, z: r.z }));

const tally = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
/** The habits in River's work, said back to it. Needs a few pieces before it says anything: one piece is not a style. */
export function styleSummary(): string {
  const all = works(40); if (all.length < 3) return "";
  const colours = tally(all.flatMap((x) => Object.values(x.colorNames).filter(Boolean))).slice(0, 3), mats = tally(all.flatMap((x) => Object.keys(x.materials))).slice(0, 2), shapes = tally(all.map((x) => x.shape)).slice(0, 2);
  const bits: string[] = [];
  if (colours.length) bits.push(`you reach for ${colours.map(([c]) => c).join(", ")}`);
  if (mats.length) bits.push(`you build mostly in ${mats.map(([m]) => m).join(" and ")}`);
  if (shapes.length) bits.push(`${shapes.map(([s, n]) => `${s}s (${n})`).join(" and ")} are what you make most`);
  const sizes = tally(all.map((x) => x.size))[0]; if (sizes && sizes[1] >= all.length * 0.6) bits.push(`mostly ${sizes[0]} things`);
  return `Looking at what you have made (${all.length} pieces): ${bits.join("; ")}.`;
}

/** What River is shown each cycle. */
export function tasteContext(): string {
  const ops = opinions().sort((a, b) => Math.abs(SCORE[b.stance]) * (1 + b.strength) - Math.abs(SCORE[a.stance]) * (1 + a.strength)).slice(0, 7);
  const lines: string[] = [];
  if (ops.length) lines.push(...ops.map((o) => `- you ${o.stance} ${o.subject}${o.why ? `: ${o.why}` : ""}`));
  const pal = palette(); if (pal.length) lines.push(`- colours you have named: ${pal.slice(-6).map((p) => `${p.name} (${p.hex})`).join(", ")}`);
  const style = styleSummary(); if (style) lines.push(`- ${style}`);
  const recent = works(3); if (recent.length) lines.push(`- most recently made: ${recent.map((r) => r.name).join(", ")}`);
  return lines.join("\n");
}
export const tasteView = (): TasteView => ({ opinions: opinions().slice(0, 40), palette: palette(), works: works(14), style: styleSummary() });

export const OPINION_TOOL: ToolDef = {
  name: "opinion",
  description: "State what you think of something: a colour, a material, a shape, a place, a sound, the way a thing was made. Say `love`, `like`, `dislike` or `hate`, and why if you know. Your opinions are yours: they are kept and shown back to you, and you may change your mind.",
  input_schema: obj({ subject: str("What it is about, in a few words"), stance: { type: "string", enum: ["love", "like", "dislike", "hate"] }, why: str("Optional: why you feel that way") }, ["subject", "stance"]),
  run: (a) => {
    const { op, changed } = setOpinion(String(a.subject), a.stance, String(a.why ?? ""));
    return changed ? `You change your mind about ${op.subject}: now you ${op.stance} it.` : op.strength > 1 ? `You feel it again: you ${op.stance} ${op.subject}. This is becoming a settled part of you.` : `Noted. You ${op.stance} ${op.subject}.`;
  },
};
