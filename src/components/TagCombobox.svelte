<script>
  import { autofocus, clickOutside } from '../lib/actions.js';
  import { filterByName, hasExactName } from '../lib/search.js';
  import Icon from '../lib/Icon.svelte';

  /**
   * A searchable tag picker: a trigger showing the assigned tags, which opens
   * a dropdown of checkboxes. Typing filters the list and, when nothing
   * matches exactly, offers to create the tag.
   *
   * Dumb component — it reports intent via `onToggle(id)` / `onCreate(name)`
   * and reads the current selection from `selectedIds`.
   */
  let { tags = [], selectedIds = [], onToggle, onCreate } = $props();

  let open = $state(false);
  let query = $state('');

  let selected = $derived(new Set(selectedIds));
  let selectedTags = $derived(tags.filter((t) => selected.has(t.id)));

  let filtered = $derived(filterByName(tags, query));
  let exact = $derived(hasExactName(tags, query));

  async function create() {
    const name = query.trim();
    if (!name || exact) return;
    await onCreate?.(name);
    query = '';
  }
</script>

<div class="combo" use:clickOutside={() => (open = false)}>
  <button
    type="button"
    class="trigger"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {#if selectedTags.length}
      <span class="chips">
        {#each selectedTags as t (t.id)}
          <span class="chip">{t.name}</span>
        {/each}
      </span>
    {:else}
      <span class="placeholder">Add tags…</span>
    {/if}
    <span class="caret" class:open><Icon name="chevron-down" size={16} /></span>
  </button>

  {#if open}
    <div class="panel">
      <input
        class="search"
        type="text"
        placeholder="Search or create…"
        bind:value={query}
        use:autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            create();
          } else if (e.key === 'Escape') {
            open = false;
          }
        }}
      />

      <div class="options">
        {#each filtered as t (t.id)}
          <label class="option">
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onchange={() => onToggle?.(t.id)}
            />
            <span>{t.name}</span>
          </label>
        {/each}

        {#if query.trim() && !exact}
          <button type="button" class="create" onclick={create}>
            <Icon name="plus" size={14} /> Create “{query.trim()}”
          </button>
        {:else if filtered.length === 0}
          <p class="none">No tags yet.</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .combo {
    position: relative;
  }
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: var(--space-1) var(--space-2);
    min-height: 30px;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    flex: 1;
  }
  .chip {
    background: color-mix(in srgb, var(--accent) 15%, var(--surface));
    color: var(--accent);
    border-radius: 999px;
    padding: 1px var(--space-2);
    font-size: 12px;
    font-weight: 600;
  }
  .placeholder {
    flex: 1;
    text-align: left;
    color: var(--muted);
    font-size: 13px;
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
    right: 0;
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: var(--space-1);
  }
  .search {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    font-size: 13px;
    margin-bottom: var(--space-1);
  }
  .options {
    max-height: 180px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: 13px;
    cursor: pointer;
  }
  .option:hover {
    background: var(--bg);
  }
  .option input {
    accent-color: var(--accent);
  }
  .create {
    width: 100%;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: none;
    background: none;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .create:hover {
    background: var(--bg);
  }
  .none {
    margin: 0;
    padding: var(--space-2);
    font-size: 13px;
    color: var(--muted);
  }
</style>
