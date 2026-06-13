<script>
  import { store } from '../data/store.js';
  import Icon from '../lib/Icon.svelte';

  /** Manage workspaces: create, rename, export, import and delete. */
  let { onClose } = $props();

  let fileInput = $state();

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
  <div class="modal" role="dialog" aria-modal="true" aria-label="Workspaces">
    <header class="head">
      <h2>Workspaces</h2>
      <button class="close" aria-label="Close" onclick={() => onClose?.()}>
        <Icon name="x" size={18} />
      </button>
    </header>

    <div class="list">
      {#each store.workspaces as w (w.id)}
        <div class="row">
          <input
            class="name"
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
            <Icon name="download" size={16} />
          </button>
          <button
            class="icon-btn danger"
            title="Delete"
            aria-label="Delete {w.name}"
            disabled={store.workspaces.length <= 1}
            onclick={() => removeWorkspace(w)}
          >
            <Icon name="trash-2" size={16} />
          </button>
        </div>
      {/each}
    </div>

    <footer class="foot">
      <button class="add" onclick={() => store.addWorkspace('New workspace')}>
        <Icon name="plus" size={15} /> New workspace
      </button>
      <button class="add" onclick={() => fileInput.click()}>
        <Icon name="upload" size={15} /> Import
      </button>
      <input
        type="file"
        accept="application/json,.json"
        bind:this={fileInput}
        onchange={onImportFile}
        hidden
      />
    </footer>
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
    width: 460px;
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
  .list {
    padding: var(--space-3) var(--space-5);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 var(--space-2);
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
  }
  .name:focus {
    outline: none;
    border-color: var(--accent);
  }
  .icon-btn {
    flex: none;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    border-radius: var(--radius);
    padding: 0;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
  }
  .icon-btn.danger:hover:not(:disabled) {
    color: #d63031;
    border-color: #d63031;
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .foot {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border);
  }
  .add {
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
  }
  .add:hover {
    background: var(--bg);
  }
</style>
