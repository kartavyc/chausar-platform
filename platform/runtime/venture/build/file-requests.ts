// Chausar venture launcher, the client's file request link (Ink v2 wave 4, package 4J7, catalogue K9): the write-only
// twin of share links. venture.share.request { orderId, note? } (approve, inside the app) makes a single-use link,
// valid for 15 minutes, at /share/<token>/upload on the hosted web server with a public address; anywhere else it is
// kept but has no address, and says so. The record keeps the token's sha256 only, and nothing about the client.
// The trusted host entry point (fileRequestEntry, reached only by the hosted server's upload route, never an RPC):
// - page: what the upload page shows, or why it no longer opens; a token that never opened anything is null.
// - claim: the in-flight lock, taken before the server reads the file, so a second upload at once is SHARE_USED. A lock
//   that never finished frees itself after LOCK_MS.
// - store: the file, under the lock: at most MAX_UPLOAD_BYTES, its type checked by its bytes (delivery/harness/files.ts
//   sniffFormat), kept as a file of the order under a name Chausar chose ('client-upload-1.csv'), so agents see only its
//   id, kind and size until files.read, which the untrusted screen covers. The client's own file name goes through the
//   untrusted screen and is kept for the owner only (null when held). The link is used then: a second use is SHARE_USED.
// - release: frees the lock after a refused file, so the client can try again while the link lasts.
// A use after the 15 minutes is SHARE_EXPIRED. DPDP: Forget erases a forgotten person's name from the note and from a
// client's file name (eraseFileRequestsNaming, called by network/forget.ts).
import { createHash, randomBytes } from 'node:crypto';
import { check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { Display, FileRequestRecord, FileRequestView, ShareLinkStoredRecord, UploadFormat, UploadRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, digest, exactPayload, formatVentureDate, identifier, listRecords, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../records.ts';
import { localTimeAt } from '../local-day.ts';
import { HOSTED_NO_PDF, MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_ORDER, sniffFormat, tablesOfFile, type FileLike } from '../delivery/harness/files.ts';
import { HELD_WORDS, screenUntrusted } from '../policy/untrusted.ts';

export const FILE_REQUEST_MINUTES = 15;
/** How long an upload may hold the link before its lock frees itself. */
export const LOCK_MS = 2 * 60_000;
export const FILE_REQUEST_LINE = "The file goes straight to this server and is kept with this order. It never passes through the model's context.";
export const FILE_REQUEST_WORDS = Object.freeze({
  notServed: 'File request links open only on the hosted Chausar with a public address. Ask your client to send the file, and add it to the order yourself.',
  used: 'This link was already used. Ask whoever sent it for a new one.',
  busy: 'A file is being sent through this link right now. Wait a minute, then try again if it did not arrive.',
  ended: 'This link has ended. Ask whoever sent it for a new one.',
  erased: 'Erased: words that named someone you asked Chausar to forget.',
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function publicOrigin(deps: VentureDeps): string | null {
  return deps.host === 'hosted-web' && typeof deps.publicUrl === 'string' && deps.publicUrl ? deps.publicUrl.replace(/\/+$/, '') : null;
}

/** The order's files, the client's and Chausar's alike, as the order file limit counts them. */
function orderUploads(list: readonly UploadRecord[], orderId: string): UploadRecord[] {
  return list.filter(upload => upload.scope.kind === 'order' && upload.scope.orderId === orderId);
}

/** venture.share.request { orderId, note? } (approve, inside the app): one single-use upload link for the order. */
export async function shareRequestHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FileRequestView> {
  requireAppChannel(ctx, 'venture.share.request');
  const body = exactPayload(payload, ['orderId', 'note'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const note = body.note === undefined || body.note === '' ? null : singleLine(body.note, 'The note', { max: 300 });
  const origin = publicOrigin(deps);
  return ventureAction(deps, ctx, 'approve', 'share.request', tx => {
    const order = tx.find('venture-order', orderId);
    check(order && order.status !== 'cancelled', 'ORDER_NOT_FOUND', 'That order was not found, or it was cancelled.');
    check(orderUploads(tx.list('venture-upload'), orderId).length < MAX_UPLOADS_PER_ORDER, 'UPLOAD_LIMIT', `An order holds at most ${MAX_UPLOADS_PER_ORDER} files.`);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.parse(tx.now) + FILE_REQUEST_MINUTES * 60_000).toISOString();
    const record = tx.put<FileRequestRecord>({ ...tx.base('venture-file-request'), orderId, note, tokenHash: sha256(token), expiresAt, lockedAt: null, usedAt: null, uploadId: null });
    return {
      id: record.id, orderId, url: origin ? `${origin}/share/${token}/upload` : null, ...(origin ? {} : { reason: FILE_REQUEST_WORDS.notServed }),
      expiresAt, line: FILE_REQUEST_LINE,
    };
  });
}

/** The request a token belongs to, or null. */
function requestOf(state: State, venture: VentureRecord, token: unknown): FileRequestRecord | null {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const hash = sha256(token);
  return listRecords(state, 'venture-file-request', venture.id).find(item => item.tokenHash === hash) ?? null;
}

/** Why a request can't take a file now, as code and words, or null when it can. */
function closedReason(record: FileRequestRecord, nowIso: string): { code: 'SHARE_USED' | 'SHARE_EXPIRED'; line: Display } | null {
  if (record.usedAt) return { code: 'SHARE_USED', line: FILE_REQUEST_WORDS.used };
  if (Date.parse(record.expiresAt) <= Date.parse(nowIso)) return { code: 'SHARE_EXPIRED', line: FILE_REQUEST_WORDS.ended };
  return null;
}

const locked = (record: FileRequestRecord, nowIso: string) => !!record.lockedAt && Date.parse(nowIso) - Date.parse(record.lockedAt) < LOCK_MS;

/** What the upload page shows. Text only; the page escapes it. */
export type FileRequestPage =
  | { open: true; businessName: string; note: string | null; line: Display; expires: Display; maxBytes: number }
  | { open: false; businessName: string; reason: Display };

/** The extension a stored file gets, from the kind its bytes proved and the name the client gave. */
function extensionOf(format: UploadFormat, name: string): string {
  if (format === 'transcript') return name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
  return format;
}

/** The client's own file name for the owner, screened: null when the screen held it. */
function screenedName(name: string): string | null {
  const screened = screenUntrusted({ source: 'client-file', text: name }, { mode: 'enforce' });
  if (screened.status === 'quarantined' || screened.text === null || screened.text === HELD_WORDS) return null;
  return screened.text.slice(0, 120);
}

/** The file, checked before anything is written: a size cap, a type proved by its bytes, a table the tools can read. */
function checkedFile(deps: VentureDeps, input: { name: unknown; contentBase64: unknown }): { name: string; format: UploadFormat; encoded: string; bytes: number } {
  check(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200 && !CONTROL.test(input.name), 'INVALID_VENTURE_REQUEST', 'Choose a file with a plain name.');
  const encoded = input.contentBase64;
  check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'UPLOAD_LIMIT', 'Send a file smaller than one and a half megabytes.');
  const bytes = Buffer.from(encoded, 'base64');
  check(bytes.length > 0 && bytes.length <= MAX_UPLOAD_BYTES, 'UPLOAD_LIMIT', 'Send a file smaller than one and a half megabytes.');
  const name = input.name.trim();
  const format = sniffFormat(name, bytes);
  check(!(format === 'pdf' && deps.host === 'hosted-web'), 'TIER_UNAVAILABLE', HOSTED_NO_PDF);
  const file: FileLike = { id: 'upload_check', name, format, bytes: bytes.length, digest: digest(encoded), contentBase64: encoded, clientData: true };
  if (format === 'csv' || format === 'xlsx') tablesOfFile(file);
  return { name, format, encoded, bytes: bytes.length };
}

/** One step of the upload page; see the top of this file. Trusted host only. */
export async function fileRequestEntry(deps: VentureDeps, ctx: Context, token: unknown, input: Record<string, unknown>): Promise<unknown> {
  const step = input?.step;
  check(step === 'page' || step === 'claim' || step === 'store' || step === 'release', 'INVALID_VENTURE_REQUEST', 'Open the page or send the file.');
  if (step === 'page') {
    const state = deps.store.read();
    const venture = currentVenture(state);
    const record = venture ? requestOf(state, venture, token) : null;
    if (!venture || !record) return null;
    const now = deps.clock().toISOString();
    const closed = closedReason(record, now);
    if (closed) return { open: false, businessName: venture.workingName, reason: closed.line } satisfies FileRequestPage;
    const country = venture.country;
    const expires = country ? `${formatVentureDate(record.expiresAt.slice(0, 10), country.dateOrder)} at ${localTimeAt(record.expiresAt, country).slice(11, 16)}` : record.expiresAt.slice(11, 16);
    return { open: true, businessName: venture.workingName, note: record.note, line: FILE_REQUEST_LINE, expires, maxBytes: MAX_UPLOAD_BYTES } satisfies FileRequestPage;
  }
  if (step === 'store') {
    const file = checkedFile(deps, { name: input.name, contentBase64: input.contentBase64 });
    const lock = input.lock;
    return ventureAction(deps, ctx, 'prepare', 'share.request.store', tx => {
      const record = requestOf(tx.state, tx.venture!, token);
      if (!record) throw new ChausarError('SHARE_EXPIRED', FILE_REQUEST_WORDS.ended);
      if (record.usedAt) throw new ChausarError('SHARE_USED', FILE_REQUEST_WORDS.used);
      // Only the upload that holds the lock stores; it took the lock while the link still opened.
      check(typeof lock === 'string' && record.lockedAt === lock && locked(record, tx.now), 'SHARE_USED', FILE_REQUEST_WORDS.busy);
      const order = tx.find('venture-order', record.orderId);
      check(order && order.status !== 'cancelled', 'ORDER_NOT_FOUND', 'This order is no longer open.');
      const uploads = orderUploads(tx.list('venture-upload'), record.orderId);
      check(uploads.length < MAX_UPLOADS_PER_ORDER, 'UPLOAD_LIMIT', `An order holds at most ${MAX_UPLOADS_PER_ORDER} files.`);
      const n = uploads.filter(upload => upload.origin === 'client-link').length + 1;
      const upload = tx.put<UploadRecord>({
        ...tx.base('venture-upload'), name: `client-upload-${n}.${extensionOf(file.format, file.name)}`, format: file.format, bytes: file.bytes,
        digest: digest(file.encoded), contentBase64: file.encoded, scope: { kind: 'order', orderId: record.orderId }, clientData: true,
        origin: 'client-link', fileRequestId: record.id, clientName: screenedName(file.name),
      });
      tx.replace<FileRequestRecord>({ ...record, usedAt: tx.now, lockedAt: null, uploadId: upload.id });
      // The event never carries a file name.
      tx.emit('upload-added', { uploadId: upload.id, orderId: record.orderId, format: file.format });
      return { stored: true, bytes: file.bytes };
    });
  }
  const lock = input.lock;
  return ventureAction(deps, ctx, 'prepare', `share.request.${step}`, tx => {
    const record = requestOf(tx.state, tx.venture!, token);
    if (step === 'release') {
      if (record && !record.usedAt && typeof lock === 'string' && record.lockedAt === lock) tx.replace<FileRequestRecord>({ ...record, lockedAt: null });
      return { released: true };
    }
    if (!record) throw new ChausarError('SHARE_EXPIRED', FILE_REQUEST_WORDS.ended);
    const closed = closedReason(record, tx.now);
    if (closed) throw new ChausarError(closed.code, closed.line);
    if (locked(record, tx.now)) throw new ChausarError('SHARE_USED', FILE_REQUEST_WORDS.busy);
    tx.replace<FileRequestRecord>({ ...record, lockedAt: tx.now });
    return { lock: tx.now };
  });
}

/**
 * DPDP (4J7): a forgotten person's name leaves the business's file requests and the share links' client words. A note
 * that names them is erased; a client's file name that names them goes (the file stays with its order under Chausar's
 * own name); a comment, or the words of a client's answer, that names them is erased. The file's own bytes stay with
 * the order as they are (an open question for the founder). Called inside network/forget.ts's transaction.
 */
export function eraseFileRequestsNaming(tx: VentureTx, mentions: (text: unknown) => boolean): void {
  for (const record of tx.list('venture-file-request')) {
    if (mentions(record.note)) tx.replace<FileRequestRecord>({ ...record, note: FILE_REQUEST_WORDS.erased });
  }
  for (const upload of tx.list('venture-upload')) {
    if (upload.origin === 'client-link' && mentions(upload.clientName)) tx.replace<UploadRecord>({ ...upload, clientName: null });
  }
  for (const link of tx.list('venture-share-link')) {
    const named = (link.comments ?? []).some(item => mentions(item.text)) || link.decisions.some(item => mentions(item.comment));
    if (!named) continue;
    tx.replace<ShareLinkStoredRecord>({
      ...link,
      ...(link.comments ? { comments: link.comments.map(item => (mentions(item.text) ? { ...item, text: FILE_REQUEST_WORDS.erased } : item)) } : {}),
      // The client's answer stays (its digest, time and who it is under); only the words that named them go.
      decisions: link.decisions.map(item => (mentions(item.comment) ? { ...item, comment: FILE_REQUEST_WORDS.erased } : item)),
    });
  }
}
