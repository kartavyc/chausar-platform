// AI-native CA firm: the CA of record, the CA's confirmation of each rate-table version, and recorded sign-offs on
// regulated papers. Everything is an append-only 'venture-ca-firm' record. Today's queue reads caFirmQueueItems:
// regulated papers and unconfirmed rate tables first make a 'signoff' row with Send to CA; once sent, a second row
// asks the CA to sign by typing their ICAI membership number, which must match the CA it was sent to. Nothing here
// files, signs on a portal or sends anything outside Chausar: "send to CA" marks the papers for the CA of record,
// who signs inside Chausar. A request covers one digest of a run's papers: the owner's edit is new papers with a
// request of its own. Naming a CA of record puts ready papers that have none in front of them (delivery-signoff.ts).
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import { digest, exactPayload, listRecords, singleLine, ventureAction } from '../../records.ts';
import type { CaFirmRecord, QueueAction, QueueActionId, VentureDeps, VentureRecord } from '../../contracts.ts';
import { caLabel, validateCaOfRecord, type CaOfRecord } from './playbook.ts';
import { RATE_TABLES, rateTableHash, type RateConfirmation, type RateTable, type RateUse } from './rates.ts';

type EntryName = CaFirmRecord['entry'];
type Entry<E extends EntryName> = Extract<CaFirmRecord, { entry: E }>;
export type SignoffRequest = Entry<'signoff-request'>;
export type SignoffRecord = Entry<'signoff'>;
export const SIGNOFF_SUBJECTS = ['gst-working', 'tds-working', 'itr-data-pack', 'letter', 'audit-papers'] as const;
export type SignoffSubject = typeof SIGNOFF_SUBJECTS[number];

function entries<E extends EntryName>(state: State, ventureId: string, entry: E): Entry<E>[] {
  return listRecords(state, 'venture-ca-firm', ventureId).filter(record => record.entry === entry) as Entry<E>[];
}

/** The CA of record: the newest one named, or null. */
export function caOfRecord(state: State, ventureId: string): CaOfRecord | null {
  const latest = entries(state, ventureId, 'ca-of-record').at(-1);
  return latest ? { name: latest.name, membershipNumber: latest.membershipNumber, firmName: latest.firmName, firmRegistrationNumber: latest.firmRegistrationNumber } : null;
}

export function rateConfirmations(state: State, ventureId: string): RateConfirmation[] {
  return entries(state, ventureId, 'rate-confirmation').map(item => ({
    tableId: item.tableId, version: item.tableVersion, hash: item.tableHash, caName: item.caName, membershipNumber: item.membershipNumber, at: item.at,
  }));
}

/** What the engines take: 'client' work needs the CA's confirmations; 'rehearsal' runs without them and says so. */
export function rateUseFor(state: State, ventureId: string, mode: RateUse['mode']): RateUse {
  return { mode, confirmations: rateConfirmations(state, ventureId) };
}

/** The key an item is sent to the CA under. A rate table's key carries its content hash, so a changed table is sent again. */
export function rateKey(table: RateTable): string {
  return `rate:${table.id}@${table.version}#${rateTableHash(table).slice(0, 12)}`;
}

export function unconfirmedRateTables(state: State, ventureId: string, tables: readonly RateTable[] = RATE_TABLES): RateTable[] {
  const confirmations = rateConfirmations(state, ventureId);
  return tables.filter(table => !confirmations.some(item => item.tableId === table.id && item.version === table.version && item.hash === rateTableHash(table)));
}

/** The newest time an item (a sign-off request id or a rate key) was sent to the CA, or null. */
export function sentTo(state: State, ventureId: string, itemKey: string): Entry<'sent-to-ca'> | null {
  return entries(state, ventureId, 'sent-to-ca').filter(item => item.itemKey === itemKey).at(-1) ?? null;
}

/** Every regulated paper put in front of the CA, oldest first. */
export function signoffRequests(state: State, ventureId: string): SignoffRequest[] {
  return entries(state, ventureId, 'signoff-request');
}

export function signoffFor(state: State, ventureId: string, requestId: string): SignoffRecord | null {
  return entries(state, ventureId, 'signoff').filter(item => item.requestId === requestId).at(-1) ?? null;
}

function requireCa(state: State, ventureId: string): CaOfRecord {
  const ca = caOfRecord(state, ventureId);
  if (!ca) throw new ChausarError('CA_OF_RECORD_REQUIRED', 'Name your CA of record, with their ICAI membership number, first.');
  return ca;
}

function membership(value: unknown, sent: { name: string; membershipNumber: string }): void {
  const typed = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (typed !== sent.membershipNumber) throw new ChausarError('CA_MEMBERSHIP_MISMATCH', `That is not the ICAI membership number of ${sent.name}, who this was sent to.`);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Names the CA of record (approve). A newer one replaces the older; what was signed stays signed by whoever signed it. */
export async function setCaOfRecord(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CaOfRecord> {
  const ca = validateCaOfRecord(payload);
  exactPayload(payload, ['name', 'membershipNumber', 'firmName', 'firmRegistrationNumber'], ['name', 'membershipNumber']);
  const named = await ventureAction(deps, ctx, 'approve', 'ca-firm.ca-of-record', tx => {
    tx.put<CaFirmRecord>({ ...tx.base('venture-ca-firm'), entry: 'ca-of-record', ...ca });
    tx.emit('queue.changed', { caFirm: 'ca-of-record' });
    return ca;
  });
  // Ready papers that waited with no CA to ask now go in front of this one. It never undoes naming the CA.
  await import('./delivery-signoff.ts').then(module => module.sweepSignoffRequests(deps, ctx)).catch(() => null);
  return named;
}

/**
 * Puts regulated papers in front of the CA (prepare): a GST or TDS working ready to file, an income tax data pack, a
 * letter on the firm's letterhead, or papers for a tax audit. Refused until a CA of record is named. deliveryId names
 * the delivery run whose draft the papers are; a second request for the same run and the same papers' digest returns
 * the first one, so a run asks its CA once for each version of its papers.
 */
export async function requestCaSignoff(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SignoffRequest> {
  const body = exactPayload(payload, ['subjectKind', 'title', 'clientName', 'workingDigest', 'receiptIds', 'playbookHash', 'deliveryId'], ['subjectKind', 'title', 'workingDigest', 'receiptIds']);
  check(body.deliveryId === undefined || body.deliveryId === null || (typeof body.deliveryId === 'string' && /^[A-Za-z0-9_.:-]{3,80}$/.test(body.deliveryId)), 'INVALID_VENTURE_REQUEST', 'The delivery run id is not one Chausar made.');
  const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : null;
  check((SIGNOFF_SUBJECTS as readonly unknown[]).includes(body.subjectKind), 'INVALID_VENTURE_REQUEST', 'Say what the papers are: a GST working, a TDS working, an income tax data pack, a letter or papers for a tax audit.');
  const title = singleLine(body.title, 'Title', { min: 3, max: 140 });
  const clientName = body.clientName === undefined || body.clientName === null ? null : singleLine(body.clientName, 'Client name', { min: 1, max: 120 });
  check(typeof body.workingDigest === 'string' && /^[a-f0-9]{64}$/.test(body.workingDigest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the papers.');
  check(Array.isArray(body.receiptIds) && body.receiptIds.length >= 1 && body.receiptIds.length <= 50
    && body.receiptIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{3,80}$/.test(id)), 'INVALID_VENTURE_REQUEST', 'Send the receipts the papers rest on.');
  check(body.playbookHash === undefined || body.playbookHash === null || (typeof body.playbookHash === 'string' && /^[a-f0-9]{64}$/.test(body.playbookHash)), 'INVALID_VENTURE_REQUEST', 'The playbook hash is a digest.');
  return ventureAction(deps, ctx, 'prepare', 'ca-firm.signoff-request', tx => {
    requireCa(tx.state, tx.venture!.id);
    const asked = deliveryId
      ? entries(tx.state, tx.venture!.id, 'signoff-request').find(item => item.deliveryId === deliveryId && item.workingDigest === body.workingDigest)
      : undefined;
    if (asked) return asked;
    const record = tx.put<CaFirmRecord>({
      ...tx.base('venture-ca-firm'), entry: 'signoff-request', subjectKind: body.subjectKind as SignoffSubject, title, clientName,
      workingDigest: body.workingDigest as string, receiptIds: [...body.receiptIds as string[]], playbookHash: (body.playbookHash as string | undefined) ?? null,
      ...(deliveryId ? { deliveryId } : {}),
    }) as SignoffRequest;
    tx.emit('queue.changed', { caFirm: 'signoff-request', requestId: record.id });
    return record;
  });
}

/** Marks items for the CA of record to sign (approve). Each key is a sign-off request id or a rate table's key. */
export async function sendToCa(deps: VentureDeps, ctx: Context, itemKeys: readonly string[]): Promise<{ ca: CaOfRecord; sent: string[] }> {
  check(Array.isArray(itemKeys) && itemKeys.length >= 1, 'INVALID_VENTURE_REQUEST', 'Choose what to send to the CA.');
  return ventureAction(deps, ctx, 'approve', 'ca-firm.send-to-ca', tx => {
    const ventureId = tx.venture!.id;
    const ca = requireCa(tx.state, ventureId);
    const requests = new Set(entries(tx.state, ventureId, 'signoff-request').map(item => item.id));
    const rates = new Set(RATE_TABLES.map(rateKey));
    for (const key of itemKeys) {
      if (!requests.has(key) && !rates.has(key)) throw new ChausarError('SIGNOFF_NOT_FOUND', 'There is nothing waiting for the CA under that name.');
      tx.put<CaFirmRecord>({ ...tx.base('venture-ca-firm'), entry: 'sent-to-ca', itemKey: key, caName: ca.name, membershipNumber: ca.membershipNumber, sentBy: ctx.memberId });
    }
    tx.emit('queue.changed', { caFirm: 'sent-to-ca' });
    return { ca, sent: [...itemKeys] };
  });
}

/**
 * Records the CA's decision on regulated papers (approve). Signing needs the ICAI membership number of the CA the papers
 * were sent to; the record keeps the name, the number, the receipts, the papers' digest and the playbook hash.
 * Returning the papers needs no number and closes the request; the agents prepare a new one.
 */
export async function recordCaSignoff(deps: VentureDeps, ctx: Context, payload: { requestId: string; decision: 'signed' | 'returned'; membershipNumber?: string | null; note?: string | null }): Promise<SignoffRecord> {
  check(payload && (payload.decision === 'signed' || payload.decision === 'returned'), 'INVALID_VENTURE_REQUEST', 'Sign it off or return it.');
  const note = payload.note === undefined || payload.note === null || payload.note === '' ? null : singleLine(payload.note, 'Note', { min: 1, max: 400 });
  return ventureAction(deps, ctx, 'approve', 'ca-firm.signoff', tx => {
    const ventureId = tx.venture!.id;
    const request = entries(tx.state, ventureId, 'signoff-request').find(item => item.id === payload.requestId);
    if (!request) throw new ChausarError('SIGNOFF_NOT_FOUND', 'Those papers are not waiting for a sign-off.');
    if (signoffFor(tx.state, ventureId, request.id)) throw new ChausarError('SIGNOFF_NOT_FOUND', 'Those papers were decided already.');
    const sent = sentTo(tx.state, ventureId, request.id);
    if (!sent) throw new ChausarError('SIGNOFF_NOT_FOUND', 'Send the papers to your CA first.');
    if (payload.decision === 'signed') membership(payload.membershipNumber, { name: sent.caName, membershipNumber: sent.membershipNumber });
    const record = tx.put<CaFirmRecord>({
      ...tx.base('venture-ca-firm'), entry: 'signoff', requestId: request.id, decision: payload.decision, caName: sent.caName, membershipNumber: sent.membershipNumber,
      workingDigest: request.workingDigest, receiptIds: [...request.receiptIds], playbookHash: request.playbookHash, note, recordedBy: ctx.memberId,
    }) as SignoffRecord;
    tx.emit('queue.changed', { caFirm: 'signoff', requestId: request.id });
    return record;
  });
}

/** Records the CA's confirmation of rate-table versions by their current content hash (approve). */
export async function confirmRateTables(deps: VentureDeps, ctx: Context, payload: { keys: readonly string[]; membershipNumber: string | null }): Promise<RateConfirmation[]> {
  check(Array.isArray(payload?.keys) && payload.keys.length >= 1, 'INVALID_VENTURE_REQUEST', 'Choose the rate tables to confirm.');
  return ventureAction(deps, ctx, 'approve', 'ca-firm.rate-confirmation', tx => {
    const ventureId = tx.venture!.id;
    const confirmed: RateConfirmation[] = [];
    for (const key of payload.keys) {
      const table = RATE_TABLES.find(item => rateKey(item) === key);
      if (!table) throw new ChausarError('SIGNOFF_NOT_FOUND', 'That rate table version is not waiting for the CA.');
      const sent = sentTo(tx.state, ventureId, key);
      if (!sent) throw new ChausarError('SIGNOFF_NOT_FOUND', 'Send the rate table to your CA first.');
      membership(payload.membershipNumber, { name: sent.caName, membershipNumber: sent.membershipNumber });
      const record = tx.put<CaFirmRecord>({
        ...tx.base('venture-ca-firm'), entry: 'rate-confirmation', tableId: table.id, tableVersion: table.version, tableHash: rateTableHash(table),
        caName: sent.caName, membershipNumber: sent.membershipNumber, recordedBy: ctx.memberId,
      });
      confirmed.push({ tableId: table.id, version: table.version, hash: rateTableHash(table), caName: sent.caName, membershipNumber: sent.membershipNumber, at: record.at });
    }
    tx.emit('queue.changed', { caFirm: 'rate-confirmation' });
    return confirmed;
  });
}

// ---------------------------------------------------------------------------
// Today's queue
// ---------------------------------------------------------------------------

type Perform = (deps: VentureDeps, ctx: Context, input: { answer: string | null }) => Promise<{ line: string; receiptId?: string }>;
/** One 'signoff' row before views/queue.ts gives it a business, an id and a digest. */
export type CaQueueItem = {
  subject: string;
  version: string;
  title: string;
  line: string;
  createdAt: string;
  actions: QueueAction[];
  viewRef?: { kind: 'file'; id: string };
  perform: Partial<Record<QueueActionId, Perform>>;
};

const act = (id: QueueActionId, label: string, primary: boolean, extra: { secondAsk?: boolean; requiresView?: boolean } = {}): QueueAction =>
  ({ id, label, primary, ...(extra.secondAsk ? { secondAsk: true } : {}), ...(extra.requiresView ? { requiresView: true } : {}) });
const tables = (count: number) => (count === 1 ? 'rate table' : 'rate tables');

/** Everything waiting for the CA of record, oldest first. Empty for a business with no CA firm records. */
export function caFirmQueueItems(state: State, venture: VentureRecord): CaQueueItem[] {
  const all = listRecords(state, 'venture-ca-firm', venture.id);
  if (!all.length) return [];
  const ca = caOfRecord(state, venture.id);
  const items: CaQueueItem[] = [];

  for (const request of entries(state, venture.id, 'signoff-request')) {
    if (signoffFor(state, venture.id, request.id)) continue;
    const subject = `ca-signoff:${request.id}`;
    const sent = sentTo(state, venture.id, request.id);
    const forClient = request.clientName ? `For ${request.clientName}. ` : '';
    if (!sent) {
      if (!ca) continue;
      items.push({
        subject, version: 'send', createdAt: request.at, viewRef: { kind: 'file', id: request.id },
        title: `${request.title} needs your CA's sign-off`,
        line: `${forClient}Nothing regulated leaves Chausar until ${ca.name} signs it.`,
        actions: [act('read', 'Read', false), act('send-to-ca', 'Send to CA', true, { requiresView: true })],
        perform: { 'send-to-ca': async (deps, ctx) => { const { ca: to } = await sendToCa(deps, ctx, [request.id]); return { line: `Waiting for ${caLabel(to)} to sign off.` }; } },
      });
    } else {
      items.push({
        subject, version: 'sign', createdAt: sent.at, viewRef: { kind: 'file', id: request.id },
        title: `${sent.caName} to sign off: ${request.title}`,
        line: `${forClient}${sent.caName} reads the papers, then types their ICAI membership number to sign off.`,
        actions: [act('deny', 'Return', false), act('answer', 'Sign off', true, { requiresView: true, secondAsk: true })],
        perform: {
          answer: async (deps, ctx, input) => { await recordCaSignoff(deps, ctx, { requestId: request.id, decision: 'signed', membershipNumber: input.answer }); return { line: `Signed off by ${caLabel({ name: sent.caName, membershipNumber: sent.membershipNumber })}.` }; },
          deny: async (deps, ctx, input) => { await recordCaSignoff(deps, ctx, { requestId: request.id, decision: 'returned', note: input.answer }); return { line: 'Returned to the team. The agents prepare the papers again.' }; },
        },
      });
    }
  }

  if (ca) {
    const open = unconfirmedRateTables(state, venture.id);
    const caSince = entries(state, venture.id, 'ca-of-record').at(-1)!.at;
    const unsent = open.filter(table => !sentTo(state, venture.id, rateKey(table)));
    const waiting = open.filter(table => sentTo(state, venture.id, rateKey(table)));
    if (unsent.length) {
      const keys = unsent.map(rateKey);
      items.push({
        subject: 'ca-rates:send', version: `v${digest(keys).slice(0, 12)}`, createdAt: caSince,
        title: unsent.length === 1 ? `A ${tables(1)} needs your CA's confirmation` : `${unsent.length} ${tables(unsent.length)} need your CA's confirmation`,
        line: `${unsent.map(table => `${table.title}, version ${table.version}`).join('; ')}. Real client work waits for them; rehearsal does not.`,
        actions: [act('later', 'Later', false), act('send-to-ca', 'Send to CA', true)],
        perform: { 'send-to-ca': async (deps, ctx) => { const { ca: to } = await sendToCa(deps, ctx, keys); return { line: `Waiting for ${caLabel(to)} to confirm ${keys.length} ${tables(keys.length)}.` }; } },
      });
    }
    if (waiting.length) {
      const keys = waiting.map(rateKey);
      const sent = sentTo(state, venture.id, keys[0])!;
      items.push({
        subject: 'ca-rates:sign', version: `v${digest(keys).slice(0, 12)}`, createdAt: sent.at,
        title: `${sent.caName} to confirm ${waiting.length} ${tables(waiting.length)}`,
        line: `${sent.caName} checks each rate and its sources, then types their ICAI membership number to confirm.`,
        actions: [act('answer', 'Confirm', true, { secondAsk: true })],
        perform: { answer: async (deps, ctx, input) => { await confirmRateTables(deps, ctx, { keys, membershipNumber: input.answer }); return { line: `Confirmed by ${caLabel({ name: sent.caName, membershipNumber: sent.membershipNumber })}: ${keys.length} ${tables(keys.length)}.` }; } },
      });
    }
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
