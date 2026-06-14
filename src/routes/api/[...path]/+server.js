// swish API — a single SvelteKit endpoint serving /api/*.
//
// Pipeline: top-level error boundary → CSRF/origin check → per-resource handler.
// The session is resolved once in hooks.server.js (event.locals.user). Every
// data query is scoped to the authenticated user: `workspaceId` from the client
// is a claim to authorize, never a trusted scope, and ids referenced in a body
// (projectId/tagIds) are verified to live in the same workspace.

import { json, error, readJson, sameOrigin } from '$lib/server/http.js';
import { isIso, isStr, isStrArray, isHexColor } from '$lib/server/validate.js';
import { hashPassword, verifyPassword, sha256b64url, COOKIE_NAME } from '$lib/server/auth.js';
import { clearSessionCookie } from '$lib/server/session.js';

const DEFAULT_COLOR = '#6c5ce7';
const NAME_MAX = 200;
const DESC_MAX = 2000;
// Cap on statements per D1 batch when importing (keeps a large import under the
// runtime's bound-statement limit). See importWorkspace.
const IMPORT_BATCH_SIZE = 50;

// One handler for every method; the router dispatches on path + method.
export async function fallback(event) {
  try {
    return await route(event);
  } catch {
    // Never leak a stack to the client; surface a generic 500.
    return error(500, 'Internal error');
  }
}

async function route(event) {
  const { request, platform, params, locals } = event;
  const ctx = { env: platform.env, request, cookies: event.cookies };
  const method = request.method;
  const segs = (params.path || '').split('/').filter(Boolean);

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
    return error(403, 'Bad origin');
  }

  // Auth routes handle their own (un)authenticated cases.
  if (segs[0] === 'auth') return handleAuth(ctx, segs.slice(1), method, locals.user);

  const user = locals.user;
  if (!user) return error(401, 'Not authenticated');

  switch (segs[0]) {
    case 'entries':
      return handleEntries(ctx, segs.slice(1), method, user);
    case 'projects':
      return handleScoped(ctx, 'projects', segs.slice(1), method, user);
    case 'tags':
      return handleScoped(ctx, 'tags', segs.slice(1), method, user);
    case 'workspaces':
      return handleWorkspaces(ctx, segs.slice(1), method, user);
    case 'settings':
      return handleSettings(ctx, segs.slice(1), method, user);
    default:
      return error(404, 'Not found');
  }
}

// --- authorization & reference helpers ---------------------------------------

async function ownsWorkspace(env, userId, workspaceId) {
  if (!workspaceId) return false;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM workspaces WHERE id = ? AND user_id = ?',
  )
    .bind(workspaceId, userId)
    .first();
  return !!row;
}

// The only tables addressed by id through handleScoped/ownership helpers. Used
// as an allowlist so the `${table}` interpolation below can never be anything
// but one of these literals.
const SCOPED_TABLES = new Set(['projects', 'tags']);

/** Whether `userId` owns the workspace-scoped row `id` in `table`. */
async function ownsScopedRow(env, table, id, userId) {
  if (!SCOPED_TABLES.has(table)) throw new Error(`unsupported table: ${table}`);
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM ${table} t
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = ? AND w.user_id = ?`,
  )
    .bind(id, userId)
    .first();
  return !!row;
}

/** The workspace owning entry `id` for `userId`, or null if not theirs. */
async function ownedEntryWorkspace(env, userId, id) {
  const row = await env.DB.prepare(
    `SELECT e.workspace_id AS wid FROM entries e
       JOIN workspaces w ON w.id = e.workspace_id
      WHERE e.id = ? AND w.user_id = ?`,
  )
    .bind(id, userId)
    .first();
  return row?.wid ?? null;
}

/** True when projectId is null/absent or a project in `workspaceId`. */
async function projectInWorkspace(env, workspaceId, projectId) {
  if (projectId == null) return true;
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM projects WHERE id = ? AND workspace_id = ?',
  )
    .bind(projectId, workspaceId)
    .first();
  return !!row;
}

/** True when every id in tagIds is a tag within `workspaceId`. */
async function tagsInWorkspace(env, workspaceId, tagIds) {
  const unique = [...new Set(tagIds ?? [])];
  if (unique.length === 0) return true;
  const placeholders = unique.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id FROM tags WHERE workspace_id = ? AND id IN (${placeholders})`,
  )
    .bind(workspaceId, ...unique)
    .all();
  return results.length === unique.length;
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
      if (!isIso(from) || !isIso(to)) return error(400, 'from and to must be ISO timestamps');
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
      const invalid = validateEntryBody(body, { requireStart: true });
      if (invalid) return error(400, invalid);
      if (!(await projectInWorkspace(env, body.workspaceId, body.projectId ?? null)))
        return error(400, 'Project does not belong to this workspace');
      if (!(await tagsInWorkspace(env, body.workspaceId, body.tagIds)))
        return error(400, 'One or more tags do not belong to this workspace');

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

  if (method === 'DELETE') {
    // Authorize and delete in one statement: the WHERE only matches a row the
    // user owns, so meta.changes distinguishes success from forbidden/missing.
    const res = await env.DB.prepare(
      `DELETE FROM entries WHERE id = ?
         AND workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
    )
      .bind(id, user.id)
      .run();
    if (!res.meta.changes) return error(404, 'Not found');
    return new Response(null, { status: 204 });
  }

  if (method === 'PATCH') {
    // One lookup authorizes the row and yields its workspace, which we then use
    // to validate any project/tag references in the patch.
    const workspaceId = await ownedEntryWorkspace(env, user.id, id);
    if (!workspaceId) return error(404, 'Not found');

    const body = (await readJson(request)) || {};
    const invalid = validateEntryBody(body, { requireStart: false });
    if (invalid) return error(400, invalid);
    if ('projectId' in body && !(await projectInWorkspace(env, workspaceId, body.projectId ?? null)))
      return error(400, 'Project does not belong to this workspace');
    if ('tagIds' in body && !(await tagsInWorkspace(env, workspaceId, body.tagIds)))
      return error(400, 'One or more tags do not belong to this workspace');

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

  return error(405, 'Method not allowed');
}

/** Returns an error message for a bad entry body, or null when it's valid. */
function validateEntryBody(body, { requireStart }) {
  if (requireStart || 'start' in body) {
    if (!isIso(body.start)) return 'start must be an ISO timestamp';
  }
  if ('end' in body && body.end != null && !isIso(body.end))
    return 'end must be an ISO timestamp or null';
  if ('description' in body && !isStr(body.description, { max: DESC_MAX }))
    return 'description must be a string';
  if ('projectId' in body && body.projectId != null && !isStr(body.projectId))
    return 'projectId must be a string or null';
  if ('tagIds' in body && !isStrArray(body.tagIds)) return 'tagIds must be an array of strings';
  return null;
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
      const invalid = validateScopedBody(table, body);
      if (invalid) return error(400, invalid);
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

  if (method === 'PATCH') {
    const body = (await readJson(request)) || {};
    const invalid = validateScopedBody(table, body);
    if (invalid) return error(400, invalid);
    if (!(await ownsScopedRow(env, table, id, user.id))) return error(404, 'Not found');
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
    // Authorize-and-delete in one statement (see entries DELETE). Deleting a
    // project SET NULLs entries.project_id; deleting a tag cascades through
    // entry_tags — both via FK rules in the schema.
    const res = await env.DB.prepare(
      `DELETE FROM ${table} WHERE id = ?
         AND workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)`,
    )
      .bind(id, user.id)
      .run();
    if (!res.meta.changes) return error(404, 'Not found');
    return new Response(null, { status: 204 });
  }
  return error(405, 'Method not allowed');
}

/** Returns an error message for a bad project/tag body, or null when valid. */
function validateScopedBody(table, body) {
  // name is optional (defaults to '' on create); when present it must be a string.
  if ('name' in body && !isStr(body.name, { max: NAME_MAX })) return 'name must be a string';
  if (table === 'projects' && 'color' in body && !isHexColor(body.color))
    return 'color must be a hex colour';
  return null;
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
      if (body.name != null && !isStr(body.name, { max: NAME_MAX }))
        return error(400, 'name must be a string');
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
    if (payload.type !== 'swish.workspace') return error(400, 'Unrecognized import file');
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
    if (body.name != null && !isStr(body.name, { max: NAME_MAX }))
      return error(400, 'name must be a string');
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
  return { type: 'swish.workspace', version: 1, name: ws.name, projects, tags, entries };
}

async function importWorkspace(env, userId, payload) {
  const wsId = crypto.randomUUID();
  const name = (payload?.name || 'Imported workspace').toString();
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

  // D1 caps statements per batch, so a large import is committed in chunks. The
  // workspace insert leads the first chunk; a mid-import failure can therefore
  // leave a partial workspace, which the user can simply delete and re-import.
  for (let i = 0; i < stmts.length; i += IMPORT_BATCH_SIZE) {
    await env.DB.batch(stmts.slice(i, i + IMPORT_BATCH_SIZE));
  }
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

// --- auth (account actions for the signed-in user) ---------------------------

async function handleAuth(ctx, rest, method, user) {
  const { env, request, cookies } = ctx;
  const action = rest[0];

  if (action === 'me' && method === 'GET') {
    if (!user) return error(401, 'Not authenticated');
    return json({ username: user.username, activeWorkspaceId: user.activeWorkspaceId });
  }

  // Sign in / sign up / sign out are routes (/login, /register, /logout). The
  // remaining actions operate on the signed-in account.
  if (!user) return error(401, 'Not authenticated');

  const currentSid = async () => {
    const token = cookies.get(COOKIE_NAME);
    return token ? await sha256b64url(token) : '';
  };

  if (action === 'logout-others' && method === 'POST') {
    // Revoke every session except this one — the current device stays signed in.
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .bind(user.id, await currentSid())
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
    await env.DB.batch([
      env.DB
        .prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ? WHERE id = ?')
        .bind(pw.hash, pw.salt, pw.iterations, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, await currentSid()),
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
    clearSessionCookie(cookies);
    return json({ ok: true });
  }

  return error(404, 'Not found');
}
