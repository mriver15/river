import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.RIVER_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "river-gifttest-")), "t.db");
process.env.MOCK_LLM = "1"; process.env.EMBED_DISABLED = "1";
const { setConfig } = await import("../src/server/config.ts");
for (const [k, v] of Object.entries({ weather: false, ambientRate: 0, prey: false, smallWild: false, predators: false, fallRate: 0 })) setConfig(k, v as number | boolean);
const { createRuntime, startSystems, humanCommand } = await import("../src/server/runtime.ts");
const { takeLoose } = await import("../src/server/gathering.ts");
const { db } = await import("../src/server/db.ts");
const { Catalog } = await import("../src/server/catalog.ts");
const rt = await createRuntime(); startSystems(rt);
const w = rt.world;

test("a gift can be a real kind of thing, by any name the game knows it by", () => {
  assert.equal(Catalog.realKind("a stone")?.id, "stone");
  assert.equal(Catalog.realKind("Cord")?.id, "cord");
  assert.equal(Catalog.realKind("garment"), undefined, "things that need stats from being made cannot be conjured");
  assert.equal(Catalog.realKind("a brass key"), undefined);
});

test("a real gift is that thing, and the first time River takes up a gift is remembered once", () => {
  const before = (db.prepare("SELECT COUNT(*) n FROM memories WHERE tags LIKE '%gift%'").get() as any).n;
  humanCommand(rt, { t: "catalog_add", name: "", item: "stone", desc: "", place: true });
  const e = [...w.entities.values()].find((x) => x.props.catalog && String(x.props.catalog).startsWith("c_"))!;
  assert.ok(e, "the gift is in the world");
  assert.equal(e.props.item, "stone"); assert.equal(e.name, "stone");
  takeLoose(w, e);
  const after = (db.prepare("SELECT COUNT(*) n FROM memories WHERE tags LIKE '%gift%'").get() as any).n;
  assert.equal(after, before + 1);
  assert.equal((db.prepare("SELECT SUM(qty) n FROM life_deeds WHERE kind = 'gift'").get() as any).n, 1);
  humanCommand(rt, { t: "catalog_add", name: "a brass key", desc: "Warm.", place: true });
  const k = [...w.entities.values()].find((x) => x.name === "a brass key")!;
  assert.ok(k && k.props.item !== "stone", "a story object stays a story object");
});
