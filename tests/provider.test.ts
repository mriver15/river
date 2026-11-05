import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { AddressInfo } from "node:net";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-provtest-")), "t.db");
delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY; delete process.env.DEEPSEEK_API_KEY; delete process.env.RIVER_MODEL;
const { resolveProvider, provider, budgetApplies, forgeModelName } = await import("../src/server/provider.ts");
const { setConfig, cfg, DEFS, effective } = await import("../src/server/config.ts");
const { chat, splitThinking } = await import("../src/server/llm.ts");
const { listModels, testProvider } = await import("../src/server/provider-check.ts");
const { maxTokensNow, maxCyclesNow } = await import("../src/server/usage.ts");

const base = { provider: "deepseek", baseUrl: "", model: "", timeoutSeconds: 180 };

test("the provider is worked out from the settings: addresses, models, keys, and whether it is local", () => {
  const ds = resolveProvider(base, { DEEPSEEK_API_KEY: "k" });
  assert.equal(ds.base, "https://api.deepseek.com"); assert.equal(ds.model, "deepseek-flash"); assert.equal(ds.key, "k"); assert.equal(ds.local, false);
  const ol = resolveProvider({ ...base, provider: "ollama", model: "gpt-oss:20b" }, {});
  assert.equal(ol.root, "http://localhost:11434"); assert.equal(ol.base, "http://localhost:11434/v1"); assert.equal(ol.local, true); assert.equal(ol.key, undefined);
  assert.equal(resolveProvider({ ...base, provider: "ollama", baseUrl: "http://gpu-box:11434/v1/" }, {}).root, "http://gpu-box:11434", "with or without /v1, and a trailing slash");
  assert.equal(resolveProvider({ ...base, provider: "ollama", baseUrl: "http://192.168.1.20:11434" }, {}).local, true);
  assert.equal(resolveProvider({ ...base, provider: "ollama" }, {}).model, "", "no model is guessed for a local server");
  const cu = resolveProvider({ ...base, provider: "custom" }, { LLM_BASE_URL: "https://example.test/v1/", LLM_API_KEY: "x" });
  assert.equal(cu.base, "https://example.test/v1"); assert.equal(cu.local, false);
  assert.equal(resolveProvider({ ...base, provider: "custom", baseUrl: "http://localhost:1234/v1", model: "m" }, {}).local, true, "LM Studio and the like on this machine");
  assert.equal(resolveProvider({ ...base, timeoutSeconds: 1 }, {}).timeoutMs, 5000, "a floor on the wait");
});

test("provider settings are validated: choices must be offered, addresses must be addresses, text is trimmed", () => {
  assert.equal(setConfig("llmProvider", "ollama"), true); assert.equal(cfg("llmProvider"), "ollama");
  assert.equal(setConfig("llmProvider", "skynet"), false); assert.equal(cfg("llmProvider"), "ollama");
  assert.equal(setConfig("llmBaseUrl", "not a url"), false); assert.equal(setConfig("llmBaseUrl", "javascript:alert(1)"), false);
  assert.equal(setConfig("llmBaseUrl", "  http://localhost:11434  "), true); assert.equal(cfg("llmBaseUrl"), "http://localhost:11434");
  assert.equal(setConfig("llmBaseUrl", ""), true, "empty means the default");
  assert.equal(setConfig("llmModel", `  ${"x".repeat(500)} `), true); assert.equal(cfg("llmModel").length, 200);
  setConfig("llmModel", ""); setConfig("llmProvider", "deepseek");
  assert.ok(DEFS.filter((d) => d.group === "AI provider").every((d) => d.owner && d.applies === "immediate"), "listed in the registry like every parameter");
  assert.ok(Object.values(effective()).every((v) => ["number", "boolean", "string"].includes(typeof v)));
});

test("reasoning a model writes into its answer is kept apart from what River acts on", () => {
  assert.deepEqual(splitThinking("<think>hmm, left</think>Go left.", undefined), { content: "Go left.", reasoning: "hmm, left" });
  assert.deepEqual(splitThinking("still thinking</think>Done.", undefined), { content: "Done.", reasoning: "still thinking" });
  assert.equal(splitThinking("Plain answer.", "native reasoning").reasoning, "native reasoning");
  assert.deepEqual(splitThinking(null, undefined), { content: null, reasoning: undefined });
  assert.equal(splitThinking("<think>a</think>x<think>b</think>y", undefined).content, "xy");
});

/** A stand-in for an Ollama server: models list, OpenAI-style chat (with or without tool support), and what is loaded. */
function fakeOllama(o: { tools?: boolean; models?: string[]; ctx?: number; replyText?: string } = {}) {
  const seen: { path: string; auth?: string; body?: any }[] = [];
  const srv = http.createServer((req, res) => {
    let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined; seen.push({ path: req.url!, auth: req.headers.authorization, body });
      const send = (code: number, o: unknown) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      if (req.url === "/api/tags") return send(200, { models: (o.models ?? ["llama3:8b"]).map((name) => ({ name })) });
      if (req.url === "/api/ps") return send(200, { models: [{ name: "llama3:8b", model: "llama3:8b", context_length: o.ctx ?? 32768 }] });
      if (req.url === "/v1/chat/completions") {
        if (!(o.models ?? ["llama3:8b"]).some((m) => m === body.model || m === `${body.model}:latest`)) return send(404, { error: { message: `model '${body.model}' not found` } });
        if (body.tools && o.tools === false) return send(400, { error: { message: `registry.ollama.ai/library/${body.model} does not support tools` } });
        const calls = body.tools ? [{ id: "c1", type: "function", function: { name: "ping", arguments: JSON.stringify({ word: "ready" }) } }] : undefined;
        return send(200, { choices: [{ message: { role: "assistant", content: calls ? "" : o.replyText ?? "<think>ok</think>Hello.", tool_calls: calls }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
      }
      send(404, {});
    });
  });
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((r) => srv.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, seen, close: () => srv.close() })));
}

test("River can think through Ollama: the right address and model, no key sent, tool calls understood, reasoning set aside", async () => {
  const s = await fakeOllama();
  setConfig("llmProvider", "ollama"); setConfig("llmBaseUrl", s.url); setConfig("llmModel", "llama3:8b");
  const r = await chat({ messages: [{ role: "user", content: "hi" }], tools: [{ name: "ping", description: "d", input_schema: { type: "object", properties: { word: { type: "string" } } } }] });
  const call = s.seen.find((x) => x.path === "/v1/chat/completions")!;
  assert.equal(call.body.model, "llama3:8b"); assert.equal(call.auth, undefined, "a local server is not sent a key");
  assert.deepEqual(r.toolCalls, [{ id: "c1", name: "ping", args: { word: "ready" } }]);
  const plain = await chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(plain.text, "Hello."); assert.equal(plain.message.reasoning_content, "ok");
  s.close();
});

test("changing the setting changes where the next thought goes, with no restart", async () => {
  const a = await fakeOllama({ models: ["a:1"], replyText: "from A" }), b = await fakeOllama({ models: ["b:1"], replyText: "from B" });
  setConfig("llmProvider", "ollama"); setConfig("llmBaseUrl", a.url); setConfig("llmModel", "a:1");
  assert.equal((await chat({ messages: [{ role: "user", content: "x" }] })).text, "from A");
  setConfig("llmBaseUrl", b.url); setConfig("llmModel", "b:1");
  assert.equal((await chat({ messages: [{ role: "user", content: "x" }] })).text, "from B");
  a.close(); b.close();
});

test("problems say what to do: no model chosen, model not pulled, no tool support, server not running", async () => {
  const s = await fakeOllama({ tools: false });
  setConfig("llmProvider", "ollama"); setConfig("llmBaseUrl", s.url); setConfig("llmModel", "");
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }] }), /No model is chosen for Ollama/);
  setConfig("llmModel", "ghost:7b");
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }] }), /ollama pull ghost:7b/);
  setConfig("llmModel", "llama3:8b");
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }], tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }), /must support them/);
  s.close();
  setConfig("llmBaseUrl", "http://127.0.0.1:9");
  await assert.rejects(chat({ messages: [{ role: "user", content: "x" }] }), /Is Ollama running/);
});

test("the settings test finds the models, checks the chosen one answers and calls tools, and warns about a small context window", async () => {
  const good = await fakeOllama({ models: ["llama3:8b", "qwen3:14b"] });
  setConfig("llmProvider", "ollama"); setConfig("llmBaseUrl", good.url); setConfig("llmModel", "llama3:8b");
  assert.deepEqual((await listModels()).models, ["llama3:8b", "qwen3:14b"]);
  const ok = await testProvider(); assert.equal(ok.ok, true, JSON.stringify(ok.steps));
  assert.deepEqual(ok.steps.map((s) => s.name), ["Reach the server", "The model is there", "The model answers", "It can call tools", "Context window is big enough"]);
  good.close();
  const small = await fakeOllama({ ctx: 4096 }); setConfig("llmBaseUrl", small.url);
  const w = await testProvider(); assert.equal(w.ok, false);
  assert.match(w.steps.find((s) => s.name.startsWith("Context"))!.note, /OLLAMA_CONTEXT_LENGTH=/); small.close();
  const noTools = await fakeOllama({ tools: false }); setConfig("llmBaseUrl", noTools.url);
  const nt = await testProvider(); assert.equal(nt.ok, false); assert.ok(nt.steps.some((s) => !s.ok && /answers/.test(s.name)), JSON.stringify(nt.steps)); noTools.close();
  const wrong = await fakeOllama({ models: ["other:1"] }); setConfig("llmBaseUrl", wrong.url);
  const miss = await testProvider(); assert.match(miss.steps.at(-1)!.note, /not on the server.*ollama pull llama3:8b/); wrong.close();
  setConfig("llmBaseUrl", "http://127.0.0.1:9"); assert.match((await testProvider()).steps[0]!.note, /Cannot reach Ollama/);
});

test("a local model is not held to the hourly token budget unless asked; a hosted one always is", () => {
  setConfig("llmBaseUrl", ""); setConfig("llmProvider", "ollama"); setConfig("budgetLocal", false);
  assert.equal(budgetApplies(), false); assert.ok(maxTokensNow() > 1e8 && maxCyclesNow() > 1e8);
  setConfig("budgetLocal", true); assert.equal(budgetApplies(), true); assert.ok(maxTokensNow() < 1e8);
  setConfig("budgetLocal", false); setConfig("llmProvider", "deepseek");
  assert.equal(budgetApplies(), true); assert.ok(maxTokensNow() < 1e8);
});

test("the model the tool smith writes with can differ from River's", () => {
  setConfig("forgeModel", ""); assert.equal(forgeModelName(), undefined);
  setConfig("forgeModel", "qwen3-coder:30b"); assert.equal(forgeModelName(), "qwen3-coder:30b");
  setConfig("forgeModel", ""); void provider;
});
