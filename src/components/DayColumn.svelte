<script>
  import { store } from '../data/store.js';
  import {
    MINUTES_PER_DAY,
    MIN_DURATION,
    minutesToPx,
    pxToMinutes,
    snap,
    clamp,
    startOfDay,
    minutesToISO,
    packLanes,
  } from '../lib/time.js';
  import TimeEntryBlock from './TimeEntryBlock.svelte';

  /**
   * One day of the timeline. Owns every pointer gesture for its own day:
   *
   *   • drag on empty space   -> create a new entry
   *   • drag an entry's edges -> resize (extend / shrink) it
   *   • drag an entry's body  -> move it (within the day)
   *
   * Selection is bubbled up via `onSelect` so a single editor can be shared
   * across all columns in the week.
   */
  let { dayISO, selectedId = null, onSelect } = $props();

  let gridEl;

  /** Live drag gesture, or null. @type {null | any} */
  let drag = $state(null);

  /**
   * Lane layout snapshotted when a move/resize starts. While set, neighbours
   * keep their columns instead of reshuffling under the dragged block.
   * @type {null | Map<string, {lane: number, lanes: number}>}
   */
  let frozenLanes = $state(null);

  const hours = Array.from({ length: 24 }, (_, h) => h);

  let dayEntries = $derived(store.entriesForDay(dayISO));

  function toBlock(entry) {
    const dayStart = startOfDay(dayISO).getTime();
    const startMin = clamp(
      (new Date(entry.start).getTime() - dayStart) / 60000,
      0,
      MINUTES_PER_DAY,
    );
    const endMin = clamp(
      (new Date(entry.end).getTime() - dayStart) / 60000,
      0,
      MINUTES_PER_DAY,
    );
    return { id: entry.id, startMin, endMin };
  }

  let entriesById = $derived(new Map(dayEntries.map((e) => [e.id, e])));

  /**
   * Completed entries as timeline blocks. `order` is the creation-order index,
   * a stable key so lane columns don't swap when an entry is dragged. (The
   * running entry has no end and lives in the TimerBar.)
   */
  function baseBlocks() {
    return dayEntries
      .filter((e) => e.end)
      .map((e, i) => ({ ...toBlock(e), order: i }));
  }

  let blocks = $derived.by(() => {
    const arr = baseBlocks();
    // Freeze the layout during a move/resize so neighbours don't jump lanes.
    const lanes = frozenLanes ?? packLanes(arr);
    return arr.map((b) => {
      const placed = lanes.get(b.id) ?? { lane: 0, lanes: 1 };
      return drag && drag.entryId === b.id
        ? { ...b, startMin: drag.startMin, endMin: drag.endMin, ...placed }
        : { ...b, ...placed };
    });
  });

  // --- coordinate helpers ----------------------------------------------------

  function pointerMinutes(event) {
    const rect = gridEl.getBoundingClientRect();
    return clamp(pxToMinutes(event.clientY - rect.top), 0, MINUTES_PER_DAY);
  }

  function capture(event) {
    gridEl.setPointerCapture?.(event.pointerId);
  }

  // --- gesture starts --------------------------------------------------------

  function beginCreate(event) {
    if (event.button != null && event.button !== 0) return;
    // Let touch gestures scroll the timeline natively instead of drawing an
    // entry. (Move/resize still works on touch — those start on an entry.)
    if (event.pointerType === 'touch') return;
    const m = snap(pointerMinutes(event));
    drag = {
      mode: 'create',
      entryId: null,
      anchorMin: m,
      grabOffsetMin: 0,
      duration: 0,
      startMin: m,
      endMin: m,
      moved: false,
    };
    capture(event);
  }

  function beginEntryDrag(entry, mode, event) {
    const b = toBlock(entry);
    const m = pointerMinutes(event);
    // Snapshot the current layout so neighbours stay put for the whole gesture.
    frozenLanes = packLanes(baseBlocks());
    drag = {
      mode,
      entryId: entry.id,
      anchorMin: m,
      grabOffsetMin: m - b.startMin,
      duration: b.endMin - b.startMin,
      startMin: b.startMin,
      endMin: b.endMin,
      moved: false,
    };
    capture(event);
  }

  // --- live drag -------------------------------------------------------------

  function onPointerMove(event) {
    if (!drag) return;
    const m = pointerMinutes(event);
    const snapped = snap(m);
    if (Math.abs(m - drag.anchorMin) > 2) drag.moved = true;

    switch (drag.mode) {
      case 'create':
        drag.startMin = Math.min(drag.anchorMin, snapped);
        drag.endMin = Math.max(drag.anchorMin, snapped);
        break;
      case 'resize-end':
        drag.endMin = clamp(
          Math.max(snapped, drag.startMin + MIN_DURATION),
          0,
          MINUTES_PER_DAY,
        );
        break;
      case 'resize-start':
        drag.startMin = clamp(
          Math.min(snapped, drag.endMin - MIN_DURATION),
          0,
          MINUTES_PER_DAY,
        );
        break;
      case 'move': {
        const ns = clamp(
          snap(m - drag.grabOffsetMin),
          0,
          MINUTES_PER_DAY - drag.duration,
        );
        drag.startMin = ns;
        drag.endMin = ns + drag.duration;
        break;
      }
    }
  }

  // --- commit ----------------------------------------------------------------

  async function onPointerUp(event) {
    if (!drag) return;
    const d = drag;
    drag = null;
    frozenLanes = null;
    gridEl.releasePointerCapture?.(event.pointerId);

    if (d.mode === 'create') {
      if (d.endMin - d.startMin >= MIN_DURATION) {
        const entry = await store.create({
          description: '',
          projectId: null,
          start: minutesToISO(dayISO, d.startMin),
          end: minutesToISO(dayISO, d.endMin),
        });
        onSelect?.(entry.id, event);
      } else {
        // A plain click on empty space clears the selection.
        onSelect?.(null, event);
      }
      return;
    }

    if (d.entryId) {
      if (d.moved) {
        await store.update(d.entryId, {
          start: minutesToISO(dayISO, d.startMin),
          end: minutesToISO(dayISO, d.endMin),
        });
      } else {
        onSelect?.(d.entryId, event);
      }
    }
  }

  function colorFor(entry) {
    const p =
      entry && entry.projectId ? store.projectsById.get(entry.projectId) : null;
    return p?.color ?? 'var(--accent)';
  }

  // "now" indicator, only on today's column.
  let nowMin = $state(new Date().getHours() * 60 + new Date().getMinutes());
  $effect(() => {
    const t = setInterval(() => {
      const n = new Date();
      nowMin = n.getHours() * 60 + n.getMinutes();
    }, 30_000);
    return () => clearInterval(t);
  });
  let isToday = $derived(
    startOfDay(dayISO).getTime() === startOfDay(new Date()).getTime(),
  );

  /**
   * The running entry as a live block growing to "now". It is kept out of
   * lane-packing (see baseBlocks) so it overlaps neighbours rather than
   * squeezing them, and is rendered on top.
   */
  let runningBlock = $derived.by(() => {
    const r = store.runningEntry;
    if (!r) return null;
    const dayStart = startOfDay(dayISO).getTime();
    const startTs = new Date(r.start).getTime();
    if (startTs < dayStart || startTs >= dayStart + 86_400_000) return null;
    const startMin = clamp((startTs - dayStart) / 60000, 0, MINUTES_PER_DAY);
    const endMin = clamp(nowMin, startMin, MINUTES_PER_DAY);
    return { id: r.id, startMin, endMin, lane: 0, lanes: 1 };
  });
</script>

<div
  class="grid"
  role="application"
  aria-label="Timeline for {new Date(dayISO).toDateString()} — drag to create, drag edges to resize, drag body to move"
  style:height="{minutesToPx(MINUTES_PER_DAY)}px"
  bind:this={gridEl}
  onpointerdown={beginCreate}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#each hours as h (h)}
    <div class="hour-line" style:top="{minutesToPx(h * 60)}px"></div>
  {/each}

  <div class="lanes">
    {#each blocks as b (b.id)}
      <TimeEntryBlock
        block={b}
        label={entriesById.get(b.id)?.description}
        color={colorFor(entriesById.get(b.id))}
        selected={selectedId === b.id}
        dragging={drag?.entryId === b.id}
        onGrab={(mode, event) =>
          beginEntryDrag(entriesById.get(b.id), mode, event)}
      />
    {/each}

    {#if drag?.mode === 'create' && drag.endMin > drag.startMin}
      <TimeEntryBlock
        block={{ ...drag, id: '__ghost__', lane: 0, lanes: 1 }}
        label="New entry"
        dragging
      />
    {/if}

    {#if runningBlock}
      <TimeEntryBlock
        block={runningBlock}
        label={store.runningEntry?.description || 'Running…'}
        color={colorFor(store.runningEntry)}
        running
      />
    {/if}
  </div>

  {#if isToday}
    <div class="now-line" style:top="{minutesToPx(nowMin)}px">
      <span class="now-dot"></span>
    </div>
  {/if}
</div>

<style>
  .grid {
    position: relative;
    flex: 1;
    min-width: 0;
    border-left: 1px solid var(--border);
    /* Allow native vertical scroll on touch; create-by-drag is mouse/pen only. */
    touch-action: pan-y;
  }
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--grid-line);
    pointer-events: none;
  }
  .lanes {
    position: absolute;
    inset: 0;
  }
  .now-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid #e74c3c;
    pointer-events: none;
    z-index: 6;
  }
  .now-dot {
    position: absolute;
    left: -5px;
    top: -5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e74c3c;
  }
</style>
