/**
 * Display helpers for the Work and Books screens. Display only: no business arithmetic.
 * Amounts arrive as exact paise strings or as a missing state, and are shown as such.
 */
import type { Language } from '../../../app/presentation.ts';
import { money } from '../../../format/money.ts';
import { date } from '../../../format/dates.ts';
import type { Amount } from './validate.ts';
import { missingWord } from './words.ts';

export function amountText(value: Amount, language: Language): string {
  return 'minor' in value ? money(value.minor) : missingWord(value.missing, language);
}
export function paise(minor: string): string { return money(minor); }
/** A date or an instant, day first. An instant shows its calendar day in UTC. */
export function day(iso: string, language: Language): string { return date(iso.slice(0, 10), 'short', language); }
export function dayTime(iso: string, language: Language): string {
  const clock = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  return clock ? `${day(iso, language)} ${clock}` : day(iso, language);
}
