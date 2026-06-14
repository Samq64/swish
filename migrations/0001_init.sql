-- Initial schema for swish (Cloudflare D1 / SQLite).
--
-- Everything is scoped to a user. Workspaces belong to a user; projects, tags
-- and entries belong to a workspace; tags attach to entries via a join table.
-- Per-user settings (active workspace) live on the users row.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash             TEXT NOT NULL,      -- PBKDF2 derived bits, base64url
  pw_salt             TEXT NOT NULL,      -- base64url
  pw_iterations       INTEGER NOT NULL,
  active_workspace_id TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256(token), base64url
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE workspaces (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);
CREATE INDEX idx_ws_user ON workspaces(user_id);

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL
);
CREATE INDEX idx_proj_ws ON projects(workspace_id);

CREATE TABLE tags (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL
);
CREATE INDEX idx_tags_ws ON tags(workspace_id);

CREATE TABLE entries (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  description  TEXT NOT NULL DEFAULT '',
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  start        TEXT NOT NULL,            -- ISO 8601
  ended_at     TEXT                      -- NULL while running
);
-- Timeline range queries (workspace + start), plus a fast lookup of the
-- single open running entry regardless of range.
CREATE INDEX idx_entries_ws_start ON entries(workspace_id, start);
CREATE INDEX idx_entries_running  ON entries(workspace_id) WHERE ended_at IS NULL;

CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);
