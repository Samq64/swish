<script>
  import { fade } from 'svelte/transition';
  import { untrack } from 'svelte';
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
  import TeamModal from '../components/TeamModal.svelte';

  let { data } = $props();
  // One-time seed from the server load; intentionally reads the initial `data`
  // only (untrack), and stays synchronous so the page server-renders with
  // content rather than the not-ready placeholder.
  untrack(() => store.hydrate(data));

  // Reflect the user's theme onto <html>; 'auto' drops the attribute so app.css
  // falls back to the OS preference.
  $effect(() => {
    const el = document.documentElement;
    if (store.theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', store.theme);
  });

  let showProjects = $state(false);
  let showTags = $state(false);
  let showSettings = $state(false);
  let showWorkspaces = $state(false);
  let showTeam = $state(false);

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

  // Owner of the currently-viewed shared workspace (null when viewing your own).
  let sharedOwner = $derived(
    store.sharedWorkspaces.find((w) => w.id === store.currentWorkspaceId)?.ownerUsername ?? null,
  );

  // Total tracked minutes across the visible range (completed entries only).
  // `stableTotalMin` is the last value computed from a fully-loaded range so we
  // can fall back to it while a new range is loading (avoids the flash of a
  // wrong intermediate total when the view range expands, e.g. day → week).
  let stableTotalMin = $state(0);

  let totalMin = $derived.by(() => {
    const from = new Date(store.rangeStart).getTime();
    const to = new Date(store.rangeEnd).getTime();
    // Entries cover the visible range only when the loaded range is at least as
    // wide. If they're stale (loaded for a narrower range), fall back to the
    // last stable value so we don't briefly show a too-small total.
    const covered =
      store.loadedRangeStart !== null &&
      new Date(store.loadedRangeStart).getTime() <= from &&
      new Date(store.loadedRangeEnd).getTime() >= to;
    if (!covered) return stableTotalMin;
    return store.entries
      .filter((e) => {
        if (!e.end) return false;
        const t = new Date(e.start).getTime();
        return t >= from && t < to;
      })
      .reduce((sum, e) => sum + entryDurationMin(e), 0);
  });

  $effect(() => {
    if (!store.loading) stableTotalMin = totalMin;
  });
</script>

<svelte:head>
  <title>Time Tracker</title>
</svelte:head>

{#if !store.ready}
  <!-- Loading the signed-in user's data; hooks.server.js already gated access. -->
{:else}
<header class="topbar">
  <WorkspaceSelector
    onOpenSettings={() => (showSettings = true)}
    onManageWorkspaces={() => (showWorkspaces = true)}
    onOpenTeam={() => (showTeam = true)}
  />
  <div class="timer-slot">
    {#if store.readOnly}
      <div class="readonly-banner" role="status">
        <Icon name="users" size={15} />
        <span>Read-only{sharedOwner ? ` · shared by ${sharedOwner}` : ''}</span>
      </div>
    {:else}
      <TimerBar />
    {/if}
  </div>
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

  <div
    class="seg"
    role="group"
    aria-label="View"
    style="--seg-active: {store.view === 'week' ? 0 : store.view === 'day' ? 1 : 2}; --seg-count: 3"
  >
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

<main class="fill-col view-host">
  {#key store.view}
    <div class="fill-col view-layer" in:fade={{ duration: 160 }} out:fade={{ duration: 160 }}>
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
{#if showTeam}
  <TeamModal onClose={() => (showTeam = false)} />
{/if}
{/if}

<style>
  :global(body) {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }
  :global(#app) {
    display: flex;
    flex-direction: column;
    height: 100dvh;
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
     their size; min-width:0 lets it actually shrink (not just its input).
     min-height encodes the timer bar's exact border-box height so the topbar
     stays the same height in read-only mode (no timer bar present):
       timer-bar border (2px) + outer padding (space-1 × 2)
       + toggle padding (space-2 × 2) + 1em (toggle line-height is 1).
     align-self:stretch lets the readonly-banner fill that height via flex. */
  .timer-slot {
    flex: 1;
    min-width: 0;
    display: flex;
    align-self: stretch;
    min-height: calc(2px + var(--space-1) * 2 + var(--space-2) * 2 + 1em);
  }
  .readonly-banner {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
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
    padding: 6px var(--space-3);
    color: var(--text);
    line-height: 1;
  }
  .nav-btn:hover {
    background: var(--bg);
  }
  .date-input {
    background: var(--surface);
    padding: 6px var(--space-3);
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

  .seg {
    flex: none;
  }

  .view-host {
    position: relative;
  }
  .view-layer {
    position: absolute;
    inset: 0;
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
    .seg {
      order: -1;
      flex: 1;
      flex-basis: 100%;
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
