// Collections desk after finance-skills (MIT prompt ideas); original app-authorized records, no debtor contact.
import { check, type State } from '../../../contracts.ts';
import type { PromiseToPayRecord, VentureRecord } from '../../contracts.ts';
import type { DeskHandlers, DeskKindTypes } from '../desk-types.ts';
import { exactPayload, identifier, isoDate, listRecords, requireAppChannel, singleLine, ventureAction, digest } from '../../records.ts';
import { readAs } from '../../delivery/shared.ts';
import { localDayAt } from '../../local-day.ts';
import { ownerPrice } from '../../core/words.ts';
import { collectionSource, collectionInvoices, type CollectionsInvoiceRow } from './collections-source.ts';
import { daysFrom } from '../../money/ledger.ts';
import { collectionStage, DEFAULT_LADDER, promiseStatus, reminderDraft, validateLadder, type CollectionStage } from './collections.ts';
import {FINANCE_DESK,type FinanceDeskTypes} from './finance-desk.ts';
import {BOOKS_POSTING_DESK,type BooksPostingDeskTypes} from './posting-desk.ts';
import {SETTLEMENT_DESK,type SettlementDeskTypes} from './settlement-desk.ts';
import {SETUP_DESK,type SetupDeskTypes} from './setup-desk.ts';

export type PromiseRow = { id: string; clientId: string; clientName: string; invoiceIds: string[]; promisedOn: string; statedBy: string; status: 'kept' | 'pending' | 'broken'; stage: string; stageName: string; digest: string };
export type LadderRow = { id: string; ladder: CollectionStage[]; digest: string };
export type BookkeepingCfoDeskTypes = FinanceDeskTypes & BooksPostingDeskTypes & SettlementDeskTypes & SetupDeskTypes & {
  ledger: DeskKindTypes & { row: CollectionsInvoiceRow; item: CollectionsInvoiceRow; actions: Record<never, never> };
  promise: DeskKindTypes & { row: PromiseRow; item: PromiseRow; actions: { record: { payload: { clientId: string; serviceOrderId: string; sourceName: string; invoiceIds: string[]; amountRupees: string; promisedOn: string; method: string; statedBy: string }; result: PromiseRow }; reminder: { payload: { text: string }; result: ReturnType<typeof reminderDraft> } } };
  ladder: DeskKindTypes & { row: LadderRow; item: LadderRow; actions: { set: { payload: { ladder: CollectionStage[] }; result: LadderRow } } };
};

function currentLadder(state: State, venture: VentureRecord): LadderRow {
  const saved = listRecords(state, 'venture-collection-stage', venture.id).filter(row => row.clientId === null).at(-1);
  const ladder = (saved?.ladder ?? DEFAULT_LADDER).map(row => ({ ...row }));
  return { id: 'configuration', ladder, digest: digest(ladder) };
}
function statusOf(state: State, venture: VentureRecord, record: PromiseToPayRecord, today: string) {
  const payments = collectionSource(state, venture, record.serviceOrderId, record.sourceName).payments.filter(row => !record.recordedPaymentIds.includes(row.id));
  return promiseStatus(record, payments, today);
}
/** Promise status and escalation are re-derived from recorded payments on every read. */
export function collectionRows(state: State, venture: VentureRecord, today: string): PromiseRow[] {
  const records = listRecords(state, 'venture-promise-to-pay', venture.id);
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(row => [row.id, row.name]));
  const invoices = collectionInvoices(state, venture);
  return records.filter(row => clients.has(row.clientId)).map(record => {
    const debtorKeys = new Set(invoices.filter(row => row.serviceOrderId === record.serviceOrderId && row.sourceName === record.sourceName && record.invoiceIds.includes(row.invoiceId)).map(row => row.debtor));
    const broken = records.filter(row => row.clientId === record.clientId && row.serviceOrderId === record.serviceOrderId && row.sourceName === record.sourceName && invoices.some(invoice => invoice.serviceOrderId === row.serviceOrderId && invoice.sourceName === row.sourceName && row.invoiceIds.includes(invoice.invoiceId) && debtorKeys.has(invoice.debtor)) && statusOf(state, venture, row, today) === 'broken').length;
    const daysLate = Math.max(0, ...invoices.filter(row => row.serviceOrderId === record.serviceOrderId && row.sourceName === record.sourceName && record.invoiceIds.includes(row.invoiceId)).map(row => daysFrom(row.dueDate!, today)));
    const stage = collectionStage(daysLate, broken, currentLadder(state, venture).ladder);
    const row = { id: record.id, clientId: record.clientId, clientName: clients.get(record.clientId)!, invoiceIds: [...record.invoiceIds], promisedOn: record.promisedOn, statedBy: record.statedBy, status: statusOf(state, venture, record, today), stage: stage.id, stageName: stage.name };
    return { ...row, digest: digest({ ...row, record, source: collectionSource(state, venture, record.serviceOrderId, record.sourceName).upload.digest }) };
  });
}
function top(value: unknown, operation: 'list' | 'get' | 'act') {
  return exactPayload(value, operation === 'list' ? ['playbook', 'kind', 'filter'] : operation === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], operation === 'list' ? ['playbook', 'kind'] : operation === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload']);
}

/** New promises and ladder edits are explicit owner actions; reminders stay client-only drafts. */
export const BOOKKEEPING_CFO_DESK: DeskHandlers = Object.freeze({
  ...FINANCE_DESK,
  ...BOOKS_POSTING_DESK,
  ...SETTLEMENT_DESK,
  ...SETUP_DESK,
  ledger: {
    async list(deps, ctx, payload) { const body = top(payload, 'list'); if (body.filter !== undefined) exactPayload(body.filter, []); const { state, venture } = readAs(deps, ctx, 'read'); return { playbook: 'bookkeeping-cfo', kind: 'ledger', rows: collectionInvoices(state, venture), line: 'Invoices in your client uploaded debtor ledgers.' }; },
  },
  promise: {
    async list(deps, ctx, payload) {
      const body = top(payload, 'list');
      const filter = body.filter === undefined ? {} : exactPayload(body.filter, ['clientId']);
      if (filter.clientId !== undefined) identifier(filter.clientId, 'Client');
      const { state, venture } = readAs(deps, ctx, 'read');
      const rows = collectionRows(state, venture, localDayAt(deps.clock(), venture.country)).filter(row => !filter.clientId || row.clientId === filter.clientId);
      return { playbook: 'bookkeeping-cfo', kind: 'promise', rows, line: 'Your client approves and sends every reminder.' };
    },
    async get(deps, ctx, payload) {
      const body = top(payload, 'get');
      const { state, venture } = readAs(deps, ctx, 'read');
      const row = collectionRows(state, venture, localDayAt(deps.clock(), venture.country)).find(row => row.id === identifier(body.id, 'Promise'));
      check(row, 'PROMISE_NOT_FOUND', 'That promise was not found.');
      return { playbook: 'bookkeeping-cfo', kind: 'promise', item: row, digest: row.digest };
    },
    async act(deps, ctx, payload) {
      requireAppChannel(ctx, 'venture.desk.act');
      const body = top(payload, 'act');
      check(['record', 'reminder'].includes(String(body.action)), 'INVALID_VENTURE_REQUEST', 'Choose a supported collections action.');
      readAs(deps, ctx, 'approve');
      return ventureAction(deps, ctx, 'approve', 'bookkeeping.promise', tx => {
        const venture = tx.venture!;
        const today = localDayAt(tx.now, venture.country);
        if (body.action === 'record') {
          check(body.id === 'new' && body.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Record a new promise without a prior digest.');
          const input = exactPayload(body.payload, ['clientId', 'serviceOrderId', 'sourceName', 'invoiceIds', 'amountRupees', 'promisedOn', 'method', 'statedBy'], ['clientId', 'serviceOrderId', 'sourceName', 'invoiceIds', 'amountRupees', 'promisedOn', 'method', 'statedBy']);
          const clientId = identifier(input.clientId, 'Client');
          check(tx.list('venture-client').some(row => row.id === clientId), 'CLIENT_NOT_FOUND', 'That client was not found.');
          check(Array.isArray(input.invoiceIds) && input.invoiceIds.length >= 1 && input.invoiceIds.length <= 40 && new Set(input.invoiceIds).size === input.invoiceIds.length, 'INVALID_VENTURE_REQUEST', 'Choose distinct invoices for this promise.');
          const invoiceIds = input.invoiceIds.map(id => identifier(id, 'Invoice'));
          const serviceOrderId = identifier(input.serviceOrderId, 'Service order'), sourceName = singleLine(input.sourceName, 'Source file', { max: 200 });
          const source = collectionSource(tx.state, venture, serviceOrderId, sourceName);
          check(source.client.id === clientId && invoiceIds.every(id => source.invoices.some(row => row.id === id)), 'INVOICE_NOT_FOUND', 'Choose debtor invoices from this client service order.');
          const record = tx.put<PromiseToPayRecord>({ ...tx.base('venture-promise-to-pay'), clientId, serviceOrderId, sourceName, invoiceIds, amountMinor: ownerPrice(input.amountRupees, venture.country.currency, 'Promised amount').minor, promisedOn: isoDate(input.promisedOn, 'Promised date'), recordedOn: today, recordedPaymentIds: source.payments.filter(row => invoiceIds.includes(row.invoiceId) && row.cleared).map(row => row.id), method: singleLine(input.method, 'Payment method', { max: 80 }), statedBy: singleLine(input.statedBy, 'Who promised', { max: 120 }) });
          tx.emit('desk.changed', { playbook: 'bookkeeping-cfo', kind: 'promise', id: record.id });
          const row = collectionRows(tx.state, venture, today).find(row => row.id === record.id)!;
          return { playbook: 'bookkeeping-cfo', kind: 'promise', id: record.id, result: row, line: 'The promise is recorded; only recorded payments can mark it kept.' };
        }
        const row = collectionRows(tx.state, venture, today).find(row => row.id === body.id);
        check(row, 'PROMISE_NOT_FOUND', 'That promise was not found.');
        check(body.digest === row.digest, 'APPROVAL_STALE', 'The promise changed. Read it again before drafting.');
        const input = exactPayload(body.payload, ['text'], ['text']);
        const result = reminderDraft(row.clientId, row.invoiceIds[0], singleLine(input.text, 'Reminder note', { max: 2000 }));
        return { playbook: 'bookkeeping-cfo', kind: 'promise', id: row.id, result, line: 'This note is for your client. Your client reviews and sends the reminder.' };
      });
    },
  },
  ladder: {
    async list(deps, ctx, payload) {
      const body = top(payload, 'list');
      if (body.filter !== undefined) exactPayload(body.filter, []);
      const { state, venture } = readAs(deps, ctx, 'read');
      return { playbook: 'bookkeeping-cfo', kind: 'ladder', rows: [currentLadder(state, venture)], line: 'The stage ladder is a house default until you change it.' };
    },
    async get(deps, ctx, payload) {
      const body = top(payload, 'get');
      check(body.id === 'configuration', 'INVALID_VENTURE_REQUEST', 'Choose the collection ladder.');
      const { state, venture } = readAs(deps, ctx, 'read');
      const item = currentLadder(state, venture);
      return { playbook: 'bookkeeping-cfo', kind: 'ladder', item, digest: item.digest };
    },
    async act(deps, ctx, payload) {
      requireAppChannel(ctx, 'venture.desk.act');
      const body = top(payload, 'act');
      check(body.id === 'configuration' && body.action === 'set', 'INVALID_VENTURE_REQUEST', 'Choose the collection ladder to change it.');
      const input = exactPayload(body.payload, ['ladder'], ['ladder']);
      check(Array.isArray(input.ladder), 'COLLECTION_LADDER_INVALID', 'Give the collection stages in order.');
      const ladder = input.ladder.map(value => { const row = exactPayload(value, ['id', 'fromDay', 'name'], ['id', 'fromDay', 'name']); return { id: identifier(row.id, 'Stage'), fromDay: row.fromDay as number, name: singleLine(row.name, 'Stage name', { max: 120 }) }; });
      validateLadder(ladder);
      return ventureAction(deps, ctx, 'approve', 'bookkeeping.ladder', tx => {
        check(body.digest === currentLadder(tx.state, tx.venture!).digest, 'APPROVAL_STALE', 'The ladder changed. Read it again before approving.');
        tx.put({ ...tx.base('venture-collection-stage'), clientId: null, ladder });
        tx.emit('desk.changed', { playbook: 'bookkeeping-cfo', kind: 'ladder', id: 'configuration' });
        return { playbook: 'bookkeeping-cfo', kind: 'ladder', id: 'configuration', result: currentLadder(tx.state, tx.venture!), line: 'The collection ladder changed after your approval.' };
      });
    },
  },
});
