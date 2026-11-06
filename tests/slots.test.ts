import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveSlot, listSlots, restoreSlot, deleteSlot, slotName } from "../src/server/slots.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "river-slots-"));
const src = path.join(dir, "world.db");
{ const d = new DatabaseSync(src); d.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT); CREATE TABLE lives (id INTEGER); INSERT INTO lives VALUES (1);");
  const kv = (k: string, v: unknown) => d.prepare("INSERT INTO kv VALUES (?,?)").run(k, JSON.stringify(v));
  kv("sim", { base: 1_000_000, tick: 14_400 * 2 + 5 }); kv("epoch", 1_000_000 - 100); kv("epochOnSim", true); kv("seed", 7); d.close(); }
const slots = path.join(dir, "slots");

test("a slot is a complete, described copy, and names are kept tidy", async () => {
  assert.equal(slotName("  Before the  storm! "), "Before-the-storm");
  const m = await saveSlot(src, slots, "Before the storm", { note: "calm" });
  assert.equal(m.name, "Before-the-storm"); assert.equal(m.day, 3); assert.equal(m.lives, 2); assert.equal(m.seed, 7);
  assert.equal(listSlots(slots).length, 1);
  assert.equal((new DatabaseSync(path.join(slots, "Before-the-storm.db"), { readOnly: true }).prepare("SELECT COUNT(*) n FROM lives").get() as any).n, 1);
});

test("a slot is not overwritten by accident, and can be restored and deleted", async () => {
  await assert.rejects(saveSlot(src, slots, "Before the storm"), /already a slot/);
  await saveSlot(src, slots, "Before the storm", { overwrite: true });
  const dest = path.join(dir, "restored.db");
  await restoreSlot(slots, "Before the storm", dest);
  assert.ok(fs.existsSync(dest));
  await assert.rejects(restoreSlot(slots, "Before the storm", dest), /--force/);
  await restoreSlot(slots, "Before the storm", dest, true);
  await assert.rejects(restoreSlot(slots, "nope", dest, true), /no slot/);
  deleteSlot(slots, "Before the storm"); assert.equal(listSlots(slots).length, 0);
  await assert.rejects(saveSlot(src, slots, "!!!"), /needs a name/);
});
