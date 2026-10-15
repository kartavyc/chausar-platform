import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { inventoryFiles, parseStageArguments, type Fetcher } from '../../scripts/release/stage-runtime.ts';
import { canonicalName, loadReaderSources, selectReaderSources, stageReaders, validateReaderSources, type PythonRunner, type ReaderSources } from '../../scripts/release/stage-readers.ts';
import { readerBundle, verifyReaderBundle } from '../runtime/native/reader-bundle.ts';
import { imports } from '../runtime/connectors-ext/fr07.ts';
import { ChausarError } from '../runtime/contracts.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (expected: string) => (error: unknown) => { assert.equal((error as { code?: string }).code, expected, (error as Error).message); return true; };
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const HOST = { platform: 'linux', arch: 'x64' };
const SITE = 'python/lib/python3.13/site-packages';
const hostPython = existsSync('/usr/bin/python3') ? realpathSync('/usr/bin/python3') : '';

async function file(path: string, content: string | Buffer, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, mode);
}
async function temporary(t: TestContext, prefix: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('the recorded reader pins are valid: only linux-x64 is staged, every wheel and package is hash-pinned', async () => {
  const { readers } = await loadReaderSources();
  assert.deepEqual(Object.entries(readers.targets).filter(([, entry]) => entry.staged).map(([target]) => target), ['linux-x64']);
  const linux = selectReaderSources(readers, 'linux', 'x64');
  assert.deepEqual([linux.python.packages.pdfplumber, linux.python.packages.pypdfium2, linux.python.packages.pillow], ['0.11.10', '5.14.0', '12.3.0']);
  assert.ok(linux.tesseract.include.includes('bin/tesseract') && linux.tesseract.include.includes('share/tessdata/configs/tsv'));
  assert.ok(linux.tesseract.packages.every(pin => pin.url.startsWith('https://conda.anaconda.org/conda-forge/linux-64/') && /repodata/.test(pin.checksumSource)));
  for (const [target, entry] of Object.entries(readers.targets)) {
    if (!entry.python) continue;
    const lines = readFileSync(join(repoRoot, 'scripts', 'release', ...entry.python.requirements.split('/')), 'utf8').split('\n').filter(line => line && !line.startsWith('#'));
    const pinned = Object.fromEntries(lines.map(line => { const match = /^([A-Za-z0-9_.-]+)==(\S+) --hash=sha256:([a-f0-9]{64})$/.exec(line); assert.ok(match, `${target}: ${line}`); return [canonicalName(match[1]), match[2]]; }));
    assert.deepEqual(pinned, Object.fromEntries(Object.entries(entry.python.packages).map(([name, version]) => [canonicalName(name), version])), target);
  }
  assert.throws(() => selectReaderSources(readers, 'darwin', 'arm64'), code('READER_SOURCE_UNRESOLVED'));
  assert.throws(() => selectReaderSources(readers, 'win32', 'arm64'), code('READER_SOURCE_UNAVAILABLE'));
  const broken = (change: (copy: any) => void) => { const copy = structuredClone(readers) as any; change(copy); return () => validateReaderSources(copy); };
  assert.throws(broken(copy => { copy.targets['linux-x64'].tesseract.packages[0].url = 'http://conda.anaconda.org/x.conda'; }), code('READER_SOURCES_INVALID'));
  assert.throws(broken(copy => { copy.targets['linux-x64'].tesseract.packages[0].sha256 = 'ABC'; }), code('READER_SOURCES_INVALID'));
  assert.throws(broken(copy => { delete copy.targets['linux-x64'].tesseract.packages[0].checksumSource; }), code('READER_SOURCES_INVALID'));
  assert.throws(broken(copy => { copy.targets['linux-x64'].tesseract.include = null; }), code('READER_SOURCES_INVALID'));
  assert.throws(broken(copy => { copy.targets['linux-x64'].python.sitePackages = '../site-packages'; }), code('READER_SOURCES_INVALID'));
  assert.throws(broken(copy => { delete copy.targets['linux-x64'].python.packages.pypdfium2; }), code('READER_SOURCES_INVALID'));
});

test('the stage command line takes one reader mode', () => {
  const base = ['--platform', 'linux', '--arch', 'x64', '--out', '/tmp/x'];
  assert.equal(parseStageArguments([...base, '--readers-only']).readersOnly, true);
  assert.equal(parseStageArguments([...base, '--readers']).readers, true);
  assert.throws(() => parseStageArguments([...base, '--readers', '--inventory-only']), code('RUNTIME_USAGE'));
  assert.throws(() => parseStageArguments([...base, '--readers-only', '--readers-only']), code('RUNTIME_USAGE'));
});

/** A synthetic `.conda`: a stored zip of pkg-*.tar.zst and info-*.tar.zst, built from two folders. */
function conda(work: string, name: string, payload: string, info: string): Buffer {
  const out = join(work, `${name}-out`);
  spawnSync('mkdir', ['-p', out]);
  for (const [kind, folder] of [['pkg', payload], ['info', info]] as const) {
    const tar = spawnSync('tar', ['-cf', '-', '-C', folder, '.']);
    assert.equal(tar.status, 0);
    spawnSync('sh', ['-c', 'cat > "$1"', 'sh', join(out, `${kind}-${name}-1.0-0.tar.zst`)], { input: zstdCompressSync(tar.stdout) });
  }
  const zip = spawnSync(hostPython, ['-I', '-c', 'import os,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_STORED) as z:\n  [z.write(os.path.join(sys.argv[1],n),n) for n in sorted(os.listdir(sys.argv[1]))]', out, join(work, `${name}.conda`)]);
  assert.equal(zip.status, 0, zip.stderr?.toString());
  return readFileSync(join(work, `${name}.conda`));
}
async function readerFixture(t: TestContext) {
  const root = await temporary(t, 'chausar-readers-');
  const work = join(root, 'work');
  // tesseract package: the program, a versioned library behind a soname symlink, a TSV config, licence metadata.
  await file(join(work, 'tess', 'bin', 'tesseract'), '\x7fELF fake tesseract\n', 0o755);
  await file(join(work, 'tess', 'lib', 'libtesseract.so.5.5.3'), 'fake libtesseract');
  await symlink('libtesseract.so.5.5.3', join(work, 'tess', 'lib', 'libtesseract.so.5'));
  await file(join(work, 'tess', 'lib', 'libtesseract.a'), 'not in the closure');
  await file(join(work, 'tess', 'share', 'tessdata', 'configs', 'tsv'), 'tessedit_create_tsv 1\n');
  await file(join(work, 'tess-info', 'info', 'licenses', 'tesseract', 'LICENSE'), 'Apache License 2.0');
  // GCC runtime package: no info/licenses; its licence sits in the payload.
  await file(join(work, 'gcc', 'lib', 'libgcc_s.so.1'), 'fake libgcc');
  await file(join(work, 'gcc', 'share', 'licenses', 'gcc-libs', 'RUNTIME.LIBRARY.EXCEPTION'), 'GCC runtime exception');
  await file(join(work, 'gcc-info', 'info', 'index.json'), '{}');
  const archives: Record<string, Buffer> = {
    'https://example.test/tesseract-5.5.3-0.conda': conda(work, 'tesseract', join(work, 'tess'), join(work, 'tess-info')),
    'https://example.test/libgcc-16.2.0-0.conda': conda(work, 'libgcc', join(work, 'gcc'), join(work, 'gcc-info')),
    'https://example.test/eng.traineddata': Buffer.from('fake English model'),
    'https://example.test/LICENSE': Buffer.from('Apache License 2.0 (tessdata)'),
  };
  const requirements = 'reader-requirements/linux-x64.txt';
  const readers: ReaderSources = { targets: { 'linux-x64': { staged: true, python: { requirements, sitePackages: SITE, packages: { pdfplumber: '0.11.10', pypdfium2: '5.14.0', pillow: '12.3.0' } },
    tesseract: { version: '5.5.3', vendor: 'synthetic', license: 'Apache-2.0', licenseFile: 'tesseract/licenses/tesseract/tesseract/LICENSE', prefix: null,
      packages: [
        { name: 'libgcc', version: '16.2.0', url: 'https://example.test/libgcc-16.2.0-0.conda', sha256: sha(archives['https://example.test/libgcc-16.2.0-0.conda']), checksumSource: 'synthetic', licensePaths: ['share/licenses/gcc-libs/RUNTIME.LIBRARY.EXCEPTION'] },
        { name: 'tesseract', version: '5.5.3', url: 'https://example.test/tesseract-5.5.3-0.conda', sha256: sha(archives['https://example.test/tesseract-5.5.3-0.conda']), checksumSource: 'synthetic' },
      ],
      include: ['bin/tesseract', 'lib/libtesseract.so.5', 'lib/libgcc_s.so.1', 'share/tessdata/configs/tsv'],
      tessdata: { language: 'eng', commit: 'a'.repeat(40), url: 'https://example.test/eng.traineddata', sha256: sha(archives['https://example.test/eng.traineddata']), checksumSource: 'synthetic', licenseUrl: 'https://example.test/LICENSE', licenseSha256: sha(archives['https://example.test/LICENSE']) } } } } };
  const fetches: string[] = [];
  const fetcher: Fetcher = async url => { fetches.push(url); const body = archives[url]; return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 }); };
  const out = join(root, 'runtime');
  await file(join(out, 'python', 'bin', 'python3'), 'fake interpreter', 0o755);
  await file(join(out, SITE, 'pip', '__init__.py'), '');
  const calls: string[][] = [];
  /** Stands in for pip and compileall: writes the wheels' folders and dist-info into --target. */
  const runPython = (versions: Record<string, string> = { pdfplumber: '0.11.10', pypdfium2: '5.14.0', pillow: '12.3.0' }): PythonRunner => async (_python, args) => {
    calls.push(args);
    if (args.includes('compileall')) return { code: 0 };
    const target = args[args.indexOf('--target') + 1];
    for (const [name, version] of Object.entries(versions)) {
      await file(join(target, name === 'pillow' ? 'PIL' : name, '__init__.py'), `# ${name}\n`);
      await file(join(target, `${name}-${version}.dist-info`, 'METADATA'), `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
    }
    await file(join(target, 'bin', 'pdfplumber'), '#!/abs/python3\n', 0o755);
    return { code: 0 };
  };
  return { root, out, readers, fetcher, fetches, runPython, calls, archives };
}

test('stages the readers from pinned packages: closure only, symlinks materialised, licences, language data and readers.json', { skip: !hostPython && 'needs python3 to build synthetic conda zips' }, async t => {
  const fx = await readerFixture(t);
  const metadata = await stageReaders({ platform: 'linux', architecture: 'x64', out: fx.out, readers: fx.readers, pythonVersion: '3.13.7', fetch: fx.fetcher, runPython: fx.runPython(), host: HOST });
  const pip = fx.calls[0];
  assert.deepEqual(pip.slice(0, 9), ['-I', '-m', 'pip', 'install', '--no-deps', '--only-binary=:all:', '--require-hashes', '--no-compile', '--disable-pip-version-check']);
  assert.equal(pip.at(-1), join(repoRoot, 'scripts', 'release', 'reader-requirements', 'linux-x64.txt'));
  assert.ok(fx.calls[1].includes('compileall') && fx.calls[1].includes('checked-hash'));
  const files = (await inventoryFiles(join(fx.out, 'tesseract'))).map(entry => entry.path);
  assert.deepEqual(files, ['bin/tesseract', 'lib/libgcc_s.so.1', 'lib/libtesseract.so.5', 'licenses/libgcc/share/licenses/gcc-libs/RUNTIME.LIBRARY.EXCEPTION', 'licenses/tessdata_fast/LICENSE', 'licenses/tesseract/tesseract/LICENSE', 'share/tessdata/configs/tsv', 'share/tessdata/eng.traineddata']);
  assert.equal((await lstat(join(fx.out, 'tesseract', 'lib', 'libtesseract.so.5'))).isFile(), true, 'the soname symlink became a regular file');
  assert.equal((await lstat(join(fx.out, 'tesseract', 'bin', 'tesseract'))).mode & 0o111, 0o111);
  assert.equal(existsSync(join(fx.out, SITE, 'bin')), false, 'console scripts with machine paths are dropped');
  assert.ok(existsSync(join(fx.out, SITE, 'pdfplumber-0.11.10.dist-info', 'METADATA')) && existsSync(join(fx.out, SITE, 'pip', '__init__.py')));
  assert.deepEqual(metadata.python.packages, { pdfplumber: '0.11.10', pillow: '12.3.0', pypdfium2: '5.14.0' });
  assert.deepEqual(metadata.python.paths, ['PIL', 'pdfplumber', 'pdfplumber-0.11.10.dist-info', 'pillow-12.3.0.dist-info', 'pypdfium2', 'pypdfium2-5.14.0.dist-info'].map(name => `${SITE}/${name}`));
  assert.deepEqual(JSON.parse(await readFile(join(fx.out, 'readers.json'), 'utf8')), metadata);
  assert.equal(metadata.tesseract.executable, 'tesseract/bin/tesseract');
  assert.deepEqual((await readdir(fx.out)).filter(name => name.startsWith('.')), [], 'no work folder is left behind');
  await assert.rejects(stageReaders({ platform: 'linux', architecture: 'x64', out: fx.out, readers: fx.readers, pythonVersion: '3.13.7', fetch: fx.fetcher, runPython: fx.runPython(), host: HOST }), code('READER_OUTPUT_EXISTS'));
  await stageReaders({ platform: 'linux', architecture: 'x64', out: fx.out, readers: fx.readers, pythonVersion: '3.13.7', fetch: fx.fetcher, runPython: fx.runPython(), host: HOST, replace: true });
});

test('reader staging refuses a changed download, another host, a different package set and an unstaged Python', { skip: !hostPython && 'needs python3 to build synthetic conda zips' }, async t => {
  const fx = await readerFixture(t);
  const options = { platform: 'linux', architecture: 'x64', out: fx.out, readers: fx.readers, pythonVersion: '3.13.7', fetch: fx.fetcher, host: HOST };
  await assert.rejects(stageReaders({ ...options, runPython: fx.runPython(), host: { platform: 'darwin', arch: 'arm64' } }), code('READER_STAGE_HOST_ONLY'));
  const tampered = structuredClone(fx.readers);
  tampered.targets['linux-x64'].tesseract!.tessdata.sha256 = 'f'.repeat(64);
  await assert.rejects(stageReaders({ ...options, readers: tampered, runPython: fx.runPython() }), code('READER_HASH_MISMATCH'));
  assert.equal(existsSync(join(fx.out, 'tesseract')), false);
  await assert.rejects(stageReaders({ ...options, runPython: fx.runPython({ pdfplumber: '0.11.9', pypdfium2: '5.14.0', pillow: '12.3.0' }) }), code('READER_PACKAGE_MISMATCH'));
  await assert.rejects(stageReaders({ ...options, runPython: async () => ({ code: 1 }) }), code('READER_PIP_FAILED'));
  const missing = structuredClone(fx.readers);
  missing.targets['linux-x64'].tesseract!.include!.push('lib/libmissing.so.1');
  await assert.rejects(stageReaders({ ...options, readers: missing, runPython: fx.runPython() }), code('READER_LAYOUT_INVALID'));
  const unlicensed = structuredClone(fx.readers);
  delete unlicensed.targets['linux-x64'].tesseract!.packages[0].licensePaths;
  await assert.rejects(stageReaders({ ...options, readers: unlicensed, runPython: fx.runPython() }), code('READER_LICENSE_MISSING'));
  await rm(join(fx.out, 'python', 'bin', 'python3'));
  await assert.rejects(stageReaders({ ...options, runPython: fx.runPython() }), code('READER_LAYOUT_INVALID'));
});

/** A runtime-binaries folder with a readers record and a manifest listing every file. */
async function bundleFixture(t: TestContext) {
  const resources = await temporary(t, 'chausar-bundle-');
  const root = join(resources, 'runtime-binaries');
  await file(join(root, 'python', 'bin', 'python3'), 'fake interpreter', 0o755);
  await file(join(root, 'python', 'lib', 'python3.13', 'os.py'), 'standard library');
  for (const [dir, name, version] of [['pdfplumber', 'pdfplumber', '0.11.10'], ['pypdfium2', 'pypdfium2', '5.14.0'], ['PIL', 'pillow', '12.3.0'], ['pdfminer', 'pdfminer_six', '20260107']]) {
    await file(join(root, SITE, dir, '__init__.py'), `# ${dir}`);
    await file(join(root, SITE, `${name}-${version}.dist-info`, 'METADATA'), `Name: ${name}\nVersion: ${version}\n`);
  }
  await file(join(root, 'tesseract', 'bin', 'tesseract'), 'fake tesseract', 0o755);
  await file(join(root, 'tesseract', 'share', 'tessdata', 'eng.traineddata'), 'fake English model');
  await file(join(root, 'postgres', 'bin', 'postgres'), 'fake postgres', 0o755);
  const paths = ['PIL', 'pdfminer', 'pdfminer_six-20260107.dist-info', 'pdfplumber', 'pdfplumber-0.11.10.dist-info', 'pillow-12.3.0.dist-info', 'pypdfium2', 'pypdfium2-5.14.0.dist-info'].map(name => `${SITE}/${name}`);
  const record = { format: 'chausar.readers.v1', platform: process.platform, architecture: process.arch,
    python: { version: '3.13.7', sitePackages: SITE, packages: { pdfplumber: '0.11.10', pypdfium2: '5.14.0', pillow: '12.3.0', 'pdfminer-six': '20260107' }, paths },
    tesseract: { version: '5.5.3', executable: 'tesseract/bin/tesseract', tessdata: 'tesseract/share/tessdata', languages: ['eng'], license: 'Apache-2.0', licenseFile: 'tesseract/LICENSE', source: 'synthetic', packages: [] } };
  await file(join(root, 'readers.json'), JSON.stringify(record));
  const writeManifest = async (change: (manifest: any) => void = () => {}) => {
    const manifest: any = { schemaVersion: 1, platform: process.platform, architecture: process.arch, components: {}, files: await inventoryFiles(root) };
    change(manifest);
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  };
  await writeManifest();
  return { resources, root, python: join(root, 'python', 'bin', 'python3'), writeManifest };
}

test('readerBundle describes the bundle from the manifest and the readers record only', { skip: process.platform === 'win32' && 'POSIX layout' }, async t => {
  const fx = await bundleFixture(t);
  const options = { resourcesPath: fx.resources, pythonExecutable: fx.python };
  const bundle = await readerBundle(options);
  const manifest = JSON.parse(await readFile(join(fx.root, 'manifest.json'), 'utf8'));
  assert.deepEqual(bundle, { present: true, reason: null, python: { version: '3.13.7' }, packages: { pdfplumber: '0.11.10', pypdfium2: '5.14.0', Pillow: '12.3.0' }, tesseract: { version: '5.5.3', languages: ['eng'] },
    sizeBytes: manifest.files.filter((entry: any) => /^(python|tesseract)\//.test(entry.path)).reduce((sum: number, entry: any) => sum + entry.size, 0),
    manifestSha256: sha(await readFile(join(fx.root, 'manifest.json'))) });
  assert.equal((await readerBundle({ ...options, pythonExecutable: hostPython || '/usr/bin/env' })).reason, 'PYTHON_NOT_BUNDLED');
  assert.equal((await readerBundle({ ...options, pythonExecutable: null })).reason, 'PYTHON_NOT_CONFIGURED');
  await assert.rejects(readerBundle({ ...options, resourcesPath: 'relative/resources' }), code('READER_BUNDLE_INVALID'));
  assert.equal((await readerBundle({ ...options, platform: process.platform === 'linux' ? 'darwin' : 'linux' })).reason, 'RUNTIME_MANIFEST_INVALID');
  await writeFile(join(fx.root, 'readers.json'), (await readFile(join(fx.root, 'readers.json'), 'utf8')).replace('5.5.3', '5.5.4'));
  assert.equal((await readerBundle(options)).reason, 'READERS_CHANGED', 'the record must be the inventoried one');
  await fx.writeManifest(manifest => { manifest.files = manifest.files.filter((entry: any) => entry.path !== 'readers.json'); });
  assert.equal((await readerBundle(options)).reason, 'READERS_NOT_BUNDLED');
  await fx.writeManifest(manifest => { manifest.files = manifest.files.filter((entry: any) => !entry.path.includes('pypdfium2-5.14.0.dist-info')); });
  assert.equal((await readerBundle(options)).reason, 'READER_PACKAGE_MISSING');
  await fx.writeManifest();
  await rm(join(fx.root, 'tesseract', 'share', 'tessdata', 'eng.traineddata'));
  assert.equal((await readerBundle(options)).reason, 'OCR_PROGRAM_MISSING');
  await rm(join(fx.root, 'manifest.json'));
  assert.equal((await readerBundle(options)).reason, 'RUNTIME_NOT_BUNDLED');
});

test('verifyReaderBundle re-hashes the reader files and refuses changed, extra or missing files', { skip: process.platform === 'win32' && 'POSIX layout' }, async t => {
  const fx = await bundleFixture(t);
  const options = { resourcesPath: fx.resources, pythonExecutable: fx.python };
  const install = await verifyReaderBundle(options);
  assert.equal(install.installed, true); assert.equal(install.downloaded, false); assert.equal(install.bundle.present, true);
  assert.equal(install.verifiedFiles, 11, 'eight package files, the two tesseract files and readers.json; not the standard library or PostgreSQL');
  await writeFile(join(fx.root, 'python', 'lib', 'python3.13', 'os.py'), 'changed outside the reader scope');
  assert.equal((await verifyReaderBundle(options)).installed, true);
  await file(join(fx.root, 'tesseract', 'lib', 'libextra.so'), 'unlisted');
  await assert.rejects(verifyReaderBundle(options), code('READER_BUNDLE_CHANGED'));
  await rm(join(fx.root, 'tesseract', 'lib'), { recursive: true });
  await writeFile(join(fx.root, SITE, 'PIL', '__init__.py'), '# changed');
  await assert.rejects(verifyReaderBundle(options), code('READER_BUNDLE_CHANGED'));
  await rm(join(fx.root, 'readers.json'));
  await assert.rejects(verifyReaderBundle(options), code('READER_BUNDLE_MISSING'));
});

test('FR-07 reader status takes its size from native.readerBundle, and installReader verifies instead of downloading', async () => {
  const ctx = { memberId: 'owner', role: 'owner' } as any;
  const helper = { options: { executable: '/opt/chausar/python/bin/python3' }, run: async () => ({ result: { pdfText: true, pdfOcr: true } }) };
  const host = (answers: Record<string, () => unknown>) => ({ services: { helper }, call: async (method: string) => { const answer = answers[method]; if (!answer) throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); return answer(); } }) as any;
  const bundled = host({ 'native.readerBundle': () => ({ present: true, sizeBytes: 669031286 }), 'native.installReader': () => ({ installed: true, downloaded: false }) });
  assert.deepEqual(await imports.readerStatus(ctx, {}, bundled), { status: 'installed', pdfText: true, pdfOcr: true, reason: null, sizeBytes: 669031286 });
  assert.deepEqual(await imports.installReader(ctx, {}, bundled), { installed: true, downloaded: false, status: 'installed', pdfText: true, pdfOcr: true, reason: null, sizeBytes: 669031286 });
  const older = host({});
  assert.equal((await imports.readerStatus(ctx, {}, older)).sizeBytes, null, 'without the release method the size stays unknown');
  await assert.rejects(imports.installReader(ctx, {}, older) as Promise<unknown>, code('READER_INSTALL_UNAVAILABLE'));
  await assert.rejects(imports.installReader(ctx, {}, host({ 'native.installReader': () => { throw new ChausarError('READER_BUNDLE_MISSING', 'Missing.'); } })) as Promise<unknown>, code('READER_INSTALL_UNAVAILABLE'));
  await assert.rejects(imports.installReader(ctx, {}, host({ 'native.installReader': () => { throw new ChausarError('READER_BUNDLE_CHANGED', 'Changed.'); } })) as Promise<unknown>, code('READER_BUNDLE_CHANGED'));
  assert.throws(() => imports.installReader(ctx, {}), code('READER_INSTALL_UNAVAILABLE'));
});

test('the helper finds only the bundled tesseract beside its interpreter, never a link or a path outside the runtime', { skip: !hostPython && 'needs python3' }, async t => {
  const root = await temporary(t, 'chausar-tesseract-lookup-');
  const analytics = fileURLToPath(new URL('../helpers/analytics.py', import.meta.url));
  const probe = (executable: string) => {
    const script = 'import json,sys\nsys.path.insert(0,sys.argv[1])\nimport analytics\nsys.executable=sys.argv[2]\nfound=analytics.bundled_tesseract()\nprint(json.dumps({"found":found,"env":analytics.tesseract_environment(found[0]) if found else None}))';
    const run = spawnSync(hostPython, ['-I', '-B', '-c', script, dirname(analytics), executable], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  const runtime = join(root, 'runtime-binaries');
  await file(join(runtime, 'python', 'bin', 'python3'), 'fake', 0o755);
  assert.equal(probe(join(runtime, 'python', 'bin', 'python3')).found, null, 'no bundled tesseract yet');
  await file(join(runtime, 'tesseract', 'bin', 'tesseract'), 'fake', 0o755);
  await mkdir(join(runtime, 'tesseract', 'share', 'tessdata'), { recursive: true });
  const real = realpathSync(runtime);
  assert.deepEqual(probe(join(runtime, 'python', 'bin', 'python3')), { found: [join(real, 'tesseract', 'bin', 'tesseract'), join(real, 'tesseract', 'share', 'tessdata')], env: { OMP_THREAD_LIMIT: '1', TESSDATA_PREFIX: join(real, 'tesseract', 'share', 'tessdata') } });
  await file(join(root, 'elsewhere', 'tesseract'), 'outside', 0o755);
  await rm(join(runtime, 'tesseract', 'bin', 'tesseract'));
  await symlink(join(root, 'elsewhere', 'tesseract'), join(runtime, 'tesseract', 'bin', 'tesseract'));
  assert.equal(probe(join(runtime, 'python', 'bin', 'python3')).found, null, 'a symbolic link is refused');
  await rm(join(runtime, 'tesseract', 'bin'), { recursive: true });
  await symlink(join(root, 'elsewhere'), join(runtime, 'tesseract', 'bin'));
  assert.equal(probe(join(runtime, 'python', 'bin', 'python3')).found, null, 'a linked folder that leaves the runtime is refused');
  await file(join(root, 'other', 'bin', 'python3'), 'fake', 0o755);
  assert.equal(probe(join(root, 'other', 'bin', 'python3')).found, null, 'an interpreter outside a python/ folder has no bundle');
});
