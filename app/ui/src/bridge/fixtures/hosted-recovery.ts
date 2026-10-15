/**
 * A fake-engine fixture for hosted-link's recovery through a contact (`bridge/hosted-recovery-contract.ts`).
 * It walks the statuses: `waiting` for a few checks, then the scripted outcome (`confirmed`, `released`,
 * `declined`, `expired` or `failed`); after `complete`, `VAULT_BUSY` for a few checks, `recovering`, then
 * `recovered` (or `confirmed` with a `failure`). Not served by default: a test registers it with
 * `registerFakeMethods('hosted', hostedRecoveryFixture(...).handlers)`. The fake serves these three before
 * the vault is open, as the engine marks them `preVault`. Synthetic only; the new passphrase is checked for
 * its length and never kept.
 */
import type { FakeHandler } from '../fake.ts';
import { PASSPHRASE_MIN, PASSPHRASE_MAX, type RecoveryChannel, type RecoveryStatus } from '../hosted-recovery-contract.ts';

/** Served before any workspace is open, as hosted-link marks them `preVault`. */
export const HOSTED_RECOVERY_PRE_VAULT: readonly string[] = ['hosted.recovery.request', 'hosted.recovery.check', 'hosted.recovery.complete'];
/** The time the fixture's request works until. */
export const FAKE_RECOVERY_EXPIRES = '2026-09-30T06:15:00.000Z';

export interface HostedRecoveryScript {
  /** What the contact does once the waiting checks are over. Default `confirmed`. */
  readonly outcome?: 'confirmed' | 'released' | 'declined' | 'expired' | 'failed';
  /** Checks that read `waiting` first. Default 2. */
  readonly waitingChecks?: number;
  /** Checks refused `VAULT_BUSY` right after `complete`. Default 1. */
  readonly busyChecks?: number;
  /** Checks that read `recovering` after those. Default 1. */
  readonly recoveringChecks?: number;
  /** A failure code the recovery ends with instead of `recovered` (it then reads `confirmed`). */
  readonly failure?: string;
  readonly channel?: RecoveryChannel;
  /** A refusal for `hosted.recovery.request`, such as `DEMO_EXTERNAL_DISABLED`. */
  readonly refuseRequest?: string;
}

export interface HostedRecoveryFixture {
  readonly handlers: Readonly<Record<string, FakeHandler>>;
  /** How many times `complete` was called (never what it carried). */
  completions(): number;
}

export function hostedRecoveryFixture(script: HostedRecoveryScript = {}): HostedRecoveryFixture {
  const outcome = script.outcome ?? 'confirmed';
  let made = 0, completions = 0;
  const requests = new Map<string, { checks: number; status: RecoveryStatus; busy: number; recovering: number; failure?: string }>();
  const found = (payload: Readonly<Record<string, unknown>>, refuse: (code: string, message?: string) => Error) => {
    const entry = typeof payload['requestId'] === 'string' ? requests.get(payload['requestId']) : undefined;
    if (entry === undefined) throw refuse('RECOVERY_REQUEST_NOT_FOUND', 'There is no such recovery request.');
    return entry;
  };
  const handlers: Record<string, FakeHandler> = {
    'recovery.request': (_payload, context) => {
      if (script.refuseRequest !== undefined) throw context.refuse(script.refuseRequest, 'The fixture refused the request.');
      made += 1;
      const requestId = `rcr_00000000-0000-4000-8000-${String(made).padStart(12, '0')}`;
      requests.set(requestId, { checks: 0, status: 'waiting', busy: script.busyChecks ?? 1, recovering: script.recoveringChecks ?? 1 });
      return { requestId, status: 'waiting', expiresAt: FAKE_RECOVERY_EXPIRES, contactChannel: script.channel ?? 'mail' };
    },
    'recovery.check': (payload, context) => {
      const entry = found(payload, context.refuse), requestId = payload['requestId'] as string;
      if (entry.status === 'waiting') {
        entry.checks += 1;
        if (entry.checks > (script.waitingChecks ?? 2)) entry.status = outcome;
      } else if (entry.status === 'recovering') {
        if (entry.busy > 0) { entry.busy -= 1; throw context.refuse('VAULT_BUSY', 'The vault is changing.'); }
        if (entry.recovering > 0) entry.recovering -= 1;
        else if (script.failure !== undefined) { entry.status = 'confirmed'; entry.failure = script.failure; }
        else entry.status = 'recovered';
      }
      const local = entry.status === 'recovering' || entry.status === 'recovered';
      return { requestId, status: entry.status, ...(local ? {} : { expiresAt: FAKE_RECOVERY_EXPIRES }), ...(entry.failure !== undefined ? { failure: entry.failure } : {}) };
    },
    'recovery.complete': (payload, context) => {
      const entry = found(payload, context.refuse), passphrase = payload['newPassphrase'];
      if (typeof passphrase !== 'string' || passphrase.length < PASSPHRASE_MIN || passphrase.length > PASSPHRASE_MAX) throw context.refuse('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
      if (entry.status === 'recovered') return { requestId: payload['requestId'], status: 'recovered' };
      if (entry.status === 'recovering') throw context.refuse('RECOVERY_IN_PROGRESS', 'The recovery is already under way.');
      if (entry.status !== 'confirmed' && entry.status !== 'released') throw context.refuse('RECOVERY_NOT_CONFIRMED', 'Your recovery contact has not confirmed yet.');
      completions += 1;
      entry.status = 'recovering'; delete entry.failure;
      entry.busy = script.busyChecks ?? 1; entry.recovering = script.recoveringChecks ?? 1;
      return { requestId: payload['requestId'], status: 'recovering' };
    },
  };
  return { handlers, completions: () => completions };
}
