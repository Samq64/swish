<script>
  import { store } from './data/store.js';
  import { formatDuration, addDays } from './lib/time.js';
  import TimerBar from './components/TimerBar.svelte';
  import TimelineView from './components/TimelineView.svelte';
  import ProjectsModal from './components/ProjectsModal.svelte';

  store.init();

  let showProjects = $state(false);

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

  // Total tracked minutes across the visible range (completed entries only).
  let totalMin = $derived(
    store.entries
      .filter((e) => e.end)
      .reduce(
        (sum, e) =>
          sum +
          (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000,
        0,
      ),
  );
</script>

<header class="topbar">
  <div class="brand">swish</div>
  <TimerBar />
</header>

<nav class="day-nav">
  <button class="nav-btn" aria-label="Previous" onclick={() => store.shift(-1)}>
    ‹
  </button>
  <button class="nav-btn today" onclick={() => store.goToday()}>Today</button>
  <button class="nav-btn" aria-label="Next" onclick={() => store.shift(1)}>
    ›
  </button>
  <h2 class="range-label">{rangeLabel}</h2>

  <div class="view-toggle" role="group" aria-label="View">
    <button class:active={store.view === 'day'} onclick={() => store.setView('day')}>
      Day
    </button>
    <button
      class:active={store.view === 'week'}
      onclick={() => store.setView('week')}
    >
      Week
    </button>
  </div>

  <button class="nav-btn projects" onclick={() => (showProjects = true)}>
    Projects
  </button>
  <span class="total">{formatDuration(totalMin)} tracked</span>
</nav>

<main class="timeline-wrap">
  <TimelineView />
</main>

{#if showProjects}
  <ProjectsModal onClose={() => (showProjects = false)} />
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
    gap: 16px;
    padding: 12px 20px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 800;
    font-size: 18px;
    color: var(--accent);
    letter-spacing: -0.02em;
  }

  .day-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .nav-btn {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 5px 12px;
    color: var(--text);
    line-height: 1;
  }
  .nav-btn:hover {
    background: var(--bg);
  }
  .range-label {
    margin: 0 0 0 8px;
    font-size: 16px;
    font-weight: 600;
  }

  .view-toggle {
    margin-left: 16px;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .view-toggle button {
    border: none;
    background: var(--surface);
    padding: 5px 14px;
    color: var(--muted);
    font-weight: 600;
  }
  .view-toggle button.active {
    background: var(--accent);
    color: white;
  }

  .projects {
    margin-left: auto;
  }
  .total {
    color: var(--muted);
    font-size: 13px;
  }

  .timeline-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
