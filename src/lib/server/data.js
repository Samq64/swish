// Shared read queries used by both the JSON API (+server.js) and the page's
// server `load`, so the two never drift. Each returns rows already mapped to
// the client-facing shape.

export async function listWorkspaces(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, shared FROM workspaces WHERE user_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(userId)
    .all();
  return results.map((w) => ({ id: w.id, name: w.name, shared: w.shared !== 0 }));
}

export async function listProjects(env, workspaceId) {
  const { results } = await env.DB.prepare(
    'SELECT id, workspace_id, name, color FROM projects WHERE workspace_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(workspaceId)
    .all();
  return results.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    color: r.color,
  }));
}

export async function listTags(env, workspaceId) {
  const { results } = await env.DB.prepare(
    'SELECT id, workspace_id, name FROM tags WHERE workspace_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(workspaceId)
    .all();
  return results.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name }));
}

// The caller's role on their (single) active team: 'manager' | 'member' | null.
// Used to decide whether to surface the per-workspace "Shared" toggle.
export async function getActiveTeamRole(env, userId) {
  const row = await env.DB.prepare(
    `SELECT t.manager_id FROM team_members m JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = ? AND m.status = 'active'`,
  )
    .bind(userId)
    .first();
  if (!row) return null;
  return row.manager_id === userId ? 'manager' : 'member';
}

// Workspaces shared *with* `userId`: every shared workspace owned by an active
// member of a team `userId` manages. Includes the owner's username so the UI can
// group "shared with me" workspaces under the person they belong to. The
// manager's own workspaces are excluded — those are theirs, not "shared with".
export async function listSharedWorkspaces(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, owner.username AS owner_username
       FROM teams t
       JOIN team_members m ON m.team_id = t.id AND m.status = 'active'
       JOIN workspaces w   ON w.user_id = m.user_id AND w.shared = 1
       JOIN users owner    ON owner.id = w.user_id
      WHERE t.manager_id = ? AND m.user_id != ?
      ORDER BY owner.username COLLATE NOCASE, w.name COLLATE NOCASE`,
  )
    .bind(userId, userId)
    .all();
  return results.map((w) => ({ id: w.id, name: w.name, ownerUsername: w.owner_username }));
}
