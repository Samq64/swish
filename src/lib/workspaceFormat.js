/**
 * The workspace data format and its pure transforms — the single source of
 * truth shared by the cloud backend (src/routes/api/[...path]/+server.js) and
 * the guest-mode local repository (src/data/localRepository.js).
 *
 * Both backends store data differently (D1 SQL vs localStorage), but they must
 * agree on the *format-level* decisions: the default colour, the export
 * envelope and field selection, and how an import re-maps ids. Keeping those
 * here means the two can't silently drift — change the rule once and both
 * follow. (The range/running-entry query and the cascade-on-delete behaviour
 * are inherently SQL-vs-JS and live in each backend, verified to match by the
 * repository conformance tests.)
 *
 * This module is pure: no D1, no fetch, no DOM. `crypto.randomUUID` is the only
 * ambient dependency, available in the Worker, the browser and Node alike.
 */

/** Fallback project colour when none is supplied (matches the --accent token). */
export const DEFAULT_COLOR = '#6c5ce7';

/** Name of the workspace auto-created for a new account or guest. */
export const DEFAULT_WORKSPACE_NAME = 'Personal';

/** Name given to an imported workspace when the payload doesn't carry one. */
export const IMPORTED_WORKSPACE_NAME = 'Imported workspace';

/** Discriminator + version stamped on (and required by) an export file. */
export const EXPORT_TYPE = 'swish.workspace';
export const EXPORT_VERSION = 1;

/** True for a valid workspace export payload. */
export function isWorkspaceExport(payload) {
  return payload?.type === EXPORT_TYPE;
}

const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/**
 * Build the serialisable export payload from a workspace's records. Inputs may
 * carry extra fields (e.g. ids, workspaceId); only the export fields are kept,
 * and entries are ordered by start so the file is identical regardless of which
 * backend produced it.
 *
 * @param {string} name
 * @param {{
 *   projects: Array<{ id: string, name: string, color: string }>,
 *   tags: Array<{ id: string, name: string }>,
 *   entries: Array<{ description: string, projectId: string|null, tagIds: string[], start: string, end: string|null }>,
 * }} records
 */
export function buildExport(name, { projects, tags, entries }) {
  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    name,
    projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    entries: [...entries].sort(byStart).map((e) => ({
      description: e.description,
      projectId: e.projectId,
      tagIds: e.tagIds,
      start: e.start,
      end: e.end,
    })),
  };
}

/**
 * Turn an import payload into the records to create, with fresh ids throughout
 * and project/tag references re-mapped to the new ids (so an import never
 * collides with existing rows, and dangling references are dropped). The caller
 * persists the result however it stores data: the server binds these into SQL
 * inserts, the local repo pushes them into its state. Children carry their own
 * id but not a workspaceId — the caller owns the returned `workspace.id`.
 *
 * @param {{
 *   name?: string,
 *   projects?: Array<{ id: string, name?: string, color?: string }>,
 *   tags?: Array<{ id: string, name?: string }>,
 *   entries?: Array<{ description?: string, projectId?: string|null, tagIds?: string[], start: string, end?: string|null }>,
 * }} payload
 */
export function planImport(payload) {
  const workspace = {
    id: crypto.randomUUID(),
    name: (payload?.name || IMPORTED_WORKSPACE_NAME).toString(),
  };

  const projectIdMap = new Map();
  const projects = (payload?.projects ?? []).map((p) => {
    const id = crypto.randomUUID();
    projectIdMap.set(p.id, id);
    return { id, name: p.name ?? 'Project', color: p.color ?? DEFAULT_COLOR };
  });

  const tagIdMap = new Map();
  const tags = (payload?.tags ?? []).map((t) => {
    const id = crypto.randomUUID();
    tagIdMap.set(t.id, id);
    return { id, name: t.name ?? 'tag' };
  });

  const entries = (payload?.entries ?? []).map((e) => ({
    id: crypto.randomUUID(),
    description: e.description ?? '',
    projectId: e.projectId != null ? (projectIdMap.get(e.projectId) ?? null) : null,
    tagIds: (e.tagIds ?? []).map((tid) => tagIdMap.get(tid)).filter(Boolean),
    start: e.start,
    end: e.end ?? null,
  }));

  return { workspace, projects, tags, entries };
}
