// Chausar playbook kit: the paid pilot (Ink v2 wave 5, package 5A2; catalogue P2). Every kit playbook offers at least
// one offer as a pilot (5A1's definePlaybook refuses one that offers none). A pilot is one page: one hypothesis, a window
// of 2 to 6 weeks, a success measure agreed first (what, the number as the owner types it, and a date inside the window
// by date arithmetic), the hours needed from the owner and from the client, the owner's own price (a pilot is never
// free), permission to reference (asked, and recorded yes or no), then the after-pilot asks: a case study and a
// referral. A fact not agreed yet is a bracketed placeholder, never a guess; the sales proposal (kit/proposal.ts) repeats
// each one under Open questions. Learned from paulklayvc's references/pilot-offer.md (MIT), ideas only, no code taken.
import { check } from '../../../contracts.ts';
import type { BpsString, IsoDate, MinorString } from '../../contracts.ts';
import { addDaysUtc } from '../../money/dates.ts';
import type { PlaybookDefinition } from './define.ts';

/** The shortest and longest pilot, in weeks. */
export const PILOT_MIN_WEEKS = 2;
export const PILOT_MAX_WEEKS = 6;
/** What the owner asks for after a pilot that met its measure. */
export const PILOT_AFTER_ASKS: readonly string[] = Object.freeze(['A short case study, if the pilot meets its measure.', 'An introduction to one business like yours.']);
/** The placeholder words for each fact not agreed yet, in the page's order. */
export const PILOT_PLACEHOLDERS = Object.freeze({
  weeks: '[2 to 6 weeks]', start: '[the day it starts]', hypothesis: '[the one thing we expect to change]', what: '[what we measure]', target: '[the number you agree on]',
  by: '[the date, inside the pilot]', clientHours: '[hours a week from you]', ownerHours: '[hours a week from us]',
  reference: '[may we mention you as a client: yes or no]',
});
export const PILOT_UNPRICED_LINE = 'A pilot is never free. Set a price for it.';

/**
 * What the owner and the client agreed for one pilot, or null for a fact not agreed yet. startsOn: the day it starts.
 * target: the success number exactly as the owner typed it ("under 2 hours"); code never reads a number out of it.
 * ownerHours: whole hours a week from the business (the owner and their team, "us" on the page); clientHours: from the
 * client ("you" on the page, which is written for the client). priceMinor: the owner's price for the pilot, from their
 * own price list; shareBps: or the share the owner set on the offer, kept apart from any amount. reference: may the
 * business mention them.
 */
export type PilotTerms = {
  startsOn: IsoDate | null;
  weeks: number | null;
  hypothesis: string | null;
  measure: { what: string | null; target: string | null; by: IsoDate | null };
  ownerHours: number | null;
  clientHours: number | null;
  priceMinor: MinorString | null;
  shareBps?: BpsString | null;
  reference: boolean | null;
};

/** One pilot page, in plain words, with a placeholder wherever a fact is not agreed yet. */
export type PilotPage = {
  offerId: string;
  offerName: string;
  window: { weeks: number | null; from: IsoDate | null; to: IsoDate | null };
  hypothesis: string | null;
  measure: { what: string | null; target: string | null; by: IsoDate | null };
  hours: { owner: number | null; client: number | null };
  /** The owner's amount, or null when the pilot is priced as a share (shareBps). */
  priceMinor: MinorString | null;
  shareBps: BpsString | null;
  reference: 'yes' | 'no' | 'ask';
  after: readonly string[];
  /** The page's lines, in order; the price is not among them (the proposal shows it from its receipt). */
  lines: string[];
  placeholders: string[];
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function realDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const day = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

function line(value: string | null, field: string): string | null {
  if (value === null) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  check(text.length >= 2 && text.length <= 200, 'INVALID_VENTURE_REQUEST', `${field} must be one line of 2 to 200 characters.`);
  return text.replace(/[.\s]+$/, '');
}

function hours(value: number | null, field: string): number | null {
  check(value === null || (Number.isInteger(value) && value >= 0 && value <= 60), 'INVALID_VENTURE_REQUEST', `${field} must be whole hours a week, from 0 to 60.`);
  return value;
}

const hoursWords = (value: number) => `${value} ${value === 1 ? 'hour' : 'hours'} a week`;

/**
 * The one-page pilot for an offer of a kit playbook, from what was agreed. Refuses OFFER_NOT_FOUND for an offer the
 * playbook does not have, PILOT_NOT_OFFERED for one it does not offer as a pilot, PILOT_UNPRICED with no price, a
 * price of zero or a share of none, and PILOT_WINDOW for a window outside 2 to 6 weeks or a success date outside it (after the first day,
 * by the last; with the weeks not agreed yet, within the longest pilot).
 */
export function pilotOf(definition: Pick<PlaybookDefinition, 'offers'>, offerId: string, terms: PilotTerms): PilotPage {
  const offer = definition.offers.find(item => item.id === offerId);
  check(offer, 'OFFER_NOT_FOUND', 'That offer is not in this playbook.');
  check(offer.pilotable, 'PILOT_NOT_OFFERED', `${offer.name} is not offered as a pilot. Choose an offer that is.`);
  const amount = terms.priceMinor !== null && /^\d{1,20}$/.test(terms.priceMinor) && BigInt(terms.priceMinor) > 0n;
  const share = !!terms.shareBps && /^\d{1,5}$/.test(terms.shareBps) && BigInt(terms.shareBps) > 0n;
  check(amount || share, 'PILOT_UNPRICED', PILOT_UNPRICED_LINE);
  const start = terms.startsOn;
  check(start === null || (typeof start === 'string' && realDay(start)), 'INVALID_VENTURE_REQUEST', 'The day the pilot starts must be a date like 2026-11-02.');
  const weeks = terms.weeks;
  check(weeks === null || (Number.isInteger(weeks) && weeks >= PILOT_MIN_WEEKS && weeks <= PILOT_MAX_WEEKS), 'PILOT_WINDOW', 'A pilot runs 2 to 6 weeks.');
  const to = weeks === null || start === null ? null : addDaysUtc(start, weeks * 7);
  const by = terms.measure.by;
  if (by !== null) {
    check(typeof by === 'string' && realDay(by), 'INVALID_VENTURE_REQUEST', 'The success date must be a date like 2026-11-27.');
    check(start !== null, 'PILOT_WINDOW', 'Agree the day the pilot starts before its success date.');
    const last = to ?? addDaysUtc(start, PILOT_MAX_WEEKS * 7);
    check(by > start && by <= last, 'PILOT_WINDOW', `The success date must fall inside the pilot, after ${start} and by ${last}.`);
  }
  const hypothesis = line(terms.hypothesis, 'The hypothesis');
  const what = line(terms.measure.what, 'What you measure');
  const target = line(terms.measure.target, 'The success number');
  const owner = hours(terms.ownerHours, 'Your hours'), client = hours(terms.clientHours, "Your client's hours");
  check(terms.reference === null || typeof terms.reference === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say yes or no to mentioning them as a client.');

  const placeholders: string[] = [];
  const or = (value: string | null, placeholder: string) => {
    if (value !== null) return value;
    placeholders.push(placeholder);
    return placeholder;
  };
  const P = PILOT_PLACEHOLDERS;
  const span = weeks === null ? or(null, P.weeks) : `${weeks} weeks`;
  const from = or(start, P.start);
  const window = to === null ? `for ${span}, from ${from}.` : `for ${span}, from ${from} to ${to}.`;
  const lines = [
    `A paid pilot of ${offer.name} ${window}`,
    `What we test: ${or(hypothesis, P.hypothesis)}.`,
    `Success: ${or(what, P.what)}, ${or(target, P.target)}, by ${or(by, P.by)}.`,
    `Time needed: ${or(client === null ? null : hoursWords(client), P.clientHours)} from you, ${or(owner === null ? null : hoursWords(owner), P.ownerHours)} from us.`,
    terms.reference === null ? `May we mention you as a client? ${or(null, P.reference)}` : terms.reference ? 'You agreed we may mention you as a client.' : 'You asked us not to mention you as a client.',
  ];
  return {
    offerId: offer.id, offerName: offer.name, window: { weeks, from: start, to }, hypothesis, measure: { what, target, by },
    hours: { owner, client }, priceMinor: amount ? terms.priceMinor : null, shareBps: amount ? null : terms.shareBps ?? null, reference: terms.reference === null ? 'ask' : terms.reference ? 'yes' : 'no',
    after: PILOT_AFTER_ASKS, lines, placeholders,
  };
}
