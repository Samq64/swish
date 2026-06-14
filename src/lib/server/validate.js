// Tiny runtime validators for API request bodies. Hand-rolled, no dependencies.
// Handlers compose these to reject malformed input with a 400 before it reaches
// the database.

// ISO 8601 instant, e.g. 2026-06-13T08:30:00.000Z or with a numeric offset.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** A string that parses as an ISO 8601 timestamp. */
export function isIso(v) {
  return typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/** A string within optional length bounds (defaults: any length). */
export function isStr(v, { min = 0, max = Infinity } = {}) {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

/** An array whose every element is a string. */
export function isStrArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** A CSS hex colour (#rgb … #rrggbbaa). */
export function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
}
