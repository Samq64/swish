/**
 * Unit tests for the voice-dictation parser (src/lib/parse-entry.js).
 *
 *   npm test
 *
 * parseEntry turns a Whisper transcript into a time entry. These tests pin the
 * behaviour we rely on: range detection, the business-hours/day heuristics, the
 * explicit-cue project matching, and the natural-language normalisations
 * ("between X and Y", "till"/"thru", spoken word-numbers).
 *
 * Dates are built with the local-time Date constructor and asserted via
 * getHours()/day-offset — the parser also works in local time, so the tests are
 * timezone-independent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry } from '../src/lib/parse-entry.js';

// Thursday, 18 June 2026, 09:00 local.
const NOW = new Date(2026, 5, 18, 9, 0, 0, 0);
const PROJECTS = [
  { id: 'p1', name: 'Swish' },
  { id: 'p2', name: 'Client Work' },
  { id: 'p3', name: 'API Design' },
];

const parse = (text) => parseEntry(text, NOW, PROJECTS);
/** Local [hour, minute] of an ISO timestamp. */
const hm = (iso) => {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()];
};
/** Whole-day offset of an ISO timestamp from NOW (0 = today, -1 = yesterday). */
const dayOffset = (iso) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const n = new Date(NOW);
  n.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - n.getTime()) / 86_400_000);
};

test('a basic range becomes an entry with a cleaned, capitalised description', () => {
  const r = parse('client call 9 to 10:30 am');
  assert.ok(r);
  assert.equal(r.description, 'Client call');
  assert.deepEqual(hm(r.start), [9, 0]);
  assert.deepEqual(hm(r.end), [10, 30]);
  assert.equal(dayOffset(r.start), 0);
});

test('text with no time range returns null (falls back to a plain description)', () => {
  assert.equal(parse('just thinking about stuff'), null);
});

test('ambiguous afternoon hours get a business-hours bias (1–6 → PM)', () => {
  const r = parse('design review 2 to 4');
  assert.deepEqual(hm(r.start), [14, 0]);
  assert.deepEqual(hm(r.end), [16, 0]);
});

test('an explicit meridiem is respected over the bias', () => {
  const r = parse('standup 9 to 10 am');
  assert.deepEqual(hm(r.start), [9, 0]);
  assert.deepEqual(hm(r.end), [10, 0]);
});

test('a 9-to-5 span spreads across the day', () => {
  const r = parse('focus block nine to five');
  assert.deepEqual(hm(r.start), [9, 0]);
  assert.deepEqual(hm(r.end), [17, 0]);
});

test('"yesterday" shifts the entry back a day', () => {
  const r = parse('design review from 2 to 4 yesterday');
  assert.equal(dayOffset(r.start), -1);
  assert.deepEqual(hm(r.start), [14, 0]);
});

test('a weekday name resolves to the most recent past occurrence', () => {
  const r = parse('standup monday 9:30 to 10');
  assert.equal(new Date(r.start).getDay(), 1, 'should land on a Monday');
  assert.ok(new Date(r.start).getTime() < NOW.getTime(), 'should be in the past');
});

test('a plain future-looking time with no day word stays today', () => {
  // 2pm is after NOW (09:00) but the user means today, not yesterday.
  const r = parse('meeting from 2 to 4 pm');
  assert.equal(dayOffset(r.start), 0);
  assert.deepEqual(hm(r.start), [14, 0]);
});

test('an end before the start is clamped to the same day, not the next', () => {
  const r = parse('lunch 12 to 1');
  assert.deepEqual(hm(r.start), [12, 0]);
  assert.deepEqual(hm(r.end), [13, 0]);
  assert.equal(dayOffset(r.end), 0);
});

test('"between X and Y" is read as a range', () => {
  const r = parse('emails between 8 and 8:45 am');
  assert.deepEqual(hm(r.start), [8, 0]);
  assert.deepEqual(hm(r.end), [8, 45]);
});

test('alternative separators (till / thru) work', () => {
  assert.deepEqual(hm(parse('standup from 9 till 9:30').end), [9, 30]);
  assert.deepEqual(hm(parse('design two thru three').start), [14, 0]);
});

test('spoken word-numbers are parsed via the fallback pass', () => {
  const r = parse('review two thirty to three');
  assert.deepEqual(hm(r.start), [14, 30]);
  assert.deepEqual(hm(r.end), [15, 0]);
});

test('a dashed range ("2-4") is read as a range', () => {
  const bare = parse('design review 2-4');
  assert.deepEqual(hm(bare.start), [14, 0]); // business-hours bias
  assert.deepEqual(hm(bare.end), [16, 0]);

  const withMeridiem = parse('standup 10-11:30 am');
  assert.deepEqual(hm(withMeridiem.start), [10, 0]);
  assert.deepEqual(hm(withMeridiem.end), [11, 30]);
});

test('the dash-range fix leaves hyphenated words and dates alone', () => {
  // No digits on both sides of the hyphen → untouched, so no range, null result.
  assert.equal(parse('one-on-one catch-up'), null);
  // A date chain must not be split into a spurious range.
  assert.equal(parse('migrate the 2026-06-18 export'), null);
});

test('a description keeps hyphenated number words intact', () => {
  const r = parse('one-on-one with Sam from 3 to 3:30');
  assert.equal(r.description, 'One-on-one with Sam');
  assert.deepEqual(hm(r.start), [15, 0]);
});

// --- explicit-cue project matching ---------------------------------------

test('an explicit cue ("for <name>") attaches a confidently-matched project', () => {
  const r = parse('design review for swish 2 to 4');
  assert.equal(r.projectId, 'p1');
  assert.equal(r.description, 'Design review');
});

test('"on <name>" also works as a cue', () => {
  assert.equal(parse('standup on client work 9 to 9:30').projectId, 'p2');
});

test('without a cue, no project is attached even if a word matches a name', () => {
  // "design" overlaps "API Design" but there is no cue, so stay empty.
  assert.equal(parse('design review 2 to 4').projectId, null);
});

test('a stopword-only cue phrase matches nothing', () => {
  assert.equal(parse('planning for the work 2 to 3').projectId, null);
});

test('filler verbs are stripped from the description', () => {
  // Both the filler verb ("worked on") and the leading article are stripped.
  assert.equal(parse('worked on the migration from 2 to 4').description, 'Migration');
  assert.equal(parse('logged emails 9 to 10 am').description, 'Emails');
});
