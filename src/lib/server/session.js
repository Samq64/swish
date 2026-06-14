// Session resolution/creation and the session cookie, shared by the API router,
// hooks, and the auth routes (login/register/logout).

import { dev } from '$app/environment';
import { sha256b64url, newSessionToken, SESSION_TTL_MS, COOKIE_NAME } from './auth.js';

const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  secure: !dev,
  sameSite: 'lax',
};

/** Resolve the user for a raw session token, or null. Reaps the row if expired. */
export async function resolveUser(env, token) {
  if (!token) return null;
  const id = await sha256b64url(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.username, u.active_workspace_id, u.theme, u.week_start
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
    theme: row.theme,
    weekStart: row.week_start,
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

/** Delete the session backing `token` (if any). */
export async function destroySession(env, token) {
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256b64url(token)).run();
}

export function setSessionCookie(cookies, token) {
  cookies.set(COOKIE_NAME, token, { ...COOKIE_OPTS, maxAge: Math.floor(SESSION_TTL_MS / 1000) });
}

export function clearSessionCookie(cookies) {
  cookies.delete(COOKIE_NAME, COOKIE_OPTS);
}
