/**
 * Format checks for Indian business identity numbers (FR-02). Nothing is looked up online and
 * no value is ever echoed into an error. Only the saved card carries the values back.
 */
import { check } from '../contracts.ts';

export type IdentityField = 'pan' | 'gstin' | 'udyam' | 'cin' | 'fssai' | 'iec';
export const IDENTITY_FIELDS: readonly IdentityField[] = ['pan', 'gstin', 'udyam', 'cin', 'fssai', 'iec'];
export type IdentityProblem = 'length' | 'characters' | 'checksum' | 'state-code' | 'pan-mismatch';
export type FieldResult = { ok: true } | { ok: false; problem: IdentityProblem; expectedLength: number | null };
export type GstMode = 'regular' | 'composition' | 'not-registered';
export const GST_MODES: readonly GstMode[] = ['regular', 'composition', 'not-registered'];
export type IdentityCard = { fields: Partial<Record<IdentityField, string>>; gstMode: GstMode | null; savedAt: string };

const LENGTH: Record<IdentityField, number> = { pan: 10, gstin: 15, udyam: 19, cin: 21, fssai: 14, iec: 10 };
const SHAPE: Record<IdentityField, RegExp> = {
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  gstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  udyam: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/,
  cin: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
  fssai: /^[0-9]{14}$/,
  iec: /^[A-Z0-9]{10}$/,
};
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTIN check character: mod 36 over the first 14 characters with weights 1, 2, 1, 2, … */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36]!;
}

/** State and union territory codes 01–38, 97 (other territory) and 99 (centre jurisdiction). */
const gstStateCode = (code: number) => (code >= 1 && code <= 38) || code === 97 || code === 99;
export const normalizeIdentity = (value: string) => value.trim().toUpperCase();

export function checkIdentityField(field: IdentityField, raw: string, pan?: string): FieldResult {
  const value = normalizeIdentity(raw), expectedLength = LENGTH[field];
  if (value.length !== expectedLength) return { ok: false, problem: 'length', expectedLength };
  if (!SHAPE[field].test(value)) return { ok: false, problem: 'characters', expectedLength };
  if (field === 'gstin') {
    if (!gstStateCode(Number(value.slice(0, 2)))) return { ok: false, problem: 'state-code', expectedLength };
    if (pan !== undefined && SHAPE.pan.test(normalizeIdentity(pan)) && value.slice(2, 12) !== normalizeIdentity(pan)) return { ok: false, problem: 'pan-mismatch', expectedLength };
    if (gstinCheckCharacter(value.slice(0, 14)) !== value[14]) return { ok: false, problem: 'checksum', expectedLength };
  }
  return { ok: true };
}

/** Validates the shape of a `fields` payload without reading any value into an error. */
export function identityFields(input: unknown): Partial<Record<IdentityField, string>> {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'IDENTITY_INVALID', 'Give the identity numbers as named fields.');
  const entries = Object.entries(input as Record<string, unknown>);
  check(entries.every(([key, value]) => (IDENTITY_FIELDS as readonly string[]).includes(key) && typeof value === 'string' && value.length <= 64),
    'IDENTITY_INVALID', 'Use only the known identity fields, each as short text.');
  return Object.fromEntries(entries.filter(([, value]) => (value as string).trim() !== '')) as Partial<Record<IdentityField, string>>;
}

export function checkIdentity(fields: Partial<Record<IdentityField, string>>): Partial<Record<IdentityField, FieldResult>> {
  const result: Partial<Record<IdentityField, FieldResult>> = {};
  for (const field of IDENTITY_FIELDS) {
    const value = fields[field];
    if (value !== undefined) result[field] = checkIdentityField(field, value, fields.pan);
  }
  return result;
}

/** A card is saved only when every given field passes and the GST mode agrees with the GSTIN. */
export function identityCard(fieldsInput: unknown, gstModeInput: unknown, savedAt: string): IdentityCard {
  const fields = identityFields(fieldsInput);
  check(gstModeInput === null || gstModeInput === undefined || (GST_MODES as readonly unknown[]).includes(gstModeInput), 'IDENTITY_INVALID', 'Choose regular, composition or not registered for GST.');
  const gstMode = (gstModeInput ?? null) as GstMode | null;
  check(Object.values(checkIdentity(fields)).every(result => result!.ok), 'IDENTITY_INVALID', 'One of the identity numbers does not have the right format.');
  check(!(gstMode === 'not-registered' && fields.gstin !== undefined), 'IDENTITY_INVALID', 'A business that is not registered for GST has no GSTIN.');
  const normalized = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, normalizeIdentity(value!)])) as Partial<Record<IdentityField, string>>;
  return { fields: normalized, gstMode, savedAt };
}
