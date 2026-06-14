/**
 * Data contract for the app. Everything above this line (store, components)
 * depends only on these async method shapes — never on *how* data is stored.
 * The live implementation is {@link module:apiRepository}, backed by the
 * Cloudflare Pages Functions API; the store talks only to this contract.
 *
 * Entries, projects and tags all belong to a workspace; everything is scoped to
 * the authenticated user server-side. The id of each record is assigned by the
 * server on create.
 *
 * @typedef {Object} Workspace
 * @property {string} id
 * @property {string} name
 *
 * @typedef {Object} TimeEntry
 * @property {string}  id
 * @property {string}  workspaceId
 * @property {string}  description
 * @property {string|null} projectId
 * @property {string[]} tagIds  Ids of tags within the workspace
 * @property {string}  start  ISO 8601 timestamp
 * @property {string|null} end ISO 8601 timestamp, or null while running
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {string} color  CSS color
 *
 * @typedef {Object} Tag
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 *
 * @typedef {Object} Identity
 * @property {string} username
 * @property {string|null} activeWorkspaceId
 * @property {'auto'|'light'|'dark'} theme
 * @property {0|1} weekStart  0 = Sunday, 1 = Monday
 *
 * @typedef {Object} Repository
 * // auth
 * @property {(username: string, password: string) => Promise<Identity>} register
 * @property {(username: string, password: string) => Promise<Identity>} login
 * @property {() => Promise<void>} logout
 * @property {() => Promise<Identity>} me  Rejects with status 401 when no session
 * // entries — listEntries returns every entry whose start is in [from, to),
 * // PLUS the open running entry (end === null) regardless of range, so the
 * // timer is consistent across devices and views.
 * @property {(range: {from: string, to: string, workspaceId: string}) => Promise<TimeEntry[]>} listEntries
 * @property {(data: Partial<TimeEntry>) => Promise<TimeEntry>} createEntry
 * @property {(id: string, patch: Partial<TimeEntry>) => Promise<TimeEntry>} updateEntry
 * @property {(id: string) => Promise<void>} deleteEntry
 * @property {(workspaceId: string) => Promise<Project[]>} listProjects
 * @property {(data: Partial<Project>) => Promise<Project>} createProject
 * @property {(id: string, patch: Partial<Project>) => Promise<Project>} updateProject
 * @property {(id: string) => Promise<void>} deleteProject
 * @property {(workspaceId: string) => Promise<Tag[]>} listTags
 * @property {(data: Partial<Tag>) => Promise<Tag>} createTag
 * @property {(id: string, patch: Partial<Tag>) => Promise<Tag>} updateTag
 * @property {(id: string) => Promise<void>} deleteTag
 * @property {() => Promise<Workspace[]>} listWorkspaces
 * @property {(data: Partial<Workspace>) => Promise<Workspace>} createWorkspace
 * @property {(id: string, patch: Partial<Workspace>) => Promise<Workspace>} updateWorkspace
 * @property {(id: string) => Promise<void>} deleteWorkspace
 * @property {(id: string) => Promise<void>} setActiveWorkspaceId
 * @property {(prefs: {theme?: 'auto'|'light'|'dark', weekStart?: 0|1}) => Promise<void>} setPreferences
 * @property {(workspaceId: string) => Promise<WorkspaceExport>} exportWorkspace
 * @property {(payload: WorkspaceExport) => Promise<Workspace>} importWorkspace
 *
 * @typedef {Object} WorkspaceExport
 * @property {'swish.workspace'} type
 * @property {number} version
 * @property {string} name
 * @property {Project[]} projects
 * @property {Tag[]} tags
 * @property {TimeEntry[]} entries
 */

export {};
