/**
 * Pure time helpers for the day timeline.
 *
 * The timeline works internally in "minutes from midnight" (0–1440) of the
 * day being displayed. Persistence uses absolute ISO timestamps, so all
 * conversion between the two worlds lives here.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Vertical scale of the timeline. One hour == this many pixels. */
export const PX_PER_HOUR = 60;

/** Drag snapping granularity, in minutes. */
export const SNAP_MINUTES = 15;

/** Minimum length of an entry, in minutes. */
export const MIN_DURATION = 15;

/** Pixels for a given number of minutes. */
export function minutesToPx(minutes) {
  return (minutes / 60) * PX_PER_HOUR;
}

/** Minutes for a given pixel offset. */
export function pxToMinutes(px) {
  return (px / PX_PER_HOUR) * 60;
}

/** Round a minute value to the nearest SNAP_MINUTES. */
export function snap(minutes, step = SNAP_MINUTES) {
  return Math.round(minutes / step) * step;
}

/** Clamp a value into [min, max]. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Start of `date`'s day, as a Date. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A new Date `n` days after `date` (n may be negative). */
export function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Start of the week containing `date`. `weekStartsOn` is 0 (Sun) … 1 (Mon).
 */
export function startOfWeek(date, weekStartsOn = 0) {
  const d = startOfDay(date);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/** Minutes from midnight for an absolute Date/ISO string. */
export function dateToMinutes(value) {
  const d = new Date(value);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Absolute ISO timestamp for `minutes` from midnight of `day`. */
export function minutesToISO(day, minutes) {
  const base = startOfDay(day);
  base.setMinutes(base.getMinutes() + Math.round(minutes));
  return base.toISOString();
}

/** Whether two ISO/Date values fall on the same calendar day. */
export function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Human label for a duration in minutes, e.g. "1:30:00". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes * 60)); // seconds
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Clock label for minutes-from-midnight: "9:00 AM" (hour12) or "09:00". */
export function formatClock(minutes, hour12 = true) {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  if (!hour12) {
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
}

/**
 * Lane assignment so overlapping entries render side by side. Returns a Map of
 * entry id -> { lane, lanes } where `lanes` is the number of columns in that
 * entry's overlap cluster.
 *
 * Lanes are assigned by each block's stable `order` key (falling back to start
 * time), NOT by start time alone. This keeps columns put when an entry is
 * dragged: two side-by-side entries never swap places just because one now
 * starts earlier than the other.
 *
 * @param {Array<{id: string, startMin: number, endMin: number, order?: number}>} blocks
 */
export function packLanes(blocks) {
  const result = new Map();
  const overlaps = (a, b) => a.startMin < b.endMin && b.startMin < a.endMin;

  // Cluster by time overlap (must walk in time order to find contiguous runs).
  const byTime = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );

  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    // Within the cluster, place blocks in a STABLE order so columns are kept.
    const ordered = [...cluster].sort(
      (a, b) => (a.order ?? a.startMin) - (b.order ?? b.startMin),
    );
    const lanes = []; // lanes[i] = blocks already placed in column i
    for (const b of ordered) {
      let lane = lanes.findIndex((col) => col.every((x) => !overlaps(x, b)));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(b);
      result.set(b.id, { lane, lanes: 0 });
    }
    for (const b of cluster) result.get(b.id).lanes = lanes.length;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const b of byTime) {
    if (b.startMin >= clusterEnd && cluster.length > 0) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.endMin);
  }
  flush();

  return result;
}
