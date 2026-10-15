/**
 * Typed fixtures for the round 4 methods other lanes own and have not registered yet
 * (`bridge/r4-contracts.ts`): PIN quick unlock, the route ladder and route probe, the local
 * model list, the workspace time zone, and joining from another computer. The fake engine
 * serves them so previews and tests can walk every state; a fake made with `absent` leaves
 * any of them out, so the "not built yet" state can be walked too. Synthetic only.
 */
import type { FakeHandler } from '../fake.ts';
import { JOIN_CODE, PIN_PATTERN, isTimeZone, type JoinState, type PinStatus } from '../r4-contracts.ts';

/** The PIN the fixtures accept for a folder once one is set. Synthetic; never a real secret. */
export const FAKE_PIN = '246810';
/** Wrong PINs allowed before only the passphrase unlocks. */
export const FAKE_PIN_TRIES = 5;
/** The code the fixtures show for a join; two groups of four digits. */
export const FAKE_JOIN_CODE = '4821-9930';

export interface R4FixtureHost {
  readonly refuse: (code: string, message?: string) => Error;
  /** The folder open now, or null while locked. */
  openFolder(): string | null;
  /** Open a folder as the PIN would (the fake's own unlock). */
  unlock(folder: string): unknown;
  /** Whether a passphrase is the right one for the open folder. */
  passphraseFits(passphrase: unknown): boolean;
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

export function r4Handlers(host: R4FixtureHost, options: R4FixtureOptions = {}): Readonly<Record<string, FakeHandler>> {
  const pins = new Map<string, { tries: number; passphraseOnly: boolean }>((options.pins ?? []).map(folder => [folder, { tries: 0, passphraseOnly: false }]));
  const joins = new Map<string, JoinState>();
  const admin = () => { const role = host.role(); if (role !== 'owner' && role !== 'cofounder') throw host.refuse('FORBIDDEN', 'Only an owner does this.'); };
  const folderOf = (payload: Readonly<Record<string, unknown>>) => {
    const folder = payload['folder'] ?? host.openFolder();
    if (typeof folder !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(folder)) throw host.refuse('INVALID_REQUEST', 'Name the workspace folder.');
    return folder;
  };
  const status = (folder: string): PinStatus => { const pin = pins.get(folder); return { set: pin !== undefined, passphraseOnly: pin?.passphraseOnly ?? false }; };
  const joinView = (join: JoinState): JoinState => join.state === 'waiting' && Date.parse(join.expiresAt) <= host.now() ? { ...join, state: 'expired' } : join;

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
    'modelsx.localList': () => ({
      reachable: true, endpoint: 'http://127.0.0.1:11434',
      models: [
        { name: 'demo-local-model', sizeBytes: 2_019_393_189, modifiedAt: '2026-09-01T10:00:00Z', family: 'demo' },
        { name: 'demo-small:3b', sizeBytes: 1_100_000_000, modifiedAt: '2026-08-12T10:00:00Z', family: 'demo' },
      ],
    }),
    'workspace.setTimeZone': payload => {
      admin();
      if (Object.keys(payload).length !== 1 || !isTimeZone(payload['timeZone'])) throw host.refuse('TIME_ZONE_INVALID', 'Name a time zone.');
      host.setTimeZone(payload['timeZone']);
      return { timeZone: payload['timeZone'] };
    },
    // The new computer: start a join (a short code, 15 minutes), then read it again.
    'devices.join': payload => {
      if (payload['joinId'] === undefined) {
        const join: JoinState = { joinId: `join_demo_${joins.size + 1}`, code: FAKE_JOIN_CODE, expiresAt: new Date(host.now() + 15 * 60_000).toISOString(), state: 'waiting' };
        joins.set(join.joinId, join);
        return join;
      }
      const join = typeof payload['joinId'] === 'string' ? joins.get(payload['joinId']) : undefined;
      if (join === undefined) throw host.refuse('NOT_FOUND', 'That join is not known.');
      return joinView(join);
    },
    // A computer already in: the waiting joins, and Approve after comparing the code.
    'seats.inviteVerify': payload => {
      admin();
      if (payload['joinId'] === undefined) return { requests: [...joins.values()].map(joinView).filter(join => join.state === 'waiting') };
      const join = typeof payload['joinId'] === 'string' ? joins.get(payload['joinId']) : undefined;
      if (join === undefined) throw host.refuse('NOT_FOUND', 'That join is not known.');
      const now = joinView(join);
      if (now.state === 'expired') throw host.refuse('JOIN_EXPIRED', 'The code expired.');
      if (now.state !== 'waiting') throw host.refuse('JOIN_USED', 'The code was used.');
      if (typeof payload['code'] !== 'string' || !JOIN_CODE.test(payload['code']) || payload['code'] !== join.code) throw host.refuse('JOIN_CODE_MISMATCH', 'The codes differ.');
      const approved: JoinState = { ...join, state: 'approved', folder: 'joined-shop' };
      joins.set(join.joinId, approved);
      return approved;
    },
  };
}

/** Every method these fixtures serve. */
export const R4_METHODS: readonly string[] = [
  'workspace.pin.status', 'workspace.pin.unlock', 'workspace.pin.set', 'workspace.pin.remove', 'models.setLadder', 'models.probe',
  'modelsx.localList', 'workspace.setTimeZone', 'devices.join', 'seats.inviteVerify',
];
/** Served before any workspace is open, as their owners will mark them `preVault`. */
export const R4_PRE_VAULT: readonly string[] = ['workspace.pin.status', 'workspace.pin.unlock', 'devices.join'];
