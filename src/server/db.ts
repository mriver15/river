import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./migrate.ts";

export const DB_PATH = process.env.RIVER_DB ?? path.join("data", "river.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;   -- WAL + NORMAL survives a process crash intact; only a power cut can lose the last few commits
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  text TEXT NOT NULL, importance REAL NOT NULL, tags TEXT NOT NULL DEFAULT '',
  last_access INTEGER, access_count INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, tags, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.id, old.text, old.tags);
END;
CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, x REAL, z REAL, props TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, kind TEXT, name TEXT, desc TEXT, qty INTEGER, props TEXT);
CREATE TABLE IF NOT EXISTS desires (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL, outcome TEXT
);
CREATE TABLE IF NOT EXISTS interests (topic TEXT PRIMARY KEY, weight REAL NOT NULL, why TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tools (name TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, x REAL NOT NULL, z REAL NOT NULL, note TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tunes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, notes TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS compositions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL UNIQUE COLLATE NOCASE, spec TEXT NOT NULL, ts INTEGER NOT NULL, plays INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS moments (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, intensity REAL NOT NULL, emotions TEXT NOT NULL, x REAL, z REAL);
CREATE TABLE IF NOT EXISTS creatures (id TEXT PRIMARY KEY, species TEXT NOT NULL, trait TEXT NOT NULL, name TEXT, trust REAL NOT NULL DEFAULT 0, met INTEGER NOT NULL DEFAULT 0, last_seen INTEGER NOT NULL DEFAULT 0, alive INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, spec TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', x REAL, z REAL, ids TEXT NOT NULL DEFAULT '[]', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lives (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, born INTEGER NOT NULL, died INTEGER NOT NULL, days REAL NOT NULL, cause TEXT NOT NULL, x REAL, z REAL, summary TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS opinions (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL UNIQUE COLLATE NOCASE, stance TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL, strength INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS palette (name TEXT PRIMARY KEY COLLATE NOCASE, hex TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS works (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL, shape TEXT NOT NULL, size TEXT NOT NULL, materials TEXT NOT NULL, colors TEXT NOT NULL, color_names TEXT NOT NULL, x REAL, z REAL, entity TEXT);
CREATE TABLE IF NOT EXISTS journal (day INTEGER PRIMARY KEY, text TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS forged (
  name TEXT PRIMARY KEY, request_id INTEGER, status TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', log TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, name TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', custom INTEGER NOT NULL DEFAULT 0, note TEXT
);
`);

migrate(db);

export function kvGet<T>(k: string, fallback: T): T {
  const row = db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as T) : fallback;
}
export function kvSet(k: string, v: unknown) {
  db.prepare("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
}
