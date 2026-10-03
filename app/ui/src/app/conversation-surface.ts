/** Pure shell gate for the optional Engine-backed Ask surface. */
import type { Address } from './presentation.ts';
import { resolveAddress, subAllowed, type ShellConfig } from './places.ts';
import { sameAddress, withSheet, withoutSheet } from './routes.ts';
import { submittedQuestion } from './ask-question.ts';
import { validateConversationRequest } from '../bridge/conversation-contract.ts';
import type { ConversationDraft } from '../bridge/conversation-host.ts';

export type ConversationQuestionSettings = Omit<ConversationDraft, 'question'>;
export const MODEL_CONSENT_SHEET = 'model-consent';

/** One addressed disclosure sheet. Preview identity is checked by the controller. */
export function modelConsentAddress(address: Address): Address {
  return withSheet(address, MODEL_CONSENT_SHEET);
}

export function answerAddress(address: Address): Address { return withoutSheet(address); }

export function boundConversationAddress(expected: Address | null, current: Address | null): boolean {
  return expected !== null && current !== null && sameAddress(expected, current);
}

/** New questions require the New grant; repairing a denied route is not consent. */
export function newQuestionAddress(shell: ShellConfig, locked: boolean): Address | null {
  if (locked || !subAllowed(shell, 'ask', 'new')) return null;
  const requested: Address = { place: 'ask', sub: 'new' };
  const resolved = resolveAddress(shell, requested);
  return resolved !== null && sameAddress(requested, resolved) ? resolved : null;
}

/** Other Ask journeys remain with the existing host renderer. */
export function conversationSurfaceAddress(shell: ShellConfig, address: Address | null, locked: boolean): Address | null {
  if (locked || address === null || address.place !== 'ask' ||
      (address.sub !== undefined && address.sub !== 'new' && address.sub !== 'saved')) return null;
  const resolved = resolveAddress(shell, address);
  return resolved !== null && sameAddress(address, resolved) ? resolved : null;
}

/** The reviewed question is the exact submitted string, including whitespace. */
export function questionRequest(settings: ConversationQuestionSettings, text: string): ConversationDraft | null {
  const question = submittedQuestion(text);
  if (question === null) return null;
  const request = validateConversationRequest({ ...settings, question });
  // A continuation is selected from Engine readback, never supplied by the caller.
  if (request.continuationId !== undefined) throw new TypeError('CONTINUATION_HOST_OWNED');
  return request;
}
