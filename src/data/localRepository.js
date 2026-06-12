import { newId } from './repository.js';

/**
 * A {@link Repository} backed by localStorage. Async on purpose: the method
 * signatures match what a network-backed repository would look like, so the
 * store and UI never need to change when a backend arrives.
 */

const ENTRIES_KEY = 'swish.entries.v1';
const PROJECTS_KEY = 'swish.projects.v1';

const DEFAULT_PROJECTS = [
  { id: 'p_focus', name: 'Deep Work', color: '#6c5ce7' },
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
  if (read(PROJECTS_KEY, null) === null) {
    write(PROJECTS_KEY, DEFAULT_PROJECTS);
  }

  return {
    async listEntries({ from, to }) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      return all.filter((e) => e.start >= from && e.start < to);
    },

    async createEntry(data) {
      await tick();
      const all = read(ENTRIES_KEY, []);
      const entry = {
        id: newId(),
        description: data.description ?? '',
        projectId: data.projectId ?? null,
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

    async listProjects() {
      await tick();
      return read(PROJECTS_KEY, DEFAULT_PROJECTS);
    },

    async createProject(data) {
      await tick();
      const all = read(PROJECTS_KEY, []);
      const project = {
        id: newId('p'),
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
  };
}
