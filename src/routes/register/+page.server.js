import { fail, redirect } from '@sveltejs/kit';
import { hashPassword } from '$lib/server/auth.js';
import { createSession, setSessionCookie } from '$lib/server/session.js';

export function load({ locals }) {
  if (locals.user) throw redirect(303, '/');
}

export const actions = {
  default: async ({ request, cookies, platform }) => {
    const env = /** @type {App.Platform} */ (platform).env;
    const form = await request.formData();
    const username = (form.get('username') ?? '').toString().trim();
    const password = (form.get('password') ?? '').toString();

    if (username.length < 3 || username.length > 32)
      return fail(400, { error: 'Username must be 3–32 characters.', username });
    if (password.length < 8)
      return fail(400, { error: 'Password must be at least 8 characters.', username });

    const existing = await env.DB.prepare('SELECT 1 AS ok FROM users WHERE username = ?')
      .bind(username)
      .first();
    if (existing) return fail(409, { error: 'That username is already taken.', username });

    const pw = await hashPassword(password, env.PEPPER);
    const userId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, username, pw_hash, pw_salt, pw_iterations, active_workspace_id, created_at)
           VALUES (?,?,?,?,?,?,?)`,
      ).bind(userId, username, pw.hash, pw.salt, pw.iterations, wsId, new Date().toISOString()),
      env.DB.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').bind(
        wsId,
        userId,
        'Personal',
      ),
    ]);

    setSessionCookie(cookies, await createSession(env, userId));
    throw redirect(303, '/');
  },
};
