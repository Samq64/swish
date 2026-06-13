// /logout — clear the current session and return to the login page. POST-only:
// signing out is a state change, so it must not be reachable by a cross-site
// GET (a stray <img src="/logout"> would otherwise log the user out).

import { readSessionCookie, sha256b64url, clearSessionCookie } from './_lib/auth.js';
import { redirect } from './_lib/authPage.js';
import { sameOrigin } from './_lib/http.js';

export async function onRequestPost({ env, request }) {
  if (!sameOrigin(request)) return redirect('/login');
  const token = readSessionCookie(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256b64url(token)).run();
  }
  return redirect('/login', { 'Set-Cookie': clearSessionCookie() });
}
