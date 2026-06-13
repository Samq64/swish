import { newId } from './repository.js';

/**
 * A {@link Repository} backed by localStorage. Async on purpose: the method
 * signatures match what a network-backed repository would look like, so the
 * store and UI never need to change when a backend arrives.
 */

const ENTRIES_KEY = 'swish.entries.v1';
const PROJECTS_KEY = 'swish.projects.v1';
const TAGS_KEY = 'swish.tags.v1';
const WORKSPACES_KEY = 'swish.workspaces.v1';
const ACTIVE_KEY = 'swish.activeWorkspace.v1';

const DEFAULT_WORKSPACE = { id: 'w_default', name: 'Workspace' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Simulate async I/O so calling code is written against real latency. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `base`, or `base (2)`, `base (3)`… — whichever is not already in `taken`. */
function uniqueName(base, taken) {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function createLocalRepository() {
  // Only a workspace must exist up front; projects and tags start empty and a
  // missing key already reads as []. Seeding the default workspace also keeps
  // createWorkspace from dropping it on the first add.
  if (read(WORKSPACES_KEY, null) === null) {
    write(WORKSPACES_KEY, [DEFAULT_WORKSPACE]);
  }
  if (read(ACTIVE_KEY, null) === null) {
    write(ACTIVE_KEY, DEFAULT_WORKSPACE.id);
  }

  const activeId = () => read(ACTIVE_KEY, DEFAULT_WORKSPACE.id);

  return {
    async listEntries({ from, to, workspaceId }) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      return all.filter(
        (e) =>
          e.workspaceId === workspaceId && e.start >= from && e.start < to,
      );
    },

    async createEntry(data) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      const entry = {
        id: newId(),
        workspaceId: data.workspaceId ?? activeId(),
        description: data.description ?? '',
        projectId: data.projectId ?? null,
        tagIds: data.tagIds ?? [],
        start: data.start,
        end: data.end ?? null,
      };
      all.push(entry);
      write(ENTRIES_KEY, all);
      return entry;
    },

    async updateEntry(id, patch) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      const idx = all.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`No entry ${id}`);
      all[idx] = { ...all[idx], ...patch, id };
      write(ENTRIES_KEY, all);
      return all[idx];
    },

    async deleteEntry(id) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      write(
        ENTRIES_KEY,
        all.filter((e) => e.id !== id),
      );
    },

    async listProjects(workspaceId) {
      await tick();
      return read(PROJECTS_KEY, []).filter((p) => p.workspaceId === workspaceId);
    },

    async createProject(data) {
      await tick();
      const all = read(PROJECTS_KEY, []);
      const project = {
        id: newId('p'),
        workspaceId: data.workspaceId ?? activeId(),
        name: data.name ?? 'New project',
        color: data.color ?? '#6c5ce7',
      };
      all.push(project);
      write(PROJECTS_KEY, all);
      return project;
    },

    async updateProject(id, patch) {
      await tick();
      const all = read(PROJECTS_KEY, []);
      const idx = all.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`No project ${id}`);
      all[idx] = { ...all[idx], ...patch, id };
      write(PROJECTS_KEY, all);
      return all[idx];
    },

    async deleteProject(id) {
      await tick();
      const all = read(PROJECTS_KEY, []);
      write(
        PROJECTS_KEY,
        all.filter((p) => p.id !== id),
      );
    },

    async listTags(workspaceId) {
      await tick();
      return read(TAGS_KEY, []).filter((t) => t.workspaceId === workspaceId);
    },

    async createTag(data) {
      await tick();
      const all = read(TAGS_KEY, []);
      const tag = {
        id: newId('t'),
        workspaceId: data.workspaceId ?? activeId(),
        name: data.name ?? 'tag',
      };
      all.push(tag);
      write(TAGS_KEY, all);
      return tag;
    },

    async updateTag(id, patch) {
      await tick();
      const all = read(TAGS_KEY, []);
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`No tag ${id}`);
      all[idx] = { ...all[idx], ...patch, id };
      write(TAGS_KEY, all);
      return all[idx];
    },

    async deleteTag(id) {
      await tick();
      const all = read(TAGS_KEY, []);
      write(
        TAGS_KEY,
        all.filter((t) => t.id !== id),
      );
      // Strip the tag from every entry that referenced it, everywhere.
      const entries = read(ENTRIES_KEY, []);
      let changed = false;
      for (const e of entries) {
        if (e.tagIds?.includes(id)) {
          e.tagIds = e.tagIds.filter((t) => t !== id);
          changed = true;
        }
      }
      if (changed) write(ENTRIES_KEY, entries);
    },

    async listWorkspaces() {
      await tick();
      return read(WORKSPACES_KEY, [DEFAULT_WORKSPACE]);
    },

    async createWorkspace(data) {
      await tick();
      const all = read(WORKSPACES_KEY, []);
      const ws = { id: newId('w'), name: data.name ?? 'New workspace' };
      all.push(ws);
      write(WORKSPACES_KEY, all);
      return ws;
    },

    async updateWorkspace(id, patch) {
      await tick();
      const all = read(WORKSPACES_KEY, []);
      const idx = all.findIndex((w) => w.id === id);
      if (idx === -1) throw new Error(`No workspace ${id}`);
      all[idx] = { ...all[idx], ...patch, id };
      write(WORKSPACES_KEY, all);
      return all[idx];
    },

    async deleteWorkspace(id) {
      await tick();
      write(
        WORKSPACES_KEY,
        read(WORKSPACES_KEY, []).filter((w) => w.id !== id),
      );
      // Cascade: drop everything that belonged to the workspace.
      for (const key of [ENTRIES_KEY, PROJECTS_KEY, TAGS_KEY]) {
        write(
          key,
          read(key, []).filter((it) => it.workspaceId !== id),
        );
      }
    },

    async getActiveWorkspaceId() {
      await tick();
      return activeId();
    },

    async setActiveWorkspaceId(id) {
      await tick();
      write(ACTIVE_KEY, id);
    },

    async exportWorkspace(workspaceId) {
      await tick();
      const ws = read(WORKSPACES_KEY, []).find((w) => w.id === workspaceId);
      if (!ws) throw new Error(`No workspace ${workspaceId}`);
      // Keep records' own ids (so entries can reference projects/tags) but drop
      // workspaceId — the importer assigns a fresh workspace.
      const own = (key) =>
        read(key, [])
          .filter((it) => it.workspaceId === workspaceId)
          .map(({ workspaceId: _ignored, ...rest }) => rest);
      return {
        type: 'swish.workspace',
        version: 1,
        workspace: { name: ws.name },
        projects: own(PROJECTS_KEY),
        tags: own(TAGS_KEY),
        entries: own(ENTRIES_KEY),
      };
    },

    async importWorkspace(payload) {
      await tick();
      const workspaces = read(WORKSPACES_KEY, []);
      const ws = {
        id: newId('w'),
        name: uniqueName(
          payload?.workspace?.name?.trim() || 'Imported workspace',
          workspaces.map((w) => w.name),
        ),
      };
      write(WORKSPACES_KEY, [...workspaces, ws]);

      // Re-create projects and tags with fresh ids, tracking old -> new so
      // entries can be re-pointed at them.
      const projectIds = new Map();
      const projects = read(PROJECTS_KEY, []);
      for (const p of payload?.projects ?? []) {
        const id = newId('p');
        projectIds.set(p.id, id);
        projects.push({ id, workspaceId: ws.id, name: p.name ?? 'Project', color: p.color });
      }
      write(PROJECTS_KEY, projects);

      const tagIds = new Map();
      const tags = read(TAGS_KEY, []);
      for (const t of payload?.tags ?? []) {
        const id = newId('t');
        tagIds.set(t.id, id);
        tags.push({ id, workspaceId: ws.id, name: t.name ?? 'tag' });
      }
      write(TAGS_KEY, tags);

      const entries = read(ENTRIES_KEY, []);
      for (const e of payload?.entries ?? []) {
        entries.push({
          id: newId(),
          workspaceId: ws.id,
          description: e.description ?? '',
          projectId: e.projectId != null ? (projectIds.get(e.projectId) ?? null) : null,
          tagIds: (e.tagIds ?? []).map((id) => tagIds.get(id)).filter(Boolean),
          start: e.start,
          end: e.end ?? null,
        });
      }
      write(ENTRIES_KEY, entries);

      return ws;
    },
  };
}
