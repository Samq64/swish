// Session resolution and creation, shared by the API router and the
// server-rendered auth pages (login/register/logout).

import {
  sha256b64url,
  newSessionToken,
  readSessionCookie,
  SESSION_TTL_MS,
} from './auth.js';

/** The authenticated user for a request, or null. */
export async function resolveUser(env, request) {
  const token = readSessionCookie(request);
  if (!token) return null;
  const id = await sha256b64url(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.username, u.active_workspace_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return {
    id: row.user_id,
    username: row.username,
    activeWorkspaceId: row.active_workspace_id,
  };
}

/** Create a session row and return the raw token (to put in the cookie). */
export async function createSession(env, userId) {
  const token = newSessionToken();
  const id = await sha256b64url(token);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(id, userId, nowIso, new Date(now + SESSION_TTL_MS).toISOString()),
    // Opportunistically reap expired sessions (indexed by expires_at). Pages has
    // no cron trigger; a dedicated scheduled Worker would be the alternative.
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso),
  ]);
  return token;
}
