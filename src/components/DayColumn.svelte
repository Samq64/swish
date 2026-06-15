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
  import { entryColor, entryTagNames } from '../lib/entries.js';
  import { clock } from '../lib/clock.svelte.js';
  import { timelineDrag } from '../lib/timelineDrag.svelte.js';
  import TimeEntryBlock from './TimeEntryBlock.svelte';

  /**
   * One day of the timeline. Owns every pointer gesture for its own day:
   *
   *   • drag empty space (mouse) -> create a sized entry in one gesture
   *   • hold empty space (touch) -> drop a default-length entry to resize later
   *   • drag an entry's edges    -> resize (extend / shrink) it
   *   • drag an entry's body     -> move it, even into another day's column
   *
   * Touch splits creating and resizing into two actions (a finicky drag-to-size
   * is hard with a finger); a mouse keeps the precise combined drag.
   *
   * A move can cross days: this column keeps pointer capture for the whole
   * gesture, asks `dayAtX` which day the cursor is over, and — once that differs
   * from the origin day — hides its own copy of the block while the destination
   * column renders the live one (see `movingBlock`). The drag lives in the
   * shared `timelineDrag` singleton precisely so the other column can read it.
   *
   * Selection is bubbled up via `onSelect` so a single editor can be shared
   * across all columns in the week.
   */
  let { dayISO, selectedId = null, onSelect, registerColumn, dayAtX } = $props();

  let gridEl;

  /**
   * The live drag gesture (or null), shared across all columns. Reassign via
   * `timelineDrag.start(...)` / `.clear()`; mutate fields (`drag.startMin = …`)
   * directly — it's the same reactive proxy every column reads.
   * @type {null | any}
   */
  let drag = $derived(timelineDrag.current);

  // Publish this column's grid element so an in-flight move can locate it by X.
  $effect(() => {
    registerColumn?.(dayISO, gridEl);
    return () => registerColumn?.(dayISO, null);
  });

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

  // Cross-day move bookkeeping. `movedAway`: an entry that started here is being
  // dragged over another day, so we drop our copy and let that day render it.
  // `movedHere`: a move that started elsewhere is now hovering this column, so
  // we render the live block ourselves (`movingBlock`).
  let movedAway = $derived(
    drag?.mode === 'move' &&
      drag.originDayISO === dayISO &&
      drag.targetDayISO !== dayISO,
  );
  let movedHere = $derived(
    drag?.mode === 'move' &&
      drag.targetDayISO === dayISO &&
      drag.originDayISO !== dayISO,
  );
  let movingEntry = $derived(
    movedHere ? store.entries.find((e) => e.id === drag.entryId) : null,
  );

  /**
   * Completed entries as timeline blocks. `order` is the creation-order index,
   * a stable key so lane columns don't swap when an entry is dragged. (The
   * running entry has no end and lives in the TimerBar.) A block being dragged
   * out to another day is dropped here — that day renders it instead.
   */
  function baseBlocks() {
    return dayEntries
      .filter((e) => e.end && !(movedAway && e.id === drag.entryId))
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

  // Touch: a swipe should scroll, so creating is gated behind a long-press.
  const LONG_PRESS_MS = 400;
  const MOVE_CANCEL_PX = 10;
  const DEFAULT_CREATE_MIN = 30;
  let pressTimer = null;
  let pressStart = null; // { pointerId, clientX, clientY } while awaiting hold

  function cancelLongPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  // Mouse only: drop a fresh create-drag anchored at `anchorMin` so the pointer
  // can size it before release.
  function startCreate(event, anchorMin, endMin = anchorMin) {
    timelineDrag.start({
      mode: 'create',
      entryId: null,
      originDayISO: dayISO,
      targetDayISO: dayISO,
      anchorMin,
      grabOffsetMin: 0,
      duration: 0,
      startMin: Math.min(anchorMin, endMin),
      endMin: Math.max(anchorMin, endMin),
      moved: false,
    });
    gridEl.setPointerCapture?.(event.pointerId);
  }

  // Touch only: a hold drops a default-length entry at `clientY` and opens it,
  // with no sizing drag. The editor anchors itself to the new block.
  async function createDefaultEntry(clientY) {
    if (!gridEl) return;
    const m = clamp(
      pxToMinutes(clientY - gridEl.getBoundingClientRect().top),
      0,
      MINUTES_PER_DAY,
    );
    const start = clamp(snap(m), 0, MINUTES_PER_DAY - DEFAULT_CREATE_MIN);
    const entry = await store.create({
      description: '',
      projectId: null,
      start: minutesToISO(dayISO, start),
      end: minutesToISO(dayISO, start + DEFAULT_CREATE_MIN),
    });
    onSelect?.(entry.id);
  }

  function beginCreate(event) {
    if (event.button != null && event.button !== 0) return;
    // Read-only (a workspace shared with us): no creating; a tap clears selection.
    if (store.readOnly) {
      onSelect?.(null, event);
      return;
    }
    if (event.pointerType === 'touch') {
      // Hold to create; a finger-move first = scroll, a quick tap = dismiss.
      cancelLongPress();
      pressStart = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        const p = pressStart;
        pressStart = null;
        if (!p) return;
        navigator.vibrate?.(10);
        createDefaultEntry(p.clientY);
      }, LONG_PRESS_MS);
      return;
    }
    // Mouse / pen: keep the precise combined drag-to-size.
    startCreate(event, snap(pointerMinutes(event)));
  }

  // Block the page from scrolling once a drag is live (touch).
  function onTouchMove(event) {
    if (drag) event.preventDefault();
  }

  // A cancel is an interrupted gesture, not a finished one — drop it without
  // creating anything (otherwise an OS pointer-steal commits a phantom entry).
  function onPointerCancel(event) {
    cancelLongPress();
    if (!drag) return;
    timelineDrag.clear();
    frozenLanes = null;
    gridEl.releasePointerCapture?.(event.pointerId);
  }

  function beginEntryDrag(entry, mode, event) {
    // Read-only: a press selects the entry to view it, but never moves/resizes.
    if (store.readOnly) {
      onSelect?.(entry.id, event);
      return;
    }
    const b = toBlock(entry);
    const m = pointerMinutes(event);
    // Snapshot the current layout so neighbours stay put for the whole gesture.
    frozenLanes = packLanes(baseBlocks());
    timelineDrag.start({
      mode,
      entryId: entry.id,
      originDayISO: dayISO,
      targetDayISO: dayISO,
      anchorMin: m,
      grabOffsetMin: m - b.startMin,
      duration: b.endMin - b.startMin,
      startMin: b.startMin,
      endMin: b.endMin,
      moved: false,
    });
    capture(event);
  }

  // --- live drag -------------------------------------------------------------

  function onPointerMove(event) {
    // Awaiting a long-press: a real move means the user is scrolling, not
    // creating — abandon the pending hold and let the timeline scroll.
    if (pressStart && !drag) {
      const moved = Math.hypot(
        event.clientX - pressStart.clientX,
        event.clientY - pressStart.clientY,
      );
      if (moved > MOVE_CANCEL_PX) cancelLongPress();
      return;
    }
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
        // Which day's column is the cursor over now? That's where it lands.
        drag.targetDayISO = dayAtX?.(event.clientX) ?? drag.originDayISO;
        break;
      }
    }
  }

  // --- commit ----------------------------------------------------------------

  async function onPointerUp(event) {
    // A touch released before the hold fired is a plain tap — dismiss any
    // selection (the long-press path already handled real creates).
    const wasPendingTap = !drag && !!pressStart;
    cancelLongPress();
    if (!drag) {
      if (wasPendingTap) onSelect?.(null, event);
      return;
    }
    const d = drag;
    timelineDrag.clear();
    frozenLanes = null;
    gridEl.releasePointerCapture?.(event.pointerId);

    // Mouse-only combined create-drag: commit if it was dragged out to a real
    // span, otherwise treat the click as clearing the selection.
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
        onSelect?.(null, event);
      }
      return;
    }

    if (d.entryId) {
      if (d.moved) {
        // A move may have crossed days; resizes never leave their column, so
        // targetDayISO stays the origin for them.
        const day = d.targetDayISO ?? dayISO;
        await store.update(d.entryId, {
          start: minutesToISO(day, d.startMin),
          end: minutesToISO(day, d.endMin),
        });
      } else {
        onSelect?.(d.entryId, event);
      }
    }
  }

  // "now" indicator, only on today's column; one shared ticker for all columns.
  $effect(() => clock.subscribe());
  // Drop any pending long-press if this column unmounts mid-hold.
  $effect(() => cancelLongPress);
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
    const endMin = clamp(clock.minute, startMin, MINUTES_PER_DAY);
    return { id: r.id, startMin, endMin, lane: 0, lanes: 1 };
  });
</script>

<div
  class="grid"
  role="application"
  aria-label="Timeline for {new Date(dayISO).toDateString()} — hold or drag to add an entry, drag edges to resize, drag body to move"
  style:height="{minutesToPx(MINUTES_PER_DAY)}px"
  bind:this={gridEl}
  onpointerdown={beginCreate}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  ontouchmove={onTouchMove}
>
  {#each hours as h (h)}
    <div class="hour-line" style:top="{minutesToPx(h * 60)}px"></div>
  {/each}

  <div class="lanes">
    {#each blocks as b (b.id)}
      {@const entry = entriesById.get(b.id)}
      <TimeEntryBlock
        block={b}
        label={entry?.description}
        color={entryColor(entry, store.projectsById)}
        tags={entryTagNames(entry, store.tagsById)}
        selected={selectedId === b.id}
        dragging={drag?.entryId === b.id}
        hour12={store.hour12}
        onGrab={(mode, event) => beginEntryDrag(entry, mode, event)}
      />
    {/each}

    {#if drag?.mode === 'create' && drag.endMin > drag.startMin}
      <TimeEntryBlock
        block={{ ...drag, id: '__ghost__', lane: 0, lanes: 1 }}
        label="New entry"
        color="var(--no-project)"
        hour12={store.hour12}
        dragging
      />
    {/if}

    {#if movedHere && movingEntry}
      <TimeEntryBlock
        block={{
          id: movingEntry.id,
          startMin: drag.startMin,
          endMin: drag.endMin,
          lane: 0,
          lanes: 1,
        }}
        label={movingEntry.description}
        color={entryColor(movingEntry, store.projectsById)}
        tags={entryTagNames(movingEntry, store.tagsById)}
        selected={selectedId === movingEntry.id}
        hour12={store.hour12}
        dragging
      />
    {/if}

    {#if runningBlock}
      <TimeEntryBlock
        block={runningBlock}
        label={store.runningEntry?.description || 'Running…'}
        color={entryColor(store.runningEntry, store.projectsById)}
        selected={selectedId === runningBlock.id}
        running
        onGrab={(_, event) => onSelect?.(runningBlock.id, event)}
      />
    {/if}
  </div>

  {#if isToday}
    <div class="now-line" style:top="{minutesToPx(clock.minute)}px">
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
    /* Let touch pan both ways (vertical hours + horizontal week scroll);
       creating is gated behind a long-press, which preventDefaults the pan. */
    touch-action: pan-x pan-y;
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

  /* Keep week columns usable on phones (matches .day-head); the timeline
     scrolls sideways rather than squeezing them to nothing. */
  @media (max-width: 640px) {
    .grid {
      min-width: 84px;
    }
  }
</style>
