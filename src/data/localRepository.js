/**
 * A {@link Repository} backed entirely by the browser's localStorage — the data
 * layer for guest mode. It implements the same method shapes as
 * {@link module:apiRepository}, so the store can't tell which one it's talking
 * to; the difference is that nothing here ever touches the network or a server.
 *
 * Guest data lives only on this device. There are no accounts, sessions, teams
 * or sharing, so the auth/team/sharing methods are deliberately absent or inert
 * — the UI hides those affordances in guest mode (see store.isGuest). Export /
 * import use the same {@link WorkspaceExport} shape as the cloud backend, so a
 * guest can hand their data to a real account by exporting here and importing
 * there.
 *
 * Server semantics this mirrors on purpose (see src/routes/api/[...path]/+server.js):
 *   - listEntries returns entries whose start is in [from, to) PLUS the open
 *     running entry (end === null) regardless of range, ordered by start.
 *   - deleting a project nulls project_id on its entries (ON DELETE SET NULL).
 *   - deleting a tag removes it from every entry (entry_tags ON DELETE CASCADE).
 *   - deleting a workspace drops its projects, tags and entries.
 */

export const STORAGE_KEY = 'swish.guest.v1';
const DEFAULT_COLOR = '#6c5ce7';

const uuid = () => crypto.randomUUID();
const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/** Shape persisted under STORAGE_KEY. */
function emptyState() {
  return {
    activeWorkspaceId: /** @type {string|null} */ (null),
    theme: 'auto',
    weekStart: 0,
    hour12: true,
    workspaces: /** @type {Array<{id: string, name: string}>} */ ([]),
    projects:
      /** @type {Array<{id: string, workspaceId: string, name: string, color: string}>} */ ([]),
    tags: /** @type {Array<{id: string, workspaceId: string, name: string}>} */ ([]),
    entries:
      /** @type {Array<{id: string, workspaceId: string, description: string, projectId: string|null, tagIds: string[], start: string, end: string|null}>} */ ([]),
  };
}

// First run (or after a wipe): give the guest one workspace to land in, named to
// match the one registration auto-creates for a real account.
function seedState() {
  const state = emptyState();
  const ws = { id: uuid(), name: 'Personal' };
  state.workspaces.push(ws);
  state.activeWorkspaceId = ws.id;
  return state;
}

/**
 * Load the persisted guest state, seeding (and persisting) a fresh one on first
 * run or if the stored blob is missing/corrupt. Always returns a usable state.
 * @param {Storage} storage
 */
export function loadState(storage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (e.g. private mode); fall through to an in-memory seed */
  }
  if (raw) {
    try {
      return { ...emptyState(), ...JSON.parse(raw) };
    } catch {
      /* corrupt blob: replace it below */
    }
  }
  const seeded = seedState();
  saveState(storage, seeded);
  return seeded;
}

/** @param {Storage} storage */
function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota/unavailable: keep going with the in-memory copy */
  }
  return state;
}

// Match the API repository's posture: resolve asynchronously so the store
// behaves identically whether data comes from the network or from disk.
const resolve = (value) => Promise.resolve(value);

// The store expects workspaces as { id, name } (the `shared` flag is team-only).
const toWorkspace = (w) => ({ id: w.id, name: w.name });

/**
 * @param {Storage} [storage] localStorage by default; injectable for tests.
 */
export function createLocalRepository(storage = globalThis.localStorage) {
  const read = () => loadState(storage);
  const write = (state) => saveState(storage, state);

  return {
    // --- auth: no accounts in guest mode. `me` rejects like the API's 401 so any
    // session-probe path treats a guest as "not signed in"; the rest are inert. ---
    me: () => Promise.reject(Object.assign(new Error('Guest mode'), { status: 401 })),
    logout: () => resolve(),
    logoutOthers: () => resolve(),
    changePassword: () => Promise.reject(new Error('Not available in guest mode')),
    deleteAccount: () => Promise.reject(new Error('Not available in guest mode')),

    // --- entries ---
    listEntries: ({ from, to, workspaceId }) => {
      const { entries } = read();
      const f = new Date(from).getTime();
      const t = new Date(to).getTime();
      const rows = entries
        .filter((e) => e.workspaceId === workspaceId)
        .filter((e) => {
          const s = new Date(e.start).getTime();
          return (s >= f && s < t) || e.end === null;
        })
        .sort(byStart);
      return resolve(rows.map((e) => ({ ...e })));
    },

    createEntry: (data) => {
      const state = read();
      const entry = {
        id: uuid(),
        workspaceId: data.workspaceId,
        description: data.description ?? '',
        projectId: data.projectId ?? null,
        tagIds: data.tagIds ?? [],
        start: data.start,
        end: data.end ?? null,
      };
      state.entries.push(entry);
      write(state);
      return resolve({ ...entry });
    },

    updateEntry: (id, patch) => {
      const state = read();
      const entry = state.entries.find((e) => e.id === id);
      if (!entry) return Promise.reject(new Error('Not found'));
      // Only copy the fields the API accepts in a patch.
      for (const key of ['description', 'projectId', 'tagIds', 'start', 'end']) {
        if (key in patch) entry[key] = patch[key];
      }
      write(state);
      return resolve({ ...entry });
    },

    deleteEntry: (id) => {
      const state = read();
      state.entries = state.entries.filter((e) => e.id !== id);
      write(state);
      return resolve();
    },

    // --- projects ---
    listProjects: (workspaceId) => {
      const { projects } = read();
      return resolve(projects.filter((p) => p.workspaceId === workspaceId).map((p) => ({ ...p })));
    },

    createProject: (data) => {
      const state = read();
      const project = {
        id: uuid(),
        workspaceId: data.workspaceId,
        name: data.name ?? 'Project',
        color: data.color ?? DEFAULT_COLOR,
      };
      state.projects.push(project);
      write(state);
      return resolve({ ...project });
    },

    updateProject: (id, patch) => {
      const state = read();
      const project = state.projects.find((p) => p.id === id);
      if (!project) return Promise.reject(new Error('Not found'));
      if ('name' in patch) project.name = patch.name;
      if ('color' in patch) project.color = patch.color ?? DEFAULT_COLOR;
      write(state);
      return resolve({ ...project });
    },

    deleteProject: (id) => {
      const state = read();
      state.projects = state.projects.filter((p) => p.id !== id);
      // ON DELETE SET NULL: detach the project from any entries that used it.
      for (const e of state.entries) if (e.projectId === id) e.projectId = null;
      write(state);
      return resolve();
    },

    // --- tags ---
    listTags: (workspaceId) => {
      const { tags } = read();
      return resolve(tags.filter((t) => t.workspaceId === workspaceId).map((t) => ({ ...t })));
    },

    createTag: (data) => {
      const state = read();
      const tag = { id: uuid(), workspaceId: data.workspaceId, name: data.name ?? 'tag' };
      state.tags.push(tag);
      write(state);
      return resolve({ ...tag });
    },

    updateTag: (id, patch) => {
      const state = read();
      const tag = state.tags.find((t) => t.id === id);
      if (!tag) return Promise.reject(new Error('Not found'));
      if ('name' in patch) tag.name = patch.name;
      write(state);
      return resolve({ ...tag });
    },

    deleteTag: (id) => {
      const state = read();
      state.tags = state.tags.filter((t) => t.id !== id);
      // entry_tags ON DELETE CASCADE: drop the tag from every entry that had it.
      for (const e of state.entries) {
        if (e.tagIds.includes(id)) e.tagIds = e.tagIds.filter((t) => t !== id);
      }
      write(state);
      return resolve();
    },

    // --- workspaces ---
    listWorkspaces: () => resolve(read().workspaces.map(toWorkspace)),

    createWorkspace: (data) => {
      const state = read();
      const ws = { id: uuid(), name: data.name ?? 'Workspace' };
      state.workspaces.push(ws);
      write(state);
      return resolve(toWorkspace(ws));
    },

    updateWorkspace: (id, patch) => {
      const state = read();
      const ws = state.workspaces.find((w) => w.id === id);
      if (!ws) return Promise.reject(new Error('Not found'));
      if ('name' in patch) ws.name = patch.name;
      write(state);
      return resolve(toWorkspace(ws));
    },

    deleteWorkspace: (id) => {
      const state = read();
      state.workspaces = state.workspaces.filter((w) => w.id !== id);
      // Cascade: drop everything scoped to the workspace.
      state.projects = state.projects.filter((p) => p.workspaceId !== id);
      state.tags = state.tags.filter((t) => t.workspaceId !== id);
      state.entries = state.entries.filter((e) => e.workspaceId !== id);
      if (state.activeWorkspaceId === id) state.activeWorkspaceId = null;
      write(state);
      return resolve();
    },

    // --- settings ---
    setActiveWorkspaceId: (id) => {
      const state = read();
      state.activeWorkspaceId = id;
      write(state);
      return resolve();
    },

    setPreferences: (prefs) => {
      const state = read();
      for (const key of ['theme', 'weekStart', 'hour12']) {
        if (key in prefs) state[key] = prefs[key];
      }
      write(state);
      return resolve();
    },

    // --- export / import (the bridge to/from a real account) ---
    exportWorkspace: (workspaceId) => {
      const state = read();
      const ws = state.workspaces.find((w) => w.id === workspaceId);
      if (!ws) return Promise.reject(new Error('Not found'));
      const projects = state.projects
        .filter((p) => p.workspaceId === workspaceId)
        .map((p) => ({ id: p.id, name: p.name, color: p.color }));
      const tags = state.tags
        .filter((t) => t.workspaceId === workspaceId)
        .map((t) => ({ id: t.id, name: t.name }));
      const entries = state.entries
        .filter((e) => e.workspaceId === workspaceId)
        .sort(byStart)
        .map((e) => ({
          description: e.description,
          projectId: e.projectId,
          tagIds: e.tagIds,
          start: e.start,
          end: e.end,
        }));
      return resolve({
        type: 'swish.workspace',
        version: 1,
        name: ws.name,
        projects,
        tags,
        entries,
      });
    },

    importWorkspace: (payload) => {
      const state = read();
      const ws = { id: uuid(), name: (payload?.name || 'Imported workspace').toString() };
      state.workspaces.push(ws);

      // Remap ids so an import never collides with existing rows (mirrors the server).
      const projectIdMap = new Map();
      for (const p of payload?.projects ?? []) {
        const np = uuid();
        projectIdMap.set(p.id, np);
        state.projects.push({
          id: np,
          workspaceId: ws.id,
          name: p.name ?? 'Project',
          color: p.color ?? DEFAULT_COLOR,
        });
      }

      const tagIdMap = new Map();
      for (const t of payload?.tags ?? []) {
        const nt = uuid();
        tagIdMap.set(t.id, nt);
        state.tags.push({ id: nt, workspaceId: ws.id, name: t.name ?? 'tag' });
      }

      for (const e of payload?.entries ?? []) {
        const projectId = e.projectId != null ? (projectIdMap.get(e.projectId) ?? null) : null;
        const tagIds = (e.tagIds ?? []).map((tid) => tagIdMap.get(tid)).filter(Boolean);
        state.entries.push({
          id: uuid(),
          workspaceId: ws.id,
          description: e.description ?? '',
          projectId,
          tagIds,
          start: e.start,
          end: e.end ?? null,
        });
      }

      write(state);
      return resolve(toWorkspace(ws));
    },
  };
}

/**
 * Wipe all guest data from this browser. The next read re-seeds a fresh, empty
 * workspace. Callers should reload afterwards so the store re-hydrates.
 * @param {Storage} [storage]
 */
export function clearGuestData(storage = globalThis.localStorage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/**
 * Build the guest bootstrap synchronously from localStorage, in the same shape
 * {@link AppStore#hydrate} receives from the server `load` for a real account.
 * localStorage is synchronous, so the guest hydrate stays synchronous too (the
 * page renders with content rather than a placeholder — see routes/+page.svelte).
 * Seeds a first workspace on first run.
 *
 * @param {Storage} [storage]
 */
export function readGuestBootstrap(storage = globalThis.localStorage) {
  const state = loadState(storage);
  const accessibleIds = new Set(state.workspaces.map((w) => w.id));
  const activeWorkspaceId = accessibleIds.has(state.activeWorkspaceId)
    ? state.activeWorkspaceId
    : (state.workspaces[0]?.id ?? null);
  return {
    username: 'Guest',
    theme: state.theme,
    weekStart: state.weekStart,
    hour12: state.hour12,
    workspaces: state.workspaces.map(toWorkspace),
    sharedWorkspaces: [],
    teamRole: null,
    activeWorkspaceId,
    projects: activeWorkspaceId
      ? state.projects.filter((p) => p.workspaceId === activeWorkspaceId).map((p) => ({ ...p }))
      : [],
    tags: activeWorkspaceId
      ? state.tags.filter((t) => t.workspaceId === activeWorkspaceId).map((t) => ({ ...t }))
      : [],
  };
}
