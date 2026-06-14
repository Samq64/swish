<script>
  import { store } from '../data/store.js';
  import Icon from '../lib/Icon.svelte';

  /** Account settings: change password, sign out other sessions, delete account. */
  let { onClose } = $props();

  // change password
  let currentPassword = $state('');
  let newPassword = $state('');
  let pwBusy = $state(false);
  let pwError = $state('');
  let pwOk = $state(false);

  // sessions
  let sessionsBusy = $state(false);
  let sessionsOk = $state(false);

  // delete account
  let deletePassword = $state('');
  let deleteBusy = $state(false);
  let deleteError = $state('');

  async function submitPassword() {
    if (pwBusy) return;
    pwError = '';
    pwOk = false;
    pwBusy = true;
    try {
      await store.changePassword(currentPassword, newPassword);
      currentPassword = '';
      newPassword = '';
      pwOk = true;
    } catch (e) {
      pwError = e?.message || 'Could not update password.';
    } finally {
      pwBusy = false;
    }
  }

  async function logoutOthers() {
    sessionsBusy = true;
    sessionsOk = false;
    try {
      await store.logoutOtherSessions();
      sessionsOk = true;
    } finally {
      sessionsBusy = false;
    }
  }

  async function deleteAccount() {
    if (deleteBusy) return;
    deleteError = '';
    if (!confirm('Delete your account and everything in it? This cannot be undone.'))
      return;
    deleteBusy = true;
    try {
      await store.deleteAccount(deletePassword);
      // Success drops to the login screen and unmounts this modal.
    } catch (e) {
      deleteError = e?.message || 'Could not delete account.';
      deleteBusy = false;
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') onClose?.();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  role="presentation"
  onpointerdown={(e) => {
    if (e.target === e.currentTarget) onClose?.();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">
    <header class="head">
      <h2>Settings</h2>
      <button class="close" aria-label="Close" onclick={() => onClose?.()}>
        <Icon name="x" size={18} />
      </button>
    </header>

    <div class="body">
      <section class="section">
        <h3>Preferences</h3>
        <div class="pref-row">
          <span class="pref-label">Theme</span>
          <div class="seg" role="group" aria-label="Theme">
            {#each ['auto', 'light', 'dark'] as t (t)}
              <button class:active={store.theme === t} onclick={() => store.setTheme(t)}>
                {t}
              </button>
            {/each}
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-label">Week starts</span>
          <div class="seg" role="group" aria-label="Week start">
            <button class:active={store.weekStart === 0} onclick={() => store.setWeekStart(0)}>
              Sunday
            </button>
            <button class:active={store.weekStart === 1} onclick={() => store.setWeekStart(1)}>
              Monday
            </button>
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-label">Clock</span>
          <div class="seg" role="group" aria-label="Clock format">
            <button class:active={store.hour12} onclick={() => store.setHour12(true)}>
              12-hour
            </button>
            <button class:active={!store.hour12} onclick={() => store.setHour12(false)}>
              24-hour
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <h3>Account</h3>
        <p class="account-line">
          Signed in as <strong>{store.currentUser?.username}</strong>
        </p>
        <form onsubmit={(e) => (e.preventDefault(), submitPassword())}>
          <input
            type="password"
            placeholder="Current password"
            autocomplete="current-password"
            bind:value={currentPassword}
            required
          />
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            autocomplete="new-password"
            bind:value={newPassword}
            required
          />
          {#if pwError}<p class="msg error">{pwError}</p>{/if}
          {#if pwOk}<p class="msg ok">Password updated. Other sessions were signed out.</p>{/if}
          <button class="btn" type="submit" disabled={pwBusy}>
            {pwBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section class="section">
        <h3>Sessions</h3>
        <p class="hint">Sign out everywhere except this device.</p>
        {#if sessionsOk}<p class="msg ok">Other sessions signed out.</p>{/if}
        <button class="btn" type="button" disabled={sessionsBusy} onclick={logoutOthers}>
          {sessionsBusy ? 'Signing out…' : 'Log out other sessions'}
        </button>
      </section>

      <section class="section danger">
        <h3>Delete account</h3>
        <p class="hint">
          Permanently deletes your account and all workspaces, projects, tags
          and entries. This cannot be undone.
        </p>
        <input
          type="password"
          placeholder="Confirm password"
          autocomplete="current-password"
          bind:value={deletePassword}
        />
        {#if deleteError}<p class="msg error">{deleteError}</p>{/if}
        <button class="btn delete" type="button" disabled={deleteBusy} onclick={deleteAccount}>
          <Icon name="trash-2" size={15} />
          {deleteBusy ? 'Deleting…' : 'Delete account'}
        </button>
      </section>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 30, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    width: 440px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }
  .head h2 {
    margin: 0;
    font-size: 17px;
  }
  .close {
    border: none;
    background: none;
    line-height: 1;
    color: var(--muted);
    padding: 0 var(--space-1);
  }
  .body {
    padding: var(--space-4) var(--space-5);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section h3 {
    margin: 0;
    font-size: 14px;
  }
  .section form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .account-line {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .pref-label {
    font-size: 14px;
    color: var(--muted);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: var(--surface);
    color: var(--muted);
    padding: var(--space-1) var(--space-3);
    font-size: 13px;
    font-weight: 600;
    text-transform: capitalize;
  }
  .seg button + button {
    border-left: 1px solid var(--border);
  }
  .seg button.active {
    background: var(--accent);
    color: #fff;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  input {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .danger {
    border-top: 1px solid var(--border);
    padding-top: var(--space-4);
  }
  .danger h3 {
    color: #d63031;
  }
  .btn.delete {
    border-color: #d63031;
    color: #d63031;
  }
  /* Theme-adaptive tint so the hover reads correctly in light and dark
     (the old hard-coded light pink looked wrong on the dark surface). */
  .btn.delete:hover:not(:disabled) {
    background: color-mix(in srgb, #d63031 14%, var(--surface));
  }
  .msg {
    margin: 0;
    font-size: 13px;
  }
  .msg.error {
    color: #d63031;
  }
  .msg.ok {
    color: #00a36c;
  }
</style>
