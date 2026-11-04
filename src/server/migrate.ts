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
