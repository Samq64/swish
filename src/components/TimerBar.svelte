<script>
  import { store } from '../data/store.js';
  import { formatDuration, startOfDay } from '../lib/time.js';
  import Icon from '../lib/Icon.svelte';

  let description = $state('');

  // Tick once a second so the running clock updates.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  let running = $derived(store.runningEntry);

  let elapsedMin = $derived(
    running ? (now - new Date(running.start).getTime()) / 60000 : 0,
  );

  // Sync description from the running entry; clear when there's none (handles
  // workspace switches where the running entry changes or disappears).
  $effect(() => {
    store.currentWorkspaceId; // invalidate when workspace switches
    description = store.runningEntry?.description ?? '';
  });

  // Auto-stop the timer at midnight if it was started on a previous day.
  $effect(() => {
    if (!running || !now) return;
    const startDay = startOfDay(new Date(running.start));
    const todayDay = startOfDay(new Date(now));
    if (todayDay.getTime() > startDay.getTime()) {
      const midnight = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);
      store.stop(running.id, midnight.toISOString());
    }
  });

  async function toggle() {
    if (running) {
      await store.stop(running.id);
      description = '';
    } else {
      await store.create({
        description,
        projectId: null,
        start: new Date().toISOString(),
        end: null,
      });
    }
  }
</script>

<form
  class="timer-bar"
  onsubmit={(e) => {
    e.preventDefault();
    toggle();
  }}
>
  <input
    class="desc"
    type="text"
    placeholder="What are you working on?"
    bind:value={description}
    oninput={() => running && store.update(running.id, { description })}
  />
  <span class="clock" class:active={!!running}>{formatDuration(elapsedMin)}</span>
  <button class="toggle" class:running type="submit">
    <Icon name={running ? 'square' : 'play'} size={15} />
    {running ? 'Stop' : 'Start'}
  </button>
</form>

<style>
  .timer-bar {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  }
  .desc {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    font-size: 15px;
    background: transparent;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    color: var(--muted);
  }
  .clock.active {
    color: var(--text);
    font-weight: 600;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: none;
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-weight: 600;
    color: white;
    background: var(--accent);
  }
  .toggle.running {
    background: #e74c3c;
  }
</style>
