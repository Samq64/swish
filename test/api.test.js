/**
 * End-to-end tests for the Pages Functions API, run against a real local
 * `wrangler pages dev` server backed by an isolated local D1 database.
 *
 *   npm test
 *
 * The suite boots its own server on a dedicated port and persist directory, so
 * it never touches your `npm run dev` data.
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
const ORIGIN = BASE; // same-origin for allowed mutations

let server;

function sessionCookie(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = /^swish_session=([^;]*)/.exec(c);
    if (m) return `swish_session=${m[1]}`;
  }
  return null;
}

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
    /* 204 / empty */
  }
  return { status: res.status, json, cookie: sessionCookie(res) };
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
      if (r.status === 401) break; // responding
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

// Shared across the sequential tests below.
let alice = null; // session cookie
let workspace = null;

test('unauthenticated me is 401', async () => {
  const r = await api('GET', '/api/auth/me');
  assert.equal(r.status, 401);
});

test('register creates an account, session and default workspace', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { username: 'alice', password: 'hunter2pw' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'alice');
  assert.ok(r.json.activeWorkspaceId);
  assert.ok(r.cookie);
  alice = r.cookie;
  workspace = r.json.activeWorkspaceId;

  const me = await api('GET', '/api/auth/me', { cookie: alice });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, 'alice');

  const ws = await api('GET', '/api/workspaces', { cookie: alice });
  assert.equal(ws.status, 200);
  assert.deepEqual(
    ws.json.map((w) => w.name),
    ['Personal'],
  );
});

test('duplicate username is rejected', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { username: 'alice', password: 'hunter2pw' },
  });
  assert.equal(r.status, 409);
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
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].id, e.json.id);
});

test('deleting a tag detaches it from entries', async () => {
  const tags = await api('GET', `/api/tags?workspaceId=${workspace}`, { cookie: alice });
  const tagId = tags.json[0].id;
  const del = await api('DELETE', `/api/tags/${tagId}`, { cookie: alice });
  assert.equal(del.status, 204);
  const list = await api(
    'GET',
    `/api/entries?workspaceId=${workspace}&from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z`,
    { cookie: alice },
  );
  assert.deepEqual(list.json[0].tagIds, []);
});

test('a second user cannot read or write the first user’s data', async () => {
  const reg = await api('POST', '/api/auth/register', {
    body: { username: 'bob', password: 'hunter2pw' },
  });
  const bob = reg.cookie;
  const own = await api('GET', '/api/workspaces', { cookie: bob });
  assert.notEqual(own.json[0].id, workspace); // bob's own workspace

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
  const bad = await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: 'wrong-password' },
  });
  assert.equal(bad.status, 401);
  const good = await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: 'hunter2pw' },
  });
  assert.equal(good.status, 200);
});

test('logout invalidates its own session', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: 'hunter2pw' },
  });
  const throwaway = login.cookie;
  const out = await api('POST', '/api/auth/logout', { cookie: throwaway });
  assert.equal(out.status, 200);
  const me = await api('GET', '/api/auth/me', { cookie: throwaway });
  assert.equal(me.status, 401);
});

test('logout-others revokes other sessions but keeps the current one', async () => {
  const other = (await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: 'hunter2pw' },
  })).cookie;

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

  assert.equal(
    (await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'hunter2pw' } })).status,
    401,
  );
  assert.equal(
    (await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'brandnewpw9' } })).status,
    200,
  );
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
  assert.equal(
    (await api('POST', '/api/auth/login', { body: { username: 'alice', password: 'brandnewpw9' } })).status,
    401,
  );
});
