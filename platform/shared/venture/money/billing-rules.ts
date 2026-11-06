// Wave 6 money (6D1, 6D2): the owner's billing settings, checked by code. Portable (no engine records), so the fake
// engine checks a request with the same rules, codes and words. A UPI ID is a virtual payment address: a name of
// letters, digits, dots, hyphens or underscores, an @, and the bank's handle in letters (NPCI's VPA format).
import { check } from '../../portable.ts';
import type { BankDetails, BillingSettings } from '../../../contract/venture/money/billing-types.ts';

export const DEFAULT_DUE_IN_DAYS = 7;
export const DEFAULT_REMINDER_DAYS: readonly number[] = Object.freeze([3, 10, 30]);
const VPA = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const ACCOUNT = /^[A-Z0-9]{6,34}$/;
const LINE = /^[^\u0000-\u001F\u007F]+$/;

/** The settings as they read when the owner saved none: one final invoice due in 7 days, reminders 3, 10 and 30 days late. */
export function defaultBilling(): BillingSettings {
  return { dueInDays: DEFAULT_DUE_IN_DAYS, terms: null, reminderDays: [...DEFAULT_REMINDER_DAYS], upiId: null, payeeName: null, bank: null, razorpay: null };
}

/** Saved settings with every absent field at its default. */
export function billingWith(saved: Partial<BillingSettings> | undefined | null): BillingSettings {
  const base = defaultBilling();
  return saved ? { ...base, ...saved, reminderDays: [...(saved.reminderDays ?? base.reminderDays)] } : base;
}

/** A UPI ID as saved: trimmed; the handle after the @ in lower case. Refuses anything that is not a VPA. */
export function upiIdOf(value: unknown): string {
  check(typeof value === 'string' && VPA.test(value.trim()), 'INVALID_UPI_ID', 'Use a UPI ID like yourname@okbank.');
  const [name, handle] = value.trim().split('@');
  return `${name}@${handle!.toLowerCase()}`;
}

function line(value: unknown, field: string, max: number): string {
  check(typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max && LINE.test(value.trim()), 'INVALID_VENTURE_REQUEST', `${field} must be one line of 1 to ${max} characters.`);
  return value.trim().replace(/\s+/g, ' ');
}

/** Bank details as typed: the account name and number, an IFSC (India) and a SWIFT code (abroad), each checked. */
export function bankOf(value: unknown): BankDetails {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_BANK_DETAILS', 'Send the bank details as one object.');
  const body = value as Record<string, unknown>;
  check(Object.keys(body).every(key => ['accountName', 'accountNumber', 'ifsc', 'swift', 'bankName'].includes(key)), 'INVALID_BANK_DETAILS', 'Send the account name, number, IFSC or SWIFT code and bank name only.');
  const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.replace(/[\s-]/g, '').toUpperCase() : '';
  check(ACCOUNT.test(accountNumber), 'INVALID_BANK_DETAILS', 'The account number must be 6 to 34 letters or digits.');
  const ifsc = body.ifsc === undefined || body.ifsc === null || body.ifsc === '' ? null : String(body.ifsc).trim().toUpperCase();
  check(ifsc === null || IFSC.test(ifsc), 'INVALID_BANK_DETAILS', 'An IFSC is 11 characters, like HDFC0001234.');
  const swift = body.swift === undefined || body.swift === null || body.swift === '' ? null : String(body.swift).trim().toUpperCase();
  check(swift === null || SWIFT.test(swift), 'INVALID_BANK_DETAILS', 'A SWIFT code is 8 or 11 characters, like HDFCINBB.');
  check(ifsc !== null || swift !== null, 'INVALID_BANK_DETAILS', 'Add an IFSC for clients in India or a SWIFT code for clients abroad.');
  return {
    accountName: line(body.accountName, 'The account name', 120), accountNumber, ifsc, swift,
    bankName: body.bankName === undefined || body.bankName === null || body.bankName === '' ? null : line(body.bankName, 'The bank name', 120),
  };
}

/** A whole number of days as sent: a number, or digits as the owner typed them (the screens send text as typed). */
function wholeDays(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  return typeof value === 'string' && /^[0-9]{1,3}$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;
}

/** Reminder days late as the owner picks them: 1 to 6 different whole days from 1 to 365, kept in order. */
export function reminderDaysOf(value: unknown): number[] {
  const given = Array.isArray(value) ? value.map(wholeDays) : [];
  check(Array.isArray(value) && given.length >= 1 && given.length <= 6 && given.every(day => day !== null && day >= 1 && day <= 365), 'INVALID_VENTURE_REQUEST', 'Pick 1 to 6 reminder days, each from 1 to 365 days late.');
  const days = [...new Set(given as number[])].sort((a, b) => a - b);
  check(days.length === given.length, 'INVALID_VENTURE_REQUEST', 'Pick each reminder day once.');
  return days;
}

/** Days until an invoice is due: a whole number from 0 to 90. */
export function dueDaysOf(value: unknown): number {
  const days = wholeDays(value);
  check(days !== null && days >= 0 && days <= 90, 'INVALID_VENTURE_REQUEST', 'Days until due must be a whole number from 0 to 90.');
  return days;
}

const FIELDS = ['dueInDays', 'terms', 'reminderDays', 'upiId', 'payeeName', 'bank'] as const;

/**
 * A change to the settings: only the fields sent change; null clears terms, the UPI ID, the payee name or the bank details.
 * Razorpay keys are not settings: they go to protected storage by their own path.
 */
export function billingChange(current: BillingSettings, patch: Record<string, unknown>): BillingSettings {
  const next: BillingSettings = { ...current, reminderDays: [...current.reminderDays] };
  for (const key of Object.keys(patch)) check((FIELDS as readonly string[]).includes(key), 'INVALID_VENTURE_REQUEST', 'Send only billing settings.');
  if (patch.dueInDays !== undefined) next.dueInDays = dueDaysOf(patch.dueInDays);
  if (patch.terms !== undefined) next.terms = patch.terms === null ? null : line(patch.terms, 'Payment terms', 200);
  if (patch.reminderDays !== undefined) next.reminderDays = reminderDaysOf(patch.reminderDays);
  if (patch.upiId !== undefined) next.upiId = patch.upiId === null ? null : upiIdOf(patch.upiId);
  if (patch.payeeName !== undefined) next.payeeName = patch.payeeName === null ? null : line(patch.payeeName, 'The name clients see', 80);
  if (patch.bank !== undefined) next.bank = patch.bank === null ? null : bankOf(patch.bank);
  return next;
}
