import { startOfDay, startOfWeek, addDays } from '../lib/time.js';

export const WEEK_STARTS_ON = 1; // Monday

/**
 * Reactive application state, built on Svelte 5 runes. It is the only thing
 * the UI talks to for data, and it in turn only talks to a {@link Repository}.
 *
 * The timeline shows a *range* of days (1 in day view, 7 in week view). The
 * store loads every entry in that range; each day column filters down to its
 * own day.
 */
export class AppStore {
  /** @type {import('./repository.js').TimeEntry[]} */
  entries = $state([]);
  /** @type {import('./repository.js').Project[]} */
  projects = $state([]);
  /** 'week' | 'day' */
  view = $state('week');
  /** Reference day the view is built around (ISO, start of day). */
  anchor = $state(startOfDay(new Date()).toISOString());
  loading = $state(false);

  #repo;

  constructor(repository) {
    this.#repo = repository;
  }

  /** ISO start-of-day strings for every column currently visible. */
  visibleDays = $derived.by(() => {
    if (this.view === 'day') {
      return [startOfDay(this.anchor).toISOString()];
    }
    const start = startOfWeek(this.anchor, WEEK_STARTS_ON);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i).toISOString());
  });

  get rangeStart() {
    return this.visibleDays[0];
  }
  get rangeEnd() {
    const last = this.visibleDays[this.visibleDays.length - 1];
    return addDays(last, 1).toISOString();
  }

  /** Map of projectId -> project, for quick lookups in the UI. */
  projectsById = $derived(new Map(this.projects.map((p) => [p.id, p])));

  /** The currently running entry (open-ended), if any. */
  runningEntry = $derived(this.entries.find((e) => e.end === null) ?? null);

  async init() {
    this.projects = await this.#repo.listProjects();
    await this.loadRange();
  }

  async loadRange() {
    this.loading = true;
    try {
      this.entries = await this.#repo.listEntries({
        from: this.rangeStart,
        to: this.rangeEnd,
      });
    } finally {
      this.loading = false;
    }
  }

  setView(view) {
    if (view === this.view) return;
    this.view = view;
    return this.loadRange();
  }

  /** Step forward/back by one view-unit (a day or a week). */
  shift(delta) {
    const step = this.view === 'week' ? 7 : 1;
    this.anchor = addDays(this.anchor, delta * step).toISOString();
    return this.loadRange();
  }

  goToday() {
    this.anchor = startOfDay(new Date()).toISOString();
    return this.loadRange();
  }

  /** Entries belonging to a single day (start within that day). */
  entriesForDay(dayISO) {
    const from = startOfDay(dayISO).getTime();
    const to = from + 24 * 60 * 60 * 1000;
    return this.entries.filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= from && t < to;
    });
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

  // --- projects --------------------------------------------------------------

  async addProject(data = {}) {
    const project = await this.#repo.createProject(data);
    this.projects = [...this.projects, project];
    return project;
  }

  async updateProject(id, patch) {
    this.projects = this.projects.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    );
    const saved = await this.#repo.updateProject(id, patch);
    this.projects = this.projects.map((p) => (p.id === id ? saved : p));
    return saved;
  }

  async removeProject(id) {
    this.projects = this.projects.filter((p) => p.id !== id);
    // Detach the project from any entries that referenced it.
    this.entries = this.entries.map((e) =>
      e.projectId === id ? { ...e, projectId: null } : e,
    );
    await this.#repo.deleteProject(id);
  }
}
