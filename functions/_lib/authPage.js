// Server-rendered HTML for the standalone auth pages (/login, /register).
// Self-contained (inline CSS, no SPA assets) and theme-aware.

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * @param {{mode: 'login'|'register', error?: string, username?: string}} opts
 */
export function renderAuthPage({ mode, error = '', username = '' }) {
  const isLogin = mode === 'login';
  const title = isLogin ? 'Welcome back' : 'Create your account';
  const action = isLogin ? '/login' : '/register';
  const submit = isLogin ? 'Sign in' : 'Sign up';
  const pwAutocomplete = isLogin ? 'current-password' : 'new-password';
  const switchText = isLogin ? 'New here?' : 'Already have an account?';
  const switchHref = isLogin ? '/register' : '/login';
  const switchLabel = isLogin ? 'Create an account' : 'Sign in';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>swish — ${escapeHtml(isLogin ? 'Sign in' : 'Sign up')}</title>
<meta name="theme-color" content="#6c5ce7" />
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f7fa; --surface: #fff; --border: #e6e6ee;
    --text: #2d2d3a; --muted: #8a8a9a; --accent: #6c5ce7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161c; --surface: #1f1f29; --border: #34343f;
      --text: #e7e7ef; --muted: #9595a4; --accent: #8b7cf0;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 20px; background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 340px; display: flex; flex-direction: column;
    gap: 12px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 28px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.12);
  }
  .brand { margin: 0; font-size: 28px; font-weight: 800; color: var(--accent); letter-spacing: -0.02em; }
  .subtitle { margin: 0 0 4px; color: var(--muted); font-size: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
  input {
    border: 1px solid var(--border); border-radius: 8px; padding: 8px;
    font-size: 15px; background: var(--bg); color: var(--text); font: inherit;
  }
  input:focus { outline: none; border-color: var(--accent); }
  .error { margin: 0; color: #d63031; font-size: 13px; }
  button {
    margin-top: 4px; border: none; background: var(--accent); color: #fff;
    border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700;
    cursor: pointer; font-family: inherit;
  }
  .switch { margin: 0; text-align: center; font-size: 13px; color: var(--muted); }
  .switch a { color: var(--accent); font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
  <form class="card" method="post" action="${action}">
    <h1 class="brand">swish</h1>
    <p class="subtitle">${escapeHtml(title)}</p>
    <label>Username
      <input type="text" name="username" autocomplete="username"
             value="${escapeHtml(username)}" autofocus required />
    </label>
    <label>Password
      <input type="password" name="password" autocomplete="${pwAutocomplete}" required />
    </label>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <button type="submit">${submit}</button>
    <p class="switch">${switchText} <a href="${switchHref}">${switchLabel}</a></p>
  </form>
</body>
</html>`;
}

export function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

/** A redirect that can also set/clear cookies. */
export function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}
