/**
 * Typed fixtures for the round 4 methods other lanes own (`bridge/r4-contracts.ts`): PIN quick
 * unlock, the route ladder and route probe (not registered yet), and the local model list, the
 * workspace time zone and joining from another computer, which now follow their owners' real
 * replies and refusal codes (models-ext `routes-methods.ts`, core-data `data.ts`,
 * core-sync-jobs `devices.ts`; `platform/tests/frame-today-r4-real-contracts.test.ts` feeds the
 * real replies through the same validators). The fake engine serves them so previews and tests
 * can walk every state; a fake made with `absent` leaves any of them out, so the "not built yet"
 * state can be walked too. Synthetic only.
 */
import type { FakeHandler } from '../fake.ts';
import { JOIN_CODE, PIN_PATTERN, isDeviceName, isTimeZone, type PinStatus } from '../r4-contracts.ts';

/** The PIN the fixtures accept for a folder once one is set. Synthetic; never a real secret. */
export const FAKE_PIN = '246810';
/** Wrong PINs allowed before only the passphrase unlocks. */
export const FAKE_PIN_TRIES = 5;
/** The code the fixtures show for a join: six digits, as core-sync-jobs makes them. */
export const FAKE_JOIN_CODE = '482199';
/** The shared folder the fixtures accept for a join; any other full path is not set up. */
export const FAKE_SHARED_FOLDER = '/Users/demo/Shared/Chausar';
/** The managed name of the copy a finished join leaves in the backups folder. */
export const FAKE_JOIN_BACKUP = 'joined-1760500000000.backup';

export interface R4FixtureHost {
  readonly refuse: (code: string, message?: string) => Error;
  /** The folder open now, or null while locked. */
  openFolder(): string | null;
  /** Open a folder as the PIN would (the fake's own unlock). */
  unlock(folder: string): unknown;
  /** Whether a passphrase is the right one for the open folder. */
  passphraseFits(passphrase: unknown): boolean;
  /** The passphrase of the workspace a joined copy holds (the demo shop's). */
  joinedPassphrase(): string;
  role(): 'owner' | 'cofounder' | 'accountant' | 'viewer';
  routeIds(): readonly string[];
  setRouteIds(ids: readonly string[]): void;
  setTimeZone(zone: string): void;
  /** Milliseconds of the fake clock, for the 15-minute join window. */
  now(): number;
}

export interface R4FixtureOptions {
  /** Folders that start with a PIN set. */
  readonly pins?: readonly string[];
}

type FakeJoin = { requestId: string; name: string; code: string; expiresAt: string; state: 'waiting' | 'approved' | 'refused' | 'used' };

export function r4Handlers(host: R4FixtureHost, options: R4FixtureOptions = {}): Readonly<Record<string, FakeHandler>> {
  const pins = new Map<string, { tries: number; passphraseOnly: boolean }>((options.pins ?? []).map(folder => [folder, { tries: 0, passphraseOnly: false }]));
  const joins = new Map<string, FakeJoin>();
  /** The join this computer started (core-sync-jobs keeps one pending join per computer). */
  let pending: string | null = null;
  const admin = () => { const role = host.role(); if (role !== 'owner' && role !== 'cofounder') throw host.refuse('FORBIDDEN', 'Only an owner does this.'); };
  const folderOf = (payload: Readonly<Record<string, unknown>>) => {
    const folder = payload['folder'] ?? host.openFolder();
    if (typeof folder !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(folder)) throw host.refuse('INVALID_REQUEST', 'Name the workspace folder.');
    return folder;
  };
  const status = (folder: string): PinStatus => { const pin = pins.get(folder); return { set: pin !== undefined, passphraseOnly: pin?.passphraseOnly ?? false }; };
  const expired = (join: FakeJoin) => Date.parse(join.expiresAt) <= host.now();
  const fields = (payload: Readonly<Record<string, unknown>>, allowed: readonly string[]) => {
    if (!Object.keys(payload).every(key => allowed.includes(key))) throw host.refuse('INVALID_DEVICE_REQUEST', 'This device request has fields it does not use.');
  };
  const waiting = (join: FakeJoin) => ({ state: 'waiting', requestId: join.requestId, code: join.code, expiresAt: join.expiresAt });

  return {
    'workspace.pin.status': payload => status(folderOf(payload)),
    'workspace.pin.unlock': payload => {
      if (host.openFolder() !== null) throw host.refuse('VAULT_OPEN', 'Lock the current workspace first.');
      const folder = folderOf(payload), pin = pins.get(folder);
      if (pin === undefined) throw host.refuse('PIN_NOT_SET', 'No PIN is set on this computer.');
      if (pin.passphraseOnly) throw host.refuse('PIN_LOCKED_OUT', 'Use the passphrase.');
      if (payload['pin'] !== FAKE_PIN) {
        pin.tries += 1;
        if (pin.tries >= FAKE_PIN_TRIES) { pin.passphraseOnly = true; throw host.refuse('PIN_LOCKED_OUT', 'Use the passphrase.'); }
        throw host.refuse('PIN_WRONG', 'That PIN is not right.');
      }
      pin.tries = 0;
      return host.unlock(folder);
    },
    'workspace.pin.set': payload => {
      admin();
      const folder = folderOf({});
      if (typeof payload['pin'] !== 'string' || !PIN_PATTERN.test(payload['pin'])) throw host.refuse('PIN_INVALID', 'A PIN is 4 to 12 digits.');
      if (!host.passphraseFits(payload['passphrase'])) throw host.refuse('UNLOCK_FAILED', 'Unable to unlock vault.');
      pins.set(folder, { tries: 0, passphraseOnly: false });
      return status(folder);
    },
    'workspace.pin.remove': () => { admin(); const folder = folderOf({}); pins.delete(folder); return status(folder); },
    'models.setLadder': payload => {
      admin();
      const ids = payload['routeIds'], known = host.routeIds();
      if (!Array.isArray(ids) || ids.length !== known.length || new Set(ids).size !== ids.length) throw host.refuse('LADDER_INVALID', 'Name every route once.');
      if (!ids.every(item => typeof item === 'string' && known.includes(item))) throw host.refuse('ROUTE_NOT_FOUND', 'A route is not known.');
      host.setRouteIds(ids as string[]);
      return { routeIds: [...host.routeIds()] };
    },
    'models.probe': payload => {
      const routeId = payload['routeId'];
      if (typeof routeId !== 'string' || !host.routeIds().includes(routeId)) throw host.refuse('ROUTE_NOT_FOUND', 'A route is not known.');
      return { routeId, state: 'version-untested', checkedAt: new Date(host.now()).toISOString() };
    },
    // models-ext's reply shape; the real method refuses DEMO_PROVIDER_DISABLED in a demo engine.
    'modelsx.localList': () => ({
      endpoint: 'http://127.0.0.1:11434', reachable: true,
      models: [
        { name: 'demo-local-model', sizeBytes: 2_019_393_189, modifiedAt: '2026-09-01T10:00:00.000Z', family: 'demo' },
        { name: 'demo-small:3b', sizeBytes: 1_100_000_000, modifiedAt: '2026-08-12T10:00:00.000Z', family: 'demo' },
      ],
      skipped: 0,
    }),
    // core-data's refusals: INVALID_TIME_ZONE for anything but a known zone name, and only that one field.
    'workspace.setTimeZone': payload => {
      admin();
      if (Object.keys(payload).length !== 1 || !isTimeZone(payload['timeZone'])) throw host.refuse('INVALID_TIME_ZONE', 'Choose a time zone by its name, such as Asia/Kolkata.');
      host.setTimeZone(payload['timeZone']);
      return { timeZone: payload['timeZone'] };
    },
    // The new computer (core-sync-jobs' steps): request with the shared folder, finish to read, cancel.
    'devices.join': payload => {
      admin();
      const step = payload['step'];
      if (step !== 'request' && step !== 'finish' && step !== 'cancel') throw host.refuse('INVALID_DEVICE_REQUEST', 'Say which join step this is.');
      if (step === 'cancel') { fields(payload, ['step']); pending = null; return { state: 'cancelled' }; }
      if (step === 'request') {
        fields(payload, ['step', 'folder', 'deviceName']);
        const folder = payload['folder'];
        if (typeof folder !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(folder)) throw host.refuse('INVALID_DEVICE_REQUEST', 'Choose the shared folder by its full path.');
        if (payload['deviceName'] !== undefined && !isDeviceName(payload['deviceName'])) throw host.refuse('INVALID_DEVICE_REQUEST', 'Name this computer in a few plain words.');
        if (folder !== FAKE_SHARED_FOLDER) throw host.refuse('DEVICE_FOLDER_NOT_SET_UP', 'Set up sync on a computer that is already in, with this folder.');
        const n = joins.size + 1;
        const join: FakeJoin = { requestId: `join_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: typeof payload['deviceName'] === 'string' ? payload['deviceName'] : 'This computer',
          code: FAKE_JOIN_CODE, expiresAt: new Date(host.now() + 15 * 60_000).toISOString(), state: 'waiting' };
        joins.set(join.requestId, join); pending = join.requestId;
        return waiting(join);
      }
      fields(payload, ['step']);
      const join = pending === null ? undefined : joins.get(pending);
      if (join === undefined) throw host.refuse('DEVICE_JOIN_NOT_STARTED', 'Start joining on this computer first.');
      if (join.state === 'refused') { pending = null; return { state: 'refused' }; }
      if (join.state === 'approved') { pending = null; join.state = 'used'; return { state: 'ready', backupFile: FAKE_JOIN_BACKUP, revision: 3, next: 'restore-then-restart' }; }
      if (expired(join)) { pending = null; return { state: 'expired' }; }
      return waiting(join);
    },
    // A computer already in: the waiting requests, Approve after comparing the code, or Refuse.
    'seats.inviteVerify': payload => {
      admin();
      fields(payload, ['requestId', 'code', 'approve']);
      if (payload['requestId'] === undefined) {
        return { requests: [...joins.values()].filter(join => join.state === 'waiting' && !expired(join))
          .map(join => ({ requestId: join.requestId, name: join.name, code: join.code, expiresAt: join.expiresAt, fingerprint: '0123456789abcdef' })) };
      }
      if (typeof payload['requestId'] !== 'string' || typeof payload['approve'] !== 'boolean') throw host.refuse('INVALID_DEVICE_REQUEST', 'Choose a request and say whether to approve it.');
      const join = joins.get(payload['requestId']);
      if (join === undefined) throw host.refuse('DEVICE_JOIN_NOT_FOUND', 'This request was not found.');
      if (!payload['approve']) { if (join.state === 'waiting') join.state = 'refused'; return { refused: true, requestId: join.requestId }; }
      if (typeof payload['code'] !== 'string' || !JOIN_CODE.test(payload['code']) || payload['code'] !== join.code) throw host.refuse('DEVICE_JOIN_CODE_MISMATCH', 'The codes do not match. Do not approve.');
      if (expired(join)) throw host.refuse('DEVICE_JOIN_EXPIRED', 'This request expired. Start again on the new computer.');
      if (join.state !== 'waiting') throw host.refuse('DEVICE_JOIN_USED', 'This request was already used.');
      join.state = 'approved';
      return { approved: true, requestId: join.requestId, deviceId: `device_demo_${join.requestId.slice(-4)}`, revision: 3 };
    },
    // The core's restore of a managed backup, here only for the copy a finished join left.
    'workspace.restore': payload => {
      if (host.openFolder() !== null) throw host.refuse('VAULT_OPEN', 'Lock the current workspace before restoring.');
      if (payload['backupFile'] !== FAKE_JOIN_BACKUP) throw host.refuse('INVALID_PATH', 'Choose a managed backup file.');
      if (payload['passphrase'] !== host.joinedPassphrase()) throw host.refuse('UNLOCK_FAILED', 'Unable to unlock vault.');
      return host.unlock(folderOf(payload));
    },
  };
}

/** Every method these fixtures serve. */
export const R4_METHODS: readonly string[] = [
  'workspace.pin.status', 'workspace.pin.unlock', 'workspace.pin.set', 'workspace.pin.remove', 'models.setLadder', 'models.probe',
  'modelsx.localList', 'workspace.setTimeZone', 'devices.join', 'seats.inviteVerify', 'workspace.restore',
];
/** Served before any workspace is open, as their owners mark them `preVault` (the core serves `workspace.restore` locked). */
export const R4_PRE_VAULT: readonly string[] = ['workspace.pin.status', 'workspace.pin.unlock', 'devices.join', 'workspace.restore'];
