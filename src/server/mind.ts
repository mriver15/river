import { db } from "./db.ts";
import { dot, embed, relevance } from "./embed.ts";
import { bus, log } from "./bus.ts";
import type { Desire, Interest, ToolInfo, ToolRequest } from "../shared/types.ts";

// ---------- desires ----------
export function addDesire(text: string, priority = 5): Desire {
  const dup = (db.prepare("SELECT * FROM desires WHERE status='active' AND lower(text)=lower(?)").get(text) as any);
  if (dup) return rowToDesire(dup);
  const r = db.prepare("INSERT INTO desires(text, priority, created) VALUES(?,?,?)").run(text, Math.max(1, Math.min(10, priority)), Date.now());
  log("desire", `New desire: ${text} (priority ${priority})`);
  bus.emit("state");
  return rowToDesire(db.prepare("SELECT * FROM desires WHERE id=?").get(r.lastInsertRowid));
}
export function closeDesire(id: number, status: "done" | "dropped", outcome = ""): boolean {
  const r = db.prepare("UPDATE desires SET status=?, outcome=? WHERE id=? AND status='active'").run(status, outcome, id);
  if (!Number(r.changes)) return false;
  const d = db.prepare("SELECT text FROM desires WHERE id=?").get(id) as any;
  log("desire", `Desire ${status}: ${d.text}${outcome ? ` — ${outcome}` : ""}`);
  bus.emit("state");
  return true;
}
const rowToDesire = (r: any): Desire => ({ id: r.id, text: r.text, priority: r.priority, status: r.status, created: r.created, outcome: r.outcome ?? undefined });
export const activeDesires = (): Desire[] =>
  (db.prepare("SELECT * FROM desires WHERE status='active' ORDER BY priority DESC, id").all() as any[]).map(rowToDesire);
export const recentClosedDesires = (n = 5): Desire[] =>
  (db.prepare("SELECT * FROM desires WHERE status!='active' ORDER BY id DESC LIMIT ?").all(n) as any[]).map(rowToDesire);

// ---------- interests ----------
export function touchInterest(topic: string, why = "", delta = 1) {
  const t = topic.trim().toLowerCase().slice(0, 60);
  if (!t) return;
  const row = db.prepare("SELECT * FROM interests WHERE topic=?").get(t) as any;
  if (row) db.prepare("UPDATE interests SET weight=MIN(10, weight+?), why=?, updated=? WHERE topic=?").run(delta, why || row.why, Date.now(), t);
  else { db.prepare("INSERT INTO interests(topic, weight, why, updated) VALUES(?,?,?,?)").run(t, Math.max(1, Math.min(10, delta)), why, Date.now()); log("desire", `New interest: ${t}${why ? ` — ${why}` : ""}`); }
  bus.emit("state");
}
/** Interests fade unless fed. */
export function decayInterests() {
  db.prepare("UPDATE interests SET weight = weight * 0.97").run();
  db.prepare("DELETE FROM interests WHERE weight < 0.4").run();
}
export const interests = (): Interest[] =>
  (db.prepare("SELECT * FROM interests ORDER BY weight DESC LIMIT 30").all() as any[]).map((r) => ({ topic: r.topic, weight: Math.round(r.weight * 10) / 10, why: r.why, updated: r.updated }));

// ---------- tool catalog & requests ----------
export const GATED: Record<string, string> = {
  web_search: "Search the real web. Lets you find out about anything you're curious about (including things outside this island).",
  web_fetch: "Open a specific web page by URL and read it.",
  craft: "Combine up to 3 items from your inventory into a new invented item.",
  plant: "Plant a seed in the ground; it grows over a few minutes into a flower, bush or tree.",

};

/** Approved requests whose tool now exists in code (e.g. a plugin you just wrote) become usable. */
export function syncApprovals() {
  for (const r of db.prepare("SELECT DISTINCT name FROM tool_requests WHERE status='approved'").all() as any[])
    if (r.name in GATED) db.prepare("INSERT INTO tools(name, approved) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET approved=1").run(r.name);
}
export const isApproved = (name: string) => !!(db.prepare("SELECT approved FROM tools WHERE name=?").get(name) as any)?.approved;
export function toolInfos(base: { name: string; description: string }[]): ToolInfo[] {
  return [
    ...base.map((t) => ({ name: t.name, description: t.description, status: "base" as const })),
    ...Object.entries(GATED).map(([name, description]) => ({ name, description, status: isApproved(name) ? ("approved" as const) : ("locked" as const) })),
  ];
}

const rowToReq = (r: any): ToolRequest => ({ id: r.id, ts: r.ts, name: r.name, reason: r.reason, status: r.status, custom: !!r.custom, note: r.note ?? undefined, matches: r.matches ? JSON.parse(r.matches) : undefined });
export const requests = (limit = 40): ToolRequest[] =>
  (db.prepare("SELECT * FROM tool_requests ORDER BY (status='pending') DESC, id DESC LIMIT ?").all(limit) as any[]).map(rowToReq);

export function requestTool(name: string, reason: string): { req: ToolRequest; message: string } {
  const key = name.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 60);
  if (key in GATED && isApproved(key)) return { req: null as any, message: `You already have ${key}.` };
  const open = db.prepare("SELECT * FROM tool_requests WHERE name=? AND status='pending'").get(key) as any;
  if (open) return { req: rowToReq(open), message: `Your request for ${key} is still waiting for the human's decision.` };
  const r = db.prepare("INSERT INTO tool_requests(ts, name, reason, custom) VALUES(?,?,?,?)").run(Date.now(), key, reason, key in GATED ? 0 : 1);
  const req = rowToReq(db.prepare("SELECT * FROM tool_requests WHERE id=?").get(r.lastInsertRowid));
  log("request", `Requested tool "${key}"${req.custom ? " (new, not in catalog)" : ""}: ${reason}`, { id: req.id });
  if (req.custom) void matchBuiltin(`${key.replace(/_/g, " ")}. ${reason}`).then((m) => { if (m.length) { db.prepare("UPDATE tool_requests SET matches=? WHERE id=?").run(JSON.stringify(m), req.id); bus.emit("state"); } }).catch(() => {});
  bus.emit("state");
  return { req, message: `Request sent. A human will decide; you'll be told the outcome. Keep living meanwhile.` };
}

// River is never shown the catalog, so its requests come in its own words ("I want to make melodies"). Match them against what
// already exists, so the human can grant the built-in tool instead of having the smith write a duplicate.
const docVecs = new Map<string, Float32Array>();
const STOP = new Set("with that this from have your what when which would could should about into over make want able being like just some very then them they their there here where each also".split(" "));
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
/** First sentence only: a tool's long how-to text would otherwise dominate what it "means". */
const gist = (d: string) => (d.split(/(?<=[.;])\s/)[0] ?? d).slice(0, 240);
/** Score every locked built-in against a request, best first. 0..1, where unrelated text lands near 0. */
export async function matchScores(request: string): Promise<{ name: string; score: number }[]> {
  const cands = Object.entries(GATED).filter(([k]) => !isApproved(k)); if (!cands.length) return [];
  const fresh = cands.filter(([k]) => !docVecs.has(k));
  if (fresh.length) { const vs = await embed(fresh.map(([k, d]) => `${k.replace(/_/g, " ")}: ${gist(d)}`), "document"); if (vs) fresh.forEach(([k], i) => docVecs.set(k, vs[i])); }
  const q = (await embed([request.slice(0, 600)], "query"))?.[0];
  if (q) return cands.flatMap(([k]) => { const v = docVecs.get(k); return v ? [{ name: k, score: relevance(dot(q, v)) }] : []; }).sort((a, b) => b.score - a.score);
  const qw = words(request);                                                      // no embeddings: fall back to shared vocabulary
  return cands.map(([k, d]) => { const shared = [...words(`${k} ${gist(d)}`)].filter((w) => qw.has(w)).length; return { name: k, score: shared >= 2 ? Math.min(0.9, 0.5 + shared / 10) : 0 }; }).sort((a, b) => b.score - a.score);
}
/** Built-ins that clearly fit this request: a short list (up to 3) for the human to choose from, or nothing. */
export async function matchBuiltin(request: string): Promise<{ name: string; score: number }[]> {
  return (await matchScores(request)).filter((m) => m.score >= 0.85).slice(0, 3).map((m) => ({ name: m.name, score: +m.score.toFixed(2) }));
}

/** Tools River already used before they became something to ask for keep working, so a life in progress isn't taken apart. */
export function grandfather(names: string[]) {
  for (const n of names) {
    if (isApproved(n)) continue;
    const used = db.prepare("SELECT 1 FROM events WHERE kind = 'action' AND (text LIKE ? OR text LIKE ?) LIMIT 1").get(`${n} {%`, `${n} {}%`);
    if (used) { db.prepare("INSERT INTO tools(name, approved) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET approved=1").run(n); log("system", `"${n}" is now something River asks for. It already used it, so it keeps it.`); }
  }
}

export function decideRequest(id: number, approve: boolean, note?: string, builtin?: string): ToolRequest | null {
  const row = db.prepare("SELECT * FROM tool_requests WHERE id=? AND status='pending'").get(id) as any;
  if (!row) return null;
  db.prepare("UPDATE tool_requests SET status=?, note=? WHERE id=?").run(approve ? "approved" : "denied", note ?? null, id);
  const grant = approve ? (builtin && builtin in GATED ? builtin : row.name in GATED ? row.name : null) : null;      // which built-in this unlocks, if any
  if (grant) db.prepare("INSERT INTO tools(name, approved) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET approved=1").run(grant);
  log("request", `Tool request "${row.name}" ${approve ? `APPROVED${grant && grant !== row.name ? ` (granted the built-in "${grant}")` : ""}` : "DENIED"}${note ? `: ${note}` : ""}`, { id });
  bus.emit("state");
  return rowToReq(db.prepare("SELECT * FROM tool_requests WHERE id=?").get(id));
}
