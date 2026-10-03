import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const source = await readFile(new URL('../../app/desktop/demo-profile.cjs', import.meta.url), 'utf8');
function fixture(windows = false) {
  const paths = windows ? path.win32 : path.posix;
  const temporary = windows ? 'C:\\synthetic-temp' : '/synthetic-temp';
  const previous = windows ? 'C:\\real-profile' : '/real-profile';
  const root = paths.join(temporary, 'fresh-demo');
  const entries = new Set([temporary]), writes: string[] = [], bindings: Record<string, string> = { userData: previous, sessionData: previous };
  let uuid = 0;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { module, process: { env: {} }, require(name: string) {
    if (name === 'node:path') return paths;
    if (name === 'node:os') return { tmpdir: () => temporary };
    if (name === 'node:crypto') return { randomUUID: () => `synthetic-${++uuid}` };
    assert.equal(name, 'node:fs');
    return { realpathSync(input: string) { assert.equal(input, temporary); return input; }, mkdirSync(input: string, options: any) {
      assert.equal(options.mode, 0o700); assert.equal(options.recursive, undefined);
      if (entries.has(input)) throw Object.assign(new Error('Already exists'), { code: 'EEXIST' });
      assert.ok(entries.has(paths.dirname(input)), 'Only create children in the synthetic fixture');
      entries.add(input); writes.push(input);
    } };
  } });
  const app = { getPath: (name: string) => bindings[name], setPath: (name: string, value: string) => { bindings[name] = value; } };
  return { ...module.exports, app, root, temporary, previous, entries, writes, bindings, paths };
}

test('profile claims are fresh and immutable with Linux and Windows path semantics', () => {
  for (const windows of [false, true]) {
    const f = fixture(windows), profile = f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root });
    assert.equal(Object.isFrozen(profile), true);
    assert.deepEqual(f.writes, [f.root, f.paths.join(f.root, 'userData'), f.paths.join(f.root, 'sessionData')]);
    assert.equal(profile.vaults, f.paths.join(f.root, 'userData', 'vaults'));
    assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), /separate|Already exists/);
  }
});

test('relative, non-temporary, nested and existing roots refuse without reading a real profile', () => {
  for (const windows of [false, true]) {
    const f = fixture(windows);
    for (const root of ['', 'relative', f.previous, f.paths.join(f.previous, 'nested'), f.paths.join(f.temporary, 'parent', 'nested'), `${f.root}\n`]) {
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: root }));
      assert.deepEqual(f.writes, []);
    }
    // An existing entry also stands for a file or symlink: exclusive mkdir never follows it.
    f.entries.add(f.root);
    assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), { code: 'EEXIST' });
    assert.deepEqual(f.writes, []);
    assert.equal(f.bindings.userData, f.previous);
  }
});

test('explicit roots overlapping an Electron profile are refused before filesystem mutation', () => {
  const f = fixture();
  for (const existing of [f.root, f.paths.join(f.root, 'userData'), f.temporary]) {
    f.bindings.userData = existing;
    assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), /separate/);
    assert.deepEqual(f.writes, []);
  }
});

test('direct desktop starts also choose new roots and reject later binding drift', () => {
  const f = fixture();
  const first = f.bindDemoProfile(f.app, {}), second = f.bindDemoProfile(f.app, {});
  assert.notEqual(first.root, second.root);
  f.bindings.sessionData = f.previous;
  assert.throws(() => f.assertDemoProfile(f.app, second), /retain/);
});
