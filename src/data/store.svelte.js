import { startOfDay, startOfWeek, addDays, fromDateInput, toDateInput, DAY_MS } from '../lib/time.js';

// Past this many days a day-bucketed report chart has too many bars to read, so
// it switches to monthly buckets (matches the Year preset's granularity).
const REPORT_MONTH_BUCKET_THRESHOLD = 62;

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
  /**
   * Workspaces other users have shared with this user (read-only manager view).
   * Each is { id, name, ownerUsername }.
   */
  sharedWorkspaces = $state([]);
  /** The user's role on their single active team: 'manager' | 'member' | null. */
  teamRole = $state(null);
  /** Id of the workspace whose data is currently loaded. */
  currentWorkspaceId = $state(null);
  /** The signed-in user ({ username }), or null when logged out. */
  currentUser = $state(null);
  /** False until the initial session check resolves (avoids a login flash). */
  ready = $state(false);
  /** Colour theme preference: 'auto' (follow OS) | 'light' | 'dark'. */
  theme = $state('auto');
  /** Day the week starts on: 0 = Sunday, 1 = Monday. */
  weekStart = $state(0);
  /** Clock format: true = 12-hour (AM/PM), false = 24-hour. */
  hour12 = $state(true);
  /** 'week' | 'day' | 'list' | 'reports' */
  view = $state('week');
  /** Reference day the view is built around (ISO, start of day). */
  anchor = $state(startOfDay(new Date()).toISOString());
  /**
   * Reports view range. Lives here (not in ReportsView) because the preset
   * picker renders up in the page header while the charts render in the view
   * body — siblings that both need the same range. 'week' | 'month' | 'year' |
   * 'custom'; the custom bounds are inclusive local days (YYYY-MM-DD).
   */
  reportPreset = $state('week');
  reportFrom = $state(toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  reportTo = $state(toDateInput(new Date()));
  loading = $state(false);
  /** The from/to that the current `entries` array was loaded for. */
  loadedRangeStart = $state(null);
  loadedRangeEnd = $state(null);

  #repo;

  constructor(repository) {
    this.#repo = repository;
  }

  /** ISO start-of-day strings for every column currently visible. */
  visibleDays = $derived.by(() => {
    if (this.view === 'day') {
      return [startOfDay(this.anchor).toISOString()];
    }
    const start = startOfWeek(this.anchor, this.weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i).toISOString());
  });

  get rangeStart() {
    return this.visibleDays[0];
  }
  get rangeEnd() {
    const last = this.visibleDays[this.visibleDays.length - 1];
    return addDays(last, 1).toISOString();
  }

  /**
   * The window actually fetched from the repository. It always spans the
   * anchor's whole week — even in day view, which only *displays* one column —
   * so it never depends on `view`. That's deliberate: switching day↔week↔list
   * leaves the fetch window unchanged, so no reload is needed and the entries
   * (and the tracked-time total) never flash on a view switch.
   */
  get fetchStart() {
    return startOfWeek(this.anchor, this.weekStart).toISOString();
  }
  get fetchEnd() {
    return addDays(startOfWeek(this.anchor, this.weekStart), 7).toISOString();
  }

  /** Map of projectId -> project, for quick lookups in the UI. */
  projectsById = $derived(new Map(this.projects.map((p) => [p.id, p])));

  /** Map of tagId -> tag. */
  tagsById = $derived(new Map(this.tags.map((t) => [t.id, t])));

  /** The workspace whose data is loaded (owned or shared with this user). */
  currentWorkspace = $derived(
    this.workspaces.find((w) => w.id === this.currentWorkspaceId) ??
      this.sharedWorkspaces.find((w) => w.id === this.currentWorkspaceId) ??
      null,
  );

  /**
   * True when the loaded workspace is one shared with this user rather than one
   * they own: the manager view is read-only. The server enforces this too; the
   * flag lets the UI hide write affordances.
   */
  readOnly = $derived(
    this.currentWorkspaceId != null &&
      !this.workspaces.some((w) => w.id === this.currentWorkspaceId),
  );

  /** The currently running entry (open-ended), if any. */
  runningEntry = $derived(this.entries.find((e) => e.end === null) ?? null);

  /**
   * The concrete window the reports view covers, derived from `reportPreset`
   * (and the custom bounds): `{ from, to (exclusive), unit }` where `unit` is the
   * chart's bucket granularity ('day' | 'month'). Lives here so both the header
   * (range label + picker) and the ReportsView charts read one source of truth.
   */
  reportRange = $derived.by(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    switch (this.reportPreset) {
      case 'month':
        return { from: new Date(y, mo, 1), to: new Date(y, mo + 1, 1), unit: 'day' };
      case 'year':
        return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), unit: 'month' };
      case 'custom': {
        const from = fromDateInput(this.reportFrom);
        // The picked end day is inclusive, so the exclusive bound is the day after.
        // Guard an inverted range (to before from) by collapsing to a single day.
        const end = fromDateInput(this.reportTo);
        const to = addDays(end >= from ? end : from, 1);
        const span = Math.round((to - from) / DAY_MS);
        return { from, to, unit: span > REPORT_MONTH_BUCKET_THRESHOLD ? 'month' : 'day' };
      }
      case 'week':
      default: {
        const from = startOfWeek(now, this.weekStart);
        return { from, to: addDays(from, 7), unit: 'day' };
      }
    }
  });

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
  hydrate({
    username,
    theme,
    weekStart,
    hour12,
    workspaces,
    sharedWorkspaces = [],
    teamRole = null,
    activeWorkspaceId,
    projects,
    tags,
  }) {
    this.currentUser = { username };
    this.theme = theme ?? 'auto';
    this.weekStart = weekStart ?? 0;
    this.hour12 = hour12 ?? true;
    this.workspaces = AppStore.#sortByName(workspaces);
    this.sharedWorkspaces = sharedWorkspaces;
    this.teamRole = teamRole;
    this.currentWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? null;
    this.projects = AppStore.#sortByName(projects);
    this.tags = AppStore.#sortByName(tags);
    this.ready = true;
    // A read-only (shared) workspace has no editing affordances, so open on the
    // reports view — the one thing a manager actually wants to look at there.
    if (this.readOnly) this.view = 'reports';
    return this.loadRange();
  }

  /** Set the colour theme (persisted per-user; reverts on failure). */
  async setTheme(theme) {
    const prev = this.theme;
    this.theme = theme;
    try {
      await this.#repo.setPreferences({ theme });
    } catch (e) {
      this.theme = prev;
      throw e;
    }
  }

  /** Set the first day of the week; reloads the visible range it shifts. */
  async setWeekStart(weekStart) {
    if (weekStart === this.weekStart) return;
    const prev = this.weekStart;
    this.weekStart = weekStart;
    try {
      await this.#repo.setPreferences({ weekStart });
      await this.loadRange();
    } catch (e) {
      this.weekStart = prev;
      throw e;
    }
  }

  /** Choose 12- or 24-hour clock labels (persisted per-user; reverts on failure). */
  async setHour12(hour12) {
    if (hour12 === this.hour12) return;
    const prev = this.hour12;
    this.hour12 = hour12;
    try {
      await this.#repo.setPreferences({ hour12 });
    } catch (e) {
      this.hour12 = prev;
      throw e;
    }
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
    // The entries belong to the previous workspace; force a refetch (the range
    // guard in loadRange would otherwise skip an unchanged week).
    this.loadedRangeStart = null;
    this.loadedRangeEnd = null;
    await this.loadRange();
  }

  async loadRange() {
    const from = this.fetchStart;
    const to = this.fetchEnd;
    // Already have this exact week loaded — nothing to fetch. This is what makes
    // a view switch (day↔week↔list) free: the fetch window doesn't change, so we
    // return immediately and the total/entries never flash.
    if (from === this.loadedRangeStart && to === this.loadedRangeEnd) return;
    this.loading = true;
    try {
      this.entries = await this.#repo.listEntries({
        from,
        to,
        workspaceId: this.currentWorkspaceId,
      });
      this.loadedRangeStart = from;
      this.loadedRangeEnd = to;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Fetch entries for an arbitrary range from the current workspace *without*
   * touching the timeline's loaded `entries`. The reports view picks its own
   * range (a month, a year) independent of the day/week the timeline shows, so
   * it can't reuse `loadRange`/`entries`. Read-only: it returns the rows for the
   * caller to aggregate, leaving the store's own state alone.
   * @param {{ from: string, to: string }} range ISO bounds (from inclusive, to exclusive).
   */
  queryEntries({ from, to }) {
    return this.#repo.listEntries({
      from,
      to,
      workspaceId: this.currentWorkspaceId,
    });
  }

  async switchWorkspace(id) {
    if (id === this.currentWorkspaceId) return;
    this.currentWorkspaceId = id;
    await this.#repo.setActiveWorkspaceId(id);
    await this.loadWorkspaceData();
    // Landing on a shared (read-only) workspace: default to reports (see hydrate).
    if (this.readOnly) this.view = 'reports';
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

  /** Guard against mutating a read-only (shared) workspace. */
  #assertWritable() {
    if (this.readOnly) throw new Error('This workspace is read-only');
  }

  // --- teams & sharing -------------------------------------------------------
  // Mostly thin pass-throughs to the repository. The Team modal holds the team
  // roster locally and reloads via listTeams() after every mutation, so that
  // call is the single point where we refresh the globally-needed bits:
  // `teamRole` (gates the share toggle) and the manager's shared-with-me list.

  get hasTeam() {
    return this.teamRole != null;
  }

  async listTeams() {
    const data = await this.#repo.listTeams();
    const active = data.teams[0] ?? null;
    this.teamRole = active ? active.role : null;
    this.sharedWorkspaces =
      this.teamRole === 'manager' ? await this.#repo.listSharedWorkspaces() : [];
    return data;
  }
  createTeam(name) {
    return this.#repo.createTeam(name);
  }
  inviteToTeam(teamId, username) {
    return this.#repo.inviteToTeam(teamId, username);
  }
  acceptInvite(teamId) {
    return this.#repo.acceptInvite(teamId);
  }
  leaveTeam(teamId) {
    return this.#repo.leaveTeam(teamId);
  }
  removeTeamMember(teamId, userId) {
    return this.#repo.removeTeamMember(teamId, userId);
  }
  deleteTeam(teamId) {
    return this.#repo.deleteTeam(teamId);
  }
  /** Toggle whether an owned workspace is shared with the team (optimistic). */
  setWorkspaceShared(workspaceId, shared) {
    return this.#patch('workspaces', workspaceId, { shared }, (i) =>
      this.#repo.setWorkspaceShared(i, shared),
    );
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
    // Pure display change: every view reads from the same already-loaded week,
    // so there's no fetch (and thus no flash) when toggling day/week/list.
    this.view = view;
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
    const to = from + DAY_MS;
    return this.entries.filter((e) => {
      const t = new Date(e.start).getTime();
      return t >= from && t < to;
    });
  }

  async create(data) {
    this.#assertWritable();
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
    this.#assertWritable();
    return this.#patch('entries', id, patch, (i, p) =>
      this.#repo.updateEntry(i, p),
    );
  }

  async remove(id) {
    this.#assertWritable();
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
    this.#assertWritable();
    const project = await this.#repo.createProject({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.projects = AppStore.#sortByName([...this.projects, project]);
    return project;
  }

  async updateProject(id, patch) {
    this.#assertWritable();
    const saved = await this.#patch('projects', id, patch, (i, p) =>
      this.#repo.updateProject(i, p),
    );
    if ('name' in patch) this.projects = AppStore.#sortByName(this.projects);
    return saved;
  }

  async removeProject(id) {
    this.#assertWritable();
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
    this.#assertWritable();
    const tag = await this.#repo.createTag({
      ...data,
      workspaceId: this.currentWorkspaceId,
    });
    this.tags = AppStore.#sortByName([...this.tags, tag]);
    return tag;
  }

  async updateTag(id, patch) {
    this.#assertWritable();
    const saved = await this.#patch('tags', id, patch, (i, p) =>
      this.#repo.updateTag(i, p),
    );
    if ('name' in patch) this.tags = AppStore.#sortByName(this.tags);
    return saved;
  }

  async removeTag(id) {
    this.#assertWritable();
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
