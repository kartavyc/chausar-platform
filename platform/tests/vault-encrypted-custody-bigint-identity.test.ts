import test, {mock, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {mkdtemp, realpath, readFile, writeFile, lstat, open, rm, type FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, isAbsolute} from 'node:path';
import {Vault} from '../runtime/vault.ts';

// Only inode metadata is projected. Genuine files, encryption, sizes, timestamps,
// reads, snapshot fencing and the production bounded reader remain real.
// This controlled mechanism does not identify either historical failure's cause.
// Hooks use the top-level mock tracker and are restored here in reverse order. A test's own
// t.mock would restore them again at test end in creation order, reinstalling the outer stat
// hook for the next test, which then misreads any reused inode number.
type Identity = {ino: number | bigint; dev: number | bigint};
type Role = 'target' | 'distractor';
const same = (left: Identity, right: Identity) => left.ino === right.ino && left.dev === right.dev;
const legacy = (left: Identity, right: Identity) =>
  String(left.ino) === String(right.ino) && String(left.dev) === String(right.dev);
async function fixture(t: TestContext) {
  const root = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(root, /^C:[\\/]/i);
  const directory = await mkdtemp(join(root, 'chausar-bigint-growth-'));
  let vault: Vault | undefined;
  t.after(async () => {
    await vault?.close();
    const target = await realpath(directory), child = relative(root, target);
    assert.ok(child && child.startsWith('chausar-bigint-growth-') && !child.startsWith('..') && !isAbsolute(child));
    await rm(target, {recursive: true, force: true});
  });
  ({vault} = await Vault.create({directory, name: 'Synthetic inode collision control',
    demo: true, storage: 'experimental-file', passphrase: 'Synthetic growth control only'}));
  return {vault, directory};
}
for (const mode of ['safe', 'unsafe-collision'] as const) {
  test('exact BigInt artifact identity retains actual capture growth and distinguishes a rounded neighboring inode: ' + mode, async t => {
    const {vault, directory} = await fixture(t);
    for (const id of ['a_distractor', 'z_target'])
      await vault.writeArtifact({id, purpose: 'workspace-interchange', value: {synthetic: true, role: id}, expectedDigest: null});
    const files = {target: join(directory, 'private-artifacts', 'workspace-interchange', 'z_target.encrypted.json'),
      distractor: join(directory, 'private-artifacts', 'workspace-interchange', 'a_distractor.encrypted.json')};
    const original = {target: await readFile(files.target), distractor: await readFile(files.distractor)};
    const sample = await open(files.target, 'r'), prototype = Object.getPrototypeOf(sample) as FileHandle;
    const nativeStat = prototype.stat, nativeReadFile = prototype.readFile;
    const raw = await (async () => {
      try {return {target: await nativeStat.call(sample, {bigint: true}), distractor: await lstat(files.distractor, {bigint: true})};}
      finally {await sample.close();}
    })();
    assert.notEqual(raw.target.ino, raw.distractor.ino);
    assert.equal(raw.target.dev, raw.distractor.dev);
    const projected = mode === 'unsafe-collision'
      ? {target: (1n << 53n) + 1n, distractor: 1n << 53n}
      : {target: 43n, distractor: 42n};
    const roleOf = (value: Identity): Role | undefined =>
      same(value, raw.target) ? 'target' : same(value, raw.distractor) ? 'distractor' : undefined;
    const project = (value: any, role: Role) => {
      Object.defineProperty(value, 'ino', {...Object.getOwnPropertyDescriptor(value, 'ino'),
        value: typeof value.ino === 'bigint' ? projected[role] : Number(projected[role])});
      return value;
    };
    const fs = createRequire(import.meta.url)('node:fs/promises') as typeof import('node:fs/promises');
    const nativeLstat = fs.lstat;
    const metadataHook = mock.method(prototype, 'stat', async function(this: FileHandle, ...args: Parameters<FileHandle['stat']>) {
      const value = await Reflect.apply(nativeStat, this, args);
      const exact = typeof value.ino === 'bigint' ? value : await nativeStat.call(this, {bigint: true});
      const role = roleOf(exact);
      return role ? project(value, role) : value;
    });
    const pathHook = mock.method(fs, 'lstat', async function(...args: Parameters<typeof lstat>) {
      const value = await Reflect.apply(nativeLstat, fs, args);
      const role = String(args[0]) === files.target ? 'target' : String(args[0]) === files.distractor ? 'distractor' : undefined;
      if (!role) return value;
      const exact = typeof value.ino === 'bigint' ? value : await nativeLstat.call(fs, files[role], {bigint: true});
      assert.ok(same(exact, raw[role]));
      return project(value, role);
    });
    syncBuiltinESMExports();
    try {
      const targetHandle = await open(files.target, 'r');
      let targetStat: Awaited<ReturnType<FileHandle['stat']>>;
      try {targetStat = await targetHandle.stat({bigint: true});} finally {await targetHandle.close();}
      assert.equal(typeof targetStat.ino, 'bigint');
      const numericTarget = {ino: Number(projected.target), dev: Number(raw.target.dev)};
      const exactTarget = {ino: projected.target, dev: raw.target.dev};
      const exactDistractor = {ino: projected.distractor, dev: raw.distractor.dev};
      if (mode === 'unsafe-collision') {
        assert.notEqual(projected.target, projected.distractor);
        assert.equal(Number(projected.target), Number(projected.distractor));
        assert.equal(Number.isSafeInteger(numericTarget.ino), false);
        assert.equal(legacy(exactTarget, numericTarget), false);
        assert.equal(legacy(exactDistractor, numericTarget), true);
      } else {
        assert.equal(Number.isSafeInteger(numericTarget.ino), true);
        assert.equal(legacy(exactTarget, numericTarget), true);
        assert.equal(legacy(exactDistractor, numericTarget), false);
      }
      const identifies = (value: Identity) => value.ino === targetStat.ino && value.dev === targetStat.dev;
      assert.equal(identifies(exactDistractor), false);
      const metadataStat = prototype.stat;
      const observed = {target: 0, distractor: 0}, selected = {target: 0, distractor: 0};
      let grew = false, grownBy: Role | undefined, oversizedWholeFileReads = 0;
      const growthHook = mock.method(prototype, 'stat', async function(this: FileHandle, ...args: Parameters<FileHandle['stat']>) {
        const value = await Reflect.apply(metadataStat, this, args);
        const role = roleOf(await nativeStat.call(this, {bigint: true}));
        if (role) {
          observed[role]++;
          if (identifies(value)) {
            selected[role]++;
            if (!grew) {
              grew = true; grownBy = role;
              await writeFile(files.target, Buffer.concat([original.target, Buffer.alloc(64 * 1024, 0x20)]));
            }
          }
        }
        return value;
      });
      const readHook = mock.method(prototype, 'readFile', async function(this: FileHandle, ...args: Parameters<FileHandle['readFile']>) {
        const value = await metadataStat.call(this, {bigint: true});
        if (identifies(value) && value.size > original.target.length) oversizedWholeFileReads++;
        return Reflect.apply(nativeReadFile, this, args);
      });
      try {
        const authorityBytes = (await lstat(join(directory, 'authority.encrypted.json'))).size;
        const before = vault.read();
        const limits = {maxEntryBytes: Math.max(authorityBytes, original.target.length, original.distractor.length),
          maxTotalEntryBytes: authorityBytes + original.target.length + original.distractor.length, maxArtifacts: 2};
        await assert.rejects(vault.snapshot(() => vault.captureEncryptedCustody(limits)), {code: 'ARTIFACT_LIMIT'});
        assert.equal(grew, true, 'Mutate the real opened inode after its descriptor size measurement, without a timing race.');
        assert.equal(oversizedWholeFileReads, 0, 'A grown artifact must not trigger an unbounded whole-file allocation.');
        assert.equal((await lstat(files.target)).size, original.target.length + 64 * 1024, 'Failed capture preserves the real growth evidence.');
        assert.equal(grownBy, 'target');
        assert.equal(selected.target, 1);
        assert.equal(selected.distractor, 0);
        assert.ok(observed.target >= 1 && observed.distractor >= 1, 'The actual capture must encounter both genuine descriptors.');
        assert.deepEqual(await readFile(files.distractor), original.distractor);
        assert.deepEqual(vault.read(), before);
        t.diagnostic(JSON.stringify({mode, rawTarget: {ino: String(raw.target.ino), dev: String(raw.target.dev)},
          rawDistractor: {ino: String(raw.distractor.ino), dev: String(raw.distractor.dev)},
          projectedTarget: String(projected.target), projectedDistractor: String(projected.distractor),
          grew, grownBy, growthBytes: 65536, oversizedWholeFileReads, observed, selected, historicalCauseConfirmed: false}));
      } finally {readHook.mock.restore(); growthHook.mock.restore();}
    } finally {pathHook.mock.restore(); metadataHook.mock.restore(); syncBuiltinESMExports();}
    assert.equal(prototype.stat, nativeStat, 'No stat hook outlives this test.');
    assert.equal(fs.lstat, nativeLstat, 'No lstat hook outlives this test.');
  });
}
