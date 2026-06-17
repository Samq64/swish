<script>
  import { store } from '../data/store.js';
  import { minutesToPx, MINUTES_PER_DAY, HOURS, clamp, isToday } from '../lib/time.js';
  import DayColumn from './DayColumn.svelte';
  import EntryEditorHost from './EntryEditorHost.svelte';

  /** @type {HTMLDivElement | null} */
  let scrollEl = $state(null);

  /**
   * Renders the visible range as a row of {@link DayColumn}s sharing one hour
   * gutter and one entry editor. Works for both day (1 column) and week
   * (7 columns) views — it just maps over `store.visibleDays`.
   */

  let selectedId = $state(null);
  // The selected entry's live on-screen rect (editor anchors to it) and the
  // safe region the editor may occupy (viewport minus the sticky header).
  /** @type {{ left: number, right: number, top: number, bottom: number, width: number, height: number, contentRight: number } | null} */
  let anchor = $state(null);
  /** @type {{ top: number, bottom: number } | null} */
  let bounds = $state(null);

  function hourLabel(h) {
    if (!store.hour12) return String(h).padStart(2, '0');
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  function dayName(iso) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  }
  function dayNum(iso) {
    return new Date(iso).getDate();
  }

  // On first mount, scroll vertically to "now" and — when the week overflows
  // horizontally (narrow screens) — bring today's column into view so it isn't
  // hidden off to the right.
  $effect(() => {
    if (!scrollEl) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const nowPx = minutesToPx(minutes);
    scrollEl.scrollTop = Math.max(0, nowPx - scrollEl.clientHeight / 3);

    const todayEl = scrollEl.querySelector('.day-head.today');
    if (todayEl) {
      const wrap = scrollEl.getBoundingClientRect();
      const el = todayEl.getBoundingClientRect();
      const target =
        scrollEl.scrollLeft + (el.left - wrap.left) - (scrollEl.clientWidth - el.width) / 2;
      scrollEl.scrollLeft = clamp(target, 0, scrollEl.scrollWidth - scrollEl.clientWidth);
    }
  });

  function handleSelect(id) {
    selectedId = id;
  }

  // Each column registers its grid element here so an in-flight move (which is
  // captured by its origin column) can map the cursor's X to the day it's now
  // over — that's what lets a drag cross from one day's column into another.
  let columnEls = new Map();
  function registerColumn(iso, el) {
    if (el) columnEls.set(iso, el);
    else columnEls.delete(iso);
  }
  function dayAtX(clientX) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const [iso, el] of columnEls) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return iso;
      // Dragged past the first/last column — clamp to the nearest real day.
      const dist = clientX < r.left ? r.left - clientX : clientX - r.right;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = iso;
      }
    }
    return nearest;
  }

  // Keep `anchor` glued to the selected entry's block while it's open, so the
  // editor follows live drags/resizes and stays put during scrolls. `bounds` is
  // the safe region the editor may occupy: the scroll viewport minus the sticky
  // day-header, so a scrolled-away entry can't drag the popover over the header.
  // One cheap measure per frame; we only publish when something actually moves.
  $effect(() => {
    const id = selectedId;
    if (!id || !scrollEl) {
      anchor = null;
      bounds = null;
      return;
    }
    const sEl = scrollEl; // captured non-null for the rAF closure below
    let raf;
    const measureRange = document.createRange();
    const tick = () => {
      const el = sEl.querySelector(`[data-entry-id="${id}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        // Right edge of the actual text content (glyph-precise via a Range, so a
        // full-width span doesn't read as full-width text). Lets the editor sit
        // just past the information text in a wide day-view entry instead of
        // covering it. Clamped to the block's own right edge.
        let contentRight = r.left;
        for (const t of el.querySelectorAll('.desc, .range, .elapsed, .tag')) {
          measureRange.selectNodeContents(t);
          contentRight = Math.max(contentRight, measureRange.getBoundingClientRect().right);
        }
        contentRight = Math.min(contentRight, r.right);
        if (
          !anchor ||
          anchor.left !== r.left ||
          anchor.top !== r.top ||
          anchor.width !== r.width ||
          anchor.height !== r.height ||
          anchor.contentRight !== contentRight
        ) {
          anchor = {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
            contentRight,
          };
        }
      }

      const sr = sEl.getBoundingClientRect();
      const head = sEl.querySelector('.header-row');
      const top = head ? head.getBoundingClientRect().bottom : sr.top;
      if (!bounds || bounds.top !== top || bounds.bottom !== sr.bottom) {
        bounds = { top, bottom: sr.bottom };
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="view fill-col">
  <div class="scroll" bind:this={scrollEl}>
    <!-- Day headers live INSIDE the scroller so they share the body's exact
         column widths (scrollbar included) and stay aligned; `sticky` keeps
         them pinned to the top while the timeline scrolls. Redundant in day
         view, where the nav already shows the date. -->
    {#if store.view !== 'day'}
      <div class="header-row">
        <div class="gutter-spacer"></div>
        {#each store.visibleDays as iso (iso)}
          <div class="day-head" class:today={isToday(iso)}>
            <span class="dow">{dayName(iso)}</span>
            <span class="dom">{dayNum(iso)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="body" style:height="{minutesToPx(MINUTES_PER_DAY)}px">
      <div class="gutter">
        {#each HOURS as h (h)}
          <div class="hour-label" class:first={h === 0} style:top="{minutesToPx(h * 60)}px">
            {hourLabel(h)}
          </div>
        {/each}
      </div>

      {#each store.visibleDays as iso (iso)}
        <DayColumn dayISO={iso} {selectedId} onSelect={handleSelect} {registerColumn} {dayAtX} />
      {/each}
    </div>
  </div>
</div>

<EntryEditorHost {selectedId} {anchor} {bounds} onClose={() => (selectedId = null)} />

<style>
  .view {
    background: var(--surface);
  }

  .header-row {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
  }
  .gutter-spacer {
    width: 56px;
    flex: none;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .day-head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-1);
    border-left: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    /* Each cell needs its own background/borders because on narrow screens the
       cells overflow */
    background: var(--surface);
  }
  .day-head .dow {
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .day-head .dom {
    font-size: 16px;
    font-weight: 600;
  }
  .day-head.today .dom {
    color: white;
    background: var(--accent);
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    /* A drag-to-create that begins at scrollTop 0 would otherwise overscroll
       into Android's pull-to-refresh, which steals the pointer mid-gesture.
       Containing the overscroll keeps the drag ours; normal scrolling is
       unaffected. */
    overscroll-behavior-y: contain;
    /* Ensure the last hour is reachable above the Android system nav bar. */
    padding-bottom: env(safe-area-inset-bottom);
  }
  .body {
    display: flex;
    position: relative;
  }
  .gutter {
    width: 56px;
    flex: none;
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .hour-label {
    position: absolute;
    right: 6px;
    transform: translateY(-7px);
    text-align: right;
    font-size: 11px;
    color: var(--muted);
  }
  /* The topmost label has no gridline above it; nudge it down so "12 AM"
     sits just below the top edge instead of poking under the header. */
  .hour-label.first {
    transform: translateY(2px);
  }

  /* On phones, 7 week columns are too thin — give them a floor and let the
     timeline scroll sideways instead of squeezing. Header scrolls in sync. */
  @media (max-width: 640px) {
    .scroll {
      overflow-x: auto;
    }
    .day-head {
      min-width: 84px;
    }
  }
</style>
