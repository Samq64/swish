// Resolve the session once per request into `locals.user`, and gate page
// navigations: anything but the auth pages and the API requires a session.
// (The API enforces its own auth and answers 401 in JSON — never redirect it.
// Static assets are served by Pages and don't reach this hook.)

import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '$lib/server/auth.js';
import { resolveUser } from '$lib/server/session.js';

const PUBLIC = new Set(['/login', '/register', '/logout']);

export async function handle({ event, resolve }) {
  const { env } = /** @type {App.Platform} */ (event.platform);
  event.locals.user = await resolveUser(env, event.cookies.get(COOKIE_NAME));

  const { pathname } = event.url;
  if (!pathname.startsWith('/api') && !PUBLIC.has(pathname) && !event.locals.user) {
    throw redirect(302, '/login');
  }
  return resolve(event);
}
