import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type DB = DatabaseSync;

// Each entry upgrades the schema by one version (tracked with PRAGMA user_version).
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('doc', 'code', 'workspace', 'page', 'component')),
    title TEXT NOT NULL,
    icon TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES files(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES files(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0,
    language TEXT,
    component_type TEXT,
    link_access TEXT NOT NULL DEFAULT 'none' CHECK (link_access IN ('none', 'view', 'comment', 'edit')),
    text_content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    trashed_at INTEGER
  );
  CREATE INDEX files_owner ON files(owner_id);
  CREATE INDEX files_workspace ON files(workspace_id);
  CREATE INDEX files_parent ON files(parent_id);

  CREATE TABLE file_members (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (file_id, user_id)
  );
  CREATE INDEX file_members_user ON file_members(user_id);

  -- Files a user has opened (drives "Recent" and "Shared with me" for link-shared files).
  CREATE TABLE file_visits (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visited_at INTEGER NOT NULL,
    PRIMARY KEY (file_id, user_id)
  );
  CREATE INDEX file_visits_user ON file_visits(user_id, visited_at);

  CREATE TABLE stars (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, file_id)
  );

  -- Persisted Yjs state, keyed by collaboration document name.
  CREATE TABLE ydocs (
    name TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    state BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX ydocs_file ON ydocs(file_id);

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name TEXT,
    auto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    state BLOB NOT NULL
  );
  CREATE INDEX versions_file ON versions(file_id, created_at);

  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

export function openDatabase(dataDir: string): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'titodocs.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/** Runs `fn` inside a transaction (nested calls join the outer transaction). */
export function transaction<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
