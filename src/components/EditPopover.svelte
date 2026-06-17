<script>
  import { untrack } from 'svelte';
  import { startOfDay, clamp } from '../lib/time.js';
  import { autofocus, clickOutside } from '../lib/actions.js';
  import Icon from '../lib/Icon.svelte';
  import TagCombobox from './TagCombobox.svelte';

  /**
   * Small editor for a single entry. Edits are buffered locally and flushed as a
   * single `onChange` patch when the editor closes (see `commit` below), so an
   * editing session is one store/network update rather than one per field.
   */
  let {
    entry,
    projects = [],
    tags = [],
    anchor = null,
    bounds = null,
    running = false,
    readOnly = false,
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

  // Every edit is buffered in `draft` and persisted as ONE update only when the
  // editor closes (Done, switching entries, or unmount) — never per keystroke or
  // per field. That collapses an editing session into a single network request
  // and sidesteps the out-of-order PATCH races that made typing glitchy: nothing
  // round-trips while you edit, so a stale echo can't revert the field. `draft`
  // is the source of truth for every control here; the store (and the calendar)
  // only see the change on close. Seeded once from `entry`; parents key the
  // popover by entry id, so a fresh instance reseeds per entry and the close-time
  // flush stays bound to the right entry even when switching.
  const original = untrack(() => ({
    description: entry.description ?? '',
    projectId: entry.projectId ?? null,
    tagIds: [...(entry.tagIds ?? [])],
    start: entry.start,
    end: entry.end,
  }));
  let draft = $state({ ...original });

  let flushed = false;
  const sameTags = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
  function commit() {
    if (flushed) return; // close fires both Done's handler and the unmount cleanup
    flushed = true;
    const patch = {};
    if (draft.description !== original.description) patch.description = draft.description;
    if (draft.projectId !== original.projectId) patch.projectId = draft.projectId;
    if (!sameTags(draft.tagIds, original.tagIds)) patch.tagIds = draft.tagIds;
    if (draft.start !== original.start) patch.start = draft.start;
    if (draft.end !== original.end) patch.end = draft.end;
    if (Object.keys(patch).length) onChange?.(patch);
  }
  // Persist once when the editor closes or switches to another entry.
  $effect(() => commit);

  // Sit beside the selected entry (its on-screen rect = `anchor`) without ever
  // covering its information text: prefer the right of the block, flip left when
  // the full width fits there, then — for a block too wide to fit either side
  // (a full-width day-view entry) — overlap its empty right area, sitting just
  // past the text. Only when even that won't fit do we clamp to the roomier edge
  // and run partially off-screen. Vertically, align to the entry top but clamp
  // inside `bounds` (the viewport minus the sticky header) so scrolling can't
  // push the editor over the header UI. Re-runs as `anchor`/`bounds` follow the
  // entry during drags and scrolls.
  $effect(() => {
    if (!el || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;

    const rightX = anchor.right + GAP;
    const leftX = anchor.left - GAP - w;
    const contentX = (anchor.contentRight ?? anchor.left) + GAP;
    let x;
    if (rightX + w <= vw - MARGIN) {
      x = rightX; // fits fully to the right of the entry
    } else if (leftX >= MARGIN) {
      x = leftX; // fits fully to the left of the entry
    } else if (contentX + w <= vw - MARGIN) {
      // Wide entry (e.g. full-width day view): overlap the entry's empty right
      // area, just past the information text so it stays readable.
      x = contentX;
    } else {
      // No fit anywhere — pick the roomier side and clamp to the viewport so the
      // popover stays on-screen rather than running off the edge.
      x =
        vw - anchor.right >= anchor.left
          ? Math.min(rightX, vw - MARGIN - w) // right side, clamped
          : Math.max(leftX, MARGIN); // left side, clamped
    }

    const top = (bounds?.top ?? 0) + MARGIN;
    const bottom = (bounds?.bottom ?? window.innerHeight) - MARGIN;
    const y = clamp(anchor.top, top, Math.max(top, bottom - h));
    coords = { x, y };
  });

  let projectOpen = $state(false);
  let selectedProject = $derived(
    draft.projectId ? (projects.find((p) => p.id === draft.projectId) ?? null) : null,
  );
  // The whole editor takes on the entry's project colour: we override `--accent`
  // on the root so every control inside — the description underline, the project
  // picker, the tag chips, time-input focus and the Done button — themes to it,
  // since they all reference var(--accent). With no project we fall back to a
  // theme-aware gray and flip --on-accent (the glyph colour on accent fills) so
  // a check / button label stays readable on a light-gray accent in dark mode.
  let accent = $derived(selectedProject?.color ?? 'var(--no-project-accent)');
  let onAccent = $derived(
    selectedProject ? null : 'light-dark(#ffffff, #16161c)',
  );

  function pickProject(id) {
    draft.projectId = id;
    projectOpen = false;
  }

  let assigned = $derived(new Set(draft.tagIds));
  let assignedTags = $derived(tags.filter((t) => assigned.has(t.id)));

  function toggleTag(id) {
    draft.tagIds = assigned.has(id)
      ? draft.tagIds.filter((t) => t !== id)
      : [...draft.tagIds, id];
  }

  async function createTag(name) {
    // Reuse an existing tag with the same name (case-insensitive) if present.
    // A genuinely new tag must be created server-side now to obtain its id; only
    // its assignment to this entry is deferred to close like every other edit.
    const existing = tags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    const tag = existing ?? (await onCreateTag?.(name));
    if (tag && !assigned.has(tag.id)) {
      draft.tagIds = [...draft.tagIds, tag.id];
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
  style:--accent={accent}
  style:--on-accent={onAccent}
  style:left="{coords?.x ?? 0}px"
  style:top="{coords?.y ?? 0}px"
  style:visibility={coords ? 'visible' : 'hidden'}
  role="dialog"
  aria-label="Edit time entry"
>
  <input
    class="desc"
    type="text"
    placeholder="(No description)"
    bind:value={draft.description}
    readonly={readOnly}
    use:autofocus={{ select: true }}
  />

  <div class="field">
    <span class="label">Project</span>
    <div class="dropdown" use:clickOutside={() => (projectOpen = false)}>
      <button
        class="dd-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={projectOpen}
        disabled={readOnly}
        onclick={() => (projectOpen = !projectOpen)}
      >
        <span class="dot" style:background={selectedProject?.color ?? 'var(--no-project)'}></span>
        <span class="dd-name" class:none={!selectedProject}>
          {selectedProject?.name ?? 'No project'}
        </span>
        <span class="caret" class:open={projectOpen}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>

      {#if projectOpen}
        <div class="dd-panel dropdown-panel" role="listbox">
          <button
            class="option"
            class:current={!draft.projectId}
            role="option"
            aria-selected={!draft.projectId}
            onclick={() => pickProject(null)}
          >
            <span class="check">
              {#if !draft.projectId}<Icon name="check" size={14} />{/if}
            </span>
            <span class="dot" style:background="var(--no-project)"></span>
            <span class="opt-name none">No project</span>
          </button>
          {#each projects as p (p.id)}
            {@const isCurrent = p.id === draft.projectId}
            <button
              class="option"
              class:current={isCurrent}
              role="option"
              aria-selected={isCurrent}
              onclick={() => pickProject(p.id)}
            >
              <span class="check">
                {#if isCurrent}<Icon name="check" size={14} />{/if}
              </span>
              <span class="dot" style:background={p.color}></span>
              <span class="opt-name">{p.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="field">
    <span class="label">Tags</span>
    {#if readOnly}
      {#if assignedTags.length}
        <span class="ro-chips">
          {#each assignedTags as t (t.id)}<span class="tag-chip">{t.name}</span>{/each}
        </span>
      {:else}
        <span class="ro-none">No tags</span>
      {/if}
    {:else}
      <TagCombobox
        {tags}
        selectedIds={draft.tagIds}
        onToggle={toggleTag}
        onCreate={createTag}
      />
    {/if}
  </div>

  <div class="times">
    <input
      type="time"
      value={isoToTimeInput(draft.start)}
      readonly={readOnly}
      onchange={(e) =>
        (draft.start = timeInputToISO(e.currentTarget.value, draft.start))}
    />
    <span>–</span>
    <input
      type="time"
      value={draft.end ? isoToTimeInput(draft.end) : ''}
      readonly={readOnly}
      onchange={(e) =>
        (draft.end = timeInputToISO(e.currentTarget.value, draft.start))}
    />
  </div>

  <div class="actions">
    {#if readOnly}
      <span class="ro-note">Read-only</span>
    {:else if running}
      <button class="stop-btn" type="button" onclick={() => onStop?.()}>
        Stop
      </button>
    {:else}
      <button
        class="delete"
        type="button"
        onclick={() => {
          flushed = true; // the entry is going away — don't persist buffered edits
          onDelete?.();
        }}
      >
        Delete
      </button>
    {/if}
    <button class="done" type="button" onclick={() => { commit(); onClose?.(); }}>
      {readOnly ? 'Close' : 'Done'}
    </button>
  </div>
</div>

<style>
  .popover {
    position: fixed;
    z-index: 50;
    width: clamp(200px, calc(100vw - 80px), 240px);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Underline-only field: opt out of the global boxed input look (no box, no
     fill, no focus ring) and keep the clean bottom rule. */
  .desc {
    width: 100%;
    border: none;
    border-bottom: 2px solid var(--border);
    border-radius: 0;
    padding: var(--space-1) 0;
    font-size: 14px;
    font-weight: 600;
    background: transparent;
    outline: none;
  }
  .desc:focus {
    border-color: var(--accent);
    box-shadow: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field .label {
    font-size: 13px;
    color: var(--muted);
  }

  /* Custom project picker — mirrors the workspace switcher's trigger + panel
     look rather than the native <select>, so the menu can show project colours
     and a check on the current choice. */
  .dropdown {
    position: relative;
  }
  .dd-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    font-size: 14px;
    color: var(--text);
    text-align: left;
  }
  .dd-trigger:hover {
    border-color: var(--accent);
  }
  .dd-trigger[aria-expanded='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .dd-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dd-name.none,
  .opt-name.none {
    color: var(--muted);
  }
  .caret {
    flex: none;
  }
  .dd-panel {
    right: 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-align: left;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    font: inherit;
    color: inherit;
  }
  .option:hover {
    background: var(--bg);
  }
  .option.current {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }
  .opt-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check {
    width: 14px;
    flex: none;
    display: inline-flex;
    justify-content: center;
    color: var(--accent);
  }
  .dot {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 50%;
  }
  .ro-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .ro-none {
    font-size: 13px;
    color: var(--muted);
  }
  .ro-note {
    font-size: 12px;
    color: var(--muted);
    align-self: center;
  }
  .times {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
  }
  /* Two native time inputs (each with an AM/PM segment + picker icon) plus the
     dash are wider than the popover at their intrinsic size, so the end input
     used to spill past the right edge. Let them share the row equally and shrink
     to fit; tighter side padding keeps the glyphs and picker icon readable. */
  .times input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-1);
    font-size: 13px;
  }
  .times span {
    flex: none;
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
    color: var(--danger);
    font-size: 13px;
    padding: var(--space-1);
  }
  .done {
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-4);
    font-size: 13px;
  }
</style>
