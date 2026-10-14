import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExpiry, readBuildMetadata } from '../runtime/native/update-expiry.ts';

const code = (expected:string) => (error:any) => error.code === expected;
const EXPIRY = '2026-11-01T00:00:00.000Z', at = Date.parse(EXPIRY);

test('a preview build is usable until its expiry and refuses PREVIEW_EXPIRED from that instant, with no grace', () => {
  const build = buildExpiry({ channel: 'preview', builtAt: '2026-10-01T00:00:00.000Z', previewExpiresAt: EXPIRY });
  build.assertBuildUsable(at - 1);
  assert.equal(build.status(at - 1).updateNeeded, false);
  assert.throws(() => build.assertBuildUsable(at), code('PREVIEW_EXPIRED'));
  assert.deepEqual(build.status(at + 1), { channel: 'preview', expiresAt: EXPIRY, usable: false, updateNeeded: true, msRemaining: 0 });
});

test('stable builds never expire; inconsistent expiry metadata refuses', () => {
  const stable = buildExpiry({ channel: 'stable', builtAt: null, previewExpiresAt: null });
  stable.assertBuildUsable(Date.parse('2099-01-01T00:00:00.000Z'));
  assert.equal(stable.status().expiresAt, null);
  assert.throws(() => buildExpiry({ channel: 'stable', previewExpiresAt: EXPIRY }), code('BUILD_METADATA_INVALID'));
  assert.throws(() => buildExpiry({ channel: 'preview', previewExpiresAt: null }), code('BUILD_METADATA_INVALID'));
  assert.throws(() => buildExpiry({ channel: 'preview', previewExpiresAt: '1 November 2026' }), code('BUILD_METADATA_INVALID'));
  assert.throws(() => buildExpiry({ channel: 'preview', builtAt: '2026-12-01T00:00:00.000Z', previewExpiresAt: EXPIRY }), code('BUILD_METADATA_INVALID'));
  assert.throws(() => buildExpiry({ channel: 'nightly' as any }), code('BUILD_METADATA_INVALID'));
});

test('build metadata is read from package.json fields; absent is stable, invalid refuses', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-expiry-')); t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (value:unknown) => { const path = join(root, `package-${Math.random().toString(36).slice(2)}.json`); await writeFile(path, JSON.stringify(value)); return path; };
  assert.deepEqual(await readBuildMetadata(await write({ name: 'chausar-desktop', version: '0.1.0' })), { channel: 'stable', previewExpiresAt: null });
  assert.deepEqual(await readBuildMetadata(await write({ chausarReleaseChannel: 'preview', chausarPreviewExpiresAt: EXPIRY })), { channel: 'preview', previewExpiresAt: EXPIRY });
  assert.deepEqual(await readBuildMetadata(await write({ chausarReleaseChannel: 'stable' })), { channel: 'stable', previewExpiresAt: null });
  for (const invalid of [{ chausarReleaseChannel: 'preview' }, { chausarPreviewExpiresAt: EXPIRY }, { chausarReleaseChannel: 'beta' }, { chausarReleaseChannel: 'preview', chausarPreviewExpiresAt: 'soon' }, { chausarReleaseChannel: 'stable', chausarPreviewExpiresAt: EXPIRY }])
    await assert.rejects(readBuildMetadata(await write(invalid)), code('BUILD_METADATA_INVALID'));
  const broken = join(root, 'broken.json'); await writeFile(broken, '{not json');
  await assert.rejects(readBuildMetadata(broken), code('BUILD_METADATA_INVALID'));
  await assert.rejects(readBuildMetadata('package.json'), code('BUILD_METADATA_INVALID'));
});
