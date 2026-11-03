import { db, kvGet, kvSet } from "./db.ts";
import { log } from "./bus.ts";
import { EMBED_ENABLED, EMBED_VERSION, dot, embed, fromBlob, relevance, toBlob } from "./embed.ts";
import type { MemoryRow } from "../shared/types.ts";

export type MemoryKind = "episodic" | "semantic" | "reflection" | "human" | "dream";

/** Registered by the server so every memory can record where it happened. */
let locate: () => { x: number; z: number } | null = () => null;
export const setLocator = (f: typeof locate) => { locate = f; };

const HALF_LIFE_H = 36;

export function addMemory(text: string, importance: number, tags: string[] = [], kind: MemoryKind = "episodic"): number {
  const imp = Math.max(1, Math.min(10, importance));
  const at = kind === "dream" ? null : locate();   // dreams happen nowhere
  const r = db.prepare("INSERT INTO memories(ts, kind, text, importance, tags, x, z) VALUES(?,?,?,?,?,?,?)")
    .run(Date.now(), kind, text, imp, tags.join(" ").toLowerCase(), at?.x ?? null, at?.z ?? null);
  log("memory", `[${kind} · ${imp}/10] ${text}`, { tags });
  scheduleEmbedding();
  return Number(r.lastInsertRowid);
}

// ---------- embeddings: computed in the background, never block the agent ----------
let embedTimer: NodeJS.Timeout | null = null;
let embedding = false;
export function scheduleEmbedding(delay = 800) { embedTimer ??= setTimeout(() => { embedTimer = null; void embedPending(); }, delay); }

export async function embedPending() {
  if (!EMBED_ENABLED || embedding) return;
  embedding = true;
  try {
    if (kvGet("embedModel", "") !== EMBED_VERSION) { db.exec("UPDATE memories SET embedding = NULL"); kvSet("embedModel", EMBED_VERSION); } // model changed: re-embed everything
    for (;;) {
      const rows = db.prepare("SELECT id, text, tags FROM memories WHERE embedding IS NULL ORDER BY id DESC LIMIT 32").all() as any[];
      if (!rows.length) break;
      const vecs = await embed(rows.map((r) => `${r.text} ${r.tags}`));
      if (!vecs) break;
      const upd = db.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
      rows.forEach((r, i) => upd.run(toBlob(vecs[i]), r.id));
    }
  } finally { embedding = false; }
}
export const embeddingCoverage = () => {
  const r = db.prepare("SELECT COUNT(*) AS n, SUM(embedding IS NOT NULL) AS e FROM memories").get() as any;
  return { total: r.n as number, embedded: (r.e ?? 0) as number };
};

const STOP = new Set("the and for that this with was were are but not you your from have has had they them then than into out about what when where which who how why can could would should will just some very been being its our his her she him their there here over under more most also one all any each".split(" "));
const tokens = (q: string) => (q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOP.has(t)).slice(0, 12);
const qCache = new Map<string, Float32Array>();
export const clearMemoryCaches = () => qCache.clear();
async function queryVec(q: string): Promise<Float32Array | null> {
  const key = q.slice(0, 600);
  const hit = qCache.get(key); if (hit) return hit;
  const v = (await embed([key], "query"))?.[0] ?? null;
  if (v) { qCache.set(key, v); if (qCache.size > 50) qCache.delete(qCache.keys().next().value!); }
  return v;
}

/**
 * Retrieval = relevance (meaning via local embeddings + keywords via FTS) + importance + recency,
 * in the spirit of generative-agents memory. Without embeddings it degrades to keywords.
 */
export async function recall(query: string, limit = 6, near?: { x: number; z: number }): Promise<MemoryRow[]> {
  const terms = tokens(query);
  const now = Date.now();
  type Cand = MemoryRow & { kw: number; sem: number; x?: number | null; z?: number | null };
  const cand = new Map<number, Cand>();
  const add = (r: any) => { let c = cand.get(r.id); if (!c) { c = { id: r.id, ts: r.ts, kind: r.kind, text: r.text, importance: r.importance, tags: r.tags, x: r.x, z: r.z, kw: 0, sem: 0 }; cand.set(r.id, c); } return c; };

  if (terms.length) {
    const match = terms.map((t) => `"${t}"*`).join(" OR ");
    try {
      const rows = db.prepare(
        `SELECT m.id, m.ts, m.kind, m.text, m.importance, m.tags, m.x, m.z FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT 40`).all(match) as any[];
      rows.forEach((r, i) => { add(r).kw = 1 - i / rows.length; });
    } catch { /* malformed query: ignore */ }
  }
  const qv = query.trim() ? await queryVec(query) : null;
  if (qv) {
    const all = db.prepare("SELECT id, ts, kind, text, importance, tags, x, z, embedding FROM memories WHERE embedding IS NOT NULL").all() as any[];
    const top = all.map((r) => ({ r, s: dot(qv, fromBlob(r.embedding)) })).sort((a, b) => b.s - a.s).slice(0, 30);
    for (const { r, s } of top) add(r).sem = relevance(s);
  }
  for (const r of db.prepare("SELECT id, ts, kind, text, importance, tags, x, z FROM memories ORDER BY id DESC LIMIT 15").all() as any[]) add(r);
  for (const r of db.prepare("SELECT id, ts, kind, text, importance, tags, x, z FROM memories ORDER BY importance DESC, id DESC LIMIT 10").all() as any[]) add(r);

  const hasQuery = !!(terms.length || qv);
  const scored = [...cand.values()].map((m) => {
    const recency = Math.pow(0.5, (now - m.ts) / 3_600_000 / HALF_LIFE_H);
    const rel = qv ? Math.max(m.sem, 0.6 * m.kw) : m.kw;   // with embeddings, meaning leads and keywords only support
    // memories from the place you are standing in come back more easily
    const here = near && m.x != null && m.z != null ? 0.5 * Math.max(0, 1 - Math.hypot(m.x - near.x, m.z - near.z) / 25) : 0;
    return { m, score: (hasQuery ? 2 * rel : 0) + m.importance / 10 + recency + here + (m.kind === "reflection" ? 0.2 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  const touch = db.prepare("UPDATE memories SET last_access = ?, access_count = access_count + 1 WHERE id = ?");
  scored.forEach(({ m }) => touch.run(now, m.id));
  return scored.map(({ m }) => ({ id: m.id, ts: m.ts, kind: m.kind, text: m.text, importance: m.importance, tags: m.tags, x: m.x, z: m.z }));
}

/** For the UI memory search: pure relevance, no recency/importance mixing. */
export async function search(q: string, limit = 50): Promise<MemoryRow[]> {
  if (!q.trim()) return db.prepare("SELECT id, ts, kind, text, importance, tags FROM memories ORDER BY id DESC LIMIT ?").all(limit) as any;
  const qv = await queryVec(q);
  const byId = new Map<number, { row: MemoryRow; s: number }>();
  if (qv) {
    for (const r of db.prepare("SELECT id, ts, kind, text, importance, tags, embedding FROM memories WHERE embedding IS NOT NULL").all() as any[]) {
      const s = dot(qv, fromBlob(r.embedding));
      if (relevance(s) > 0.15) byId.set(r.id, { row: { id: r.id, ts: r.ts, kind: r.kind, text: r.text, importance: r.importance, tags: r.tags }, s });
    }
  }
  const terms = tokens(q);
  if (terms.length) {
    try {
      const rows = db.prepare(`SELECT m.id, m.ts, m.kind, m.text, m.importance, m.tags FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
        WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?`).all(terms.map((t) => `"${t}"*`).join(" OR "), limit) as any[];
      rows.forEach((r, i) => { const prev = byId.get(r.id); byId.set(r.id, { row: r, s: Math.max(prev?.s ?? 0, 0.9 - i * 0.01) }); });
    } catch { /* ignore */ }
  }
  return [...byId.values()].sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.row);
}

export function memoryCount(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM memories").get() as any).c;
}

/** Forgetting: drop old, unimportant, never-recalled memories so the store stays meaningful. */
export function forgetStale(): number {
  const cutoff = Date.now() - 72 * 3_600_000;
  const r = db.prepare("DELETE FROM memories WHERE kind = 'episodic' AND importance <= 3 AND ts < ? AND access_count = 0").run(cutoff);
  return Number(r.changes);
}

export function importanceSince(ts: number): number {
  return (db.prepare("SELECT COALESCE(SUM(importance),0) AS s FROM memories WHERE ts > ? AND kind = 'episodic'").get(ts) as any).s;
}
