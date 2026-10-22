// Staged website edits as engine methods (venture.site.stage, venture.site.apply, venture.site.revert). The site is a
// folder on this computer that the host names (CHAUSAR_SITE_FOLDER, never a payload), else the GitHub repo the business
// follows, which Chausar only reads. Nothing is written until the owner applies the exact hash they reviewed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { BuildFollowRecord, GitHubRequest, SiteEditRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { siteTargetFor } from '../runtime/venture/build/site-methods.ts';
import { ventureHostEnv } from '../runtime/venture/host-env.ts';
import { code, owner, setup } from './venture-views-env.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown, ctx: Context = owner) =>
  ((handlers as Record<string, Handler>)[method])(deps, ctx, payload) as Promise<T>;
const BEFORE = '<h1>Ledger Cafe Books</h1>\n<p>Open Monday to Friday.</p>\n';
const AFTER = '<h1>Ledger Cafe Books</h1>\n<p>Open Monday to Saturday.</p>\n';

async function siteFolder() {
  const root = await mkdtemp(join(tmpdir(), 'chausar-site-methods-'));
  await mkdir(join(root, 'pages'));
  await writeFile(join(root, 'pages', 'index.html'), BEFORE);
  return root;
}

test('the site methods belong to the build package; apply and revert need the app, staging does not', () => {
  for (const method of ['venture.site.stage', 'venture.site.apply', 'venture.site.revert'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'build');
    assert.equal(typeof (handlers as Record<string, unknown>)[method], 'function', method);
  }
  assert.equal(APP_ONLY_METHODS.includes('venture.site.stage'), false);
  assert.ok(APP_ONLY_METHODS.includes('venture.site.apply'));
  assert.ok(APP_ONLY_METHODS.includes('venture.site.revert'));
});

test('a site folder from the host: stage writes nothing, apply needs the reviewed hash, revert puts the old file back', async () => {
  const env = await setup();
  const root = await siteFolder();
  try {
    const deps: VentureDeps = { ...env.deps, siteFolder: root };
    const staged = await call<SiteEditRecord>(deps, 'venture.site.stage', { path: 'pages/index.html', after: AFTER, summary: 'Add Saturday to the opening days' }, agent);
    assert.equal(staged.state, 'staged');
    assert.equal(staged.target.kind, 'local-folder');
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), BEFORE, 'staging writes nothing');

    await assert.rejects(call(deps, 'venture.site.apply', { editId: staged.id, reviewedHash: staged.planDigest }, agent), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(call(deps, 'venture.site.apply', { editId: staged.id, reviewedHash: 'a'.repeat(64) }), code('APPROVAL_STALE'));
    await assert.rejects(call(deps, 'venture.site.apply', { editId: staged.id, planDigest: staged.planDigest }), code('INVALID_VENTURE_REQUEST'));

    const applied = await call<SiteEditRecord>(deps, 'venture.site.apply', { editId: staged.id, reviewedHash: staged.planDigest });
    assert.equal(applied.state, 'applied');
    assert.deepEqual(applied.log.map(entry => entry.step), ['staged', 'applied', 'verified']);
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), AFTER);

    const reverted = await call<SiteEditRecord>(deps, 'venture.site.revert', { editId: staged.id, reviewedHash: staged.planDigest });
    assert.equal(reverted.state, 'rolled-back');
    assert.equal(await readFile(join(root, 'pages', 'index.html'), 'utf8'), BEFORE);
    assert.equal(listRecords(env.store.read(), 'venture-site-edit').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without a site folder the followed GitHub repo is the target: edits stage, but apply is refused because Chausar only reads', async () => {
  const env = await setup();
  await assert.rejects(call(env.deps, 'venture.site.stage', { path: 'index.html', after: 'new', summary: 'Change' }), code('REPO_NOT_LINKED'));
  assert.throws(() => siteTargetFor(env.deps, env.store.read()), code('REPO_NOT_LINKED'));

  await ventureAction(env.deps, owner, 'admin', 'seed.follow', tx => tx.put<BuildFollowRecord>({
    ...tx.base('venture-build-follow'), repo: { owner: 'ledger', name: 'site' }, tokenState: 'none', linkedAt: tx.now, lastStatus: null,
  }));
  await assert.rejects(call(env.deps, 'venture.site.stage', { path: 'index.html', after: 'new', summary: 'Change' }), code('REPO_NOT_LINKED'),
    'the main branch is not known until the repo was read once');

  await ventureAction(env.deps, owner, 'admin', 'seed.follow', tx => {
    const [follow] = tx.list('venture-build-follow');
    tx.replace<BuildFollowRecord>({ ...follow, lastStatus: { repo: { fullName: 'ledger/site', private: true, defaultBranch: 'main', htmlUrl: null } } as BuildFollowRecord['lastStatus'] });
  });
  const requests: GitHubRequest[] = [];
  const deps: VentureDeps = {
    ...env.deps,
    github: {
      kind: 'fixture',
      async read(request) {
        requests.push(request);
        return request.path === '/repos/ledger/site/contents/index.html?ref=main'
          ? { status: 200, etag: null, body: 'old', rateRemaining: 50 } : { status: 404, etag: null, body: '', rateRemaining: 50 };
      },
    },
  };
  assert.equal(siteTargetFor(deps, env.store.read()).identity, 'github:ledger/site@main');
  const staged = await call<SiteEditRecord>(deps, 'venture.site.stage', { path: 'index.html', after: 'new', summary: 'Change the home page' });
  assert.equal(staged.target.identity, 'github:ledger/site@main');
  assert.equal(requests[0].token, null);
  await assert.rejects(call(deps, 'venture.site.apply', { editId: staged.id, reviewedHash: staged.planDigest }), code('SITE_WRITE_NOT_GRANTED'));

  // The hosted web server never writes to a folder, even when one is passed in.
  const hosted: VentureDeps = { ...deps, host: 'hosted-web', siteFolder: '/srv/site' };
  assert.equal(siteTargetFor(hosted, env.store.read()).kind, 'github');
});

test('the site folder comes from CHAUSAR_SITE_FOLDER on this computer, and only as an absolute path', () => {
  const root = process.platform === 'win32' ? 'C:\\sites\\ledger' : '/sites/ledger';
  assert.equal(ventureHostEnv({ CHAUSAR_SITE_FOLDER: root }, { demo: false, host: 'desktop' }).siteFolder, root);
  assert.equal(ventureHostEnv({ CHAUSAR_SITE_FOLDER: root }, { demo: false, host: 'local-web' }).siteFolder, root);
  assert.equal(ventureHostEnv({ CHAUSAR_SITE_FOLDER: 'relative/site' }, { demo: false, host: 'desktop' }).siteFolder, undefined);
  assert.equal(ventureHostEnv({}, { demo: false, host: 'desktop' }).siteFolder, undefined);
});
