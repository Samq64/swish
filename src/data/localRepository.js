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

const DEFAULT_WORKSPACE = { id: 'w_default', name: 'My Workspace' };

const DEFAULT_PROJECTS = [
  { id: 'p_focus', workspaceId: DEFAULT_WORKSPACE.id, name: 'Deep Work', color: '#6c5ce7' },
];

const DEFAULT_TAGS = [
  { id: 't_billable', workspaceId: DEFAULT_WORKSPACE.id, name: 'billable' },
  { id: 't_meeting', workspaceId: DEFAULT_WORKSPACE.id, name: 'meeting' },
];

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

export function createLocalRepository() {
  if (read(WORKSPACES_KEY, null) === null) {
    write(WORKSPACES_KEY, [DEFAULT_WORKSPACE]);
  }
  if (read(PROJECTS_KEY, null) === null) {
    write(PROJECTS_KEY, DEFAULT_PROJECTS);
  }
  if (read(TAGS_KEY, null) === null) {
    write(TAGS_KEY, DEFAULT_TAGS);
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
      return read(PROJECTS_KEY, DEFAULT_PROJECTS).filter(
        (p) => p.workspaceId === workspaceId,
      );
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
      return read(TAGS_KEY, DEFAULT_TAGS).filter(
        (t) => t.workspaceId === workspaceId,
      );
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
  };
}
