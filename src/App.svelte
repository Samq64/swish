<script>
  import { store } from './data/store.js';
  import { formatDuration } from './lib/time.js';
  import TimerBar from './components/TimerBar.svelte';
  import DayTimeline from './components/DayTimeline.svelte';

  store.init();

  let dayLabel = $derived(
    new Date(store.selectedDay).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }),
  );

  // Total tracked minutes for the visible day (completed entries only).
  let totalMin = $derived(
    store.entries
      .filter((e) => e.end)
      .reduce(
        (sum, e) =>
          sum + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000,
        0,
      ),
  );
</script>

<header class="topbar">
  <div class="brand">swish</div>
  <TimerBar />
</header>

<nav class="day-nav">
  <button class="nav-btn" aria-label="Previous day" onclick={() => store.shiftDay(-1)}>
    ‹
  </button>
  <button class="nav-btn today" onclick={() => store.loadDay(new Date().toISOString())}>
    Today
  </button>
  <button class="nav-btn" aria-label="Next day" onclick={() => store.shiftDay(1)}>
    ›
  </button>
  <h2 class="day-label">{dayLabel}</h2>
  <span class="day-total">{formatDuration(totalMin)} tracked</span>
</nav>

<main class="timeline-wrap">
  <DayTimeline />
</main>

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
  .day-label {
    margin: 0 0 0 8px;
    font-size: 16px;
    font-weight: 600;
  }
  .day-total {
    margin-left: auto;
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
