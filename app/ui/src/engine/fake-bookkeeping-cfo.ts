/** Bookkeeping fake, after finance-skills/cfo/bankmcp (MIT ideas); exact desk validation and business-local records. */
import { EngineError, type OrderLite } from './types';
import { readCollectionsSource } from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/collections-source-core';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import {fakeBooksFinance} from './fake-books-finance';

/** Browser-safe startup metadata; shared fake onboarding consumes this, not server modules. */
export const BOOKKEEPING_FAKE_METADATA = {
  registration: { id: 'bookkeeping-cfo', label: 'Bookkeeping and CFO help', serviceType: 'consulting', picks: ['bookkeeping service', 'collections desk', 'cfo on demand', 'bookkeeping and cfo', 'monthly finance pack'], summary: 'Agents prepare collections drafts, cash packs and spending checks from client files; you approve each report and your client sends every reminder.' },
  offers: [
    { id: 'monthly-books', name: 'Monthly books', description: 'Validate the client ledger and prepare its monthly cash note for review.', pricing: 'monthly', unit: 'a client a month', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
    { id: 'collections-desk', name: 'Collections desk', description: 'Aged balances, reminder drafts and promises to pay for your client to review and send.', pricing: 'monthly', unit: 'a client a month', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
    { id: 'cfo-pack', name: 'Monthly CFO pack', description: 'Cash, working capital and scenarios with labelled figures.', pricing: 'monthly', unit: 'a client a month', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
    { id: 'decision-memo', name: 'A decision memo', description: 'A clear answer to a finance question, with assumptions beside the scenarios.', pricing: 'project', unit: 'per memo', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
    { id: 'money-checkup', name: 'Money check-up', description: 'A read-only spending summary and possible savings to review.', pricing: 'project', unit: 'per check-up', intake: ['data-consent', 'period', 'question', 'large-payment-threshold'], price: 'owner-sets' },
    { id: 'seller-books', name: 'Monthly seller books', description: 'Reconcile orders, payouts and tax credits, then review exact accounting drafts before posting.', pricing: 'monthly', unit: 'a client a month', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
    { id: 'back-office-setup', name: 'Client books setup', description: 'Prepare customers, vendors, accounts and balanced opening entries for the client accounting system.', pricing: 'project', unit: 'per client setup', intake: ['data-consent', 'period', 'question'], price: 'owner-sets' },
  ],
  intakeFields: [
    { id: 'data-consent', label: 'Client consent to use these files', help: 'Confirm the client agreed to share their minimum necessary records.', kind: 'consent', required: true },
    { id: 'period', label: 'Period covered', help: 'Name the period in the client files.', kind: 'text', required: true },
    { id: 'large-payment-threshold', label: 'Large payment threshold', help: 'Set the rupee amount above which spending needs a closer look.', kind: 'money', required: true },
    { id: 'question', label: 'The finance question', help: 'What does the client want to decide?', kind: 'text', required: false },
  ],
};

type Ladder = { id: string; fromDay: number; name: string }[];
type PromiseStored = { business: string; id: string; clientId: string; serviceOrderId: string; sourceName: string; invoiceIds: string[]; amountMinor: string; promisedOn: string; method: string; statedBy: string; recordedPaymentIds: string[] };
const DEFAULTS: Ladder = [
  { id: 'reminder', fromDay: 1, name: 'Reminder draft' }, { id: 'call', fromDay: 31, name: 'Call and email by a person' }, { id: 'formal', fromDay: 61, name: 'Formal letter for review' }, { id: 'lawyer', fromDay: 91, name: 'Lawyer review and pause new orders' }, { id: 'writeoff', fromDay: 181, name: 'Write-off decision by the client' },
];
function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(record, key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return record;
}
function id(value: unknown, name: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new EngineError('INVALID_VENTURE_REQUEST', `${name} must be a known identifier.`); return value; }
function line(value: unknown, name: string, max: number): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001F\u007F]/.test(value.trim())) throw new EngineError('INVALID_VENTURE_REQUEST', `${name} must be plain text on one line.`); return value.trim(); }
function date(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new EngineError('INVALID_VENTURE_REQUEST', 'Promised date must be a date like 2026-10-15.'); return value; }
function rupees(value: unknown): string {
  const text = typeof value === 'string' && value.length <= 40 ? value.replace(/[\s,]/g, '') : '';
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new EngineError('INVALID_AMOUNT', 'Promised amount must be a positive amount like 2499 or 2499.50.');
  const [whole = '0', decimal = ''] = text.split('.'); const fraction = decimal.replace(/0+$/, '');
  if (fraction.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (minor <= 0n || minor > 1_000_000_000_000n) throw new EngineError('INVALID_AMOUNT', 'Promised amount must be positive and within the accepted limit.');
  return String(minor);
}
function validate(ladder: Ladder): void {
  if (!ladder.length || ladder.length > 12 || ladder[0]?.fromDay !== 1 || new Set(ladder.map(row => row.id)).size !== ladder.length || ladder.some((row, i) => !/^[a-z][a-z0-9-]*$/.test(row.id) || !row.name.trim() || !Number.isSafeInteger(row.fromDay) || row.fromDay < 1 || (i > 0 && row.fromDay <= ladder[i - 1]!.fromDay))) throw new EngineError('COLLECTION_LADDER_INVALID', 'Keep the stages in increasing days late, starting on the first late day.');
}

/** The fake reads real fake invoice payments on every list; no owner or model flag can mark a promise kept. */
export function fakeBookkeepingCfoDesk(host: W4DeskHost): FakePlaybookDesk {
  const finance=fakeBooksFinance(host);
  const promises: PromiseStored[] = [];
  const ladders = new Map<string, Ladder>();
  const orders = () => host.ask('venture.order.list', {}) as OrderLite[];
  const clients = () => host.ask('venture.client.list', {}) as { id: string; name: string }[];
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(host.now()));
  const source = (serviceOrderId: string, sourceName: string) => {
    const order = orders().find(row => row.id === serviceOrderId && row.status !== 'cancelled');
    if (!order) throw new EngineError('CLIENT_LEDGER_REQUIRED', 'Choose the client service order holding its debtor ledger.');
    const client = clients().find(row => row.id === order.clientId);
    if (!client) throw new EngineError('CLIENT_NOT_FOUND', 'The source client was not found.');
    const file = host.orderFiles?.(order.id).find(row => row.name === sourceName);
    if (!file || file.format !== 'csv') throw new EngineError('CLIENT_LEDGER_REQUIRED', 'Upload the client debtor ledger as CSV on this service order.');
    let parsed; try { parsed = readCollectionsSource(new TextDecoder().decode(Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0)))); } catch { throw new EngineError('CLIENT_LEDGER_INVALID', 'The debtor ledger needs valid distinct invoice and payment rows.'); }
    if (!parsed) throw new EngineError('CLIENT_LEDGER_INVALID', 'Use columns kind, id, invoice, debtor, on, dueOn, amount and state in the client debtor ledger.');
    return { ...parsed, order, client, file };
  };
  const invoices = () => orders().filter(row => row.status !== 'cancelled' && clients().some(client => client.id === row.clientId)).flatMap(order => {
    const names = [...new Set((host.orderFiles?.(order.id) ?? []).filter(file => file.format === 'csv').map(file => file.name))];
    return names.flatMap(name => { try { const found = source(order.id, name); return found.invoices.map(invoice => ({ id: host.digest({ order: order.id, name, invoice: invoice.id }), clientId: found.client.id, clientName: found.client.name, serviceOrderId: order.id, sourceName: name, invoiceId: invoice.id, number: invoice.number, debtor: invoice.debtor, dueDate: invoice.dueOn })); } catch { return []; } });
  });
  const status = (record: PromiseStored) => {
    const paid = source(record.serviceOrderId, record.sourceName).payments.filter(payment => record.invoiceIds.includes(payment.invoiceId) && !record.recordedPaymentIds.includes(payment.id) && payment.cleared && payment.receivedOn <= record.promisedOn && payment.receivedOn <= today()).reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
    return paid >= BigInt(record.amountMinor) ? 'kept' : today() > record.promisedOn ? 'broken' : 'pending';
  };
  const ladderView = () => { const ladder = structuredClone(ladders.get(host.current()) ?? DEFAULTS); return { id: 'configuration', ladder, digest: host.digest(ladder) }; };
  const rows = () => promises.filter(row => row.business === host.current() && clients().some(client => client.id === row.clientId)).map(record => {
    const debtorKeys = new Set(invoices().filter(row => row.serviceOrderId === record.serviceOrderId && row.sourceName === record.sourceName && record.invoiceIds.includes(row.invoiceId)).map(row => row.debtor));
    const broken = promises.filter(row => row.business === host.current() && row.clientId === record.clientId && row.serviceOrderId === record.serviceOrderId && row.sourceName === record.sourceName && invoices().some(invoice => invoice.serviceOrderId === row.serviceOrderId && invoice.sourceName === row.sourceName && row.invoiceIds.includes(invoice.invoiceId) && debtorKeys.has(invoice.debtor)) && status(row) === 'broken').length;
    const days = Math.max(0, ...invoices().filter(invoice => invoice.serviceOrderId === record.serviceOrderId && invoice.sourceName === record.sourceName && record.invoiceIds.includes(invoice.invoiceId) && invoice.dueDate).map(invoice => Math.floor((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${invoice.dueDate}T00:00:00Z`)) / 86400000)));
    const ladder = ladderView().ladder; let index = 0;
    for (let i = 0; i < ladder.length; i++) if (days >= ladder[i]!.fromDay) index = i;
    const stage = ladder[Math.min(ladder.length - 1, index + (broken >= 2 ? 1 : 0))]!;
    const row = { id: record.id, clientId: record.clientId, clientName: clients().find(client => client.id === record.clientId)!.name, invoiceIds: record.invoiceIds, promisedOn: record.promisedOn, statedBy: record.statedBy, status: status(record), stage: stage.id, stageName: stage.name };
    return { ...row, digest: host.digest({ ...row, record, source: source(record.serviceOrderId, record.sourceName).file.digest }) };
  });
  const changed = (_kind: string, _recordId: string) => host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() });
  return { playbook: 'bookkeeping-cfo',
    endSession:finance.endSession,
    workReceipt:finance.workReceipt,
    forgetPeople(people, removeClient) {
      finance.forget(people);
      if (!removeClient) return;
      const clientIds = new Set(people.flatMap(person => person.clientId ? [person.clientId] : []));
      const names = people.flatMap(person => [...person.names, ...person.emails, ...person.phones]).map(word => word.trim().toLowerCase()).filter(Boolean);
      const namesSomeone = (text: string) => names.some(name => text.toLowerCase().includes(name));
      for (let index = promises.length - 1; index >= 0; index--) {
        const record = promises[index]!;
        if (record.business === host.current() && (clientIds.has(record.clientId) || namesSomeone(record.statedBy))) promises.splice(index, 1);
      }
      const saved = ladders.get(host.current());
      if (saved && namesSomeone(JSON.stringify(saved))) ladders.delete(host.current());
    },
    kinds: {
    finance:finance.kind,
    posting:finance.posting,
    settlement:finance.settlement,
    setup:finance.setup,
    ledger: { list(p) { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); if (body.filter !== undefined) exact(body.filter, []); return { playbook: 'bookkeeping-cfo', kind: 'ledger', rows: invoices(), line: 'Invoices in your client uploaded debtor ledgers.' }; } },
    promise: {
      list(p) { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); const filter = body.filter === undefined ? {} : exact(body.filter, ['clientId']); if (filter.clientId !== undefined) id(filter.clientId, 'Client'); return { playbook: 'bookkeeping-cfo', kind: 'promise', rows: rows().filter(row => !filter.clientId || row.clientId === filter.clientId), line: 'Your client approves and sends every reminder.' }; },
      get(p) { const body = exact(p, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const row = rows().find(row => row.id === id(body.id, 'Promise')); if (!row) throw new EngineError('PROMISE_NOT_FOUND', 'That promise was not found.'); return { playbook: 'bookkeeping-cfo', kind: 'promise', item: row, digest: row.digest }; },
      act(p) {
        const body = exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
        if (!['record', 'reminder'].includes(String(body.action))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose a supported collections action.');
        if (body.action === 'record') {
          if (body.id !== 'new' || body.digest !== undefined) throw new EngineError('INVALID_VENTURE_REQUEST', 'Record a new promise without a prior digest.');
          const input = exact(body.payload, ['clientId', 'serviceOrderId', 'sourceName', 'invoiceIds', 'amountRupees', 'promisedOn', 'method', 'statedBy'], ['clientId', 'serviceOrderId', 'sourceName', 'invoiceIds', 'amountRupees', 'promisedOn', 'method', 'statedBy']);
          const clientId = id(input.clientId, 'Client');
          if (!clients().some(client => client.id === clientId)) throw new EngineError('CLIENT_NOT_FOUND', 'That client was not found.');
          if (!Array.isArray(input.invoiceIds) || input.invoiceIds.length < 1 || input.invoiceIds.length > 40 || new Set(input.invoiceIds).size !== input.invoiceIds.length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose distinct invoices for this promise.');
          const invoiceIds = input.invoiceIds.map(value => id(value, 'Invoice'));
          const serviceOrderId = id(input.serviceOrderId, 'Service order'), sourceName = line(input.sourceName, 'Source file', 200);
          const ledger = source(serviceOrderId, sourceName);
          if (ledger.client.id !== clientId || !invoiceIds.every(invoiceId => ledger.invoices.some(row => row.id === invoiceId))) throw new EngineError('INVOICE_NOT_FOUND', 'Choose debtor invoices from this client service order.');
          const record = { business: host.current(), id: `promise_fake_${promises.length + 1}`, clientId, serviceOrderId, sourceName, invoiceIds, amountMinor: rupees(input.amountRupees), promisedOn: date(input.promisedOn), recordedOn: today(), method: line(input.method, 'Payment method', 80), statedBy: line(input.statedBy, 'Who promised', 120), recordedPaymentIds: ledger.payments.filter(payment => invoiceIds.includes(payment.invoiceId) && payment.cleared).map(payment => payment.id) };
          promises.push(record); changed('promise', record.id);
          return { playbook: 'bookkeeping-cfo', kind: 'promise', id: record.id, result: rows().find(row => row.id === record.id), line: 'The promise is recorded; only recorded payments can mark it kept.' };
        }
        const row = rows().find(row => row.id === body.id); if (!row) throw new EngineError('PROMISE_NOT_FOUND', 'That promise was not found.');
        if (body.digest !== row.digest) throw new EngineError('APPROVAL_STALE', 'The promise changed. Read it again before drafting.');
        const input = exact(body.payload, ['text'], ['text']);
        return { playbook: 'bookkeeping-cfo', kind: 'promise', id: row.id, result: { toClientId: row.clientId, invoiceId: row.invoiceIds[0], text: line(input.text, 'Reminder note', 2000), sender: 'client', needsApproval: true }, line: 'This note is for your client. Your client reviews and sends the reminder.' };
      },
    },
    ladder: {
      list(p) { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); if (body.filter !== undefined) exact(body.filter, []); return { playbook: 'bookkeeping-cfo', kind: 'ladder', rows: [ladderView()], line: 'The stage ladder is a house default until you change it.' }; },
      get(p) { const body = exact(p, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); if (body.id !== 'configuration') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the collection ladder.'); const item = ladderView(); return { playbook: 'bookkeeping-cfo', kind: 'ladder', item, digest: item.digest }; },
      act(p) {
        const body = exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
        if (body.id !== 'configuration' || body.action !== 'set') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the collection ladder to change it.');
        const input = exact(body.payload, ['ladder'], ['ladder']);
        if (!Array.isArray(input.ladder)) throw new EngineError('COLLECTION_LADDER_INVALID', 'Give the collection stages in order.');
        const ladder = input.ladder.map(value => { const row = exact(value, ['id', 'fromDay', 'name'], ['id', 'fromDay', 'name']); return { id: id(row.id, 'Stage'), fromDay: row.fromDay as number, name: line(row.name, 'Stage name', 120) }; }); validate(ladder);
        if (body.digest !== ladderView().digest) throw new EngineError('APPROVAL_STALE', 'The ladder changed. Read it again before approving.');
        ladders.set(host.current(), ladder); changed('ladder', 'configuration');
        return { playbook: 'bookkeeping-cfo', kind: 'ladder', id: 'configuration', result: ladderView(), line: 'The collection ladder changed after your approval.' };
      },
    },
  } };
}
