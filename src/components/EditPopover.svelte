<script>
  import { startOfDay } from '../lib/time.js';

  /**
   * Small editor for a single entry. Emits granular patches via `onChange`
   * so the store/repository sees the same shape of update regardless of which
   * field changed.
   */
  let { entry, projects = [], pos = { x: 0, y: 0 }, onChange, onDelete, onClose } =
    $props();

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

  /** Focus the field when the editor opens. */
  function autofocus(node) {
    node.focus();
    node.select?.();
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
    use:autofocus
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
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .desc {
    width: 100%;
    border: none;
    border-bottom: 2px solid var(--border);
    padding: 4px 0;
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
    border-radius: 6px;
    padding: 4px 6px;
    background: var(--surface);
  }
  .times {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .times input {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 6px;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
  }
  .delete {
    background: none;
    border: none;
    color: #d63031;
    font-size: 13px;
    padding: 4px;
  }
  .done {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
  }
</style>
