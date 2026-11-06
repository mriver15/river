// How open-ended a run was: read-only measurements over a database, so a change can be judged by what River did and not only by whether the engine stayed stable.
import type { DatabaseSync } from "node:sqlite";

export const TICKS_PER_DAY = 14_400;

export interface BehaviourReport {
  days: number;
  activities: { total: number; distinct: number; variety: number; byDef: { def: string; n: number }[]; byStatus: Record<string, number>; failureRate: number; longestRepeat: { def: string; n: number }; loopShare: number; newByDay: { day: number; defs: string[] }[]; quietDays: number };
  goals: { total: number; done: number; dropped: number; active: number; doneShare: number };
  making: { deedKinds: number; deeds: Record<string, number>; places: number; works: number; compositions: number; tools: number; memories: number };
  inner: { moments: Record<string, number>; emotionsFelt: number; relationships: number };
  cognition: { decisions: number; perDay: number; tokens: number; tokensPerDay: number; wakes: Record<string, number> };
  lives: { count: number; averageDays: number; causes: Record<string, number> };
  warnings: string[];
}

const rows = <T>(d: DatabaseSync, sql: string, ...a: (string | number)[]): T[] => { try { return d.prepare(sql).all(...a) as T[]; } catch { return []; } };
const one = <T>(d: DatabaseSync, sql: string, fallback: T): T => rows<T>(d, sql)[0] ?? fallback;
const tally = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const obj = (m: Map<string, number>) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));

/** Evenness of use across kinds, 0 (one thing, always) to 1 (all used equally). */
export function evenness(counts: number[]): number {
  const n = counts.filter((c) => c > 0).length, total = counts.reduce((a, b) => a + b, 0);
  if (n < 2 || !total) return 0;
  return -counts.filter((c) => c > 0).reduce((h, c) => h + (c / total) * Math.log(c / total), 0) / Math.log(n);
}

/** The longest unbroken run of one activity on one thing, and what share of everything is the commonest three-step cycle. */
export function loops(seq: string[]): { def: string; n: number; share: number } {
  let best = { def: "", n: 0 }, run = 0;
  for (let i = 0; i < seq.length; i++) { run = i && seq[i] === seq[i - 1] ? run + 1 : 1; if (run > best.n) best = { def: seq[i].split("|")[0], n: run }; }
  const grams = tally(seq.slice(2).map((_, i) => seq.slice(i, i + 3)).filter((g) => new Set(g).size > 1).map((g) => g.join(">")));        // one thing repeated is a stuck run, not a cycle
  const top = Math.max(0, ...grams.values()), distinct = new Set(seq).size;
  return { ...best, share: distinct > 1 && seq.length > 3 ? Math.min(1, top * 3 / seq.length) : 0 };
}

export function behaviourReport(d: DatabaseSync): BehaviourReport {
  const acts = rows<{ def: string; status: string; params: string; started_tick: number }>(d, "SELECT def, status, params, started_tick FROM sim_activities ORDER BY started_tick, id");
  const lastTick = Math.max(0, one<{ t: number | null }>(d, "SELECT MAX(tick) t FROM sim_checkpoints", { t: 0 }).t ?? 0, ...acts.slice(-1).map((a) => a.started_tick));
  const days = Math.max(1, Math.ceil(lastTick / TICKS_PER_DAY));
  const meaningful = acts.filter((a) => a.def !== "rest");                       // sleeping is not a pattern worth judging
  const seq = meaningful.map((a) => { let t = ""; try { const p = JSON.parse(a.params); t = String(p.target ?? p.id ?? p.name ?? p.item ?? ""); } catch { /* none */ } return `${a.def}|${t}`; });
  const byDef = tally(meaningful.map((a) => a.def)), byStatus = tally(acts.map((a) => a.status));
  const loop = loops(seq);
  const firstDay = new Map<string, number>(); for (const a of meaningful) if (!firstDay.has(a.def)) firstDay.set(a.def, Math.floor(a.started_tick / TICKS_PER_DAY) + 1);
  const newByDay = [...tally([...firstDay.values()].map(String))].map(([day]) => ({ day: +day, defs: [...firstDay].filter(([, v]) => v === +day).map(([k]) => k) })).sort((a, b) => a.day - b.day);
  const lastNew = newByDay.at(-1)?.day ?? 0;
  const failed = acts.filter((a) => a.status === "failed" || a.status === "interrupted").length;

  const desires = Object.fromEntries(tally(rows<{ status: string }>(d, "SELECT status FROM desires").map((r) => r.status)));
  const dn = (k: string) => desires[k] ?? 0, dTotal = Object.values(desires).reduce((x, y) => x + y, 0);
  const deeds = Object.fromEntries(rows<{ kind: string; n: number }>(d, "SELECT kind, SUM(qty) n FROM life_deeds GROUP BY kind ORDER BY n DESC").map((r) => [r.kind, r.n]));
  const count = (t: string) => one<{ n: number }>(d, `SELECT COUNT(*) n FROM ${t}`, { n: 0 }).n;
  const decisions = rows<{ kinds: string; in_tokens: number; out_tokens: number }>(d, "SELECT kinds, in_tokens, out_tokens FROM brain_decisions");
  const tokens = decisions.reduce((a, r) => a + r.in_tokens + r.out_tokens, 0);
  const wakes = tally(decisions.flatMap((r) => { try { return JSON.parse(r.kinds) as string[]; } catch { return [r.kinds]; } }));
  const lives = rows<{ days: number; cause: string }>(d, "SELECT days, cause FROM lives");
  const moments = tally(rows<{ kind: string }>(d, "SELECT kind FROM moments").map((r) => r.kind));

  const report: BehaviourReport = {
    days,
    activities: { total: acts.length, distinct: byDef.size, variety: +evenness([...byDef.values()]).toFixed(2), byDef: [...byDef].map(([def, n]) => ({ def, n })).sort((a, b) => b.n - a.n), byStatus: obj(byStatus), failureRate: acts.length ? +(failed / acts.length).toFixed(2) : 0, longestRepeat: { def: loop.def, n: loop.n }, loopShare: +loop.share.toFixed(2), newByDay, quietDays: Math.max(0, days - lastNew) },
    goals: { total: dTotal, done: dn("done"), dropped: dn("dropped"), active: dn("active"), doneShare: dTotal ? +(dn("done") / dTotal).toFixed(2) : 0 },
    making: { deedKinds: Object.keys(deeds).length, deeds, places: count("places"), works: count("works"), compositions: count("compositions"), tools: rows(d, "SELECT 1 FROM forged WHERE status = 'installed' OR status = 'approved'").length, memories: count("memories") },
    inner: { moments: obj(moments), emotionsFelt: rows(d, "SELECT DISTINCT emotion FROM mind_trace WHERE emotion IS NOT NULL").length, relationships: rows(d, "SELECT 1 FROM creatures WHERE trust > 0").length },
    cognition: { decisions: decisions.length, perDay: +(decisions.length / days).toFixed(1), tokens, tokensPerDay: Math.round(tokens / days), wakes: obj(wakes) },
    lives: { count: lives.length, averageDays: lives.length ? +(lives.reduce((a, l) => a + l.days, 0) / lives.length).toFixed(1) : 0, causes: obj(tally(lives.map((l) => l.cause))) },
    warnings: [],
  };
  const w = report.warnings, a = report.activities;
  if (a.total >= 20 && a.variety < 0.45) w.push(`Narrow: activity variety is ${a.variety} (1 is even use); ${a.byDef[0]?.def} is most of what River did.`);
  if (a.longestRepeat.n >= 15) w.push(`Stuck: ${a.longestRepeat.n} ${a.longestRepeat.def} activities in a row on the same thing.`);
  if (a.loopShare > 0.5) w.push(`Cycling: more than half of all activity is one repeating three-step loop.`);
  if (a.failureRate > 0.4 && a.total >= 20) w.push(`Struggling: ${Math.round(a.failureRate * 100)}% of activities failed or were interrupted.`);
  if (days >= 4 && a.quietDays >= days / 2) w.push(`Plateau: nothing new was tried in the last ${a.quietDays} of ${days} days.`);
  if (days >= 3 && report.goals.total === 0) w.push("Aimless: River never set a desire.");
  if (days >= 3 && report.goals.total >= 6 && report.goals.doneShare < 0.1) w.push(`Unfinished: ${report.goals.done} of ${report.goals.total} desires were ever completed.`);
  if (days >= 3 && report.making.deedKinds === 0 && a.total > 0) w.push("Passive: nothing was made, gathered, hunted or built.");
  return report;
}

export function formatReport(r: BehaviourReport, title = "Behaviour report"): string {
  const a = r.activities, line = (k: string, v: string | number) => `  ${k.padEnd(24)}${v}`;
  return [
    `${title} — ${r.days} simulated day${r.days === 1 ? "" : "s"}`,
    "Activity", line("total / distinct", `${a.total} / ${a.distinct}`), line("variety (0..1)", a.variety), line("failed or interrupted", `${Math.round(a.failureRate * 100)}%`),
    line("longest repeat", a.longestRepeat.n ? `${a.longestRepeat.n} × ${a.longestRepeat.def}` : "-"), line("repeating-loop share", a.loopShare), line("quiet days at the end", a.quietDays),
    line("most common", a.byDef.slice(0, 6).map((x) => `${x.def} ${x.n}`).join(", ") || "-"),
    line("new, by day", a.newByDay.map((n) => `d${n.day}: ${n.defs.join("+")}`).join("; ") || "-"),
    "Goals", line("desires", `${r.goals.total} (${r.goals.done} done, ${r.goals.dropped} dropped, ${r.goals.active} active)`),
    "Making", line("deeds", Object.entries(r.making.deeds).map(([k, n]) => `${k} ${n}`).join(", ") || "-"), line("places / works / songs", `${r.making.places} / ${r.making.works} / ${r.making.compositions}`), line("tools built", r.making.tools), line("memories", r.making.memories),
    "Inner life", line("moments", Object.entries(r.inner.moments).map(([k, n]) => `${k} ${n}`).join(", ") || "-"), line("emotions felt", r.inner.emotionsFelt), line("creatures trusted", r.inner.relationships),
    "Mind", line("decisions", `${r.cognition.decisions} (${r.cognition.perDay}/day)`), line("tokens", `${r.cognition.tokens} (${r.cognition.tokensPerDay}/day)`), line("woken by", Object.entries(r.cognition.wakes).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ") || "-"),
    "Lives", line("count / average", `${r.lives.count} / ${r.lives.averageDays} days`), line("causes", Object.entries(r.lives.causes).map(([k, n]) => `${k} ${n}`).join(", ") || "-"),
    r.warnings.length ? "Warnings\n" + r.warnings.map((x) => `  ! ${x}`).join("\n") : "Warnings\n  none",
  ].join("\n");
}
