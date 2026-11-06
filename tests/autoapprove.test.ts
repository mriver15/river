import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-autotest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const sim = await import("../src/server/sim.ts");
const { setConfig, cfg } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems } = await import("../src/server/runtime.ts");
const { requestTool, requests, isApproved, autoVerdict } = await import("../src/server/mind.ts");
const { setReplaying } = await import("../src/server/recorder.ts");
const { db } = await import("../src/server/db.ts");
const rt = await createRuntime();
startSystems(rt);
const status = (name: string) => requests().find((r) => r.name === name)!;
const settle = () => new Promise((r) => setTimeout(r, 30));
const clean = () => { db.exec("DELETE FROM tool_requests; DELETE FROM forged; DELETE FROM tools"); setConfig("autoApprove", "off"); setConfig("autoApproveWeb", false); setConfig("autoApproveMax", 3); setReplaying(false); };

test("the rules: what is approved on its own in each mode", () => {
  const o = { web: false, builtToday: 0, max: 3 };
  const builtin = { name: "craft", reason: "make things", custom: false }, web = { name: "web_search", reason: "find out", custom: false }, custom = { name: "whistle_maker", reason: "carve a whistle from reed", custom: true };
  assert.equal(autoVerdict(builtin, { ...o, mode: "off" }), null);
  assert.ok(autoVerdict(builtin, { ...o, mode: "catalog" })); assert.ok(autoVerdict(builtin, { ...o, mode: "all" }));
  assert.equal(autoVerdict(web, { ...o, mode: "all" }), null, "the internet waits unless the human says otherwise"); assert.ok(autoVerdict(web, { ...o, mode: "all", web: true }));
  assert.equal(autoVerdict(custom, { ...o, mode: "catalog" }), null, "a new tool needs 'everything'"); assert.ok(autoVerdict(custom, { ...o, mode: "all" }));
  assert.equal(autoVerdict(custom, { ...o, mode: "all", builtToday: 3 }), null, "and the daily limit holds");
  assert.equal(autoVerdict({ name: "grow_things", reason: "Plant a seed in the ground; it grows over a few minutes into a flower, bush or tree.", custom: true }, { ...o, mode: "all" })?.builtin, "plant", "a request for what already exists is granted that, not rebuilt");
});

test("off: every request waits for a human", async () => {
  clean(); requestTool("craft", "I want to make things."); await settle();
  assert.equal(status("craft").status, "pending"); assert.equal(isApproved("craft"), false);
});

test("built-in abilities: approved at once, granted, noted as automatic, and the web still waits", async () => {
  clean(); setConfig("autoApprove", "catalog");
  requestTool("craft", "I want to make things."); requestTool("web_search", "I wonder about the monolith."); requestTool("whistle_maker", "carve a whistle"); await settle();
  assert.equal(status("craft").status, "approved"); assert.match(status("craft").note ?? "", /^auto-approved/); assert.equal(isApproved("craft"), true);
  assert.equal(status("web_search").status, "pending"); assert.equal(isApproved("web_search"), false);
  assert.equal(status("whistle_maker").status, "pending", "a new tool still waits in this mode");
  setConfig("autoApproveWeb", true);                                                      // the sweep answers what was waiting
  assert.equal(status("web_search").status, "approved"); assert.equal(isApproved("web_search"), true);
});

test("everything: a new tool is approved and set going to be built; the day's limit holds", async () => {
  clean(); setConfig("autoApprove", "all"); setConfig("autoApproveMax", 1);
  requestTool("reed_whistle", "carve a whistle from reed and blow across it"); await settle();
  assert.equal(status("reed_whistle").status, "approved"); assert.match(status("reed_whistle").note ?? "", /auto-approved: a new tool/);
  assert.ok(db.prepare("SELECT 1 FROM forged WHERE name = 'reed_whistle'").get(), "the smith was asked to build it");
  requestTool("clay_stamp", "press a pattern into wet clay"); await settle();
  assert.equal(status("clay_stamp").status, "pending", "a second one waits: the limit for the day is one");
});

test("a request for something that exists is granted that ability, not built again", async () => {
  clean(); setConfig("autoApprove", "all");
  requestTool("grow_things", "Plant a seed in the ground; it grows over a few minutes into a flower, bush or tree."); await settle();
  assert.equal(status("grow_things").status, "approved"); assert.equal(isApproved("plant"), true); assert.match(status("grow_things").note ?? "", /already exists as "plant"/);
  assert.equal(db.prepare("SELECT 1 FROM forged WHERE name = 'grow_things'").get(), undefined, "nothing was built");
});

test("switching it on answers what is already waiting", async () => {
  clean(); requestTool("plant", "I want to plant."); requestTool("compose", "I want to make music."); await settle();
  assert.equal(requests().filter((r) => r.status === "pending").length, 2);
  setConfig("autoApprove", "catalog");
  assert.equal(requests().filter((r) => r.status === "pending").length, 0); assert.equal(isApproved("compose"), true);
});

test("a replay decides the same way but builds nothing: the smith is never called from a replay", async () => {
  clean(); setConfig("autoApprove", "all"); setReplaying(true);
  requestTool("moss_pillow", "stuff a pillow with moss"); await settle();
  assert.equal(status("moss_pillow").status, "approved", "the decision is repeated");
  assert.equal(db.prepare("SELECT 1 FROM forged WHERE name = 'moss_pillow'").get(), undefined, "but no model is called and nothing is written");
  setReplaying(false); clean(); void cfg; void sim;
});
