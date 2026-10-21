// Chausar venture launcher: rights to footage, recorded at a playbook's intake (package P2-connectors).
// Clipping works only on footage the business has the right to use: the client's own footage, a licence from the rights
// holder, or a creator's clip programme. A licence or a programme needs its reference. Every clipping step calls
// requireRights and refuses with RIGHTS_REQUIRED without them, so Chausar never clips other people's content without
// rights. Playbooks (YouTube, social) import these types and the intake field from here.
import { check } from '../../contracts.ts';
import type { IsoDate, IsoTime } from '../contracts.ts';
import { validDate } from '../../memory.ts';

export const RIGHTS_BASES = Object.freeze(['own-footage', 'licence', 'creator-clip-programme'] as const);
export type RightsBasis = typeof RIGHTS_BASES[number];
export const RIGHTS_LABELS: Readonly<Record<RightsBasis, string>> = Object.freeze({
  'own-footage': "The client's own footage",
  licence: 'A licence from the rights holder',
  'creator-clip-programme': "The creator's clip programme",
});

export type FootageRights = {
  basis: RightsBasis;
  holder: string; // who owns the footage: the client, the licensor or the creator
  reference: string | null; // licence number or agreement link, or the programme's page; required unless own footage
  scope: string | null; // what it covers, in the owner's words
  expiresOn: IsoDate | null;
  recordedAt: IsoTime;
  recordedBy: string;
};

/** A playbook's intake. Other intake fields belong to each playbook; the rights field is shared. */
export type PlaybookIntake = { rights: FootageRights | null; [field: string]: unknown };

/** The intake form field, for any playbook with a clipping step. */
export const RIGHTS_INTAKE_FIELD = Object.freeze({
  id: 'rights' as const,
  label: 'Rights to the footage',
  help: 'Needed before any clip is cut. A licence or a clip programme needs its reference.',
  options: RIGHTS_BASES.map(id => Object.freeze({ id, label: RIGHTS_LABELS[id], needsReference: id !== 'own-footage' })),
});

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\r\n\t\u0000-\u001F\u007F]/.test(value.trim()) ? value.trim() : null;

function checked(value: unknown): Omit<FootageRights, 'recordedAt' | 'recordedBy'> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'RIGHTS_REQUIRED', 'Record the rights to the footage before clipping.');
  const input = value as Record<string, unknown>;
  check(typeof input.basis === 'string' && (RIGHTS_BASES as readonly string[]).includes(input.basis), 'RIGHTS_REQUIRED',
    'Choose own footage, a licence, or a creator clip programme.');
  const basis = input.basis as RightsBasis;
  const holder = text(input.holder, 160);
  check(holder, 'RIGHTS_REQUIRED', 'Say who owns the footage.');
  const reference = text(input.reference, 300);
  check(basis === 'own-footage' || reference, 'RIGHTS_REQUIRED', 'Add the licence or clip programme reference.');
  const scope = input.scope === undefined || input.scope === null ? null : text(input.scope, 300);
  const expiresOn = input.expiresOn === undefined || input.expiresOn === null ? null : input.expiresOn;
  check(expiresOn === null || validDate(expiresOn), 'RIGHTS_REQUIRED', 'Give the end date like 2026-12-31, or leave it empty.');
  return { basis, holder, reference, scope, expiresOn };
}

/** The owner records the rights at intake. */
export function recordRights(value: unknown, meta: { by: string; at: IsoTime }): FootageRights {
  return { ...checked(value), recordedAt: meta.at, recordedBy: meta.by };
}

export function isClippingStep(step: { id: string; clipping?: boolean }): boolean {
  return step.clipping === true;
}

/** Called before every clipping step. Returns the rights, or null for a step that clips nothing. */
export function requireRights(step: { id: string; clipping?: boolean }, intake: Partial<PlaybookIntake> | null, today: IsoDate): FootageRights | null {
  if (!isClippingStep(step)) return null;
  const rights = intake?.rights;
  check(rights, 'RIGHTS_REQUIRED', 'Record the rights to the footage at intake before clipping.');
  const valid = checked(rights);
  check(valid.expiresOn === null || valid.expiresOn >= today, 'RIGHTS_REQUIRED', `The rights to this footage ended on ${valid.expiresOn}.`);
  return rights;
}

/** One plain line for screens and receipts. */
export function rightsLine(rights: FootageRights): string {
  if (rights.basis === 'own-footage') return `The client's own footage, owned by ${rights.holder}.`;
  if (rights.basis === 'licence') return `A licence from ${rights.holder}, reference ${rights.reference}.`;
  return `The clip programme of ${rights.holder}, reference ${rights.reference}.`;
}
