// Local embeddings via Ollama (/api/embed). If it isn't reachable, memory silently falls back to keyword search.
const BASE = (process.env.EMBED_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "mxbai-embed-large";
export const EMBED_ENABLED = process.env.EMBED_DISABLED !== "1" && process.env.MOCK_LLM !== "1";

let downUntil = 0;
let warned = false;

// Retrieval models are trained with task prefixes; using the right one matters.
const PREFIX = /nomic/i.test(EMBED_MODEL) ? { document: "search_document: ", query: "search_query: " }
  : /mxbai/i.test(EMBED_MODEL) ? { document: "", query: "Represent this sentence for searching relevant passages: " }
  : { document: "", query: "" };
export const EMBED_VERSION = `${EMBED_MODEL}+p1`;

// Cosine ranges measured per model: [typical unrelated, typical clearly-related]. Maps similarity to a 0..1 relevance.
const RANGE: [number, number] = /nomic/i.test(EMBED_MODEL) ? [0.5, 0.7] : /mxbai/i.test(EMBED_MODEL) ? [0.42, 0.68] : [0.45, 0.7];
export const relevance = (cos: number) => Math.max(0, Math.min(1, (cos - RANGE[0]) / (RANGE[1] - RANGE[0])));

export async function embed(texts: string[], as: "document" | "query" = "document"): Promise<Float32Array[] | null> {
  if (!EMBED_ENABLED || !texts.length || Date.now() < downUntil) return null;
  try {
    const r = await fetch(`${BASE}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => PREFIX[as] + t.slice(0, 2000)) }), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    const d: any = await r.json();
    warned = false;
    return (d.embeddings as number[][]).map(normalize);
  } catch (e: any) {
    downUntil = Date.now() + 60_000;                         // don't hammer a missing server
    if (!warned) { warned = true; console.warn(`[embed] unavailable (${e.message}); using keyword memory search. Is Ollama running with \`${EMBED_MODEL}\`?`); }
    return null;
  }
}

function normalize(v: number[]): Float32Array {
  const f = Float32Array.from(v);
  let n = 0; for (const x of f) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < f.length; i++) f[i] /= n;
  return f;
}
/** cosine similarity of two normalized vectors */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
export const toBlob = (f: Float32Array) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
export const fromBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
