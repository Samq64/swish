<script>
  import { store } from '../data/store.js';
  import { formatDuration } from '../lib/time.js';

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

  $effect(() => {
    // Keep the input in sync when a running entry exists.
    if (running) description = running.description;
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
    {running ? 'Stop' : 'Start'}
  </button>
</form>

<style>
  .timer-bar {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px 6px 6px 14px;
  }
  .desc {
    flex: 1;
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
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    font-weight: 600;
    color: white;
    background: var(--accent);
  }
  .toggle.running {
    background: #e74c3c;
  }
</style>
