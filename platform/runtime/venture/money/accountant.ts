// C5 task 16: remember the CA, so "Send to my CA" is one step. venture.accountant.get and .set keep the CA's email and
// WhatsApp number as a newest-wins record (names avoid venture.ca.*, which is the CA-firm playbook's). The sending
// itself is the desktop's: it opens a mail draft with the month's files attached, or WhatsApp with the words filled in
// (app/desktop/pack-share.cjs); Chausar never sends anything.
import { check, type Context, type State } from '../../contracts.ts';
import type { AccountantRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';

export type AccountantView = { email: string | null; whatsapp: string | null; at: string | null };

const EMAIL = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,190}\.[^\s@,;<>".]{2,}$/;
const WHATSAPP = /^\d{6,15}$/;

export function accountantOf(state: State, venture: Pick<VentureRecord, 'id'>): AccountantView {
  const record = listRecords(state, 'venture-accountant', venture.id).at(-1);
  return { email: record?.email ?? null, whatsapp: record?.whatsapp ?? null, at: record?.at ?? null };
}

/** venture.accountant.get {} (read). */
export async function accountantGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AccountantView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return accountantOf(state, venture);
}

/** venture.accountant.set { email?, whatsapp? } (prepare, app only): what is left out or null is forgotten. */
export async function accountantSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AccountantView> {
  requireAppChannel(ctx, 'venture.accountant.set');
  const body = exactPayload(payload, ['email', 'whatsapp']);
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
  check(body.email === undefined || body.email === null || typeof body.email === 'string', 'INVALID_VENTURE_REQUEST', 'Give an email address like name@example.com.');
  check(email === null || EMAIL.test(email), 'INVALID_VENTURE_REQUEST', 'Give an email address like name@example.com.');
  const typed = typeof body.whatsapp === 'string' ? body.whatsapp.replace(/[\s()+-]/g, '') : '';
  check(body.whatsapp === undefined || body.whatsapp === null || typeof body.whatsapp === 'string', 'INVALID_VENTURE_REQUEST', 'Give a WhatsApp number with its country code, like 919876543210.');
  check(typed === '' || WHATSAPP.test(typed), 'INVALID_VENTURE_REQUEST', 'Give a WhatsApp number with its country code, like 919876543210.');
  return ventureAction(deps, ctx, 'prepare', 'accountant.set', tx => {
    tx.put<AccountantRecord>({ ...tx.base('venture-accountant'), email, whatsapp: typed || null });
    return accountantOf(tx.state, tx.venture!);
  });
}
