<script>
  import { fade } from 'svelte/transition';
  import { store } from '../data/store.js';
  import { formatDuration } from '../lib/time.js';
  import { entryDurationMin } from '../lib/entries.js';
  import Icon from '../lib/Icon.svelte';
  import TimerBar from '../components/TimerBar.svelte';
  import WorkspaceSelector from '../components/WorkspaceSelector.svelte';
  import TimelineView from '../components/TimelineView.svelte';
  import ListView from '../components/ListView.svelte';
  import ProjectsModal from '../components/ProjectsModal.svelte';
  import TagsModal from '../components/TagsModal.svelte';
  import SettingsModal from '../components/SettingsModal.svelte';
  import WorkspacesModal from '../components/WorkspacesModal.svelte';

  store.bootstrap();

  let showProjects = $state(false);
  let showTags = $state(false);
  let showSettings = $state(false);
  let showWorkspaces = $state(false);

  // Range label: a single day, or "Jun 7 – 13" for a week (month always first).
  let rangeLabel = $derived.by(() => {
    const days = store.visibleDays;
    if (store.view === 'day') {
      return new Date(days[0]).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }
    const first = days[0];
    const last = days[days.length - 1];
    const sameMonth = new Date(first).getMonth() === new Date(last).getMonth();
    const mo = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short' });
    const d = (iso) => new Date(iso).getDate();
    return sameMonth
      ? `${mo(first)} ${d(first)} – ${d(last)}`
      : `${mo(first)} ${d(first)} – ${mo(last)} ${d(last)}`;
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

<svelte:head>
  <title>Time Tracker</title>
</svelte:head>

{#if !store.ready}
  <!-- Loading the signed-in user's data; the middleware already gated access. -->
{:else}
<header class="topbar">
  <WorkspaceSelector
    onOpenSettings={() => (showSettings = true)}
    onManageWorkspaces={() => (showWorkspaces = true)}
  />
  <div class="timer-slot"><TimerBar /></div>
  <div class="topbar-actions">
    <button class="nav-btn" onclick={() => (showProjects = true)}>Projects</button>
    <button class="nav-btn" onclick={() => (showTags = true)}>Tags</button>
  </div>
</header>

<nav class="day-nav">
  <div class="nav-left">
    <button class="nav-btn" aria-label="Previous" onclick={() => store.shift(-1)}>
      <Icon name="chevron-left" />
    </button>
    <input
      class="date-input"
      type="date"
      aria-label="Go to date"
      value={anchorInput}
      onchange={(e) => pickDate(e.currentTarget.value)}
    />
    <button class="nav-btn" aria-label="Next" onclick={() => store.shift(1)}>
      <Icon name="chevron-right" />
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
  {#key store.view}
    <div class="view-fade" in:fade={{ duration: 140 }}>
      {#if store.view === 'list'}
        <ListView />
      {:else}
        <TimelineView />
      {/if}
    </div>
  {/key}
</main>

{#if showProjects}
  <ProjectsModal onClose={() => (showProjects = false)} />
{/if}
{#if showTags}
  <TagsModal onClose={() => (showTags = false)} />
{/if}
{#if showSettings}
  <SettingsModal onClose={() => (showSettings = false)} />
{/if}
{#if showWorkspaces}
  <WorkspacesModal onClose={() => (showWorkspaces = false)} />
{/if}
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
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

  .view-fade {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* On narrow windows, move the view toggle above the date controls so it's
     always visible at the top of the nav row. */
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
      order: -1;
      flex: 1;
      flex-basis: 100%;
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
