import { fail, redirect } from '@sveltejs/kit';
import { verifyPassword } from '$lib/server/auth.js';
import { createSession, setSessionCookie } from '$lib/server/session.js';

export function load({ locals }) {
  if (locals.user) throw redirect(303, '/');
}

export const actions = {
  // SvelteKit's CSRF protection rejects cross-origin form posts, so there's no
  // hand-rolled origin check here.
  default: async ({ request, cookies, platform }) => {
    const env = platform.env;
    const form = await request.formData();
    const username = (form.get('username') ?? '').toString().trim();
    const password = (form.get('password') ?? '').toString();

    const row = await env.DB.prepare(
      'SELECT id, pw_hash, pw_salt, pw_iterations FROM users WHERE username = ?',
    )
      .bind(username)
      .first();
    const ok =
      row &&
      (await verifyPassword(
        password,
        { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iterations },
        env.PEPPER,
      ));
    if (!ok) return fail(401, { error: 'Invalid username or password.', username });

    setSessionCookie(cookies, await createSession(env, row.id));
    throw redirect(303, '/');
  },
};
