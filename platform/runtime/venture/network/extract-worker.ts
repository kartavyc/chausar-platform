// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the desktop's worker process for the owner's network
// files. app/desktop/network-files.cjs forks it (a separate Node process, as the engine's own worker is) for one file:
// it checks the file's size first, streams it through the pure extractor (extract.ts) with lines capped, and sends back
// only the projection, what Chausar keeps. Message text, descriptions, notes, photos and mail bodies never leave this
// process. It reads one path the owner picked in the system dialog, sends nothing anywhere else, refuses a projection
// too big to send before sending it, stops the moment the app goes away, and exits. The desktop starts it with a minimal
// environment and, where Node has it, the permission model (read the engine's code and the picked file only).
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_IMPORT_KINDS, type NetworkImportKind } from '../contracts.ts';
import { createExtractor } from './extract.ts';

/** The most a source file of each kind may be: a mail export is large and is read only by its headers. */
export const MAX_SOURCE_BYTES: Readonly<Record<NetworkImportKind, number>> = Object.freeze({
  'linkedin-connections': 64 * 1024 * 1024, 'linkedin-messages': 256 * 1024 * 1024, 'contacts-csv': 64 * 1024 * 1024, vcard: 256 * 1024 * 1024,
  'calendar-ics': 256 * 1024 * 1024, 'mail-headers': 64 * 1024 * 1024 * 1024,
});

export type ExtractRequest = {
  path: string; kind: NetworkImportKind; ownerAddresses?: string[]; ownerProfile?: string | null; timeZone?: string;
  maxSourceBytes?: number; maxSendBytes?: number; maxMessages?: number;
};
export type ExtractReply =
  | { ok: true; text: string; rows: number; people: number; dropped: [string, number][] }
  | { ok: false; error: { code: string; message: string } };

/** '6.2 MB' or '1.4 GB', in whole-number arithmetic. */
export function sizeWords(bytes: number): string {
  const unit = bytes >= 1024 ** 3 ? ['GB', 1024 ** 3] as const : ['MB', 1024 ** 2] as const;
  const tenths = Math.round((bytes * 10) / unit[1]);
  return `${Math.floor(tenths / 10)}.${tenths % 10} ${unit[0]}`;
}

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

/**
 * Any error as the reply's code and plain words. Chausar's own codes pass. A file too big to hold (a string or memory
 * limit) says so; a file outside what the worker may read, gone, or locked says that.
 */
export function workerFailure(error: unknown): { code: string; message: string } {
  const coded = error as { code?: unknown; message?: unknown } | null;
  const code = typeof coded?.code === 'string' ? coded.code : '';
  if (/^(?:NETWORK_|INVALID_)[A-Z_]{1,56}$/.test(code)) return { code, message: typeof coded?.message === 'string' ? coded.message.slice(0, 512) : 'This file could not be read.' };
  if (error instanceof RangeError || code === 'ERR_STRING_TOO_LONG' || code === 'ERR_OUT_OF_RANGE' || code === 'ERR_BUFFER_TOO_LARGE') {
    return { code: 'NETWORK_FILE_TOO_LARGE', message: 'This file is too big for Chausar to read at once. Export a smaller part and import each one.' };
  }
  if (code === 'ERR_ACCESS_DENIED') return { code: 'NETWORK_FILE_INVALID', message: 'Chausar may read only the file you picked. Pick it again.' };
  if (code === 'ENOENT') return { code: 'NETWORK_FILE_INVALID', message: 'That file is no longer there.' };
  return { code: 'NETWORK_FILE_INVALID', message: 'Chausar could not open that file. Check it is not open in another app, then try again.' };
}

/**
 * The file's text encoding from its first bytes: a byte-order mark (UTF-8, UTF-16 little or big end first), or the
 * zero bytes UTF-16 leaves in plain Latin text; UTF-8 otherwise.
 */
export function sniffEncoding(head: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' {
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  if (head.length >= 4 && head[0] !== 0 && head[1] === 0 && head[2] !== 0 && head[3] === 0) return 'utf-16le';
  if (head.length >= 4 && head[0] === 0 && head[1] !== 0 && head[2] === 0 && head[3] !== 0) return 'utf-16be';
  return 'utf-8';
}

/** Reads one file into its projection; refuses past the source size, and past maxSendBytes before anything is sent. */
export async function runExtract(request: ExtractRequest): Promise<ExtractReply> {
  try {
    if (!(NETWORK_IMPORT_KINDS as readonly string[]).includes(request.kind)) throw failure('INVALID_REQUEST', 'Choose one of the files Chausar reads.');
    const info = await stat(request.path);
    if (!info.isFile()) throw failure('NETWORK_FILE_INVALID', 'Choose a file, not a folder.');
    const limit = request.maxSourceBytes ?? MAX_SOURCE_BYTES[request.kind];
    if (info.size > limit) throw failure('NETWORK_FILE_TOO_LARGE', `This file is ${sizeWords(info.size)}; Chausar reads at most ${sizeWords(limit)} of this kind at once. Export a smaller part and import each one.`);
    const head = Buffer.alloc(4);
    const handle = await open(request.path, 'r');
    let got = 0;
    try { got = (await handle.read(head, 0, 4, 0)).bytesRead; } finally { await handle.close(); }
    const decoder = new TextDecoder(sniffEncoding(head.subarray(0, got)));
    const extractor = createExtractor(request.kind, {
      ownerAddresses: request.ownerAddresses, ownerProfile: request.ownerProfile, timeZone: request.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(request.maxMessages ? { maxMessages: request.maxMessages } : {}),
    });
    const stream = createReadStream(request.path, { highWaterMark: 256 * 1024 });
    try {
      for await (const chunk of stream) {
        if (stopped) throw failure('NETWORK_FILE_INVALID', 'The app stopped waiting for this file.');
        extractor.push(decoder.decode(chunk as Buffer, { stream: true }));
      }
      extractor.push(decoder.decode());
    } finally { stream.destroy(); }
    const projection = extractor.end();
    const text = JSON.stringify(projection);
    const sending = Buffer.byteLength(JSON.stringify(text));
    if (request.maxSendBytes !== undefined && sending > request.maxSendBytes) {
      throw failure('NETWORK_FILE_TOO_LARGE', `What Chausar keeps from this file is ${sizeWords(sending)}; the desktop app sends at most ${sizeWords(request.maxSendBytes)} at once. Export a smaller part and import each one.`);
    }
    return { ok: true, text, rows: projection.rows, people: projection.people.length, dropped: projection.dropped };
  } catch (error) {
    return { ok: false, error: workerFailure(error) };
  }
}

/** Set when the parent goes away: the read stops at the next chunk and the process exits. */
let stopped = false;

// Run as a process: one request in, one reply out, then exit.
const entry = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (entry && typeof process.send === 'function') {
  // The app went away (closed, crashed, or gave up waiting): stop at once rather than read on for nobody.
  process.once('disconnect', () => { stopped = true; process.exit(0); });
  process.once('message', async message => {
    const reply = await runExtract(message as ExtractRequest);
    if (process.connected) process.send!(reply, () => process.exit(0));
    else process.exit(0);
  });
}
