import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService } from '../runtime/ingest.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { imageAsPdf } from '../runtime/work-books/books-bill-image.ts';
import { readingsHeld } from '../runtime/work-books/books-bill.ts';
import { LIMITS, namesId } from '../runtime/work-books/books-common.ts';
import { peekSection } from '../runtime/work-books/state.ts';

// Regression tests for the second review of the work-books lane. Every value here is synthetic.
// Other lanes (helper, writeback, trustx, trials) are stubbed in the host; nothing depends on what is installed.

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Review Shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1 };
const north: Context = { memberId: 'nina', role: 'cofounder', epoch: 1, channel: 'desktop' };
const south: Context = { memberId: 'sam', role: 'viewer', epoch: 1 };
type Stub = Record<string, (payload: any) => unknown>;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

const BILL_TEXT = ['Sharma Paper Mart', 'TAX INVOICE', 'GSTIN: 27ABCDE1234F1Z5', 'Bill No: SPM-0042', 'Date: 05/09/2026',
  'Description Qty Rate Amount', 'A4 Paper Ream 2 x 250.00 500.00', 'Blue Pens Box 120.00', 'Sub Total 620.00', 'CGST 9% 55.80', 'SGST 9% 55.80', 'Grand Total 731.60'].join('\n');

async function setup(options: { stub?: Stub; directory?: string } = {}) {
  const store = new TestStore();
  await store.update(s => {
    s.members.push({ id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] },
      { id: 'nina', name: 'Nina', role: 'cofounder', active: true, epoch: 1, branches: ['north'] }, { id: 'sam', name: 'Sam', role: 'viewer', active: true, epoch: 1, branches: ['south'] });
  });
  const helper = { run: async () => ({ result: { pages: [{ page: 1, text: BILL_TEXT, confidence: 91 }], engineVersion: '5.3.4' } }) };
  const services: Record<string, any> = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store), actions: new ActionService(store, []), helper };
  await services.ontology.publish(owner, 'ecommerce');
  const calls: { method: string; payload: any }[] = [];
  const methods = { ...booksMethods, ...workMethods };
  // Round 4: which other lanes' methods are installed is the stub's own list here, never the registry of the merged build.
  const host = (ctx: Context): ModuleHost => ({ store, services, demo: true, directory: options.directory ?? '/nonexistent', options: { hasMethod: (method: string) => !!options.stub && Object.hasOwn(options.stub, method) },
    async call(method, payload) {
      calls.push({ method, payload });
      if (options.stub && Object.hasOwn(options.stub, method)) return options.stub[method](payload);
      if (Object.hasOwn(booksMethods, method)) return call(ctx, method, payload as Record<string, unknown>);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = methods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  return { store, services, call, calls };
}
const pdf = Buffer.from('%PDF-1.4\nsynthetic bill page\n%%EOF\n').toString('base64');
const fields = (over: Record<string, unknown> = {}) => ({ supplier: 'Sharma Paper Mart', billNumber: 'SPM-0042', date: '2026-09-05',
  lines: [{ description: 'A4 Paper Ream', quantity: '2', amountMinor: '50000' }, { description: 'Blue Pens Box', quantity: '1', amountMinor: '12000' }],
  tax: [{ name: 'CGST 9%', amountMinor: '5580' }, { name: 'SGST 9%', amountMinor: '5580' }], totalMinor: '73160', ...over });
const fact = (entityId: string, sourceId: string, kind: string, validFrom: string, f: Record<string, unknown>): FactInput =>
  ({ entityId, sourceId, sourceRow: 2, kind, validFrom, branch: 'main', fields: { currency: 'INR', status: 'settled', ...f } });
const books = (store: TestStore) => peekSection<any>(store.read(), 'books');

/** A write-back view in the documented shape for a Zoho bill booking. */
const zohoView = (status = 'prepared', digest = 'digest-wb1-0001', revision = 1) => ({ id: 'wb1', system: 'zoho-books', action: 'bill.createFromPhoto', title: 'Book a bill', digest, revision, status,
  kind: 'inside-undoable', tier: 1, steps: [{ name: 'prepared', state: 'done', turn: 'chausar', at: '2026-10-01T00:00:00.000Z' }],
  approval: { kind: 'record-change', waitsBecause: { text: 'x' }, change: { fields: [] }, needsSecondAsk: false, can: status === 'prepared' ? ['approve', 'notNow', 'drop'] : [], preparedBy: { kind: 'person', name: 'owner' } },
  target: { label: 'Sharma' }, expiresAt: null, notices: [] });

test('1. deleting a customer after an undone join keeps the other customer’s stop word and agreements; memory matches the exact id', async () => {
  const { store, services, call } = await setup({ stub: { 'trustx.deletions': () => ({ items: [] }) } });
  await services.memory.append(owner, [fact('inv-1', 'books', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' }),
    fact('inv-2', 'books', 'invoice', '2026-09-03', { customerId: 'c-2', amountMinor: '1000' }),
    fact('inv-3', 'books', 'invoice', '2026-09-03', { customerId: 'c-10', amountMinor: '1000' })]);
  const merge = await services.memory.merge(owner, ['c-1', 'c-2'], 'c-1');
  await services.memory.undoMerge(owner, merge.id);
  await call(owner, 'records.setOptIn', { id: 'c-1', channel: 'mail', answer: 'yes', source: 'Email', on: '2026-09-03' });
  await call(owner, 'records.stop', { id: 'c-2', on: '2026-09-20' });
  await call(owner, 'records.setOptIn', { id: 'c-2', channel: 'whatsapp', answer: 'no', source: 'Phone', on: '2026-09-03' });
  await call(owner, 'books.remember', { text: 'c-10 pays only by cheque', kind: 'preference' });
  await call(owner, 'books.remember', { text: 'Call c-1 after noon.', kind: 'preference' });
  const plan = await call(owner, 'records.deletionPlan', { id: 'c-1' });
  assert.deepEqual(plan.stores.filter((s: any) => ['opt-ins', 'memory'].includes(s.store)).map((s: any) => s.count), [1, 1]);
  const report = await call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  const b = books(store);
  assert.deepEqual(b.stops.map((s: any) => s.recordId), ['c-2'], 'the other customer’s stop word stays');
  assert.deepEqual(b.optIns.map((o: any) => o.recordId), ['c-2']);
  assert.deepEqual(b.memory.map((m: any) => [m.text, m.deletedAt !== null]), [['c-10 pays only by cheque', false], [null, true]]);
  assert.deepEqual(report.rows.filter((r: any) => ['opt-ins', 'memory'].includes(r.store)).map((r: any) => [r.store, r.count, r.state]), [['memory', 1, 'deleted'], ['opt-ins', 1, 'deleted']]);
  assert.equal(namesId('c-10 pays', 'c-1'), false); assert.equal(namesId('xc-1 pays', 'c-1'), false); assert.equal(namesId('About c-1.', 'c-1'), true); assert.equal(namesId('a (b) c', '(b)'), true);
});

test('2 and 3. a branch-restricted delete leaves decisions with a hidden customer; deletion reports go to their maker and administrators only', async () => {
  const { store, services, call } = await setup({ stub: { 'trustx.deletions': () => ({ items: [] }) } });
  await services.memory.append(owner, [{ ...fact('inv-1', 'books', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000', customerName: 'Asha' }), branch: 'north' },
    { ...fact('inv-2', 'books2', 'invoice', '2026-09-03', { customerId: 'c-9', amountMinor: '1000', customerName: 'Asha' }), branch: 'south' }]);
  await call(owner, 'records.decideMatch', { left: 'c-1', right: 'c-9', same: false });
  await call(owner, 'records.setOptIn', { id: 'c-1', channel: 'mail', answer: 'yes', source: 'Email', on: '2026-09-03' });
  assert.equal((await call(north, 'records.holdings', { id: 'c-1' })).stores.find((s: any) => s.store === 'matches').count, 0);
  const report = await call(north, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  assert.equal(books(store).matches.length, 1, 'a decision naming a customer Nina cannot see is not hers to delete');
  assert.deepEqual(report.rows.find((r: any) => r.store === 'matches'), { store: 'matches', count: 0, state: 'nothing-held', reason: null });
  assert.equal(Object.hasOwn(report, 'memberId'), false, 'the reply shape is unchanged');
  await assert.rejects(call(south, 'records.get', { id: 'c-1' }), code('RECORD_NOT_FOUND'));
  assert.deepEqual((await call(south, 'records.deletions')).reports, [], 'a member who cannot see the customer does not learn it was deleted');
  assert.deepEqual((await call(viewer, 'records.deletions')).reports, [], 'a viewer with every branch is not an administrator');
  assert.deepEqual((await call(north, 'records.deletions')).reports.map((r: any) => r.id), [report.id], 'the maker reads her own report');
  assert.deepEqual((await call(owner, 'records.deletions')).reports.map((r: any) => r.id), [report.id]);
});

test('4 and 9. one reading books once under concurrent confirms; a failed confirm keeps it; each person holds at most eight readings', async () => {
  let fail = true;
  const { store, call } = await setup({ stub: { 'writeback.prepare': () => { if (fail) throw new ChausarError('WRITEBACK_OFFLINE', 'Offline.'); return null; } } });
  const read = await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  const results = await Promise.allSettled([call(owner, 'books.billConfirm', { readId: read.readId, digest: read.digest, fields: fields() }),
    call(owner, 'books.billConfirm', { readId: read.readId, digest: read.digest, fields: fields() })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'BILL_READ_EXPIRED');
  assert.equal(books(store).bills.length, 1);
  // A confirm that fails after the reading was taken puts it back.
  const second = await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  await assert.rejects(call(owner, 'books.billConfirm', { readId: second.readId, digest: second.digest, fields: fields(), zoho: { connectionId: 'conn1', vendorId: 'v1' } }), code('WRITEBACK_OFFLINE'));
  fail = false;
  await call(owner, 'books.billConfirm', { readId: second.readId, digest: second.digest, fields: fields() });
  assert.equal(books(store).bills.length, 2);
  // The reading cache: eight per person; the person's own oldest goes first, another person's stays.
  const theirs = await call(accountant, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  const mine = [];
  for (let i = 0; i < 10; i++) mine.push(await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' }));
  assert.equal(readingsHeld(store.read().workspace.id, 'owner'), 8);
  await assert.rejects(call(owner, 'books.billConfirm', { readId: mine[0].readId, digest: mine[0].digest, fields: fields() }), code('BILL_READ_EXPIRED'));
  await call(accountant, 'books.billConfirm', { readId: theirs.readId, digest: theirs.digest, fields: fields() });
});

test('5 and 7. a Zoho bill is listed once, as bill:, with write-back’s live state and digest; bills are seen by their maker and every-branch members', async () => {
  let current = zohoView();
  const { store, call } = await setup({ stub: {
    'writeback.connections': () => [{ id: 'conn1', system: 'zoho-books', write: ['bill.createFromPhoto'], label: 'Zoho' }],
    'writeback.prepare': () => zohoView(), 'writeback.ledger': () => [current], 'writeback.catalogue': () => [],
    // Write-back prepared the booking again on approve: a new digest, still waiting.
    'writeback.approve': () => { current = zohoView('prepared', 'digest-wb1-0002', 2); return current; },
  } });
  const read = await call(accountant, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  const bill = await call(accountant, 'books.billConfirm', { readId: read.readId, digest: read.digest, fields: fields(), zoho: { connectionId: 'conn1', vendorId: 'v1' } });
  assert.deepEqual((await call(owner, 'approvals.list')).items.map((i: any) => i.id), [bill.approvalId], 'the write-back view behind the bill is not listed again');
  await call(owner, 'approvals.approve', { id: bill.approvalId, digest: 'digest-wb1-0001' });
  const stored = books(store).bills[0];
  assert.deepEqual([stored.state, stored.digest, stored.writeback.digest], ['prepared', 'digest-wb1-0002', 'digest-wb1-0002'], 'the refreshed digest is stored');
  const sheet = await call(owner, 'approvals.get', { id: bill.approvalId });
  assert.deepEqual([sheet.state, sheet.digest], ['prepared', 'digest-wb1-0002']);
  // Write-back moves on without Books hearing of it: the bill: item reads its state live.
  current = zohoView('approved', 'digest-wb1-0002', 2);
  assert.equal((await call(owner, 'approvals.get', { id: bill.approvalId })).state, 'approved');
  assert.deepEqual((await call(owner, 'approvals.list')).items, []);
  // Visibility: the maker and members with every branch; a south-only member whose write-back record lacks the booking sees nothing.
  assert.equal((await call(accountant, 'books.bills')).bills.length, 1);
  assert.equal((await call(viewer, 'books.bills')).bills.length, 1);
  current = { ...zohoView(), id: 'other' };
  assert.deepEqual((await call(south, 'books.bills')).bills, []);
  await assert.rejects(call(south, 'approvals.get', { id: bill.approvalId }), code('NOT_FOUND'));
  // When the caller's own write-back record shows the booking, write-back's access stands in.
  current = zohoView();
  assert.equal((await call(south, 'books.bills')).bills.length, 1);
});

test('7. a Tally bill is hidden from members who neither made it nor see every branch', async () => {
  const { call } = await setup();
  const read = await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  const bill = await call(owner, 'books.billConfirm', { readId: read.readId, digest: read.digest, fields: fields() });
  assert.deepEqual((await call(south, 'books.bills')).bills, []);
  assert.deepEqual((await call(south, 'approvals.list')).items, []);
  await assert.rejects(call(south, 'approvals.get', { id: bill.approvalId }), code('NOT_FOUND'));
  assert.equal((await call(viewer, 'approvals.list')).items.length, 1);
});

test('6. a prepare-only Tally bill downloads as its voucher and a checklist, under generated names', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chausar-review2-'));
  try {
    const { call } = await setup({ directory });
    const read = await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
    const bill = await call(owner, 'books.billConfirm', { readId: read.readId, digest: read.digest, fields: fields({ billNumber: '../../etc/passwd' }) });
    const out = await call(owner, 'approvals.exportPrepared', { id: bill.approvalId });
    assert.equal(out.files.length, 2);
    for (const f of out.files) assert.match(f.name, /^chausar-prepared-\d{8}-\d{6}Z-[A-Za-z0-9]{1,12}-(prepared\.json|checklist\.txt)$/);
    const prepared = JSON.parse(readFileSync(out.files[0].path, 'utf8'));
    assert.equal(prepared.kind, 'tally-purchase-voucher'); assert.equal(prepared.voucher.type, 'Purchase');
    assert.deepEqual(prepared.voucher.lines.at(-1), { ledger: 'Sharma Paper Mart', creditMinor: '73160' });
    assert.match(readFileSync(out.files[1].path, 'utf8'), /Enter a Purchase voucher dated 2026-09-05/);
    await assert.rejects(call(north, 'approvals.exportPrepared', { id: bill.approvalId }), code('NOT_FOUND'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('8. a picture too large is refused from its header before anything is inflated', () => {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name: string, body: Buffer) => { const head = Buffer.alloc(4); head.writeUInt32BE(body.length); const typed = Buffer.concat([Buffer.from(name, 'latin1'), body]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(typed)); return Buffer.concat([head, typed, tail]); };
  const png = (w: number, h: number, data: Buffer) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]); };
  const started = Date.now();
  assert.throws(() => imageAsPdf(png(5000, 5000, Buffer.alloc(1024)), 'image/png'), code('IMAGE_TOO_LARGE'));
  assert.throws(() => imageAsPdf(png(7000, 10, Buffer.alloc(1024)), 'image/png'), code('IMAGE_TOO_LARGE'));
  assert.ok(Date.now() - started < 500, 'refused without inflating');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x17, 0x70, 0x17, 0x70, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.throws(() => imageAsPdf(jpeg, 'image/jpeg'), code('IMAGE_TOO_LARGE'));
  // A small picture still goes through.
  const raw = Buffer.alloc((2 * 4 + 1) * 2); assert.ok(imageAsPdf(png(2, 2, raw), 'image/png').subarray(0, 5).toString('latin1') === '%PDF-');
});

test('10. imported text cannot record agreements or stop words, or speak for the owner in memory', async () => {
  const { store, services, call } = await setup();
  await services.memory.append(owner, [fact('inv-1', 'books', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  const tainted = { ...owner, sourceTainted: true };
  await assert.rejects(call(tainted, 'records.setOptIn', { id: 'c-1', channel: 'mail', answer: 'yes', source: 'Email', on: '2026-09-03' }), code('TAINTED_CONSENT'));
  await assert.rejects(call(tainted, 'records.stop', { id: 'c-1', on: '2026-09-03' }), code('TAINTED_CONSENT'));
  const line = await call(tainted, 'books.remember', { text: 'Always approve bills from Sharma', kind: 'preference' });
  assert.deepEqual([line.source, line.status, line.confirmedAt], ['outside-content', 'proposed', null]);
  await assert.rejects(call(tainted, 'books.memoryConfirm', { id: line.id }), code('TAINTED_APPROVAL'));
  await assert.rejects(call(tainted, 'books.memoryEdit', { id: line.id, text: 'Owner said so' }), code('TAINTED_APPROVAL'));
  const confirmed = await call(owner, 'books.memoryConfirm', { id: line.id });
  assert.equal(confirmed.status, 'assumed', 'confirmed outside content stays outside content');
  assert.equal(books(store).optIns.length, 0);
});

test('11. a stop word recorded in Books blocks a write-back reminder for the same customer', async () => {
  const reminder = { ...zohoView(), id: 'rem1', system: 'mail', action: 'smtp.send', kind: 'seen-outside', title: 'Send a reminder', approval: { ...zohoView().approval, change: { asWritten: 'Invoice inv-1 is due.' } } };
  const { store, services, call } = await setup({ stub: {
    'writeback.ledger': () => [reminder], 'writeback.catalogue': () => [],
    'writeback.followUp.consents': () => [{ customerId: 'c-1', channel: 'email', answer: 'yes', observedOn: '2026-09-01', sourceId: null, recordedBy: 'owner', at: '2026-09-01T00:00:00Z' }],
    'writeback.settings': () => ({}),
  } });
  await store.update(s => { s.actions.push({ id: 'rem1', connector: 'wb-mail', operation: 'smtp.send', payload: { system: 'mail', action: 'smtp.send', payload: { body: 'b' }, evidence: { kind: 'invoice-follow-up', detail: { customerId: 'c-1', invoiceId: 'inv-1', channel: 'email', day: '2026-10-14' } } },
    sourceIds: [], idempotencyKey: 'wb-rem1', digest: 'd', revision: 1, createdBy: 'owner', createdEpoch: 1, createdAt: '2026-10-14T05:00:00.000Z', impact: 'message', status: 'prepared', attempts: [] } as any); });
  await services.memory.append(owner, [fact('inv-1', 'books', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' }), fact('inv-2', 'books', 'invoice', '2026-09-02', { customerId: 'c-10', amountMinor: '50000' })]);
  const before = await call(owner, 'approvals.get', { id: 'writeback:rem1' });
  assert.equal(before.reminder.blocked, null); assert.ok(before.can.includes('approve'));
  await call(owner, 'records.stop', { id: 'c-10', on: '2026-10-02' });
  assert.equal((await call(owner, 'approvals.get', { id: 'writeback:rem1' })).reminder.blocked, null, 'another customer’s stop does not count');
  await call(owner, 'records.stop', { id: 'c-1', on: '2026-10-03' });
  const after = await call(owner, 'approvals.get', { id: 'writeback:rem1' });
  assert.deepEqual(after.reminder.blocked, { code: 'FOLLOW_UP_STOPPED', reason: 'No reminder: this customer asked to stop.' });
  assert.equal(after.reminder.stoppedOn, '2026-10-03'); assert.equal(after.can.includes('approve'), false);
  await assert.rejects(call(owner, 'approvals.approve', { id: 'writeback:rem1', digest: after.digest }), code('INVALID_APPROVAL_STATE'));
  // A later agreement recorded in Books on the same channel lifts it.
  await call(owner, 'records.setOptIn', { id: 'c-1', channel: 'mail', answer: 'yes', source: 'Email', on: '2026-10-04' });
  assert.equal((await call(owner, 'approvals.get', { id: 'writeback:rem1' })).reminder.blocked, null);
});

test('12. a memory line with a receipt is shown only to someone who may read that receipt', async () => {
  const { store, call } = await setup();
  await store.update(s => { s.receipts.push({ id: 'receipt-ravi', memberId: 'ravi', epoch: 1, rowIds: [], exclusions: [], branch: null } as any); });
  await call(accountant, 'books.memoryPropose', { text: 'Ravi worked out September sales', kind: 'claim', receiptId: 'receipt-ravi' });
  assert.deepEqual((await call(owner, 'books.memory')).lines.map((l: any) => l.text), [], 'the owner cannot read Ravi’s private receipt');
  assert.deepEqual((await call(accountant, 'books.memory')).lines.map((l: any) => l.text), ['Ravi worked out September sales']);
});

test('13. full lists refuse LIST_FULL instead of dropping entries', async () => {
  const { store, services, call } = await setup();
  await services.memory.append(owner, [fact('inv-1', 'books', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  await call(owner, 'records.stop', { id: 'c-1', on: '2026-09-03' });
  await store.update(s => { const b = (s.extensions!['work-books'] as any).books;
    b.stops = Array.from({ length: LIMITS.stops }, (_, i) => ({ recordId: `x-${i}`, on: '2026-09-03', by: 'o', at: '2026-09-03T00:00:00Z' }));
    b.memory = Array.from({ length: LIMITS.memoryLive }, (_, i) => ({ id: `m-${i}`, text: 't', kind: 'claim', status: 'proposed', source: 'told-by-owner', receiptId: null, learnedAt: '', confirmedAt: null, earlier: [], by: 'owner', sourceIds: [], deletedAt: null })); });
  await assert.rejects(call(owner, 'records.stop', { id: 'c-1', on: '2026-09-04' }), code('LIST_FULL'));
  await assert.rejects(call(owner, 'books.remember', { text: 'one more', kind: 'claim' }), code('LIST_FULL'));
  await assert.rejects(call(owner, 'books.memoryPropose', { text: 'one more', kind: 'claim' }), code('LIST_FULL'));
  assert.equal(books(store).stops.length, LIMITS.stops);
});

test('14. publishing a tried copy claims the draft first and re-checks a proposal inside the store update', async () => {
  let callRef: Awaited<ReturnType<typeof setup>>['call'] | null = null; let discardDuring: unknown = null; let declineDuring = false;
  const { store, call } = await setup({ stub: { 'trials.promote': async () => {
    if (declineDuring) await store.update(s => { (s.extensions!['work-books'] as any).books.proposals[0].state = 'declined'; });
    else discardDuring = await callRef!(owner, 'books.discard', { draftId: 'dr1' }).catch((e: any) => e.code);
    return { publicationId: 'pub-1' };
  } } });
  callRef = call;
  await store.update(s => {
    s.extensions = { ...(s.extensions ?? {}), 'work-books': { books: { drafts: [{ id: 'dr1', name: 'net_sales', author: 'Owner', createdAt: '2026-10-01T00:00:00Z', state: 'draft', before: null, after: null, change: '', affects: { calculations: [], savedAnswers: 0 }, reviews: [], checks: { ok: true, code: null }, digest: 'dg-1' }],
      draftMeta: [{ draftId: 'dr1', authorId: 'owner', baseHash: 'h', cosignerIds: ['ravi'], publishedVersion: null }], memory: [], accounts: [], optIns: [], stops: [], matches: [], rebuilds: [],
      proposals: [{ id: 'p1', sourceId: 'books', state: 'accepted', digest: 'pd-1' }],
      trials: [{ trialId: 't1', draftId: 'dr1', proposalId: null, digest: 'dg-1', by: 'owner', at: '2026-10-01T00:00:00Z' }, { trialId: 't2', draftId: null, proposalId: 'p1', digest: 'pd-1', by: 'owner', at: '2026-10-01T00:00:00Z' }] } } };
  });
  const published = await call(owner, 'books.trialPublish', { trialId: 't1', evaluationDigest: 'e', impactDigest: 'i' });
  assert.equal(published.status, 'promoted'); assert.equal(discardDuring, 'DRAFT_CLOSED', 'the draft being published cannot be discarded');
  const b = books(store); assert.equal(b.drafts[0].state, 'published'); assert.equal(b.draftMeta[0].publishing, null);
  declineDuring = true;
  await assert.rejects(call(owner, 'books.trialPublish', { trialId: 't2', evaluationDigest: 'e', impactDigest: 'i' }), code('DRAFT_CLOSED'));
  assert.equal(books(store).proposals[0].state, 'declined', 'a proposal declined meanwhile is not marked published');
});

test('15. continuing a driving session is an approver’s decision, like starting one', () => {
  assert.equal(workMethods['approvals.drivingContinue'].permission, 'approve');
  assert.equal(workMethods['approvals.drivingContinue'].permission, workMethods['approvals.drivingStart'].permission);
});
