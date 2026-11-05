// "Does this setup work?" for the settings pane: can the server be reached, which models does it offer, does the chosen one answer and
// call tools (River acts only through tool calls), and, for Ollama, is its context window big enough for what River is shown.
import { chat } from "./llm.ts";
import { cfg } from "./config.ts";
import { provider, type Provider } from "./provider.ts";

export interface Step { name: string; ok: boolean; note: string }

const get = async (url: string, key?: string) => {
  const r = await fetch(url, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json() as Promise<any>;
};

/** The models the server offers (Ollama: what has been pulled; others: the /models list). Empty if it cannot say. */
export async function listModels(P: Provider = provider()): Promise<{ models: string[]; error?: string }> {
  try {
    if (P.kind === "ollama") return { models: ((await get(`${P.root}/api/tags`)).models ?? []).map((m: any) => String(m.name)).sort() };
    if (!P.base) return { models: [], error: "no server address" };
    return { models: ((await get(`${P.base}/models`, P.key)).data ?? []).map((m: any) => String(m.id)).sort() };
  } catch (e) { return { models: [], error: P.kind === "ollama" && /fetch failed|ECONNREFUSED/.test(String(e)) ? `Cannot reach Ollama at ${P.root}. Is it running?` : String((e as Error).message ?? e) }; }
}

export async function testProvider(P: Provider = provider()): Promise<{ ok: boolean; provider: string; model: string; steps: Step[] }> {
  const steps: Step[] = [], add = (name: string, ok: boolean, note: string) => { steps.push({ name, ok, note }); return ok; };
  const done = () => ({ ok: steps.every((s) => s.ok), provider: P.label, model: P.model, steps });
  const list = await listModels(P);
  if (list.error && P.kind === "ollama") { add("Reach the server", false, list.error); return done(); }
  add("Reach the server", !list.error || P.kind !== "ollama", list.error ? `${list.error} (some servers do not list models; going on)` : `${P.base}: ${list.models.length} model${list.models.length === 1 ? "" : "s"} available`);
  if (!P.model) { add("Choose a model", false, list.models.length ? `Pick one: ${list.models.slice(0, 8).join(", ")}` : "No model is set in Settings."); return done(); }
  if (list.models.length) {
    const has = list.models.some((m) => m === P.model || m === `${P.model}:latest` || m.replace(/:latest$/, "") === P.model);
    if (!add("The model is there", has, has ? P.model : `${P.model} is not on the server. ${P.kind === "ollama" ? `Try \`ollama pull ${P.model}\`. ` : ""}Available: ${list.models.slice(0, 8).join(", ")}`)) return done();
  }
  const t0 = Date.now();
  try {
    const r = await chat({ consumer: "test", reason: "settings test", maxTokens: 300, messages: [{ role: "system", content: "You act only by calling tools." }, { role: "user", content: "Call the ping tool with the word ready." }],
      tools: [{ name: "ping", description: "Reply that you are ready.", input_schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"], additionalProperties: false } }] });
    const ms = Date.now() - t0;
    add("The model answers", true, `${(ms / 1000).toFixed(1)} s${P.local && ms > 60_000 ? " (slow: River will think slowly)" : ""}`);
    add("It can call tools", r.toolCalls.length > 0, r.toolCalls.length ? "yes" : `no: it answered in words ("${r.text.slice(0, 80)}"). River acts through tool calls, so it would not be able to do anything. Try another model.`);
  } catch (e) { add("The model answers", false, String((e as Error).message ?? e)); return done(); }
  if (P.kind === "ollama") {
    try {
      const ps = (await get(`${P.root}/api/ps`)).models ?? [], me = ps.find((m: any) => m.name === P.model || m.model === P.model || String(m.name).replace(/:latest$/, "") === P.model);
      const ctx = Number(me?.context_length), want = cfg("packetTokens") + 3000;
      if (ctx) add("Context window is big enough", ctx >= want, ctx >= want ? `${ctx} tokens` : `${ctx} tokens, but River's prompt can reach about ${want}. Ollama would cut the start of it off. Start Ollama with OLLAMA_CONTEXT_LENGTH=${Math.max(16384, 2 ** Math.ceil(Math.log2(want)))}, or lower "Size of what River is shown".`);
    } catch { /* an older Ollama does not report it; say nothing */ }
  }
  return done();
}
