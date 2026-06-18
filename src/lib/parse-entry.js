import * as chrono from 'chrono-node';

/**
 * Voice-dictated time entry parser.
 *
 * chrono-node does the heavy lifting of finding a time range and any day
 * reference ("yesterday", "Monday") in free speech. On top of it we add the
 * domain logic chrono can't know:
 *   - a business-hours bias for ambiguous times (chrono defaults to AM)
 *   - keeping an entry within a single day (no accidental cross-midnight)
 *   - cleaning the leftover text into a description
 *   - matching the description to an existing project
 */

// Generic words that must NOT be enough, on their own, to pin an entry to a
// project — otherwise "deep work on the API" matches a "Client Work" project.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'work', 'stuff', 'task', 'time', 'some', 'this', 'that',
]);

// Filler left clinging to the description once the time span is cut out.
const EDGE_FILLER =
  /^(?:from|to|at|around|about|like|for|on|of|the|um|uh|so)\b|\b(?:from|to|at|around|about|like|for|on|of|um|uh|so)$/gi;

const PHRASE_FILLER = [
  /\bi\s+(?:just\s+)?(?:was\s+)?worked\s+on\b/gi,
  /\bworked\s+on\b/gi,
  /\bi(?:'m|\s+am|\s+was)?\s+working\s+on\b/gi,
  /\bworking\s+on\b/gi,
  /\bspent\s+(?:some\s+)?time\s+(?:on\b)?/gi,
  /\b(?:log|logged|track|tracked|add|record)\b/gi,
];

const WEEKDAY_RE = /\b(?:mon|tues?|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)(?:day)?\b/i;
const DAY_WORD_RE = /\b(?:yesterday|today|tonight|tomorrow|last|this|next)\b/i;

/** Did the matched time phrase actually name a day (vs. just a clock time)? */
function hasDayReference(matchedText) {
  return DAY_WORD_RE.test(matchedText) || WEEKDAY_RE.test(matchedText);
}

/**
 * @param {string} transcript
 * @param {Date} now
 * @param {Array<{id: string, name: string}>} projects
 * @returns {{ description: string, start: string, end: string, projectId: string|null } | null}
 *   Returns null when no time range is found — treat as a plain description input.
 */
export function parseEntry(transcript, now, projects) {
  // "between 8 and 8:45" → "8 to 8:45" so chrono reads it as one range. Only
  // fires between time-like tokens, so descriptions ("between teams") are safe.
  const raw = normalizeCompactTimes(
    transcript
      .trim()
      // "between 8 and 8:45" → "8 to 8:45" so chrono reads it as one range. Only
      // fires between time-like tokens, so descriptions ("between teams") are safe.
      .replace(/\bbetween\s+(\d[\d:.\s]*?)\s+and\s+(\d[\d:.]*)/gi, '$1 to $2')
      // Whisper sometimes splits the meridiem: "2 p m" / "p. m." → "2 pm".
      // `m\b` anchors on the m itself so a trailing dot is consumed cleanly and
      // words like "a memo" (m not its own token) are left alone.
      .replace(/\b([ap])\.?\s+m\b\.?/gi, '$1m')
  );

  // First pass on the verbatim text keeps a clean description (no digit
  // mangling of words like "one-on-one"). Only if chrono finds no range do we
  // normalise spoken numbers ("two thirty") and retry.
  let text = raw;
  let result = pickRange(chrono.parse(raw, now, { forwardDate: false }));
  if (!result) {
    text = normalizeSpokenTimes(raw);
    result = pickRange(chrono.parse(text, now, { forwardDate: false }));
  }
  if (!result) return null;

  const { start, end } = resolveTimes(result, now, text);

  const cleaned = cleanDescription(text, result.index, result.text.length);
  // A project is only attached on an explicit spoken cue ("for/on <name>"),
  // and only when it confidently matches a real project — never guessed from
  // the description, so a wrong project can't be silently saved while driving.
  const { projectId, description } = extractProject(cleaned, projects);

  return {
    description: description.charAt(0).toUpperCase() + description.slice(1),
    start: start.toISOString(),
    end: end.toISOString(),
    projectId,
  };
}

// ---------------------------------------------------------------------------

/** First chrono result that actually spans a range (has both ends). */
function pickRange(results) {
  return results.find((r) => r.start && r.end) ?? null;
}

/**
 * Turn chrono's components into concrete start/end Dates, applying:
 *  - business-hours bias when chrono is unsure of am/pm (it defaults to AM)
 *  - same-day clamping so "12 to 1" doesn't roll past midnight
 */
function resolveTimes(result, now, text) {
  const day = result.start.date(); // carries any "yesterday"/"Monday" offset
  day.setHours(0, 0, 0, 0);

  let sh = result.start.get('hour') ?? 9;
  const sm = result.start.get('minute') ?? 0;
  let eh = result.end.get('hour') ?? sh + 1;
  const em = result.end.get('minute') ?? 0;

  if (!result.start.isCertain('meridiem')) sh = bizHour(sh);
  if (!result.end.isCertain('meridiem')) eh = bizHour(eh);

  let start = at(day, sh, sm);
  let end = at(day, eh, em);

  // End not after start → assume it's later the same day (1 → 13), not tomorrow.
  if (end <= start) {
    end = at(day, eh + 12, em);
    if (end <= start) end = at(day, eh + 24, em); // last resort, genuine overnight
  }

  // Guard against chrono resolving a *named* day into the future — logged work
  // is always past. With no day reference we leave it on today even if the hour
  // is later today (the user means today, not yesterday).
  if (hasDayReference(result.text)) {
    const unit = WEEKDAY_RE.test(text) ? 7 : 1;
    while (start.getTime() > now.getTime()) {
      start = shiftDays(start, -unit);
      end = shiftDays(end, -unit);
    }
  }

  return { start, end };
}

/** Bias a bare hour toward the afternoon: 1–6 → 13–18; leave 7–12 as morning. */
function bizHour(h) {
  return h >= 1 && h <= 6 ? h + 12 : h;
}

function at(day, h, m) {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

function shiftDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/**
 * Whisper often writes clock times without the colon ("1215" for 12:15, "915"
 * for 9:15). chrono can't read those, so a range like "1215 to 2pm" loses its
 * start and no entry is created. Insert the colon — but only for a 3–4 digit
 * run that sits next to a range word or am/pm, so ID-like numbers in a
 * description ("ticket 1215 done") are left alone.
 */
function normalizeCompactTimes(s) {
  const toHM = (digits) => {
    const n = digits.length;
    const h = +digits.slice(0, n - 2);
    const m = +digits.slice(n - 2);
    if (h > 23 || m > 59) return null;
    return `${h}:${String(m).padStart(2, '0')}`;
  };
  const RANGE = String.raw`to|until|till|til|thru|through|and|-|–|—`;
  return s
    .replace(new RegExp(String.raw`\b(\d{3,4})(\s*(?:${RANGE})\b)`, 'gi'), (m, d, sep) => {
      const t = toHM(d);
      return t ? t + sep : m;
    })
    .replace(new RegExp(String.raw`((?:\b(?:${RANGE}|from)\b)\s*)(\d{3,4})\b`, 'gi'), (m, sep, d) => {
      const t = toHM(d);
      return t ? sep + t : m;
    })
    .replace(/\b(\d{3,4})(\s*[ap]\.?m\.?)/gi, (m, d, ap) => {
      const t = toHM(d);
      return t ? t + ap : m;
    });
}

/**
 * Convert spoken clock numbers to digits so chrono can read them, e.g.
 * "two thirty to four" → "2:30 to 4". Only used as a fallback, so it can be
 * aggressive without risking the common (already-digits) transcript.
 */
function normalizeSpokenTimes(s) {
  const HOURS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  let out = s
    .toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (m) => String(HOURS[m]));

  // "2 thirty" / "2 fifteen" / "2 forty five" → "2:30" etc.
  out = out
    .replace(/(\d{1,2})\s+(?:thirty|half)\b/g, '$1:30')
    .replace(/(\d{1,2})\s+(?:fifteen|quarter)\b/g, '$1:15')
    .replace(/(\d{1,2})\s+forty[\s-]?five\b/g, '$1:45')
    .replace(/(\d{1,2})\s+forty\b/g, '$1:40')
    .replace(/(\d{1,2})\s+twenty[\s-]?five\b/g, '$1:25')
    .replace(/(\d{1,2})\s+twenty\b/g, '$1:20')
    .replace(/(\d{1,2})\s+fifty\b/g, '$1:50')
    .replace(/(\d{1,2})\s+(?:o'?clock)\b/g, '$1');

  return out;
}

/** Remove the time span from the text, then strip filler down to a task name. */
function cleanDescription(text, index, length) {
  let desc = (text.slice(0, index) + ' ' + text.slice(index + length)).replace(/\s+/g, ' ').trim();

  for (const re of PHRASE_FILLER) desc = desc.replace(re, ' ');
  desc = desc.replace(/\s+/g, ' ').trim();

  // Trim dangling prepositions/articles left at either edge (e.g. "from like").
  let prev;
  do {
    prev = desc;
    desc = desc.replace(EDGE_FILLER, '').trim();
    desc = desc.replace(/^[\s.,;:\-–]+|[\s.,;:\-–]+$/g, '').trim();
  } while (desc !== prev);

  return desc;
}

// Spoken cues that introduce a project name. The candidate phrase runs from the
// cue to the end of the (already time-stripped) description, since people put
// the project last: "client call for Acme", "design review on the API".
const PROJECT_CUES = [
  /\b(?:for|on|under)\s+(?:the\s+)?(.+)$/i, // "...for/on <name>"
  /\bproject\s+(?:called\s+)?(.+)$/i, // "...project Acme"
  /\b(\w+(?:\s+\w+){0,2})\s+project\b/i, // "Acme project"
];

/**
 * Pull an explicitly-cued project out of the description. On a confident match
 * the cue phrase is removed from the description and the project id returned;
 * otherwise the description is returned untouched with no project.
 *
 * @returns {{ projectId: string|null, description: string }}
 */
function extractProject(description, projects) {
  if (!projects?.length || !description) return { projectId: null, description };

  for (const re of PROJECT_CUES) {
    const m = description.match(re);
    if (!m) continue;
    const phrase = m[1].replace(/\bproject\b/gi, ' ').trim();
    const projectId = confidentMatch(phrase, projects);
    if (projectId) {
      const rest = description.slice(0, m.index).replace(/[\s.,;:–-]+$/, '').trim();
      return { projectId, description: rest };
    }
  }

  return { projectId: null, description };
}

/**
 * Score a short cued phrase against project names. A distinctive word (not a
 * stopword) is worth 2, a generic stopword overlap 0.5; the best project wins
 * only if it clears one distinctive hit, so "for the stuff" matches nothing.
 */
function confidentMatch(phrase, projects) {
  const words = new Set(phrase.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
  if (!words.size) return null;

  let bestId = null;
  let bestScore = 0;
  for (const proj of projects) {
    const projWords = proj.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    let score = 0;
    for (const w of projWords) {
      if (words.has(w)) score += STOPWORDS.has(w) ? 0.5 : 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = proj.id;
    }
  }

  return bestScore >= 2 ? bestId : null;
}
