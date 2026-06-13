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
 * CSRF defence for cookie-authenticated mutations: require the request's
 * `Origin` to share our hostname. A cross-site attacker's Origin (set by the
 * browser, unforgeable) never matches our host, so this blocks CSRF while
 * still allowing local dev where the Vite HMR server and the API live on the
 * same host but different ports. Same-origin requests that omit `Origin` are
 * allowed.
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
