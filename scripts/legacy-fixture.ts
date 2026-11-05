// A database as the old version left it: the pre-migration schema (tests/fixtures/legacy-schema.sql, from commit d320b69), a world with
// things on the ground, a pack with stacks and a made thing, clothes worn, tool grants, a forged plugin, creatures, memories.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const NOW = 1_700_000_000_000, MIN = 60_000, DAY = 24 * MIN;
export function makeLegacyDb(file: string) {
  for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true });
  const db = new DatabaseSync(file);
  const sql = fs.readFileSync(new URL("../tests/fixtures/legacy-schema.sql", import.meta.url), "utf8").split(/;\s*\n(?=CREATE|--)/).map((s) => s.trim().replace(/;$/, "")).filter((s) => s && !s.startsWith("--"));
  for (const s of sql.filter((x) => !/^CREATE TRIGGER/i.test(x))) db.exec(s);
  for (const s of sql.filter((x) => /^CREATE TRIGGER/i.test(x))) db.exec(s);
  const kv = (k: string, v: unknown) => db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run(k, JSON.stringify(v));
  kv("seed", 4242); kv("epoch", NOW - 0.3 * DAY - 3 * DAY); kv("nextId", 500);
  kv("agent", { x: 2, z: 3, heading: 0, needs: { energy: 70, hunger: 55, mood: 60, curiosity: 65, warmth: 70 }, name: "River" });
  kv("body", { health: 100, infection: 0, born: NOW - 3 * DAY, dead: null, injuries: [], strain: 0, ailment: null, walked: 0, next: 1 });
  kv("weather", { w: "clear", until: NOW + 10 * MIN });
  kv("worn", [{ slot: "body", garment: "wrap", name: "bark wrap", hex: "#7a6246", warm: 0.18, desc: "bark wrap (brown wrap)" }]);
  const ent = db.prepare("INSERT INTO entities(id,kind,name,x,z,props) VALUES(?,?,?,?,?,?)");
  ent.run("tree_1", "tree", "oak", 6, 4, "{}"); ent.run("rock_1", "rock", "granite boulder", 10, -3, "{}");
  ent.run("struct_1", "structure", "lean-to", 4, -6, JSON.stringify({ flammable: true, shape: "shelter" }));
  ent.run("item_old", "item", "old bottle", 1, 1, JSON.stringify({ takeable: true, item: "bottle", itemName: "old bottle", desc: "A glass bottle." }));
  ent.run("item_stick", "item", "stick", 2, 2, JSON.stringify({ takeable: true, item: "stick", itemName: "stick", desc: "A stick.", qty: 3 }));
  ent.run("animal_1", "animal", "fox", 7, 7, JSON.stringify({ creature: "cr_1", species: "fox" }));
  const inv = db.prepare("INSERT INTO inventory(id,kind,name,desc,qty,props) VALUES(?,?,?,?,?,?)");
  inv.run("inv_1", "stick", "stick", "A straight stick.", 4, null); inv.run("inv_2", "berry", "wild berry", "A berry.", 2, null);
  inv.run("inv_3", "spear", "stone-tipped spear", "Made by River.", 1, JSON.stringify({ crafted: true }));
  db.prepare("INSERT INTO creatures(id,species,trait,name,trust,met,last_seen,alive) VALUES(?,?,?,?,?,?,?,?)").run("cr_1", "fox", "bold", "Ember", 0.7, 3, NOW - MIN, 1);
  for (const t of ["fire", "weave", "dig"]) db.prepare("INSERT INTO tools(name,approved) VALUES(?,1)").run(t);
  db.prepare("INSERT INTO tools(name,approved) VALUES('stargaze',0)").run();
  db.prepare("INSERT INTO tool_requests(ts,name,reason,status,custom) VALUES(?,?,?,?,0)").run(NOW - MIN, "fire", "to stay warm", "approved");
  db.prepare("INSERT INTO forged(name,request_id,status,code,log,ts) VALUES(?,?,?,?,?,?)").run("legacy_forged", 7, "installed", "// a plugin written by the old tool smith\nexport default {};", "Installed.", NOW - DAY);
  db.prepare("INSERT INTO tools(name,approved) VALUES('legacy_forged',1)").run();
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO memories(ts,kind,text,importance,tags) VALUES(?,?,?,?,?)").run(NOW - i * MIN, "episodic", `A memory of something that happened, number ${i}.`, 3 + (i % 5), "tag");
  for (let i = 0; i < 30; i++) db.prepare("INSERT INTO events(ts,kind,text) VALUES(?,?,?)").run(NOW - i * MIN, i % 3 ? "action" : "world", `legacy event ${i}`);
  db.prepare("INSERT INTO works(ts,name,shape,size,materials,colors,color_names,x,z,entity) VALUES(?,?,?,?,?,?,?,?,?,?)").run(NOW - DAY, "lean-to", "shelter", "small", "[]", "[]", "[]", 4, -6, "struct_1");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close();
}
