// /login — server-rendered sign-in page (GET) and form handler (POST).

import { verifyPassword } from './_lib/auth.js';
import { sessionCookie } from './_lib/auth.js';
import { resolveUser, createSession } from './_lib/session.js';
import { renderAuthPage, htmlResponse, redirect } from './_lib/authPage.js';
import { sameOrigin } from './_lib/http.js';

export async function onRequestGet({ env, request }) {
  // Already signed in? Skip the form.
  if (await resolveUser(env, request)) return redirect('/');
  return htmlResponse(renderAuthPage({ mode: 'login' }));
}

export async function onRequestPost({ env, request }) {
  if (!sameOrigin(request)) return htmlResponse(renderAuthPage({ mode: 'login', error: 'Bad origin.' }), 403);

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
  if (!ok) {
    return htmlResponse(
      renderAuthPage({ mode: 'login', error: 'Invalid username or password.', username }),
      401,
    );
  }

  const token = await createSession(env, row.id);
  return redirect('/', { 'Set-Cookie': sessionCookie(token) });
}
