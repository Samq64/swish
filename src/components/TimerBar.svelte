<script>
  import { store } from '../data/store.js';
  import { formatDuration, startOfDay } from '../lib/time.js';
  import Icon from '../lib/Icon.svelte';
  import VoiceInput from './VoiceInput.svelte';
  import { parseEntry } from '../lib/parse-entry.js';

  let description = $state('');
  let descInput;

  let running = $derived(store.runningEntry);

  // A timer needs a description before it can start; manual drag-created entries
  // (on the timeline) don't, by design.
  let canStart = $derived(!!running || description.trim() !== '');

  // Tick once a second so the running clock updates.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  let elapsedMin = $derived(running ? (now - new Date(running.start).getTime()) / 60000 : 0);

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

  // --- toast (auto-created entry confirmation) --------------------------------

  let toast = $state(/** @type {{ entryId: string, text: string } | null} */ (null));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer;

  function showToast(entryId, text) {
    clearTimeout(toastTimer);
    toast = { entryId, text };
    toastTimer = setTimeout(() => (toast = null), 8000);
  }

  async function undoToast() {
    clearTimeout(toastTimer);
    if (toast) await store.remove(toast.entryId);
    toast = null;
  }

  function fmtTime(iso) {
    return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(iso)
    );
  }

  function fmtDay(iso) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(d);
  }

  // --- voice ------------------------------------------------------------------

  // While the model downloads / transcribes, VoiceInput needs the bar's width
  // for its status line; hide the other controls but keep VoiceInput mounted
  // (unmounting it would kill the in-flight worker).
  let voiceBusy = $state(false);

  async function handleTranscript(text) {
    const parsed = parseEntry(text, new Date(), store.projects);
    if (parsed) {
      const entry = await store.create({ ...parsed, tagIds: [] });
      const desc = parsed.description || '(No description)';
      const proj = parsed.projectId ? store.projectsById.get(parsed.projectId)?.name : null;
      const parts = [desc, `${fmtTime(parsed.start)}–${fmtTime(parsed.end)}`, fmtDay(parsed.start)];
      if (proj) parts.push(proj);
      showToast(entry.id, parts.join(' · '));
    } else {
      description = description.trim() ? `${description.trim()} ${text}` : text;
      if (running) store.update(running.id, { description });
    }
  }

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
    if (!toast) toggle();
  }}
>
  {#if toast}
    <span class="toast-text">{toast.text}</span>
    <button class="toast-undo" type="button" onclick={undoToast}>Undo</button>
  {:else}
    <input
      class="desc"
      type="text"
      placeholder="What are you working on?"
      bind:this={descInput}
      bind:value={description}
      hidden={voiceBusy}
      onchange={() => running && store.update(running.id, { description })}
    />
    <VoiceInput ontranscript={handleTranscript} onbusy={(b) => (voiceBusy = b)} />
    {#if !voiceBusy}
      <span class="clock" class:active={!!running}>{formatDuration(elapsedMin)}</span>
      <button class="toggle" class:running type="submit" disabled={!canStart}>
        <Icon name={running ? 'square' : 'play'} size={15} />
        {running ? 'Stop' : 'Start'}
      </button>
    {/if}
  {/if}
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
  .toast-text {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .toast-undo {
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    padding: var(--space-1) var(--space-3);
  }
  .toast-undo:hover {
    background: var(--bg);
  }
</style>
