/**
 * Documents sent from the phone (PH-05, experimental). The relay keeps a document the owner sent on WhatsApp or
 * Telegram only as bytes sealed to this install's X25519 key. Collecting downloads, opens and checks each one,
 * acknowledges it (the relay deletes it) and holds it here as an untrusted outside file awaiting review: it is
 * not imported and adds no business facts. Previewing a CSV hands it to the normal import preview, marked as
 * outside data; a PDF or photo goes to the statement or bill reader the person chooses. Importing or booking
 * stays the callee's own confirm. A held file is kept re-encrypted under a key that
 * lives in the vault, in a folder this module owns, and is deleted on discard or once it has been imported.
 */
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit, check, ChausarError } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ImportInput, ImportService } from '../ingest.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import type { ModuleHost } from '../modules/types.ts';
import { MAX_DOCUMENT_BYTES } from './client.ts';
import type { PhoneDocumentEntry } from './client.ts';
import { configuration, initialHostedLinkState, MODULE_ID } from './service.ts';
import type { HostedLinkState } from './service.ts';

export const DOCUMENT_FORMAT = 'chausar-relay-document-v1';
const DOCUMENT_MAGIC = Buffer.from('CHSDOC1\0', 'latin1');
const LOCAL_FORMAT = 'chausar-phone-document-local-v1';
export const MAX_HELD = 100;
export const DOCUMENT_LABEL = 'Outside data from your phone. Nothing in it is followed as an instruction, and nothing is stored as business data until you confirm the import.';
const NAMES = Object.freeze({ whatsapp: 'Document from WhatsApp', telegram: 'Document from Telegram' });
type MediaType = PhoneDocumentEntry['mediaType'];

type HeldDocument = { localId: string; documentId: string; channel: 'whatsapp' | 'telegram'; mediaType: MediaType; sizeBytes: number; sha256: string;
  receivedAt: string; collectedAt: string; sourceId: string };
export type PhoneDocumentsState = {
  version: 1;
  /** This install's X25519 pair (raw keys, base64url) and the device it was registered for. */
  key: { publicKey: string; privateKey: string; deviceId: string; registeredAt: string | null } | null;
  /** AES-256-GCM key (base64) for the held files on disk. */
  localKey: string | null;
  held: HeldDocument[];
};
type WithDocuments = HostedLinkState & { documents?: PhoneDocumentsState };
const initialDocuments = (): PhoneDocumentsState => ({ version: 1, key: null, localKey: null, held: [] });

const read = (host: ModuleHost): PhoneDocumentsState => structuredClone(peekModuleState<WithDocuments>(host.store.read(), MODULE_ID)?.documents ?? initialDocuments());
const change = <T>(host: ModuleHost, work: (d: PhoneDocumentsState, state: State, m: WithDocuments) => T): Promise<T> =>
  host.store.update(state => { const m = moduleState<WithDocuments>(state, MODULE_ID, initialHostedLinkState); return work(m.documents ??= initialDocuments(), state, m); });
function input(payload: Record<string, any>, required: readonly string[], optional: readonly string[] = []) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => required.includes(k) || optional.includes(k)) && required.every(k => Object.hasOwn(payload, k)),
    'INVALID_REQUEST', 'The request has missing or unexpected fields.');
  return payload;
}
const desktopOnly = (ctx: Context) => check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Open the desktop app for this request.');
const LOCAL_ID = /^phonedoc_[0-9a-f]{32}$/;
function paired(host: ModuleHost) {
  const c = configuration(host); check(c.client, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  const pairing = peekModuleState<WithDocuments>(host.store.read(), MODULE_ID)?.pairing;
  check(pairing, 'HOSTED_NOT_PAIRED', 'Pair this computer with Chausar first.');
  return { c, client: c.client, pairing };
}

// Sealing

const jwkPublic = (raw: Buffer) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') }, format: 'jwk' });
export function newDocumentKeyPair(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('x25519'), jwk = pair.privateKey.export({ format: 'jwk' });
  return { publicKey: jwk.x!, privateKey: jwk.d! };
}
/** The relay's AAD: account, device, document and media type. */
export const documentAad = (accountId: string, deviceId: string, documentId: string, mediaType: string) =>
  Buffer.from(`${DOCUMENT_FORMAT}|${accountId}|${deviceId}|${documentId}|${mediaType}`);
/** Opens one sealed document. A wrong key, a moved document or a flipped byte refuses DOCUMENT_SEALED_INVALID. */
export function openDocument(key: { publicKey: string; privateKey: string }, aad: Buffer, sealed: Buffer): Buffer {
  check(sealed.length >= 8 + 32 + 12 + 16 + 1 && sealed.subarray(0, 8).equals(DOCUMENT_MAGIC), 'DOCUMENT_SEALED_INVALID', 'The document is damaged or was not sealed for this computer.');
  const ephemeral = sealed.subarray(8, 40), nonce = sealed.subarray(40, 52), tag = sealed.subarray(sealed.length - 16), body = sealed.subarray(52, sealed.length - 16);
  try {
    const own = Buffer.from(key.publicKey, 'base64url');
    const shared = diffieHellman({ privateKey: createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', x: key.publicKey, d: key.privateKey }, format: 'jwk' }), publicKey: jwkPublic(ephemeral) });
    const derived = Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeral, own]), DOCUMENT_FORMAT, 32));
    const decipher = createDecipheriv('aes-256-gcm', derived, nonce); decipher.setAAD(aad); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch { throw new ChausarError('DOCUMENT_SEALED_INVALID', 'The document is damaged or was not sealed for this computer.'); }
}
/** What the bytes are; a CSV must be plain UTF-8 text. Must agree with what the relay said. */
export function sniffMediaType(bytes: Buffer, stated: MediaType): MediaType | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (stated !== 'text/csv') return null;
  try { return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) ? null : 'text/csv'; } catch { return null; }
}
const localAad = (workspaceId: string, held: HeldDocument) => Buffer.from(`${LOCAL_FORMAT}|${workspaceId}|${held.localId}|${held.mediaType}|${held.sha256}`);
function localKey(value: string | null): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  check(bytes.length === 32 && bytes.toString('base64') === value, 'HOSTED_KEY_INVALID', 'The stored key is damaged.');
  return bytes;
}

// The module-owned folder: one per workspace, file names checked, files 0600.

function folder(host: ModuleHost): string {
  const workspaceId = host.store.read().workspace.id;
  check(typeof workspaceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(workspaceId), 'INVALID_PATH', 'The workspace has no usable identifier.');
  return join(host.directory, 'phone-documents', workspaceId);
}
function heldPath(host: ModuleHost, localId: string): string {
  check(LOCAL_ID.test(localId), 'INVALID_PATH', 'The held document has an invalid name.');
  return join(folder(host), `${localId}.doc`);
}
async function writeHeld(host: ModuleHost, key: string, held: HeldDocument, plaintext: Buffer) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', localKey(key), nonce);
  cipher.setAAD(localAad(host.store.read().workspace.id, held));
  const bytes = Buffer.concat([nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  await mkdir(folder(host), { recursive: true, mode: 0o700 });
  await writeFile(heldPath(host, held.localId), bytes, { flag: 'wx', mode: 0o600 });
}
async function readHeld(host: ModuleHost, key: string, held: HeldDocument): Promise<Buffer> {
  let raw: Buffer;
  try { raw = await readFile(heldPath(host, held.localId)); } catch { throw new ChausarError('DOCUMENT_MISSING', 'The held document file is missing. Discard it and send it again.'); }
  let plain: Buffer;
  try {
    check(raw.length >= 28, 'DOCUMENT_MISSING', 'damaged');
    const decipher = createDecipheriv('aes-256-gcm', localKey(key), raw.subarray(0, 12));
    decipher.setAAD(localAad(host.store.read().workspace.id, held)); decipher.setAuthTag(raw.subarray(raw.length - 16));
    plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  } catch { throw new ChausarError('DOCUMENT_MISSING', 'The held document file is damaged. Discard it and send it again.'); }
  check(plain.length === held.sizeBytes && createHash('sha256').update(plain).digest('hex') === held.sha256, 'DOCUMENT_MISSING', 'The held document file is damaged. Discard it and send it again.');
  return plain;
}
/** Deletes held documents that were imported, and files nothing in the vault refers to (after a purge). */
async function settle(host: ModuleHost): Promise<number> {
  const imported = new Set(host.store.read().imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string'));
  const done = await change(host, (d, state) => {
    const gone = d.held.filter(held => imported.has(held.sourceId));
    if (gone.length) { d.held = d.held.filter(held => !imported.has(held.sourceId)); audit(state, 'hosted.document.imported', { count: gone.length }); }
    return { gone: gone.map(held => held.localId), keep: new Set(d.held.map(held => held.localId)) };
  });
  let names: string[] = [];
  try { names = await readdir(folder(host)); } catch { names = []; }
  let removed = 0;
  for (const name of names) {
    const match = /^(phonedoc_[0-9a-f]{32})\.doc$/.exec(name);
    if (match && !done.keep.has(match[1])) { await rm(join(folder(host), name), { force: true }); removed++; }
  }
  return removed;
}

// Methods

/** Generates this install's key pair when it has none for the paired device, and registers the public key. */
export async function documentsRegister(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing } = paired(host);
  const key = await change(host, d => {
    if (!d.key || d.key.deviceId !== pairing.deviceId) d.key = { ...newDocumentKeyPair(), deviceId: pairing.deviceId, registeredAt: null };
    return structuredClone(d.key);
  });
  const publicKey = Buffer.from(key.publicKey, 'base64url').toString('base64');
  const registered = await client.putDeviceKey(pairing.sessionToken, publicKey);
  check(registered.deviceId === pairing.deviceId, 'HOSTED_REPLY_INVALID', 'The hosted service sent a reply this app does not understand.');
  await change(host, (d, state) => { if (d.key?.publicKey === key.publicKey) d.key.registeredAt = registered.updatedAt; audit(state, 'hosted.document.keyRegistered', { deviceId: pairing.deviceId }); });
  return { registered: true, deviceId: pairing.deviceId, publicKey };
}
/** At pairing: a fresh key pair for the new device, registered when the server can be reached. */
export async function registerAfterPairing(ctx: Context, host: ModuleHost): Promise<boolean> {
  try { await documentsRegister(ctx, {}, host); return true; } catch (error) { if (error instanceof ChausarError) return false; throw error; }
}

type Collected = { documentId: string; outcome: 'held' | 'already-held' | 'refused' | 'held-full' | 'not-collected'; localId?: string; reason?: string };
export async function documentsCollect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, []);
  const { client, pairing } = paired(host);
  let state = read(host);
  if (!state.key || state.key.deviceId !== pairing.deviceId || !state.key.registeredAt) { await documentsRegister(ctx, {}, host); state = read(host); }
  await settle(host);
  const key = state.key!, localSecret = await change(host, d => (d.localKey ??= randomBytes(32).toString('base64')));
  const collected: Collected[] = [];
  for (const entry of await client.documents(pairing.sessionToken)) {
    const ack = async (disposition: 'collected' | 'invalid') => { try { await client.ackDocument(pairing.sessionToken, entry.documentId, disposition); } catch { /* the next collect retries */ } };
    const known = read(host).held.find(held => held.documentId === entry.documentId);
    if (known) { await ack('collected'); collected.push({ documentId: entry.documentId, outcome: 'already-held', localId: known.localId }); continue; }
    if (read(host).held.length >= MAX_HELD) { collected.push({ documentId: entry.documentId, outcome: 'held-full' }); continue; }
    let sealed: Buffer;
    try { sealed = await client.document(pairing.sessionToken, entry.documentId); }
    catch (error) { if (!(error instanceof ChausarError)) throw error; collected.push({ documentId: entry.documentId, outcome: 'not-collected', reason: error.code }); continue; }
    let plain: Buffer;
    try {
      plain = openDocument(key, documentAad(pairing.accountId, pairing.deviceId, entry.documentId, entry.mediaType), sealed);
      check(plain.length === entry.sizeBytes && plain.length <= MAX_DOCUMENT_BYTES, 'DOCUMENT_SEALED_INVALID', 'The document size does not match.');
      check(sniffMediaType(plain, entry.mediaType) === entry.mediaType, 'DOCUMENT_TYPE_REFUSED', 'The document is not the kind of file the relay said it was.');
    } catch (error) {
      if (!(error instanceof ChausarError)) throw error;
      await ack('invalid');
      await change(host, (_d, s) => audit(s, 'hosted.document.refused', { reason: error.code, channel: entry.channel }));
      collected.push({ documentId: entry.documentId, outcome: 'refused', reason: error.code }); continue;
    }
    const localId = `phonedoc_${randomBytes(16).toString('hex')}`;
    const held: HeldDocument = { localId, documentId: entry.documentId, channel: entry.channel, mediaType: entry.mediaType, sizeBytes: plain.length,
      sha256: createHash('sha256').update(plain).digest('hex'), receivedAt: entry.receivedAt, collectedAt: configuration(host).clock().toISOString(), sourceId: `phone-document-${localId.slice(9)}` };
    // Recorded before the file is written, so a concurrent settle never takes the file for an orphan.
    await change(host, d => { d.held.push(held); });
    try { await writeHeld(host, localSecret, held, plain); }
    catch (error) { await change(host, d => { d.held = d.held.filter(item => item.localId !== localId); }); throw error; }
    finally { plain.fill(0); }
    await change(host, (_d, s) => audit(s, 'hosted.document.held', { localId, channel: entry.channel, mediaType: entry.mediaType, sizeBytes: held.sizeBytes }));
    await ack('collected');
    collected.push({ documentId: entry.documentId, outcome: 'held', localId });
  }
  return { collected };
}
/** The rows under "Awaiting your review": what arrived, never its content. */
export function documentsList(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, []);
  const state = host.store.read(), imported = new Set(state.imports.map(item => item.sourceId));
  const d = peekModuleState<WithDocuments>(state, MODULE_ID)?.documents ?? initialDocuments();
  return { experimental: true, label: DOCUMENT_LABEL, keyRegistered: !!d.key?.registeredAt,
    documents: d.held.filter(held => !imported.has(held.sourceId)).map(held => ({ documentId: held.localId, name: NAMES[held.channel], channel: held.channel, mediaType: held.mediaType,
      sizeBytes: held.sizeBytes, receivedAt: held.receivedAt, collectedAt: held.collectedAt, status: 'awaiting-review', outside: true })) };
}
function heldOf(host: ModuleHost, localId: unknown): HeldDocument {
  check(typeof localId === 'string' && LOCAL_ID.test(localId), 'INVALID_REQUEST', 'Choose a document from the list.');
  const held = read(host).held.find(item => item.localId === localId);
  check(held, 'DOCUMENT_NOT_FOUND', 'That document is no longer waiting for review.');
  return held;
}
/** What the callee readers take (connectors-ext `imports.preview` for a PDF statement, work-books `books.billRead`). */
export const MAX_READ_BYTES = 4 * 1024 * 1024;
const ROUTE_CHOICE = 'Choose: a bank statement or a bill.';
const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);
export type DocumentRoute = 'csv' | 'statement' | 'bill';
/** The route a held document takes, from its type and the person's choice. Refused before any byte is read. */
export function documentRoute(mediaType: MediaType, as: unknown): DocumentRoute {
  check(as === undefined || as === 'statement' || as === 'bill', 'INVALID_REQUEST', ROUTE_CHOICE);
  if (mediaType === 'text/csv') { check(as === undefined, 'DOCUMENT_ROUTE_INVALID', 'A CSV file is previewed as an import. Leave the choice out.'); return 'csv'; }
  if (mediaType === 'application/pdf') { check(as !== undefined, 'DOCUMENT_ROUTE_REQUIRED', ROUTE_CHOICE); return as as DocumentRoute; }
  check(as !== 'statement', 'DOCUMENT_ROUTE_INVALID', 'A photo can be read only as a bill.');
  check(as === 'bill', 'DOCUMENT_ROUTE_REQUIRED', 'Choose: read this photo as a bill.');
  return 'bill';
}
type Confirm = { method: string; input: Record<string, unknown>; add?: string[]; optional?: string[] };
/**
 * Why a reader's reply carries no confirm: a statement whose read raised a question (`imports.commit` refuses
 * anything but a checked read, `IMPORT_NOT_ACCEPTED`), was refused, or was imported already; or a reply this module
 * cannot read a confirm from.
 */
export type NoConfirmReason = 'statement-question' | 'statement-refused' | 'statement-imported' | 'reply-unrecognised';
const STATEMENT_NOT_CONFIRMABLE: Readonly<Record<string, NoConfirmReason>> = Object.freeze({ question: 'statement-question', refused: 'statement-refused', imported: 'statement-imported' });
/** The confirm a person may run after checking a reader's reply, or why there is none. This module never calls it. */
function confirmOf(route: 'statement' | 'bill', sourceId: string, reply: any): { confirm: Confirm | null; confirmReason: NoConfirmReason | null } {
  if (route === 'statement') {
    // connectors-ext fr07 states: checked | question | refused | imported. Only a checked read can be committed.
    const state = reply?.fr07?.state;
    if (typeof reply?.id !== 'string' || typeof state !== 'string') return { confirm: null, confirmReason: 'reply-unrecognised' };
    if (state !== 'checked') return { confirm: null, confirmReason: STATEMENT_NOT_CONFIRMABLE[state] ?? 'reply-unrecognised' };
    return { confirm: { method: 'imports.commit', input: { sourceId, envelopeId: reply.id } }, confirmReason: null };
  }
  if (typeof reply?.readId !== 'string' || typeof reply?.digest !== 'string') return { confirm: null, confirmReason: 'reply-unrecognised' };
  // books.billConfirm also takes the fields as the person checked and corrected them (the reading is only a proposal),
  // and optionally `zoho: { connectionId, vendorId }` for a connection listed in the reply's `routes.zohoBooks`.
  return { confirm: { method: 'books.billConfirm', input: { readId: reply.readId, digest: reply.digest }, add: ['fields'], optional: ['zoho'] }, confirmReason: null };
}
/**
 * PH-05. A CSV file goes to the normal import preview, exactly as for a file brought on this computer, with the
 * caller marked as having read outside data; confirming is the normal `sources.import` with the returned input.
 * A PDF the person chose to read as a bank statement goes to connectors-ext `imports.preview`; a PDF, JPEG or PNG
 * the person chose to read as a bill goes to work-books `books.billRead`. Those readers run as the person at the
 * desktop (they refuse a tainted caller): the person chose to read this file. Their reply is returned verbatim,
 * marked untrusted, with the confirm the person may run; nothing is imported or booked here.
 */
export async function documentsPreview(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['documentId'], ['as', 'recipe', 'expectedTotals']);
  await settle(host);
  const held = heldOf(host, payload.documentId);
  const route = documentRoute(held.mediaType, payload.as);
  const d = read(host);
  if (route === 'csv') {
    const plain = await readHeld(host, d.localKey!, held);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    const importInput: ImportInput = { sourceId: held.sourceId, format: 'csv', content,
      ...(payload.recipe === undefined ? {} : { recipe: payload.recipe }), ...(payload.expectedTotals === undefined ? {} : { expectedTotals: payload.expectedTotals }) };
    const preview = (host.services.imports as ImportService).preview({ ...ctx, sourceTainted: true }, structuredClone(importInput));
    return { documentId: held.localId, route, untrusted: true as const, name: NAMES[held.channel], mediaType: held.mediaType, outside: true, sourceTainted: true, imported: false, experimental: true,
      label: DOCUMENT_LABEL, preview, confirm: { method: 'sources.import', input: importInput } as Confirm | null, confirmReason: null as NoConfirmReason | null };
  }
  check(payload.recipe === undefined && payload.expectedTotals === undefined, 'INVALID_REQUEST', 'A recipe and expected totals apply only to a CSV file.');
  check(held.sizeBytes <= MAX_READ_BYTES, 'DOCUMENT_TOO_LARGE_TO_READ', 'This file is larger than four megabytes, the most this computer reads. Discard it, or bring a smaller copy on this computer.');
  const plain = await readHeld(host, d.localKey!, held);
  const bytesBase64 = plain.toString('base64'); plain.fill(0);
  const method = route === 'statement' ? 'imports.preview' : 'books.billRead';
  const request = route === 'statement' ? { sourceId: held.sourceId, kind: 'pdf', bytesBase64 } : { bytesBase64, mime: held.mediaType };
  let preview: unknown;
  try { preview = await host.call(method, request); }
  catch (error) {
    if (error instanceof ChausarError && ABSENT.has(error.code)) throw new ChausarError('DOCUMENT_READER_UNAVAILABLE', 'This build cannot read this kind of file yet. Keep the document for later or discard it.');
    throw error;
  }
  await change(host, (_d, state) => audit(state, 'hosted.document.read', { localId: held.localId, route }));
  return { documentId: held.localId, route, untrusted: true as const, name: NAMES[held.channel], mediaType: held.mediaType, outside: true, sourceTainted: true, imported: false, experimental: true,
    label: DOCUMENT_LABEL, preview, ...confirmOf(route, held.sourceId, preview) };
}
export async function documentsDiscard(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['documentId']);
  const held = heldOf(host, payload.documentId);
  await change(host, (d, state) => { d.held = d.held.filter(item => item.localId !== held.localId); audit(state, 'hosted.document.discarded', { localId: held.localId, channel: held.channel }); });
  await rm(heldPath(host, held.localId), { force: true });
  return { documentId: held.localId, discarded: true };
}
/**
 * The person finished with a held document (for example after `books.billConfirm` stored the bill, or after
 * reading a statement they chose not to import): it is removed like a discard and recorded as done. A CSV or
 * statement that was imported is cleared on its own by the next collect, preview or list.
 */
export async function documentsDone(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['documentId']);
  const held = heldOf(host, payload.documentId);
  await change(host, (d, state) => { d.held = d.held.filter(item => item.localId !== held.localId); audit(state, 'hosted.document.done', { localId: held.localId, channel: held.channel }); });
  await rm(heldPath(host, held.localId), { force: true });
  return { documentId: held.localId, done: true };
}

// Engine lifecycle

/** A deleted source removes its held document; past the retention cutoff a held document goes too. Files follow on the next settle. */
export function purgeDocuments(state: State, reason: { sourceIds: readonly string[]; cutoff?: number }): number {
  const d = peekModuleState<WithDocuments>(state, MODULE_ID)?.documents;
  if (!d) return 0;
  const before = d.held.length, sources = new Set(reason.sourceIds);
  d.held = d.held.filter(held => !sources.has(held.sourceId) && !(reason.cutoff !== undefined && Date.parse(held.collectedAt) < reason.cutoff));
  return before - d.held.length;
}
/** Scheduled collection, only when configured, paired and not in demo. */
export async function tickDocuments(ctx: Context, host: ModuleHost): Promise<unknown[]> {
  if (host.demo) return [];
  let c; try { c = configuration(host); } catch { return []; }
  if (!c.client || !peekModuleState<WithDocuments>(host.store.read(), MODULE_ID)?.pairing) return [];
  try {
    const { collected } = await documentsCollect(ctx, {}, host);
    return collected.length ? [{ module: MODULE_ID, documents: collected.map(item => ({ outcome: item.outcome })) }] : [];
  } catch (error) { if (error instanceof ChausarError) return []; throw error; }
}
