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
    tags = [],
    selected = false,
    dragging = false,
    running = false,
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
  class:running
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
  {#if !running}
    <div
      class="handle handle-top"
      role="separator"
      aria-label="Adjust start time"
      onpointerdown={(e) => {
        e.stopPropagation();
        grab('resize-start', e);
      }}
    ></div>
  {/if}

  <div class="body" class:compact>
    <span class="desc">{label || 'No description'}</span>
    {#if !compact}
      <span class="range">
        {formatClock(block.startMin)} – {formatClock(block.endMin)}
      </span>
    {/if}
    {#if !compact && tags.length}
      <span class="tags">
        {#each tags as t (t)}
          <span class="tag">{t}</span>
        {/each}
      </span>
    {/if}
  </div>

  {#if !running}
    <div
      class="handle handle-bottom"
      role="separator"
      aria-label="Adjust end time"
      onpointerdown={(e) => {
        e.stopPropagation();
        grab('resize-end', e);
      }}
    ></div>
  {/if}
</div>

<style>
  .entry {
    position: absolute;
    /* Keep short entries tall enough to read one line of text. */
    min-height: 20px;
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
  .entry.running {
    /* A live entry: no minimum height, floats over others, and lets clicks
       through so you can still create entries behind it. */
    min-height: 0;
    z-index: 7;
    pointer-events: none;
    cursor: default;
    border-style: dashed;
    border-width: 0 0 0 3px;
    box-shadow: 0 0 0 1px var(--entry-color) inset;
    animation: running-pulse 1.6s ease-in-out infinite;
  }
  @keyframes running-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
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
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
  }
  .tag {
    font-size: 10px;
    line-height: 1.4;
    padding: 0 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--entry-color) 22%, white);
    color: color-mix(in srgb, var(--entry-color) 75%, #1a1a22);
    white-space: nowrap;
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
