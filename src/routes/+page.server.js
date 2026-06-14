import { listWorkspaces, listProjects, listTags } from '$lib/server/data.js';

// The app is a client-rendered SPA (the timeline is interactive and its visible
// range depends on the user's local timezone, which the server doesn't know).
// So we don't server-render — but this server `load` still runs on the server
// and ships the timezone-independent bootstrap (workspaces + the active
// workspace's projects/tags) in one round-trip, collapsing what used to be a
// client-side request waterfall. Entries are fetched client-side for the local
// range once the store hydrates.
export const ssr = false;

export async function load({ locals, platform }) {
  // hooks.server.js has already gated this route, so locals.user is present.
  const { user } = locals;
  const env = platform.env;

  const workspaces = await listWorkspaces(env, user.id);
  const activeWorkspaceId =
    workspaces.find((w) => w.id === user.activeWorkspaceId)?.id ?? workspaces[0]?.id ?? null;

  const [projects, tags] = activeWorkspaceId
    ? await Promise.all([listProjects(env, activeWorkspaceId), listTags(env, activeWorkspaceId)])
    : [[], []];

  return { username: user.username, workspaces, activeWorkspaceId, projects, tags };
}
