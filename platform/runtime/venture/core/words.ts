// Chausar venture launcher, core (P1): small helpers for labelled lines, model words and owner amounts.
import { check } from '../../contracts.ts';
import { decimalMinor } from '../../currency.ts';
import { amountText, doneClaimFindings, houseStyleFindings, modelWords } from '../records.ts';
import type { Labelled, LineAuthor, LineLabel } from '../contracts.ts';

/** The highest price an owner may type, in minor units (inclusive). */
export const MAX_PRICE_MINOR = 1000000000000n;
export const DEFAULT_WORKING_NAME = 'My service business';

export function labelled<T>(value: T, label: LineLabel, by: LineAuthor): Labelled<T> {
  return { value, label, by };
}

export function toldByYou<T>(value: T): Labelled<T> {
  return { value, label: 'told-by-you', by: 'owner' };
}

/**
 * Words a model wrote: tidy, bounded, no numbers unless copied from the owner, none of the words Chausar keeps
 * out of anything it shows (house style), and no claim of finished work ('your books are reconciled'), the same
 * checks the template words pass. Refuses with MODEL_OUTPUT_REJECTED.
 */
export function styledWords(value: unknown, field: string, max: number, allowed: readonly string[], multiline = false): string {
  const words = modelWords(value, field, max, { allowed, multiline });
  check(houseStyleFindings(words).length === 0, 'MODEL_OUTPUT_REJECTED', `The ${field} used words Chausar keeps out of its plans.`);
  check(doneClaimFindings(words).length === 0, 'MODEL_OUTPUT_REJECTED', `The ${field} claimed work that has not been done.`);
  return words;
}

/** An optional boolean flag in a payload: absent is false. */
export function optionalFlag(body: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(body, key)) return false;
  check(typeof body[key] === 'boolean', 'INVALID_VENTURE_REQUEST', `${key} must be true or false.`);
  return body[key] as boolean;
}

/**
 * An owner-typed price: thousands commas and spaces dropped, exact decimal parsing in the currency's minor
 * unit, above zero and at most 1,000,000,000,000 minor units. Returns the cleaned text and the minor units.
 */
export function ownerPrice(value: unknown, currency: string, field = 'Your price'): { text: string; minor: string } {
  const text = amountText(value, field);
  const minor = decimalMinor(text, currency);
  const amount = BigInt(minor);
  check(amount > 0n, 'INVALID_AMOUNT', `${field} must be more than zero.`);
  check(amount <= MAX_PRICE_MINOR, 'INVALID_AMOUNT', `${field} is larger than Chausar accepts.`);
  return { text, minor };
}
