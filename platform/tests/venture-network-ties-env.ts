// Shared fixtures for the strength and warm-path tests (venture-network-strength and -paths, package 4D2): the owner's
// mail and calendar exports built at runtime from a few lines each, the clock moved to 23 Oct 2026, a client with an
// invoice seeded as records, and direct calls into the network and money packages as the host would make them.
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  ClientRecord, InvoiceRecord, NetworkImportResult, PersonRecord, PersonView, TieRecord, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { net, OWNER_MAIL, projected } from './venture-network-env.ts';
import { owner, type Env } from './venture-views-env.ts';

export const OWNER = 'Owner <owner@ledger.example>';
/** 23 Oct 2026, 10:00 UTC (15:30 in Kolkata): the day these tests fix the clock at. */
export const OCT_23 = '2026-10-23T10:00:00.000Z';
export function toOct23(env: Env): void {
  env.advance(Date.parse(OCT_23) - Date.parse(env.now()));
}

type Imported = Extract<NetworkImportResult, { mode: 'import' }>;
export const imported = (env: Env, kind: string, name: string, text: string, ctx: Context = owner) =>
  net<Imported>(env, 'venture.network.import', { kind, name, text }, ctx);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One mail as its headers: the day (sent at 06:00 UTC), who wrote it, who got it. */
export type Mail = { day: string; from: string; to: string[]; cc?: string[] };

/** An mbox file of the mails, header block by header block, each with a one-line body. */
export function mbox(mails: Mail[]): string {
  return mails.map((mail, i) => {
    const [year, month, day] = mail.day.split('-');
    return [
      `From m${i}@export Mon Jan 1 00:00:00 +0000 2026`, `Date: ${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year} 06:00:00 +0000`,
      `From: ${mail.from}`, `To: ${mail.to.join(', ')}`, ...(mail.cc?.length ? [`Cc: ${mail.cc.join(', ')}`] : []), 'Subject: Hello', '', 'A body line.', '',
    ].join('\n');
  }).join('\n');
}

/** What the desktop sends for those mails: the projection, read in Kolkata's time, for the owner's own address. */
export const mailFile = (mails: Mail[]) => projected('mail-headers', mbox(mails), OWNER_MAIL);

/** Mail both ways with one person in each month: the owner writes on the 10th, they answer on the 12th. */
export function bothWays(who: string, months: string[]): Mail[] {
  return months.flatMap(month => [
    { day: `${month}-10`, from: OWNER, to: [who] },
    { day: `${month}-12`, from: who, to: [OWNER] },
  ]);
}

export type Meeting = { day: string; title: string; people: string[] };

/** A calendar file whose X-WR-CALNAME names the owner; every meeting has the owner and the people listed. */
export function ics(meetings: Meeting[]): string {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:owner@ledger.example',
    ...meetings.flatMap(meeting => [
      'BEGIN:VEVENT', `DTSTART:${meeting.day.replace(/-/g, '')}T060000Z`, `SUMMARY:${meeting.title}`, 'ATTENDEE:mailto:owner@ledger.example',
      ...meeting.people.map(email => `ATTENDEE:mailto:${email}`), 'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

/** A client with one issued invoice of that day, and a person in the network linked to the client, with nothing else. */
export async function seedPayingClient(env: Env, name: string, email: string, issueDate: string): Promise<{ person: PersonRecord; client: ClientRecord }> {
  return ventureAction(env.deps, owner, 'admin', 'seed.client', tx => {
    const client = tx.put<ClientRecord>({ ...tx.base('venture-client'), name, email, countryCode: 'IN', taxId: null, stateCode: '27', note: null } as ClientRecord);
    tx.put({ ...tx.base('venture-invoice'), clientId: client.id, orderId: 'order_seed', status: 'issued', issueDate, number: 'INV-0001' } as unknown as InvoiceRecord);
    tx.put({ ...tx.base('venture-invoice'), clientId: client.id, orderId: 'order_seed', status: 'draft', issueDate: null, number: null } as unknown as InvoiceRecord);
    const source = { connector: 'owner' as const, importId: null, row: null };
    const base = tx.base('venture-person');
    const person = tx.put<PersonRecord>({
      ...base, name, handles: { emails: [email], phones: [], linkedinUrl: null }, role: null, roles: [], hidden: false, clientId: client.id,
      facts: [
        { id: `${base.id}.1`, kind: 'name', value: name, date: null, detail: null, source },
        { id: `${base.id}.2`, kind: 'email', value: email, date: null, detail: null, source },
      ],
      history: [],
    });
    return { person, client };
  });
}

export const ties = (env: Env): TieRecord[] => listRecords(env.store.read(), 'venture-tie');
export function tieOf(env: Env, personId: string): TieRecord {
  const found = ties(env).filter(tie => tie.personId === personId);
  assert.equal(found.length, 1, `exactly one tie for ${personId}`);
  return found[0];
}

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
/** venture.receipt.get, as the money package serves it. */
export function receipt<T>(env: Env, id: string, ctx: Context = owner): Promise<T> {
  return ((money as Record<string, Handler>)['venture.receipt.get'])(env.deps, ctx, { id }) as Promise<T>;
}

export const person = (env: Env, id: string, ctx: Context = owner) => net<PersonView>(env, 'venture.network.person', { id }, ctx);
