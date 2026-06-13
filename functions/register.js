// /register — server-rendered sign-up page (GET) and form handler (POST).

import { hashPassword, sessionCookie } from './_lib/auth.js';
import { resolveUser, createSession } from './_lib/session.js';
import { renderAuthPage, htmlResponse, redirect } from './_lib/authPage.js';
import { sameOrigin } from './_lib/http.js';

export async function onRequestGet({ env, request }) {
  if (await resolveUser(env, request)) return redirect('/');
  return htmlResponse(renderAuthPage({ mode: 'register' }));
}

export async function onRequestPost({ env, request }) {
  const fail = (error, status, username) =>
    htmlResponse(renderAuthPage({ mode: 'register', error, username }), status);

  if (!sameOrigin(request)) return fail('Bad origin.', 403, '');

  const form = await request.formData();
  const username = (form.get('username') ?? '').toString().trim();
  const password = (form.get('password') ?? '').toString();

  if (username.length < 3 || username.length > 32)
    return fail('Username must be 3–32 characters.', 400, username);
  if (password.length < 8)
    return fail('Password must be at least 8 characters.', 400, username);

  const existing = await env.DB.prepare('SELECT 1 AS ok FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (existing) return fail('That username is already taken.', 409, username);

  const pw = await hashPassword(password, env.PEPPER);
  const userId = crypto.randomUUID();
  const wsId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, pw_hash, pw_salt, pw_iterations, active_workspace_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(userId, username, pw.hash, pw.salt, pw.iterations, wsId, new Date(Date.now()).toISOString()),
    env.DB.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').bind(wsId, userId, 'Personal'),
  ]);

  const token = await createSession(env, userId);
  return redirect('/', { 'Set-Cookie': sessionCookie(token) });
}
