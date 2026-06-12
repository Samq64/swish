<script>
  import { minutesToPx, formatClock } from '../lib/time.js';

  /**
   * A single entry rendered on the timeline. Dumb on purpose: it reports grab
   * gestures upward via `onGrab(mode, event)` and lets DayTimeline own all the
   * pointer math. `mode` is one of 'resize-start' | 'move' | 'resize-end'.
   */
  let {
    block,
    color = 'var(--accent)',
    label = '',
    selected = false,
    dragging = false,
    onGrab,
  } = $props();

  let top = $derived(minutesToPx(block.startMin));
  let height = $derived(minutesToPx(block.endMin - block.startMin));

  // Side-by-side layout for overlapping entries.
  let widthPct = $derived(100 / (block.lanes || 1));
  let leftPct = $derived(widthPct * (block.lane || 0));

  let compact = $derived(height < 34);

  function grab(mode, event) {
    if (event.button != null && event.button !== 0) return; // primary only
    onGrab?.(mode, event);
  }
</script>

<div
  class="entry"
  class:selected
  class:dragging
  style:top="{top}px"
  style:height="{height}px"
  style:left="calc({leftPct}% + 4px)"
  style:width="calc({widthPct}% - 8px)"
  style:--entry-color={color}
  onpointerdown={(e) => {
    e.stopPropagation();
    grab('move', e);
  }}
  role="button"
  tabindex="0"
>
  <div
    class="handle handle-top"
    role="separator"
    aria-label="Adjust start time"
    onpointerdown={(e) => {
      e.stopPropagation();
      grab('resize-start', e);
    }}
  ></div>

  <div class="body" class:compact>
    <span class="desc">{label || 'No description'}</span>
    {#if !compact}
      <span class="range">
        {formatClock(block.startMin)} – {formatClock(block.endMin)}
      </span>
    {/if}
  </div>

  <div
    class="handle handle-bottom"
    role="separator"
    aria-label="Adjust end time"
    onpointerdown={(e) => {
      e.stopPropagation();
      grab('resize-end', e);
    }}
  ></div>
</div>

<style>
  .entry {
    position: absolute;
    border-radius: 6px;
    background: color-mix(in srgb, var(--entry-color) 16%, white);
    border-left: 3px solid var(--entry-color);
    overflow: hidden;
    user-select: none;
    touch-action: none;
    cursor: grab;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    transition: box-shadow 0.12s ease;
  }
  .entry:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .entry.selected {
    outline: 2px solid var(--entry-color);
    outline-offset: -1px;
  }
  .entry.dragging {
    cursor: grabbing;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    z-index: 5;
  }

  .body {
    padding: 4px 8px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
    color: color-mix(in srgb, var(--entry-color) 70%, #1a1a22);
  }
  .body.compact {
    justify-content: center;
    padding: 0 8px;
  }
  .desc {
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .range {
    font-size: 11px;
    opacity: 0.75;
  }

  .handle {
    position: absolute;
    left: 0;
    right: 0;
    height: 7px;
    cursor: ns-resize;
    z-index: 2;
  }
  .handle-top {
    top: 0;
  }
  .handle-bottom {
    bottom: 0;
  }
</style>
