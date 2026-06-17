import { fail, redirect } from '@sveltejs/kit';
import { verifyUserPassword } from '$lib/server/auth.js';
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

    const row = await verifyUserPassword(env, 'username', username, password);
    if (!row) return fail(401, { error: 'Invalid username or password.', username });

    setSessionCookie(cookies, await createSession(env, row.id));
    throw redirect(303, '/');
  },
};
