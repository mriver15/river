// Dreams: while River sleeps, weave a few memories into something strange. Rare and cheap (one small call).
import { cfg } from "./config.ts";
import { db, kvGet, kvSet } from "./db.ts";
import { bus, log } from "./bus.ts";
import { chat } from "./llm.ts";
import { addMemory } from "./memory.ts";
import { overBudget } from "./usage.ts";
import { MOCK } from "./agent.ts";
import { recordCommand, finishCommand, isReplaying } from "./recorder.ts";
import { lifeGen, isStale, discarded } from "./lifecycle.ts";
import type { World } from "./world.ts";
import { simNow } from "./sim.ts";

const COOLDOWN_MS = 8 * 60_000;
const seeds: string[] = kvGet<string[]>("dreamSeeds", []);
let busy = false, lastAt = kvGet<number>("lastDream", 0);

/** A thought planted by the human; drifts into the next dream. */
export function plantSeed(text: string) {
  seeds.push(text.slice(0, 200)); kvSet("dreamSeeds", seeds);
  log("human", `Human planted a thought for River's next dream: "${text.slice(0, 200)}"`);
}

export function resetDreams() { seeds.length = 0; lastAt = 0; }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export interface DreamHooks { feelings: () => string; after: () => void }
export function startDreams(w: World, notify: (msg: string) => void, hooks?: DreamHooks) {
  bus.on("slept", ({ seconds }: { seconds: number }) => void dream(w, seconds, notify, hooks).catch((e) => log("system", `Dream failed: ${e.message}`)));
}

async function dream(w: World, seconds: number, notify: (msg: string) => void, hooks?: DreamHooks) {
  if (isReplaying() || busy || simNow() - lastAt < COOLDOWN_MS) return;   // replay applies the recorded dream instead
  if (!MOCK && overBudget()) return;
  const today = w.day(), key = `dreams:${today}`;
  if (kvGet<number>(key, 0) >= cfg("dreams")) return;
  busy = true;
  const gen = lifeGen();
  try {
    // some recent, some random older: dreams recombine
    const recent = db.prepare("SELECT text FROM memories WHERE kind != 'dream' ORDER BY id DESC LIMIT 3").all() as any[];
    const older = db.prepare("SELECT text FROM memories WHERE kind != 'dream' AND id NOT IN (SELECT id FROM memories ORDER BY id DESC LIMIT 3) ORDER BY RANDOM() LIMIT 3").all() as any[];
    const frags = [...recent, ...older].map((m) => clip(m.text, 180));
    if (frags.length < 2) return;
    const seed = seeds.shift(); kvSet("dreamSeeds", seeds);

    let text = "", insight = "", shift = 0;
    if (MOCK) { text = `I dreamed the trees were walking and I could not remember which of them was me. (${clip(frags[0], 40)})`; insight = "Maybe I am the one who stays."; shift = 2; }
    else {
      const r = await chat({
        json: true, maxTokens: 4000,
        messages: [{ role: "user", content: `You are River, a small curious being asleep on an island. Fragments of your memory rise and mix:\n${frags.map((f) => `- ${f}`).join("\n")}${hooks ? `\n\nYou went to sleep feeling: ${hooks.feelings()}. Let that colour the dream without naming it.` : ""}${seed ? `\n\nA thought drifts in from outside, as thoughts sometimes do in sleep: "${seed}"` : ""}\n\nWrite the dream: 3-5 sentences, first person, present tense, made of images rather than explanation, strange but emotionally true. Mix the fragments in ways that do not happen in waking life. Then, if the dream leaves you with a genuine realisation on waking, give it in one sentence (otherwise leave it empty). Also give how the dream leaves your mood, from -8 (shaken) to 8 (soothed).\nRespond with JSON: {"dream": string, "insight": string, "mood_shift": number}` }],
      });
      if (r.truncated) throw new Error("model ran out of tokens while thinking");
      const j = JSON.parse(r.text);
      text = String(j.dream ?? "").trim(); insight = String(j.insight ?? "").trim(); shift = Math.max(-8, Math.min(8, Number(j.mood_shift) || 0));
    }
    if (!text) return;
    if (isStale(gen)) { discarded("dream"); return; }
    // The model's answer is an outside input: journal it, then apply it through the same path replay uses.
    const result: DreamResult = { text, insight, shift, seed: seed ?? null, key };
    const seq = recordCommand("external", "dream", result);
    applyDream(w, result, notify, hooks);
    finishCommand(seq, "ok", "");
  } finally { busy = false; }
}

export interface DreamResult { text: string; insight: string; shift: number; seed: string | null; key: string }
export function applyDream(w: World, r: DreamResult, notify: (msg: string) => void, hooks?: DreamHooks) {
  lastAt = simNow(); kvSet("lastDream", lastAt); kvSet(r.key, kvGet<number>(r.key, 0) + 1);
  log("dream", `${w.me.name} dreams: ${r.text}${r.insight ? `\nOn waking: ${r.insight}` : ""}`, { seed: r.seed });
  addMemory(`I dreamed: ${r.text}`, 4, ["dream"], "dream");
  if (r.insight) addMemory(r.insight, 6, ["dream"], "reflection");
  w.bump({ mood: r.shift }); hooks?.after();
  notify(`## You woke from a dream\n"${r.text}"${r.insight ? `\nYou wake with a thought: ${r.insight}` : ""}`);
}
