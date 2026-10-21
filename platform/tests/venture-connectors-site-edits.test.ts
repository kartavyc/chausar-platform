// P2-connectors: staged website edits. An edit is staged with the file's current content and the new content, applied
// only with the exact plan digest the owner reviewed, checked again after writing, logged, and reversible. The local
// folder target writes real files in a temporary folder; the GitHub target stays read-only without a write grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import type { GitHubRequest, GitHubTransport, VentureDeps } from '../runtime/venture/contracts.ts';
import { houseStyleFindings, listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  applySiteEdit, githubSiteTarget, localFolderTarget, rejectSiteEdit, rollbackSiteEdit, siteTargetLabel, stageSiteEdit, type GitHubWriter, type SiteTarget,
} from '../runtime/venture/build/site-edits.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };

async function setup() {
  const store = new VentureTestStore();
  const deps = { store, clock: () => new Date('2026-10-21T10:00:00.000Z'), host: 'desktop' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'A studio site', ideaDigest: 'synthetic', workingName: 'Lumen Studio', country: null, serviceType: 'studio',
    status: 'build', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  const root = await mkdtemp(join(tmpdir(), 'chausar-site-'));
  await mkdir(join(root, 'pages'));
  await writeFile(join(root, 'pages', 'index.html'), '<h1>Lumen Studio</h1>\n<p>Open Monday to Friday.</p>\n');
  return { store, deps, root, target: localFolderTarget(root) };
}

test('stage, then apply only with the exact reviewed plan digest; the file is checked after writing and the log says so', async () => {
  const { store, deps, root, target } = await setup();
  try {
    const after = '<h1>Lumen Studio</h1>\n<p>Open Monday to Saturday.</p>\n';
    const staged = await stageSiteEdit(deps, agentCtx, target, { path: 'pages/index.html', after, summary: 'Add Saturday to the opening days' });
    assert.equal(staged.state, 'staged');
    assert.equal(staged.target.kind, 'local-folder');
    assert.match(staged.planDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(staged.log.map(entry => entry.step), ['staged']);
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), '<h1>Lumen Studio</h1>\n<p>Open Monday to Friday.</p>\n', 'staging writes nothing');

    await assert.rejects(applySiteEdit(deps, agentCtx, target, { editId: staged.id, planDigest: staged.planDigest }), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: 'a'.repeat(64) }), code('APPROVAL_STALE'));
    const other = localFolderTarget(join(root, 'pages'));
    await assert.rejects(applySiteEdit(deps, owner, other, { editId: staged.id, planDigest: staged.planDigest }), code('APPROVAL_STALE'));

    const applied = await applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    assert.equal(applied.state, 'applied');
    assert.deepEqual(applied.log.map(entry => entry.step), ['staged', 'applied', 'verified']);
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), after);
    await assert.rejects(applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest }), code('SITE_EDIT_NOT_FOUND'));

    const back = await rollbackSiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    assert.equal(back.state, 'rolled-back');
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), '<h1>Lumen Studio</h1>\n<p>Open Monday to Friday.</p>\n');
    assert.deepEqual(listRecords(store.read(), 'venture-site-edit')[0].log.map(entry => entry.step), ['staged', 'applied', 'verified', 'rolled-back', 'verified']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a file that changed since review is not overwritten; a plan altered in the vault is refused', async () => {
  const { store, deps, root, target } = await setup();
  try {
    const staged = await stageSiteEdit(deps, owner, target, { path: 'pages/index.html', after: '<h1>New</h1>\n', summary: 'New heading' });
    await writeFile(join(root, 'pages', 'index.html'), '<h1>Someone else edited this</h1>\n');
    await assert.rejects(applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest }), code('SITE_CHANGED_SINCE_REVIEW'));
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), '<h1>Someone else edited this</h1>\n');
    assert.equal(listRecords(store.read(), 'venture-site-edit')[0].state, 'staged', 'still waiting; nothing was written');

    const second = await stageSiteEdit(deps, owner, target, { path: 'pages/index.html', after: '<h1>Reviewed</h1>\n', summary: 'Heading' });
    await store.update(state => { (state.conversations.find(r => r.id === second.id) as any).after = '<h1>Swapped after review</h1>\n'; });
    await assert.rejects(applySiteEdit(deps, owner, target, { editId: second.id, planDigest: second.planDigest }), code('APPROVAL_STALE'));
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), '<h1>Someone else edited this</h1>\n');

    const rejected = await rejectSiteEdit(deps, owner, { editId: second.id });
    assert.equal(rejected.state, 'rejected');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('paths stay inside the site folder: no parent steps, no absolute paths, no .git, no links out, no missing files, no empty change', async () => {
  const { deps, root, target } = await setup();
  const outside = await mkdtemp(join(tmpdir(), 'chausar-outside-'));
  try {
    for (const path of ['../secret.txt', '/etc/passwd', 'C:/Windows/win.ini', 'pages/../../x', '.git/config', 'pages\\index.html', '']) {
      await assert.rejects(stageSiteEdit(deps, owner, target, { path, after: 'x', summary: 'Bad path' }), code('SITE_PATH_INVALID'), path);
    }
    await assert.rejects(stageSiteEdit(deps, owner, target, { path: 'pages/missing.html', after: 'x', summary: 'Missing' }), code('SITE_PATH_INVALID'));
    await assert.rejects(stageSiteEdit(deps, owner, target, { path: 'pages/index.html', after: '<h1>Lumen Studio</h1>\n<p>Open Monday to Friday.</p>\n', summary: 'Same' }), code('SITE_EDIT_UNCHANGED'));
    await writeFile(join(outside, 'secret.txt'), 'outside');
    let linked = false;
    try { await symlink(outside, join(root, 'escape'), 'junction'); linked = true; } catch { linked = false; }
    if (linked) await assert.rejects(stageSiteEdit(deps, owner, target, { path: 'escape/secret.txt', after: 'changed', summary: 'Escape' }), code('SITE_PATH_INVALID'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

function fakeTransport(files: Record<string, string>): GitHubTransport & { requests: GitHubRequest[] } {
  const requests: GitHubRequest[] = [];
  return {
    kind: 'fixture', requests,
    async read(request) {
      requests.push(request);
      const match = /^\/repos\/lumen\/site\/contents\/(.+)\?ref=main$/.exec(request.path);
      const path = match ? decodeURIComponent(match[1]) : '';
      return path in files ? { status: 200, etag: null, body: files[path], rateRemaining: 50 } : { status: 404, etag: null, body: '', rateRemaining: 50 };
    },
  };
}

test('GitHub: read-only without a write grant, and the label says so; with a grant and a writer the same staged flow applies', async () => {
  const { deps, root } = await setup();
  await rm(root, { recursive: true, force: true });
  const files: Record<string, string> = { 'src/pages/Home.tsx': 'export const title = "Lumen";\n' };
  const transport = fakeTransport(files);
  const readOnly = githubSiteTarget({ repo: { owner: 'lumen', name: 'site' }, branch: 'main', transport, token: null });
  assert.equal(readOnly.writable, false);
  assert.deepEqual(siteTargetLabel(readOnly), { mode: 'read', status: 'available', what: 'Reads your repo. Edits need a write grant you give, so Chausar only reads.' });
  assert.equal(transport.requests.length, 0);

  const staged = await stageSiteEdit(deps, owner, readOnly, { path: 'src/pages/Home.tsx', after: 'export const title = "Lumen Studio";\n', summary: 'Full name in the title' });
  assert.equal(staged.target.identity, 'github:lumen/site@main');
  assert.equal(transport.requests[0].path, '/repos/lumen/site/contents/src/pages/Home.tsx?ref=main');
  await assert.rejects(applySiteEdit(deps, owner, readOnly, { editId: staged.id, planDigest: staged.planDigest }), code('SITE_WRITE_NOT_GRANTED'));
  assert.equal(files['src/pages/Home.tsx'], 'export const title = "Lumen";\n');

  const writes: string[] = [];
  const writer: GitHubWriter = {
    async putFile(request) {
      writes.push(request.path);
      files[request.path] = request.content;
    },
  };
  const granted: SiteTarget = githubSiteTarget({ repo: { owner: 'lumen', name: 'site' }, branch: 'main', transport, token: 'github_pat_test', writer, grant: { scope: 'contents:write', grantedAt: '2026-10-21T09:00:00.000Z' } });
  assert.equal(granted.writable, true);
  assert.equal(siteTargetLabel(granted).mode, 'write');
  const applied = await applySiteEdit(deps, owner, granted, { editId: staged.id, planDigest: staged.planDigest });
  assert.equal(applied.state, 'applied');
  assert.deepEqual(writes, ['src/pages/Home.tsx']);
  assert.equal(files['src/pages/Home.tsx'], 'export const title = "Lumen Studio";\n');
});

test('a write that cannot be confirmed afterwards is needs-inspection, never retried; the original stays in the edit', async () => {
  const { deps, root } = await setup();
  await rm(root, { recursive: true, force: true });
  const content: Record<string, string> = { 'index.html': 'old' };
  const flaky: SiteTarget = {
    kind: 'local-folder', identity: 'folder:flaky', writable: true,
    async read(path) { return content[path] ?? null; },
    async replace(path) { content[path] = 'half written'; throw new Error('disk full'); },
  };
  const staged = await stageSiteEdit(deps, owner, flaky, { path: 'index.html', after: 'new', summary: 'Change' });
  const result = await applySiteEdit(deps, owner, flaky, { editId: staged.id, planDigest: staged.planDigest });
  assert.equal(result.state, 'needs-inspection');
  assert.equal(result.before, 'old');
  assert.match(result.log[result.log.length - 1].line, /Check the file before trying again/);
  await assert.rejects(applySiteEdit(deps, owner, flaky, { editId: staged.id, planDigest: staged.planDigest }), code('SITE_EDIT_NOT_FOUND'));
});

test('static: site-edits.ts throws only declared codes and keeps the house style', async () => {
  const source = await readFile(new URL('../runtime/venture/build/site-edits.ts', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]), match[1]);
  assert.ok(!source.includes('\u2014'));
  assert.deepEqual(houseStyleFindings(source), []);
});
