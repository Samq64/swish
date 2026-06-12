<script>
  import { store } from '../data/store.js';
  import {
    PX_PER_HOUR,
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
  import EditPopover from './EditPopover.svelte';

  /**
   * The 24-hour day timeline. This component owns every pointer gesture:
   *
   *   • drag on empty space        -> create a new entry
   *   • drag an entry's edges      -> resize (extend / shrink) it
   *   • drag an entry's body       -> move it
   *
   * Children only report *which* grab started; all coordinate math, snapping,
   * clamping and persistence happens here.
   */

  let gridEl;
  let selectedId = $state(null);
  let editorPos = $state({ x: 0, y: 0 });

  /**
   * Live drag gesture, or null. While set, the affected entry renders from
   * the draft values rather than from the store.
   * @type {null | {
   *   mode: 'create'|'move'|'resize-start'|'resize-end',
   *   entryId: string|null,
   *   anchorMin: number,
   *   grabOffsetMin: number,
   *   duration: number,
   *   startMin: number,
   *   endMin: number,
   *   moved: boolean,
   * }}
   */
  let drag = $state(null);

  const hours = Array.from({ length: 24 }, (_, h) => h);

  function hourLabel(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  // --- entry -> timeline-block conversion (robust across midnight) -----------

  function toBlock(entry) {
    const dayStart = startOfDay(store.selectedDay).getTime();
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

  // Completed entries become blocks; the running entry lives in the TimerBar.
  let blocks = $derived.by(() => {
    let arr = store.entries.filter((e) => e.end).map(toBlock);

    if (drag && drag.entryId) {
      arr = arr.map((b) =>
        b.id === drag.entryId
          ? { ...b, startMin: drag.startMin, endMin: drag.endMin }
          : b,
      );
    }

    const lanes = packLanes(arr);
    return arr.map((b) => ({ ...b, ...(lanes.get(b.id) ?? { lane: 0, lanes: 1 }) }));
  });

  let entriesById = $derived(new Map(store.entries.map((e) => [e.id, e])));
  let selectedEntry = $derived(
    selectedId ? (entriesById.get(selectedId) ?? null) : null,
  );

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

  /** Called by a TimeEntryBlock when one of its grab zones is pressed. */
  function beginEntryDrag(entry, mode, event) {
    const b = toBlock(entry);
    const m = pointerMinutes(event);
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
    gridEl.releasePointerCapture?.(event.pointerId);

    const day = store.selectedDay;

    if (d.mode === 'create') {
      if (d.endMin - d.startMin >= MIN_DURATION) {
        const entry = await store.create({
          description: '',
          projectId: null,
          start: minutesToISO(day, d.startMin),
          end: minutesToISO(day, d.endMin),
        });
        select(entry.id, event);
      }
      return;
    }

    if (d.entryId) {
      if (d.moved) {
        await store.update(d.entryId, {
          start: minutesToISO(day, d.startMin),
          end: minutesToISO(day, d.endMin),
        });
      } else {
        // No movement -> treat the press as a selecting click.
        select(d.entryId, event);
      }
    }
  }

  // --- selection / editor ----------------------------------------------------

  function select(id, event) {
    selectedId = id;
    const margin = 12;
    const x = clamp((event?.clientX ?? 200) + margin, 8, window.innerWidth - 260);
    const y = clamp((event?.clientY ?? 120) - 20, 8, window.innerHeight - 260);
    editorPos = { x, y };
  }

  function closeEditor() {
    selectedId = null;
  }

  function colorFor(entry) {
    const p = entry && entry.projectId
      ? store.projectsById.get(entry.projectId)
      : null;
    return p?.color ?? 'var(--accent)';
  }

  // "now" indicator, only meaningful when viewing today.
  let nowMin = $state(new Date().getHours() * 60 + new Date().getMinutes());
  $effect(() => {
    const t = setInterval(() => {
      const n = new Date();
      nowMin = n.getHours() * 60 + n.getMinutes();
    }, 30_000);
    return () => clearInterval(t);
  });
  let showNow = $derived(
    startOfDay(store.selectedDay).getTime() === startOfDay(new Date()).getTime(),
  );
</script>

<div class="scroll">
  <div
    class="grid"
    role="application"
    aria-label="Day timeline — drag to create, drag edges to resize, drag body to move"
    style:height="{minutesToPx(MINUTES_PER_DAY)}px"
    bind:this={gridEl}
    onpointerdown={beginCreate}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <!-- hour rows -->
    {#each hours as h (h)}
      <div class="hour-line" style:top="{minutesToPx(h * 60)}px"></div>
      <div class="hour-label" style:top="{minutesToPx(h * 60)}px">
        {hourLabel(h)}
      </div>
    {/each}

    <!-- entries (and the live create ghost) -->
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
    </div>

    {#if showNow}
      <div class="now-line" style:top="{minutesToPx(nowMin)}px">
        <span class="now-dot"></span>
      </div>
    {/if}
  </div>
</div>

{#if selectedEntry}
  <EditPopover
    entry={selectedEntry}
    projects={store.projects}
    pos={editorPos}
    onChange={(patch) => store.update(selectedEntry.id, patch)}
    onDelete={() => {
      store.remove(selectedEntry.id);
      closeEditor();
    }}
    onClose={closeEditor}
  />
{/if}

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    background: var(--surface);
  }
  .grid {
    position: relative;
    margin-left: 56px; /* room for hour labels */
  }
  .hour-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--grid-line);
    pointer-events: none;
  }
  .hour-label {
    position: absolute;
    left: -52px;
    width: 46px;
    transform: translateY(-7px);
    text-align: right;
    font-size: 11px;
    color: var(--muted);
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
