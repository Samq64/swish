// Shared read queries used by both the JSON API (+server.js) and the page's
// server `load`, so the two never drift. Each returns rows already mapped to
// the client-facing shape.

export async function listWorkspaces(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, name FROM workspaces WHERE user_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(userId)
    .all();
  return results.map((w) => ({ id: w.id, name: w.name }));
}

export async function listProjects(env, workspaceId) {
  const { results } = await env.DB.prepare(
    'SELECT id, workspace_id, name, color FROM projects WHERE workspace_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(workspaceId)
    .all();
  return results.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, color: r.color }));
}

export async function listTags(env, workspaceId) {
  const { results } = await env.DB.prepare(
    'SELECT id, workspace_id, name FROM tags WHERE workspace_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(workspaceId)
    .all();
  return results.map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name }));
}
