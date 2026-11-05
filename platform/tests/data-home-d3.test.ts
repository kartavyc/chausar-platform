// D3: runtime and test data never land in the code folder. The data home (servers and a worker run by hand), the run
// root (bench, UI bench, benchmarks, screenshot walk) and the refusal of a folder inside this checkout.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataHome, refuseInsideRepo, runRoot } from '../runtime/data-home.ts';

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** A temp folder shaped like this checkout: package.json named chausar-desktop beside a .git folder. */
async function fakeRepo(t: TestContext, name = 'chausar-desktop') {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'chausar-data-home-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const repo = join(parent, 'repo');
  await mkdir(join(repo, '.git'), { recursive: true });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name, private: true }));
  return { parent, repo };
}

const windows = { platform: 'win32' as const, home: 'C:\\Users\\owner' };
const mac = { platform: 'darwin' as const, home: '/Users/owner' };
const linux = { platform: 'linux' as const, home: '/home/owner' };

test('each system has its own per-user default, and demo and real never share a folder', () => {
  assert.equal(dataHome('local-web', { env: { LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local' }, ...windows }), win32.join('C:\\Users\\owner\\AppData\\Local', 'Chausar', 'dev', 'local-web'));
  assert.equal(dataHome('local-web', { env: {}, ...windows }), win32.join('C:\\Users\\owner', 'AppData', 'Local', 'Chausar', 'dev', 'local-web'), 'no LOCALAPPDATA: the usual folder under the home');
  assert.equal(dataHome('hosted', { env: {}, ...mac }), posix.join('/Users/owner', 'Library', 'Application Support', 'Chausar', 'dev', 'hosted'));
  assert.equal(dataHome('worker', { env: { XDG_DATA_HOME: '/data/xdg' }, ...linux }), posix.join('/data/xdg', 'chausar', 'dev', 'worker'));
  assert.equal(dataHome('worker', { env: {}, ...linux }), posix.join('/home/owner', '.local', 'share', 'chausar', 'dev', 'worker'));
  for (const system of [windows, mac, linux]) {
    const real = dataHome('local-web', { env: {}, ...system }), demo = dataHome('local-web-demo', { env: {}, ...system });
    assert.notEqual(real, demo, system.platform);
  }
  assert.throws(() => dataHome('somewhere' as never, { env: {}, ...linux }), code('DATA_HOME_KIND_INVALID'));
});

test('the order of the three sources: the kind\'s own variable, then CHAUSAR_HOME/<kind>, then the per-user folder', async t => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'chausar-data-home-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const home = join(parent, 'home'), vault = join(parent, 'vault'), hosted = join(parent, 'hosted');
  const system = { platform: process.platform, home: join(parent, 'user') };
  for (const kind of ['local-web', 'local-web-demo', 'worker'] as const) {
    assert.equal(dataHome(kind, { env: { CHAUSAR_VAULT_DIRECTORY: vault, CHAUSAR_HOME: home, CHAUSAR_HOSTED_DATA: hosted }, ...system }), vault, kind);
    assert.equal(dataHome(kind, { env: { CHAUSAR_HOME: home, CHAUSAR_HOSTED_DATA: hosted }, ...system }), join(home, kind), kind);
  }
  assert.equal(dataHome('hosted', { env: { CHAUSAR_VAULT_DIRECTORY: vault, CHAUSAR_HOME: home, CHAUSAR_HOSTED_DATA: hosted }, ...system }), hosted);
  assert.equal(dataHome('hosted', { env: { CHAUSAR_VAULT_DIRECTORY: vault, CHAUSAR_HOME: home }, ...system }), join(home, 'hosted'), 'the vault variable is not the hosted one');
  assert.equal(dataHome('hosted', { env: { CHAUSAR_HOME: '' }, ...linux }), posix.join('/home/owner', '.local', 'share', 'chausar', 'dev', 'hosted'), 'an empty variable counts as unset');
});

test('the run root: CHAUSAR_RUN_ROOT/<name>, else the temp folder under chausar-runs, dated by the owner\'s own day', async t => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'chausar-run-root-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  // 23:30 local on 5 November: the folder says the 5th whatever the time zone, as the owner's clock does.
  const now = () => new Date(2026, 10, 5, 23, 30);
  assert.equal(runRoot('engine-tests', { env: {}, now }), join(tmpdir(), 'chausar-runs', '2026-11-05-engine-tests'));
  assert.equal(runRoot('ui-shots', { env: {}, now: () => new Date(2027, 0, 9, 0, 5) }), join(tmpdir(), 'chausar-runs', '2027-01-09-ui-shots'));
  assert.equal(runRoot('engine-tests', { env: { CHAUSAR_RUN_ROOT: parent }, now }), join(parent, 'engine-tests'));
  assert.throws(() => runRoot('../escape', { env: {}, now }), code('RUN_NAME_INVALID'));
});

test('a folder inside this checkout is refused, unless CHAUSAR_ALLOW_REPO_DATA=1; a sibling folder passes', async t => {
  const { parent, repo } = await fakeRepo(t);
  const inside = join(repo, 'data', 'local-web');
  assert.throws(() => refuseInsideRepo(inside, { env: {} }), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'DATA_INSIDE_REPO');
    assert.equal(error.name, 'ChausarError');
    assert.match(error.message, /^Chausar keeps its data outside the code folder\. Set CHAUSAR_HOME to a folder elsewhere/);
    return true;
  });
  assert.throws(() => refuseInsideRepo(repo, { env: {} }), code('DATA_INSIDE_REPO'), 'the checkout itself');
  assert.equal(refuseInsideRepo(inside, { env: { CHAUSAR_ALLOW_REPO_DATA: '1' } }), inside);
  assert.equal(refuseInsideRepo(join(parent, 'beside', 'data'), { env: {} }), join(parent, 'beside', 'data'));
  // The data home and the run root check what they return.
  assert.throws(() => dataHome('local-web', { env: { CHAUSAR_HOME: join(repo, 'home') }, platform: process.platform, home: parent }), code('DATA_INSIDE_REPO'));
  assert.throws(() => dataHome('hosted', { env: { CHAUSAR_HOSTED_DATA: join(repo, 'data', 'hosted') }, platform: process.platform, home: parent }), code('DATA_INSIDE_REPO'));
  assert.throws(() => runRoot('engine-tests', { env: { CHAUSAR_RUN_ROOT: join(repo, 'results') }, now: () => new Date() }), code('DATA_INSIDE_REPO'));
  assert.equal(runRoot('engine-tests', { env: { CHAUSAR_RUN_ROOT: join(repo, 'results'), CHAUSAR_ALLOW_REPO_DATA: '1' }, now: () => new Date() }), join(repo, 'results', 'engine-tests'));
});

test('a fixture repo named otherwise, or a package without .git, is not this checkout', async t => {
  const other = await fakeRepo(t, 'someone-else');
  assert.equal(refuseInsideRepo(join(other.repo, 'data'), { env: {} }), join(other.repo, 'data'));
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'chausar-data-home-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(join(parent, 'package.json'), JSON.stringify({ name: 'chausar-desktop' }));
  assert.equal(refuseInsideRepo(join(parent, 'data'), { env: {} }), join(parent, 'data'));
});

test('this very checkout is recognised (the real package.json and .git)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  assert.throws(() => refuseInsideRepo(join(root, 'data'), { env: {} }), code('DATA_INSIDE_REPO'));
});
