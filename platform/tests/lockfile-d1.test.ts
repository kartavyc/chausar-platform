// D1: one lockfile check (scripts/lockfile.mjs), shared by desktop packaging, the package preflight and this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lockfileProblems, PINNED_BUILD_GIT_SOURCES } from '../../scripts/lockfile.mjs';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
// Built at runtime: a fixture hash, never a real one.
const integrity = 'sha512-' + 'A'.repeat(86) + '==';
const resolved = 'https://registry.npmjs.org/test-fixture.tgz';

function goodLock(): any {
  const rootEntry = { name: pkg.name, version: pkg.version, dependencies: { ...pkg.dependencies }, devDependencies: { ...pkg.devDependencies } };
  const packages: Record<string, any> = { '': rootEntry };
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) packages[`node_modules/${name}`] = { version, resolved, integrity };
  packages['node_modules/some-transitive'] = { version: '1.2.3', resolved, integrity, dev: true };
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages };
}

const codes = (lock: any, options?: any) => lockfileProblems(lock, pkg, options).map(problem => problem.code);

test('a good lock has no problems', () => {
  assert.deepEqual(lockfileProblems(goodLock(), pkg), []);
});

test('lockfile version 2, or a root version that is not package.json\'s, is a problem', () => {
  assert.deepEqual(codes({ ...goodLock(), lockfileVersion: 2 }), ['version']);
  const lock = goodLock();
  lock.packages[''].version = '9.9.9';
  assert.deepEqual(codes(lock), ['version']);
  assert.deepEqual(codes({ lockfileVersion: 3 }), ['version']);
});

test('a conflicting root pin is a problem, and so is a pin the lock does not resolve exactly', () => {
  const lock = goodLock();
  const [name] = Object.keys(pkg.dependencies);
  lock.packages[''].dependencies[name] = '0.0.1';
  const problems = lockfileProblems(lock, pkg);
  assert.deepEqual(problems.map(problem => [problem.code, problem.kind]), [['dependencies-differ', 'dependencies']]);
  const unresolved = goodLock();
  unresolved.packages[`node_modules/${name}`].version = '0.0.1';
  assert.deepEqual(lockfileProblems(unresolved, pkg).map(problem => [problem.code, problem.name]), [['unresolved-pin', name]]);
});

test('missing integrity, a link, or a range instead of an exact version is a problem', () => {
  for (const change of [{ integrity: undefined }, { link: true }, { version: '^1.2.3' }, { integrity: 'sha1-abc' }]) {
    const lock = goodLock();
    Object.assign(lock.packages['node_modules/some-transitive'], change);
    assert.deepEqual(codes(lock), ['entry'], JSON.stringify(change));
  }
});

test('an http: or credentialed or missing resolved URL is a problem', () => {
  for (const url of ['http://registry.npmjs.org/x.tgz', 'https://user:secret@registry.npmjs.org/x.tgz', undefined, 'not a url']) {
    const lock = goodLock();
    lock.packages['node_modules/some-transitive'].resolved = url;
    assert.deepEqual(codes(lock), ['resolved'], String(url));
  }
});

test('only the one pinned build-only Git source is accepted, as a dev package with integrity, and only when asked for', () => {
  const [path, url] = Object.entries(PINNED_BUILD_GIT_SOURCES)[0] as [string, string];
  const lock = goodLock();
  lock.packages[path] = { version: '10.2.0-electron.1', resolved: url, integrity, dev: true };
  assert.deepEqual(codes(lock, { pinnedGitSources: PINNED_BUILD_GIT_SOURCES }), []);
  assert.deepEqual(codes(lock), ['resolved'], 'not accepted unless the caller passes the pinned sources');
  lock.packages[path].dev = false;
  assert.deepEqual(codes(lock, { pinnedGitSources: PINNED_BUILD_GIT_SOURCES }), ['resolved'], 'only as a build-time package');
});
// D1 task 3: the root lock is committed (founder override of the old AGENTS rule) and matches package.json.
test('the root package-lock.json is tracked by git and passes the check against package.json', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', 'package-lock.json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(tracked.status, 0, 'package-lock.json is committed');
  const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.deepEqual(lockfileProblems(lock, pkg, { pinnedGitSources: PINNED_BUILD_GIT_SOURCES }), []);
});

test('AGENTS.md says the lock is committed and installs use npm ci (it no longer calls the lock a stray leftover)', async () => {
  const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  assert.doesNotMatch(agents, /Never commit the root `package-lock\.json`/);
  assert.match(agents, /The root `package-lock\.json` is committed\. Install with `npm ci`\./);
});

test('the dev packages later D batches need are pinned now, so this one lock covers them', () => {
  for (const name of ['happy-dom', '@biomejs/biome', 'knip']) assert.match(pkg.devDependencies[name] ?? '', /^\d+\.\d+\.\d+$/, name);
});
