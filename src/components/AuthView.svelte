<script>
  import { store } from '../data/store.js';
  import { autofocus } from '../lib/actions.js';

  /**
   * Full-screen sign-in / sign-up gate shown when there is no session. Talks to
   * the store's auth methods; on success the store loads data and App swaps to
   * the app proper.
   */

  let mode = $state('login'); // 'login' | 'register'
  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  let title = $derived(mode === 'login' ? 'Welcome back' : 'Create your account');

  async function submit() {
    if (busy) return;
    error = '';
    busy = true;
    try {
      if (mode === 'login') {
        await store.login(username.trim(), password);
      } else {
        await store.register(username.trim(), password);
      }
    } catch (e) {
      error = e?.message || 'Something went wrong. Please try again.';
    } finally {
      busy = false;
    }
  }

  function toggleMode() {
    mode = mode === 'login' ? 'register' : 'login';
    error = '';
  }
</script>

<div class="auth">
  <form class="card" onsubmit={(e) => (e.preventDefault(), submit())}>
    <h1 class="brand">swish</h1>
    <p class="subtitle">{title}</p>

    <label class="field">
      <span>Username</span>
      <input
        type="text"
        autocomplete="username"
        bind:value={username}
        use:autofocus
        required
      />
    </label>

    <label class="field">
      <span>Password</span>
      <input
        type="password"
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
        bind:value={password}
        required
      />
    </label>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <button class="submit" type="submit" disabled={busy}>
      {#if busy}
        Please wait…
      {:else}
        {mode === 'login' ? 'Sign in' : 'Sign up'}
      {/if}
    </button>

    <p class="switch">
      {mode === 'login' ? 'New here?' : 'Already have an account?'}
      <button type="button" class="link" onclick={toggleMode}>
        {mode === 'login' ? 'Create an account' : 'Sign in'}
      </button>
    </p>
  </form>
</div>

<style>
  .auth {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-5);
    background: var(--bg);
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
    padding: var(--space-5);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
  .brand {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -0.02em;
  }
  .subtitle {
    margin: 0 0 var(--space-1);
    color: var(--muted);
    font-size: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .field input {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 15px;
    background: var(--bg);
    color: var(--text);
  }
  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .error {
    margin: 0;
    color: #d63031;
    font-size: 13px;
  }
  .submit {
    margin-top: var(--space-1);
    border: none;
    background: var(--accent);
    color: white;
    border-radius: var(--radius);
    padding: var(--space-3);
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  .submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .switch {
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
</style>
