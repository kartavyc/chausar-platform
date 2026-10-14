import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseModuleOptions } from '../runtime/native/release-options.ts';

async function packageFile(t: any, value: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-release-options-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'package.json'); await writeFile(path, JSON.stringify({ name: 'x', version: '0.1.0', ...value })); return path;
}

test('the repository package is a stable source build and reads no release key by default', async () => {
  const options = await releaseModuleOptions({});
  assert.deepEqual(options, { channel: 'stable', previewExpiresAt: null });
});

test('the unsigned preview package maps to the preview channel with its stamped expiry', async t => {
  const path = await packageFile(t, { chausarReleaseChannel: 'unsigned-preview', chausarPreviewExpiresAt: '2027-01-12T00:00:00.000Z' });
  const resources = process.platform === 'win32' ? 'C:\\Chausar\\resources' : '/opt/Chausar/resources';
  const options = await releaseModuleOptions({ CHAUSAR_KEYCHAIN_MANIFEST: join(resources, 'runtime-binaries', 'keychain', 'manifest.json'), CHAUSAR_UPDATE_PUBLIC_KEY: 'pem', CHAUSAR_UPDATE_FEED_URL: 'https://updates.example.com/preview/feed.json' }, path);
  assert.deepEqual(options, { channel: 'preview', previewExpiresAt: '2027-01-12T00:00:00.000Z', releasePublicKey: 'pem', feedUrl: 'https://updates.example.com/preview/feed.json', resourcesPath: resources });
});

test('unknown channels and relative paths refuse', async t => {
  const nightly = await packageFile(t, { chausarReleaseChannel: 'nightly' });
  assert.throws(() => releaseModuleOptions({}, nightly), (error: any) => error.code === 'RELEASE_OPTIONS_INVALID');
  assert.throws(() => releaseModuleOptions({ CHAUSAR_APP_EXECUTABLE: 'chausar' }), (error: any) => error.code === 'RELEASE_OPTIONS_INVALID');
});
