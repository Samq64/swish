import { startOfDay } from '../lib/time.js';

/**
 * Reactive application state, built on Svelte 5 runes. It is the only thing
 * the UI talks to for data, and it in turn only talks to a {@link Repository}.
 *
 * Construct once with a repository and share the instance (see store.js).
 */
export class AppStore {
  /** @type {import('./repository.js').TimeEntry[]} */
  entries = $state([]);
  /** @type {import('./repository.js').Project[]} */
  projects = $state([]);
  /** The day currently shown on the timeline. */
  selectedDay = $state(startOfDay(new Date()).toISOString());
  loading = $state(false);

  #repo;

  constructor(repository) {
    this.#repo = repository;
  }

  /** Map of projectId -> project, for quick lookups in the UI. */
  projectsById = $derived(
    new Map(this.projects.map((p) => [p.id, p])),
  );

  /** The currently running entry (open-ended), if any. */
  runningEntry = $derived(this.entries.find((e) => e.end === null) ?? null);

  async init() {
    this.projects = await this.#repo.listProjects();
    await this.loadDay(this.selectedDay);
  }

  async loadDay(dayISO) {
    this.selectedDay = startOfDay(dayISO).toISOString();
    this.loading = true;
    try {
      const from = this.selectedDay;
      const to = new Date(
        startOfDay(dayISO).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString();
      this.entries = await this.#repo.listEntries({ from, to });
    } finally {
      this.loading = false;
    }
  }

  shiftDay(deltaDays) {
    const next = new Date(this.selectedDay);
    next.setDate(next.getDate() + deltaDays);
    return this.loadDay(next.toISOString());
  }

  async create(data) {
    const entry = await this.#repo.createEntry(data);
    this.entries = [...this.entries, entry];
    return entry;
  }

  async update(id, patch) {
    // Optimistic: reflect the change immediately, reconcile with the result.
    this.entries = this.entries.map((e) =>
      e.id === id ? { ...e, ...patch } : e,
    );
    const saved = await this.#repo.updateEntry(id, patch);
    this.entries = this.entries.map((e) => (e.id === id ? saved : e));
    return saved;
  }

  async remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
    await this.#repo.deleteEntry(id);
  }

  /** Stop a running entry by stamping its end time. */
  stop(id, endISO = new Date().toISOString()) {
    return this.update(id, { end: endISO });
  }
}
