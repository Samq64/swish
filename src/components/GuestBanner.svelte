<script>
  import { store } from '../data/store.js';
  import Icon from '../lib/Icon.svelte';

  /**
   * A slim, persistent strip shown only in guest mode. Guest data lives in this
   * browser with no cloud backup and no account migration, so the one thing a
   * guest needs to know is: export to keep your data. The button downloads the
   * current workspace as the same JSON the cloud import accepts.
   */
  let busy = $state(false);

  async function exportCurrent() {
    if (busy) return;
    busy = true;
    try {
      const ws = store.currentWorkspace;
      const data = await store.exportWorkspace();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(ws?.name || 'workspace').replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      busy = false;
    }
  }
</script>

<div class="guest-banner" role="status">
  <Icon name="info" size={15} />
  <span class="msg">
    Guest mode — your data is saved only in this browser. Export to back it up or move it to an
    account.
  </span>
  <div class="actions">
    <button class="link" type="button" disabled={busy} onclick={exportCurrent}>
      <Icon name="download" size={14} />
      {busy ? 'Exporting…' : 'Export'}
    </button>
    <a class="link" href="/login">Sign in</a>
  </div>
</div>

<style>
  .guest-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 13px;
  }
  .msg {
    flex: 1;
    min-width: 0;
    color: var(--muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
  }
  .link:disabled {
    opacity: 0.6;
    cursor: default;
  }
  @media (max-width: 560px) {
    /* The message wraps awkwardly on phones; keep the actions, trim the prose. */
    .msg {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
