<script>
  import { store } from '../data/store.js';
  import { autofocus, clickOutside } from '../lib/actions.js';

  /**
   * Replaces the static brand. Shows the active workspace and opens a dropdown
   * to switch between workspaces or create a new one. Switching reloads the
   * workspace's projects, tags and entries via the store.
   */

  let open = $state(false);
  let creating = $state(false);
  let newName = $state('');

  function initial(name) {
    return (name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
  }

  function close() {
    open = false;
    creating = false;
    newName = '';
  }

  function pick(id) {
    store.switchWorkspace(id);
    close();
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    await store.addWorkspace(name);
    close();
  }
</script>

<div class="ws" use:clickOutside={close}>
  <button
    class="trigger"
    aria-expanded={open}
    aria-label="Switch workspace"
    onclick={() => (open = !open)}
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
          <button
            class="option"
            class:current={w.id === store.currentWorkspaceId}
            onclick={() => pick(w.id)}
          >
            <span class="avatar sm">{initial(w.name)}</span>
            <span class="opt-name">{w.name}</span>
            {#if w.id === store.currentWorkspaceId}
              <span class="check">✓</span>
            {/if}
          </button>
        {/each}
      </div>

      {#if creating}
        <input
          class="new-input"
          type="text"
          placeholder="Workspace name…"
          bind:value={newName}
          use:autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            } else if (e.key === 'Escape') {
              creating = false;
              newName = '';
            }
          }}
        />
      {:else}
        <button class="add" onclick={() => (creating = true)}>
          + New workspace
        </button>
      {/if}
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
    gap: 8px;
    border: 1px solid transparent;
    background: none;
    border-radius: 8px;
    padding: 4px 8px 4px 4px;
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
    border-radius: 7px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .avatar.sm {
    width: 22px;
    height: 22px;
    font-size: 12px;
    border-radius: 6px;
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
    top: calc(100% + 6px);
    left: 0;
    z-index: 80;
    width: 240px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: 8px;
  }
  .panel-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding: 4px 6px;
  }
  .options {
    max-height: 240px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    border-radius: 7px;
    padding: 6px;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .option:hover {
    background: var(--bg);
  }
  .option.current {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .opt-name {
    flex: 1;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check {
    color: var(--accent);
    font-weight: 700;
  }
  .add {
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 14px;
    padding: 8px 6px 4px;
    margin-top: 4px;
    border-top: 1px solid var(--border);
    cursor: pointer;
  }
  .new-input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 7px 8px;
    font-size: 14px;
    margin-top: 6px;
  }
</style>
