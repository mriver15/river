// Which AI provider River's mind is using right now, worked out from the settings (and, for the key, the environment).
// Read at the moment of each call, so changing it in the settings takes effect on River's next thought.
import { cfg } from "./config.ts";

export type ProviderKind = "deepseek" | "ollama" | "custom";
export interface Provider {
  kind: ProviderKind;
  label: string;
  /** the OpenAI-style root: chat completions are at `${base}/chat/completions` */
  base: string;
  /** the server's own root (Ollama's native API lives here, next to /v1) */
  root: string;
  model: string;
  key: string | undefined;
  /** on this machine or network: no key needed, no cost, and the token budget need not apply */
  local: boolean;
  timeoutMs: number;
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const trim = (s: string) => s.trim().replace(/\/+$/, "");

/** Pure: the provider for a set of settings. (The environment supplies the key and DeepSeek's address.) */
export function resolveProvider(s: { provider: string; baseUrl: string; model: string; timeoutSeconds: number }, env: NodeJS.ProcessEnv = process.env): Provider {
  const kind: ProviderKind = s.provider === "ollama" ? "ollama" : s.provider === "custom" ? "custom" : "deepseek";
  const given = trim(s.baseUrl);
  let root: string, base: string;
  if (kind === "ollama") { root = trim((given || "http://localhost:11434").replace(/\/v1$/i, "")); base = `${root}/v1`; }
  else if (kind === "custom") { base = given || trim(env.LLM_BASE_URL ?? ""); root = base.replace(/\/v1$/i, ""); }
  else { base = given || trim(env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"); root = base; }
  const local = kind === "ollama" || LOCAL_HOST.test(base);
  return {
    kind, label: kind === "ollama" ? "Ollama" : kind === "custom" ? "the model server" : "DeepSeek", base, root,
    model: s.model.trim() || (kind === "deepseek" ? env.RIVER_MODEL || "deepseek-flash" : ""),
    key: env.LLM_API_KEY ?? env.DEEPSEEK_API_KEY, local, timeoutMs: Math.max(5, s.timeoutSeconds) * 1000,
  };
}

export const provider = (): Provider => resolveProvider({ provider: cfg("llmProvider"), baseUrl: cfg("llmBaseUrl"), model: cfg("llmModel"), timeoutSeconds: cfg("llmTimeoutSeconds") });
export const modelName = () => provider().model;
/** The model the tool smith writes plugins with: its own setting, then the environment, then River's. */
export const forgeModelName = () => cfg("forgeModel").trim() || process.env.RIVER_FORGE_MODEL || undefined;
/** Does the hourly token budget apply? Hosted models, always; local ones only if the human says so. */
export const budgetApplies = () => !provider().local || cfg("budgetLocal");
