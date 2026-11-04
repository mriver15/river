// Generate isolated fixture databases for regression, migration and baseline work.
//   tsx scripts/make-fixtures.ts [outDir]     default outDir: .fixtures
// Each fixture is a fresh SQLite file created through the real schema (src/server/db.ts) with RIVER_DB pointing at the
// fixture. The generator refuses any output path inside data/, so it can never touch a live world.
// Content is fixed (no clock, no randomness) apart from the `born`/`ts` anchor, which is passed in via FIXTURE_NOW.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NOW = 1_700_000_000_000, MIN = 60_000, DAY = 24 * MIN;
const NAMES = ["new-life", "injury", "fire", "crafting", "animals", "grants"] as const;
type Name = (typeof NAMES)[number];

async function seed(name: Name) {
  const { db, kvSet } = await import("../src/server/db.ts");
  const ent = (id: string, kind: string, nm: string, x: number, z: number, props: object = {}) =>
    db.prepare("INSERT INTO entities(id,kind,name,x,z,props) VALUES(?,?,?,?,?,?)").run(id, kind, nm, x, z, JSON.stringify(props));
  const inv = (id: string, kind: string, nm: string, desc: string, qty: number, props: object = {}) =>
    db.prepare("INSERT INTO inventory(id,kind,name,desc,qty,props) VALUES(?,?,?,?,?,?)").run(id, kind, nm, desc, qty, JSON.stringify(props));
  const body = (extra: object) => kvSet("body", { health: 100, infection: 0, born: NOW - 2 * DAY, dead: null, injuries: [], strain: 0, ailment: null, walked: 0, next: 1, ...extra });

  kvSet("seed", 12345); kvSet("epoch", NOW - 0.3 * DAY - 2 * DAY); kvSet("agent", { x: 0, z: 0, heading: 0, needs: { energy: 90, hunger: 70, mood: 60, curiosity: 70, warmth: 75 }, name: "River" });
  ent("tree_1", "tree", "oak", 6, 4); ent("tree_2", "tree", "birch", -5, 8); ent("rock_1", "rock", "granite boulder", 10, -3);
  kvSet("nextId", 100);

  switch (name) {
    case "new-life": body({ born: NOW }); break;
    case "injury":
      body({ health: 62, infection: 0.2, next: 3, injuries: [
        { id: 1, kind: "claw", part: "forearm", side: "left", sev: 0.6, born: NOW - 20 * MIN, heal: 40 * MIN, cause: "a fox", bleed: 0.4 },
        { id: 2, kind: "sprain", part: "ankle", side: "right", sev: 0.5, born: NOW - 5 * MIN, heal: 30 * MIN, cause: "a fall", bleed: 0 }] });
      break;
    case "fire":
      body({});
      ent("tree_3", "tree", "dry oak", 3, 3, { burning: { since: NOW - 10_000, ends: NOW + 60_000 } });
      ent("camp_1", "campfire", "campfire", 1, 1, {});
      kvSet("weather", { w: "windy", until: NOW + 10 * MIN });
      break;
    case "crafting":
      body({});
      inv("inv_1", "stick", "stick", "A straight stick.", 4); inv("inv_2", "stone", "flint", "A sharp stone.", 2);
      inv("inv_3", "bark", "birch bark", "Peels in strips.", 3); inv("inv_4", "spear", "stone-tipped spear", "Made by River.", 1, { crafted: true });
      ent("struct_1", "structure", "lean-to", 4, -6, { flammable: true });
      db.prepare("INSERT INTO works(ts,name,shape,size,materials,colors,color_names,x,z,entity) VALUES(?,?,?,?,?,?,?,?,?,?)").run(NOW - DAY, "lean-to", "shelter", "small", "[]", "[]", "[]", 4, -6, "struct_1");
      break;
    case "animals":
      body({});
      for (const [id, sp, tr, nm, trust, alive] of [["cr_1", "fox", "bold", "Ember", 0.7, 1], ["cr_2", "deer", "skittish", null, 0.1, 1], ["cr_3", "rabbit", "curious", "Pip", 0.9, 0]] as const)
        db.prepare("INSERT INTO creatures(id,species,trait,name,trust,met,last_seen,alive) VALUES(?,?,?,?,?,?,?,?)").run(id, sp, tr, nm, trust, 1, NOW - MIN, alive);
      ent("animal_1", "animal", "fox", 7, 7, { creature: "cr_1" });
      break;
    case "grants":
      body({});
      for (const t of ["fire", "weave", "dig"]) db.prepare("INSERT INTO tools(name,approved) VALUES(?,1)").run(t);
      db.prepare("INSERT INTO tools(name,approved) VALUES('stargaze',0)").run();
      db.prepare("INSERT INTO tool_requests(ts,name,reason,status,custom) VALUES(?,?,?,?,0)").run(NOW - MIN, "fire", "to stay warm", "approved");
      db.prepare("INSERT INTO tool_requests(ts,name,reason,status,custom) VALUES(?,?,?,?,0)").run(NOW - MIN, "stargaze", "to look up", "pending");
      break;
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

function main() {
  const out = path.resolve(process.argv[2] ?? ".fixtures");
  const live = path.resolve("data") + path.sep;
  if ((out + path.sep).startsWith(live)) throw new Error(`refusing to write fixtures inside ${live}`);
  fs.mkdirSync(out, { recursive: true });
  for (const name of NAMES) {
    const file = path.join(out, `${name}.db`);
    for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
    const r = spawnSync(process.execPath, ["--import", "tsx", process.argv[1]!, "--seed", name], { env: { ...process.env, RIVER_DB: file }, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`fixture ${name} failed`);
    console.log(`fixture ${name} -> ${file}`);
  }
}

if (process.argv[2] === "--seed") {
  if (path.resolve(process.env.RIVER_DB ?? "data/river.db").startsWith(path.resolve("data") + path.sep)) throw new Error("RIVER_DB points into data/");
  seed(process.argv[3] as Name).catch((e) => { console.error(e); process.exit(1); });
} else main();
