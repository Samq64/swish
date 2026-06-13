/**
 * Data contract for the app. Everything above this line (store, components)
 * depends only on these async method shapes — never on *how* data is stored.
 *
 * Swapping to a real backend later means writing an `apiRepository` with the
 * same methods (using `fetch`) and passing it to `createStore`. Nothing in the
 * UI changes.
 *
 * Entries, projects and tags all belong to a workspace; the repository scopes
 * reads/writes by `workspaceId` so switching workspace swaps the whole dataset.
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
 * @typedef {Object} Repository
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
 * @property {() => Promise<string>} getActiveWorkspaceId
 * @property {(id: string) => Promise<void>} setActiveWorkspaceId
 * @property {(workspaceId: string) => Promise<WorkspaceExport>} exportWorkspace
 * @property {(payload: WorkspaceExport) => Promise<Workspace>} importWorkspace
 *
 * @typedef {Object} WorkspaceExport
 * @property {'swish.workspace'} type
 * @property {number} version
 * @property {{name: string}} workspace
 * @property {Project[]} projects
 * @property {Tag[]} tags
 * @property {TimeEntry[]} entries
 */

/** Generate a client-side id. A backend would assign its own on create. */
export function newId(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
