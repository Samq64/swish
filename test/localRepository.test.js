/**
 * Unit tests for the guest-mode local repository (src/data/localRepository.js).
 *
 *   npm test
 *
 * These run in plain Node against an in-memory localStorage shim — no server,
 * no D1. The focus is the behaviour that must match the cloud backend exactly,
 * because the store relies on it being identical:
 *   - listEntries returns the range PLUS the open running entry, ordered by start
 *   - deleting a project nulls it on entries; deleting a tag drops it from entries
 *   - deleting a workspace cascades to its projects/tags/entries
 *   - export/import round-trips through the shared WorkspaceExport shape
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalRepository,
  readGuestBootstrap,
  STORAGE_KEY,
} from '../src/data/localRepository.js';

// Minimal synchronous Storage shim (the parts the repo uses).
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// crypto.randomUUID is available in modern Node; assert so the suite fails loudly
// rather than producing undefined ids if run on something ancient.
assert.equal(typeof crypto?.randomUUID, 'function', 'crypto.randomUUID required');

let storage;
let repo;
let ws; // the auto-seeded workspace

beforeEach(async () => {
  storage = memoryStorage();
  repo = createLocalRepository(storage);
  // First read seeds one workspace, the way registration would.
  [ws] = await repo.listWorkspaces();
});

test('seeds a single workspace on first use', async () => {
  assert.ok(ws?.id, 'a workspace exists');
  const all = await repo.listWorkspaces();
  assert.equal(all.length, 1);
});

test('listEntries returns entries whose start is within [from, to)', async () => {
  await repo.createEntry({
    workspaceId: ws.id,
    start: '2026-06-10T09:00:00.000Z',
    end: '2026-06-10T10:00:00.000Z',
  });
  await repo.createEntry({
    workspaceId: ws.id,
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });

  const rows = await repo.listEntries({
    workspaceId: ws.id,
    from: '2026-06-08T00:00:00.000Z',
    to: '2026-06-14T00:00:00.000Z',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, '2026-06-10T09:00:00.000Z');
});

test('listEntries always includes the open running entry, even outside the range', async () => {
  // A running entry that started well before the queried window.
  await repo.createEntry({ workspaceId: ws.id, start: '2026-01-01T09:00:00.000Z', end: null });
  // A completed entry inside the window.
  await repo.createEntry({
    workspaceId: ws.id,
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });

  const rows = await repo.listEntries({
    workspaceId: ws.id,
    from: '2026-06-14T00:00:00.000Z',
    to: '2026-06-21T00:00:00.000Z',
  });
  assert.equal(rows.length, 2);
  assert.ok(
    rows.some((e) => e.end === null),
    'the running entry is present',
  );
});

test('listEntries is ordered by start and scoped to the workspace', async () => {
  const other = await repo.createWorkspace({ name: 'Other' });
  await repo.createEntry({
    workspaceId: ws.id,
    start: '2026-06-15T12:00:00.000Z',
    end: '2026-06-15T13:00:00.000Z',
  });
  await repo.createEntry({
    workspaceId: ws.id,
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });
  await repo.createEntry({
    workspaceId: other.id,
    start: '2026-06-15T09:30:00.000Z',
    end: '2026-06-15T10:30:00.000Z',
  });

  const rows = await repo.listEntries({
    workspaceId: ws.id,
    from: '2026-06-15T00:00:00.000Z',
    to: '2026-06-16T00:00:00.000Z',
  });
  assert.deepEqual(
    rows.map((e) => e.start),
    ['2026-06-15T09:00:00.000Z', '2026-06-15T12:00:00.000Z'],
  );
});

test('deleting a project nulls projectId on its entries (ON DELETE SET NULL)', async () => {
  const project = await repo.createProject({ workspaceId: ws.id, name: 'P' });
  const entry = await repo.createEntry({
    workspaceId: ws.id,
    projectId: project.id,
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });

  await repo.deleteProject(project.id);

  assert.deepEqual(await repo.listProjects(ws.id), []);
  const [reloaded] = await repo.listEntries({
    workspaceId: ws.id,
    from: '2026-06-15T00:00:00.000Z',
    to: '2026-06-16T00:00:00.000Z',
  });
  assert.equal(reloaded.id, entry.id);
  assert.equal(reloaded.projectId, null);
});

test('deleting a tag removes it from entries (entry_tags ON DELETE CASCADE)', async () => {
  const a = await repo.createTag({ workspaceId: ws.id, name: 'a' });
  const b = await repo.createTag({ workspaceId: ws.id, name: 'b' });
  await repo.createEntry({
    workspaceId: ws.id,
    tagIds: [a.id, b.id],
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });

  await repo.deleteTag(a.id);

  const [entry] = await repo.listEntries({
    workspaceId: ws.id,
    from: '2026-06-15T00:00:00.000Z',
    to: '2026-06-16T00:00:00.000Z',
  });
  assert.deepEqual(entry.tagIds, [b.id]);
  assert.equal((await repo.listTags(ws.id)).length, 1);
});

test('deleting a workspace cascades to its projects, tags and entries', async () => {
  const project = await repo.createProject({ workspaceId: ws.id, name: 'P' });
  const tag = await repo.createTag({ workspaceId: ws.id, name: 't' });
  await repo.createEntry({
    workspaceId: ws.id,
    projectId: project.id,
    tagIds: [tag.id],
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });
  const survivor = await repo.createWorkspace({ name: 'Survivor' });

  await repo.deleteWorkspace(ws.id);

  assert.deepEqual(
    (await repo.listWorkspaces()).map((w) => w.id),
    [survivor.id],
  );
  assert.deepEqual(await repo.listProjects(ws.id), []);
  assert.deepEqual(await repo.listTags(ws.id), []);
  assert.deepEqual(
    await repo.listEntries({
      workspaceId: ws.id,
      from: '2026-06-15T00:00:00.000Z',
      to: '2026-06-16T00:00:00.000Z',
    }),
    [],
  );
});

test('updateEntry only patches the allowed fields', async () => {
  const entry = await repo.createEntry({
    workspaceId: ws.id,
    description: 'first',
    start: '2026-06-15T09:00:00.000Z',
    end: null,
  });
  const updated = await repo.updateEntry(entry.id, {
    description: 'second',
    end: '2026-06-15T10:00:00.000Z',
    // a stray field the API wouldn't accept must not leak through
    workspaceId: 'should-be-ignored',
  });
  assert.equal(updated.description, 'second');
  assert.equal(updated.end, '2026-06-15T10:00:00.000Z');
  assert.equal(updated.workspaceId, ws.id);
});

test('export then import round-trips a workspace with remapped ids', async () => {
  const project = await repo.createProject({ workspaceId: ws.id, name: 'P', color: '#123456' });
  const tag = await repo.createTag({ workspaceId: ws.id, name: 't' });
  await repo.createEntry({
    workspaceId: ws.id,
    description: 'tracked',
    projectId: project.id,
    tagIds: [tag.id],
    start: '2026-06-15T09:00:00.000Z',
    end: '2026-06-15T10:00:00.000Z',
  });

  const payload = await repo.exportWorkspace(ws.id);
  assert.equal(payload.type, 'swish.workspace');
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.entries.length, 1);

  const imported = await repo.importWorkspace(payload);
  assert.notEqual(imported.id, ws.id, 'imported workspace gets a fresh id');

  const importedProjects = await repo.listProjects(imported.id);
  assert.equal(importedProjects.length, 1);
  assert.notEqual(importedProjects[0].id, project.id, 'project id is remapped');
  assert.equal(importedProjects[0].color, '#123456');

  const [importedEntry] = await repo.listEntries({
    workspaceId: imported.id,
    from: '2026-06-15T00:00:00.000Z',
    to: '2026-06-16T00:00:00.000Z',
  });
  assert.equal(importedEntry.description, 'tracked');
  assert.equal(
    importedEntry.projectId,
    importedProjects[0].id,
    'entry points at the remapped project',
  );
  const importedTags = await repo.listTags(imported.id);
  assert.deepEqual(importedEntry.tagIds, [importedTags[0].id], 'entry points at the remapped tag');
});

test('setPreferences persists and readGuestBootstrap reflects it', async () => {
  await repo.setPreferences({ theme: 'dark', weekStart: 1, hour12: false });
  const boot = readGuestBootstrap(storage);
  assert.equal(boot.theme, 'dark');
  assert.equal(boot.weekStart, 1);
  assert.equal(boot.hour12, false);
  assert.equal(boot.username, 'Guest');
  assert.equal(boot.activeWorkspaceId, ws.id);
});

test('a corrupt stored blob is replaced with a fresh seed', async () => {
  storage.setItem(STORAGE_KEY, '{not valid json');
  const fresh = createLocalRepository(storage);
  const all = await fresh.listWorkspaces();
  assert.equal(all.length, 1, 'recovered with one seeded workspace');
});
