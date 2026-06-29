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

  /**
   * Index of the chart bar (day/month) the pointer is over, or null. While set,
   * the stats, breakdown and table scope down to just that bucket so you can
   * inspect a single day without changing the range; the bar chart itself stays
   * showing the whole range. Cleared on mouse-leave.
   */
  let hoveredIdx = $state(/** @type {number | null} */ (null));

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

  /** One bar per day (or month, for the year view), in chronological order. */
  let buckets = $derived.by(() => {
    const { from, to, unit } = range;
    /** @type {{ start: Date, min: number, entries: import('../data/repository.js').TimeEntry[] }[]} */
    const list = [];
    if (unit === 'month') {
      for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        list.push({ start: new Date(d), min: 0, entries: [] });
      }
    } else {
      for (let d = new Date(from); d < to; d = addDays(d, 1)) {
        list.push({ start: new Date(d), min: 0, entries: [] });
      }
    }
    for (const e of completed) {
      const t = new Date(e.start);
      const idx =
        unit === 'month'
          ? (t.getFullYear() - from.getFullYear()) * 12 + (t.getMonth() - from.getMonth())
          : Math.floor((startOfDay(t).getTime() - startOfDay(from).getTime()) / DAY_MS);
      if (idx >= 0 && idx < list.length) {
        list[idx].min += entryDurationMin(e);
        list[idx].entries.push(e);
      }
    }
    return list;
  });

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
   * Per-project rows for the summary table: total duration plus every entry's
   * note (`description`) for that project, joined with "; ". Notes are gathered
   * in chronological order and de-duplicated so a repeated note isn't listed
   * twice; blank descriptions are skipped. Shares `byProject`'s ordering.
   */
  let projectRows = $derived.by(() => {
    const notes = new Map();
    const byStart = [...completed].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    for (const e of byStart) {
      const key = e.projectId ?? NO_PROJECT;
      const note = e.description?.trim();
      if (!note) continue;
      if (!notes.has(key)) notes.set(key, new Set());
      notes.get(key).add(note);
    }
    return byProject.map((p) => ({
      ...p,
      notes: [...(notes.get(p.key) ?? [])].join('; '),
    }));
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

  /**
   * The hovered bar's detail for the chart tooltip, or null when nothing is
   * hovered: its date label, total, entry count, a small project breakdown, and
   * the bar's height as a % of the axis so the tooltip can sit atop the bar.
   * Height is capped so a near-full bar's tooltip stays inside the plot.
   */
  let hoveredDay = $derived.by(() => {
    if (hoveredIdx == null) return null;
    const b = buckets[hoveredIdx];
    if (!b) return null;
    const totals = new Map();
    for (const e of b.entries) {
      const key = e.projectId ?? NO_PROJECT;
      totals.set(key, (totals.get(key) ?? 0) + entryDurationMin(e));
    }
    const projects = [...totals.entries()]
      .map(([key, min]) => {
        const project = key === NO_PROJECT ? null : store.projectsById.get(key);
        return {
          key,
          name: project?.name ?? 'No project',
          color: project?.color ?? 'var(--no-project)',
          min,
        };
      })
      .sort((a, b) => b.min - a.min);
    const label =
      range.unit === 'month'
        ? b.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : b.start.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          });
    return {
      label,
      min: b.min,
      count: b.entries.length,
      heightPct: Math.min(72, axis.max ? (b.min / axis.max) * 100 : 0),
      projects: projects.slice(0, 4),
      more: Math.max(0, projects.length - 4),
    };
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
              <div
                class="bars"
                class:focusing={hoveredIdx != null}
                onmouseleave={() => (hoveredIdx = null)}
                role="group"
                aria-label="Tracked time per day; hover a bar to see that day's stats"
              >
                {#each buckets as b, i (b.start.getTime())}
                  <div
                    class="bar-col"
                    class:hovered={hoveredIdx === i}
                    role="button"
                    tabindex="0"
                    aria-label="{b.start.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })} · {formatDuration(b.min)}"
                    onmouseenter={() => (hoveredIdx = i)}
                    onfocus={() => (hoveredIdx = i)}
                    onblur={() => (hoveredIdx = null)}
                  >
                    {#if b.min > 0}
                      <div class="bar-fill" style:height="{(b.min / axis.max) * 100}%"></div>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if hoveredDay}
                <div
                  class="bar-tip"
                  class:flip={(hoveredIdx ?? 0) > buckets.length / 2}
                  style:left="{(((hoveredIdx ?? 0) + 0.5) / buckets.length) * 100}%"
                  style:bottom="{hoveredDay.heightPct}%"
                >
                  <div class="tip-when">{hoveredDay.label}</div>
                  <div class="tip-total">
                    {formatDuration(hoveredDay.min)} · {hoveredDay.count}
                    {hoveredDay.count === 1 ? 'entry' : 'entries'}
                  </div>
                  {#if hoveredDay.projects.length}
                    <ul class="tip-projects">
                      {#each hoveredDay.projects as p (p.key)}
                        <li>
                          <span class="legend-dot" style:background={p.color}></span>
                          <span class="tip-name">{p.name}</span>
                          <span class="tip-dur">{formatDuration(p.min)}</span>
                        </li>
                      {/each}
                      {#if hoveredDay.more}
                        <li class="tip-more">+{hoveredDay.more} more</li>
                      {/if}
                    </ul>
                  {/if}
                </div>
              {/if}
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
                </li>
              {/each}
            </ul>
          </div>
        </section>
      </div>

      <section class="card table-card">
        <h3>By project &amp; notes</h3>
        <div class="table-scroll">
          <table class="summary">
            <thead>
              <tr>
                <th class="col-project">Project</th>
                <th class="col-duration">Duration</th>
                <th class="col-notes">Notes</th>
              </tr>
            </thead>
            <tbody>
              {#each projectRows as p (p.key)}
                <tr>
                  <td class="col-project">
                    <span class="project-cell">
                      <span class="legend-dot" style:background={p.color}></span>
                      <span class="cell-name">{p.name}</span>
                    </span>
                  </td>
                  <td class="col-duration">{formatDuration(p.min)}</td>
                  <td class="col-notes">{p.notes || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
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
    cursor: pointer;
  }
  .bar-fill {
    width: 100%;
    max-width: 40px;
    min-height: 2px;
    background: var(--accent);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition:
      height 200ms cubic-bezier(0.4, 0, 0.2, 1),
      opacity 120ms ease;
  }
  /* While one bar is hovered, fade the rest so the focused day stands out. */
  .bars.focusing .bar-col:not(.hovered) .bar-fill {
    opacity: 0.4;
  }

  /* Floating per-day tooltip, anchored above the hovered bar. `left` is set
     inline to the bar's centre; we translate back by half our width to centre
     on it (or pull fully left, via .flip, for bars in the right half so the
     card doesn't run off the plot's right edge). */
  .bar-tip {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, 8px);
    min-width: 150px;
    max-width: 220px;
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 16px rgb(0 0 0 / 0.18));
    pointer-events: none;
    font-size: 12px;
  }
  .bar-tip.flip {
    transform: translate(-100%, 8px);
  }
  .tip-when {
    font-weight: 600;
    white-space: nowrap;
  }
  .tip-total {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    margin-bottom: var(--space-2);
  }
  .tip-projects {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .tip-projects li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tip-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tip-dur {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .tip-more {
    color: var(--muted);
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

  /* Summary table: project + total duration + all notes for the range. */
  .table-scroll {
    overflow-x: auto;
  }
  .summary {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .summary th {
    text-align: left;
    font-weight: 600;
    color: var(--muted);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .summary td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--grid-line);
    vertical-align: top;
  }
  .summary tbody tr:last-child td {
    border-bottom: 1px solid var(--border);
  }
  .summary .col-project {
    white-space: nowrap;
  }
  /* Inner wrapper keeps the dot + name on one line while the <td> stays a real
     table-cell, so the column widths and the top-aligned rows line up. */
  .project-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 220px;
  }
  .summary .cell-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .summary .col-duration {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    white-space: nowrap;
  }
  .summary .col-notes {
    color: var(--muted);
    line-height: 1.5;
    min-width: 220px;
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
