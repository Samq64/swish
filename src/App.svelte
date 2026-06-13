<script>
  import { store } from './data/store.js';
  import { formatDuration } from './lib/time.js';
  import { entryDurationMin } from './lib/entries.js';
  import TimerBar from './components/TimerBar.svelte';
  import WorkspaceSelector from './components/WorkspaceSelector.svelte';
  import TimelineView from './components/TimelineView.svelte';
  import ListView from './components/ListView.svelte';
  import ProjectsModal from './components/ProjectsModal.svelte';
  import TagsModal from './components/TagsModal.svelte';

  store.init();

  let showProjects = $state(false);
  let showTags = $state(false);

  // Range label: a single day, or "Jun 9 – 15" for a week.
  let rangeLabel = $derived.by(() => {
    const days = store.visibleDays;
    const fmt = (iso, opts) => new Date(iso).toLocaleDateString(undefined, opts);
    if (store.view === 'day') {
      return fmt(days[0], { weekday: 'long', month: 'short', day: 'numeric' });
    }
    const first = days[0];
    const last = days[days.length - 1];
    const sameMonth =
      new Date(first).getMonth() === new Date(last).getMonth();
    return `${fmt(first, { month: 'short', day: 'numeric' })} – ${fmt(
      last,
      sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' },
    )}`;
  });

  // Anchor formatted as YYYY-MM-DD for the date picker's value.
  let anchorInput = $derived.by(() => {
    const d = new Date(store.anchor);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  function pickDate(value) {
    if (!value) return; // ignore a cleared input
    const [y, m, d] = value.split('-').map(Number);
    store.goToDate(new Date(y, m - 1, d)); // local date, no UTC shift
  }

  // Total tracked minutes across the visible range (completed entries only).
  let totalMin = $derived(
    store.entries
      .filter((e) => e.end)
      .reduce((sum, e) => sum + entryDurationMin(e), 0),
  );
</script>

<header class="topbar">
  <WorkspaceSelector />
  <div class="timer-slot"><TimerBar /></div>
  <div class="topbar-actions">
    <button class="nav-btn" onclick={() => (showProjects = true)}>Projects</button>
    <button class="nav-btn" onclick={() => (showTags = true)}>Tags</button>
  </div>
</header>

<nav class="day-nav">
  <div class="nav-left">
    <button class="nav-btn" aria-label="Previous" onclick={() => store.shift(-1)}>
      ‹
    </button>
    <input
      class="date-input"
      type="date"
      aria-label="Go to date"
      value={anchorInput}
      onchange={(e) => pickDate(e.currentTarget.value)}
    />
    <button class="nav-btn" aria-label="Next" onclick={() => store.shift(1)}>
      ›
    </button>

    {#if store.view !== 'day'}
      <h2 class="range-label">{rangeLabel}</h2>
    {/if}
    <span class="total">{formatDuration(totalMin)} tracked</span>
  </div>

  <div class="view-toggle" role="group" aria-label="View">
    <button
      class:active={store.view === 'week'}
      onclick={() => store.setView('week')}
    >
      Week
    </button>
    <button class:active={store.view === 'day'} onclick={() => store.setView('day')}>
      Day
    </button>
    <button
      class:active={store.view === 'list'}
      onclick={() => store.setView('list')}
    >
      List
    </button>
  </div>
</nav>

<main class="timeline-wrap">
  {#if store.view === 'list'}
    <ListView />
  {:else}
    <TimelineView />
  {/if}
</main>

{#if showProjects}
  <ProjectsModal onClose={() => (showProjects = false)} />
{/if}
{#if showTags}
  <TagsModal onClose={() => (showTags = false)} />
{/if}

<style>
  :global(body) {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  :global(#app) {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .topbar-actions {
    display: flex;
    gap: var(--space-2);
    flex: none;
  }
  /* The timer absorbs the topbar's spare/short space so the buttons keep
     their size; min-width:0 lets it actually shrink (not just its input). */
  .timer-slot {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  /* Match the taller timer bar so the header controls line up. */
  .topbar-actions .nav-btn {
    padding: var(--space-2) var(--space-3);
  }
  .day-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .nav-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .nav-btn {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    color: var(--text);
    line-height: 1;
  }
  .nav-btn:hover {
    background: var(--bg);
  }
  .date-input {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    color: var(--text);
    font-size: 14px;
  }
  .range-label {
    margin: 0 0 0 var(--space-1);
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .view-toggle {
    flex: none;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .view-toggle button {
    border: none;
    background: var(--surface);
    padding: var(--space-1) var(--space-3);
    color: var(--muted);
    font-weight: 600;
  }
  .view-toggle button + button {
    border-left: 1px solid var(--border);
  }
  .view-toggle button.active {
    background: var(--accent);
    color: white;
  }

  .total {
    color: var(--muted);
    font-size: 13px;
    white-space: nowrap;
  }
  /* Separator dot only when the range label precedes the total (week/list). */
  .range-label + .total::before {
    content: '·';
    margin-right: var(--space-2);
  }

  .timeline-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Day-nav: drop the view toggle to its own full-width row before the
     single-row layout gets cramped enough to elide the date range. The left
     group also wraps so the date nav + range + total never overflow. */
  @media (max-width: 768px) {
    .day-nav {
      flex-wrap: wrap;
      row-gap: var(--space-2);
    }
    .nav-left {
      flex-wrap: wrap;
      flex-basis: 100%;
    }
    .view-toggle {
      flex: 1;
    }
    .view-toggle button {
      flex: 1;
    }
  }

  /* Phone: workspace + Projects/Tags on the first row, timer full-width below
     (gutters tighten in app.css; the timeline scrolls sideways). */
  @media (max-width: 640px) {
    .topbar {
      flex-wrap: wrap;
    }
    .timer-slot {
      order: 3;
      flex-basis: 100%;
    }
  }
</style>
