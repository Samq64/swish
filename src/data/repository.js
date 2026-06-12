/**
 * Data contract for the app. Everything above this line (store, components)
 * depends only on these async method shapes — never on *how* data is stored.
 *
 * Swapping to a real backend later means writing an `apiRepository` with the
 * same methods (using `fetch`) and passing it to `createStore`. Nothing in the
 * UI changes.
 *
 * @typedef {Object} TimeEntry
 * @property {string}  id
 * @property {string}  description
 * @property {string|null} projectId
 * @property {string}  start  ISO 8601 timestamp
 * @property {string|null} end ISO 8601 timestamp, or null while running
 *
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} color  CSS color
 *
 * @typedef {Object} Repository
 * @property {(range: {from: string, to: string}) => Promise<TimeEntry[]>} listEntries
 * @property {(data: Partial<TimeEntry>) => Promise<TimeEntry>} createEntry
 * @property {(id: string, patch: Partial<TimeEntry>) => Promise<TimeEntry>} updateEntry
 * @property {(id: string) => Promise<void>} deleteEntry
 * @property {() => Promise<Project[]>} listProjects
 * @property {(data: Partial<Project>) => Promise<Project>} createProject
 * @property {(id: string, patch: Partial<Project>) => Promise<Project>} updateProject
 * @property {(id: string) => Promise<void>} deleteProject
 */

/** Generate a client-side id. A backend would assign its own on create. */
export function newId(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
