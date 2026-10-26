'use strict';
// Chausar desktop (Ink v2 wave 4, package 4D1): the network:pickFile channel. The owner picks one of their own files
// (LinkedIn's Connections or Messages export, a contacts CSV or vCard, a calendar ICS, a mail export) in the system
// dialog. This file checks the file's size first, then forks a worker process (platform/runtime/venture/network/
// extract-worker.ts, a separate Node process like the engine's own worker, never the window's process) that streams the
// file through the pure extractor and sends back only what Chausar keeps: names, handles, roles and per-person totals.
// Message text, descriptions, notes, photos and mail bodies stay on this computer. The window then imports the text.
// main.cjs passes Electron's dialog and the window in; this file never requires Electron itself.
const { fork } = require('node:child_process');
const { stat } = require('node:fs/promises');
const { basename, resolve } = require('node:path');

const KINDS = Object.freeze(['linkedin-connections', 'linkedin-messages', 'contacts-csv', 'vcard', 'calendar-ics', 'mail-headers']);
// A copy of MAX_SOURCE_BYTES in extract-worker.ts, checked before the worker starts.
const MAX_SOURCE_BYTES = Object.freeze({
  'linkedin-connections': 64 * 1024 * 1024, 'linkedin-messages': 256 * 1024 * 1024, 'contacts-csv': 64 * 1024 * 1024, vcard: 256 * 1024 * 1024,
  'calendar-ics': 256 * 1024 * 1024, 'mail-headers': 64 * 1024 * 1024 * 1024,
});
// What the window may send in one request (ipc-contract.cjs MAX_REQUEST_BYTES is 2,000,000), with room for the rest of it.
const MAX_SEND_BYTES = 1_900_000;
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const FILTERS = Object.freeze({
  'linkedin-connections': [{ name: 'LinkedIn Connections (CSV)', extensions: ['csv'] }],
  'linkedin-messages': [{ name: 'LinkedIn messages (CSV)', extensions: ['csv'] }],
  'contacts-csv': [{ name: 'Contacts (CSV)', extensions: ['csv'] }],
  vcard: [{ name: 'Contacts (vCard)', extensions: ['vcf', 'vcard'] }],
  'calendar-ics': [{ name: 'Calendar (ICS)', extensions: ['ics', 'ical'] }],
  'mail-headers': [{ name: 'Mail export (mbox)', extensions: ['mbox', 'mbx'] }, { name: 'All files', extensions: ['*'] }],
});

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

/** '6.2 MB' or '1.4 GB'. */
function sizeWords(bytes) {
  const [unit, size] = bytes >= 1024 ** 3 ? ['GB', 1024 ** 3] : ['MB', 1024 ** 2];
  const tenths = Math.round((bytes * 10) / size);
  return `${Math.floor(tenths / 10)}.${tenths % 10} ${unit}`;
}

/**
 * The pick request: the kind, and for mail the owner's own addresses (one to ten); optionally the owner's LinkedIn
 * address (for a messages export that cannot tell who the owner is) and their time zone. Never a path: the owner picks.
 */
function pickRequest(input) {
  const bad = () => failure('INVALID_REQUEST', 'Choose a kind of file, and for mail the addresses you send from.');
  if (!isRecord(input) || Object.keys(input).some(key => !['kind', 'ownerAddresses', 'ownerProfile', 'timeZone'].includes(key)) || !KINDS.includes(input.kind)) throw bad();
  const request = { kind: input.kind };
  if (input.ownerAddresses !== undefined || input.kind === 'mail-headers') {
    if (!Array.isArray(input.ownerAddresses) || input.ownerAddresses.length < 1 || input.ownerAddresses.length > 10) throw bad();
    request.ownerAddresses = input.ownerAddresses.map(address => {
      const email = typeof address === 'string' ? address.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw bad();
      return email;
    });
  }
  if (input.ownerProfile !== undefined) {
    if (typeof input.ownerProfile !== 'string' || input.ownerProfile.length > 300) throw bad();
    request.ownerProfile = input.ownerProfile;
  }
  if (input.timeZone !== undefined) {
    if (typeof input.timeZone !== 'string' || !/^[A-Za-z_+\-/0-9]{1,64}$/.test(input.timeZone)) throw bad();
    request.timeZone = input.timeZone;
  }
  return request;
}

/**
 * The worker's environment: only what Node needs to start (SystemRoot on Windows) and ELECTRON_RUN_AS_NODE. Nothing of
 * the app's environment (NODE_OPTIONS, PATH, keys) reaches it.
 */
function workerEnv(env) {
  return { ELECTRON_RUN_AS_NODE: '1', ...(typeof env.SystemRoot === 'string' ? { SystemRoot: env.SystemRoot } : {}) };
}

/**
 * The worker's Node flags. Where this Node has the permission model (Node 22 and later; checked through
 * allowedNodeEnvironmentFlags, so an Electron whose Node lacks it still starts the worker), the worker may read only the
 * engine's own code (platform/runtime, which it loads) and the one file the owner picked, and may not start processes.
 */
function workerFlags(deps, path) {
  const flags = deps.nodeFlags ?? process.allowedNodeEnvironmentFlags;
  const permission = !!flags && typeof flags.has === 'function' && flags.has('--permission') && !path.includes(',');
  return ['--experimental-strip-types', ...(permission ? ['--permission', `--allow-fs-read=${resolve(deps.workerPath, '..', '..', '..')}`, `--allow-fs-read=${path}`] : [])];
}

/** Forks the worker for one file and waits for its one reply; kills it after the timeout. */
function forkExtract(request, deps) {
  return new Promise((resolve, reject) => {
    const child = (deps.fork ?? fork)(deps.workerPath, [], {
      execPath: deps.execPath ?? process.execPath, execArgv: workerFlags(deps, request.path), windowsHide: true, shell: false,
      env: workerEnv(deps.env ?? process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
    });
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill(); } catch { /* gone already */ } fn(value); };
    const timer = setTimeout(() => done(reject, failure('NETWORK_FILE_TOO_LARGE', 'Reading this file took more than ten minutes. Export a shorter date range and import each part.')), deps.timeoutMs ?? WORKER_TIMEOUT_MS);
    child.once('message', reply => done(resolve, reply));
    child.once('error', () => done(reject, failure('NETWORK_FILE_INVALID', 'Chausar could not start reading that file. Try again.')));
    child.once('exit', () => done(reject, failure('NETWORK_FILE_INVALID', 'Chausar stopped reading that file before it finished. Try again.')));
    child.send(request);
  });
}

/**
 * The network:pickFile channel. Only the app's own window may ask. Answers { ok: true, result } (null when the owner
 * cancels) or { ok: false, error }. result: { kind, name, text, rows, people, dropped, line }, text being the projection
 * the window sends to venture.network.import.
 */
async function pickNetworkFile(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const request = pickRequest(input);
    const choice = await deps.dialog.showOpenDialog(deps.window, {
      title: 'Choose your file', buttonLabel: 'Read it here', properties: ['openFile'], filters: FILTERS[request.kind],
    });
    if (!choice || choice.canceled || !choice.filePaths || !choice.filePaths[0]) return { ok: true, result: null };
    const path = choice.filePaths[0];
    const limit = deps.maxSourceBytes ?? MAX_SOURCE_BYTES[request.kind];
    const info = await (deps.stat ?? stat)(path);
    if (!info.isFile()) throw failure('NETWORK_FILE_INVALID', 'Choose a file, not a folder.');
    if (info.size > limit) throw failure('NETWORK_FILE_TOO_LARGE', `This file is ${sizeWords(info.size)}; Chausar reads at most ${sizeWords(limit)} of this kind at once. Export a smaller part and import each one.`);
    const reply = await forkExtract({ path, ...request, maxSourceBytes: limit, maxSendBytes: deps.maxSendBytes ?? MAX_SEND_BYTES }, deps);
    if (!isRecord(reply) || reply.ok !== true) {
      const error = isRecord(reply) && isRecord(reply.error) ? reply.error : {};
      throw failure(typeof error.code === 'string' ? error.code : 'NETWORK_FILE_INVALID', typeof error.message === 'string' ? error.message : 'This file could not be read.');
    }
    if (typeof reply.text !== 'string') throw failure('NETWORK_FILE_INVALID', 'This file could not be read.');
    const sending = Buffer.byteLength(JSON.stringify(reply.text));
    if (sending > (deps.maxSendBytes ?? MAX_SEND_BYTES)) {
      throw failure('NETWORK_FILE_TOO_LARGE', `What Chausar keeps from this file is ${sizeWords(sending)}; the desktop app sends at most ${sizeWords(deps.maxSendBytes ?? MAX_SEND_BYTES)} at once. Export a smaller part and import each one.`);
    }
    const people = Number.isSafeInteger(reply.people) ? reply.people : 0;
    return {
      ok: true,
      result: {
        kind: request.kind, name: basename(path), text: reply.text, rows: Number.isSafeInteger(reply.rows) ? reply.rows : 0, people, dropped: Array.isArray(reply.dropped) ? reply.dropped : [],
        line: `Read ${people.toLocaleString('en-US')} ${people === 1 ? 'person' : 'people'} from ${basename(path)} on this computer. Message text and everything else Chausar doesn't keep stayed here.`,
      },
    };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ KINDS, MAX_SOURCE_BYTES, MAX_SEND_BYTES, pickNetworkFile, sizeWords });
