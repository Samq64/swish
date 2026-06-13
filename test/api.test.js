/**
 * End-to-end tests for the Pages Functions backend, run against a real local
 * `wrangler pages dev` server backed by an isolated local D1 database.
 *
 *   npm test
 *
 * Covers the server-rendered auth routes (/login, /register, /logout), the
 * middleware that gates the app shell, and the JSON API.
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

// Form POST to an auth route; captures the 302 + Set-Cookie.
async function form(path, fields, { cookie, origin = ORIGIN } = {}) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded', origin };
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
  assert.equal(r.status, 302, `register ${username} should redirect`);
  assert.ok(r.cookie, `register ${username} should set a session cookie`);
  return r.cookie;
}

before(async () => {
  rmSync(STATE, { recursive: true, force: true });
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'migrations', 'apply', 'swish', '--local', '--persist-to', STATE],
    { stdio: 'ignore' },
  );
  server = spawn(
    'npx',
    ['wrangler', 'pages', 'dev', 'public', '--port', String(PORT), '--persist-to', STATE],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 40_000;
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

test('a second user cannot read or write the first user’s data', async () => {
  const bob = await registerUser('bob', 'hunter2pw');
  const own = await api('GET', '/api/workspaces', { cookie: bob });
  assert.notEqual(own.json[0].id, workspace);

  const read = await api('GET', `/api/entries?workspaceId=${workspace}&from=${TODAY}&to=${TOMORROW}`, {
    cookie: bob,
  });
  assert.equal(read.status, 403);

  const write = await api('POST', '/api/projects', {
    cookie: bob,
    body: { workspaceId: workspace, name: 'intrusion' },
  });
  assert.equal(write.status, 403);
});

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await form('/login', { username: 'alice', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  assert.equal(bad.cookie, null);

  const good = await form('/login', { username: 'alice', password: 'hunter2pw' });
  assert.equal(good.status, 302);
  assert.ok(good.cookie);
});

test('logout clears the session and redirects to /login', async () => {
  const throwaway = (await form('/login', { username: 'alice', password: 'hunter2pw' })).cookie;
  const res = await fetch(`${BASE}/logout`, { headers: { cookie: throwaway }, redirect: 'manual' });
  assert.equal(res.status, 302);
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
  assert.equal((await form('/login', { username: 'alice', password: 'brandnewpw9' })).status, 302);
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
