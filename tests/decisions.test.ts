import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// A scripted model on localhost, so each behaviour is checked without a live model's moods.
interface Req { messages: any[]; tools: any[]; at: number }
const requests: Req[] = [];
let script: (n: number, req: Req) => { status?: number; delay?: number; tool_calls?: { name: string; args: object }[]; text?: string } = () => ({ text: "Nothing to do." });
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d));
  req.on("end", () => {
    const j = JSON.parse(body), r: Req = { messages: j.messages, tools: j.tools ?? [], at: Date.now() }; requests.push(r);
    const out = script(requests.length, r);
    setTimeout(() => {
      if (out.status) { res.statusCode = out.status; return void res.end("boom"); }
      const calls = (out.tool_calls ?? []).map((c, i) => ({ id: `call_${requests.length}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: out.text ?? null, tool_calls: calls.length ? calls : undefined }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 100 } }));
    }, out.delay ?? 0);
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.LLM_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-dectest-")), "t.db");
delete process.env.MOCK_LLM; process.env.EMBED_DISABLED = "1";

const sim = await import("../src/server/sim.ts");
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, needsRate: 0, fallRate: 0, thinkSeconds: 8 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { db } = await import("../src/server/db.ts");
const { record, maxTokensNow, usageStats } = await import("../src/server/usage.ts");
const { beginGeneration, discardedTotal } = await import("../src/server/lifecycle.ts");
const { estimateTokens } = await import("../src/brain/packet.ts");

const rt = await createRuntime();
startSystems(rt);
sim.setSimSpeed(20);                                             // a 30 s rest takes 1.5 s of wall time
sim.start();
void rt.agent.run();
const wait = async (cond: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 15)); } };
const decisions = () => db.prepare("SELECT * FROM brain_decisions ORDER BY id").all() as any[];

test("while an activity runs, the model is not called; the next call comes only when something warrants it", async () => {
  script = (n) => (n === 1 ? { tool_calls: [{ name: "rest", args: { seconds: 30 } }] } : { text: "Rested; nothing more for now." });
  await wait(() => requests.length >= 1);
  const at = requests.length;
  await wait(() => rt.activities.cur?.def === "rest");
  const during: number[] = [];
  const t0 = Date.now(); while (rt.activities.cur) { during.push(requests.length); await new Promise((r) => setTimeout(r, 20)); if (Date.now() - t0 > 6000) break; }
  assert.ok(during.length > 10, "the rest lasted a while");
  assert.ok(during.every((n) => n === at), "no model call at any point while resting");
  await wait(() => decisions().length >= 2);                      // afterwards, a quiet moment wakes it again
  assert.equal(decisions()[1]?.kinds.split(",")[0], "idle");
});

test("a threat and a human voice are taken before everything else, whatever order they arrive in", async () => {
  script = (n) => (n === requests.length && requests.length === n ? { delay: 400, text: "Thinking." } : { text: "ok" });
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  const before = decisions().length;
  rt.agent.notify("a bird landed nearby", true, "novelty");
  rt.agent.notify("## Voice from outside\nA human speaks to you: \"hello\"", true, "contact");
  rt.agent.notify("A wolf is charging you!", true, "danger");
  await wait(() => decisions().length > before);
  const first = decisions()[before]!;
  assert.deepEqual(first.kinds.split(",").slice(0, 3), ["danger", "contact", "novelty"], "one decision answers all three, most urgent first");
  assert.equal(first.priority, 0);
  const lastUser = requests[requests.length - 1]!.messages.find((m) => m.role === "user").content as string;
  assert.ok(lastUser.includes("A wolf is charging you!") && lastUser.includes("hello"), "danger and the human's words are in the packet in full");
});

test("what River is shown stays within its budget, and costs far less than a transcript would", async () => {
  for (let i = 0; i < 80; i++) rt.world.addItem("stick", `stick ${i}`, "A stick.", 1);
  script = () => ({ text: "ok" });
  const before = requests.length;
  rt.agent.notify("Something happened.", true, "failure");
  await wait(() => requests.length > before);
  const user = requests[requests.length - 1]!.messages.find((m) => m.role === "user").content as string;
  assert.ok(estimateTokens(user) <= 7000, `the packet is ${estimateTokens(user)} tokens`);
  assert.equal(requests[requests.length - 1]!.messages.length, 2, "a fresh summary, not a growing conversation");
});

test("an action ends the decision; an information tool allows one follow-up, then the call limit holds", async () => {
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  let n0 = requests.length;
  script = (n) => (n - n0 <= 5 ? { tool_calls: [{ name: "look", args: {} }] } : { text: "done" });
  rt.agent.notify("Something happened.", true, "failure");
  await wait(() => decisions().at(-1)?.calls >= 3 && !rt.world.me.thinking);
  assert.equal(decisions().at(-1)!.calls, 3, "three calls (maxSteps), no more, even though the model kept asking to look");
});

test("a reply with several actions runs them in order and stops at the first that fails", async () => {
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  let n0 = requests.length;
  script = (n) => (n === n0 + 1 ? { tool_calls: [{ name: "pick_up", args: { id: "no_such_thing" } }, { name: "say", args: { text: "should not be said" } }] } : { text: "ok" });
  rt.agent.notify("Something happened.", true, "failure");
  await wait(() => requests.length > n0 && !rt.world.me.thinking);
  const tools = decisions().at(-1)!.tools as string;
  assert.match(tools, /pick_up✗/); assert.ok(!db.prepare("SELECT 1 FROM events WHERE kind='speech' AND text LIKE '%should not be said%'").get(), "the second action was skipped");
});

test("a failing provider is retried without doing anything twice, and a late answer from a previous life changes nothing", async () => {
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  let n0 = requests.length;
  script = (n) => (n < n0 + 3 ? { status: 500 } : { tool_calls: [{ name: "say", args: { text: "hello after retries" } }] });
  rt.agent.notify("Something happened.", true, "failure");
  await wait(() => requests.length >= n0 + 3, 20_000);
  await wait(() => !rt.world.me.thinking, 20_000);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='speech' AND text LIKE '%hello after retries%'").get() as any).n <= 1, true);

  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  n0 = requests.length;
  script = (n) => (n === n0 + 1 ? { delay: 900, tool_calls: [{ name: "say", args: { text: "a stale thought" } }] } : { text: "ok" });
  const dropped = discardedTotal();
  rt.agent.notify("Something happened.", true, "failure");
  await wait(() => requests.length > n0);
  beginGeneration();                                              // a new life begins while the answer is still on its way
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!db.prepare("SELECT 1 FROM events WHERE kind='speech' AND text LIKE '%a stale thought%'").get(), "the late answer did nothing");
  assert.ok(discardedTotal() >= dropped, "and is recorded as discarded");
});

test("an empty allowance: ordinary decisions wait, a human's words still get through the reserve, and the world waits only if told to", async () => {
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking);
  setConfig("budgetPause", false); setConfig("reservePct", 20); setConfig("tokensK", 100);
  record({ prompt_tokens: Math.round(maxTokensNow() * 0.9) - usageStats().tokensLastHour, completion_tokens: 0 }, { consumer: "other" });   // exactly 90% of the hour: past the ordinary line (80%), inside the reserve
  const n0 = requests.length; script = () => ({ text: "ok" });
  rt.agent.notify("a quiet moment", true, "completion");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(requests.length, n0, "an ordinary decision is held back");
  assert.equal(sim.simPaused(), false, "and with the freeze off, the world carries on");
  rt.agent.notify("## Voice from outside\nA human speaks to you: \"are you there?\"", true, "contact");
  await wait(() => requests.length > n0);
  assert.ok(requests.length > n0, "a human's words use the reserve");
  setConfig("budgetPause", true);
  rt.agent.notify("another ordinary matter", true, "failure");
  await wait(() => sim.simPaused(), 4000);
  assert.ok(sim.simPaused(), "with the freeze on, the world waits at the decision");
  sim.setSimPaused(false);
});

test("a pressing need wakes the mind once as it falls, not once per tick", async () => {
  setConfig("tokensK", 6000); setConfig("budgetPause", false);
  record({ prompt_tokens: -usageStats().tokensLastHour, completion_tokens: 0 }, { consumer: "other" });   // clear the earlier test's spending
  rt.agent.wake();                                               // the brain was waiting for the budget; let it look again now
  await wait(() => rt.agent["queue"].size === 0 && !rt.world.me.thinking).catch((e) => { throw new Error(`${e.message}: queue=${JSON.stringify(rt.agent.brainView().queue)} budget=${JSON.stringify(rt.agent.brainView().budget)} thinking=${rt.world.me.thinking} worldPaused=${sim.simPaused()} tick=${sim.simTick()} lastDecisions=${JSON.stringify(decisions().slice(-3).map((d) => d.kinds))}`); });
  rt.world.me.needs.energy = 50; await new Promise((r) => setTimeout(r, 300));
  script = () => ({ text: "ok" });
  const before = decisions().filter((d) => d.kinds.includes("need")).length;
  rt.world.me.needs.energy = 12;                                  // falls below the line, and stays low for a long while
  await wait(() => decisions().filter((d) => d.kinds.includes("need")).length > before).catch((e) => { throw new Error(`${e.message}: queue=${JSON.stringify(rt.agent.brainView().queue)} budget=${JSON.stringify(rt.agent.brainView().budget)} thinking=${rt.world.me.thinking} paused=${rt.agent.paused} worldPaused=${sim.simPaused()} energy=${rt.world.me.needs.energy} watch=${JSON.stringify(rt.agent["needWatch"])} idleAt=${rt.agent["idleAt"]} tick=${sim.simTick()} all=${JSON.stringify(decisions().map((d) => d.kinds + "@" + d.tick))} before=${before}`); });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(decisions().filter((d) => d.kinds.includes("need")).length, before + 1, "one decision for the dip, though it stayed low");
});

// The brain's loop never ends on its own; stop the process once the results are in.
after(() => { sim.stop(); server.closeAllConnections?.(); server.close(); setTimeout(() => process.exit(0), 200); });
