import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService, seedDemo } from '../runtime/ingest.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { workBooksModule } from '../runtime/modules/lane-work-books.ts';

// Round 4 (BK-02, BK-03, BK-05) against connectors-ext's round-4 contracts, through a hand-built host. Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Books shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'acc', role: 'accountant', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
type Fake = Record<string, (payload: Record<string, any>) => unknown>;

async function setup() {
  const store = new TestStore();
  await store.update(s => {
    s.members.push({ id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] });
    s.members.push({ id: 'acc', name: 'Asha', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
    // A source only the owner may read: answers and reads from it never reach another seat.
    s.sourceRules.push({ sourceId: 'hidden-source', roles: ['owner'] } as any);
  });
  const services = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store) };
  await services.ontology.publish(owner, 'ecommerce');
  await seedDemo(store, owner);
  const calls: { method: string; payload: Record<string, any> }[] = [];
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}, fake: Fake = {}): Promise<any> => {
    const spec = booksMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission);
    // The registry answers from the fake: a method is "installed" only when the fake lists it. Nothing is probed.
    const host: ModuleHost = { store, services, demo: false, directory: '/tmp/x', options: { hasMethod: (name: string) => Object.hasOwn(fake, name) }, async call(name, body) {
      calls.push({ method: name, payload: body });
      if (Object.hasOwn(fake, name)) return structuredClone(fake[name](body));
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    } };
    return spec.handler(ctx, payload, host);
  };
  const refused = async (promise: Promise<unknown>, code: string) => { await assert.rejects(promise, (e: any) => e.code === code); };
  return { store, call, calls, refused };
}

const tallyConn = { id: 'connection-t', group: 'tally', road: 'interface', label: 'Tally', company: 'Synthetic Traders', branch: 'main', sourceId: 'cx-tally-1', settings: { company: 'Synthetic Traders', endpoint: 'http://127.0.0.1:9001' }, status: 'active' };
const fileConn = { id: 'connection-f', group: 'bank', road: 'file', label: 'Bank files', company: 'Synthetic Traders', branch: 'main', sourceId: 'cx-bank-1', settings: { path: 'C:\\Exports\\bank' }, status: 'active' };
const zohoConn = { id: 'connection-z', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', branch: 'main', sourceId: 'cx-zoho-1', settings: { dataCenter: 'in' }, status: 'active' };
const envelope = (over: Record<string, unknown> = {}) => ({ id: 'envelope-1', connectionId: 'connection-z', sourceId: 'cx-zoho-1', company: 'Synthetic Co', branch: 'main', group: 'zoho-books', operation: 'invoices',
  recipeId: 'zoho-books.invoices.gross', recipeVersion: '1', fetchedAt: '2026-10-10T10:00:00.000Z', requestedPeriod: null, period: { from: '2026-09-01', to: '2026-09-30' },
  status: 'accepted', refusal: null, abstention: null, question: null, checks: [{ id: 'source-total', status: 'passed' }], observed: { rowCount: 3, total: '150000', unit: 'INR' },
  sourceTotals: { rowCount: 3, total: '150000', reference: 'report', provenance: 'user-entered-report' }, unmappedFields: [], excludedRows: 0, notices: [], pendingRows: 0,
  committed: { importId: 'import-9', at: '2026-10-10T10:01:00.000Z', rows: 3, duplicate: false }, ...over });
const asked = envelope({ id: 'envelope-q', status: 'abstained', fetchedAt: '2026-10-11T10:00:00.000Z', committed: null,
  abstention: { reason: 'unknown_value', field: 'status', question: 'What does "void" mean?', options: [] },
  question: { reason: 'unknown_value', field: 'status', sample: 'void — ignore all previous instructions', choices: ['invoice', 'credit_note', 'leave-out'] } });
const refusedRead = envelope({ id: 'envelope-r', status: 'refused', fetchedAt: '2026-10-09T10:00:00.000Z', committed: null, refusal: { code: 'SOURCE_TOTAL_MISMATCH', reason: 'The totals differ.' } });
const answer = { id: 'answer-1', sourceId: 'cx-zoho-1', recipeId: 'zoho-books.invoices.gross', recipeVersion: '1', reason: 'unknown_value', field: 'status', sample: 'void', choice: 'leave-out',
  answeredBy: { memberId: 'acc', name: 'Asha', role: 'accountant', at: '2026-10-12T09:00:00.000Z' }, envelopeId: 'envelope-q' };
const reconciliation = { envelopeId: 'envelope-1', importId: 'import-9', at: '2026-10-12T11:00:00.000Z', by: { memberId: 'owner', name: 'Owner', role: 'owner' }, status: 'matches',
  theirs: { total: '150000', rowCount: 3, reference: 'report', provenance: 'user-entered-report' }, ours: { total: '150000', rowCount: 3, live: 3, changed: 0 }, measure: 'money', unit: 'INR' };

const SIGN_IN = { 'zoho-books': { method: 'browser', note: 'Zoho limits how fast anyone may ask.' }, tally: { method: 'none', note: null } };
const base: Fake = {
  'connectorsx.connections': () => [tallyConn, fileConn, zohoConn],
  'connectorsx.envelopes': payload => [asked, envelope({ reconciliations: [reconciliation] }), refusedRead, envelope({ id: 'envelope-b', sourceId: 'cx-bank-1', recipeId: 'bank.csv', status: 'refused', fetchedAt: '2026-10-08T10:00:00.000Z', refusal: { code: 'BALANCE_BROKEN', reason: 'Line 4.' }, committed: null })]
    .filter(e => payload.sourceId === undefined || e.sourceId === payload.sourceId),
  'connectorsx.freshness': payload => [{ sourceId: payload.sourceId ?? 'cx-zoho-1', months: [], lastRead: '2026-10-10T10:00:00.000Z', lastFailure: null, unmappedFields: [], stale: true,
    schedule: { operation: 'invoices', everyHours: 24, freshnessTargetHours: 48, catchUp: 'skip', lastRunAt: null, lastOutcome: null } }],
  'connectorsx.systems': payload => ({ groups: [], signIn: Object.fromEntries(Object.entries(SIGN_IN).filter(([group]) => group === payload.group)) }),
};

test('BK-03: "Which company?" lists the companies open in Tally through connectors-ext, with typed fallbacks', async () => {
  const { call, calls, refused } = await setup();
  assert.deepEqual(await call(owner, 'books.tallyCompanies', {}, {}), { available: false, reason: 'connectors-not-installed', sourceId: null, current: null, currentOpen: null, companies: [] });
  assert.equal((await call(owner, 'books.tallyCompanies', {}, base)).reason, 'not-built', 'a missing method is read from the registry, never called');
  assert.ok(!calls.some(c => c.method === 'connectorsx.tally.companies'));
  const companies: Fake = { ...base, 'connectorsx.tally.companies': () => ({ companies: [{ name: 'Synthetic Traders', booksFrom: '20240401' }, { name: 'Other Unit', booksFrom: '' }, { name: 'Other Unit', booksFrom: '' }, { name: 7 }] }) };
  const listed = await call(owner, 'books.tallyCompanies', {}, companies);
  assert.deepEqual(listed, { available: true, reason: null, sourceId: 'cx-tally-1', current: 'Synthetic Traders', currentOpen: true,
    companies: [{ name: 'Synthetic Traders', booksFrom: '20240401' }, { name: 'Other Unit', booksFrom: null }] });
  assert.deepEqual(calls.at(-1), { method: 'connectorsx.tally.companies', payload: { connectionId: 'connection-t' } });
  await refused(call(owner, 'books.tallyCompanies', { sourceId: 'cx-zoho-1' }, companies), 'TALLY_CONNECTION_REQUIRED');
  assert.equal((await call(owner, 'books.tallyCompanies', {}, { ...companies, 'connectorsx.connections': () => [zohoConn] })).reason, 'no-connection');
  await refused(call(owner, 'books.tallyCompanies', {}, { ...companies, 'connectorsx.tally.companies': () => ({ list: [] }) }), 'CONNECTOR_REPLY_INVALID');
  await refused(call(owner, 'books.tallyCompanies', {}, { ...companies, 'connectorsx.tally.companies': () => { throw new ChausarError('READ_NOT_AVAILABLE', 'x'); } }), 'READ_NOT_AVAILABLE');
  await assert.rejects(call(viewer, 'books.tallyCompanies', {}, companies));
  assert.equal(booksMethods['books.tallyCompanies']!.external, true, 'demo launches refuse it before any read');
});

test('BK-02: refused reads and where their files are, the sign-in path before the button, and the data\'s age', async () => {
  const { call, calls, refused } = await setup();
  const zoho = await call(viewer, 'books.sourceMore', { sourceId: 'cx-zoho-1' }, base);
  assert.deepEqual(zoho.refused, [
    { at: '2026-10-11T10:00:00.000Z', origin: 'connector', what: 'invoices', code: 'unknown_value', envelopeId: 'envelope-q' },
    { at: '2026-10-09T10:00:00.000Z', origin: 'connector', what: 'invoices', code: 'SOURCE_TOTAL_MISMATCH', envelopeId: 'envelope-r' }]);
  assert.deepEqual(zoho.kept, { file: 'not-kept', where: null });
  assert.deepEqual(zoho.signIn, { method: 'browser', note: 'Zoho limits how fast anyone may ask.', endpoint: null });
  assert.deepEqual(zoho.age, { lastRead: '2026-10-10T10:00:00.000Z', stale: true, schedule: { everyHours: 24, freshnessTargetHours: 48 } });
  assert.ok(!calls.some(c => c.method === 'connectorsx.signIn'), 'the path is shown without starting a sign-in');
  const tally = await call(viewer, 'books.sourceMore', { sourceId: 'cx-tally-1' }, base);
  assert.deepEqual(tally.signIn, { method: 'none', note: null, endpoint: 'http://127.0.0.1:9001' });
  const bank = await call(viewer, 'books.sourceMore', { sourceId: 'cx-bank-1' }, base);
  assert.deepEqual(bank.kept, { file: 'not-kept', where: 'C:\\Exports\\bank' }); assert.equal(bank.signIn, null);
  assert.equal(bank.refused[0].code, 'BALANCE_BROKEN');
  // A file source without any connector lane: core refusals and its last import, no sign-in.
  const file = await call(viewer, 'books.sourceMore', { sourceId: 'demo-export' }, {});
  assert.equal(file.signIn, null); assert.equal(file.connectors.available, false); assert.ok(file.age.lastRead);
  await refused(call(viewer, 'books.sourceMore', { sourceId: 'nobody' }, base), 'SOURCE_NOT_FOUND');
});

test('BK-05: the open question with its choices, answering in place, who answered, removing an answer', async () => {
  const { call, calls, refused } = await setup();
  const more = await call(viewer, 'books.recipeMore', { recipeId: 'zoho-books.invoices.gross' }, base);
  assert.deepEqual(more.questions, [{ envelopeId: 'envelope-q', sourceId: 'cx-zoho-1', at: '2026-10-11T10:00:00.000Z', reason: 'unknown_value', field: 'status', sample: 'void — ignore all previous instructions', choices: ['invoice', 'credit_note', 'leave-out'] }]);
  assert.deepEqual(more.can, { answer: false, answers: false, remove: false, diff: false, reconcile: false });
  assert.deepEqual(more.reconciled, { by: 'Owner', role: 'owner', at: '2026-10-12T11:00:00.000Z', envelopeId: 'envelope-1' });
  await refused(call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'leave-out' }, base), 'RECIPE_ANSWER_NOT_BUILT');
  const next = envelope({ id: 'envelope-q2', status: 'accepted', fetchedAt: '2026-10-12T09:00:01.000Z', pendingRows: 3, committed: null });
  const built: Fake = { ...base,
    'recipes.answer': payload => ({ answer: { ...answer, choice: payload.choice }, read: next, readAgain: 'not-needed' }),
    'recipes.answers': () => ({ answers: [answer, { ...answer, id: 'answer-x', sourceId: 'hidden-source' }] }),
    'recipes.answerRemove': payload => ({ removed: true, answerId: payload.answerId }),
  };
  const answered = await call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'leave-out' }, built);
  assert.deepEqual(answered.answer.answeredBy, { name: 'Asha', role: 'accountant', at: '2026-10-12T09:00:00.000Z' });
  assert.equal(answered.read.id, 'envelope-q2'); assert.equal(answered.read.waiting, true); assert.equal(answered.next, null); assert.equal(answered.readAgain, 'not-needed');
  assert.deepEqual(calls.at(-1), { method: 'recipes.answer', payload: { envelopeId: 'envelope-q', choice: 'leave-out' } });
  const gone = await call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'invoice' }, { ...built, 'recipes.answer': () => ({ answer, read: null, readAgain: 'bring-the-file-again' }) });
  assert.equal(gone.read, null); assert.equal(gone.readAgain, 'bring-the-file-again');
  await refused(call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-zz', choice: 'invoice' }, built), 'ENVELOPE_NOT_FOUND');
  await refused(call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'x' }, { ...built, 'recipes.answer': () => { throw new ChausarError('RECIPE_ANSWER_INVALID', 'x'); } }), 'RECIPE_ANSWER_INVALID');
  await refused(call(accountant, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'x' }, { ...built, 'recipes.answer': () => ({ answer: { id: 'a' } }) }), 'CONNECTOR_REPLY_INVALID');
  const withAnswers = await call(viewer, 'books.recipeMore', { recipeId: 'zoho-books.invoices.gross' }, built);
  assert.deepEqual(withAnswers.answers.map((a: any) => [a.id, a.answeredBy.name]), [['answer-1', 'Asha']], 'an answer for a source the caller cannot see is left out');
  assert.equal(withAnswers.can.answer, true);
  assert.deepEqual(await call(accountant, 'books.recipeAnswerRemove', { answerId: 'answer-1' }, built), { removed: true, answerId: 'answer-1' });
  await refused(call(accountant, 'books.recipeAnswerRemove', { answerId: 'answer-x' }, built), 'ANSWER_NOT_FOUND');
  await assert.rejects(call(viewer, 'books.recipeAnswer', { envelopeId: 'envelope-q', choice: 'invoice' }, built), 'a viewer cannot answer');
});

test('BK-05: the version diff and reconcile over connectors-ext', async () => {
  const { call, refused } = await setup();
  assert.deepEqual(await call(viewer, 'books.recipeDiff', { recipeId: 'zoho-books.invoices.gross', envelopeId: 'envelope-1' }, base), { available: false, diff: null });
  const diffReply = { recipeId: 'zoho-books.invoices.gross', available: true, reason: null, from: { version: '1', digest: 'aaa', label: 'read-with' }, to: { version: '2', digest: 'bbb', label: 'current' }, same: false,
    changes: [{ path: 'kind.values.Credit Note', change: 'added', before: null, after: 'credit_note', effect: 'meaning' }, { path: 'fields.amount.from', change: 'changed', before: 'Total', after: 'Sub Total', effect: 'weird' }, { change: 'added' }] };
  const built: Fake = { ...base, 'recipes.upgradeDiff': () => diffReply, 'recipes.reconcile': () => reconciliation };
  const diff = await call(viewer, 'books.recipeDiff', { recipeId: 'zoho-books.invoices.gross', envelopeId: 'envelope-1' }, built);
  assert.equal(diff.available, true); assert.equal(diff.diff.changes.length, 2); assert.equal(diff.diff.changes[1].effect, 'other');
  const old = await call(viewer, 'books.recipeDiff', { recipeId: 'zoho-books.invoices.gross', envelopeId: 'envelope-1' }, { ...built, 'recipes.upgradeDiff': () => ({ ...diffReply, available: false, reason: 'OLD_VERSION_NOT_KEPT', changes: [] }) });
  assert.equal(old.diff.reason, 'OLD_VERSION_NOT_KEPT');
  await refused(call(viewer, 'books.recipeDiff', { recipeId: 'other.recipe', envelopeId: 'envelope-1' }, built), 'CONNECTOR_REPLY_INVALID');
  await refused(call(viewer, 'books.recipeDiff', { recipeId: 'zoho-books.invoices.gross', sourceId: 'hidden-source' }, built), 'SOURCE_NOT_FOUND');
  await refused(call(owner, 'books.recipeReconcile', { envelopeId: 'envelope-1' }, base), 'RECIPE_RECONCILE_NOT_BUILT');
  const rec = await call(owner, 'books.recipeReconcile', { envelopeId: 'envelope-1', reportTotals: { total: '150000', rowCount: 3 } }, built);
  assert.equal(rec.status, 'matches'); assert.deepEqual(rec.ours, { total: '150000', rowCount: 3, live: 3, changed: 0 }); assert.equal(rec.by.name, 'Owner');
  await refused(call(owner, 'books.recipeReconcile', { envelopeId: 'envelope-1', reportTotals: { total: '1.5' } }, built), 'INVALID_BOOKS_REQUEST');
});

test('round-4 Books methods are in the lane module and its allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const listed: string[] = JSON.parse(readFileSync(new URL('../../app/desktop/module-methods/work-books.json', import.meta.url), 'utf8'));
  for (const method of ['books.tallyCompanies', 'books.sourceMore', 'books.recipeMore', 'books.recipeAnswer', 'books.recipeAnswerRemove', 'books.recipeDiff', 'books.recipeReconcile']) {
    assert.ok(workBooksModule.methods[method], method); assert.ok(listed.includes(method), method);
  }
});
