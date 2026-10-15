/**
 * Recovery through a contact (FR-13, SH-02, TR-12), the desktop half of a two-part escrow.
 *
 * Enrolling (vault open) encrypts the recovery code with AES-256-GCM under a fresh random key K and writes the
 * ciphertext, with a random local request credential, to `<app directory>/recovery-contact/<folder>.json` (mode 0600,
 * outside the vault so it can be read before unlock). K goes to the relay with the contact's reach and the SHA-256 of
 * the credential; the contact's name stays on this computer (frame-today keeps it in the vault). So neither the relay
 * alone (no ciphertext) nor this computer alone (no K) can recover the vault: the relay releases K only after the
 * contact confirmed on the /r/ link page, once, and then deletes it.
 *
 * With the vault locked, `hosted.recovery.request` asks the relay to send the contact the fixed message,
 * `hosted.recovery.check` reads the state, and `hosted.recovery.complete` fetches K once, decrypts the code here and
 * recovers the vault with a new passphrase. The recovery code and K are never logged, returned or kept in the vault.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { audit, check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { Fetch, FetchReply } from './client.ts';
import { MAX_JSON_REPLY, shape } from './client.ts';
import { configuration, connected, desktopOnly, input } from './service.ts';
import { isMailAddress } from './relay-extras.ts';

export const RECOVERY_FILE_FORMAT = 'chausar-recovery-contact-v1';
export const RECOVERY_CODE = /^CHR-[A-Za-z0-9_-]{43}$/;
const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;
const ENROLMENT_ID = /^rce_[0-9a-f-]{36}$/, REQUEST_ID = /^rcr_[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
/** How long a decrypted code is held in memory for a retry after a recovery that failed for a passing reason. */
const RETRY_HOLD_MS = 15 * 60000;

/** Relay refusals this module passes on by code; anything else is HOSTED_REQUEST_FAILED (or HOSTED_UNREACHABLE for 5xx). */
const RELAY_CODES: Readonly<Record<string, string>> = Object.freeze({
  UNAUTHENTICATED: 'The hosted session ended. Pair this computer again.',
  PLAN_REQUIRED: 'This needs the paid plan.',
  CHANNEL_NOT_CONFIGURED: 'That way of reaching your contact is not set up on the server yet.',
  RECOVERY_REACH_INVALID: 'Give an Indian mobile number starting with +91, or a mail address.',
  RECOVERY_KEY_INVALID: 'The server refused the recovery key.',
  RECOVERY_CREDENTIAL_INVALID: 'This computer\'s recovery request was refused. Use your recovery kit.',
  RECOVERY_NOT_ENROLLED: 'There is no recovery contact for this computer. Use your recovery kit.',
  RECOVERY_REQUEST_LIMITED: 'Your contact was asked too often today. Try again tomorrow, or use your recovery kit.',
  RECOVERY_REQUEST_NOT_FOUND: 'There is no such recovery request.',
  RECOVERY_NOT_CONFIRMED: 'Your recovery contact has not confirmed yet.',
  RECOVERY_DECLINED: 'Your recovery contact said they did not ask.',
  RECOVERY_EXPIRED: 'This recovery request has expired. Ask again.',
  RECOVERY_KEY_RELEASED: 'This recovery contact was already used. Use your recovery kit.',
});
/** Every code this module can refuse with (for the desktop bridge's refusal list). */
export const RECOVERY_CODES: readonly string[] = Object.freeze([...Object.keys(RELAY_CODES).filter(code => code.startsWith('RECOVERY_')),
  'RECOVERY_CODE_INVALID', 'RECOVERY_CONTACT_INVALID', 'RECOVERY_FOLDER_UNKNOWN', 'RECOVERY_FILE_INVALID', 'RECOVERY_IN_PROGRESS', 'RECOVERY_CODE_REJECTED']);

type RecoveryFile = { format: typeof RECOVERY_FILE_FORMAT; folder: string; workspaceId: string; enrolmentId: string; origin: string; credential: string;
  nonce: string; ciphertext: string; contactChannel: 'whatsapp' | 'mail'; enrolledAt: string };
type RelayStatus = 'waiting' | 'confirmed' | 'declined' | 'expired' | 'failed' | 'released';
type Pending = { state: 'recovering' | 'recovered' | 'failed'; failure?: string; code?: string; heldUntil?: number; folder: string };
/** Recoveries started by `complete`, by app directory and request id. In memory only; never written anywhere. */
const pending = new Map<string, Pending>();

const valid = (condition: unknown): void => check(condition, 'HOSTED_REPLY_INVALID', 'The hosted service sent a reply this app does not understand.');
const plain = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const folderOf = (payload: Record<string, any>): string => {
  const folder = payload.folder ?? 'main';
  check(typeof folder === 'string' && FOLDER.test(folder), 'INVALID_REQUEST', 'Name the workspace folder, or nothing.');
  return folder;
};
const fileDirectory = (host: ModuleHost) => join(host.directory, 'recovery-contact');
const filePath = (host: ModuleHost, folder: string) => join(fileDirectory(host), `${folder}.json`);
const aad = (workspaceId: string, enrolmentId: string) => Buffer.from(`${RECOVERY_FILE_FORMAT}|${workspaceId}|${enrolmentId}`);
const pendingKey = (host: ModuleHost, requestId: string) => `${host.directory}\0${requestId}`;

// ---- the local file

async function readRecoveryFile(host: ModuleHost, folder: string): Promise<RecoveryFile | null> {
  const path = filePath(host, folder);
  let raw: string;
  try {
    const info = await lstat(path);
    check(info.isFile() && info.size <= 16384, 'RECOVERY_FILE_INVALID', 'The recovery contact file on this computer is damaged. Use your recovery kit.');
    raw = await readFile(path, 'utf8');
  } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error instanceof ChausarError ? error : new ChausarError('RECOVERY_FILE_INVALID', 'The recovery contact file on this computer is damaged. Use your recovery kit.'); }
  let value: any;
  try { value = JSON.parse(raw); } catch { value = null; }
  const ok = !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'ciphertext,contactChannel,credential,enrolledAt,enrolmentId,folder,format,nonce,origin,workspaceId'
    && value.format === RECOVERY_FILE_FORMAT && value.folder === folder && plain(value.workspaceId, 128) && ENROLMENT_ID.test(value.enrolmentId)
    && typeof value.origin === 'string' && /^https:\/\/[^/?#@]+$/.test(value.origin) && typeof value.credential === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.credential)
    && typeof value.nonce === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value.nonce) && typeof value.ciphertext === 'string' && B64URL.test(value.ciphertext) && value.ciphertext.length <= 512
    && (value.contactChannel === 'whatsapp' || value.contactChannel === 'mail') && typeof value.enrolledAt === 'string' && ISO.test(value.enrolledAt);
  check(ok, 'RECOVERY_FILE_INVALID', 'The recovery contact file on this computer is damaged. Use your recovery kit.');
  return value as RecoveryFile;
}
async function writeRecoveryFile(host: ModuleHost, file: RecoveryFile) {
  await mkdir(fileDirectory(host), { recursive: true, mode: 0o700 });
  const path = filePath(host, file.folder), temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try { await writeFile(temporary, JSON.stringify(file), { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

// ---- the relay

function endpoint(host: ModuleHost): { origin: string; fetch: Fetch } {
  const c = configuration(host); check(c.client, 'HOSTED_NOT_CONFIGURED', 'The hosted connection is not set up in this app.');
  const options = host.options as { fetch?: unknown };
  return { origin: c.client.origin, fetch: typeof options.fetch === 'function' ? options.fetch as Fetch : (url, init) => fetch(url, init as RequestInit) as unknown as Promise<FetchReply> };
}
async function relay(host: ModuleHost, method: string, path: string, bearer: string, expect: number, body?: unknown): Promise<any> {
  const { origin, fetch } = endpoint(host);
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${bearer}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let reply: FetchReply;
  try { reply = await fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) }); }
  catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
  let text: string;
  try { text = await reply.text(); } catch { throw new ChausarError('HOSTED_UNREACHABLE', 'The hosted service could not be reached.'); }
  if (!reply.ok) {
    let code = reply.status >= 500 ? 'HOSTED_UNREACHABLE' : 'HOSTED_REQUEST_FAILED';
    try { const candidate = text.length <= 8192 ? JSON.parse(text)?.error?.code : undefined; if (typeof candidate === 'string' && Object.hasOwn(RELAY_CODES, candidate)) code = candidate; } catch { /* keep the status code */ }
    throw new ChausarError(code, RELAY_CODES[code] ?? 'The hosted service refused the request.');
  }
  valid(reply.status === expect && text.length <= MAX_JSON_REPLY);
  try { return JSON.parse(text); } catch { return valid(false); }
}
function relayStatus(value: unknown, requestId: string): { requestId: string; status: RelayStatus; expiresAt: string } {
  const r = shape(value, ['requestId', 'status', 'expiresAt']);
  valid(r.requestId === requestId && ['waiting', 'confirmed', 'declined', 'expired', 'failed', 'released'].includes(r.status) && typeof r.expiresAt === 'string' && ISO.test(r.expiresAt));
  return r as any;
}
function enrolmentView(value: unknown) {
  if (value === null) return null;
  const e = shape(value, ['enrolmentId', 'contactChannel', 'contactMasked', 'enrolledAt']);
  valid(ENROLMENT_ID.test(e.enrolmentId) && (e.contactChannel === 'whatsapp' || e.contactChannel === 'mail') && plain(e.contactMasked, 320) && ISO.test(e.enrolledAt));
  return e as { enrolmentId: string; contactChannel: 'whatsapp' | 'mail'; contactMasked: string; enrolledAt: string };
}
const sameOrigin = (host: ModuleHost, file: RecoveryFile) =>
  check(endpoint(host).origin === file.origin, 'RECOVERY_FILE_INVALID', 'The recovery contact was named on another hosted service. Use your recovery kit.');

// ---- methods

/**
 * `hosted.recovery.enrol` (admin, vault open): `{ recoveryCode, contact: { name, reach }, folder? }` →
 * `{ enrolled: true, folder, contactChannel, contactMasked, enrolledAt }`. Replaces any earlier enrolment of this
 * computer on the relay and the local file. The code is checked for its form only: the vault's recovery wrapper is
 * held by core storage and cannot be tried without unlocking, so a wrong code shows only at recovery time.
 */
export async function enrol(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['recoveryCode', 'contact'], ['folder']);
  check(typeof payload.recoveryCode === 'string' && RECOVERY_CODE.test(payload.recoveryCode), 'RECOVERY_CODE_INVALID', 'Type the recovery code exactly as shown in your recovery kit.');
  const contact = payload.contact;
  check(contact !== null && typeof contact === 'object' && !Array.isArray(contact) && Object.keys(contact).sort().join(',') === 'name,reach'
    && plain(contact.name, 100) && typeof contact.reach === 'string' && (INDIAN_MOBILE.test(contact.reach.trim()) || isMailAddress(contact.reach.trim())),
  'RECOVERY_CONTACT_INVALID', 'Give the contact\'s name and an Indian mobile number starting with +91 or a mail address.');
  const folder = folderOf(payload);
  try { check((await lstat(join(host.directory, folder))).isDirectory(), 'RECOVERY_FOLDER_UNKNOWN', 'There is no workspace in that folder.'); }
  catch (error) { throw error instanceof ChausarError ? error : new ChausarError('RECOVERY_FOLDER_UNKNOWN', 'There is no workspace in that folder.'); }
  const workspaceId = host.store.read().workspace.id;
  const { pairing } = connected(host);
  const key = randomBytes(32), credential = randomBytes(32).toString('base64url');
  try {
    const reply = shape(await relay(host, 'PUT', '/v1/recovery/enrolment', pairing.sessionToken, 200,
      { key: key.toString('base64'), contact: { reach: contact.reach.trim() }, credentialSha256: createHash('sha256').update(credential).digest('hex') }),
    ['enrolmentId', 'contactChannel', 'contactMasked', 'enrolledAt']);
    const enrolment = enrolmentView(reply)!;
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad(workspaceId, enrolment.enrolmentId));
    const sealed = Buffer.concat([cipher.update(payload.recoveryCode, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const file: RecoveryFile = { format: RECOVERY_FILE_FORMAT, folder, workspaceId, enrolmentId: enrolment.enrolmentId, origin: endpoint(host).origin, credential,
      nonce: nonce.toString('base64url'), ciphertext: sealed.toString('base64url'), contactChannel: enrolment.contactChannel, enrolledAt: enrolment.enrolledAt };
    try { await writeRecoveryFile(host, file); }
    catch (error) {
      // Without the local half the relay's half is useless: take it back.
      await relay(host, 'DELETE', '/v1/recovery/enrolment', pairing.sessionToken, 200).catch(() => undefined);
      throw new ChausarError('RECOVERY_FILE_INVALID', 'The recovery contact file could not be written on this computer.');
    }
    await host.store.update(state => { audit(state, 'hosted.recovery.enrolled', { contactChannel: enrolment.contactChannel }); });
    return { enrolled: true, folder, contactChannel: enrolment.contactChannel, contactMasked: enrolment.contactMasked, enrolledAt: enrolment.enrolledAt };
  } finally { key.fill(0); }
}

/** `hosted.recovery.status` (read): `{ folder? }` → `{ enrolled, local, relay: { enrolmentId, contactChannel, contactMasked, enrolledAt } | null, folder }`. */
export async function status(_ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  input(payload, [], ['folder']);
  const folder = folderOf(payload), file = await readRecoveryFile(host, folder).catch(() => null);
  const local = !!file && file.workspaceId === host.store.read().workspace.id;
  const c = configuration(host);
  let relayed: ReturnType<typeof enrolmentView> = null, paired = false;
  if (c.client) {
    try { const { pairing } = connected(host); paired = true; relayed = enrolmentView(shape(await relay(host, 'GET', '/v1/recovery/enrolment', pairing.sessionToken, 200), ['enrolment']).enrolment); }
    catch (error) { if (!(error instanceof ChausarError && error.code === 'HOSTED_NOT_PAIRED')) throw error; }
  }
  return { enrolled: local && !!relayed && relayed.enrolmentId === file!.enrolmentId, local, paired, relay: relayed, folder };
}

/** `hosted.recovery.remove` (admin): `{ folder? }` → `{ removed: true }`. Revokes the relay's half and deletes the local file. */
export async function remove(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, [], ['folder']);
  const folder = folderOf(payload);
  const c = configuration(host);
  if (c.client) {
    let token: string | null = null;
    try { token = connected(host).pairing.sessionToken; } catch { token = null; }
    if (token) await relay(host, 'DELETE', '/v1/recovery/enrolment', token, 200);
  }
  await rm(filePath(host, folder), { force: true });
  await host.store.update(state => { audit(state, 'hosted.recovery.removed', {}); });
  return { removed: true };
}

/**
 * `hosted.recovery.request` (preVault): `{ folder? }` → `{ requestId, status: 'waiting', expiresAt, contactChannel }`.
 * Sends the contact the one fixed message (and the owner's channels a fixed notice). Three requests a day per enrolment.
 */
export async function request(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, [], ['folder']);
  const folder = folderOf(payload), file = await readRecoveryFile(host, folder);
  check(file, 'RECOVERY_NOT_ENROLLED', 'There is no recovery contact for this workspace on this computer. Use your recovery kit.');
  sameOrigin(host, file);
  const r = shape(await relay(host, 'POST', '/v1/recovery/requests', file.credential, 202, {}), ['requestId', 'status', 'expiresAt', 'contactChannel']);
  valid(REQUEST_ID.test(r.requestId) && r.status === 'waiting' && typeof r.expiresAt === 'string' && ISO.test(r.expiresAt) && r.contactChannel === file.contactChannel);
  return { requestId: r.requestId as string, status: 'waiting' as const, expiresAt: r.expiresAt as string, contactChannel: file.contactChannel };
}

/**
 * `hosted.recovery.check` (preVault): `{ requestId, folder? }` → `{ requestId, status, expiresAt?, failure? }`, where status is
 * the relay's `waiting | confirmed | declined | expired | failed | released`, or, after `complete`, `recovering` or
 * `recovered`. A completed recovery that failed reads `confirmed` again with `failure` (the code), and `complete` may be retried.
 */
export async function checkRequest(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['requestId'], ['folder']);
  check(typeof payload.requestId === 'string' && REQUEST_ID.test(payload.requestId), 'RECOVERY_REQUEST_NOT_FOUND', 'There is no such recovery request.');
  const local = pending.get(pendingKey(host, payload.requestId));
  if (local && !(local.state === 'failed' && !held(local))) {
    if (local.state === 'failed') return { requestId: payload.requestId, status: 'confirmed' as const, failure: local.failure };
    return { requestId: payload.requestId, status: local.state };
  }
  const folder = folderOf(payload), file = await readRecoveryFile(host, folder);
  check(file, 'RECOVERY_NOT_ENROLLED', 'There is no recovery contact for this workspace on this computer. Use your recovery kit.');
  sameOrigin(host, file);
  const reply = relayStatus(await relay(host, 'GET', `/v1/recovery/requests/${payload.requestId}`, file.credential, 200), payload.requestId);
  return { requestId: reply.requestId, status: reply.status, expiresAt: reply.expiresAt, ...(local?.failure ? { failure: local.failure } : {}) };
}
const held = (entry: Pending) => entry.code !== undefined && (entry.heldUntil ?? 0) > Date.now();

/**
 * `hosted.recovery.complete` (preVault, vault locked): `{ requestId, newPassphrase, folder? }` → `{ requestId, status: 'recovering' }`.
 * Only for a confirmed request: fetches K (released once, then deleted on the relay), decrypts the recovery code here and
 * starts `workspace.recover` with the new passphrase as soon as this request has finished (a module request cannot run a
 * vault transition inside itself: the engine refuses it VAULT_BUSY). `hosted.recovery.check` then reads `recovered`, and
 * the workspace is open. The enrolment is used up: the local file is deleted and the contact must be named again.
 */
export async function complete(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  desktopOnly(ctx); input(payload, ['requestId', 'newPassphrase'], ['folder']);
  check(typeof payload.requestId === 'string' && REQUEST_ID.test(payload.requestId), 'RECOVERY_REQUEST_NOT_FOUND', 'There is no such recovery request.');
  check(typeof payload.newPassphrase === 'string' && payload.newPassphrase.length >= 12 && payload.newPassphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
  let open = true;
  try { host.store.read(); } catch { open = false; }
  check(!open, 'VAULT_OPEN', 'Lock the current workspace first.');
  const folder = folderOf(payload), slot = pendingKey(host, payload.requestId), earlier = pending.get(slot);
  check(earlier?.state !== 'recovering', 'RECOVERY_IN_PROGRESS', 'The recovery is already under way.');
  if (earlier?.state === 'recovered') return { requestId: payload.requestId, status: 'recovered' as const };
  if (earlier?.state === 'failed' && held(earlier) && earlier.folder === folder) {
    start(host, slot, earlier, folder, earlier.code!, payload.newPassphrase);
    return { requestId: payload.requestId, status: 'recovering' as const };
  }
  const file = await readRecoveryFile(host, folder);
  check(file, 'RECOVERY_NOT_ENROLLED', 'There is no recovery contact for this workspace on this computer. Use your recovery kit.');
  sameOrigin(host, file);
  const released = shape(await relay(host, 'POST', `/v1/recovery/requests/${payload.requestId}/release`, file.credential, 200, {}), ['requestId', 'key']);
  valid(released.requestId === payload.requestId && typeof released.key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(released.key));
  const key = Buffer.from(released.key, 'base64');
  let code: string;
  try {
    const sealed = Buffer.from(file.ciphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.nonce, 'base64url'));
    decipher.setAAD(aad(file.workspaceId, file.enrolmentId)); decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    code = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString('utf8');
  } catch { throw new ChausarError('RECOVERY_FILE_INVALID', 'The recovery contact file on this computer does not match. Use your recovery kit.'); }
  finally { key.fill(0); }
  check(RECOVERY_CODE.test(code), 'RECOVERY_FILE_INVALID', 'The recovery contact file on this computer does not match. Use your recovery kit.');
  // K is gone from the relay now, so the local half is of no further use.
  await rm(filePath(host, folder), { force: true });
  const entry: Pending = { state: 'recovering', folder };
  pending.set(slot, entry);
  start(host, slot, entry, folder, code, payload.newPassphrase);
  return { requestId: payload.requestId, status: 'recovering' as const };
}

/** Runs `workspace.recover` once the calling request has settled, retrying briefly while the engine is busy. */
function start(host: ModuleHost, slot: string, entry: Pending, folder: string, code: string, passphrase: string) {
  entry.state = 'recovering'; delete entry.failure; entry.code = code; entry.heldUntil = Date.now() + RETRY_HOLD_MS;
  pending.set(slot, entry);
  const attempt = async (tries: number) => {
    try {
      await host.call('workspace.recover', { folder, recoveryCode: code, passphrase });
      entry.state = 'recovered'; delete entry.code; delete entry.heldUntil;
    } catch (error: any) {
      const failure = error instanceof ChausarError ? error.code : 'RECOVERY_FAILED';
      if (failure === 'VAULT_BUSY' && tries < 200) { setTimeout(() => void attempt(tries + 1), 50); return; }
      entry.state = 'failed';
      // A code the vault refuses will never work: drop it. Anything else may pass, so it is held briefly for a retry.
      if (failure === 'UNLOCK_FAILED') { entry.failure = 'RECOVERY_CODE_REJECTED'; delete entry.code; delete entry.heldUntil; }
      else entry.failure = failure;
      setTimeout(() => { if (pending.get(slot) === entry && entry.state === 'failed') { delete entry.code; delete entry.heldUntil; } }, RETRY_HOLD_MS).unref?.();
    }
  };
  setImmediate(() => void attempt(0));
}
