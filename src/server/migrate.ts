// Versioned schema migrations. Each runs once, in order, inside a transaction, and is recorded in sim_migrations.
// Add new migrations to the end of MIGRATIONS; never edit or reorder an applied one.
import type { DatabaseSync } from "node:sqlite";

export interface Migration { id: string; description: string; up: (db: DatabaseSync) => void }

const hasColumn = (db: DatabaseSync, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
const addColumn = (db: DatabaseSync, table: string, col: string, decl: string) => {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
};

export const MIGRATIONS: Migration[] = [
  { id: "0001_baseline", description: "Tables created by db.ts before the migration framework existed", up: () => {} },
  {
    id: "0002_legacy_columns", description: "Columns formerly added by swallowed ALTER TABLE statements",
    up: (db) => {
      addColumn(db, "memories", "embedding", "BLOB");
      addColumn(db, "memories", "x", "REAL");
      addColumn(db, "memories", "z", "REAL");
      addColumn(db, "tool_requests", "matches", "TEXT");
      addColumn(db, "tool_requests", "match_score", "REAL");
    },
  },
  {
    id: "0003_replay_tables", description: "Command journal, checkpoint hashes and boot snapshots for replay",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sim_commands (seq INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, source TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', result TEXT);
        CREATE TABLE IF NOT EXISTS sim_checkpoints (tick INTEGER PRIMARY KEY, hash TEXT NOT NULL, parts TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sim_snapshots (tick INTEGER PRIMARY KEY, file TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      `);
    },
  },
  {
    id: "0004_command_ids", description: "Idempotency key on journaled commands",
    up: (db) => {
      addColumn(db, "sim_commands", "command_id", "TEXT");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS sim_commands_command_id ON sim_commands(command_id) WHERE command_id IS NOT NULL");
    },
  },
  {
    id: "0005_activities_and_knowledge", description: "Persisted activities, and the entities River has seen",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sim_activities (
          id TEXT PRIMARY KEY, gen INTEGER NOT NULL, def TEXT NOT NULL, def_version TEXT NOT NULL, status TEXT NOT NULL, intent TEXT NOT NULL,
          source TEXT NOT NULL, params TEXT NOT NULL, step TEXT NOT NULL, progress TEXT NOT NULL, started_tick INTEGER NOT NULL,
          deadline_tick INTEGER NOT NULL, reservations TEXT NOT NULL, outcome TEXT, ended_tick INTEGER
        );
        CREATE TABLE IF NOT EXISTS known_entities (id TEXT PRIMARY KEY, tick INTEGER NOT NULL);
      `);
    },
  },
  {
    id: "0006_blobs", description: "Binary state committed with the clock (grids)",
    up: (db) => { db.exec("CREATE TABLE IF NOT EXISTS sim_blobs (k TEXT PRIMARY KEY, v BLOB NOT NULL)"); },
  },
  {
    id: "0007_brain_decisions", description: "A log of what woke River's mind and what it cost",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS brain_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, wall_ts INTEGER NOT NULL, kinds TEXT NOT NULL, priority INTEGER NOT NULL,
        calls INTEGER NOT NULL, in_tokens INTEGER NOT NULL, out_tokens INTEGER NOT NULL, cache_tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
        packet_tokens INTEGER NOT NULL, tools TEXT NOT NULL, dropped TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
      )`);
    },
  },
  {
    id: "0008_item_instances", description: "Every item as an instance with one identity, a condition, a provenance and one location",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS item_instances (
          id TEXT PRIMARY KEY, def_id TEXT NOT NULL, def_version TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, desc TEXT NOT NULL, qty INTEGER NOT NULL,
          props TEXT NOT NULL, durability REAL NOT NULL, wetness REAL NOT NULL, temp REAL NOT NULL, parts TEXT NOT NULL, prov TEXT NOT NULL, visual TEXT NOT NULL,
          loc_kind TEXT NOT NULL, loc_a TEXT, loc_x REAL, loc_z REAL, lineage TEXT NOT NULL, named INTEGER NOT NULL DEFAULT 0, created_tick INTEGER NOT NULL, ended_tick INTEGER,
          created_seq INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS item_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, item TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS item_events_item ON item_events(item);
      `);
    },
  },
  {
    id: "0009_mind_trace", description: "Why a feeling moved: cause, factors, before and after; and what River observed",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mind_trace (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, kind TEXT NOT NULL, emotion TEXT, subject TEXT, event_id TEXT,
          prior REAL, delta REAL, result REAL, why TEXT NOT NULL DEFAULT '', data TEXT
        );
        CREATE INDEX IF NOT EXISTS mind_trace_event ON mind_trace(event_id);
      `);
    },
  },
  {
    id: "0010_parameter_sets", description: "Immutable parameter sets, which one was in force when, and which one each boot snapshot used",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sim_param_sets (hash TEXT PRIMARY KEY, ruleset TEXT NOT NULL, json TEXT NOT NULL, first_tick INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sim_param_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER NOT NULL, hash TEXT NOT NULL, cause TEXT NOT NULL);
      `);
      addColumn(db, "sim_snapshots", "param_set", "TEXT");
    },
  },
];

export interface MigrationReport { applied: string[]; alreadyApplied: string[] }

export function migrate(db: DatabaseSync, migrations = MIGRATIONS): MigrationReport {
  db.exec("CREATE TABLE IF NOT EXISTS sim_migrations (id TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM sim_migrations").all() as { id: string }[]).map((r) => r.id));
  const report: MigrationReport = { applied: [], alreadyApplied: [] };
  for (const m of migrations) {
    if (done.has(m.id)) { report.alreadyApplied.push(m.id); continue; }
    db.exec("BEGIN");
    try {
      m.up(db);
      db.prepare("INSERT INTO sim_migrations(id, description, applied_at) VALUES(?,?,?)").run(m.id, m.description, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${m.id} failed: ${(e as Error).message}`);
    }
    report.applied.push(m.id);
  }
  return report;
}
