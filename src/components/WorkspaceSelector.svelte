<script>
  import { store } from '../data/store.js';
  import { autofocus, clickOutside } from '../lib/actions.js';

  /**
   * Replaces the static brand. Shows the active workspace and opens a dropdown
   * to switch between workspaces or create a new one. Switching reloads the
   * workspace's projects, tags and entries via the store.
   */

  let open = $state(false);
  let renamingId = $state(null);
  let renameName = $state('');

  function initial(name) {
    return (name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
  }

  function close() {
    open = false;
    renamingId = null;
    renameName = '';
  }

  function pick(id) {
    store.switchWorkspace(id);
    close();
  }

  function startRename(w) {
    renamingId = w.id;
    renameName = w.name;
  }

  // Create a workspace and drop straight into inline-renaming the new row,
  // so there's no separate "name it" text box hijacking the footer.
  async function createNew() {
    const ws = await store.addWorkspace('New workspace');
    startRename(ws);
  }

  async function saveRename(id) {
    const name = renameName.trim();
    renamingId = null;
    renameName = '';
    if (name) await store.renameWorkspace(id, name);
  }

  let fileInput;

  async function removeWorkspace(w) {
    if (store.workspaces.length <= 1) return;
    if (!confirm(`Delete “${w.name}” and all its entries? This can't be undone.`))
      return;
    await store.deleteWorkspace(w.id);
  }

  async function downloadWorkspace(w) {
    const data = await store.exportWorkspace(w.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(w.name || 'workspace')
      .replace(/[^\w-]+/g, '-')
      .toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    close();
  }

  async function onImportFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // allow re-picking the same file later
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload?.type !== 'swish.workspace') {
        throw new Error('Not a swish workspace export');
      }
      await store.importWorkspace(payload);
      close();
    } catch {
      alert('Could not import: the file is not a valid workspace export.');
    }
  }
</script>

<div class="ws" use:clickOutside={close}>
  <button
    class="trigger"
    aria-expanded={open}
    aria-label="Switch workspace"
    onclick={() => (open ? close() : (open = true))}
  >
    <span class="avatar">{initial(store.currentWorkspace?.name)}</span>
    <span class="name">{store.currentWorkspace?.name ?? 'Workspace'}</span>
    <span class="caret" class:open>▾</span>
  </button>

  {#if open}
    <div class="panel">
      <div class="panel-label">Workspaces</div>
      <div class="options">
        {#each store.workspaces as w (w.id)}
          {#if renamingId === w.id}
            <input
              class="rename-input"
              type="text"
              bind:value={renameName}
              use:autofocus={{ select: true }}
              onblur={() => saveRename(w.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveRename(w.id);
                } else if (e.key === 'Escape') {
                  renamingId = null;
                  renameName = '';
                }
              }}
            />
          {:else}
            {@const isCurrent = w.id === store.currentWorkspaceId}
            <div class="option" class:current={isCurrent}>
              <button class="switch" onclick={() => pick(w.id)}>
                <span class="check">{#if isCurrent}✓{/if}</span>
                <span class="opt-name">{w.name}</span>
              </button>
              <div class="row-actions">
                <button title="Rename" aria-label="Rename workspace" onclick={() => startRename(w)}>
                  ✎
                </button>
                <button title="Export" aria-label="Export workspace" onclick={() => downloadWorkspace(w)}>
                  ⭳
                </button>
                <button
                  class="danger"
                  title="Delete"
                  aria-label="Delete workspace"
                  disabled={store.workspaces.length <= 1}
                  onclick={() => removeWorkspace(w)}
                >
                  ✕
                </button>
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <div class="bottom">
        <button onclick={() => fileInput.click()}>Import…</button>
        <button onclick={createNew}>+ New</button>
      </div>
      <input
        type="file"
        accept="application/json,.json"
        bind:this={fileInput}
        onchange={onImportFile}
        hidden
      />
    </div>
  {/if}
</div>

<style>
  .ws {
    position: relative;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid transparent;
    background: none;
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
    cursor: pointer;
    max-width: 220px;
  }
  .trigger:hover {
    background: var(--surface);
    border-color: var(--border);
  }
  .avatar {
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .name {
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    color: var(--muted);
    font-size: 11px;
    transition: transform 0.12s ease;
  }
  .caret.open {
    transform: rotate(180deg);
  }

  .panel {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: 80;
    width: 240px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: var(--space-2);
  }
  .panel-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding: var(--space-1) var(--space-2);
  }
  .options {
    max-height: 240px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .option:hover {
    background: var(--bg);
  }
  .option.current {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .switch {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
    opacity: 0;
    pointer-events: none;
  }
  .option:hover .row-actions,
  .option:focus-within .row-actions {
    opacity: 1;
    pointer-events: auto;
  }
  .row-actions button {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .row-actions button:hover {
    background: var(--surface);
    color: var(--text);
  }
  .row-actions button.danger:hover {
    color: #d63031;
  }
  .row-actions button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .opt-name {
    flex: 1;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check {
    width: 14px;
    flex: none;
    text-align: center;
    color: var(--accent);
    font-weight: 700;
  }
  .rename-input {
    width: 100%;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 14px;
  }
  .bottom {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }
  .bottom button {
    flex: 1;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
  }
  .bottom button:hover {
    background: var(--bg);
  }
</style>
