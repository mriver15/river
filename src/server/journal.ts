// The day's story: at each sunrise, one call turns yesterday's log into a short narrative.
import { db, kvGet, kvSet } from "./db.ts";
import { bus, log } from "./bus.ts";
import { chat } from "./llm.ts";
import { dayMs, type World } from "./world.ts";
import { MOCK } from "./agent.ts";
import { lifeGen, isStale, discarded } from "./lifecycle.ts";
import { overBudget } from "./usage.ts";
import { momentsBetween } from "./moments.ts";
import type { JournalEntry } from "../shared/types.ts";
import { simNow, every } from "./sim.ts";

export const journalList = (limit = 30): JournalEntry[] => db.prepare("SELECT * FROM journal ORDER BY day DESC LIMIT ?").all(limit) as any;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function startJournal(w: World) {
  every(30_000, () => void tick(w).catch((e) => log("system", `Journal failed: ${e.message}`)), "journal");
}

export async function tick(w: World) {
  const day = w.day(), want = day - 1;             // write up the day that just ended
  if (want < 1 || kvGet<number>("journalDone", 0) >= want) return;
  if (!MOCK && overBudget()) return;
  // that day's real-time window
  const from = w.epoch + (want - 1) * dayMs(), to = w.epoch + want * dayMs();
  const rows = db.prepare("SELECT kind, text FROM events WHERE ts >= ? AND ts < ? AND kind IN ('thought','speech','observation','world','desire','reflection','human','dream','need','request') ORDER BY id").all(from, to) as any[];
  if (rows.length < 4) { kvSet("journalDone", want); return; }       // nothing happened worth writing; skip the day
  // keep the story's skeleton: skip routine observations, keep the rest
  const keep = rows.filter((r) => r.kind !== "observation" || /found|read|gathered|built|planted|crafted|named|ate|arrived at/i.test(r.text));
  const lines = keep.slice(-90).map((r) => `${r.kind}: ${clip(r.text.replace(/\n/g, " "), 200)}`);
  const moments = momentsBetween(from, to, 6);
  let text: string;
  const gen = lifeGen();
  if (MOCK) text = `Day ${want}: ${w.me.name} wandered, gathered, and watched the weather change.`;
  else {
    const r = await chat({ maxTokens: 4000, messages: [{ role: "user", content: `Below is the log of one day in the life of ${w.me.name}, a small curious being living alone on an island. Write the story of that day as a short diary-like narrative in warm, literary third person (120-200 words). Use only what the log shows; do not invent events. Capture the shape of the day: what drew ${w.me.name}'s attention, what changed, how it felt. No headings, no lists.${moments.length ? `\n\nTURNING POINTS of the day (these are what mattered most; build the story around them, letting the feeling in each show in how the day is told): \n${moments.map((m) => `- ${m.title} [${Object.entries(m.emotions).map(([k, v]) => `${k} ${v}`).join(", ")}]`).join("\n")}` : ""}\n\nLOG:\n${lines.join("\n")}` }] });
    if (r.truncated) throw new Error("model ran out of tokens while thinking");
    text = r.text.trim();
  }
  if (isStale(gen)) { discarded("story"); return; }
  if (!text) return;
  db.prepare("INSERT OR REPLACE INTO journal(day, text, ts) VALUES(?,?,?)").run(want, text, simNow());
  kvSet("journalDone", want);
  log("system", `Story written for day ${want}.`);
  bus.emit("state");
}
