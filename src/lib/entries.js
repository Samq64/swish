/**
 * Small pure helpers for reading derived facts off a time entry. They take the
 * relevant lookup map so they stay framework-agnostic and testable; the store
 * exposes `projectsById` / `tagsById` for callers to pass in.
 */

/** The project an entry belongs to, or null. */
export function entryProject(entry, projectsById) {
  return entry?.projectId ? (projectsById.get(entry.projectId) ?? null) : null;
}

/** An entry's project colour, falling back to the accent colour. */
export function entryColor(entry, projectsById, fallback = 'var(--accent)') {
  return entryProject(entry, projectsById)?.color ?? fallback;
}

/** Names of the tags assigned to an entry (skips any that no longer exist). */
export function entryTagNames(entry, tagsById) {
  return (entry?.tagIds ?? [])
    .map((id) => tagsById.get(id)?.name)
    .filter(Boolean);
}

/** Duration of a completed entry, in minutes. */
export function entryDurationMin(entry) {
  return (new Date(entry.end).getTime() - new Date(entry.start).getTime()) / 60000;
}
