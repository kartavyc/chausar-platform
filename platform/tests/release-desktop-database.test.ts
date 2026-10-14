import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { PostgresRunner } from '../runtime/native/postgres-lifecycle.ts';
import { verifyRuntimeInventory } from '../runtime/native/runtime-inventory.ts';
import { startDesktopDatabase } from '../runtime/native/desktop-database.ts';

const code = (expected:string) => (error:any) => error.code === expected;
async function directory(t:any) { const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-desktop-db-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
const sha = (bytes:Buffer|string) => createHash('sha256').update(bytes).digest('hex');

/** A synthetic runtime-binaries tree and its manifest, in the stage-runtime.ts schema. `listed` adds manifest-only entries. */
async function runtime(root:string, options:{ listed?:Array<{ path:string; body:string }>; platform?:string; arch?:string } = {}) {
  const files:Record<string, string> = {
    'postgres/bin/postgres': '#!/bin/sh\n# synthetic postgres\n', 'postgres/bin/initdb': '#!/bin/sh\n# synthetic initdb\n',
    'postgres/bin/pg_ctl': '#!/bin/sh\n# synthetic pg_ctl\n', 'postgres/bin/pg_upgrade': '#!/bin/sh\n# synthetic pg_upgrade\n',
    'postgres/share/postgres.bki': 'synthetic catalogue\n', 'python/bin/python3': '#!/bin/sh\n# synthetic python\n', 'README.md': '# runtime\n',
  };
  for (const [path, body] of Object.entries(files)) { await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true }); await writeFile(join(root, ...path.split('/')), body); await chmod(join(root, ...path.split('/')), 0o755); }
  const entries = [...Object.entries(files), ...(options.listed ?? []).map(item => [item.path, item.body] as const)].map(([path, body]) => ({ path, sha256: sha(body), size: Buffer.byteLength(body) }))
    .sort((a, b) => a.path < b.path ? -1 : 1);
  const manifest = { schemaVersion: 1, platform: options.platform ?? process.platform, architecture: options.arch ?? process.arch,
    components: { postgres: { version: '17.6', source: 'https://example.com/pg.tar.gz', license: 'PostgreSQL', licenseFile: 'postgres/LICENSE' }, python: { version: '3.12.7', source: 'https://example.com/py.tar.gz', license: 'PSF-2.0', licenseFile: 'python/LICENSE' } },
    files: entries };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

test('inventory: every listed file is hashed once per version; a listed dotfile electron-builder dropped is tolerated', async t => {
  const root = await directory(t), bins = join(root, 'runtime-binaries'), receipts = join(root, 'user-data', 'release');
  await runtime(bins, { listed: [{ path: '.gitignore', body: '*\n!README.md\n' }] });
  const first = await verifyRuntimeInventory({ runtimeRoot: bins, appVersion: '0.1.0', receiptDirectory: receipts });
  assert.equal(first.cached, false); assert.equal(first.files, 7); assert.deepEqual(first.skippedDotfiles, ['.gitignore']);
  assert.deepEqual(await readdir(receipts), ['runtime-inventory.json']);
  assert.equal((await verifyRuntimeInventory({ runtimeRoot: bins, appVersion: '0.1.0', receiptDirectory: receipts })).cached, true);
  // A new app version hashes again.
  assert.equal((await verifyRuntimeInventory({ runtimeRoot: bins, appVersion: '0.1.1', receiptDirectory: receipts })).cached, false);
  // An unlisted dotfile is ignored too (for example a packager's marker).
  await writeFile(join(bins, '.DS_Store'), 'x');
  assert.equal((await verifyRuntimeInventory({ runtimeRoot: bins, appVersion: '0.1.1', receiptDirectory: receipts })).verified, true);
});

test('inventory: a missing, changed or unexpected file refuses, even behind a receipt', async t => {
  const root = await directory(t), receipts = join(root, 'release');
  const fresh = async (name:string) => { const bins = join(root, name); await runtime(bins); await verifyRuntimeInventory({ runtimeRoot: bins, appVersion: '0.1.0', receiptDirectory: join(receipts, name) }); return bins; };
  const missing = await fresh('missing'); await rm(join(missing, 'postgres', 'bin', 'initdb'));
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: missing, appVersion: '0.1.0', receiptDirectory: join(receipts, 'missing') }), code('RUNTIME_FILE_MISSING'));
  // Same size, different bytes, later timestamp: the receipt no longer matches, so the file is hashed again.
  const changed = await fresh('changed'), target = join(changed, 'postgres', 'bin', 'postgres');
  await writeFile(target, '#!/bin/sh\n# synthetic POSTGRES\n'); const later = new Date(Date.now() + 5000); await utimes(target, later, later);
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: changed, appVersion: '0.1.0', receiptDirectory: join(receipts, 'changed') }), code('RUNTIME_FILE_CHANGED'));
  const grown = await fresh('grown'); await writeFile(join(grown, 'README.md'), '# runtime, longer now\n');
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: grown, appVersion: '0.1.0', receiptDirectory: join(receipts, 'grown') }), code('RUNTIME_FILE_CHANGED'));
  const extra = await fresh('extra'); await writeFile(join(extra, 'postgres', 'bin', 'libplanted.so'), 'x');
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: extra, appVersion: '0.1.0', receiptDirectory: join(receipts, 'extra') }), code('RUNTIME_FILE_UNEXPECTED'));
  const listedMissing = join(root, 'listed'); await runtime(listedMissing, { listed: [{ path: 'postgres/lib/libpq.so', body: 'lib' }] });
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: listedMissing, appVersion: '0.1.0' }), code('RUNTIME_FILE_MISSING'));
  const other = join(root, 'other'); await runtime(other, { platform: process.platform === 'win32' ? 'linux' : 'win32' });
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: other, appVersion: '0.1.0' }), code('RUNTIME_MANIFEST_TARGET'));
  const bad = join(root, 'bad'); await runtime(bad, { listed: [{ path: '../escape', body: 'x' }] });
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: bad, appVersion: '0.1.0' }), code('RUNTIME_MANIFEST_INVALID'));
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: join(root, 'absent'), appVersion: '0.1.0' }), code('RUNTIME_MANIFEST_MISSING'));
  const unlisted = join(root, 'no-manifest'); await runtime(unlisted); await rm(join(unlisted, 'manifest.json'));
  await assert.rejects(verifyRuntimeInventory({ runtimeRoot: unlisted, appVersion: '0.1.0' }), code('RUNTIME_MANIFEST_MISSING'));
});

/** initdb writes PG_VERSION; the server is a TCP listener with a postmaster.pid; pg_ctl stop closes it. */
function fakeRunner(bundled = '17.6') {
  const servers = new Map<string, Server>(), calls:string[] = [];
  const option = (args:string[], flag:string) => args[args.indexOf(flag) + 1];
  const runner:PostgresRunner = {
    async run(executable, args) {
      const name = basename(executable); calls.push(`${name} ${args[0]}`);
      const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
      if (name === 'postgres' && args[0] === '--version') return { ...ok, stdout: `postgres (PostgreSQL) ${bundled}\n` };
      if (name === 'initdb') { await mkdir(option(args, '-D'), { recursive: true }); await writeFile(join(option(args, '-D'), 'PG_VERSION'), `${bundled.split('.')[0]}\n`); return ok; }
      if (name === 'pg_ctl' && args[0] === 'stop') {
        const directory = option(args, '-D'), server = servers.get(directory);
        if (!server) return { ...ok, code: 1 };
        await new Promise<void>(accept => server.close(() => accept())); servers.delete(directory); await rm(join(directory, 'postmaster.pid'), { force: true }); return ok;
      }
      return { ...ok, code: 127 };
    },
    spawnServer(executable, args) {
      const directory = option(args, '-D'), port = Number(option(args, '-p')), server = createServer(socket => socket.destroy());
      calls.push(`${basename(executable)} server`); servers.set(directory, server);
      writeFileSync(join(directory, 'postmaster.pid'), `${process.pid}\n${directory}\n`);
      server.listen(port, '127.0.0.1');
      return { pid: process.pid, exitStatus: () => ({ exited: !servers.has(directory), code: null, failed: false }), kill: () => { server.close(); servers.delete(directory); } };
    },
  };
  return { runner, calls };
}

test('desktop start-up: checks the runtime, initialises userData/database, recovers a stale lock, and stops cleanly', async t => {
  const root = await directory(t), bins = join(root, 'resources', 'runtime-binaries'), data = join(root, 'user-data', 'database');
  await runtime(bins);
  const fake = fakeRunner(), options = { runtimeRoot: bins, dataRoot: data, receiptDirectory: join(root, 'user-data', 'release'), appVersion: '0.1.0', postgres: { runner: fake.runner, portRange: [55600, 55699] as [number, number] } };
  const first = await startDesktopDatabase(options);
  assert.equal(first.state, 'running');
  assert.ok(first.state === 'running' && /^postgresql:\/\/chausar:[A-Za-z0-9_-]{43}@127\.0\.0\.1:556\d\d\/postgres$/.test(first.url));
  assert.deepEqual((await readdir(data)).sort(), ['chausar-cluster.json', 'cluster', 'database-password']);
  assert.equal(first.inventory.cached, false);
  await first.close();
  // A crash leaves a postmaster.pid naming a dead process; the next launch records the recovery and starts.
  await writeFile(join(data, 'cluster', 'postmaster.pid'), '2147483646\n');
  const second = await startDesktopDatabase(options);
  assert.equal(second.state, 'running'); assert.equal(second.inventory.cached, true);
  const record = JSON.parse(await readFile(join(data, 'chausar-cluster.json'), 'utf8'));
  assert.ok(record.events.some((event:any) => event.kind === 'stale-lock-recovered'));
  await second.close();
  assert.equal(fake.calls.filter(call => call.startsWith('initdb')).length, 1);
});

test('desktop start-up: an older cluster is reported for upgrade without being touched; a newer cluster and a changed runtime refuse', async t => {
  const root = await directory(t), bins = join(root, 'runtime-binaries'); await runtime(bins);
  const older = join(root, 'older'); await mkdir(join(older, 'cluster'), { recursive: true }); await writeFile(join(older, 'cluster', 'PG_VERSION'), '16\n');
  const fake = fakeRunner();
  const upgrade = await startDesktopDatabase({ runtimeRoot: bins, dataRoot: older, receiptDirectory: join(root, 'release'), appVersion: '0.1.0', postgres: { runner: fake.runner } });
  assert.equal(upgrade.state, 'needs-upgrade');
  assert.ok(upgrade.state === 'needs-upgrade' && upgrade.code === 'POSTGRES_UPGRADE_REQUIRED');
  assert.deepEqual(await readdir(join(older, 'cluster')), ['PG_VERSION']);
  assert.ok(!fake.calls.some(call => /initdb|server|pg_upgrade/.test(call)));
  const newer = join(root, 'newer'); await mkdir(join(newer, 'cluster'), { recursive: true }); await writeFile(join(newer, 'cluster', 'PG_VERSION'), '18\n');
  await assert.rejects(startDesktopDatabase({ runtimeRoot: bins, dataRoot: newer, receiptDirectory: join(root, 'release'), appVersion: '0.1.0', postgres: { runner: fake.runner } }), code('DATABASE_NEWER_THAN_APP'));
  await writeFile(join(bins, 'postgres', 'bin', 'pg_ctl'), 'tampered');
  await assert.rejects(startDesktopDatabase({ runtimeRoot: bins, dataRoot: join(root, 'fresh'), receiptDirectory: join(root, 'release'), appVersion: '0.1.0', postgres: { runner: fake.runner } }), code('RUNTIME_FILE_CHANGED'));
});
