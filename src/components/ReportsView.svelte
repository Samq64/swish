<script>
  import { store } from '../data/store.js';
  import { startOfDay, addDays, formatDuration, DAY_MS } from '../lib/time.js';
  import { entryDurationMin } from '../lib/entries.js';

  /**
   * A read-only analytics view. Unlike the timeline, its range is decoupled
   * from `store.anchor`: the user picks a range in the page header (week / month
   * / year / custom — see `store.reportPreset`/`store.reportRange`) and we fetch
   * that window directly via `store.queryEntries`, then aggregate it into a bar
   * chart (tracked time per day/month) and a by-project breakdown.
   *
   * Charts are hand-rolled SVG/CSS rather than a charting dependency: the two
   * shapes we need are simple, and drawing them ourselves lets them inherit the
   * app's theme tokens (and stay out of the bundle).
   */

  const NO_PROJECT = '__none__';

  /** @type {import('../data/repository.js').TimeEntry[]} */
  let entries = $state([]);
  let loading = $state(false);

  /** The window to report on (`{ from, to, unit }`), owned by the store. */
  let range = $derived(store.reportRange);

  // Refetch whenever the range or the active workspace changes. A token guards
  // against an out-of-order response overwriting a newer one.
  let reqToken = 0;
  $effect(() => {
    const { from, to } = range;
    // Tracked so a workspace switch re-runs this effect (queryEntries reads it).
    store.currentWorkspaceId;
    const token = ++reqToken;
    loading = true;
    store
      .queryEntries({ from: from.toISOString(), to: to.toISOString() })
      .then((rows) => {
        if (token === reqToken) entries = rows;
      })
      .finally(() => {
        if (token === reqToken) loading = false;
      });
  });

  /** Completed entries only — running/open entries have no duration yet. */
  let completed = $derived(entries.filter((e) => e.end));

  let totalMin = $derived(completed.reduce((s, e) => s + entryDurationMin(e), 0));

  // Calendar days the range covers, so "avg / day" reflects the whole window
  // (including days with nothing tracked), not just active days.
  let dayCount = $derived(
    Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS)),
  );

  /** Time per project, largest first, with display name + colour resolved. */
  let byProject = $derived.by(() => {
    const totals = new Map();
    for (const e of completed) {
      const key = e.projectId ?? NO_PROJECT;
      totals.set(key, (totals.get(key) ?? 0) + entryDurationMin(e));
    }
    return [...totals.entries()]
      .map(([key, min]) => {
        const project = key === NO_PROJECT ? null : store.projectsById.get(key);
        return {
          key,
          name: project?.name ?? 'No project',
          color: project?.color ?? 'var(--no-project)',
          min,
          pct: totalMin ? (min / totalMin) * 100 : 0,
        };
      })
      .sort((a, b) => b.min - a.min);
  });

  /**
   * Donut segments. Built on a circle whose circumference is exactly 100, so a
   * segment's percentage doubles as its dash length; `offset` rotates each one
   * to begin where the previous ended (25 puts the first at 12 o'clock).
   */
  let segments = $derived.by(() => {
    let acc = 0;
    return byProject
      .filter((p) => p.min > 0)
      .map((p) => {
        const seg = { ...p, dash: p.pct, offset: (25 - acc + 100) % 100 };
        acc += p.pct;
        return seg;
      });
  });

  /** One bar per day (or month, for the year view), in chronological order. */
  let buckets = $derived.by(() => {
    const { from, to, unit } = range;
    const list = [];
    if (unit === 'month') {
      for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        list.push({ start: new Date(d), min: 0 });
      }
    } else {
      for (let d = new Date(from); d < to; d = addDays(d, 1)) {
        list.push({ start: new Date(d), min: 0 });
      }
    }
    for (const e of completed) {
      const t = new Date(e.start);
      const idx =
        unit === 'month'
          ? (t.getFullYear() - from.getFullYear()) * 12 + (t.getMonth() - from.getMonth())
          : Math.floor((startOfDay(t).getTime() - startOfDay(from).getTime()) / DAY_MS);
      if (idx >= 0 && idx < list.length) list[idx].min += entryDurationMin(e);
    }
    return list;
  });

  let maxBucket = $derived(Math.max(0, ...buckets.map((b) => b.min)));

  // "Nice" round step sizes for the y-axis, in minutes (15m → 1d), so ticks land
  // on readable durations rather than arbitrary fractions of the tallest bar.
  const AXIS_STEPS = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440];

  /**
   * Y-axis scale: a top value at or above the tallest bar that's a multiple of a
   * nice step, plus the tick marks up to it. Bars scale against `max` so their
   * heights line up with the gridlines.
   */
  let axis = $derived.by(() => {
    if (maxBucket <= 0) return { max: 60, ticks: [0, 60] }; // empty-ish range
    const target = maxBucket / 4; // aim for ~4 intervals
    const step = AXIS_STEPS.find((s) => s >= target) ?? Math.ceil(target / 1440) * 1440;
    const max = Math.ceil(maxBucket / step) * step;
    const ticks = [];
    for (let v = 0; v <= max + 0.5; v += step) ticks.push(v);
    return { max, ticks };
  });

  /** Compact duration for an axis tick: "0", "45m", "1h", "1h 30m". */
  function axisLabel(min) {
    if (min <= 0) return '0';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (h && m) return `${h}h ${m}m`;
    return h ? `${h}h` : `${m}m`;
  }

  /**
   * Axis label for a bar. Weekday for a week, short month for the year, and a
   * sparse day-of-month (every ~5th) for a full month so it doesn't crowd.
   */
  function barLabel(bucket, index) {
    if (range.unit === 'month') {
      return bucket.start.toLocaleDateString(undefined, { month: 'short' });
    }
    if (buckets.length <= 7) {
      return bucket.start.toLocaleDateString(undefined, { weekday: 'short' });
    }
    const day = bucket.start.getDate();
    return day === 1 || day % 5 === 0 ? String(day) : '';
  }

  function barTitle(bucket) {
    const when =
      range.unit === 'month'
        ? bucket.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : bucket.start.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
    return `${when} · ${formatDuration(bucket.min)}`;
  }
</script>

<div class="reports fill-col">
  <div class="scroll">
    <div class="stats">
      <div class="stat">
        <span class="stat-label">Total tracked</span>
        <span class="stat-value">{formatDuration(totalMin)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Avg / day</span>
        <span class="stat-value">{formatDuration(totalMin / dayCount)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Entries</span>
        <span class="stat-value">{completed.length}</span>
      </div>
    </div>

    {#if completed.length === 0}
      <p class="empty">
        {loading ? 'Loading…' : 'Nothing tracked in this range.'}
      </p>
    {:else}
      <div class="cards">
        <section class="card chart-card">
          <h3>Tracked time</h3>
          <div class="chart" style="--bar-count: {buckets.length}">
            <div class="y-axis">
              {#each axis.ticks as t (t)}
                <span class="y-tick" style:bottom="{(t / axis.max) * 100}%">
                  {axisLabel(t)}
                </span>
              {/each}
            </div>

            <div class="plot">
              <div class="gridlines" aria-hidden="true">
                {#each axis.ticks as t (t)}
                  <div class="gridline" style:bottom="{(t / axis.max) * 100}%"></div>
                {/each}
              </div>
              <div class="bars">
                {#each buckets as b (b.start.getTime())}
                  <div class="bar-col" title={barTitle(b)}>
                    {#if b.min > 0}
                      <div class="bar-fill" style:height="{(b.min / axis.max) * 100}%"></div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>

            <div class="x-axis">
              {#each buckets as b, i (b.start.getTime())}
                <span class="x-tick">{barLabel(b, i)}</span>
              {/each}
            </div>
          </div>
        </section>

        <section class="card breakdown-card">
          <h3>By project</h3>
          <div class="breakdown">
            <svg class="donut" viewBox="0 0 36 36" role="img" aria-label="Time by project">
              <circle class="donut-track" cx="18" cy="18" r="15.91549431" />
              {#each segments as s (s.key)}
                <circle
                  class="donut-seg"
                  cx="18"
                  cy="18"
                  r="15.91549431"
                  stroke={s.color}
                  stroke-dasharray="{s.dash} {100 - s.dash}"
                  stroke-dashoffset={s.offset}
                />
              {/each}
              <text class="donut-center" x="18" y="18">{byProject.length}</text>
              <text class="donut-sub" x="18" y="22.5">
                {byProject.length === 1 ? 'project' : 'projects'}
              </text>
            </svg>

            <ul class="legend">
              {#each byProject as p (p.key)}
                <li>
                  <span class="legend-dot" style:background={p.color}></span>
                  <span class="legend-name">{p.name}</span>
                  <span class="legend-pct">{Math.round(p.pct)}%</span>
                  <span class="legend-dur">{formatDuration(p.min)}</span>
                </li>
              {/each}
            </ul>
          </div>
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .reports {
    background: var(--surface);
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .stat-label {
    font-size: 13px;
    color: var(--muted);
  }
  .stat-value {
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .cards {
    display: grid;
    /* Chart takes the lion's share; the breakdown sits in a narrower column,
       wrapping below it when there isn't room for both. Stretch so both cards
       share the taller one's height. */
    grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
    gap: var(--space-5);
    align-items: stretch;
  }
  .card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }
  .card h3 {
    margin: 0 0 var(--space-4);
    font-size: 14px;
    font-weight: 600;
  }

  /* Chart grid: a y-axis gutter beside the plot, with the x labels in a row
     below the plot only (so they don't shift the gutter). --plot-h is the bar
     area's height; the gridlines and bars share it so they line up exactly. */
  .chart {
    --plot-h: 220px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-2);
    align-items: start;
  }
  .y-axis {
    position: relative;
    height: var(--plot-h);
    /* Reserve the gutter: the ticks inside are absolutely positioned (so they
       don't size the column themselves), and double-digit hours need the room
       or they spill left out of the card. */
    width: 52px;
  }
  .y-tick {
    position: absolute;
    right: 0;
    /* Sit centred on its gridline rather than above it. */
    transform: translateY(50%);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .plot {
    position: relative;
    height: var(--plot-h);
  }
  .gridlines {
    position: absolute;
    inset: 0;
  }
  .gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--grid-line);
  }
  .bars {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(var(--bar-count), minmax(0, 1fr));
    align-items: end;
    gap: var(--space-1);
  }
  .bar-col {
    display: flex;
    justify-content: center;
    align-items: end;
    min-width: 0;
    height: 100%;
  }
  .bar-fill {
    width: 100%;
    max-width: 40px;
    min-height: 2px;
    background: var(--accent);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: height 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .x-axis {
    grid-column: 2;
    display: grid;
    grid-template-columns: repeat(var(--bar-count), minmax(0, 1fr));
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .x-tick {
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }

  /* Lay the card out as a column so the breakdown can fill the height the grid
     stretched it to, centring the donut + legend against the taller chart card. */
  .breakdown-card {
    display: flex;
    flex-direction: column;
  }
  .breakdown {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-4);
    align-items: center;
  }
  .donut {
    width: 140px;
    height: 140px;
    flex: none;
  }
  .donut-track {
    fill: none;
    stroke: var(--grid-line-strong);
    stroke-width: 3.2;
  }
  .donut-seg {
    fill: none;
    stroke-width: 3.2;
    /* Rotate so 0% sits at 12 o'clock and segments run clockwise. */
    transform: rotate(-90deg);
    transform-origin: center;
  }
  .donut-center {
    fill: var(--text);
    font-size: 7px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .donut-sub {
    fill: var(--muted);
    font-size: 2.6px;
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
  }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .legend-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-pct {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .legend-dur {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 64px;
    text-align: right;
  }

  .empty {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    padding: var(--space-5) 0;
  }

  /* Stack the chart and breakdown once they can't sit side by side. */
  @media (max-width: 860px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 640px) {
    .stats {
      grid-template-columns: 1fr;
    }
  }
</style>
