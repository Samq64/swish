/**
 * End-to-end tests for the SvelteKit backend, run against a real local
 * `wrangler pages dev` server (the adapter-cloudflare build) backed by an
 * isolated local D1 database.
 *
 *   npm test
 *
 * Covers the auth routes (/login, /register, /logout), the hook that gates the
 * app shell, and the JSON API.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE = '.wrangler/test-state';
const TODAY = '2026-06-13T00:00:00.000Z';
const TOMORROW = '2026-06-14T00:00:00.000Z';
const ORIGIN = BASE;

let server;

function sessionCookie(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = /^swish_session=([^;]*)/.exec(c);
    if (m) return m[1] ? `swish_session=${m[1]}` : null; // empty value = cleared
  }
  return null;
}

// JSON API helper.
async function api(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin && method !== 'GET') headers.origin = origin;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json, cookie: sessionCookie(res) };
}

// Form POST to an auth route; captures the redirect + Set-Cookie. `Accept:
// text/html` mimics a browser form navigation, so SvelteKit replies with a real
// redirect rather than its JSON action envelope (which it serves to fetch/JSON
// clients via content negotiation).
async function form(path, fields, { cookie, origin = ORIGIN } = {}) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'text/html',
    origin,
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: new URLSearchParams(fields).toString(),
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cookie: sessionCookie(res),
  };
}

async function registerUser(username, password) {
  const r = await form('/register', { username, password });
  assert.equal(r.status, 303, `register ${username} should redirect`);
  assert.ok(r.cookie, `register ${username} should set a session cookie`);
  return r.cookie;
}

before(async () => {
  rmSync(STATE, { recursive: true, force: true });
  // Build the Pages output the dev server will serve.
  execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'migrations', 'apply', 'swish', '--local', '--persist-to', STATE],
    { stdio: 'ignore' },
  );
  server = spawn(
    'npx',
    [
      'wrangler',
      'pages',
      'dev',
      '.svelte-kit/cloudflare',
      '--port',
      String(PORT),
      '--persist-to',
      STATE,
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status === 401) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('wrangler pages dev did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
});

after(() => {
  server?.kill('SIGTERM');
});

let alice = null;
let workspace = null;

test('GET /login renders a sign-in form', async () => {
  const res = await fetch(`${BASE}/login`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<form/);
  assert.match(body, /name="username"/);
});

test('an unauthenticated document request is redirected to /login', async () => {
  const res = await fetch(`${BASE}/`, {
    headers: { 'Sec-Fetch-Dest': 'document' },
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login$/);
});

test('register creates an account, session and default workspace', async () => {
  alice = await registerUser('alice', 'hunter2pw');
  const me = await api('GET', '/api/auth/me', { cookie: alice });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, 'alice');
  workspace = me.json.activeWorkspaceId;
  assert.ok(workspace);

  const ws = await api('GET', '/api/workspaces', { cookie: alice });
  assert.deepEqual(
    ws.json.map((w) => w.name),
    ['Personal'],
  );
});

test('an authenticated document request is allowed through the gate', async () => {
  const res = await fetch(`${BASE}/`, {
    headers: { 'Sec-Fetch-Dest': 'document', cookie: alice },
    redirect: 'manual',
  });
  // Not redirected to /login (the static shell is absent in this test server,
  // so a 404 is fine — the point is the gate let it pass).
  assert.notEqual(res.status, 302);
});

test('duplicate username is rejected', async () => {
  const r = await form('/register', { username: 'alice', password: 'hunter2pw' });
  assert.equal(r.status, 409);
  assert.equal(r.cookie, null);
});

test('mutations from a foreign origin are blocked (CSRF)', async () => {
  const r = await api('POST', '/api/projects', {
    cookie: alice,
    origin: 'https://evil.example',
    body: { workspaceId: workspace, name: 'x' },
  });
  assert.equal(r.status, 403);
});

test('a running entry is returned even outside the queried range', async () => {
  const p = await api('POST', '/api/projects', {
    cookie: alice,
    body: { workspaceId: workspace, name: 'Client', color: '#0984e3' },
  });
  const t = await api('POST', '/api/tags', {
    cookie: alice,
    body: { workspaceId: workspace, name: 'billable' },
  });
  const e = await api('POST', '/api/entries', {
    cookie: alice,
    body: {
      workspaceId: workspace,
      description: 'old running',
      projectId: p.json.id,
      tagIds: [t.json.id],
      start: '2020-01-01T08:00:00.000Z',
      end: null,
    },
  });
  assert.equal(e.status, 200);
  assert.deepEqual(e.json.tagIds, [t.json.id]);

  const list = await api(
    'GET',
    `/api/entries?workspaceId=${workspace}&from=${TODAY}&to=${TOMORROW}`,
    { cookie: alice },
  );
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].id, e.json.id);
});

test('deleting a tag detaches it from entries', async () => {
  const tags = await api('GET', `/api/tags?workspaceId=${workspace}`, { cookie: alice });
  const del = await api('DELETE', `/api/tags/${tags.json[0].id}`, { cookie: alice });
  assert.equal(del.status, 204);
  const list = await api(
    'GET',
    `/api/entries?workspaceId=${workspace}&from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z`,
    { cookie: alice },
  );
  assert.deepEqual(list.json[0].tagIds, []);
});

test('an entry cannot reference a project or tag from another workspace', async () => {
  const other = await api('POST', '/api/workspaces', { cookie: alice, body: { name: 'Other' } });
  const foreignTag = await api('POST', '/api/tags', {
    cookie: alice,
    body: { workspaceId: other.json.id, name: 'foreign' },
  });
  const foreignProject = await api('POST', '/api/projects', {
    cookie: alice,
    body: { workspaceId: other.json.id, name: 'foreign' },
  });

  const badTag = await api('POST', '/api/entries', {
    cookie: alice,
    body: { workspaceId: workspace, start: TODAY, end: TOMORROW, tagIds: [foreignTag.json.id] },
  });
  assert.equal(badTag.status, 400);

  const badProject = await api('POST', '/api/entries', {
    cookie: alice,
    body: { workspaceId: workspace, start: TODAY, projectId: foreignProject.json.id },
  });
  assert.equal(badProject.status, 400);
});

test('a malformed timestamp is rejected', async () => {
  const r = await api('POST', '/api/entries', {
    cookie: alice,
    body: { workspaceId: workspace, start: 'not-a-date' },
  });
  assert.equal(r.status, 400);
});

test('a workspace exports and re-imports with remapped ids', async () => {
  // Build a small, self-contained workspace so the test doesn't depend on the
  // mutations other tests made to the default one.
  const src = await api('POST', '/api/workspaces', { cookie: alice, body: { name: 'Exportable' } });
  const srcId = src.json.id;
  const proj = await api('POST', '/api/projects', {
    cookie: alice,
    body: { workspaceId: srcId, name: 'Design', color: '#0984e3' },
  });
  const tag = await api('POST', '/api/tags', {
    cookie: alice,
    body: { workspaceId: srcId, name: 'billable' },
  });
  await api('POST', '/api/entries', {
    cookie: alice,
    body: {
      workspaceId: srcId,
      description: 'mockups',
      projectId: proj.json.id,
      tagIds: [tag.json.id],
      start: TODAY,
      end: TOMORROW,
    },
  });

  const exported = await api('GET', `/api/workspaces/${srcId}/export`, { cookie: alice });
  assert.equal(exported.status, 200);
  assert.equal(exported.json.type, 'swish.workspace');
  assert.equal(exported.json.version, 1);
  assert.equal(exported.json.projects.length, 1);
  assert.equal(exported.json.tags.length, 1);
  assert.equal(exported.json.entries.length, 1);

  const imported = await api('POST', '/api/workspaces/import', {
    cookie: alice,
    body: exported.json,
  });
  assert.equal(imported.status, 200);
  const newId = imported.json.id;
  assert.notEqual(newId, srcId, 'import creates a fresh workspace');

  // The imported entry must point at the *re-mapped* project/tag, not the originals.
  const projects = await api('GET', `/api/projects?workspaceId=${newId}`, { cookie: alice });
  const tags = await api('GET', `/api/tags?workspaceId=${newId}`, { cookie: alice });
  assert.notEqual(projects.json[0].id, proj.json.id, 'project id is remapped');
  assert.equal(projects.json[0].color, '#0984e3');

  const entries = await api(
    'GET',
    `/api/entries?workspaceId=${newId}&from=${TODAY}&to=${TOMORROW}`,
    {
      cookie: alice,
    },
  );
  assert.equal(entries.json.length, 1);
  assert.equal(entries.json[0].description, 'mockups');
  assert.equal(entries.json[0].projectId, projects.json[0].id);
  assert.deepEqual(entries.json[0].tagIds, [tags.json[0].id]);

  // An unrecognised payload is rejected.
  const bad = await api('POST', '/api/workspaces/import', {
    cookie: alice,
    body: { type: 'not-swish', projects: [] },
  });
  assert.equal(bad.status, 400);
});

test('a second user cannot read or write the first user’s data', async () => {
  const bob = await registerUser('bob', 'hunter2pw');
  const own = await api('GET', '/api/workspaces', { cookie: bob });
  assert.notEqual(own.json[0].id, workspace);

  const read = await api(
    'GET',
    `/api/entries?workspaceId=${workspace}&from=${TODAY}&to=${TOMORROW}`,
    {
      cookie: bob,
    },
  );
  assert.equal(read.status, 403);

  const write = await api('POST', '/api/projects', {
    cookie: bob,
    body: { workspaceId: workspace, name: 'intrusion' },
  });
  assert.equal(write.status, 403);
});

test("teams: the manager gets read-only access to members' shared workspaces by default", async () => {
  const manager = await registerUser('manager', 'hunter2pw');
  const emp = await registerUser('emp', 'hunter2pw');
  const boss = await registerUser('boss', 'hunter2pw');

  // emp owns two workspaces: the default + a second.
  const empWs = (await api('GET', '/api/auth/me', { cookie: emp })).json.activeWorkspaceId;
  const empSecond = (await api('POST', '/api/workspaces', { cookie: emp, body: { name: 'Side' } }))
    .json.id;

  // Two managers create two teams.
  const teamId = (await api('POST', '/api/teams', { cookie: manager, body: { name: 'Squad' } }))
    .json.id;
  const team2 = (await api('POST', '/api/teams', { cookie: boss, body: { name: 'Other' } })).json
    .id;

  // A non-manager can't invite; the manager can. Both teams may invite emp while
  // emp is on no team (multiple pending invites are allowed).
  assert.equal(
    (
      await api('POST', `/api/teams/${teamId}/invites`, {
        cookie: emp,
        body: { username: 'manager' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api('POST', `/api/teams/${teamId}/invites`, {
        cookie: manager,
        body: { username: 'emp' },
      })
    ).status,
    200,
  );
  assert.equal(
    (await api('POST', `/api/teams/${team2}/invites`, { cookie: boss, body: { username: 'emp' } }))
      .status,
    200,
  );

  // Before accepting, nothing is visible to the manager.
  assert.deepEqual((await api('GET', '/api/shared', { cookie: manager })).json, []);

  // emp accepts one team; ALL of emp's workspaces become visible to that manager.
  assert.equal((await api('POST', `/api/teams/${teamId}/accept`, { cookie: emp })).status, 200);
  let shared = (await api('GET', '/api/shared', { cookie: manager })).json;
  assert.deepEqual([...shared.map((w) => w.id)].sort(), [empWs, empSecond].sort());
  assert.ok(shared.every((w) => w.ownerUsername === 'emp'));

  // A regular member sees the team roster, including the manager.
  const empTeam = (await api('GET', '/api/teams', { cookie: emp })).json.teams[0];
  assert.equal(empTeam.role, 'member');
  assert.ok(empTeam.members.some((mem) => mem.username === 'manager' && mem.role === 'manager'));

  // One active team per user: emp can't accept (or be invited to) a second team.
  assert.equal((await api('POST', `/api/teams/${team2}/accept`, { cookie: emp })).status, 409);
  assert.equal(
    (await api('POST', `/api/teams/${team2}/invites`, { cookie: boss, body: { username: 'emp' } }))
      .status,
    409,
  );

  // Read access works; writes are refused (read-only).
  assert.equal(
    (
      await api('GET', `/api/entries?workspaceId=${empWs}&from=${TODAY}&to=${TOMORROW}`, {
        cookie: manager,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api('POST', '/api/entries', {
        cookie: manager,
        body: { workspaceId: empWs, start: TODAY },
      })
    ).status,
    403,
  );

  // The owner hides one workspace; it vanishes from the manager's view and reads 403.
  assert.equal(
    (await api('PATCH', `/api/workspaces/${empSecond}`, { cookie: emp, body: { shared: false } }))
      .status,
    200,
  );
  shared = (await api('GET', '/api/shared', { cookie: manager })).json;
  assert.deepEqual(
    shared.map((w) => w.id),
    [empWs],
  );
  assert.equal(
    (
      await api('GET', `/api/entries?workspaceId=${empSecond}&from=${TODAY}&to=${TOMORROW}`, {
        cookie: manager,
      })
    ).status,
    403,
  );

  // A member can't delete the team; the manager can't leave (must delete instead).
  assert.equal((await api('DELETE', `/api/teams/${teamId}`, { cookie: emp })).status, 403);
  assert.equal((await api('POST', `/api/teams/${teamId}/leave`, { cookie: manager })).status, 404);

  // emp leaves freely; the manager's shared list empties but emp keeps everything.
  assert.equal((await api('POST', `/api/teams/${teamId}/leave`, { cookie: emp })).status, 204);
  assert.deepEqual((await api('GET', '/api/shared', { cookie: manager })).json, []);
  assert.ok(
    (await api('GET', '/api/workspaces', { cookie: emp })).json.some((w) => w.id === empWs),
  );

  // Founder deletes the team; emp's data is untouched.
  assert.equal((await api('DELETE', `/api/teams/${teamId}`, { cookie: manager })).status, 204);
  assert.ok((await api('GET', '/api/workspaces', { cookie: emp })).json.length >= 1);
});

test('preferences default to auto/Sunday and can be updated', async () => {
  const me0 = await api('GET', '/api/auth/me', { cookie: alice });
  assert.equal(me0.json.theme, 'auto');
  assert.equal(me0.json.weekStart, 0);

  const bad = await api('PUT', '/api/settings/preferences', {
    cookie: alice,
    body: { theme: 'neon' },
  });
  assert.equal(bad.status, 400);

  const ok = await api('PUT', '/api/settings/preferences', {
    cookie: alice,
    body: { theme: 'dark', weekStart: 1 },
  });
  assert.equal(ok.status, 200);

  const me1 = await api('GET', '/api/auth/me', { cookie: alice });
  assert.equal(me1.json.theme, 'dark');
  assert.equal(me1.json.weekStart, 1);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await form('/login', { username: 'alice', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal(bad.cookie, null);

  const good = await form('/login', { username: 'alice', password: 'hunter2pw' });
  assert.equal(good.status, 303);
  assert.ok(good.cookie);
});

test('logout clears the session and redirects to /login', async () => {
  const throwaway = (await form('/login', { username: 'alice', password: 'hunter2pw' })).cookie;
  const res = await fetch(`${BASE}/logout`, {
    method: 'POST',
    headers: { cookie: throwaway, origin: ORIGIN },
    redirect: 'manual',
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/login$/);
  assert.equal((await api('GET', '/api/auth/me', { cookie: throwaway })).status, 401);
});

test('logout-others revokes other sessions but keeps the current one', async () => {
  const other = (await form('/login', { username: 'alice', password: 'hunter2pw' })).cookie;
  const r = await api('POST', '/api/auth/logout-others', { cookie: alice });
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/api/auth/me', { cookie: alice })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { cookie: other })).status, 401);
});

test('changing password requires the current one and rotates credentials', async () => {
  const wrong = await api('POST', '/api/auth/password', {
    cookie: alice,
    body: { currentPassword: 'nope', newPassword: 'brandnewpw9' },
  });
  assert.equal(wrong.status, 403);

  const ok = await api('POST', '/api/auth/password', {
    cookie: alice,
    body: { currentPassword: 'hunter2pw', newPassword: 'brandnewpw9' },
  });
  assert.equal(ok.status, 200);

  assert.equal((await form('/login', { username: 'alice', password: 'hunter2pw' })).status, 401);
  assert.equal((await form('/login', { username: 'alice', password: 'brandnewpw9' })).status, 303);
});

test('deleting the account removes it and its data', async () => {
  const wrong = await api('DELETE', '/api/auth/account', {
    cookie: alice,
    body: { password: 'not-it' },
  });
  assert.equal(wrong.status, 403);

  const del = await api('DELETE', '/api/auth/account', {
    cookie: alice,
    body: { password: 'brandnewpw9' },
  });
  assert.equal(del.status, 200);

  assert.equal((await api('GET', '/api/auth/me', { cookie: alice })).status, 401);
  assert.equal((await form('/login', { username: 'alice', password: 'brandnewpw9' })).status, 401);
});
