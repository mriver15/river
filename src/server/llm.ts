// The model River thinks with, through any OpenAI-compatible chat-completions API: DeepSeek (hosted), Ollama or another server on
// this machine, or any other. Which one is a setting (see provider.ts) and is read afresh for every call.
import { record } from "./usage.ts";
import { provider, modelName, type Provider } from "./provider.ts";

export const MODEL_LABEL = modelName;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ToolSpec { name: string; description: string; input_schema: Record<string, any> }
/** `truncated`: the model spent its whole token allowance thinking and produced no answer. */
export interface ChatResult { message: ChatMessage; text: string; truncated: boolean; usage?: { inp: number; out: number; hit: number }; toolCalls: { id: string; name: string; args: Record<string, any>; badJson?: boolean }[]; finish: string }

export async function chat(opts: { messages: ChatMessage[]; tools?: ToolSpec[]; json?: boolean; maxTokens?: number; model?: string; temperature?: number; consumer?: string; reason?: string; signal?: AbortSignal }): Promise<ChatResult> {
  const P = provider(), key = P.key, model = opts.model ?? P.model;
  if (!P.base) throw new Error("No server address is set. Choose a provider and address in Settings.");
  if (!model) throw new Error(`No model is chosen for ${P.label}. Pick one in Settings${P.kind === "ollama" ? " (the names `ollama list` shows)" : ""}.`);
  if (!key && !P.local) throw new Error(P.kind === "deepseek" ? "DEEPSEEK_API_KEY is not set (put it in .env, choose a local provider in Settings, or run with MOCK_LLM=1)" : "LLM_API_KEY is not set (put it in .env)");
  const body: Record<string, any> = { model, messages: opts.messages, max_tokens: opts.maxTokens ?? 4000, stream: false };
  if (opts.tools?.length) { body.tools = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })); body.tool_choice = "auto"; }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };

  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${P.base}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body), signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(P.timeoutMs)]) : AbortSignal.timeout(P.timeoutMs),
    }).catch((e) => { if (opts.signal?.aborted) throw new Error("cancelled"); throw new Error(unreachable(P, e)); });
    if (res.ok) {
      const data: any = await res.json();
      record(data.usage, { consumer: opts.consumer, reason: opts.reason, ms: Date.now() - t0 });
      const choice = data.choices?.[0];
      if (!choice) throw new Error(`${P.label} returned no choices`);
      const m = choice.message;
      const { content, reasoning } = splitThinking(m.content ?? null, m.reasoning_content ?? m.reasoning);
      const message: ChatMessage = { role: "assistant", content, tool_calls: m.tool_calls?.length ? m.tool_calls : undefined };
      if (reasoning) message.reasoning_content = reasoning;
      const toolCalls = (m.tool_calls ?? []).map((c: any) => {
        try { return { id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || "{}") }; }
        catch { return { id: c.id, name: c.function.name, args: {}, badJson: true }; }
      });
      const text = (content ?? "").trim();
      return { message, text, toolCalls, usage: { inp: data.usage?.prompt_tokens ?? 0, out: data.usage?.completion_tokens ?? 0, hit: data.usage?.prompt_cache_hit_tokens ?? 0 }, finish: choice.finish_reason, truncated: choice.finish_reason === "length" && !text && !toolCalls.length };
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    if (opts.signal?.aborted) throw new Error("cancelled");
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`${P.label} error: ${hint(P, lastErr)}`);
}

/** Some local models (the R1 family and its fine-tunes) put their reasoning inside the answer as <think>…</think>. Keep it, but out of the text River acts on. */
export function splitThinking(content: string | null, reasoning?: string): { content: string | null; reasoning?: string } {
  if (content === null) return { content, reasoning };
  const found: string[] = [];
  let out = content.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_, t: string) => { found.push(t.trim()); return ""; });
  out = out.replace(/^[\s\S]*?<\/think(?:ing)?>/i, (m) => { found.push(m.replace(/<\/think(?:ing)?>$/i, "").trim()); return ""; });   // a reply that begins mid-thought
  return { content: out.trim(), reasoning: [reasoning, ...found].filter(Boolean).join("\n") || undefined };
}

function unreachable(P: Provider, e: any): string {
  const code = e?.cause?.code ?? e?.code ?? "";
  if (code === "ECONNREFUSED" || /fetch failed/.test(String(e?.message))) return `Cannot reach ${P.label} at ${P.base}${P.kind === "ollama" ? ". Is Ollama running? (`ollama serve`)" : "."}`;
  if (e?.name === "TimeoutError") return `${P.label} did not answer within ${Math.round(P.timeoutMs / 1000)} seconds. A slow local model may need a longer wait in Settings.`;
  return `${P.label} could not be reached: ${e?.message ?? e}`;
}
/** Say what an error from the server most likely means, for the errors people actually meet. */
export function hint(P: Provider, err: string): string {
  if (P.kind === "ollama" || P.local) {
    if (/not found/i.test(err) && /model/i.test(err)) return `${err.slice(0, 200)}. Is it pulled? Try \`ollama pull ${P.model}\`.`;
    if (/does not support tools|tool/i.test(err) && /support|not/i.test(err)) return `${err.slice(0, 200)}. River acts through tool calls, so the model must support them; try another model or a variant built with a tool-calling template.`;
  }
  if (/401|403/.test(err.slice(0, 5))) return `${err.slice(0, 200)}. Check the key in .env.`;
  return err;
}
