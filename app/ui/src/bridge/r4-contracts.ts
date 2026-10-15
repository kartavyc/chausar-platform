/**
 * Round 4 contracts the frame and first run build against: methods owned by other lanes
 * (core-gateway-auth, core-data, core-sync-jobs, models-ext, learning-ext). Where the owner has
 * not registered its method yet the shape here is the expected one, served by the fake engine
 * from `bridge/fixtures/r4.ts`; a screen shows "not built yet" when the reply is
 * `UNKNOWN_METHOD`, `INVALID_REQUEST` or `METHOD_UNAVAILABLE`. Every reply is checked with the
 * guards below before anything is drawn. Replies carry codes, ids and names as data only.
 *
 * | Method | Payload | Reply | Owner |
 * |---|---|---|---|
 * | `workspace.pin.status` (preVault) | `{ folder? }` | `PinStatus` | core-gateway-auth |
 * | `workspace.pin.unlock` (preVault) | `{ folder, pin }` | `{ workspace }` like `workspace.open`; refusals `PIN_WRONG`, `PIN_LOCKED_OUT`, `PIN_NOT_SET` | core-gateway-auth |
 * | `workspace.pin.set` (admin) | `{ pin, passphrase }` | `PinStatus`; refusals `PIN_INVALID`, `UNLOCK_FAILED` | core-gateway-auth |
 * | `workspace.pin.remove` (admin) | `{}` | `PinStatus` | core-gateway-auth |
 * | `models.setLadder` (admin) | `{ routeIds }` | `{ routeIds }`; refusals `LADDER_INVALID`, `ROUTE_NOT_FOUND` | core-gateway-auth |
 * | `models.probe` (read) | `{ routeId }` | `RouteProbe` | core-gateway-auth |
 * | `modelsx.localList` (read; refuses `DEMO_PROVIDER_DISABLED` in a demo engine) | `{ endpoint? }` | `LocalModelsReply` | models-ext (registered) |
 * | `workspace.setTimeZone` (admin) | `{ timeZone }` | `{ timeZone }` (the zone list's own spelling); refusals `INVALID_TIME_ZONE`, `TAINTED_SETTING`; then `ui.context.timeZone` | core-data (registered) |
 * | `devices.join` (admin, preVault, desktop) | `{ step: 'request', folder, deviceName? }` / `{ step: 'finish' }` / `{ step: 'cancel' }` | `JoinState` | core-sync-jobs (registered) |
 * | `seats.inviteVerify` (admin, desktop, a computer already in) | `{}` / `{ requestId, code, approve: true }` / `{ requestId, approve: false }` | `{ requests }` or `JoinAnswer`; refusals in `JOIN_REFUSALS` | core-sync-jobs (registered) |
 * | `learningx.intakeStatus`, `learningx.preview`, `learningx.consent` | as registered | `IntakeStatus`, `SharingPreview`, `SharingConsent` | learning-ext (registered) |
 *
 * `workspaces.switch` (SH-06) is not an engine method: the host composes it from the
 * controller's lock (`workspace.lock`, never failing open) and the lock screen for the chosen
 * folder (`workspace.open { folder, passphrase }` or `workspace.pin.unlock`).
 */

export type R4Record = Record<string, unknown>;
type Rec = R4Record;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const instant = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const only = (v: Rec, keys: readonly string[], optional: readonly string[] = []) =>
  keys.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => keys.includes(key) || optional.includes(key));

/* ---------------------------------------------------------------- PIN quick unlock (SH-02, TR-12) */

/** A PIN is 4 to 12 digits. It passes once to the engine and is never held. */
export const PIN_PATTERN = /^\d{4,12}$/;
/**
 * `set`: a PIN wraps the vault key on this computer. `passphraseOnly`: too many wrong tries,
 * so only the passphrase unlocks until it is used once. No count of tries is ever given.
 */
export interface PinStatus { readonly set: boolean; readonly passphraseOnly: boolean }
export function isPinStatus(v: unknown): v is PinStatus {
  return isRec(v) && only(v, ['set', 'passphraseOnly'], ['folder']) && typeof v.set === 'boolean' && typeof v.passphraseOnly === 'boolean'
    && (v.folder === undefined || str(v.folder, 64));
}

/* ---------------------------------------------------------------- the route ladder (FR-05, TR-08) */

export interface LadderReply { readonly routeIds: readonly string[] }
export function isLadderReply(v: unknown): v is LadderReply {
  return isRec(v) && only(v, ['routeIds']) && Array.isArray(v.routeIds) && v.routeIds.length <= 100 && v.routeIds.every(id)
    && new Set(v.routeIds).size === v.routeIds.length;
}
export type ProbeState = 'ready' | 'signed-out' | 'not-installed' | 'version-untested' | 'timed-out' | 'error' | 'skipped-by-send';
export const PROBE_STATES: readonly ProbeState[] = ['ready', 'signed-out', 'not-installed', 'version-untested', 'timed-out', 'error', 'skipped-by-send'];
export interface RouteProbe { readonly routeId: string; readonly state: ProbeState; readonly checkedAt: string }
export function isRouteProbe(v: unknown): v is RouteProbe {
  return isRec(v) && only(v, ['routeId', 'state', 'checkedAt']) && id(v.routeId) && PROBE_STATES.includes(v.state as ProbeState) && instant(v.checkedAt);
}

/* ---------------------------------------------------------------- local models (models-ext) */

export interface LocalModel { readonly name: string; readonly sizeBytes: number | null; readonly modifiedAt: string | null; readonly family: string | null }
/**
 * models-ext's registered reply (`routes-methods.ts`): `{ endpoint, reachable: true, models, skipped }` (`skipped`: entries
 * whose names were refused) or `{ endpoint, reachable: false, models: [], words }`. The words are the engine's; the screen
 * says its own.
 */
export type LocalModelsReply =
  | { readonly reachable: true; readonly endpoint: string; readonly models: readonly LocalModel[] }
  | { readonly reachable: false };
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
function isLocalModel(v: unknown): v is LocalModel {
  return isRec(v) && only(v, ['name'], ['sizeBytes', 'modifiedAt', 'family']) && typeof v.name === 'string' && MODEL_NAME.test(v.name)
    && (v.sizeBytes === undefined || v.sizeBytes === null || (typeof v.sizeBytes === 'number' && Number.isSafeInteger(v.sizeBytes) && v.sizeBytes >= 0)
      || (typeof v.sizeBytes === 'string' && /^\d{1,18}$/.test(v.sizeBytes)))
    && (v.modifiedAt === undefined || v.modifiedAt === null || (typeof v.modifiedAt === 'string' && v.modifiedAt.length <= 64))
    && (v.family === undefined || v.family === null || str(v.family, 64));
}
/** Checks the reply and gives it back in one form; null when it does not match. */
export function readLocalModels(v: unknown): LocalModelsReply | null {
  if (!isRec(v) || typeof v.reachable !== 'boolean') return null;
  if (v.reachable === false) {
    return only(v, ['reachable'], ['endpoint', 'models', 'words']) && (v.words === undefined || typeof v.words === 'string') && (v.endpoint === undefined || str(v.endpoint, 2048))
      && (v.models === undefined || (Array.isArray(v.models) && v.models.length === 0)) ? Object.freeze({ reachable: false as const }) : null;
  }
  if (!only(v, ['reachable', 'endpoint', 'models'], ['skipped']) || !(v.skipped === undefined || (Number.isSafeInteger(v.skipped) && (v.skipped as number) >= 0)) || !str(v.endpoint, 2048) || !Array.isArray(v.models) || v.models.length > 500 || !v.models.every(isLocalModel)) return null;
  const models = v.models.map(m => Object.freeze({
    name: m.name,
    sizeBytes: m.sizeBytes === undefined || m.sizeBytes === null ? null : Number(m.sizeBytes),
    modifiedAt: m.modifiedAt ?? null, family: m.family ?? null,
  }));
  return Object.freeze({ reachable: true, endpoint: v.endpoint, models: Object.freeze(models) });
}

/* ---------------------------------------------------------------- the workspace time zone (core-data) */

const ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/;
/** An IANA zone name this runtime knows. */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 100 || !ZONE.test(v)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}
export interface TimeZoneReply { readonly timeZone: string }
export function isTimeZoneReply(v: unknown): v is TimeZoneReply {
  return isRec(v) && only(v, ['timeZone']) && isTimeZone(v.timeZone);
}
/** `ui.context`'s zone: a name, or null while none is stored. Anything else does not match. */
export function contextTimeZone(v: unknown): { readonly timeZone: string | null } | null {
  if (!isRec(v) || !Object.hasOwn(v, 'timeZone')) return isRec(v) ? { timeZone: null } : null;
  return v.timeZone === null ? { timeZone: null } : isTimeZone(v.timeZone) ? { timeZone: v.timeZone } : null;
}

/* ---------------------------------------------------------------- joining from another computer (FR-14) */

/*
 * core-sync-jobs' real contract (platform/runtime/core-sync-jobs/devices.ts), through a shared folder both
 * computers can reach:
 * - `devices.join` (admin, preVault, desktop only) on the new computer:
 *   `{ step: 'request', folder: <full path>, deviceName? }` → `{ state: 'waiting', requestId, code: six digits, expiresAt }`;
 *   `{ step: 'finish' }` → the same waiting reply, or `{ state: 'ready', backupFile, revision, next: 'restore-then-restart' }`,
 *   or `{ state: 'refused' | 'expired' }`; `{ step: 'cancel' }` → `{ state: 'cancelled' }`.
 * - `seats.inviteVerify` (admin, desktop) on a computer already in: `{}` → `{ requests: [{ requestId, name, code, expiresAt,
 *   fingerprint }] }`; `{ requestId, code, approve: true }` → `{ approved: true, requestId, deviceId, revision }`;
 *   `{ requestId, approve: false }` → `{ refused: true, requestId }`.
 * Ready means the encrypted copy is in this computer's backups folder: `workspace.restore { backupFile, passphrase, folder }`,
 * then a restart starts sync on this computer.
 */

/** The code both computers show: six digits. */
export const JOIN_CODE = /^\d{6}$/;
const JOIN_REQUEST_ID = /^join_[a-f0-9-]{36}$/;
/** The encrypted copy's managed name in this computer's backups folder; never a path. */
const JOIN_BACKUP = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.backup$/;
const DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,59}$/u;
export const isJoinRequestId = (v: unknown): v is string => typeof v === 'string' && JOIN_REQUEST_ID.test(v);
/** A computer name as core-sync-jobs accepts it (a few plain words); checked before it is sent. */
export const isDeviceName = (v: unknown): v is string => typeof v === 'string' && DEVICE_NAME.test(v);

export type JoinState =
  | { readonly state: 'waiting'; readonly requestId: string; readonly code: string; readonly expiresAt: string }
  | { readonly state: 'ready'; readonly backupFile: string; readonly revision: number }
  | { readonly state: 'refused' | 'expired' | 'cancelled' };
export type JoinPhase = JoinState['state'];
/** Checks a `devices.join` reply and gives back only the fields the screen uses; null when it does not match. */
export function readJoinState(v: unknown): JoinState | null {
  if (!isRec(v)) return null;
  if (v.state === 'waiting') {
    return only(v, ['state', 'requestId', 'code', 'expiresAt']) && isJoinRequestId(v.requestId) && typeof v.code === 'string' && JOIN_CODE.test(v.code) && instant(v.expiresAt)
      ? Object.freeze({ state: 'waiting' as const, requestId: v.requestId, code: v.code, expiresAt: v.expiresAt }) : null;
  }
  if (v.state === 'ready') {
    return only(v, ['state', 'backupFile', 'revision', 'next']) && typeof v.backupFile === 'string' && JOIN_BACKUP.test(v.backupFile)
      && Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 && v.next === 'restore-then-restart'
      ? Object.freeze({ state: 'ready' as const, backupFile: v.backupFile, revision: v.revision as number }) : null;
  }
  if (v.state === 'refused' || v.state === 'expired' || v.state === 'cancelled') return only(v, ['state']) ? Object.freeze({ state: v.state }) : null;
  return null;
}
/** A waiting join is expired once its time has passed, whatever the last reply said. */
export function joinPhaseAt(join: JoinState, now: number): JoinPhase {
  return join.state === 'waiting' && Date.parse(join.expiresAt) <= now ? 'expired' : join.state;
}

/** One computer asking to join, as the computer already in lists it. The name is the other computer's own words: data only. */
export interface JoinRequest { readonly requestId: string; readonly name: string; readonly code: string; readonly expiresAt: string; readonly fingerprint: string }
export function readJoinRequests(v: unknown): readonly JoinRequest[] | null {
  if (!isRec(v) || !only(v, ['requests']) || !Array.isArray(v.requests) || v.requests.length > 100) return null;
  const out: JoinRequest[] = [];
  for (const r of v.requests) {
    if (!isRec(r) || !only(r, ['requestId', 'name', 'code', 'expiresAt', 'fingerprint']) || !isJoinRequestId(r.requestId) || !isDeviceName(r.name)
      || typeof r.code !== 'string' || !JOIN_CODE.test(r.code) || !instant(r.expiresAt) || typeof r.fingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(r.fingerprint)) return null;
    out.push(Object.freeze({ requestId: r.requestId, name: r.name, code: r.code, expiresAt: r.expiresAt, fingerprint: r.fingerprint }));
  }
  return Object.freeze(out);
}
/** `seats.inviteVerify`'s answer to Approve or Refuse, for this request only. */
export type JoinAnswer = { readonly approved: true; readonly revision: number } | { readonly refused: true };
export function readJoinAnswer(v: unknown, requestId: string): JoinAnswer | null {
  if (!isRec(v) || v.requestId !== requestId) return null;
  if (v.approved === true) {
    return only(v, ['approved', 'requestId', 'deviceId', 'revision']) && typeof v.deviceId === 'string' && /^[a-z][a-z0-9_-]{2,80}$/.test(v.deviceId)
      && Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 ? Object.freeze({ approved: true as const, revision: v.revision as number }) : null;
  }
  return v.refused === true && only(v, ['refused', 'requestId']) ? Object.freeze({ refused: true as const }) : null;
}
/** The join refusals the screens say in their own words (on core-sync-jobs' `laneRefusals` line and frame-today's). */
export const JOIN_REFUSALS = [
  'DEVICE_JOIN_CODE_MISMATCH', 'DEVICE_JOIN_EXPIRED', 'DEVICE_JOIN_USED', 'DEVICE_JOIN_NOT_FOUND', 'DEVICE_JOIN_NOT_STARTED', 'DEVICE_JOIN_INVALID',
  'DEVICE_JOIN_NEEDS_FOLDER', 'DEVICE_ALREADY_ENROLLED', 'DEVICE_NOT_ENROLLED', 'DEVICE_REMOVED', 'DEVICE_FOLDER_UNAVAILABLE', 'DEVICE_FOLDER_NOT_SET_UP',
  'INVALID_DEVICE_REQUEST', 'SYNC_READ_ONLY_DEVICE', 'SYNC_OFF', 'SYNC_NOT_CONNECTED', 'SYNC_UNTRUSTED_DEVICE', 'SYNC_EMPTY', 'SYNC_LEASE_WAIT',
  'APP_APPROVAL_REQUIRED',
] as const;

/* ---------------------------------------------------------------- the sharing question (FR-10, learning-ext) */

export type ShareBox = 'setup-shapes' | 'corrections';
export const SHARE_BOXES: readonly ShareBox[] = ['setup-shapes', 'corrections'];
export interface IntakeStatus { readonly open: boolean; readonly mode: 'closed' | 'intake' | 'test-inbox'; readonly sharingSwitch: boolean }
export function readIntakeStatus(v: unknown): IntakeStatus | null {
  if (!isRec(v) || typeof v.open !== 'boolean' || !['closed', 'intake', 'test-inbox'].includes(v.mode as string) || typeof v.sharingSwitch !== 'boolean') return null;
  if (v.open !== (v.mode !== 'closed')) return null;
  return Object.freeze({ open: v.open, mode: v.mode as IntakeStatus['mode'], sharingSwitch: v.sharingSwitch });
}
/** The exact file that would be sent: its bytes (structure only, drawn as text), its digest and size. */
export interface SharingPreview { readonly id: string; readonly digest: string; readonly bytes: string; readonly size: number; readonly count: number; readonly blocked: number }
export function readSharingPreview(v: unknown): SharingPreview | null {
  if (!isRec(v) || !id(v.id) || typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest) || typeof v.bytes !== 'string' || v.bytes.length > 1_000_000
    || !Number.isSafeInteger(v.size) || !Number.isSafeInteger(v.count) || !Array.isArray(v.blocked)) return null;
  return Object.freeze({ id: v.id, digest: v.digest, bytes: v.bytes, size: v.size as number, count: v.count as number, blocked: v.blocked.length });
}
export interface SharingConsent { readonly id: string; readonly digest: string }
export function readSharingConsent(v: unknown): SharingConsent | null {
  return isRec(v) && id(v.id) && typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest) ? Object.freeze({ id: v.id, digest: v.digest }) : null;
}

/** Refusal codes these contracts name; mirrored on frame-today's `laneRefusals` line so they reach the screen. */
export const R4_REFUSALS = [
  'PIN_WRONG', 'PIN_LOCKED_OUT', 'PIN_NOT_SET', 'PIN_INVALID', 'LADDER_INVALID', 'ROUTE_NOT_FOUND', 'INVALID_TIME_ZONE', 'TAINTED_SETTING',
  'DEMO_PROVIDER_DISABLED', 'LOCAL_ENDPOINT_APP_ONLY', 'LOCAL_LIST_INVALID', 'INVALID_ENDPOINT',
  ...JOIN_REFUSALS,
] as const;
