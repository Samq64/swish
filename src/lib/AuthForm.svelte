<script>
  import { autofocus } from './actions.js';

  /**
   * The sign-in / sign-up card. Renders a plain POST form so it works without
   * JS; `form` is the SvelteKit action result ({ error, username }) on failure.
   * Colours come from app.css's tokens — no palette of its own.
   */
  let { mode, form = null } = $props();

  const isLogin = mode === 'login';
  const title = isLogin ? 'Welcome back' : 'Create your account';
  const submit = isLogin ? 'Sign in' : 'Sign up';
  const pwAutocomplete = isLogin ? 'current-password' : 'new-password';
  const switchText = isLogin ? 'New here?' : 'Already have an account?';
  const switchHref = isLogin ? '/register' : '/login';
  const switchLabel = isLogin ? 'Create an account' : 'Sign in';
</script>

<svelte:head>
  <title>{isLogin ? 'Sign in' : 'Sign up'}</title>
</svelte:head>

<div class="auth-wrap">
  <form class="card" method="post">
    <p class="subtitle">{title}</p>
    <label>
      Username
      <input
        type="text"
        name="username"
        autocomplete="username"
        value={form?.username ?? ''}
        use:autofocus
        required
      />
    </label>
    <label>
      Password
      <input type="password" name="password" autocomplete={pwAutocomplete} required />
    </label>
    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
    <button type="submit">{submit}</button>
    <p class="switch">{switchText} <a href={switchHref}>{switchLabel}</a></p>
  </form>
</div>

<style>
  .auth-wrap {
    /* dvh tracks the visible viewport so the mobile URL bar doesn't add
       scrollable dead space below the card; vh is the fallback. */
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 28px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .subtitle {
    margin: 0 0 var(--space-1);
    color: var(--text);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: 13px;
    color: var(--muted);
  }
  input {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 15px;
    background: var(--bg);
    color: var(--text);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .error {
    margin: 0;
    color: #d63031;
    font-size: 13px;
  }
  button {
    margin-top: var(--space-1);
    border: none;
    background: var(--accent);
    color: #fff;
    border-radius: var(--radius);
    padding: var(--space-3);
    font-size: 15px;
    font-weight: 700;
  }
  .switch {
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .switch a {
    color: var(--accent);
    font-weight: 600;
    text-decoration: none;
  }
</style>
