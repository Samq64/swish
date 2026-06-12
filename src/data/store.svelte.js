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
  /** @type {import('./repository.js').Tag[]} */
  tags = $state([]);
  /** @type {import('./repository.js').Workspace[]} */
  workspaces = $state([]);
  /** Id of the workspace whose data is currently loaded. */
  currentWorkspaceId = $state(null);
  /** 'week' | 'day' | 'list' */
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

  /** Map of tagId -> tag. */
  tagsById = $derived(new Map(this.tags.map((t) => [t.id, t])));

  /** The workspace whose data is loaded. */
  currentWorkspace = $derived(
    this.workspaces.find((w) => w.id === this.currentWorkspaceId) ?? null,
  );

  /** The currently running entry (open-ended), if any. */
  runningEntry = $derived(this.entries.find((e) => e.end === null) ?? null);

  async init() {
    this.workspaces = await this.#repo.listWorkspaces();
    const active = await this.#repo.getActiveWorkspaceId();
    this.currentWorkspaceId =
      this.workspaces.find((w) => w.id === active)?.id ??
      this.workspaces[0]?.id ??
      null;
    await this.loadWorkspaceData();
  }

  /** Load every dataset (projects, tags, entries) for the current workspace. */
  async loadWorkspaceData() {
    [this.projects, this.tags] = await Promise.all([
      this.#repo.listProjects(this.currentWorkspaceId),
      this.#repo.listTags(this.currentWorkspaceId),
    ]);
    await this.loadRange();
  }

  async loadRange() {
    this.loading = true;
    try {
      this.entries = await this.#repo.listEntries({
        from: this.rangeStart,
        to: this.rangeEnd,
        workspaceId: this.currentWorkspaceId,
      });
    } finally {
      this.loading = false;
    }
  }

  async switchWorkspace(id) {
    if (id === this.currentWorkspaceId) return;
    this.currentWorkspaceId = id;
    await this.#repo.setActiveWorkspaceId(id);
    await this.loadWorkspaceData();
  }

  async addWorkspace(name) {
    const ws = await this.#repo.createWorkspace({ name });
    this.workspaces = [...this.workspaces, ws];
    await this.switchWorkspace(ws.id);
    return ws;
  }

  setView(view) {
    if (view === this.view) return;
    this.view = view;
    return this.loadRange();
  }

  /** Step forward/back by one view-unit (a day, or a week for week/list). */
  shift(delta) {
    const step = this.view === 'day' ? 1 : 7;
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
    const entry = await this.#repo.createEntry({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.entries = [...this.entries, entry];
    return entry;
  }

  /**
   * Optimistically patch the item with `id` in a state array (`entries` |
   * `projects` | `tags`): apply the change immediately, then reconcile with the
   * value the repository returns.
   */
  async #patch(field, id, patch, repoFn) {
    this[field] = this[field].map((x) => (x.id === id ? { ...x, ...patch } : x));
    const saved = await repoFn(id, patch);
    this[field] = this[field].map((x) => (x.id === id ? saved : x));
    return saved;
  }

  update(id, patch) {
    return this.#patch('entries', id, patch, (i, p) =>
      this.#repo.updateEntry(i, p),
    );
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
    const project = await this.#repo.createProject({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.projects = [...this.projects, project];
    return project;
  }

  updateProject(id, patch) {
    return this.#patch('projects', id, patch, (i, p) =>
      this.#repo.updateProject(i, p),
    );
  }

  async removeProject(id) {
    this.projects = this.projects.filter((p) => p.id !== id);
    // Detach the project from any entries that referenced it.
    this.entries = this.entries.map((e) =>
      e.projectId === id ? { ...e, projectId: null } : e,
    );
    await this.#repo.deleteProject(id);
  }

  // --- tags (global, shared across all projects) -----------------------------

  async addTag(data = {}) {
    const tag = await this.#repo.createTag({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.tags = [...this.tags, tag];
    return tag;
  }

  updateTag(id, patch) {
    return this.#patch('tags', id, patch, (i, p) => this.#repo.updateTag(i, p));
  }

  async removeTag(id) {
    this.tags = this.tags.filter((t) => t.id !== id);
    // Detach the tag from any loaded entries that referenced it.
    this.entries = this.entries.map((e) =>
      e.tagIds?.includes(id)
        ? { ...e, tagIds: e.tagIds.filter((t) => t !== id) }
        : e,
    );
    await this.#repo.deleteTag(id);
  }
}
