<script>
  import { store } from '../data/store.js';
  import Icon from '../lib/Icon.svelte';

  /**
   * Account & workspace settings: manage workspaces (create, rename, export,
   * import, delete), change password, sign out other sessions, delete account.
   */
  let { onClose } = $props();

  let fileInput = $state();

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

  // --- workspaces ---
  function renameWorkspace(w, value, el) {
    const name = value.trim();
    const dup = store.workspaces.some(
      (x) => x.id !== w.id && x.name.toLowerCase() === name.toLowerCase(),
    );
    if (!name || dup) {
      el.value = w.name; // revert empty/duplicate
      return;
    }
    store.renameWorkspace(w.id, name);
  }

  async function downloadWorkspace(w) {
    const data = await store.exportWorkspace(w.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(w.name || 'workspace').replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function removeWorkspace(w) {
    if (store.workspaces.length <= 1) return;
    if (!confirm(`Delete “${w.name}” and all its entries? This can't be undone.`))
      return;
    await store.deleteWorkspace(w.id);
  }

  async function onImportFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.type !== 'swish.workspace') {
        throw new Error('Not a swish workspace export');
      }
      await store.importWorkspace(payload);
    } catch {
      alert('Could not import: the file is not a valid workspace export.');
    }
  }

  // --- account ---
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
        <h3>Workspaces</h3>
        <div class="ws-list">
          {#each store.workspaces as w (w.id)}
            <div class="ws-row">
              <input
                class="ws-name"
                type="text"
                value={w.name}
                aria-label="Workspace name"
                onchange={(e) => renameWorkspace(w, e.currentTarget.value, e.currentTarget)}
              />
              <button
                class="icon-btn"
                title="Export"
                aria-label="Export {w.name}"
                onclick={() => downloadWorkspace(w)}
              >
                <Icon name="download" size={15} />
              </button>
              <button
                class="icon-btn danger"
                title="Delete"
                aria-label="Delete {w.name}"
                disabled={store.workspaces.length <= 1}
                onclick={() => removeWorkspace(w)}
              >
                <Icon name="trash-2" size={15} />
              </button>
            </div>
          {/each}
        </div>
        <div class="ws-actions">
          <button class="btn" onclick={() => store.addWorkspace('New workspace')}>
            <Icon name="plus" size={15} /> New workspace
          </button>
          <button class="btn" onclick={() => fileInput.click()}>
            <Icon name="upload" size={15} /> Import
          </button>
        </div>
        <input
          type="file"
          accept="application/json,.json"
          bind:this={fileInput}
          onchange={onImportFile}
          hidden
        />
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
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .ws-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ws-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ws-name {
    flex: 1;
    min-width: 0;
  }
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    border-radius: var(--radius);
    padding: var(--space-2);
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
  }
  .icon-btn.danger:hover:not(:disabled) {
    color: #d63031;
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .ws-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
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
  .btn.delete:hover:not(:disabled) {
    background: #fdecea;
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
