import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const source = await readFile(new URL('../../app/desktop/demo-profile.cjs', import.meta.url), 'utf8');
const profilePaths = ['userData', 'sessionData'] as const;
function fixture(windows = false, unavailable: readonly string[] = []) {
  const paths = windows ? path.win32 : path.posix;
  const temporary = windows ? 'C:\\synthetic-temp' : '/synthetic-temp';
  const appData = windows ? 'C:\\synthetic-appdata' : '/synthetic-appdata';
  const previous = paths.join(appData, 'Chausar');
  const root = paths.join(temporary, 'fresh-demo');
  const entries = new Set([temporary]), writes: string[] = [], reads: string[] = [], events: string[] = [];
  const defaultQueries: string[] = [], defaultWrites: string[] = [];
  const defaults: { appData: unknown, name: unknown, userDataDir: boolean } = { appData, name: 'Chausar', userDataDir: false };
  const bindings: Record<string, unknown> = { userData: previous, sessionData: previous };
  const bound = new Set<string>(), getErrors: Record<string, Error | undefined> = {}, setErrors: Record<string, Error | undefined> = {}, unretained = new Set<string>();
  let uuid = 0;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { module, process: { env: {} }, require(name: string) {
    if (name === 'node:path') return paths;
    if (name === 'node:os') return { tmpdir: () => temporary };
    if (name === 'node:crypto') return { randomUUID: () => `synthetic-${++uuid}` };
    assert.equal(name, 'node:fs');
    return { realpathSync(input: string) { reads.push(input); assert.equal(input, temporary); return input; }, mkdirSync(input: string, options: any) {
      assert.equal(options.mode, 0o700); assert.equal(options.recursive, undefined);
      if (entries.has(input)) throw Object.assign(new Error('Already exists'), { code: 'EEXIST' });
      assert.ok(entries.has(paths.dirname(input)), 'Only create children in the synthetic fixture');
      entries.add(input); writes.push(input); events.push(`mkdir:${input}`);
    } };
  } });
  const app = { getPath(name: string) {
    events.push(`get:${name}`);
    if (getErrors[name]) throw getErrors[name];
    if (name === 'appData') return defaults.appData;
    if (!bound.has(name)) {
      // Electron default profile getters may create the old profile directory.
      defaultQueries.push(name);
      if (unavailable.includes(name)) throw new Error(`Failed to get '${name}' path`);
      assert.equal(typeof bindings[name], 'string');
      defaultWrites.push(bindings[name] as string);
    }
    return bindings[name];
  }, setPath(name: string, value: string) {
    events.push(`bind:${name}`);
    assert.ok(entries.has(value), 'Electron setPath requires an existing directory');
    if (setErrors[name]) throw setErrors[name];
    if (!unretained.has(name)) { bindings[name] = value; bound.add(name); }
  }, getName() { events.push('getName'); return defaults.name; }, commandLine: { hasSwitch(name: string) {
    events.push(`switch:${name}`); assert.equal(name, 'user-data-dir'); return defaults.userDataDir;
  } } };
  return { ...module.exports, app, root, temporary, previous, entries, writes, reads, events, bindings, paths, defaults, defaultQueries, defaultWrites, getErrors, setErrors, unretained };
}

function assertFreshProfile(f: ReturnType<typeof fixture>, profile: any) {
  assert.equal(Object.isFrozen(profile), true);
  assert.deepEqual(f.writes, [profile.root, f.paths.join(profile.root, 'userData'), f.paths.join(profile.root, 'sessionData')]);
  assert.deepEqual(f.reads, [f.temporary]);
  assert.deepEqual(f.bindings, { userData: profile.userData, sessionData: profile.sessionData });
  assert.equal(profile.vaults, f.paths.join(profile.root, 'userData', 'vaults'));
  assert.deepEqual(f.defaultQueries, []);
  assert.deepEqual(f.defaultWrites, []);
  const firstProfileQuery = f.events.indexOf('get:userData');
  assert.ok(firstProfileQuery > f.events.indexOf('bind:sessionData'));
  assert.deepEqual(f.events.slice(firstProfileQuery), ['get:userData', 'get:sessionData']);
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
  for (const windows of [false, true]) {
    const f = fixture(windows);
    for (const existing of [f.root, f.paths.join(f.root, 'userData'), f.temporary]) {
      f.defaults.appData = f.paths.dirname(existing); f.defaults.name = f.paths.basename(existing);
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), /separate/);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
    }
  }
});

test('direct desktop starts also choose new roots and reject later binding drift', () => {
  const f = fixture();
  const first = f.bindDemoProfile(f.app, {}), second = f.bindDemoProfile(f.app, {});
  assert.notEqual(first.root, second.root);
  f.bindings.sessionData = f.previous;
  assert.throws(() => f.assertDemoProfile(f.app, second), /retain/);
});

test('fresh explicit and generated profiles never query Electron defaults before binding', () => {
  for (const windows of [false, true]) {
    for (const unavailable of [[], profilePaths, ['userData'], ['sessionData']]) {
      for (const explicit of [false, true]) {
        const f = fixture(windows, unavailable);
        const profile = f.bindDemoProfile(f.app, explicit ? { CHAUSAR_DEMO_PROFILE_ROOT: f.root } : {});
        assert.equal(profile.root, explicit ? f.root : f.paths.join(f.temporary, 'chausar-demo-synthetic-1'));
        assertFreshProfile(f, profile);
      }
    }
  }
});

test('derived default labels prevent overlap even if both default profile getters would fail', () => {
  for (const windows of [false, true]) {
    for (const overlap of ['root', 'child', 'parent']) {
      const f = fixture(windows, profilePaths);
      const existing = overlap === 'root' ? f.root : overlap === 'child' ? f.paths.join(f.root, 'userData') : f.temporary;
      f.defaults.appData = f.paths.dirname(existing); f.defaults.name = f.paths.basename(existing);
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), /separate/);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.reads, [f.temporary]);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
    }
  }
});

test('invalid side-effect-free appData paths reject before any profile mutation', () => {
  for (const windows of [false, true]) {
    const appData = windows ? 'C:\\synthetic-appdata' : '/synthetic-appdata';
    for (const invalid of [undefined, '', 'relative', `${appData}\0`, `${appData}\r`, `${appData}\n`]) {
      const f = fixture(windows);
      f.defaults.appData = invalid;
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }));
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
      assert.equal(f.events.some((event: string) => event.startsWith('bind:')), false);
    }
  }
});

test('only the exact unavailable appData error allows a fresh explicit or generated root', () => {
  for (const windows of [false, true]) {
    for (const explicit of [false, true]) {
      const f = fixture(windows, profilePaths);
      f.getErrors.appData = new Error("Failed to get 'appData' path");
      const profile = f.bindDemoProfile(f.app, explicit ? { CHAUSAR_DEMO_PROFILE_ROOT: f.root } : {});
      assertFreshProfile(f, profile);
    }
    for (const message of ['Unexpected Electron failure', "Failed to get 'userData' path", "Failed to get 'sessionData' path", "Failed to get 'appData' path.", "Failed to get 'appData' path\n"]) {
      const f = fixture(windows), failure = new Error(message);
      f.getErrors.appData = failure;
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }), (error: unknown) => error === failure);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
    }
  }
});

test('invalid Electron application names reject before any profile mutation', () => {
  for (const windows of [false, true]) {
    for (const name of [undefined, '', '.', '..', 'parent/child', 'parent\\child', '/absolute', 'C:\\absolute', 'C:profile', 'Chausar\0', 'Chausar\r', 'Chausar\n']) {
      const f = fixture(windows);
      f.defaults.name = name;
      assert.throws(() => f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root }));
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
    }
  }
});

test('user-data-dir overrides reject before any Electron path query or profile mutation', () => {
  for (const windows of [false, true]) {
    for (const explicit of [false, true]) {
      const f = fixture(windows);
      f.defaults.userDataDir = true;
      assert.throws(() => f.bindDemoProfile(f.app, explicit ? { CHAUSAR_DEMO_PROFILE_ROOT: f.root } : {}));
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.events, ['switch:user-data-dir']);
      assert.deepEqual(f.defaultQueries, []);
      assert.deepEqual(f.defaultWrites, []);
    }
  }
});

test('failed or unretained explicit bindings cannot produce a usable demo profile', () => {
  for (const windows of [false, true]) {
    for (const name of profilePaths) {
      const failed = fixture(windows, profilePaths), failure = new Error('Synthetic setPath failure');
      failed.setErrors[name] = failure;
      assert.throws(() => failed.bindDemoProfile(failed.app, { CHAUSAR_DEMO_PROFILE_ROOT: failed.root }), (error: unknown) => error === failure);
      assert.deepEqual(failed.reads, [failed.temporary]);
      assert.equal(failed.bindings[name], failed.previous);
      const unretained = fixture(windows);
      unretained.unretained.add(name);
      assert.throws(() => unretained.bindDemoProfile(unretained.app, { CHAUSAR_DEMO_PROFILE_ROOT: unretained.root }), /retain/);
      assert.deepEqual(unretained.reads, [unretained.temporary]);
      assert.equal(unretained.bindings[name], unretained.previous);
    }
  }
});

test('a missing path after successful binding remains a fatal profile assertion', () => {
  for (const windows of [false, true]) {
    for (const name of profilePaths) {
      const f = fixture(windows, profilePaths), profile = f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root });
      const failure = new Error(`Failed to get '${name}' path`);
      f.getErrors[name] = failure;
      assert.throws(() => f.assertDemoProfile(f.app, profile), (error: unknown) => error === failure);
      assert.deepEqual(f.reads, [f.temporary]);
    }
  }
});

test('invalid paths after successful binding cannot resolve into a usable profile', () => {
  for (const windows of [false, true]) {
    for (const name of profilePaths) {
      for (const invalid of [undefined, '', 'relative', '/invalid\0', '/invalid\r', '/invalid\n']) {
        const f = fixture(windows, profilePaths), profile = f.bindDemoProfile(f.app, { CHAUSAR_DEMO_PROFILE_ROOT: f.root });
        f.bindings[name] = invalid;
        assert.throws(() => f.assertDemoProfile(f.app, profile), /retain/);
        assert.deepEqual(f.reads, [f.temporary]);
      }
    }
  }
});
