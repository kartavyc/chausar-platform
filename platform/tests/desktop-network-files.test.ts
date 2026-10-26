// Package 4D1 (Ink v2 wave 4): the desktop's network:pickFile channel. The owner picks one of their own files; the
// desktop checks its size first, forks a worker process that streams it through the pure extractor, and the window gets
// only what Chausar keeps (no message text, subject, body or note ever leaves the worker). main.cjs answers the channel
// only for the app's own window; the preload exposes it as pickNetworkFile. What the worker sends is what
// venture.network.import reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import type { NetworkImportResult } from '../runtime/venture/contracts.ts';
import { runExtract, workerFailure } from '../runtime/venture/network/extract-worker.ts';
import { setup } from './venture-views-env.ts';
import { MBOX, net, people, personNamed } from './venture-network-env.ts';

const require = createRequire(import.meta.url);
const files = require('../../app/desktop/network-files.cjs');
const contract = require('../../app/desktop/ipc-contract.cjs');
const WORKER = new URL('../runtime/venture/network/extract-worker.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OWNER = ['owner@ledger.example'];
const contents: any = { mainFrame: { url: 'chausar://app/index.html' } };
const window = { webContents: contents };
const trusted = { sender: contents, senderFrame: contents.mainFrame };

async function withFile(bytes: string | Buffer, name: string, run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-network-files-'));
  const path = join(directory, name);
  await writeFile(path, bytes);
  try { await run(path); } finally { await rm(directory, { recursive: true, force: true }); }
}

/** The handler with a dialog that picks the given path, the real worker, and every fork recorded. */
function picker(path: string, extra: Record<string, unknown> = {}) {
  const forks: { path: string; options: any }[] = [];
  const dialog = { showOpenDialog: async (_owner: unknown, options: any) => ({ canceled: false, filePaths: [path], options }) };
  const deps = {
    dialog, window, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, workerPath: WORKER, execPath: process.execPath,
    fork: (workerPath: string, args: string[], options: any) => { forks.push({ path: workerPath, options }); return require('node:child_process').fork(workerPath, args, options); },
    ...extra,
  };
  return { forks, pick: (input: unknown, event: unknown = trusted) => files.pickNetworkFile(event, input, deps) };
}

test('a mail export is read in a forked worker: the window gets per-person totals and nothing of the bodies, subjects or other headers', async () => {
  await withFile(MBOX, 'All mail.mbox', async path => {
    const { forks, pick } = picker(path);
    const reply = await pick({ kind: 'mail-headers', ownerAddresses: OWNER, timeZone: 'Asia/Kolkata' });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.deepEqual([reply.result.kind, reply.result.name, reply.result.rows, reply.result.people], ['mail-headers', 'All mail.mbox', 2, 2]);
    assert.equal(forks.length, 1);
    assert.equal(forks[0].path, WORKER, 'a worker process, not the window\'s');
    assert.deepEqual([forks[0].options.env.ELECTRON_RUN_AS_NODE, forks[0].options.execArgv.slice(0, 2), forks[0].options.stdio], ['1', ['--experimental-strip-types', '--permission'], ['ignore', 'ignore', 'ignore', 'ipc']]);
    for (const planted of ['12345678901', 'secret@body.example', 'gift box quote', 'I will look', 'owner@ledger.example']) assert.ok(!JSON.stringify(reply).includes(planted), `"${planted}" never leaves the worker`);
    const env = await setup();
    const imported = await net<Extract<NetworkImportResult, { mode: 'import' }>>(env, 'venture.network.import', { kind: 'mail-headers', name: reply.result.name, text: reply.result.text });
    assert.equal(imported.import.people, 2);
    assert.deepEqual((personNamed(env, 'Asha Rao').facts.find(fact => fact.kind === 'mail')!.detail as { sent: number; received: number }).received, 1);
  });
});

test('a mailbox with one byte that is not UTF-8 in a name keeps the address and drops the name, and imports', async () => {
  const head = Buffer.from('From x@y Thu Oct 02 09:31:12 +0000 2026\nDate: Thu, 2 Oct 2026 09:31:12 +0000\nFrom: Jos', 'latin1');
  const tail = Buffer.from(' <jose@x.example>\nTo: owner@o.example\n\nbody\n', 'latin1');
  await withFile(Buffer.concat([head, Buffer.from([0xe9]), tail]), 'a.mbox', async path => {
    const reply = await picker(path).pick({ kind: 'mail-headers', ownerAddresses: ['owner@o.example'] });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    const env = await setup();
    await net(env, 'venture.network.import', { kind: 'mail-headers', name: 'a.mbox', text: reply.result.text });
    assert.deepEqual(people(env).map(person => [person.name, person.handles.emails]), [['jose@x.example', ['jose@x.example']]]);
  });
});

test('a UTF-16 contacts export is read; a messages export that cannot tell who the owner is comes back refused, in words', async () => {
  const csv = '﻿Name,E-mail 1 - Value\r\nPriya Nair,priya@acme.example\r\n';
  await withFile(Buffer.from(csv, 'utf16le'), 'contacts.csv', async path => {
    const reply = await picker(path).pick({ kind: 'contacts-csv' });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.match(reply.result.text, /priya@acme\.example/);
  });
  const one = 'CONVERSATION ID,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,CONTENT\nc1,Asha,https://www.linkedin.com/in/asha,Me,https://www.linkedin.com/in/me,2026-10-01 09:00:00 UTC,Hello\n';
  await withFile(one, 'messages.csv', async path => {
    const reply = await picker(path).pick({ kind: 'linkedin-messages' });
    assert.deepEqual([reply.ok, reply.error.code], [false, 'NETWORK_FILE_INVALID']);
    assert.match(reply.error.message, /can't tell which person in this export is you/);
    const told = await picker(path).pick({ kind: 'linkedin-messages', ownerProfile: 'https://www.linkedin.com/in/me' });
    assert.equal(told.ok, true);
    assert.ok(!told.result.text.includes('Hello'));
  });
});

test('the size is checked before any worker starts, and what would be sent must fit one desktop request', async () => {
  await withFile(MBOX, 'big.mbox', async path => {
    const big = picker(path, { maxSourceBytes: 100 });
    const reply = await big.pick({ kind: 'mail-headers', ownerAddresses: OWNER });
    assert.deepEqual([reply.ok, reply.error.code], [false, 'NETWORK_FILE_TOO_LARGE']);
    assert.match(reply.error.message, /^This file is 0\.0 MB; Chausar reads at most 0\.0 MB of this kind at once\./);
    assert.equal(big.forks.length, 0, 'no worker for a file over the size');
    const wide = await picker(path, { maxSendBytes: 50 }).pick({ kind: 'mail-headers', ownerAddresses: OWNER });
    assert.deepEqual([wide.ok, wide.error.code], [false, 'NETWORK_FILE_TOO_LARGE']);
    assert.match(wide.error.message, /^What Chausar keeps from this file is .* MB; the desktop app sends at most .* MB at once\./);
  });
  assert.equal(files.MAX_SEND_BYTES < contract.MAX_REQUEST_BYTES, true);
  await withFile(MBOX, 'cap.mbox', async path => {
    const reply = await runExtract({ path, kind: 'mail-headers', ownerAddresses: OWNER, maxMessages: 1 });
    assert.deepEqual([reply.ok, !reply.ok && reply.error.code], [false, 'NETWORK_FILE_TOO_LARGE'], 'the worker stops at the message cap');
  });
});

test('pickNetworkFile answers only the app window, checks the request, never takes a path, and answers null when the owner cancels', async () => {
  await withFile(MBOX, 'x.mbox', async path => {
    const { pick, forks } = picker(path);
    const refused = await pick({ kind: 'mail-headers', ownerAddresses: OWNER }, { sender: {}, senderFrame: contents.mainFrame });
    assert.deepEqual([refused.ok, refused.error.code], [false, 'UNTRUSTED_SENDER']);
    for (const bad of [{}, { kind: 'x-archive' }, { kind: 'mail-headers' }, { kind: 'mail-headers', ownerAddresses: ['not an address'] }, { kind: 'vcard', path: '/etc/passwd' }]) {
      const reply = await pick(bad);
      assert.deepEqual([reply.ok, reply.error.code], [false, 'INVALID_REQUEST'], JSON.stringify(bad));
    }
    assert.equal(forks.length, 0);
    const cancelled = await files.pickNetworkFile(trusted, { kind: 'vcard' }, { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, window, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError, workerPath: WORKER });
    assert.deepEqual(cancelled, { ok: true, result: null });
  });
});

test('main.cjs registers the network:pickFile channel, and the preload exposes it as pickNetworkFile', async () => {
  const handlers = new Map<string, any>();
  const app = new EventEmitter() as any;
  app.isPackaged = true; app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => {};
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = () => {}; }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter { state = 'ready'; async start() {} async request() { return {}; } async updateJobLifecycle() { return { applied: true }; } async stop() { return { graceful: true }; } }
  const electron = {
    app, BrowserWindow: Window, Tray: class { setToolTip() {} setContextMenu() {} destroy() {} }, powerMonitor: new EventEmitter(), Menu: { buildFromTemplate: (items: any) => items },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, shell: {},
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } },
    dialog: { showErrorBox() {}, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) },
  };
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return contract;
    if (name === './network-files.cjs') return files;
    if (name === 'node:fs/promises') return { readFile: async (path: string) => (path.endsWith('package.json') ? JSON.stringify({ chausarPreview: true, version: '2.3.4' }) : ''), mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readdir: async () => [{ name: 'index.html', isDirectory: () => false, isFile: () => true }] };
    return require(name);
  }, process: { argv: ['electron', '/owned/app'], env: {}, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer });
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(contract.PICK_FILE_CHANNEL, 'chausar:network:pickFile');
  const handler = handlers.get(contract.PICK_FILE_CHANNEL);
  assert.equal(typeof handler, 'function', 'main.cjs answers the channel');
  const refused = await handler({ sender: {}, senderFrame: { url: 'chausar://app/index.html' } }, { kind: 'vcard' });
  assert.deepEqual([refused.ok, refused.error.code], [false, 'UNTRUSTED_SENDER']);

  const preload = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  let api: any;
  const calls: unknown[][] = [];
  const ipcRenderer = { invoke: async (...args: unknown[]) => { calls.push(args); return { ok: true, result: null }; }, on() {}, removeListener() {} };
  vm.runInNewContext(preload, { require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } } }) });
  assert.equal(await api.pickNetworkFile('mail-headers', { ownerAddresses: ['owner@ledger.example'] }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[contract.PICK_FILE_CHANNEL, { kind: 'mail-headers', ownerAddresses: ['owner@ledger.example'] }]], 'objects made in the preload\'s own context');
});

/** A child process stand-in: records the options and the request, and answers as the worker would. */
function fakeChild(reply: unknown) {
  const sent: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    send(message: unknown) { sent.push(message); setImmediate(() => child.emit('message', reply)); return true; },
    kill() { return true; },
  });
  return { child, sent };
}

test('the worker starts with a minimal environment and Node\'s permission model: it may read the code it runs and the one file picked', async () => {
  await withFile(MBOX, 'p.mbox', async path => {
    const seen: { options: any }[] = [];
    const fake = fakeChild({ ok: true, text: '{}', rows: 0, people: 0, dropped: [] });
    const reply = await files.pickNetworkFile(trusted, { kind: 'mail-headers', ownerAddresses: OWNER }, {
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path] }) }, window, assertTrustedSender: contract.assertTrustedSender, publicError: contract.publicError,
      workerPath: WORKER, execPath: process.execPath, env: { PATH: 'x', NODE_OPTIONS: '--require evil.js', SECRET_TOKEN: 'y', SystemRoot: 'C:\Windows' },
      fork: (_path: string, _args: string[], options: any) => { seen.push({ options }); return fake.child; },
    });
    assert.equal(reply.ok, true);
    const { options } = seen[0];
    assert.deepEqual(Object.keys(options.env).sort(), ['ELECTRON_RUN_AS_NODE', 'SystemRoot'], 'no NODE_OPTIONS, PATH or secrets reach the worker');
    const runtime = join(WORKER, '..', '..', '..');
    assert.deepEqual(options.execArgv, ['--experimental-strip-types', '--permission', `--allow-fs-read=${runtime}`, `--allow-fs-read=${path}`]);
    assert.deepEqual(fake.sent, [{ path, kind: 'mail-headers', ownerAddresses: OWNER, maxSourceBytes: files.MAX_SOURCE_BYTES['mail-headers'], maxSendBytes: files.MAX_SEND_BYTES }]);
  });
  await withFile(MBOX, 'real.mbox', async path => {
    await withFile('secret line', 'other.txt', async other => {
      const real = await picker(path).pick({ kind: 'mail-headers', ownerAddresses: OWNER });
      assert.equal(real.ok, true, 'the permissions given are enough to read the picked file');
      const { fork } = require('node:child_process');
      const child = fork(WORKER, [], { execArgv: ['--experimental-strip-types', '--permission', `--allow-fs-read=${join(WORKER, '..', '..', '..')}`, `--allow-fs-read=${path}`], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', env: { ELECTRON_RUN_AS_NODE: '1', SystemRoot: process.env.SystemRoot ?? '' } });
      const answer: any = await new Promise(resolve => { child.once('message', resolve); child.send({ path: other, kind: 'contacts-csv' }); });
      assert.deepEqual([answer.ok, answer.error.code], [false, 'NETWORK_FILE_INVALID']);
      assert.match(answer.error.message, /may read only the file you picked/);
    });
  });
});

test('the worker refuses output past maxSendBytes itself, before sending it; a file too big to hold says it is too big', async () => {
  await withFile(MBOX, 'm.mbox', async path => {
    const reply = await runExtract({ path, kind: 'mail-headers', ownerAddresses: OWNER, maxSendBytes: 50 });
    assert.deepEqual([reply.ok, !reply.ok && reply.error.code], [false, 'NETWORK_FILE_TOO_LARGE']);
    assert.match(!reply.ok ? reply.error.message : '', /^What Chausar keeps from this file is .* MB; the desktop app sends at most .* MB at once\./);
  });
  assert.deepEqual(workerFailure(Object.assign(new RangeError('Invalid string length'), { code: 'ERR_STRING_TOO_LONG' })).code, 'NETWORK_FILE_TOO_LARGE');
  assert.match(workerFailure(new RangeError('Invalid string length')).message, /too big/);
});

test('UTF-16 files with or without a byte-order mark are read', async () => {
  const csv = 'Name,E-mail 1 - Value\nA B,a@b.example\n';
  for (const [name, bytes] of [
    ['be.csv', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(csv, 'utf16le').swap16()])],
    ['le-nobom.csv', Buffer.from(csv, 'utf16le')],
    ['u8bom.csv', Buffer.from('\ufeff' + csv, 'utf8')],
  ] as const) {
    await withFile(bytes, name, async path => {
      const reply = await runExtract({ path, kind: 'contacts-csv' });
      assert.equal(reply.ok && reply.people, 1, `${name}: ${JSON.stringify(reply)}`);
    });
  }
});

// On Windows a parent's children die with it (libuv's job object); on macOS and Linux they do not. Either way, the worker
// must stop once the channel to the app is gone, so the test drops the channel while the app stays up.
test('the worker stops when its parent goes away, mid-read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-network-orphan-'));
  const path = join(directory, 'long.mbox');
  try {
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'w');
    await handle.write('From a@b Thu Oct 02 04:00:00 +0000 2026\nDate: Thu, 2 Oct 2026 04:00:00 +0000\nFrom: A <a@b.example>\nTo: o@o.example\n\n');
    const block = 'a body line of the mail that goes on and on\n'.repeat(23_000);
    for (let i = 0; i < 80; i += 1) await handle.write(block);
    await handle.close();
    const { fork } = require('node:child_process');
    const child = fork(WORKER, [], { execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' });
    const exited = new Promise<number>(resolve => child.once('exit', () => resolve(Date.now())));
    let replied = false;
    child.once('message', () => { replied = true; });
    child.send({ path, kind: 'mail-headers', ownerAddresses: ['o@o.example'], maxSourceBytes: 1e12 });
    await new Promise(resolve => setTimeout(resolve, 400));
    const dropped = Date.now();
    child.disconnect();
    const lived = (await Promise.race([exited, new Promise<number>(resolve => setTimeout(() => resolve(Date.now() + 1e6), 5000))])) - dropped;
    child.kill();
    assert.equal(replied, false, 'it was still reading when the channel went');
    assert.ok(lived < 250, `the worker lived ${lived} ms after its channel to the app went`);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 200));
    await rm(directory, { recursive: true, force: true });
  }
});
