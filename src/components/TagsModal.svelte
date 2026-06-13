<script>
  import { store } from '../data/store.js';
  import { filterByName } from '../lib/search.js';

  /** Modal for managing global tags: rename, add and delete. */
  let { onClose } = $props();

  let query = $state('');
  let filtered = $derived(filterByName(store.tags, query));

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
  <div class="modal" role="dialog" aria-modal="true" aria-label="Tags">
    <header class="head">
      <h2>Tags</h2>
      <button class="close" aria-label="Close" onclick={() => onClose?.()}>
        ×
      </button>
    </header>

    <p class="hint">Tags are shared across every project.</p>

    <input
      class="search"
      type="text"
      placeholder="Search tags…"
      bind:value={query}
    />

    <div class="list">
      {#each filtered as t (t.id)}
        <div class="row">
          <span class="hash">#</span>
          <input
            class="name"
            type="text"
            value={t.name}
            placeholder="Tag name"
            oninput={(e) =>
              store.updateTag(t.id, { name: e.currentTarget.value })}
          />
          <button
            class="delete"
            aria-label="Delete {t.name}"
            onclick={() => store.removeTag(t.id)}
          >
            Delete
          </button>
        </div>
      {/each}

      {#if filtered.length === 0}
        <p class="empty">
          {store.tags.length === 0 ? 'No tags yet.' : 'No matches.'}
        </p>
      {/if}
    </div>

    <footer class="foot">
      <button class="add" onclick={() => store.addTag({ name: 'new-tag' })}>
        + Add tag
      </button>
      <button class="done" onclick={() => onClose?.()}>Done</button>
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
    width: 420px;
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
    padding: var(--space-3) var(--space-5) var(--space-2);
  }
  .head h2 {
    margin: 0;
    font-size: 17px;
  }
  .close {
    border: none;
    background: none;
    font-size: 24px;
    line-height: 1;
    color: var(--muted);
    padding: 0 var(--space-1);
  }
  .hint {
    margin: 0;
    padding: 0 var(--space-5) var(--space-2);
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }

  .search {
    margin: var(--space-2) var(--space-5) var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 14px;
  }
  .list {
    padding: var(--space-2) var(--space-5);
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--grid-line);
  }
  .hash {
    color: var(--muted);
    font-weight: 700;
  }
  .name {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 14px;
  }
  .delete {
    border: none;
    background: none;
    color: #d63031;
    font-size: 13px;
    flex: none;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
    text-align: center;
    padding: var(--space-4) 0;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border);
  }
  .add {
    border: 1px dashed var(--border);
    background: none;
    color: var(--accent);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-weight: 600;
  }
  .done {
    border: none;
    background: var(--accent);
    color: white;
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-weight: 600;
  }
</style>
