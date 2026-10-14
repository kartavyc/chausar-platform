import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { check } from '../contracts.ts';
import { compareVersions } from '../updater.ts';
import { safeDirectory } from '../vault.ts';
import { acquireProcessLock } from '../process-lock.ts';
import { exactKeys, isoTimestamp, readJsonFile, writeJsonAtomic } from './update-files.ts';

export const CHANNEL_FORMAT = 'chausar.channel.v1';
export const MAX_CHANNEL_BYTES = 64 * 1024;
export const MAX_FEED_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RELEASES = 512, CLOCK_SKEW_MS = 5 * 60 * 1000;
export type ChannelName = 'stable' | 'preview';
export type ReleasePlatform = 'win32' | 'linux' | 'darwin';
export type ReleaseArchitecture = 'x64' | 'arm64';
export type ChannelRelease = Readonly<{
  version:string; platform:ReleasePlatform; architecture:ReleaseArchitecture; manifestSha256:string;
  rolloutPercent:number; withdrawn:boolean; previewExpiresAt:string|null;
}>;
export type ChannelDocument = Readonly<{
  format:typeof CHANNEL_FORMAT; channel:ChannelName; issuedAt:string; expiresAt:string; releases:readonly ChannelRelease[];
}>;
export type SelectReleaseInput = { platform:string; arch:string; currentVersion:string; installId:string; now?:number };
export type ReleaseSelection =
  | Readonly<{ action:'none'; reason:'up-to-date'|'not-in-rollout'; currentVersion:string }>
  | Readonly<{ action:'update'; currentVersion:string; release:ChannelRelease }>
  /** The running version was withdrawn (kill switch). `to` is null when the feed lists no older usable version. */
  | Readonly<{ action:'rollback-advised'; currentVersion:string; to:string|null; release:ChannelRelease|null }>;
export type AcceptedChannelState = Readonly<{ channel:ChannelName; issuedAt:string; documentSha256:string; acceptedAt:string }>;

const DOCUMENT_KEYS = ['format','channel','issuedAt','expiresAt','releases'], RELEASE_KEYS = ['version','platform','architecture','manifestSha256','rolloutPercent','withdrawn','previewExpiresAt'];
function canonical(value:any):string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
/** Canonical sorted JSON without whitespace; this exact UTF-8 byte sequence is the Ed25519 signing payload. */
export function canonicalChannelDocument(document:ChannelDocument):string { return canonical(document); }
function validVersion(value:unknown):value is string { try { compareVersions(value as string, value as string); return true; } catch { return false; } }
function validateDocument(value:any):asserts value is ChannelDocument {
  check(exactKeys(value, DOCUMENT_KEYS) && value.format === CHANNEL_FORMAT, 'UPDATE_FEED_INVALID', 'The update feed has unexpected or missing fields.');
  check(['stable','preview'].includes(value.channel), 'UPDATE_FEED_INVALID', 'The update feed names an unknown channel.');
  check(isoTimestamp(value.issuedAt) && isoTimestamp(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.issuedAt), 'UPDATE_FEED_INVALID', 'The update feed needs canonical issue and expiry timestamps.');
  check(Date.parse(value.expiresAt) - Date.parse(value.issuedAt) <= MAX_FEED_LIFETIME_MS, 'UPDATE_FEED_LIFETIME_TOO_LONG', 'An update feed may stay valid for at most thirty days.');
  check(Array.isArray(value.releases) && value.releases.length <= MAX_RELEASES, 'UPDATE_FEED_INVALID', 'The update feed release list is invalid.');
  const seen = new Set<string>();
  for (const release of value.releases) {
    check(exactKeys(release, RELEASE_KEYS) && validVersion(release.version), 'UPDATE_FEED_INVALID', 'An update feed release has unexpected fields or an invalid version.');
    check(['win32','linux','darwin'].includes(release.platform) && ['x64','arm64'].includes(release.architecture) && typeof release.manifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(release.manifestSha256), 'UPDATE_FEED_INVALID', 'An update feed release has an invalid target or digest.');
    check(Number.isSafeInteger(release.rolloutPercent) && release.rolloutPercent >= 0 && release.rolloutPercent <= 100 && typeof release.withdrawn === 'boolean', 'UPDATE_FEED_INVALID', 'An update feed release has an invalid rollout or withdrawal flag.');
    if (value.channel === 'preview') check(isoTimestamp(release.previewExpiresAt), 'UPDATE_FEED_INVALID', 'Every preview release must declare its expiry.');
    else check(release.previewExpiresAt === null, 'UPDATE_FEED_INVALID', 'Stable releases must not declare a preview expiry.');
    const key = `${release.platform}/${release.architecture}/${release.version}`;
    check(!seen.has(key), 'UPDATE_FEED_INVALID', 'The update feed lists the same release twice.'); seen.add(key);
  }
}
const freeze = (value:ChannelDocument):ChannelDocument => Object.freeze({ ...value, releases: Object.freeze(value.releases.map(release => Object.freeze({ ...release }))) });
function publicKey(key:string|KeyObject):KeyObject {
  const value = typeof key === 'string' ? createPublicKey(key) : key;
  check(value.type === 'public' && value.asymmetricKeyType === 'ed25519', 'INVALID_UPDATE_KEY', 'Pin an explicit Ed25519 release public key.');
  return value;
}
export type VerifyChannelOptions = { publicKey:string|KeyObject; channel:ChannelName; now?:number; lastAcceptedIssuedAt?:string|null };
/**
 * Verifies the exact canonical document text against its detached base64url Ed25519 signature, then the
 * channel, freshness and anti-rollback rules. Pure: persistence of the accepted issue time is `ChannelGuard`'s job.
 */
export function verifyChannelDocument(text:string, signature:string, options:VerifyChannelOptions):ChannelDocument {
  const key = publicKey(options.publicKey);
  check(typeof text === 'string' && text.length > 0, 'UPDATE_FEED_INVALID', 'The update feed is empty.');
  check(Buffer.byteLength(text) <= MAX_CHANNEL_BYTES, 'UPDATE_FEED_TOO_LARGE', 'The update feed exceeds its byte limit.');
  check(typeof signature === 'string' && signature.length > 0, 'UPDATE_FEED_UNSIGNED', 'The update feed has no detached signature.');
  check(signature.length === 86 && /^[A-Za-z0-9_-]+$/.test(signature), 'UPDATE_FEED_SIGNATURE_INVALID', 'The update feed signature is not a base64url Ed25519 signature.');
  let value:any; try { value = JSON.parse(text); } catch { check(false, 'UPDATE_FEED_INVALID', 'The update feed is not valid JSON.'); }
  validateDocument(value);
  check(canonicalChannelDocument(value) === text, 'UPDATE_FEED_NONCANONICAL', 'The update feed must be the exact canonical signing payload.');
  const bytes = Buffer.from(signature, 'base64url');
  check(bytes.length === 64 && bytes.toString('base64url') === signature && verifySignature(null, Buffer.from(text), key, bytes), 'UPDATE_FEED_SIGNATURE_INVALID', 'The update feed signature does not match the pinned release key.');
  check(value.channel === options.channel, 'UPDATE_FEED_WRONG_CHANNEL', 'The update feed belongs to a different release channel.');
  const now = options.now ?? Date.now();
  check(Date.parse(value.issuedAt) <= now + CLOCK_SKEW_MS, 'UPDATE_FEED_FROM_FUTURE', 'The update feed was issued in the future; check the computer clock.');
  check(Date.parse(value.expiresAt) > now, 'UPDATE_FEED_EXPIRED', 'The update feed has expired.');
  if (options.lastAcceptedIssuedAt != null) check(Date.parse(value.issuedAt) >= Date.parse(options.lastAcceptedIssuedAt), 'UPDATE_FEED_ROLLBACK', 'The update feed is older than one already accepted.');
  return freeze(value);
}
/** Deterministic rollout bucket 0–99: first four bytes of SHA-256(installId + version), big-endian, modulo 100. */
export function rolloutBucket(installId:string, version:string):number {
  return createHash('sha256').update(installId + version, 'utf8').digest().readUInt32BE(0) % 100;
}
export function validInstallId(value:unknown):value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value); }
export function selectRelease(document:ChannelDocument, input:SelectReleaseInput):ReleaseSelection {
  check(validInstallId(input.installId), 'INVALID_INSTALL_ID', 'The install identifier must be 8 to 128 URL-safe characters.');
  check(validVersion(input.currentVersion), 'INVALID_VERSION', 'Use an explicit semantic version without build metadata.');
  const now = input.now ?? Date.now(), current = input.currentVersion;
  const usable = (release:ChannelRelease) => !release.withdrawn && (release.previewExpiresAt === null || Date.parse(release.previewExpiresAt) > now);
  const candidates = document.releases.filter(release => release.platform === input.platform && release.architecture === input.arch)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (candidates.some(release => release.withdrawn && compareVersions(release.version, current) === 0)) {
    const target = candidates.find(release => usable(release) && compareVersions(release.version, current) < 0) ?? null;
    return Object.freeze({ action: 'rollback-advised', currentVersion: current, to: target?.version ?? null, release: target });
  }
  const newer = candidates.filter(release => usable(release) && compareVersions(release.version, current) > 0);
  const chosen = newer.find(release => rolloutBucket(input.installId, release.version) < release.rolloutPercent);
  if (chosen) return Object.freeze({ action: 'update', currentVersion: current, release: chosen });
  return Object.freeze({ action: 'none', reason: newer.length ? 'not-in-rollout' : 'up-to-date', currentVersion: current });
}

const STATE_KEYS = ['channel','issuedAt','documentSha256','acceptedAt'];
/** Persists the last accepted feed issue time so an older (replayed or frozen) feed is refused across restarts. */
export class ChannelGuard {
  #key:KeyObject; #channel:ChannelName; #directory:string; #now:()=>number;
  constructor(options:{ publicKey:string|KeyObject; channel:ChannelName; stateDirectory:string; now?:()=>number }) {
    this.#key = publicKey(options.publicKey);
    check(options.channel === 'stable' || options.channel === 'preview', 'UPDATE_FEED_WRONG_CHANNEL', 'Choose the stable or preview release channel.');
    this.#channel = options.channel; this.#directory = options.stateDirectory; this.#now = options.now ?? Date.now;
  }
  async lastAccepted():Promise<AcceptedChannelState|null> {
    const directory = await safeDirectory(this.#directory, true), value:any = await readJsonFile(join(directory, 'channel-state.json'), 4096, 'UPDATE_FEED_STATE_INVALID');
    if (value === undefined) return null;
    check(exactKeys(value, STATE_KEYS) && ['stable','preview'].includes(value.channel) && isoTimestamp(value.issuedAt) && isoTimestamp(value.acceptedAt) && typeof value.documentSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.documentSha256), 'UPDATE_FEED_STATE_INVALID', 'The saved update feed state is invalid.');
    return Object.freeze(value);
  }
  /** Verify and accept a feed; the same issue time is accepted again only for the identical document. */
  async accept(text:string, signature:string):Promise<ChannelDocument> {
    const directory = await safeDirectory(this.#directory, true);
    const lock = await acquireProcessLock(join(directory, 'channel.lock'), { busyCode: 'UPDATE_BUSY', changedCode: 'UPDATE_LOCK_CHANGED', unsafeCode: 'UNSAFE_UPDATE_PATH' });
    try {
      const last = await this.lastAccepted(), now = this.#now();
      const previous = last && last.channel === this.#channel ? last : null;
      const document = verifyChannelDocument(text, signature, { publicKey: this.#key, channel: this.#channel, now, lastAcceptedIssuedAt: previous?.issuedAt ?? null });
      const documentSha256 = createHash('sha256').update(text).digest('hex');
      if (previous && previous.issuedAt === document.issuedAt) check(previous.documentSha256 === documentSha256, 'UPDATE_FEED_CONFLICT', 'A different update feed was signed with the same issue time.');
      else await writeJsonAtomic(join(directory, 'channel-state.json'), { channel: this.#channel, issuedAt: document.issuedAt, documentSha256, acceptedAt: new Date(now).toISOString() });
      return document;
    } finally { await lock.release(); }
  }
}
