// Gate the app: a top-level navigation to anything other than the auth pages
// or the API requires a valid session, otherwise redirect to /login. Assets and
// API requests pass straight through (the API enforces its own auth).

import { resolveUser } from './_lib/session.js';

const PUBLIC_PATHS = new Set(['/login', '/register', '/logout']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith('/api/') || PUBLIC_PATHS.has(path)) return next();

  // Only guard real document navigations; sub-resources (JS/CSS/icons) pass
  // through so we don't do a DB lookup on every asset.
  const dest = request.headers.get('Sec-Fetch-Dest');
  const accept = request.headers.get('Accept') || '';
  const isDocument =
    dest === 'document' ||
    (dest === null && request.method === 'GET' && accept.includes('text/html'));
  if (!isDocument) return next();

  const user = await resolveUser(env, request);
  if (!user) return Response.redirect(new URL('/login', url).toString(), 302);
  return next();
}
