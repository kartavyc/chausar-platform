/**
 * The four fixed phone messages (PH-01) and their mail form (PH-03), as sent.
 *
 * A message is a headline and a link, from a fixed catalogue keyed by kind. It carries no
 * amount, no count, no name and no date of money: a test fails on any digit in a body,
 * in either language. Nothing here takes a value, so nothing from the books can reach a
 * message.
 */

import type { Language } from '../../app/presentation.ts';
import type { PhoneMessageKind } from '../../bridge/todayx-contract.ts';
import { catalogueText } from '../../format/sentences.ts';

export const PHONE_MESSAGE_KINDS: ReadonlyArray<PhoneMessageKind> = ['week-ahead', 'review', 'document', 'due-date'];

/** The catalogue key of each message's headline. */
export const PHONE_MESSAGES: Readonly<Record<PhoneMessageKind, { readonly headlineKey: string }>> = {
  'week-ahead': { headlineKey: 'PH-01.msg.week-ahead' },
  review: { headlineKey: 'PH-01.msg.review' },
  document: { headlineKey: 'PH-01.msg.document' },
  'due-date': { headlineKey: 'PH-01.msg.due-date' },
};

/** The words of the link line, the same in every message. */
export const PHONE_LINK_KEY = 'PH-01.link';

/** A message body exactly as sent: the headline, then the link line. */
export function phoneMessageBody(kind: PhoneMessageKind, language: Language): { readonly headline: string; readonly link: string } {
  return { headline: catalogueText(language, PHONE_MESSAGES[kind].headlineKey), link: catalogueText(language, PHONE_LINK_KEY) };
}
