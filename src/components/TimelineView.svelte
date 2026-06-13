<script>
  import { store } from '../data/store.js';
  import { minutesToPx, MINUTES_PER_DAY, startOfDay, clamp } from '../lib/time.js';
  import DayColumn from './DayColumn.svelte';
  import EditPopover from './EditPopover.svelte';

  /**
   * Renders the visible range as a row of {@link DayColumn}s sharing one hour
   * gutter and one entry editor. Works for both day (1 column) and week
   * (7 columns) views — it just maps over `store.visibleDays`.
   */

  let selectedId = $state(null);
  let editorPos = $state({ x: 0, y: 0 });

  let selectedEntry = $derived(
    selectedId
      ? (store.entries.find((e) => e.id === selectedId) ?? null)
      : null,
  );

  const hours = Array.from({ length: 24 }, (_, h) => h);

  function hourLabel(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  function dayName(iso) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  }
  function dayNum(iso) {
    return new Date(iso).getDate();
  }
  function isToday(iso) {
    return startOfDay(iso).getTime() === startOfDay(new Date()).getTime();
  }

  function handleSelect(id, event) {
    selectedId = id;
    if (!id) return;
    const margin = 12;
    const x = clamp((event?.clientX ?? 200) + margin, 8, window.innerWidth - 260);
    const y = clamp((event?.clientY ?? 120) - 20, 8, window.innerHeight - 260);
    editorPos = { x, y };
  }
</script>

<div class="view">
  <div class="scroll">
    <!-- Day headers live INSIDE the scroller so they share the body's exact
         column widths (scrollbar included) and stay aligned; `sticky` keeps
         them pinned to the top while the timeline scrolls. Redundant in day
         view, where the nav already shows the date. -->
    {#if store.view !== 'day'}
      <div class="header-row">
        <div class="gutter-spacer"></div>
        {#each store.visibleDays as iso (iso)}
          <div class="day-head" class:today={isToday(iso)}>
            <span class="dow">{dayName(iso)}</span>
            <span class="dom">{dayNum(iso)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="body" style:height="{minutesToPx(MINUTES_PER_DAY)}px">
      <div class="gutter">
        {#each hours as h (h)}
          <div
            class="hour-label"
            class:first={h === 0}
            style:top="{minutesToPx(h * 60)}px"
          >
            {hourLabel(h)}
          </div>
        {/each}
      </div>

      {#each store.visibleDays as iso (iso)}
        <DayColumn dayISO={iso} {selectedId} onSelect={handleSelect} />
      {/each}
    </div>
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
  .view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
  }

  .header-row {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .gutter-spacer {
    width: 56px;
    flex: none;
  }
  .day-head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    border-left: 1px solid var(--border);
  }
  .day-head .dow {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .day-head .dom {
    font-size: 16px;
    font-weight: 600;
  }
  .day-head.today .dom {
    color: white;
    background: var(--accent);
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .body {
    display: flex;
    position: relative;
  }
  .gutter {
    width: 56px;
    flex: none;
    position: relative;
  }
  .hour-label {
    position: absolute;
    right: 6px;
    transform: translateY(-7px);
    text-align: right;
    font-size: 11px;
    color: var(--muted);
  }
  /* The topmost label has no gridline above it; nudge it down so "12 AM"
     sits just below the top edge instead of poking under the header. */
  .hour-label.first {
    transform: translateY(2px);
  }
</style>
