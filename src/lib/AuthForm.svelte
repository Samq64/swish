<script>
  import { autofocus } from './actions.js';
  import { setGuestCookie } from './guest.js';

  /**
   * The sign-in / sign-up card. Renders a plain POST form so it works without
   * JS; `form` is the SvelteKit action result ({ error, username }) on failure.
   * Colours come from app.css's tokens — no palette of its own.
   */
  let { mode, form = null } = $props();

  let isLogin = $derived(mode === 'login');

  // Guest mode is client-only (data lives in localStorage), so this needs JS —
  // hence a button, not a link. Set the marker cookie the server guard checks,
  // then a full navigation to the app shell.
  function continueAsGuest() {
    setGuestCookie();
    window.location.assign('/');
  }
  let title = $derived(isLogin ? 'Welcome back' : 'Create your account');
  let submit = $derived(isLogin ? 'Sign in' : 'Sign up');
  /** @type {'current-password' | 'new-password'} */
  let pwAutocomplete = $derived(isLogin ? 'current-password' : 'new-password');
  let switchText = $derived(isLogin ? 'New here?' : 'Already have an account?');
  let switchHref = $derived(isLogin ? '/register' : '/login');
  let switchLabel = $derived(isLogin ? 'Create an account' : 'Sign in');
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
  {#if isLogin}
    <div class="guest">
      <span class="rule">or</span>
      <button type="button" class="guest-btn" onclick={continueAsGuest}>Continue as guest</button>
    </div>
  {/if}
</div>

<style>
  .auth-wrap {
    /* dvh tracks the visible viewport so the mobile URL bar doesn't add
       scrollable dead space below the card. */
    min-height: 100dvh;
    display: flex;
    /* Column so the guest block stacks below the card rather than beside it. */
    flex-direction: column;
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
    /* Theme-aware shadow: a soft, cool drop on the light background; a deeper
       one on dark, where a faint black shadow would be invisible. light-dark()
       tracks the same color-scheme the rest of the palette does. */
    box-shadow: 0 12px 40px light-dark(rgba(38, 38, 66, 0.1), rgba(0, 0, 0, 0.45));
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
  .error {
    margin: 0;
    color: var(--danger);
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
  .guest {
    width: 100%;
    max-width: 340px;
    margin-top: var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  /* "or" centred between two hairlines spanning the card width. */
  .rule {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    font-size: 12px;
    color: var(--muted);
  }
  .rule::before,
  .rule::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .guest-btn {
    width: 100%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius);
    padding: var(--space-3);
    font-size: 15px;
    font-weight: 600;
  }
</style>
