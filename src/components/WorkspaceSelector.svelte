<script>
  import { store } from '../data/store.js';
  import { clickOutside } from '../lib/actions.js';
  import Icon from '../lib/Icon.svelte';

  /**
   * Workspace switcher. The dropdown is purely a selector — switching between
   * workspaces — plus Settings and Log out. Creating, renaming, exporting,
   * importing and deleting workspaces live in the Settings modal.
   */
  let { onOpenSettings } = $props();

  let open = $state(false);

  function initial(name) {
    return (name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
  }

  function pick(id) {
    store.switchWorkspace(id);
    open = false;
  }

  function settings() {
    open = false;
    onOpenSettings?.();
  }
</script>

<div class="ws" use:clickOutside={() => (open = false)}>
  <button
    class="trigger"
    aria-expanded={open}
    aria-label="Switch workspace"
    onclick={() => (open = !open)}
  >
    <span class="avatar">{initial(store.currentUser?.username)}</span>
    <span class="name">{store.currentWorkspace?.name ?? 'Workspace'}</span>
    <span class="caret" class:open><Icon name="chevron-down" size={16} /></span>
  </button>

  {#if open}
    <div class="panel">
      <div class="panel-label">Workspaces</div>
      <div class="options">
        {#each store.workspaces as w (w.id)}
          {@const isCurrent = w.id === store.currentWorkspaceId}
          <button class="option" class:current={isCurrent} onclick={() => pick(w.id)}>
            <span class="check">
              {#if isCurrent}<Icon name="check" size={14} />{/if}
            </span>
            <span class="opt-name">{w.name}</span>
          </button>
        {/each}
      </div>

      <div class="menu">
        <button class="menu-item" onclick={settings}>
          <Icon name="settings" size={15} /> Settings
        </button>
        <button class="menu-item" onclick={() => store.logout()}>
          <Icon name="log-out" size={15} /> Log out
        </button>
      </div>
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
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    display: inline-flex;
    color: var(--muted);
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
    width: 100%;
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
  .option:hover {
    background: var(--bg);
  }
  .option.current {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .opt-name {
    flex: 1;
    min-width: 0;
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
  }

  .menu {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }
  .menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    font-size: 14px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .menu-item:hover {
    background: var(--bg);
  }
</style>
