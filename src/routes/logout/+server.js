import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '$lib/server/auth.js';
import { destroySession, clearSessionCookie } from '$lib/server/session.js';

// POST-only: signing out is a state change, so it must not be reachable by a
// cross-site GET. SvelteKit's CSRF protection covers the form post.
export async function POST({ cookies, platform }) {
  await destroySession(/** @type {App.Platform} */ (platform).env, cookies.get(COOKIE_NAME));
  clearSessionCookie(cookies);
  throw redirect(303, '/login');
}
