<script>
  import { store } from '../data/store.js';
  import { filterByName, hasExactName } from '../lib/search.js';
  import Modal from '../lib/Modal.svelte';
  import Icon from '../lib/Icon.svelte';

  /** Modal for managing global tags: rename, add and delete. */
  let { onClose } = $props();

  let query = $state('');
  let filtered = $derived(filterByName(store.tags, query));
  let exact = $derived(hasExactName(store.tags, query));

  function createFromSearch() {
    const name = query.trim();
    if (!name || exact) return;
    store.addTag({ name });
    query = '';
  }
</script>

<Modal title="Tags" width={420} {onClose}>
  <p class="hint">Tags are shared across every project.</p>

  <input
    class="search"
    type="text"
    placeholder={store.readOnly ? 'Search tags…' : 'Search or create a tag…'}
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
          readonly={store.readOnly}
          oninput={(e) => store.updateTag(t.id, { name: e.currentTarget.value })}
        />
        {#if !store.readOnly}
          <button
            class="delete-btn"
            aria-label="Delete {t.name}"
            onclick={() => store.removeTag(t.id)}
          >
            <Icon name="trash-2" size={16} />
          </button>
        {/if}
      </div>
    {/each}

    {#if query.trim() && !exact && !store.readOnly}
      <button class="create-option" onclick={createFromSearch}>
        <Icon name="plus" size={14} /> Create "#{query.trim()}"
      </button>
    {:else if filtered.length === 0}
      <p class="empty-state">
        {#if store.tags.length > 0}
          No matches.
        {:else if store.readOnly}
          No tags.
        {:else}
          Type a name above to create your first tag.
        {/if}
      </p>
    {/if}
  </div>
</Modal>

<style>
  .hint {
    margin: 0;
    padding: var(--space-2) var(--space-5) 0;
    font-size: 12px;
    color: var(--muted);
  }
  .search {
    margin: var(--space-2) var(--space-5) var(--space-1);
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
    border-top: 1px solid var(--grid-line);
  }
  .row:first-child {
    border-top: none;
  }
  .hash {
    color: var(--muted);
    font-weight: 700;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
</style>
