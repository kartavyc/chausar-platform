// D7 task 5: only the packaged app runs the bundle. Desktop main takes every engine path from one helper, and nothing else
// under app/desktop reaches into the engine's source, but the one credential contract the package keeps in its archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(new URL('../../app/desktop/main.cjs', import.meta.url));
const norm = (path: string) => path.split('\\').join('/');

test('packaged: the worker, the extract worker and the project folder are the bundle, under app.asar.unpacked', () => {
  const { enginePaths } = require('./engine-paths.cjs');
  const paths = enginePaths({ packaged: true, resourcesPath: '/owned/resources', root: '/owned/app' });
  assert.equal(norm(paths.runtimeRoot).endsWith('/owned/resources/app.asar.unpacked/app/engine/dist/runtime'), true);
  assert.equal(norm(paths.worker).endsWith('app.asar.unpacked/app/engine/dist/runtime/worker.js'), true);
  assert.equal(norm(paths.extractWorker).endsWith('app.asar.unpacked/app/engine/dist/runtime/venture/network/extract-worker.js'), true);
  assert.equal(norm(paths.projectFolder).endsWith('app.asar.unpacked/app/engine/dist/runtime/venture/playbooks/youtube/project-folder.js'), true);
});

test('not packaged: the same names are the source', () => {
  const { enginePaths } = require('./engine-paths.cjs');
  const paths = enginePaths({ packaged: false, resourcesPath: '/owned/resources', root: '/owned/app' });
  assert.equal(norm(paths.runtimeRoot).endsWith('/owned/app/platform/runtime'), true);
  assert.equal(norm(paths.worker).endsWith('platform/runtime/worker.ts'), true);
  assert.equal(norm(paths.extractWorker).endsWith('platform/runtime/venture/network/extract-worker.ts'), true);
  assert.equal(norm(paths.projectFolder).endsWith('platform/runtime/venture/playbooks/youtube/project-folder.ts'), true);
});

test('the bundle lists every program desktop main starts or imports', async () => {
  const bundleScript = '../../scripts/bundle-engine.mjs';
  const { ENGINE_ENTRIES } = await import(bundleScript);
  for (const name of ['worker', 'venture/network/extract-worker', 'venture/playbooks/youtube/project-folder']) assert.ok(ENGINE_ENTRIES.includes(name), name);
});

test('the network worker may read the bundle\'s runtime folder when it is told one, never three levels up from the worker', async () => {
  const files = require('./network-files.cjs');
  const flags = files.workerFlags({ workerPath: '/owned/resources/app.asar.unpacked/app/engine/dist/runtime/venture/network/extract-worker.js', runtimeRoot: '/owned/resources/app.asar.unpacked/app/engine/dist/runtime', nodeFlags: new Set(['--permission']) }, '/picked/file.mbox');
  assert.deepEqual(flags, ['--experimental-strip-types', '--permission', '--allow-fs-read=/owned/resources/app.asar.unpacked/app/engine/dist/runtime', '--allow-fs-read=/picked/file.mbox']);
});

for (const [name, make, action] of [['YouTube', 'createYoutubeProject', 'youtube'], ['social', 'createSocialProject', 'social']]) {
  test(`the ${name} project saves through the project folder module it was given`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'chausar-project-folder-'));
    try {
      const marker = join(folder, 'project-folder.mjs');
      await writeFile(marker, `export async function writeProjectFolder() { throw Object.assign(new Error('given module'), { code: 'GIVEN_MODULE' }); }\n`);
      const created = require(`./${action === 'youtube' ? 'youtube' : 'social'}-project.cjs`)[make]({ projectFolder: marker });
      const contents = {};
      const answer = action === 'youtube'
        ? { editId: 'e1', digest: 'd', orderId: 'order1', files: [{ path: 'edl/cut.edl', text: 'a' }], manifest: { files: [{ path: 'edl/cut.edl', bytes: 1, sha256: (await import('node:crypto')).createHash('sha256').update('a').digest('hex') }] } }
        : { posted: false, video: { kind: 'client', id: join(folder, 'video.mp4'), digest: '' }, files: [{ name: 'instagram.txt', text: 'x' }] };
      if (action === 'social') {
        await writeFile(join(folder, 'video.mp4'), 'video');
        (answer as any).video.digest = (await import('node:crypto')).createHash('sha256').update('video').digest('hex');
      }
      const reply = await created.save({ sender: contents }, action === 'youtube' ? { editId: 'e1', digest: 'd' } : { orderId: 'order1', digest: 'd' }, {
        assertTrustedSender() {}, publicError: (error: any) => ({ code: error.code, message: error.message }), window: { webContents: contents }, documents: folder,
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [folder] }) }, shell: {}, engine: { request: async () => ({ result: answer }) },
      });
      assert.deepEqual([reply.ok, reply.error?.code], [false, 'GIVEN_MODULE'], JSON.stringify(reply));
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
}

test('nothing under app/desktop reaches into the engine source but the credential contract', async () => {
  const folder = new URL('../../app/desktop/', import.meta.url);
  for (const name of (await readdir(folder)).filter(file => file.endsWith('.cjs'))) {
    const text = await readFile(new URL(name, folder), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*')) continue;
      const reaches = (code.includes('require(') || code.includes('import(')) && code.includes('platform/runtime');
      if (reaches) assert.ok(code.includes('platform/runtime/venture/models/credential-contract.cjs'), name + ': ' + code.slice(0, 120));
    }
    if (name === 'main.cjs') assert.equal(text.includes("join(engineRoot, 'platform/runtime"), false);
  }
});
