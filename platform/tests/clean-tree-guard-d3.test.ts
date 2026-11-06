// D3 task 8: scripts/check-clean-tree.mjs, the guard that keeps runtime and test data out of the code folder. Each case
// runs the real script, copied into a throwaway git repository under the temp folder (no network, no commit signing,
// none of the computer's own git settings), so nothing here touches this checkout.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = new URL('../../scripts/check-clean-tree.mjs', import.meta.url);

async function repo(t: TestContext, edit: (source: string) => string = source => source) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-clean-tree-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const quiet = join(directory, '.no-git-config');
  await writeFile(quiet, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: quiet, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '-q');
  await mkdir(join(directory, 'scripts'));
  await writeFile(join(directory, 'scripts', 'check-clean-tree.mjs'), edit(await readFile(SCRIPT, 'utf8')));
  await writeFile(join(directory, 'README.md'), 'A synthetic checkout.\n');
  await writeFile(join(directory, '.gitignore'), 'node_modules/\nresults/\n');
  git('add', '.'); git('commit', '-q', '-m', 'synthetic start');
  const put = async (path: string, content: string | Buffer) => { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), content); };
  // -f: a file tracked although .gitignore names it (results/ here) is exactly what layer A must catch.
  const track = async (path: string, content: string | Buffer) => { await put(path, content); git('add', '-f', path); git('commit', '-q', '-m', `add ${path}`); };
  const check = (mode: '--tracked' | '--after-run') => spawnSync(process.execPath, [join(directory, 'scripts', 'check-clean-tree.mjs'), mode], { cwd: directory, env, encoding: 'utf8', windowsHide: true });
  return { directory, put, track, check };
}

test('a clean tree passes both layers', async t => {
  const r = await repo(t);
  const tracked = r.check('--tracked'), after = r.check('--after-run');
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /The checkout is clean after the run\./);
});

test('layer A: tracked data fails, named with its kind; a docs/verification .tap fails too since D10 moved those logs', async t => {
  const r = await repo(t);
  await r.track('docs/verification/old.tap', 'TAP version 13\n');
  const old = r.check('--tracked');
  assert.equal(old.status, 1, 'no .tap log is known any more');
  assert.match(old.stderr, /docs\/verification\/old\.tap: a test log \(\.tap\)/);
  await r.track('data/x.json', '{}');
  const result = r.check('--tracked');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /data\/x\.json: runtime data \(data\/\)/);
  assert.match(result.stderr, /Data is tracked in the repo\./);
  // D3 fix (review 1, LOW 1): results/ and custody/ too, so dropping either pattern from the script turns this red.
  for (const path of ['app/ui/.shots/a.png', 'logs/run.tap', 'vaults/b.vault', 'hosted/dev-custody.key', 'hosted/tenants/t.json', 'reports/r.vitest.json', 'x.encrypted.json', 'b.backup', 'results/r.json', 'custody/c.json']) {
    const one = await repo(t);
    await one.track(path, 'x');
    assert.equal(one.check('--tracked').status, 1, path);
  }
});

test('layer A: a tracked file over 1 MB fails unless the script lists it with its reason', async t => {
  const big = Buffer.alloc(2 * 1024 * 1024, 7);
  const r = await repo(t);
  await r.track('assets/big.bin', big);
  const refused = r.check('--tracked');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /assets\/big\.bin: 2\.0 MB, over 1 MB and not on the list/);
  const listed = await repo(t, source => source.replace('const LARGE_FILES_ALLOWED = [\n', "const LARGE_FILES_ALLOWED = [\n  { path: 'assets/big.bin', reason: 'a synthetic large file for the guard test' },\n").replace('const LARGE_FILES_ALLOWED = [\r\n', "const LARGE_FILES_ALLOWED = [\r\n  { path: 'assets/big.bin', reason: 'a synthetic large file for the guard test' },\r\n"));
  await listed.track('assets/big.bin', big);
  const allowed = listed.check('--tracked');
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('layer B: an ignored run output fails after a run; node_modules and package-lock.json pass', async t => {
  const r = await repo(t);
  await r.put('node_modules/x/index.js', '');
  await r.put('package-lock.json', '{}');
  await r.put('app/ui/dist/index.html', '');
  await r.put('app/ui/node_modules/.vite/vitest/results.json', '{}');
  assert.equal(r.check('--after-run').status, 0, r.check('--after-run').stderr);
  await r.put('results/a.json', '{}');
  const result = r.check('--after-run');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /!! results\/a\.json/);
  assert.match(result.stderr, /Runtime or test data landed in the repo\. Write to the data home or the run root instead \(platform\/runtime\/data-home\.ts\)\./);
  const changed = await repo(t);
  await changed.put('README.md', 'A run rewrote a source file.\n');
  assert.equal(changed.check('--after-run').status, 1, 'a changed tracked file counts too');
});

test('package.json runs the tracked layer as guard:data, first in verify', async () => {
  const scripts = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).scripts as Record<string, string>;
  assert.equal(scripts['guard:data'], 'node scripts/check-clean-tree.mjs --tracked');
  assert.match(scripts.verify, /^npm run guard:data && /);
});

// D3 task 10: belt and braces. The guard is the real check; these lines only stop an accident reaching git add.
test('.gitignore names each folder and file kind a run or a dev server makes', async () => {
  const lines = (await readFile(new URL('../../.gitignore', import.meta.url), 'utf8')).split(/\r?\n/);
  for (const pattern of ['.b2c-work/', '.w3check/', 'app/ui/.vitest/', '.shots/', '*.tap', '*.key', 'tenants/', '*.encrypted.json', 'app/ui/results/', 'data/', 'results/']) {
    assert.ok(lines.includes(pattern), pattern);
  }
});
