// /logout — clear the current session and return to the login page.

import { readSessionCookie, sha256b64url, clearSessionCookie } from './_lib/auth.js';
import { redirect } from './_lib/authPage.js';

async function handle({ env, request }) {
  const token = readSessionCookie(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256b64url(token)).run();
  }
  return redirect('/login', { 'Set-Cookie': clearSessionCookie() });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
