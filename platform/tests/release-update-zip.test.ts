import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { ReleaseManifest } from '../runtime/updater.ts';
import { InstallLayout } from '../runtime/native/update-install.ts';
import { readZipDirectory, unzipArchive, DEFAULT_ZIP_LIMITS } from '../runtime/native/update-zip.ts';

const code = (expected:string) => (error:any) => error.code === expected;
async function directory(t:any) { const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-zip-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

type Item = { name:string; data?:Buffer|string; method?:0|8; mode?:number; flags?:number; crc?:number; size?:number; madeBy?:number };
/** A tiny ZIP writer for tests: stored or deflate entries with Unix modes; fields can be overridden to forge bad archives. */
function zip(items:Item[], options:{ zip64Locator?:boolean; count?:number } = {}):Buffer {
  const locals:Buffer[] = [], centrals:Buffer[] = []; let offset = 0;
  for (const item of items) {
    const data = Buffer.from(item.data ?? ''), method = item.method ?? 8, body = method === 8 ? deflateRawSync(data) : data, name = Buffer.from(item.name);
    const crc = item.crc ?? crc32(data), size = item.size ?? data.length, flags = item.flags ?? 0x800;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(((item.madeBy ?? 3) << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(((item.mode ?? (item.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name); offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22), count = options.count ?? items.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const locator = options.zip64Locator ? Buffer.alloc(20) : Buffer.alloc(0); if (options.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([...locals, directory, locator, end]);
}
async function unpackBuffer(t:any, bytes:Buffer, limits = DEFAULT_ZIP_LIMITS) {
  const root = await directory(t), archive = join(root, 'a.zip'), out = join(root, 'out');
  await writeFile(archive, bytes); await mkdir(out);
  return { result: await unzipArchive(archive, out, limits), out };
}

test('zip: stored and deflate entries unpack with their bytes, folders and executable bits', async t => {
  const big = Buffer.from('chausar '.repeat(5000));
  const { result, out } = await unpackBuffer(t, zip([
    { name: 'chausar-1.1.0/' }, { name: 'chausar-1.1.0/chausar', data: '#!/bin/sh\necho hi\n', mode: 0o100755 },
    { name: 'chausar-1.1.0/resources/app.txt', data: big }, { name: 'chausar-1.1.0/stored.bin', data: Buffer.from([0, 1, 2, 3]), method: 0 },
    { name: 'empty.txt', data: '' }, { name: 'हिंदी.txt', data: 'नमस्ते' },
  ]));
  assert.deepEqual(result, { files: 5, bytes: 18 + big.length + 4 + 0 + Buffer.byteLength('नमस्ते') });
  assert.deepEqual(await readFile(join(out, 'chausar-1.1.0', 'resources', 'app.txt')), big);
  assert.deepEqual(await readFile(join(out, 'chausar-1.1.0', 'stored.bin')), Buffer.from([0, 1, 2, 3]));
  assert.equal(await readFile(join(out, 'हिंदी.txt'), 'utf8'), 'नमस्ते');
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(out, 'chausar-1.1.0', 'chausar'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(out, 'chausar-1.1.0', 'stored.bin'))).mode & 0o777, 0o600);
  }
});

test('zip: unsafe names, links, encryption, zip64, bad checksums and oversize entries refuse before or while unpacking', async t => {
  const cases:Array<[string, Buffer, string]> = [
    ['absolute', zip([{ name: '/etc/passwd', data: 'x' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['parent', zip([{ name: 'a/../../evil', data: 'x' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['dot', zip([{ name: './a', data: 'x' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['backslash', zip([{ name: 'a\\..\\evil', data: 'x' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['drive', zip([{ name: 'C:/evil', data: 'x' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['symlink', zip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]), 'INSTALL_UNSAFE_CONTENT'],
    ['device', zip([{ name: 'dev', data: '', mode: 0o020644 }]), 'INSTALL_UNSAFE_CONTENT'],
    ['encrypted', zip([{ name: 'secret', data: 'x', flags: 0x801 }]), 'INSTALL_UNSAFE_CONTENT'],
    ['zip64 locator', zip([{ name: 'a', data: 'x' }], { zip64Locator: true }), 'INSTALL_UNSAFE_CONTENT'],
    ['zip64 count', zip([{ name: 'a', data: 'x' }], { count: 0xffff }), 'INSTALL_UNSAFE_CONTENT'],
    ['duplicate', zip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['file as folder', zip([{ name: 'a', data: 'x' }, { name: 'a/b', data: 'y' }]), 'INSTALL_UNSAFE_CONTENT'],
    ['crc', zip([{ name: 'a', data: 'hello', crc: 1 }]), 'INSTALL_UNPACK_FAILED'],
    ['size lie', zip([{ name: 'a', data: 'hello world', size: 3 }]), 'INSTALL_UNPACK_FAILED'],
    ['bomb ratio', zip([{ name: 'a', data: Buffer.alloc(2 * 1024 * 1024) }]), 'INSTALL_UNSAFE_CONTENT'],
    ['method', zip([{ name: 'a', data: 'x', method: 12 as any }]), 'INSTALL_UNPACK_FAILED'],
    ['not a zip', Buffer.from('this is not a zip archive at all, only text'), 'INSTALL_UNPACK_FAILED'],
  ];
  for (const [label, bytes, expected] of cases) {
    const root = await directory(t), archive = join(root, 'a.zip'), out = join(root, 'out');
    await writeFile(archive, bytes); await mkdir(out);
    await assert.rejects(unzipArchive(archive, out), code(expected), label);
    if (expected === 'INSTALL_UNSAFE_CONTENT') assert.deepEqual(await readdir(out), [], `${label} wrote nothing`);
  }
  const root = await directory(t), archive = join(root, 'a.zip'); await writeFile(archive, zip([{ name: 'a', data: 'x'.repeat(100) }, { name: 'b', data: 'y' }]));
  await assert.rejects(readZipDirectory(archive, { ...DEFAULT_ZIP_LIMITS, maxEntries: 1 }), code('INSTALL_UNSAFE_CONTENT'));
  await assert.rejects(readZipDirectory(archive, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 50 }), code('INSTALL_UNSAFE_CONTENT'));
  await assert.rejects(readZipDirectory(archive, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 100 }), code('INSTALL_UNSAFE_CONTENT'));
  assert.equal((await readZipDirectory(archive)).length, 2);
});

const zipCli = spawnSync('zip', ['-v'], { shell: false }).status === 0;
test('zip: archives made by the zip tool unpack; a stored symlink (zip -y) refuses', { skip: !zipCli || process.platform === 'win32' }, async t => {
  const root = await directory(t), source = join(root, 'src'), app = join(source, 'chausar-1.1.0');
  await mkdir(join(app, 'resources'), { recursive: true });
  await writeFile(join(app, 'chausar'), '#!/bin/sh\nexit 0\n'); await chmod(join(app, 'chausar'), 0o755);
  await writeFile(join(app, 'resources', 'data.json'), JSON.stringify({ items: Array.from({ length: 2000 }, (_, i) => i) }));
  const archive = join(root, 'app.zip');
  assert.equal(spawnSync('zip', ['-r', '-q', archive, 'chausar-1.1.0'], { cwd: source, shell: false }).status, 0);
  const out = join(root, 'out'); await mkdir(out);
  const result = await unzipArchive(archive, out);
  assert.equal(result.files, 2);
  assert.deepEqual(await readFile(join(out, 'chausar-1.1.0', 'resources', 'data.json')), await readFile(join(app, 'resources', 'data.json')));
  assert.ok((await stat(join(out, 'chausar-1.1.0', 'chausar'))).mode & 0o100);
  await symlink('/etc/passwd', join(app, 'escape'));
  const linked = join(root, 'linked.zip');
  assert.equal(spawnSync('zip', ['-r', '-q', '-y', linked, 'chausar-1.1.0'], { cwd: source, shell: false }).status, 0);
  const out2 = join(root, 'out2'); await mkdir(out2);
  await assert.rejects(unzipArchive(linked, out2), code('INSTALL_UNSAFE_CONTENT'));
});

test('zip: the install layout swaps a zip artifact in with the built-in reader (no external tool)', async t => {
  const root = await directory(t), bytes = zip([{ name: 'Chausar/' }, { name: 'Chausar/chausar', data: 'binary', mode: 0o100755 }]), archive = join(root, 'staged.zip');
  await writeFile(archive, bytes);
  const manifest:ReleaseManifest = { schemaVersion: 1, version: '1.1.0', publishedAt: '2026-09-01T00:00:00.000Z', platform: process.platform as any, architecture: process.arch as any,
    url: 'https://downloads.example.com/chausar-1.1.0-linux-x64.zip', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  const layout = new InstallLayout({ installRoot: join(root, 'install') });
  const installed = await layout.install(archive, manifest);
  assert.equal(await readFile(join(installed.directory, 'Chausar', 'chausar'), 'utf8'), 'binary');
  const evil = zip([{ name: '../escape', data: 'x' }]), evilPath = join(root, 'evil.zip'); await writeFile(evilPath, evil);
  await layout.confirmHealthy('1.1.0');
  await assert.rejects(layout.install(evilPath, { ...manifest, version: '1.2.0', sha256: createHash('sha256').update(evil).digest('hex'), size: evil.length }), code('INSTALL_UNSAFE_CONTENT'));
  assert.ok(!(await readdir(join(root, 'install', 'versions'))).some(name => name.startsWith('.partial')));
});
