import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { downloadArchive, inventoryRuntime, loadRuntimeSources, parseStageArguments, stageRuntime, assertOutputAllowed, type Fetcher, type RuntimeSources } from '../../scripts/release/stage-runtime.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const PG_ROOT = 'postgresql-17.6.0-x86_64-unknown-linux-gnu';

async function file(path: string, content: string | Buffer, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, mode);
}
function tarGz(archive: string, cwd: string, entry: string, extra: string[] = []) {
  const result = spawnSync('tar', ['-czf', archive, ...extra, '-C', cwd, entry]);
  assert.equal(result.status, 0, result.stderr?.toString());
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Synthetic archives shaped like the recorded vendors' layouts, with fake (non-native) binaries. */
async function fixture(t: TestContext, options: { pgSymlinks?: boolean; escapingLink?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const trees = join(root, 'trees');
  const pg = join(trees, PG_ROOT);
  for (const name of ['postgres', 'initdb', 'pg_ctl', 'pg_upgrade']) await file(join(pg, 'bin', name), `\x7fELF fake ${name}\n`, 0o755);
  await file(join(pg, 'lib', 'libpq.so.5.17'), 'fake library');
  await symlink('libpq.so.5.17', join(pg, 'lib', 'libpq.so.5'));
  await file(join(pg, 'share', 'postgres.bki'), 'catalog');
  await file(join(pg, 'include', 'libpq-fe.h'), 'excluded header');
  await file(join(pg, 'COPYRIGHT'), 'PostgreSQL Database Management System license');
  const py = join(trees, 'python');
  await file(join(py, 'bin', 'python3.13'), 'fake interpreter', 0o755);
  await symlink('python3.13', join(py, 'bin', 'python3'));
  await file(join(py, 'lib', 'python3.13', 'LICENSE.txt'), 'PSF license');
  await file(join(py, 'lib', 'python3.13', 'os.py'), '# stdlib');
  if (options.escapingLink) await symlink('/etc/hostname', join(py, 'bin', 'escape'));
  const archives = join(root, 'archives');
  await mkdir(archives);
  tarGz(join(archives, 'pg.tar.gz'), trees, PG_ROOT);
  tarGz(join(archives, 'py.tar.gz'), trees, 'python');
  const bytes = { 'https://vendor.test/pg.tar.gz': await readFile(join(archives, 'pg.tar.gz')), 'https://vendor.test/py.tar.gz': await readFile(join(archives, 'py.tar.gz')) } as Record<string, Buffer>;
  const sources: RuntimeSources = {
    schemaVersion: 1,
    targets: {
      'linux-x64': [
        { component: 'postgres', version: '17.6', vendor: 'synthetic', url: 'https://vendor.test/pg.tar.gz', sha256: sha(bytes['https://vendor.test/pg.tar.gz']), license: 'PostgreSQL', licenseFile: 'postgres/COPYRIGHT', official: false, layout: { archive: 'tar.gz', strip: PG_ROOT, into: 'postgres', include: ['bin', 'lib', 'share', 'COPYRIGHT'], materialiseSymlinks: options.pgSymlinks ?? true } },
        { component: 'python', version: '3.13.7', vendor: 'synthetic', url: 'https://vendor.test/py.tar.gz', sha256: sha(bytes['https://vendor.test/py.tar.gz']), license: 'PSF-2.0', licenseFile: 'python/lib/python3.13/LICENSE.txt', official: false, layout: { archive: 'tar.gz', strip: 'python', into: 'python', materialiseSymlinks: true } },
      ],
    },
  };
  const fetched: string[] = [];
  const fetcher: Fetcher = async url => { fetched.push(url); const body = bytes[url]; return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 }); };
  const project = join(root, 'project');
  const out = join(project, 'runtime-binaries');
  await file(join(out, 'README.md'), '# Vendored native runtimes\n');
  return { root, project, out, sources, fetcher, fetched };
}

test('stages pinned archives into the README layout and writes a manifest the preflight accepts', async t => {
  const { project, out, sources, fetcher, fetched } = await fixture(t);
  const manifest = await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher });
  assert.deepEqual(fetched, ['https://vendor.test/pg.tar.gz', 'https://vendor.test/py.tar.gz']);
  assert.deepEqual(Object.keys(manifest).sort(), ['architecture', 'components', 'files', 'platform', 'schemaVersion']);
  assert.deepEqual(manifest.components.postgres, { version: '17.6', source: 'https://vendor.test/pg.tar.gz', license: 'PostgreSQL', licenseFile: 'postgres/COPYRIGHT' });
  const paths = manifest.files.map(entry => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  for (const path of ['README.md', 'postgres/bin/postgres', 'postgres/lib/libpq.so.5', 'postgres/COPYRIGHT', 'python/bin/python3', 'python/lib/python3.13/LICENSE.txt']) assert.ok(paths.includes(path), path);
  assert.ok(!paths.some(path => path.startsWith('postgres/include')), 'excluded folders are not staged');
  assert.ok(!paths.includes('manifest.json'));
  const interpreter = await lstat(join(out, 'python', 'bin', 'python3'));
  assert.ok(interpreter.isFile() && !interpreter.isSymbolicLink(), 'the symlinked interpreter is materialised as a regular file');
  assert.ok(interpreter.mode & 0o100, 'executable permission is kept');
  assert.equal(await readFile(join(out, 'python', 'bin', 'python3'), 'utf8'), 'fake interpreter');
  assert.deepEqual((await readdir(out)).sort(), ['README.md', 'manifest.json', 'postgres', 'python'], 'no staging leftovers');
  const written = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(written, manifest);
  const entry = manifest.files.find(item => item.path === 'postgres/COPYRIGHT');
  assert.equal(entry?.sha256, sha(Buffer.from('PostgreSQL Database Management System license')));

  const { packagePreflight } = await import(pathToFileURL(join(repoRoot, 'scripts', 'package-preflight.mjs')).href);
  const manifestCheck = 'complete runtime integrity and provenance manifest';
  const result = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(result.checks.includes(manifestCheck), JSON.stringify(result.failures));
  await writeFile(join(out, 'python', 'lib', 'python3.13', 'os.py'), '# changed');
  const tampered = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(tampered.failures.some((failure: { check: string }) => failure.check === manifestCheck), 'the preflight sees changed bytes');
  await inventoryRuntime({ platform: 'linux', architecture: 'x64', out, sources });
  const reinventoried = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(reinventoried.checks.includes(manifestCheck), 'inventory-only rewrites the manifest for an assembled folder');

  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher }), code('RUNTIME_OUTPUT_EXISTS'));
  await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher, replace: true });
});

test('null pins and missing upstreams refuse before any download', async t => {
  const { out, sources, fetcher, fetched } = await fixture(t);
  const unpinned = structuredClone(sources);
  unpinned.targets['linux-x64'][1].sha256 = null;
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: unpinned, fetch: fetcher }), code('RUNTIME_SOURCE_UNPINNED'));
  const unavailable = structuredClone(sources);
  unavailable.targets['linux-x64'][0].url = null;
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: unavailable, fetch: fetcher }), code('RUNTIME_SOURCE_UNAVAILABLE'));
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'arm64', out, sources, fetch: fetcher }), code('RUNTIME_SOURCE_UNAVAILABLE'));
  await assert.rejects(stageRuntime({ platform: 'freebsd', architecture: 'x64', out, sources, fetch: fetcher }), code('RUNTIME_TARGET_INVALID'));
  assert.deepEqual(fetched, []);
});

test('a hash mismatch refuses and leaves nothing staged', async t => {
  const { out, sources, fetcher } = await fixture(t);
  const wrong = structuredClone(sources);
  wrong.targets['linux-x64'][1].sha256 = 'f'.repeat(64);
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: wrong, fetch: fetcher }), code('RUNTIME_HASH_MISMATCH'));
  assert.deepEqual(await readdir(out), ['README.md']);
});

test('symbolic links refuse unless the layout materialises them, and never escape the component', async t => {
  const strict = await fixture(t, { pgSymlinks: false });
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: strict.out, sources: strict.sources, fetch: strict.fetcher }), code('RUNTIME_SYMLINK_REFUSED'));
  assert.deepEqual(await readdir(strict.out), ['README.md']);
  const escaping = await fixture(t, { escapingLink: true });
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: escaping.out, sources: escaping.sources, fetch: escaping.fetcher }), code('RUNTIME_SYMLINK_REFUSED'));
  const staged = await fixture(t);
  await stageRuntime({ platform: 'linux', architecture: 'x64', out: staged.out, sources: staged.sources, fetch: staged.fetcher });
  await symlink('/etc', join(staged.out, 'python', 'linked'));
  await assert.rejects(inventoryRuntime({ platform: 'linux', architecture: 'x64', out: staged.out, sources: staged.sources }), code('RUNTIME_SYMLINK_REFUSED'));
});

test('archives with parent traversal refuse', async t => {
  const { root, out, sources } = await fixture(t);
  await file(join(root, 'evil', 'inner', 'x'), 'x');
  const archive = join(root, 'evil.tar.gz');
  const made = spawnSync('tar', ['-czf', archive, '-P', '-C', join(root, 'evil', 'inner'), '../inner/x']);
  assert.equal(made.status, 0, made.stderr?.toString());
  const bytes = await readFile(archive);
  const evil = structuredClone(sources);
  evil.targets['linux-x64'][0] = { ...evil.targets['linux-x64'][0], url: 'https://vendor.test/evil.tar.gz', sha256: sha(bytes) };
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: evil, fetch: async () => new Response(new Uint8Array(bytes)) }), code('RUNTIME_ARCHIVE_UNSAFE'));
});

test('downloads are HTTPS only and size bounded', async t => {
  const { root } = await fixture(t);
  const ok: Fetcher = async () => new Response(new Uint8Array(4096));
  await assert.rejects(downloadArchive('http://vendor.test/a.zip', join(root, 'a'), { fetch: ok }), code('RUNTIME_SOURCE_INSECURE'));
  await assert.rejects(downloadArchive('https://vendor.test/a.zip', join(root, 'b'), { fetch: ok, maxBytes: 1000 }), code('RUNTIME_DOWNLOAD_TOO_LARGE'));
  await assert.rejects(lstat(join(root, 'b')), 'a partial download is removed');
  await assert.rejects(downloadArchive('https://vendor.test/a.zip', join(root, 'c'), { fetch: async () => new Response('no', { status: 500 }) }), code('RUNTIME_DOWNLOAD_FAILED'));
  assert.equal(await downloadArchive('https://vendor.test/a.zip', join(root, 'd'), { fetch: ok }), sha(Buffer.alloc(4096)));
});

test('the recorded pins are valid, honest and all await the operator', async () => {
  const sources = await loadRuntimeSources();
  assert.deepEqual(Object.keys(sources.targets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
  for (const entries of Object.values(sources.targets)) {
    for (const entry of entries) {
      assert.equal(entry.sha256, null);
      if (entry.url === null || !entry.official) assert.ok(entry.note, `${entry.component} needs a note`);
    }
  }
  const fetcher: Fetcher = async () => assert.fail('no download may start');
  const out = join(tmpdir(), 'chausar-unused-runtime');
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, fetch: fetcher }), code('RUNTIME_SOURCE_UNPINNED'));
  await assert.rejects(stageRuntime({ platform: 'win32', architecture: 'arm64', out, fetch: fetcher }), code('RUNTIME_SOURCE_UNAVAILABLE'));
});

test('staging refuses tracked repository paths and parses its command line', async () => {
  await assert.rejects(assertOutputAllowed(join(repoRoot, 'platform'), repoRoot), code('RUNTIME_OUTPUT_TRACKED'));
  await assertOutputAllowed(join(repoRoot, 'runtime-binaries'), repoRoot);
  await assertOutputAllowed(join(tmpdir(), 'elsewhere'), repoRoot);
  const parsed = parseStageArguments(['--platform', 'win32', '--arch', 'x64', '--out', 'runtime-binaries', '--inventory-only'], {});
  assert.equal(parsed.platform, 'win32');
  assert.equal(parsed.inventoryOnly, true);
  assert.equal(parsed.out, resolve('runtime-binaries'));
  assert.throws(() => parseStageArguments(['--platform', 'win32'], {}), code('RUNTIME_USAGE'));
  assert.throws(() => parseStageArguments(['--bogus', 'x'], {}), code('RUNTIME_USAGE'));
});

test('a signing hook runs on native runtime files before hashing; keychain/ is inventoried but not re-signed', async t => {
  const { root, project, out, sources, fetcher } = await fixture(t);
  const log = join(root, 'signed.log');
  const signer = join(root, 'sign.mjs');
  await file(signer, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], 'SIGNED');\nappendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');\n`, 0o755);
  const notes: string[] = [];
  await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher, signCommand: signer, onNote: text => notes.push(text) });
  const signedPaths = (await readFile(log, 'utf8')).trim().split('\n').map(path => path.slice(out.length + 1)).sort();
  assert.deepEqual(signedPaths, ['postgres/bin/initdb', 'postgres/bin/pg_ctl', 'postgres/bin/pg_upgrade', 'postgres/bin/postgres']);
  assert.match(notes.join('\n'), /Signed 4 native runtime files/);
  await file(join(out, 'keychain', 'chausar-keychain'), '\x7fELF helper', 0o755);
  await file(join(out, 'keychain', 'manifest.json'), '{"format":"chausar.keychain-helper.v1"}');
  await rm(log);
  const manifest = await inventoryRuntime({ platform: 'linux', architecture: 'x64', out, sources, signCommand: signer });
  const paths = manifest.files.map(entry => entry.path);
  assert.ok(paths.includes('keychain/chausar-keychain') && paths.includes('keychain/manifest.json'));
  assert.ok(!(await readFile(log, 'utf8')).includes('keychain'), 'the keychain helper keeps its own signed bytes');
  const postgres = manifest.files.find(entry => entry.path === 'postgres/bin/postgres');
  assert.equal(postgres?.sha256, sha(await readFile(join(out, 'postgres', 'bin', 'postgres'))), 'hashes cover the signed bytes');
  const { packagePreflight } = await import(pathToFileURL(join(repoRoot, 'scripts', 'package-preflight.mjs')).href);
  const result = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(result.checks.includes('complete runtime integrity and provenance manifest'), JSON.stringify(result.failures));
  await assert.rejects(inventoryRuntime({ platform: 'linux', architecture: 'x64', out, sources, signCommand: join(root, 'absent') }), code('RUNTIME_SIGN_COMMAND_INVALID'));
  const failing = join(root, 'fail.mjs');
  await file(failing, `#!${process.execPath}\nprocess.exit(2);\n`, 0o755);
  await assert.rejects(inventoryRuntime({ platform: 'linux', architecture: 'x64', out, sources, signCommand: failing }), code('RUNTIME_SIGN_FAILED'));
  assert.equal(parseStageArguments(['--platform', 'linux', '--arch', 'x64', '--out', out], { CHAUSAR_RUNTIME_SIGN_COMMAND: signer }).signCommand, signer);
  assert.equal(parseStageArguments(['--platform', 'linux', '--arch', 'x64', '--out', out], {}).signCommand, null);
  assert.throws(() => parseStageArguments(['--platform', 'linux', '--arch', 'x64', '--out', out, '--sign-command', 'relative'], {}), code('RUNTIME_USAGE'));
});
