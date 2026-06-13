// swish API — a single catch-all Pages Function serving /api/*.
//
// Pipeline: CSRF/origin check → session resolution → per-resource handler.
// Every data query is scoped to the authenticated user: `workspaceId` from the
// client is treated as a claim to authorize, never as a trusted scope.

import { json, error, readJson, sameOrigin } from '../_lib/http.js';
import {
  hashPassword,
  verifyPassword,
  sha256b64url,
  newSessionToken,
  sessionCookie,
  clearSessionCookie,
  readSessionCookie,
  SESSION_TTL_MS,
} from '../_lib/auth.js';

const DEFAULT_COLOR = '#6c5ce7';

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method;
  const segs = params.path || [];

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
    return error(403, 'Bad origin');
  }

  // Auth routes are reachable without an existing session.
  if (segs[0] === 'auth') return handleAuth(context, segs.slice(1), method);

  const user = await resolveUser(env, request);
  if (!user) return error(401, 'Not authenticated');

  switch (segs[0]) {
    case 'entries':
      return handleEntries(context, segs.slice(1), method, user);
    case 'projects':
      return handleScoped(context, 'projects', segs.slice(1), method, user);
    case 'tags':
      return handleScoped(context, 'tags', segs.slice(1), method, user);
    case 'workspaces':
      return handleWorkspaces(context, segs.slice(1), method, user);
    case 'settings':
      return handleSettings(context, segs.slice(1), method, user);
    default:
      return error(404, 'Not found');
  }
}

// --- sessions ----------------------------------------------------------------

async function resolveUser(env, request) {
  const token = readSessionCookie(request);
  if (!token) return null;
  const id = await sha256b64url(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.username, u.active_workspace_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return {
    id: row.user_id,
    username: row.username,
    activeWorkspaceId: row.active_workspace_id,
  };
}

async function createSession(env, userId) {
  const token = newSessionToken();
  const id = await sha256b64url(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)',
  )
    .bind(
      id,
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
    )
    .run();
  return token;
}

// --- authorization helpers ---------------------------------------------------

async function ownsWorkspace(env, userId, workspaceId) {
  if (!workspaceId) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM workspaces WHERE id = ? AND user_id = ?',
  )
    .bind(workspaceId, userId)
    .first();
  return !!row;
}

/** The user_id that owns a workspace-scoped row, or null. `table` is internal. */
async function rowOwner(env, table, id) {
  const row = await env.DB.prepare(
    `SELECT w.user_id AS uid FROM ${table} t
       JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ?`,
  )
    .bind(id)
    .first();
  return row ? row.uid : null;
}

// --- entries -----------------------------------------------------------------

const ENTRY_SELECT = `
  SELECT e.id, e.workspace_id, e.description, e.project_id, e.start, e.ended_at,
         COALESCE(
           (SELECT json_group_array(et.tag_id) FROM entry_tags et WHERE et.entry_id = e.id),
           '[]'
         ) AS tag_ids
  FROM entries e`;

function mapEntry(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    description: row.description,
    projectId: row.project_id ?? null,
    tagIds: JSON.parse(row.tag_ids),
    start: row.start,
    end: row.ended_at ?? null,
  };
}

async function getEntry(env, id) {
  const row = await env.DB.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(id).first();
  return row ? mapEntry(row) : null;
}

async function handleEntries(ctx, rest, method, user) {
  const { env, request } = ctx;

  if (rest.length === 0) {
    if (method === 'GET') {
      const url = new URL(request.url);
      const workspaceId = url.searchParams.get('workspaceId');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!(await ownsWorkspace(env, user.id, workspaceId))) return error(403, 'Forbidden');
      // The open running entry is always returned, even outside [from, to), so
      // the timer is consistent on every device and view.
      const { results } = await env.DB.prepare(
        `${ENTRY_SELECT}
          WHERE e.workspace_id = ?
            AND ((e.start >= ? AND e.start < ?) OR e.ended_at IS NULL)
          ORDER BY e.start`,
      )
        .bind(workspaceId, from, to)
        .all();
      return json(results.map(mapEntry));
    }
    if (method === 'POST') {
      const body = (await readJson(request)) || {};
      if (!(await ownsWorkspace(env, user.id, body.workspaceId))) return error(403, 'Forbidden');
      const id = crypto.randomUUID();
      const stmts = [
        env.DB.prepare(
          `INSERT INTO entries (id, workspace_id, description, project_id, start, ended_at)
           VALUES (?,?,?,?,?,?)`,
        ).bind(
          id,
          body.workspaceId,
          body.description ?? '',
          body.projectId ?? null,
          body.start,
          body.end ?? null,
        ),
        ...tagInserts(env, id, body.tagIds),
      ];
      await env.DB.batch(stmts);
      return json(await getEntry(env, id));
    }
    return error(405, 'Method not allowed');
  }

  const id = rest[0];
  if ((await rowOwner(env, 'entries', id)) !== user.id) return error(403, 'Forbidden');

  if (method === 'PATCH') {
    const body = (await readJson(request)) || {};
    const sets = [];
    const vals = [];
    if ('description' in body) (sets.push('description = ?'), vals.push(body.description));
    if ('projectId' in body) (sets.push('project_id = ?'), vals.push(body.projectId ?? null));
    if ('start' in body) (sets.push('start = ?'), vals.push(body.start));
    if ('end' in body) (sets.push('ended_at = ?'), vals.push(body.end ?? null));

    const stmts = [];
    if (sets.length) {
      stmts.push(
        env.DB.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
      );
    }
    if ('tagIds' in body) {
      stmts.push(env.DB.prepare('DELETE FROM entry_tags WHERE entry_id = ?').bind(id));
      stmts.push(...tagInserts(env, id, body.tagIds));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json(await getEntry(env, id));
  }

  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'Method not allowed');
}

function tagInserts(env, entryId, tagIds) {
  return (tagIds ?? []).map((tagId) =>
    env.DB.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?,?)').bind(entryId, tagId),
  );
}

// --- projects & tags (workspace-scoped, near-identical) ----------------------

const SCOPED = {
  projects: {
    fields: ['name', 'color'],
    map: (r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, color: r.color }),
  },
  tags: {
    fields: ['name'],
    map: (r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name }),
  },
};

async function handleScoped(ctx, table, rest, method, user) {
  const { env, request } = ctx;
  const cfg = SCOPED[table];

  if (rest.length === 0) {
    if (method === 'GET') {
      const workspaceId = new URL(request.url).searchParams.get('workspaceId');
      if (!(await ownsWorkspace(env, user.id, workspaceId))) return error(403, 'Forbidden');
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`,
      )
        .bind(workspaceId)
        .all();
      return json(results.map(cfg.map));
    }
    if (method === 'POST') {
      const body = (await readJson(request)) || {};
      if (!(await ownsWorkspace(env, user.id, body.workspaceId))) return error(403, 'Forbidden');
      const row = { id: crypto.randomUUID(), workspace_id: body.workspaceId, name: body.name ?? '' };
      if (table === 'projects') row.color = body.color ?? DEFAULT_COLOR;
      const cols = Object.keys(row);
      await env.DB.prepare(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      )
        .bind(...cols.map((c) => row[c]))
        .run();
      return json(cfg.map(row));
    }
    return error(405, 'Method not allowed');
  }

  const id = rest[0];
  if ((await rowOwner(env, table, id)) !== user.id) return error(403, 'Forbidden');

  if (method === 'PATCH') {
    const body = (await readJson(request)) || {};
    const sets = [];
    const vals = [];
    for (const f of cfg.fields) {
      if (f in body) (sets.push(`${f} = ?`), vals.push(body[f]));
    }
    if (sets.length) {
      await env.DB.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals, id)
        .run();
    }
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    return json(cfg.map(row));
  }

  if (method === 'DELETE') {
    // Deleting a project SET NULLs entries.project_id; deleting a tag cascades
    // through entry_tags — both via FK rules in the schema.
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return new Response(null, { status: 204 });
  }
  return error(405, 'Method not allowed');
}

// --- workspaces (+ export/import) --------------------------------------------

async function handleWorkspaces(ctx, rest, method, user) {
  const { env, request } = ctx;

  if (rest.length === 0) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, name FROM workspaces WHERE user_id = ? ORDER BY name COLLATE NOCASE',
      )
        .bind(user.id)
        .all();
      return json(results.map((w) => ({ id: w.id, name: w.name })));
    }
    if (method === 'POST') {
      const body = (await readJson(request)) || {};
      const id = crypto.randomUUID();
      const name = (body.name ?? 'Workspace').toString();
      await env.DB.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)')
        .bind(id, user.id, name)
        .run();
      return json({ id, name });
    }
    return error(405, 'Method not allowed');
  }

  if (rest[0] === 'import' && method === 'POST') {
    const payload = (await readJson(request)) || {};
    return json(await importWorkspace(env, user.id, payload));
  }

  const id = rest[0];
  if (rest[1] === 'export' && method === 'GET') {
    if (!(await ownsWorkspace(env, user.id, id))) return error(403, 'Forbidden');
    return json(await exportWorkspace(env, id));
  }

  if (!(await ownsWorkspace(env, user.id, id))) return error(403, 'Forbidden');

  if (method === 'PATCH') {
    const body = (await readJson(request)) || {};
    const name = (body.name ?? '').toString();
    await env.DB.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind(name, id).run();
    return json({ id, name });
  }

  if (method === 'DELETE') {
    // Cascade drops the workspace's projects, tags and entries.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(id),
      env.DB
        .prepare('UPDATE users SET active_workspace_id = NULL WHERE id = ? AND active_workspace_id = ?')
        .bind(user.id, id),
    ]);
    return new Response(null, { status: 204 });
  }
  return error(405, 'Method not allowed');
}

async function exportWorkspace(env, id) {
  const ws = await env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(id).first();
  const projects = (
    await env.DB.prepare('SELECT id, name, color FROM projects WHERE workspace_id = ?').bind(id).all()
  ).results;
  const tags = (
    await env.DB.prepare('SELECT id, name FROM tags WHERE workspace_id = ?').bind(id).all()
  ).results;
  const entryRows = (
    await env.DB.prepare(`${ENTRY_SELECT} WHERE e.workspace_id = ? ORDER BY e.start`).bind(id).all()
  ).results;
  const entries = entryRows.map(mapEntry).map((e) => ({
    description: e.description,
    projectId: e.projectId,
    tagIds: e.tagIds,
    start: e.start,
    end: e.end,
  }));
  return { type: 'swish.workspace', version: 1, workspace: { name: ws.name }, projects, tags, entries };
}

async function importWorkspace(env, userId, payload) {
  const wsId = crypto.randomUUID();
  const name = (payload?.workspace?.name || 'Imported workspace').toString();
  const stmts = [
    env.DB.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').bind(wsId, userId, name),
  ];

  const projectIdMap = new Map();
  for (const p of payload?.projects ?? []) {
    const np = crypto.randomUUID();
    projectIdMap.set(p.id, np);
    stmts.push(
      env.DB.prepare('INSERT INTO projects (id, workspace_id, name, color) VALUES (?,?,?,?)').bind(
        np,
        wsId,
        p.name ?? 'Project',
        p.color ?? DEFAULT_COLOR,
      ),
    );
  }

  const tagIdMap = new Map();
  for (const t of payload?.tags ?? []) {
    const nt = crypto.randomUUID();
    tagIdMap.set(t.id, nt);
    stmts.push(
      env.DB.prepare('INSERT INTO tags (id, workspace_id, name) VALUES (?,?,?)').bind(nt, wsId, t.name ?? 'tag'),
    );
  }

  for (const e of payload?.entries ?? []) {
    const ne = crypto.randomUUID();
    const projectId = e.projectId != null ? projectIdMap.get(e.projectId) ?? null : null;
    stmts.push(
      env.DB.prepare(
        'INSERT INTO entries (id, workspace_id, description, project_id, start, ended_at) VALUES (?,?,?,?,?,?)',
      ).bind(ne, wsId, e.description ?? '', projectId, e.start, e.end ?? null),
    );
    for (const tid of e.tagIds ?? []) {
      const nt = tagIdMap.get(tid);
      if (nt) stmts.push(env.DB.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?,?)').bind(ne, nt));
    }
  }

  await env.DB.batch(stmts);
  return { id: wsId, name };
}

// --- settings ----------------------------------------------------------------

async function handleSettings(ctx, rest, method, user) {
  const { env, request } = ctx;
  if (method !== 'PUT') return error(405, 'Method not allowed');

  if (rest[0] === 'active-workspace') {
    const body = (await readJson(request)) || {};
    if (!(await ownsWorkspace(env, user.id, body.workspaceId))) return error(403, 'Forbidden');
    await env.DB.prepare('UPDATE users SET active_workspace_id = ? WHERE id = ?')
      .bind(body.workspaceId, user.id)
      .run();
    return json({ ok: true });
  }
  return error(404, 'Not found');
}

// --- auth --------------------------------------------------------------------

async function handleAuth(ctx, rest, method) {
  const { env, request } = ctx;
  const action = rest[0];

  if (action === 'me' && method === 'GET') {
    const user = await resolveUser(env, request);
    if (!user) return error(401, 'Not authenticated');
    return json({ username: user.username, activeWorkspaceId: user.activeWorkspaceId });
  }

  if (action === 'register' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    if (username.length < 3 || username.length > 32)
      return error(400, 'Username must be 3–32 characters');
    if (password.length < 8) return error(400, 'Password must be at least 8 characters');

    const existing = await env.DB.prepare('SELECT 1 AS ok FROM users WHERE username = ?')
      .bind(username)
      .first();
    if (existing) return error(409, 'Username already taken');

    const pw = await hashPassword(password, env.PEPPER);
    const userId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, username, pw_hash, pw_salt, pw_iterations, active_workspace_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(userId, username, pw.hash, pw.salt, pw.iterations, wsId, new Date(Date.now()).toISOString()),
      env.DB.prepare('INSERT INTO workspaces (id, user_id, name) VALUES (?,?,?)').bind(wsId, userId, 'Personal'),
    ]);
    const token = await createSession(env, userId);
    return json(
      { username, activeWorkspaceId: wsId },
      { headers: { 'Set-Cookie': sessionCookie(token) } },
    );
  }

  if (action === 'login' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const username = (body.username ?? '').trim();
    const password = body.password ?? '';
    const row = await env.DB.prepare(
      'SELECT id, pw_hash, pw_salt, pw_iterations, active_workspace_id FROM users WHERE username = ?',
    )
      .bind(username)
      .first();
    if (!row) return error(401, 'Invalid username or password');
    const ok = await verifyPassword(
      password,
      { hash: row.pw_hash, salt: row.pw_salt, iterations: row.pw_iterations },
      env.PEPPER,
    );
    if (!ok) return error(401, 'Invalid username or password');
    const token = await createSession(env, row.id);
    return json(
      { username, activeWorkspaceId: row.active_workspace_id },
      { headers: { 'Set-Cookie': sessionCookie(token) } },
    );
  }

  if (action === 'logout' && method === 'POST') {
    const token = readSessionCookie(request);
    if (token) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256b64url(token)).run();
    }
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
  }

  // The remaining auth actions operate on the signed-in account.
  const user = await resolveUser(env, request);
  if (!user) return error(401, 'Not authenticated');

  if (action === 'logout-others' && method === 'POST') {
    // Revoke every session except this one — the current device stays signed in.
    const token = readSessionCookie(request);
    const currentSid = token ? await sha256b64url(token) : '';
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .bind(user.id, currentSid)
      .run();
    return json({ ok: true });
  }

  if (action === 'password' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const newPassword = body.newPassword ?? '';
    if (newPassword.length < 8) return error(400, 'New password must be at least 8 characters');
    const cur = await env.DB.prepare(
      'SELECT pw_hash, pw_salt, pw_iterations FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first();
    const ok = await verifyPassword(
      body.currentPassword ?? '',
      { hash: cur.pw_hash, salt: cur.pw_salt, iterations: cur.pw_iterations },
      env.PEPPER,
    );
    if (!ok) return error(403, 'Current password is incorrect');
    const pw = await hashPassword(newPassword, env.PEPPER);
    // Keep this session; revoke every other one as a precaution.
    const token = readSessionCookie(request);
    const currentSid = token ? await sha256b64url(token) : '';
    await env.DB.batch([
      env.DB
        .prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ? WHERE id = ?')
        .bind(pw.hash, pw.salt, pw.iterations, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, currentSid),
    ]);
    return json({ ok: true });
  }

  if (action === 'account' && method === 'DELETE') {
    const body = (await readJson(request)) || {};
    const cur = await env.DB.prepare(
      'SELECT pw_hash, pw_salt, pw_iterations FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first();
    const ok = await verifyPassword(
      body.password ?? '',
      { hash: cur.pw_hash, salt: cur.pw_salt, iterations: cur.pw_iterations },
      env.PEPPER,
    );
    if (!ok) return error(403, 'Password is incorrect');
    // FK cascade drops the user's sessions, workspaces, projects, tags, entries.
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
  }

  return error(404, 'Not found');
}
