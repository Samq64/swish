-- Teams & workspace sharing.
--
-- A team has one manager (its creator), who invites others by username. An
-- invitee accepts to become an active member. A user belongs to at most one
-- team at a time (enforced below). Joining a team shares all your workspaces
-- with the manager by default; an owner can hide individual workspaces with the
-- per-workspace `shared` flag. The manager gets read-only visibility — writes
-- always stay with the workspace owner.

PRAGMA foreign_keys = ON;

CREATE TABLE teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE team_members (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,            -- 'invited' | 'active'
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
-- Reverse lookup: a user's memberships (their active team + any pending invites).
CREATE INDEX idx_team_members_user ON team_members(user_id);
-- One active team per user: pending invites from several teams are allowed, but
-- a user can be an active member of only one team at a time.
CREATE UNIQUE INDEX idx_one_active_team ON team_members(user_id) WHERE status = 'active';

-- Whether the owner shares this workspace with their team (read-only). On by
-- default: joining a team exposes all your workspaces unless you hide them here.
ALTER TABLE workspaces ADD COLUMN shared INTEGER NOT NULL DEFAULT 1;
