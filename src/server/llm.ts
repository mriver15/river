// DeepSeek via its OpenAI-compatible chat-completions API (https://api-docs.deepseek.com).
import { record } from "./usage.ts";

// Any OpenAI-compatible endpoint works: DeepSeek (default) or a local server such as Ollama (http://localhost:11434/v1).
const BASE = (process.env.LLM_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE);
export const MODEL = process.env.RIVER_MODEL ?? "deepseek-flash";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ToolSpec { name: string; description: string; input_schema: Record<string, any> }
/** `truncated`: the model spent its whole token allowance thinking and produced no answer. */
export interface ChatResult { message: ChatMessage; text: string; truncated: boolean; toolCalls: { id: string; name: string; args: Record<string, any>; badJson?: boolean }[]; finish: string }

export async function chat(opts: { messages: ChatMessage[]; tools?: ToolSpec[]; json?: boolean; maxTokens?: number; model?: string; temperature?: number }): Promise<ChatResult> {
  const key = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!key && !LOCAL) throw new Error("DEEPSEEK_API_KEY is not set (put it in .env, or run with MOCK_LLM=1)");
  const body: Record<string, any> = { model: opts.model ?? MODEL, messages: opts.messages, max_tokens: opts.maxTokens ?? 4000, stream: false };
  if (opts.tools?.length) { body.tools = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })); body.tool_choice = "auto"; }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };

  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) {
      const data: any = await res.json();
      record(data.usage);
      const choice = data.choices?.[0];
      if (!choice) throw new Error("DeepSeek returned no choices");
      const m = choice.message;
      const message: ChatMessage = { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls?.length ? m.tool_calls : undefined };
      if (m.reasoning_content) message.reasoning_content = m.reasoning_content;
      const toolCalls = (m.tool_calls ?? []).map((c: any) => {
        try { return { id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || "{}") }; }
        catch { return { id: c.id, name: c.function.name, args: {}, badJson: true }; }
      });
      const text = (m.content ?? "").trim();
      return { message, text, toolCalls, finish: choice.finish_reason, truncated: choice.finish_reason === "length" && !text && !toolCalls.length };
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`DeepSeek API error: ${lastErr}`);
}
