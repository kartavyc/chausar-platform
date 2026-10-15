/**
 * Recover through my contact (FR-13, SH-02), the lock screen's calls. The screen calls hosted-link's
 * `hosted.recovery.*` directly (`bridge/hosted-recovery-contract.ts`); when `hosted.recovery.request`
 * is not built, it asks frame-today's own `todayx.recoveryContact.request` as before and shows that
 * answer in the same words. Every reply is validated before it is used. The new passphrase is only
 * ever an argument here: never kept, never logged.
 */

import {
  HOSTED_RECOVERY, HOSTED_RECOVERY_REFUSALS, isRecoveryCheckReply, isRecoveryCompleteReply, isRecoveryRequestReply,
  type RecoveryCheckReply, type RecoveryCompleteReply, type RecoveryRequestReply,
} from '../../bridge/hosted-recovery-contract.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { askRecoveryContact, type ComputerPort } from './this-computer.ts';

export type Started =
  | { readonly kind: 'waiting'; readonly reply: RecoveryRequestReply }
  /** hosted-link is not here: frame-today's own answer, in today's words. */
  | { readonly kind: 'fallback'; readonly failure: JourneyFailure }
  | JourneyFailure;

export async function startRecovery(rpc: ComputerPort, folder: string): Promise<Started> {
  try {
    const reply = await rpc.request(HOSTED_RECOVERY.request, { folder });
    return isRecoveryRequestReply(reply) ? { kind: 'waiting', reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.kind !== 'not-built') return failure;
    return { kind: 'fallback', failure: await askRecoveryContact(rpc, folder) };
  }
}

export type Checked = { readonly kind: 'status'; readonly reply: RecoveryCheckReply } | { readonly kind: 'busy' } | JourneyFailure;

/** One check. `VAULT_BUSY` means the vault transition is running: still recovering. */
export async function checkRecovery(rpc: ComputerPort, requestId: string, folder: string): Promise<Checked> {
  try {
    const reply = await rpc.request(HOSTED_RECOVERY.check, { requestId, folder });
    return isRecoveryCheckReply(reply, requestId) ? { kind: 'status', reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) {
    const failure = failureOf(error);
    return failure.kind === 'refused' && failure.code === 'VAULT_BUSY' ? { kind: 'busy' } : failure;
  }
}

export type Completed = { readonly kind: 'started'; readonly reply: RecoveryCompleteReply } | JourneyFailure;

/** Hands the new passphrase to the engine once. */
export async function completeRecovery(rpc: ComputerPort, requestId: string, folder: string, newPassphrase: string): Promise<Completed> {
  try {
    const reply = await rpc.request(HOSTED_RECOVERY.complete, { requestId, newPassphrase, folder });
    return isRecoveryCompleteReply(reply, requestId) ? { kind: 'started', reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) {
    const failure = failureOf(error);
    return failure.kind === 'refused' && failure.code === 'VAULT_BUSY' ? { kind: 'started', reply: { requestId, status: 'recovering' } } : failure;
  }
}

const NAMED: ReadonlySet<string> = new Set(HOSTED_RECOVERY_REFUSALS);
/** The words for a hosted refusal: its own line when the screen names it, else the line with the code. */
export const recoveryRefusalKey = (code: string): string => NAMED.has(code) ? `FR-13.contact.code.${code}` : 'FR-13.contact.refused';
/** The words for a failure a finished recovery reported. */
export const recoveryFailureKey = (code: string): string => code === 'RECOVERY_CODE_REJECTED' ? 'FR-13.contact.code.RECOVERY_CODE_REJECTED' : 'FR-13.contact.failure';
