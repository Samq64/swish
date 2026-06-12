<script>
  import { store } from '../data/store.js';
  import {
    formatClock,
    formatDuration,
    dateToMinutes,
    clamp,
  } from '../lib/time.js';
  import EditPopover from './EditPopover.svelte';

  /**
   * A flat list of entries in the visible range, grouped by day (most recent
   * first), with a tag filter that spans every project.
   */

  const NO_PROJECT = '__none__';

  let selectedId = $state(null);
  let editorPos = $state({ x: 0, y: 0 });
  /** @type {Set<string>} */
  let filterTagIds = $state(new Set());
  /** @type {Set<string>} project ids; NO_PROJECT matches entries with none. */
  let filterProjectIds = $state(new Set());

  let selectedEntry = $derived(
    selectedId ? (store.entries.find((e) => e.id === selectedId) ?? null) : null,
  );

  let anyFilter = $derived(filterTagIds.size > 0 || filterProjectIds.size > 0);

  function toggleIn(set, id) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }
  function toggleTag(id) {
    filterTagIds = toggleIn(filterTagIds, id);
  }
  function toggleProject(id) {
    filterProjectIds = toggleIn(filterProjectIds, id);
  }
  function clearFilters() {
    filterTagIds = new Set();
    filterProjectIds = new Set();
  }

  function durationMin(e) {
    return (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000;
  }

  // Day groups, newest first, omitting empty days.
  let groups = $derived.by(() => {
    return [...store.visibleDays]
      .reverse()
      .map((dayISO) => {
        let entries = store.entriesForDay(dayISO).filter((e) => e.end);
        if (filterProjectIds.size) {
          entries = entries.filter((e) =>
            filterProjectIds.has(e.projectId ?? NO_PROJECT),
          );
        }
        if (filterTagIds.size) {
          entries = entries.filter((e) =>
            (e.tagIds ?? []).some((id) => filterTagIds.has(id)),
          );
        }
        entries = entries.sort(
          (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
        );
        const total = entries.reduce((s, e) => s + durationMin(e), 0);
        return { dayISO, entries, total };
      })
      .filter((g) => g.entries.length > 0);
  });

  function dayHeading(iso) {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }

  function projectFor(e) {
    return e.projectId ? store.projectsById.get(e.projectId) : null;
  }
  function tagNames(e) {
    return (e.tagIds ?? [])
      .map((id) => store.tagsById.get(id)?.name)
      .filter(Boolean);
  }

  function select(id, event) {
    selectedId = id;
    const x = clamp((event?.clientX ?? 200) + 12, 8, window.innerWidth - 260);
    const y = clamp((event?.clientY ?? 120) - 10, 8, window.innerHeight - 320);
    editorPos = { x, y };
  }
</script>

<div class="list-view">
  <div class="filter-bar">
    <div class="filter-row">
      <span class="filter-label">Project</span>
      {#each store.projects as p (p.id)}
        <button
          type="button"
          class="chip"
          class:on={filterProjectIds.has(p.id)}
          onclick={() => toggleProject(p.id)}
        >
          <span class="dot" style:background={p.color}></span>
          {p.name}
        </button>
      {/each}
      <button
        type="button"
        class="chip"
        class:on={filterProjectIds.has(NO_PROJECT)}
        onclick={() => toggleProject(NO_PROJECT)}
      >
        No project
      </button>
    </div>

    <div class="filter-row">
      <span class="filter-label">Tags</span>
      {#each store.tags as t (t.id)}
        <button
          type="button"
          class="chip"
          class:on={filterTagIds.has(t.id)}
          onclick={() => toggleTag(t.id)}
        >
          {t.name}
        </button>
      {/each}
      {#if anyFilter}
        <button class="clear" onclick={clearFilters}>Clear all</button>
      {/if}
    </div>
  </div>

  <div class="scroll">
    {#each groups as g (g.dayISO)}
      <section class="day-group">
        <header class="day-head">
          <h3>{dayHeading(g.dayISO)}</h3>
          <span class="day-total">{formatDuration(g.total)}</span>
        </header>

        {#each g.entries as e (e.id)}
          {@const project = projectFor(e)}
          <button class="row" class:selected={selectedId === e.id} onclick={(ev) => select(e.id, ev)}>
            <span
              class="dot"
              style:background={project?.color ?? 'var(--border)'}
            ></span>
            <span class="desc">{e.description || 'No description'}</span>

            <span class="tags">
              {#each tagNames(e) as name (name)}
                <span class="tag">{name}</span>
              {/each}
            </span>

            {#if project}
              <span class="project" style:color={project.color}>
                {project.name}
              </span>
            {/if}

            <span class="range">
              {formatClock(dateToMinutes(e.start))} – {formatClock(
                dateToMinutes(e.end),
              )}
            </span>
            <span class="dur">{formatDuration(durationMin(e))}</span>
          </button>
        {/each}
      </section>
    {/each}

    {#if groups.length === 0}
      <p class="empty">
        {anyFilter
          ? 'No entries match the selected filters.'
          : 'No entries in this range yet.'}
      </p>
    {/if}
  </div>
</div>

{#if selectedEntry}
  <EditPopover
    entry={selectedEntry}
    projects={store.projects}
    tags={store.tags}
    pos={editorPos}
    onCreateTag={(name) => store.addTag({ name })}
    onChange={(patch) => store.update(selectedEntry.id, patch)}
    onDelete={() => {
      store.remove(selectedEntry.id);
      selectedId = null;
    }}
    onClose={() => (selectedId = null)}
  />
{/if}

<style>
  .list-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
  }
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .filter-label {
    font-size: 13px;
    color: var(--muted);
    width: 56px;
    flex: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
  }
  .chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .chip.on {
    background: color-mix(in srgb, var(--accent) 15%, white);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .clear {
    border: none;
    background: none;
    color: var(--accent);
    font-size: 12px;
    margin-left: 4px;
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0 40px;
  }
  .day-group {
    margin-bottom: 8px;
  }
  .day-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 20px 4px;
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .day-head h3 {
    margin: 0;
    font-size: 14px;
  }
  .day-total {
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--grid-line);
    padding: 10px 20px;
    font: inherit;
    color: inherit;
  }
  .row:hover {
    background: var(--bg);
  }
  .row.selected {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .desc {
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }
  .tag {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--muted);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .project {
    font-size: 12px;
    font-weight: 600;
    flex: none;
  }
  .range {
    font-size: 12px;
    color: var(--muted);
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .dur {
    font-size: 13px;
    font-weight: 600;
    flex: none;
    min-width: 64px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    padding: 40px 0;
  }
</style>
