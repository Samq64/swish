import {
  listWorkspaces,
  listProjects,
  listTags,
  listSharedWorkspaces,
  getActiveTeamRole,
} from '$lib/server/data.js';

// The app is a client-rendered SPA (the timeline is interactive and its visible
// range depends on the user's local timezone, which the server doesn't know).
// So we don't server-render — but this server `load` still runs on the server
// and ships the timezone-independent bootstrap (workspaces + the active
// workspace's projects/tags) in one round-trip, collapsing what used to be a
// client-side request waterfall. Entries are fetched client-side for the local
// range once the store hydrates.
export const ssr = false;

export async function load({ locals, platform }) {
  // hooks.server.js has already gated this route, so locals.user is present,
  // and the Cloudflare adapter always provides `platform`.
  const user = /** @type {NonNullable<App.Locals['user']>} */ (locals.user);
  const env = /** @type {App.Platform} */ (platform).env;

  const [workspaces, sharedWorkspaces, teamRole] = await Promise.all([
    listWorkspaces(env, user.id),
    listSharedWorkspaces(env, user.id),
    getActiveTeamRole(env, user.id),
  ]);

  // The active workspace may be an owned one or a workspace shared with the
  // user (a manager's view); fall back to the first owned workspace.
  const accessibleIds = new Set([...workspaces, ...sharedWorkspaces].map((w) => w.id));
  const activeWorkspaceId = accessibleIds.has(user.activeWorkspaceId)
    ? user.activeWorkspaceId
    : (workspaces[0]?.id ?? null);

  // projects/tags are id-scoped; access to activeWorkspaceId was validated when
  // it was set (see PUT /settings/active-workspace), so this is safe for shared
  // workspaces too.
  const [projects, tags] = activeWorkspaceId
    ? await Promise.all([listProjects(env, activeWorkspaceId), listTags(env, activeWorkspaceId)])
    : [[], []];

  return {
    username: user.username,
    theme: user.theme,
    weekStart: user.weekStart,
    hour12: user.hour12,
    workspaces,
    sharedWorkspaces,
    teamRole,
    activeWorkspaceId,
    projects,
    tags,
  };
}
