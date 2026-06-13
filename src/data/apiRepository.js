/**
 * A {@link Repository} backed by the Cloudflare Pages Functions API at /api/*,
 * plus the auth methods the app needs (register/login/logout/me). Same-origin,
 * so the session cookie rides along automatically with `credentials: 'include'`.
 *
 * Every method throws {@link ApiError} on a non-2xx response; a 401 is surfaced
 * with `status === 401` so the store can drop back to the login screen.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body ?? {});
const patch = (path, body) => request('PATCH', path, body ?? {});
const put = (path, body) => request('PUT', path, body ?? {});
const del = (path) => request('DELETE', path);

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export function createApiRepository() {
  return {
    // --- auth ---
    register: (username, password) => post('/auth/register', { username, password }),
    login: (username, password) => post('/auth/login', { username, password }),
    logout: () => post('/auth/logout'),
    logoutOthers: () => post('/auth/logout-others'),
    me: () => get('/auth/me'),
    changePassword: (currentPassword, newPassword) =>
      post('/auth/password', { currentPassword, newPassword }),
    deleteAccount: (password) => request('DELETE', '/auth/account', { password }),

    // --- entries ---
    listEntries: ({ from, to, workspaceId }) =>
      get(`/entries${qs({ workspaceId, from, to })}`),
    createEntry: (data) => post('/entries', data),
    updateEntry: (id, patchData) => patch(`/entries/${id}`, patchData),
    deleteEntry: (id) => del(`/entries/${id}`),

    // --- projects ---
    listProjects: (workspaceId) => get(`/projects${qs({ workspaceId })}`),
    createProject: (data) => post('/projects', data),
    updateProject: (id, patchData) => patch(`/projects/${id}`, patchData),
    deleteProject: (id) => del(`/projects/${id}`),

    // --- tags ---
    listTags: (workspaceId) => get(`/tags${qs({ workspaceId })}`),
    createTag: (data) => post('/tags', data),
    updateTag: (id, patchData) => patch(`/tags/${id}`, patchData),
    deleteTag: (id) => del(`/tags/${id}`),

    // --- workspaces ---
    listWorkspaces: () => get('/workspaces'),
    createWorkspace: (data) => post('/workspaces', data),
    updateWorkspace: (id, patchData) => patch(`/workspaces/${id}`, patchData),
    deleteWorkspace: (id) => del(`/workspaces/${id}`),

    // --- settings ---
    setActiveWorkspaceId: (id) => put('/settings/active-workspace', { workspaceId: id }),

    // --- export / import ---
    exportWorkspace: (workspaceId) => get(`/workspaces/${workspaceId}/export`),
    importWorkspace: (payload) => post('/workspaces/import', payload),
  };
}
