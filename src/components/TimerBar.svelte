<script>
  import { store } from '../data/store.js';
  import { formatDuration, startOfDay } from '../lib/time.js';
  import Icon from '../lib/Icon.svelte';

  let description = $state('');
  let descInput;
  // A timer needs a description before it can start; manual drag-created entries
  // (on the timeline) don't, by design.
  let canStart = $derived(!!running || description.trim() !== '');

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
      const desc = description.trim();
      if (!desc) {
        descInput?.focus();
        return;
      }
      await store.create({
        description: desc,
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
    bind:this={descInput}
    bind:value={description}
    onchange={() => running && store.update(running.id, { description })}
  />
  <span class="clock" class:active={!!running}>{formatDuration(elapsedMin)}</span>
  <button class="toggle" class:running type="submit" disabled={!canStart}>
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
  /* The whole pill carries the accent focus indication, so the borderless
     field inside it stays clean (no inner box or ring from the global rule). */
  .timer-bar:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .desc {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    padding: 0;
    font-size: 15px;
    background: transparent;
  }
  .desc:focus {
    box-shadow: none;
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
    line-height: 1;
    color: white;
    background: var(--accent);
  }
  .toggle.running {
    background: #e74c3c;
  }
  .toggle:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
