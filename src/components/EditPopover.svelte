<script>
  import { startOfDay } from '../lib/time.js';
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
    pos = { x: 0, y: 0 },
    running = false,
    onChange,
    onCreateTag,
    onStop,
    onDelete,
    onClose,
  } = $props();

  let dragDelta = $state({ x: 0, y: 0 });
  let grabState = null;

  let finalX = $derived((pos?.x ?? 0) + dragDelta.x);
  let finalY = $derived((pos?.y ?? 0) + dragDelta.y);

  // Reset drag offset whenever the anchor changes (new entry selected).
  $effect(() => {
    pos.x + pos.y;
    dragDelta = { x: 0, y: 0 };
  });

  function startDrag(e) {
    if (e.button !== 0) return;
    grabState = { startX: e.clientX, startY: e.clientY, dx: dragDelta.x, dy: dragDelta.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e) {
    if (!grabState) return;
    dragDelta = {
      x: grabState.dx + e.clientX - grabState.startX,
      y: grabState.dy + e.clientY - grabState.startY,
    };
  }
  function endDrag() { grabState = null; }

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
  style:left="{finalX}px"
  style:top="{finalY}px"
  role="dialog"
  aria-label="Edit time entry"
>
  <div
    class="drag-handle"
    onpointerdown={startDrag}
    onpointermove={moveDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
    aria-hidden="true"
  ></div>
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
  .drag-handle {
    height: 6px;
    margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) var(--space-2);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    cursor: grab;
    background: repeating-linear-gradient(
      90deg,
      var(--border) 0,
      var(--border) 2px,
      transparent 2px,
      transparent 6px
    );
    opacity: 0.6;
  }
  .drag-handle:active {
    cursor: grabbing;
    opacity: 1;
  }

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
