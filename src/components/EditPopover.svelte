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
    onChange,
    onCreateTag,
    onDelete,
    onClose,
  } = $props();

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
  style:left="{pos.x}px"
  style:top="{pos.y}px"
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
    <button class="delete" type="button" onclick={() => onDelete?.()}>
      Delete
    </button>
    <button class="done" type="button" onclick={() => onClose?.()}>Done</button>
  </div>
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    width: 240px;
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
