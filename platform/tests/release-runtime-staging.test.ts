import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { downloadArchive, inventoryRuntime, loadRuntimeSources, parseStageArguments, stageRuntime, assertOutputAllowed, validateRuntimeSources, type Fetcher, type RuntimeSources } from '../../scripts/release/stage-runtime.ts';
import { arMembers, readElf, type LinuxLibraries } from '../../scripts/release/linux-libraries.ts';
import { zstdCompressSync } from 'node:zlib';

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
  await symlink('python3.13', join(py, 'bin', 'python'));
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
        { component: 'postgres', version: '17.6', vendor: 'synthetic', url: 'https://vendor.test/pg.tar.gz', sha256: sha(bytes['https://vendor.test/pg.tar.gz']), checksumSource: 'synthetic test archive', license: 'PostgreSQL', licenseFile: 'postgres/COPYRIGHT', official: false, layout: { archive: 'tar.gz', strip: PG_ROOT, into: 'postgres', include: ['bin', 'lib', 'share', 'COPYRIGHT'], materialiseSymlinks: options.pgSymlinks ?? true } },
        { component: 'python', version: '3.13.7', vendor: 'synthetic', url: 'https://vendor.test/py.tar.gz', sha256: sha(bytes['https://vendor.test/py.tar.gz']), checksumSource: 'synthetic test archive', license: 'PSF-2.0', licenseFile: 'python/lib/python3.13/LICENSE.txt', official: false, layout: { archive: 'tar.gz', strip: 'python', into: 'python', exclude: ['bin/python'], materialiseSymlinks: true } },
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
  assert.ok(!paths.includes('python/bin/python'), 'an excluded duplicate link is not materialised');
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
  delete unpinned.targets['linux-x64'][1].checksumSource;
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
  evil.targets['linux-x64'][0] = { ...evil.targets['linux-x64'][0], url: 'https://vendor.test/evil.tar.gz', sha256: sha(bytes), checksumSource: 'synthetic test archive' };
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

test('the recorded pins are valid and honest: each pin says how it was verified, and only gaps stay null', async () => {
  const sources = await loadRuntimeSources();
  assert.deepEqual(Object.keys(sources.targets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
  const pinned = Object.fromEntries(Object.entries(sources.targets).map(([target, entries]) => [target, entries.map(entry => `${entry.component}:${entry.sha256 ? 'pinned' : 'null'}`)]));
  assert.deepEqual(pinned, {
    'win32-x64': ['postgres:pinned', 'python:pinned'], 'win32-arm64': ['postgres:null', 'python:pinned'],
    'darwin-x64': ['postgres:pinned', 'python:pinned'], 'darwin-arm64': ['postgres:pinned', 'python:pinned'],
    'linux-x64': ['postgres:pinned', 'python:pinned', 'postgres-16:pinned'], 'linux-arm64': ['postgres:null', 'python:null'],
  });
  for (const entries of Object.values(sources.targets)) {
    for (const entry of entries) {
      if (entry.url === null || !entry.official) assert.ok(entry.note, `${entry.component} needs a note`);
      if (!entry.sha256) continue;
      const how = entry.checksumSource ?? '';
      if (entry.url?.startsWith('https://get.enterprisedb.com/')) assert.match(how, /^computed-only: EnterpriseDB publishes no checksum/, 'EDB publishes no checksum, and says so');
      else if (entry.url?.includes('theseus-rs')) assert.ok(how.includes(`${entry.url}.sha256`), 'theseus-rs pins name the .sha256 asset');
      else if (entry.url?.includes('python-build-standalone')) assert.match(how, /SHA256SUMS/);
      else if (entry.url?.startsWith('https://www.python.org/')) assert.ok(how.includes('MD5') && how.includes(`${entry.url}.sigstore`), 'python.org pins name the MD5 and the Sigstore bundle');
      else assert.fail(`unexpected vendor for ${entry.url}`);
    }
  }
  const linux = sources.targets['linux-x64'];
  assert.equal(linux.find(entry => entry.component === 'postgres')?.sha256, '19dbf09f0fc33255ff7596fc3ceb7696647286dd15fdf60f3f65c583aae6ad5d');
  assert.equal(linux.find(entry => entry.component === 'python')?.sha256, 'f3488a36ef5c10d01d346b9e540727d0807202c9bef52f40a987dc59ddc4ecee');
  assert.equal(linux.find(entry => entry.component === 'postgres-16')?.layout.into, 'postgres-16');
  for (const entry of linux.filter(item => item.component.startsWith('postgres'))) {
    assert.equal(entry.layout.vendorLibraries, true);
    assert.ok(entry.layout.exclude?.includes('lib/plpython3.so'), 'PL/Python needs the build host libpython and is left out');
  }
  const libraries = sources.libraries?.['linux-x64'];
  assert.ok(libraries && libraries.minimumGlibc === '2.34' && libraries.system.includes('libc.so.6') && libraries.system.includes('libgcc_s.so.1'));
  for (const item of libraries.packages) {
    assert.match(item.url, /^https:\/\/archive\.ubuntu\.com\/ubuntu\/pool\//);
    assert.match(item.checksumSource, /Packages\.xz .*InRelease.*gpgv/);
  }
  assert.ok(!libraries.packages.some(item => item.package === 'libc6' || item.package === 'libgcc-s1'), 'the C runtime is never vendored');
  const unsourced = structuredClone(sources);
  delete unsourced.targets['linux-x64'][0].checksumSource;
  assert.throws(() => validateRuntimeSources(unsourced), code('RUNTIME_SOURCES_INVALID'), 'a pin without its verification source is refused');
  const sourcedOnly = structuredClone(sources);
  sourcedOnly.targets['linux-arm64'][0].checksumSource = 'claimed';
  assert.throws(() => validateRuntimeSources(sourcedOnly), code('RUNTIME_SOURCES_INVALID'), 'a verification source without a pin is refused');
  const newerRetained = structuredClone(sources);
  newerRetained.targets['linux-x64'][2] = { ...newerRetained.targets['linux-x64'][2], component: 'postgres-18', version: '18.1', licenseFile: 'postgres-18/COPYRIGHT', layout: { ...newerRetained.targets['linux-x64'][2].layout, into: 'postgres-18' } };
  assert.throws(() => validateRuntimeSources(newerRetained), code('RUNTIME_SOURCES_INVALID'), 'a retained runtime must be an older major');
  const vendoredElsewhere = structuredClone(sources);
  vendoredElsewhere.targets['win32-x64'][0].layout.vendorLibraries = true;
  assert.throws(() => validateRuntimeSources(vendoredElsewhere), code('RUNTIME_SOURCES_INVALID'), 'library vendoring is Linux only');
  const fetcher: Fetcher = async () => assert.fail('no download may start');
  const out = join(tmpdir(), 'chausar-unused-runtime');
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'arm64', out, fetch: fetcher }), code('RUNTIME_SOURCE_UNPINNED'));
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

test('dotfiles and dot-folders are never inventoried, and the preflight ignores them the same way', async t => {
  const { project, out, sources, fetcher } = await fixture(t);
  await file(join(out, '.gitignore'), '*\n!README.md\n');
  await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher });
  await file(join(out, 'python', 'lib', 'python3.13', 'lib-dynload', '.empty'), '');
  await file(join(out, '.cache', 'note.txt'), 'left by a tool');
  const manifest = await inventoryRuntime({ platform: 'linux', architecture: 'x64', out, sources });
  const paths = manifest.files.map(entry => entry.path);
  assert.ok(paths.includes('README.md'));
  assert.deepEqual(paths.filter(path => path.split('/').some(segment => segment.startsWith('.'))), []);
  const { packagePreflight } = await import(pathToFileURL(join(repoRoot, 'scripts', 'package-preflight.mjs')).href);
  const result = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(result.checks.includes('complete runtime integrity and provenance manifest'), JSON.stringify(result.failures));
  await file(join(out, 'python', 'unlisted.txt'), 'not a dotfile');
  const unlisted = await packagePreflight({ root: project, platform: 'linux', architecture: 'x64', environment: {} });
  assert.ok(unlisted.failures.some((failure: { check: string }) => failure.check === 'complete runtime integrity and provenance manifest'), 'an ordinary unlisted file still fails');
});

/** A minimal 64-bit little-endian ELF shared object with a dynamic section and GLIBC version needs. */
function elf(spec: { needed: string[]; soname?: string; runpath?: string | null; glibc?: string[] }): Buffer {
  const strings = [''], offsets = new Map<string, number>();
  let size = 1;
  const str = (value: string) => { if (!offsets.has(value)) { offsets.set(value, size); strings.push(value); size += Buffer.byteLength(value) + 1; } return offsets.get(value) as number; };
  const dyn: [number, number][] = [...spec.needed.map(name => [1, str(name)] as [number, number]), ...(spec.soname ? [[14, str(spec.soname)] as [number, number]] : []), ...(spec.runpath ? [[29, str(spec.runpath)] as [number, number]] : []), [0, 0]];
  const versions = spec.glibc ?? [], libc = str('libc.so.6'), names = versions.map(version => str(`GLIBC_${version}`));
  const dynstr = Buffer.from(strings.join('\0') + '\0', 'latin1');
  const dynamic = Buffer.alloc(dyn.length * 16);
  dyn.forEach(([tag, value], index) => { dynamic.writeBigInt64LE(BigInt(tag), index * 16); dynamic.writeBigUInt64LE(BigInt(value), index * 16 + 8); });
  const verneed = Buffer.alloc(versions.length ? 16 + versions.length * 16 : 0);
  if (versions.length) {
    verneed.writeUInt16LE(1, 0); verneed.writeUInt16LE(versions.length, 2); verneed.writeUInt32LE(libc, 4); verneed.writeUInt32LE(16, 8);
    names.forEach((name, index) => { verneed.writeUInt32LE(name, 16 + index * 16 + 8); verneed.writeUInt32LE(index === versions.length - 1 ? 0 : 16, 16 + index * 16 + 12); });
  }
  const shstr = Buffer.from('\0.dynstr\0.dynamic\0.gnu.version_r\0.shstrtab\0', 'latin1');
  const parts = [dynstr, dynamic, verneed, shstr];
  let at = 64;
  const placed = parts.map(part => { const offset = at; at += part.length; return offset; });
  const header = Buffer.alloc(64);
  header.writeUInt32BE(0x7f454c46, 0); header[4] = 2; header[5] = 1; header[6] = 1;
  header.writeUInt16LE(3, 16); header.writeUInt16LE(62, 18); header.writeUInt32LE(1, 20); header.writeBigUInt64LE(BigInt(at), 0x28);
  header.writeUInt16LE(64, 0x34); header.writeUInt16LE(64, 0x3a); header.writeUInt16LE(5, 0x3c); header.writeUInt16LE(4, 0x3e);
  const sections = Buffer.alloc(5 * 64);
  const section = (index: number, name: number, type: number, offset: number, length: number, link: number, info: number) => {
    const base = index * 64;
    sections.writeUInt32LE(name, base); sections.writeUInt32LE(type, base + 4); sections.writeBigUInt64LE(BigInt(offset), base + 24); sections.writeBigUInt64LE(BigInt(length), base + 32); sections.writeUInt32LE(link, base + 40); sections.writeUInt32LE(info, base + 44);
  };
  section(1, 1, 3, placed[0], dynstr.length, 0, 0); section(2, 9, 6, placed[1], dynamic.length, 1, 0); section(3, 18, 0x6ffffffe, placed[2], verneed.length, 1, versions.length ? 1 : 0); section(4, 33, 3, placed[3], shstr.length, 0, 0);
  return Buffer.concat([header, ...parts, sections]);
}
/** A .deb (ar container with a zstd data tar) built from a directory tree. */
async function deb(root: string, tree: string): Promise<Buffer> {
  const tarFile = `${tree}.tar`;
  const made = spawnSync('tar', ['-cf', tarFile, '-C', tree, '.']);
  assert.equal(made.status, 0, made.stderr?.toString());
  const members: [string, Buffer][] = [['debian-binary', Buffer.from('2.0\n')], ['control.tar.zst', zstdCompressSync(Buffer.from('control'))], ['data.tar.zst', zstdCompressSync(await readFile(tarFile))]];
  const chunks: Buffer[] = [Buffer.from('!<arch>\n')];
  for (const [name, body] of members) {
    chunks.push(Buffer.from(`${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(body.length).padEnd(10)}\`\n`, 'latin1'), body);
    if (body.length % 2) chunks.push(Buffer.from('\n'));
  }
  return Buffer.concat(chunks);
}

/** A PostgreSQL archive whose ELF files need libfoo (which needs libbar), with a stray absolute RUNPATH, plus two pinned packages. */
async function vendorFixture(t: TestContext, options: { glibc?: string; extraNeed?: string } = {}) {
  const base = await fixture(t);
  const pg = join(base.root, 'vendor-tree', PG_ROOT);
  await file(join(pg, 'bin', 'postgres'), elf({ needed: ['libfoo.so.1', ...(options.extraNeed ? [options.extraNeed] : []), 'libc.so.6'], runpath: '$ORIGIN/../lib', glibc: ['2.17'] }), 0o755);
  for (const name of ['initdb', 'pg_ctl', 'pg_upgrade']) await file(join(pg, 'bin', name), elf({ needed: ['libc.so.6'], runpath: '$ORIGIN/../lib', glibc: ['2.2'] }), 0o755);
  await file(join(pg, 'lib', 'ext.so'), elf({ needed: ['libc.so.6'], runpath: '/opt/postgresql/lib' }));
  await file(join(pg, 'lib', 'plpython3.so'), elf({ needed: ['libpython3.11.so.1.0', 'libc.so.6'] }));
  await file(join(pg, 'share', 'postgres.bki'), 'catalog');
  await file(join(pg, 'COPYRIGHT'), 'PostgreSQL license');
  tarGz(join(base.root, 'archives', 'pg-elf.tar.gz'), join(base.root, 'vendor-tree'), PG_ROOT);
  const foo = join(base.root, 'debs', 'libfoo1');
  await file(join(foo, 'usr', 'lib', 'x86_64-linux-gnu', 'libfoo.so.1.2.3'), elf({ needed: ['libbar.so.2', 'libc.so.6'], soname: 'libfoo.so.1', glibc: ['2.14'] }));
  await symlink('libfoo.so.1.2.3', join(foo, 'usr', 'lib', 'x86_64-linux-gnu', 'libfoo.so.1'));
  await file(join(foo, 'usr', 'lib', 'x86_64-linux-gnu', 'engines', 'skip.so'), elf({ needed: ['libc.so.6'] }));
  await file(join(foo, 'usr', 'share', 'doc', 'libfoo1', 'copyright'), 'libfoo copyright');
  const bar = join(base.root, 'debs', 'libbar2');
  await file(join(bar, 'lib', 'x86_64-linux-gnu', 'libbar.so.2'), elf({ needed: ['libc.so.6'], soname: 'libbar.so.2', glibc: [options.glibc ?? '2.34', '2.3'] }));
  await mkdir(join(bar, 'usr', 'share', 'doc'), { recursive: true });
  await symlink('libfoo1', join(bar, 'usr', 'share', 'doc', 'libbar2'));
  const bytes: Record<string, Buffer> = {
    'https://vendor.test/pg-elf.tar.gz': await readFile(join(base.root, 'archives', 'pg-elf.tar.gz')),
    'https://archive.test/libfoo1.deb': await deb(base.root, foo),
    'https://archive.test/libbar2.deb': await deb(base.root, bar),
    'https://vendor.test/py.tar.gz': (await base.fetcher('https://vendor.test/py.tar.gz', { redirect: 'follow' }).then(response => response.arrayBuffer()).then(buffer => Buffer.from(buffer))),
  };
  base.fetched.length = 0;
  const libraries: LinuxLibraries = {
    distribution: 'synthetic', minimumGlibc: '2.34', system: ['libc.so.6', 'libm.so.6', 'libgcc_s.so.1'],
    packages: [
      { package: 'libfoo1', version: '1.2.3-1', url: 'https://archive.test/libfoo1.deb', sha256: sha(bytes['https://archive.test/libfoo1.deb']), checksumSource: 'synthetic Packages index', copyright: 'usr/share/doc/libfoo1/copyright' },
      { package: 'libbar2', version: '2.0-1', url: 'https://archive.test/libbar2.deb', sha256: sha(bytes['https://archive.test/libbar2.deb']), checksumSource: 'synthetic Packages index', copyright: 'usr/share/doc/libfoo1/copyright', copyrightFrom: 'libfoo1' },
    ],
  };
  const sources = structuredClone(base.sources);
  sources.targets['linux-x64'][0] = { ...sources.targets['linux-x64'][0], url: 'https://vendor.test/pg-elf.tar.gz', sha256: sha(bytes['https://vendor.test/pg-elf.tar.gz']), layout: { ...sources.targets['linux-x64'][0].layout, exclude: ['lib/plpython3.so'], vendorLibraries: true } };
  sources.libraries = { 'linux-x64': libraries };
  const fetched: string[] = [];
  const fetcher: Fetcher = async url => { fetched.push(url); const body = bytes[url]; return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 }); };
  // Stands in for patchelf: rewrites the synthetic ELF with the new RUNPATH, keeping everything else.
  const patched: string[] = [];
  const setRunpath = async (path: string, runpath: string) => {
    const info = readElf(await readFile(path));
    assert.ok(info);
    patched.push(`${relative(base.out, path)} ${runpath}`);
    await writeFile(path, elf({ needed: info.needed, soname: info.soname ?? undefined, runpath, glibc: info.versions.map(version => version.replace(/^GLIBC_/, '')) }));
  };
  return { ...base, sources, fetcher, fetched, setRunpath, patched, libraries, bytes };
}

test('vendorLibraries copies exactly the needed libraries from pinned packages, rewrites RUNPATH to $ORIGIN and records licenses', async t => {
  const { out, sources, fetcher, fetched, setRunpath, patched } = await vendorFixture(t);
  const notes: string[] = [];
  const manifest = await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources, fetch: fetcher, setRunpath, onNote: text => notes.push(text) });
  assert.deepEqual(fetched.sort(), ['https://archive.test/libbar2.deb', 'https://archive.test/libfoo1.deb', 'https://vendor.test/pg-elf.tar.gz', 'https://vendor.test/py.tar.gz']);
  const paths = manifest.files.map(entry => entry.path);
  for (const path of ['postgres/lib/libfoo.so.1', 'postgres/lib/libbar.so.2', 'postgres/licenses/libfoo1.copyright', 'postgres/licenses/libbar2.copyright']) assert.ok(paths.includes(path), path);
  assert.ok(!paths.includes('postgres/lib/skip.so') && !paths.includes('postgres/lib/plpython3.so'), 'unneeded and excluded files are not staged');
  assert.equal(await readFile(join(out, 'postgres', 'licenses', 'libbar2.copyright'), 'utf8'), 'libfoo copyright', 'copyrightFrom reads the linked package');
  assert.deepEqual(patched.map(entry => entry.replace(/^.*?(postgres\/)/, '$1')).sort(), ['postgres/lib/ext.so $ORIGIN', 'postgres/lib/libfoo.so.1 $ORIGIN'], 'only wrong or missing RUNPATHs are rewritten');
  const staged = readElf(await readFile(join(out, 'postgres', 'lib', 'ext.so')));
  assert.deepEqual(staged?.runpath, ['$ORIGIN']);
  assert.deepEqual(readElf(await readFile(join(out, 'postgres', 'bin', 'postgres')))?.runpath, ['$ORIGIN/../lib']);
  assert.match(notes.join('\n'), /Vendored 2 libraries from 2 packages into postgres\/lib; rewrote 2 library paths; \d+ ELF files need glibc 2\.34 \(declared minimum 2\.34\)/);
});

test('vendoring refuses an unresolvable library, a too-new glibc, a changed package and a missing patchelf', async t => {
  const unresolved = await vendorFixture(t, { extraNeed: 'libmissing.so.7' });
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: unresolved.out, sources: unresolved.sources, fetch: unresolved.fetcher, setRunpath: unresolved.setRunpath }), code('RUNTIME_LIBRARY_UNRESOLVED'));
  assert.deepEqual(await readdir(unresolved.out), ['README.md'], 'nothing is staged');
  const newer = await vendorFixture(t, { glibc: '2.38' });
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: newer.out, sources: newer.sources, fetch: newer.fetcher, setRunpath: newer.setRunpath }), code('RUNTIME_GLIBC_TOO_NEW'));
  const changed = await vendorFixture(t);
  (changed.sources.libraries as Record<string, LinuxLibraries>)['linux-x64'].packages[1].sha256 = 'e'.repeat(64);
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: changed.out, sources: changed.sources, fetch: changed.fetcher, setRunpath: changed.setRunpath }), code('RUNTIME_HASH_MISMATCH'));
  const tool = await vendorFixture(t);
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out: tool.out, sources: tool.sources, fetch: tool.fetcher, patchelf: join(tool.root, 'no-patchelf') }), code('RUNTIME_PATCHELF_MISSING'));
  assert.throws(() => arMembers(Buffer.from('not an archive')), code('RUNTIME_PACKAGE_INVALID'));
  const malformed = elf({ needed: ['libc.so.6'] });
  malformed[4] = 1;
  assert.throws(() => readElf(malformed), code('RUNTIME_ELF_INVALID'), 'only 64-bit little-endian ELF is read');
  assert.equal(readElf(Buffer.from('#!/bin/sh\n'.padEnd(80))), null);
});

test('the ELF reader agrees with the system loader on a real binary', { skip: process.platform !== 'linux' ? 'needs a Linux ELF executable' : false }, async () => {
  const info = readElf(await readFile(process.execPath));
  assert.ok(info && info.needed.includes('libc.so.6'));
  assert.match(info.glibc ?? '', /^2\.\d+$/);
});

test('a retained older PostgreSQL major is staged as postgres-<major>/ and must carry postgres and pg_ctl', async t => {
  const { root, out, sources, fetcher } = await fixture(t);
  const old = join(root, 'old-tree', 'postgresql-16.14.0');
  for (const name of ['postgres', 'pg_ctl', 'initdb']) await file(join(old, 'bin', name), `\x7fELF fake 16 ${name}\n`, 0o755);
  await file(join(old, 'lib', 'libpq.so.5'), 'fake 16 library');
  await file(join(old, 'share', 'postgres.bki'), 'catalog 16');
  await file(join(old, 'COPYRIGHT'), 'PostgreSQL license');
  tarGz(join(root, 'archives', 'pg16.tar.gz'), join(root, 'old-tree'), 'postgresql-16.14.0');
  const bytes = await readFile(join(root, 'archives', 'pg16.tar.gz'));
  const withOld = structuredClone(sources);
  withOld.targets['linux-x64'].push({ component: 'postgres-16', version: '16.14', vendor: 'synthetic', url: 'https://vendor.test/pg16.tar.gz', sha256: sha(bytes), checksumSource: 'synthetic test archive', license: 'PostgreSQL', licenseFile: 'postgres-16/COPYRIGHT', official: false, layout: { archive: 'tar.gz', strip: 'postgresql-16.14.0', into: 'postgres-16', include: ['bin', 'lib', 'share', 'COPYRIGHT'], materialiseSymlinks: true } });
  const both: Fetcher = async (url, init) => url === 'https://vendor.test/pg16.tar.gz' ? new Response(new Uint8Array(bytes)) : fetcher(url, init);
  const manifest = await stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: withOld, fetch: both });
  const paths = manifest.files.map(entry => entry.path);
  for (const path of ['postgres-16/bin/postgres', 'postgres-16/bin/pg_ctl', 'postgres-16/lib/libpq.so.5', 'postgres-16/share/postgres.bki', 'postgres-16/COPYRIGHT']) assert.ok(paths.includes(path), path);
  assert.deepEqual(Object.keys(manifest.components).sort(), ['postgres', 'python'], 'the preflight schema keeps two components');
  assert.deepEqual((await readdir(out)).sort(), ['README.md', 'manifest.json', 'postgres', 'postgres-16', 'python']);
  const missingTool = structuredClone(withOld);
  missingTool.targets['linux-x64'][2].layout.exclude = ['bin/pg_ctl'];
  await assert.rejects(stageRuntime({ platform: 'linux', architecture: 'x64', out, sources: missingTool, fetch: both, replace: true }), code('RUNTIME_LAYOUT_INVALID'));
  assert.equal(parseStageArguments(['--platform', 'linux', '--arch', 'x64', '--out', out, '--patchelf', '/usr/bin/patchelf'], {}).patchelf, '/usr/bin/patchelf');
  assert.throws(() => parseStageArguments(['--platform', 'linux', '--arch', 'x64', '--out', out, '--patchelf', 'patchelf'], {}), code('RUNTIME_USAGE'));
});
