// Small HTTP helpers shared by the API router.

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

export function error(status, message) {
  return json({ error: message }, { status });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Origin check for the JSON API. SvelteKit's built-in CSRF protection only
 * guards form-type submissions (form-urlencoded/multipart/text-plain), not
 * `application/json`, so this closes that gap explicitly for our cookie-authed
 * mutations rather than relying on the browser's CORS preflight alone. A
 * cross-site attacker's Origin (set by the browser, unforgeable) never matches
 * our host. Same-origin requests that omit Origin are allowed.
 */
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).hostname === new URL(request.url).hostname;
  } catch {
    return false;
  }
}
