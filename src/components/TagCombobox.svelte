<script>
  import { autofocus, clickOutside } from '../lib/actions.js';
  import { filterByName, hasExactName } from '../lib/search.js';

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
    <span class="caret" class:open>▾</span>
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
            + Create “{query.trim()}”
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
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    padding: 5px 8px;
    min-height: 30px;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }
  .chip {
    background: color-mix(in srgb, var(--accent) 15%, white);
    color: var(--accent);
    border-radius: 999px;
    padding: 1px 9px;
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
    color: var(--muted);
    font-size: 11px;
    transition: transform 0.12s ease;
  }
  .caret.open {
    transform: rotate(180deg);
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    padding: 6px;
  }
  .search {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 13px;
    margin-bottom: 4px;
  }
  .options {
    max-height: 180px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: 6px;
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
    text-align: left;
    border: none;
    background: none;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
  }
  .create:hover {
    background: var(--bg);
  }
  .none {
    margin: 0;
    padding: 8px 6px;
    font-size: 13px;
    color: var(--muted);
  }
</style>
