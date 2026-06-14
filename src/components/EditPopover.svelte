<script>
  import { startOfDay, clamp } from '../lib/time.js';
  import { autofocus } from '../lib/actions.js';
  import TagCombobox from './TagCombobox.svelte';

  /**
   * Small editor for a single entry. Emits granular patches via `onChange`
   * so the store/repository sees the same shape of update regardless of which
   * field changed.
   */
  let {
    entry,
    projects = [],
    tags = [],
    anchor = null,
    bounds = null,
    running = false,
    onChange,
    onCreateTag,
    onStop,
    onDelete,
    onClose,
  } = $props();

  const MARGIN = 8; // keep this far from every viewport edge
  const GAP = 8; // offset from the anchored entry block

  let el = $state(null);
  let coords = $state(null);

  // Sit beside the selected entry (its on-screen rect = `anchor`) without ever
  // covering it: prefer the right, flip left when the full width fits there,
  // and when neither side fits, stay pinned to the entry's edge on the roomier
  // side and run partially off-screen rather than overlap the entry. Vertically,
  // align to the entry top but clamp inside `bounds` (the viewport minus the
  // sticky header) so scrolling can't push the editor over the header UI.
  // Re-runs as `anchor`/`bounds` follow the entry during drags and scrolls.
  $effect(() => {
    if (!el || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;

    const rightX = anchor.right + GAP;
    const leftX = anchor.left - GAP - w;
    let x;
    if (rightX + w <= vw - MARGIN) {
      x = rightX; // fits fully to the right
    } else if (leftX >= MARGIN) {
      x = leftX; // fits fully to the left
    } else {
      // No full fit either side — overflow on the roomier side, off the entry.
      x = vw - anchor.right >= anchor.left ? rightX : leftX;
    }

    const top = (bounds?.top ?? 0) + MARGIN;
    const bottom = (bounds?.bottom ?? window.innerHeight) - MARGIN;
    const y = clamp(anchor.top, top, Math.max(top, bottom - h));
    coords = { x, y };
  });

  let assigned = $derived(new Set(entry.tagIds ?? []));

  function toggleTag(id) {
    const next = new Set(assigned);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange?.({ tagIds: [...next] });
  }

  async function createTag(name) {
    // Reuse an existing tag with the same name (case-insensitive) if present.
    const existing = tags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    const tag = existing ?? (await onCreateTag?.(name));
    if (tag && !assigned.has(tag.id)) {
      onChange?.({ tagIds: [...assigned, tag.id] });
    }
    return tag;
  }

  function isoToTimeInput(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
  }

  function timeInputToISO(value, referenceISO) {
    const [h, m] = value.split(':').map(Number);
    const d = startOfDay(referenceISO);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }
</script>

<div
  class="popover"
  bind:this={el}
  style:left="{coords?.x ?? 0}px"
  style:top="{coords?.y ?? 0}px"
  style:visibility={coords ? 'visible' : 'hidden'}
  role="dialog"
  aria-label="Edit time entry"
>
  <input
    class="desc"
    type="text"
    placeholder="Description"
    value={entry.description}
    oninput={(e) => onChange?.({ description: e.currentTarget.value })}
    use:autofocus={{ select: true }}
  />

  <label class="row">
    <span>Project</span>
    <select
      value={entry.projectId ?? ''}
      onchange={(e) =>
        onChange?.({ projectId: e.currentTarget.value || null })}
    >
      <option value="">No project</option>
      {#each projects as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
  </label>

  <div class="tags-field">
    <span class="label">Tags</span>
    <TagCombobox
      {tags}
      selectedIds={entry.tagIds ?? []}
      onToggle={toggleTag}
      onCreate={createTag}
    />
  </div>

  <div class="times">
    <input
      type="time"
      value={isoToTimeInput(entry.start)}
      onchange={(e) =>
        onChange?.({ start: timeInputToISO(e.currentTarget.value, entry.start) })}
    />
    <span>–</span>
    <input
      type="time"
      value={entry.end ? isoToTimeInput(entry.end) : ''}
      onchange={(e) =>
        onChange?.({ end: timeInputToISO(e.currentTarget.value, entry.start) })}
    />
  </div>

  <div class="actions">
    {#if running}
      <button class="stop-btn" type="button" onclick={() => onStop?.()}>
        Stop
      </button>
    {:else}
      <button class="delete" type="button" onclick={() => onDelete?.()}>
        Delete
      </button>
    {/if}
    <button class="done" type="button" onclick={() => onClose?.()}>Done</button>
  </div>
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    width: 240px;
    max-width: calc(100vw - 16px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Narrower on phones so it leaves more of the timeline visible beside the
     entry it's anchored to. */
  @media (max-width: 640px) {
    .popover {
      width: 200px;
    }
  }
  .desc {
    width: 100%;
    border: none;
    border-bottom: 2px solid var(--border);
    padding: var(--space-1) 0;
    font-size: 14px;
    font-weight: 600;
    outline: none;
  }
  .desc:focus {
    border-color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--muted);
  }
  .row select {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
  }
  .tags-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .tags-field .label {
    font-size: 13px;
    color: var(--muted);
  }
  .times {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
  }
  .times input {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
  }
  .stop-btn {
    background: none;
    border: none;
    color: #e74c3c;
    font-size: 13px;
    font-weight: 600;
    padding: var(--space-1);
  }
  .delete {
    background: none;
    border: none;
    color: #d63031;
    font-size: 13px;
    padding: var(--space-1);
  }
  .done {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-size: 13px;
  }
</style>
