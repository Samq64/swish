import { startOfDay, startOfWeek, addDays } from '../lib/time.js';

export const WEEK_STARTS_ON = 0; // Sunday

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
  /** The signed-in user ({ username }), or null when logged out. */
  currentUser = $state(null);
  /** False until the initial session check resolves (avoids a login flash). */
  ready = $state(false);
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

  static #sortByName(arr) {
    return [...arr].sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- auth & bootstrap ------------------------------------------------------

  /**
   * Seed the store from the server `load` (see routes/+page.server.js): user,
   * workspaces and the active workspace's projects/tags arrive with the page,
   * so there's no client-side bootstrap waterfall. Entries depend on the local
   * date range, which the server can't know, so they're fetched here.
   */
  hydrate({ username, workspaces, activeWorkspaceId, projects, tags }) {
    this.currentUser = { username };
    this.workspaces = AppStore.#sortByName(workspaces);
    this.currentWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? null;
    this.projects = AppStore.#sortByName(projects);
    this.tags = AppStore.#sortByName(tags);
    this.ready = true;
    return this.loadRange();
  }

  /** Sign out of this device (server clears the session and redirects). */
  logout() {
    // POST via a form submit so the navigation carries our Origin — /logout is
    // POST-only to keep sign-out off cross-site GETs.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/logout';
    document.body.append(form);
    form.submit();
  }

  /** Sign out every other session, keeping this one active. */
  logoutOtherSessions() {
    return this.#repo.logoutOthers();
  }

  /** Change the password; other sessions are revoked server-side. */
  changePassword(currentPassword, newPassword) {
    return this.#repo.changePassword(currentPassword, newPassword);
  }

  /** Permanently delete the account and all its data, then return to login. */
  async deleteAccount(password) {
    await this.#repo.deleteAccount(password);
    window.location.assign('/login');
  }

  /** Load every dataset (projects, tags, entries) for the current workspace. */
  async loadWorkspaceData() {
    const [projects, tags] = await Promise.all([
      this.#repo.listProjects(this.currentWorkspaceId),
      this.#repo.listTags(this.currentWorkspaceId),
    ]);
    this.projects = AppStore.#sortByName(projects);
    this.tags = AppStore.#sortByName(tags);
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
    this.workspaces = AppStore.#sortByName([...this.workspaces, ws]);
    await this.switchWorkspace(ws.id);
    return ws;
  }

  async renameWorkspace(id, name) {
    const saved = await this.#patch('workspaces', id, { name }, (i, p) =>
      this.#repo.updateWorkspace(i, p),
    );
    this.workspaces = AppStore.#sortByName(this.workspaces);
    return saved;
  }

  /** Delete a workspace and its data; refuses to remove the last one. */
  async deleteWorkspace(id) {
    if (this.workspaces.length <= 1) return;
    await this.#repo.deleteWorkspace(id);
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    if (this.currentWorkspaceId === id) {
      await this.switchWorkspace(this.workspaces[0].id);
    }
  }

  /** Serializable snapshot of a workspace (defaults to the current one). */
  exportWorkspace(id = this.currentWorkspaceId) {
    return this.#repo.exportWorkspace(id);
  }

  /** Create a new workspace from an export payload and switch to it. */
  async importWorkspace(payload) {
    const ws = await this.#repo.importWorkspace(payload);
    this.workspaces = await this.#repo.listWorkspaces();
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

  /** Jump the view to the range containing `date` (a Date or ISO string). */
  goToDate(date) {
    this.anchor = startOfDay(date).toISOString();
    return this.loadRange();
  }

  goToday() {
    return this.goToDate(new Date());
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
   * `projects` | `tags`): apply the change immediately, reconcile with the
   * value the repository returns, and revert to the prior state if it fails
   * (so a dropped request never leaves the UI lying about server state).
   */
  async #patch(field, id, patch, repoFn) {
    const prev = this[field];
    this[field] = prev.map((x) => (x.id === id ? { ...x, ...patch } : x));
    try {
      const saved = await repoFn(id, patch);
      this[field] = this[field].map((x) => (x.id === id ? saved : x));
      return saved;
    } catch (e) {
      this[field] = prev;
      throw e;
    }
  }

  update(id, patch) {
    return this.#patch('entries', id, patch, (i, p) =>
      this.#repo.updateEntry(i, p),
    );
  }

  async remove(id) {
    const prev = this.entries;
    this.entries = prev.filter((e) => e.id !== id);
    try {
      await this.#repo.deleteEntry(id);
    } catch (e) {
      this.entries = prev;
      throw e;
    }
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
    this.projects = AppStore.#sortByName([...this.projects, project]);
    return project;
  }

  async updateProject(id, patch) {
    const saved = await this.#patch('projects', id, patch, (i, p) =>
      this.#repo.updateProject(i, p),
    );
    if ('name' in patch) this.projects = AppStore.#sortByName(this.projects);
    return saved;
  }

  async removeProject(id) {
    const prevProjects = this.projects;
    const prevEntries = this.entries;
    this.projects = prevProjects.filter((p) => p.id !== id);
    // Detach the project from any entries that referenced it.
    this.entries = prevEntries.map((e) =>
      e.projectId === id ? { ...e, projectId: null } : e,
    );
    try {
      await this.#repo.deleteProject(id);
    } catch (e) {
      this.projects = prevProjects;
      this.entries = prevEntries;
      throw e;
    }
  }

  // --- tags (global, shared across all projects) -----------------------------

  async addTag(data = {}) {
    const tag = await this.#repo.createTag({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.tags = AppStore.#sortByName([...this.tags, tag]);
    return tag;
  }

  async updateTag(id, patch) {
    const saved = await this.#patch('tags', id, patch, (i, p) =>
      this.#repo.updateTag(i, p),
    );
    if ('name' in patch) this.tags = AppStore.#sortByName(this.tags);
    return saved;
  }

  async removeTag(id) {
    const prevTags = this.tags;
    const prevEntries = this.entries;
    this.tags = prevTags.filter((t) => t.id !== id);
    // Detach the tag from any loaded entries that referenced it.
    this.entries = prevEntries.map((e) =>
      e.tagIds?.includes(id)
        ? { ...e, tagIds: e.tagIds.filter((t) => t !== id) }
        : e,
    );
    try {
      await this.#repo.deleteTag(id);
    } catch (e) {
      this.tags = prevTags;
      this.entries = prevEntries;
      throw e;
    }
  }
}
