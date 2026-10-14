import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService, seedDemo } from '../runtime/ingest.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods, booksPurge } from '../runtime/work-books/books.ts';
import { peekR2 } from '../runtime/work-books/books-recipes.ts';

// A hand-built host with a fake connectorsx / learningx / trials dispatcher. Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Books shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
type Fake = Record<string, (payload: Record<string, any>) => unknown>;
const refuse = (code: string) => () => { throw new ChausarError(code, 'Refused.'); };

async function setup() {
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const services = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store) };
  await services.ontology.publish(owner, 'ecommerce');
  await seedDemo(store, owner);
  const calls: { method: string; payload: Record<string, any> }[] = [];
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}, fake: Fake = {}): Promise<any> => {
    const spec = booksMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission);
    const host: ModuleHost = { store, services, demo: false, directory: '/tmp/x', options: {}, async call(name, body) {
      calls.push({ method: name, payload: body });
      if (Object.hasOwn(fake, name)) return structuredClone(fake[name](body));
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    } };
    return spec.handler(ctx, payload, host);
  };
  return { store, call, calls };
}

const connection = { id: 'connection-1', group: 'zoho-books', road: 'interface', label: 'Zoho Books', company: 'Synthetic Co', branch: 'main', sourceId: 'cx-zoho-1', settings: { dataCenter: 'in' }, status: 'active', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'owner' };
const envelope = (over: Record<string, unknown> = {}) => ({ id: 'envelope-1', connectionId: 'connection-1', sourceId: 'cx-zoho-1', company: 'Synthetic Co', branch: 'main', group: 'zoho-books', operation: 'invoices',
  recipeId: 'zoho-books.invoices.gross', recipeVersion: '1', fetchedAt: '2026-10-10T10:00:00.000Z', requestedPeriod: { from: '2026-09-01', to: '2026-09-30' }, period: { from: '2026-09-01', to: '2026-09-30' },
  status: 'accepted', refusal: null, abstention: null, checks: [{ id: 'source-total', status: 'passed', expected: '150000', observed: '150000' }], observed: { rowCount: 3, total: '150000', unit: 'INR' },
  sourceTotals: { rowCount: 3, total: '150000', reference: 'report', provenance: 'user-entered-report' }, unmappedFields: ['cf_region'], excludedRows: 0, notices: [], pendingRows: 3, committed: null, ...over });
const months = (failed: string) => Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 10 + i, 1)); const month = d.toISOString().slice(0, 7); return { month, status: month === failed ? 'failed' : 'not-loaded-yet' }; });
const connectors: Fake = {
  'connectorsx.connections': () => [connection, { ...connection, id: 'bad', sourceId: 7 }],
  'connectorsx.envelopes': payload => payload.sourceId && payload.sourceId !== 'cx-zoho-1' ? [] : [envelope(), envelope({ id: 'envelope-0', status: 'abstained', pendingRows: 0, fetchedAt: '2026-10-09T10:00:00.000Z',
    abstention: { reason: 'unknown_value', field: 'status', question: 'What does "void" mean?', options: ['cancelled', 'ignore'] }, period: { from: '2026-08-01', to: '2026-08-31' } })],
  'connectorsx.freshness': () => [{ sourceId: 'cx-zoho-1', months: months('2026-07'), lastRead: '2026-10-10T10:00:00.000Z', lastFailure: { at: '2026-07-31T00:00:00.000Z', status: 'failed', code: 'SOURCE_NETWORK_FAILED' }, unmappedFields: ['cf_region'], stale: true }],
  'connectorsx.unmapped': () => ({ count: 1, fields: [{ group: 'zoho-books', recipeId: 'zoho-books.invoices.gross', field: 'cf_region', seen: 1, lastSeen: '2026-10-10T10:00:00.000Z' }] }),
  'connectorsx.systems': () => ({ asOf: '2026-10-14T00:00:00.000Z', groups: [{ id: 'zoho-books', name: 'Zoho Books', family: 'accounting', depth: 'read', liveVerified: false, operations: [
    { id: 'invoices', label: 'Invoices (gross)', depth: 'read', road: 'interface', status: 'tested', tier: 'experimental', limitation: 'Report total.', evidence: { synthetic: 4, madeToOrder: 0, realWithConsent: 0 } },
    { id: 'write', label: 'Write', depth: 'full', road: 'interface', status: 'planned', tier: 'planned', limitation: 'Not installed.', evidence: { synthetic: 0, madeToOrder: 0, realWithConsent: 0 } }] },
    { id: 'gst-provider', name: 'GST provider', family: 'tax', depth: null, operations: [{ id: 'none', label: 'No road in yet', depth: 'import', road: 'file', status: 'planned', tier: 'planned', limitation: 'Needs a licensed partner.' }] }],
    signIn: { 'zoho-books': { method: 'browser', note: 'Zoho limits how fast anyone may ask.' } } }),
};

test('sources merge connections, freshness and reads: failed and loading months, unmapped connector fields, the source sheet', async () => {
  const { call } = await setup();
  const sources = await call(viewer, 'books.sources', { endMonth: '2026-10' }, connectors);
  assert.deepEqual(sources.freshness, { available: true });
  const row = sources.rows.find((r: any) => r.sourceId === 'cx-zoho-1');
  assert.equal(row.system, 'Zoho Books'); assert.equal(row.way, 'signed-in'); assert.equal(row.connected, true); assert.equal(row.scope, 'Synthetic Co');
  const at = (m: string) => row.months.find((x: any) => x.month === m).state;
  assert.equal(at('2026-07'), 'failed'); assert.equal(at('2026-09'), 'loading'); assert.equal(at('2026-08'), 'not-loaded-yet');
  assert.equal(row.refused, 1); assert.equal(row.unmapped, 1); assert.equal(row.stale, true); assert.deepEqual(row.lastFailure, { at: '2026-07-31T00:00:00.000Z', code: 'SOURCE_NETWORK_FAILED' });
  assert.ok(sources.rows.some((r: any) => r.sourceId === 'demo-export' && r.connection === undefined), 'a file source keeps its round-1 shape');
  assert.equal(sources.unmappedFields, 1);
  const unmapped = await call(viewer, 'books.unmapped', {}, connectors);
  assert.deepEqual(unmapped.fields, [{ field: 'cf_region', sourceIds: ['cx-zoho-1'], type: 'unknown', filled: null, origin: 'connector', recipeId: 'zoho-books.invoices.gross', mappable: false }]);
  const one = await call(viewer, 'books.source', { sourceId: 'cx-zoho-1' }, connectors);
  assert.equal(one.connection.connectionId, 'connection-1'); assert.deepEqual(one.connection.operations.map((o: any) => o.id), ['invoices']);
  assert.deepEqual(one.envelopes.map((e: any) => [e.id, e.status, e.waiting]), [['envelope-1', 'accepted', true], ['envelope-0', 'abstained', false]]);
  assert.deepEqual(one.envelopes[0].total, { measure: 'money', unit: 'INR', ours: '150000', theirs: '150000', match: 'yes' });
  assert.equal(one.envelopes[1].abstention.question, 'What does "void" mean?');
});

test('a build without the connector lane: readers answer available false, changers refuse with a typed code', async () => {
  const { call } = await setup();
  const sources = await call(owner, 'books.sources', { endMonth: '2026-09' });
  assert.deepEqual(sources.freshness, { available: false }); assert.ok(sources.rows.every((r: any) => r.connection === undefined));
  assert.deepEqual(await call(owner, 'books.systems'), { available: false, systems: [] });
  assert.equal((await call(owner, 'books.recipes')).available, false);
  await assert.rejects(call(owner, 'books.readNow', { sourceId: 'demo-export', operation: 'invoices' }), { code: 'CONNECTORS_NOT_INSTALLED' });
  await assert.rejects(call(owner, 'books.connect', { group: 'tally', road: 'interface', company: 'X' }), { code: 'CONNECTORS_NOT_INSTALLED' });
});

test('read now, import, pause, sign in again and remove go to the connection; refusals pass through unchanged', async () => {
  const { call, calls } = await setup();
  const fake: Fake = { ...connectors, 'connectorsx.read': () => envelope({ id: 'envelope-2' }), 'connectorsx.importCommit': () => envelope({ id: 'envelope-1', pendingRows: 0, committed: { importId: 'i', at: '2026-10-10T11:00:00.000Z', rows: 3, duplicate: false } }),
    'connectorsx.pause': body => ({ ...connection, status: body.paused ? 'paused' : 'active' }), 'connectorsx.disconnect': () => ({ removed: true, factsKept: true }),
    'connectorsx.signIn': () => ({ method: 'browser', authorizeUrl: 'https://accounts.zoho.in/oauth/v2/auth?client_id=abc', scopes: ['x'], expiresInSeconds: 600, note: 'Zoho note.' }) };
  const read = await call(owner, 'books.readNow', { sourceId: 'cx-zoho-1', operation: 'invoices', period: { from: '2026-09-01', to: '2026-09-30' }, reportTotals: { total: '150000' } }, fake);
  assert.equal(read.id, 'envelope-2');
  assert.deepEqual(calls.find(c => c.method === 'connectorsx.read')!.payload, { connectionId: 'connection-1', operation: 'invoices', period: { from: '2026-09-01', to: '2026-09-30' }, reportTotals: { total: '150000' } });
  assert.deepEqual((await call(owner, 'books.importRead', { envelopeId: 'envelope-1' }, fake)).committed, { at: '2026-10-10T11:00:00.000Z', rows: 3, duplicate: false });
  await assert.rejects(call(owner, 'books.importRead', { envelopeId: 'someone-elses' }, fake), { code: 'ENVELOPE_NOT_FOUND' });
  assert.equal((await call(owner, 'books.pause', { sourceId: 'cx-zoho-1', paused: true }, fake)).status, 'paused');
  const signIn = await call(owner, 'books.signIn', { sourceId: 'cx-zoho-1' }, fake);
  assert.deepEqual([signIn.method, signIn.url, signIn.note], ['browser', 'https://accounts.zoho.in/oauth/v2/auth?client_id=abc', 'Zoho note.']);
  await assert.rejects(call(owner, 'books.signIn', { sourceId: 'cx-zoho-1' }, { ...fake, 'connectorsx.signIn': () => ({ method: 'browser', authorizeUrl: 'javascript:alert(1)' }) }), { code: 'CONNECTOR_REPLY_INVALID' });
  await assert.rejects(call(owner, 'books.readNow', { sourceId: 'cx-zoho-1', operation: 'invoices' }, { ...fake, 'connectorsx.read': refuse('DEMO_EXTERNAL_DISABLED') }), { code: 'DEMO_EXTERNAL_DISABLED' });
  await assert.rejects(call(owner, 'books.readNow', { sourceId: 'demo-export', operation: 'invoices' }, fake), { code: 'CONNECTION_REQUIRED' });
  assert.deepEqual(await call(owner, 'books.disconnect', { sourceId: 'cx-zoho-1' }, fake), { sourceId: 'cx-zoho-1', removed: true, factsKept: false });
});

test('systems: depth, status, evidence and the way in per system; a partner-only system is planned', async () => {
  const { call } = await setup();
  const { systems } = await call(viewer, 'books.systems', {}, connectors);
  const zoho = systems.find((s: any) => s.id === 'zoho-books');
  assert.deepEqual([zoho.depth, zoho.status, zoho.tier, zoho.available, zoho.ways, zoho.signIn.method, zoho.settings], ['read', 'tested', 'experimental', true, ['interface'], 'browser', ['dataCenter', 'organizationId']]);
  assert.deepEqual(zoho.evidence, { synthetic: 4, madeToOrder: 0, realWithConsent: 0 });
  const gst = systems.find((s: any) => s.id === 'gst-provider');
  assert.deepEqual([gst.available, gst.status, gst.tier], [false, 'planned', 'planned']);
});

test('recipes: state from reads, the two totals, questions with one of the five reasons, a newer version', async () => {
  const { call } = await setup();
  const fake: Fake = { ...connectors, 'connectorsx.recipes': () => [{ id: 'zoho-books.invoices.gross', version: '2', group: 'zoho-books', operation: 'invoices', title: 'Zoho invoices', input: 'records', totals: 'report', measure: 'money', sensitivity: 'financial', notices: ['Gross only.'],
    fields: [{ name: 'amount', type: 'money', required: true, headings: ['total'] }] }, { id: 'tally.sales-register', version: '1', group: 'tally', operation: 'sales', title: 'Tally sales', totals: 'declared', measure: 'money', fields: [] }] };
  const list = await call(viewer, 'books.recipes', {}, fake);
  assert.deepEqual(list.recipes.map((r: any) => [r.id, r.state]), [['zoho-books.invoices.gross', 'tested'], ['tally.sales-register', 'seed']]);
  const one = await call(viewer, 'books.recipe', { recipeId: 'zoho-books.invoices.gross' }, fake);
  assert.deepEqual(one.scope, { system: 'zoho-books', company: 'Synthetic Co', branch: 'main', gstin: null, period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.deepEqual(one.bindings, [{ meaning: 'amount', headings: ['total'], type: 'money', required: true, state: 'seed', acceptedBy: null, grade: 'reconciled' }]);
  assert.deepEqual([one.check.ours, one.check.theirs, one.check.match], ['150000', '150000', 'yes']);
  assert.deepEqual(one.questions.map((q: any) => [q.reason, q.detail, q.choices]), [['value-not-in-list', 'unknown_value', ['cancelled', 'ignore']]]);
  assert.deepEqual(one.newer, { readWith: '1', current: '2' });
  await assert.rejects(call(viewer, 'books.recipe', { recipeId: 'nope' }, fake), { code: 'RECIPE_NOT_FOUND' });
});

test('map this field: a grammar-checked proposal stays proposed until a named person accepts; a viewer cannot; purge removes it', async () => {
  const { call, store } = await setup();
  const csv = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch,channel\nx-1,sale,2026-07-03,10.00,INR,c,x-1,o,,delivered,One,main,shop\n';
  const { demoRecipe } = await import('../runtime/ingest.ts');
  await new ImportService(store).commit(owner, { sourceId: 'sheet', format: 'csv', content: csv, recipe: { ...structuredClone(demoRecipe), onUnmapped: 'report' }, expectedTotals: { rowCount: 1, amountMinor: '1000' } });
  let proposeBody: any = null;
  const fake: Fake = { 'learningx.recipePropose': body => { proposeBody = body; return { valid: true, recipe: body.candidate, issues: [], removed: [], missingTargets: [], basedOn: null, unmappedFields: [], digest: 'd1', decisionId: 'x', origin: 'model' }; },
    'learningx.recipeSave': () => ({ id: 'saved-1' }) };
  await assert.rejects(call(owner, 'books.mapField', { sourceId: 'sheet', field: 'amount', target: 'note', type: 'string' }, fake), { code: 'FIELD_NOT_UNMAPPED' });
  const proposal = await call(owner, 'books.mapField', { sourceId: 'sheet', field: 'channel', target: 'channel', type: 'string' }, fake);
  assert.ok(proposeBody.fields.includes('channel')); assert.deepEqual(proposeBody.sourceIds, ['sheet']);
  assert.equal(proposal.state, 'proposed'); assert.equal(proposal.fieldBound, true);
  assert.deepEqual(proposal.bindings.find((b: any) => b.source === 'channel'), { target: 'channel', source: 'channel', type: 'string', state: 'proposed', acceptedBy: null, grade: null, change: 'new' });
  await assert.rejects(call(viewer, 'books.decideProposal', { id: proposal.id, decision: 'accept', digest: 'd1' }, fake), { code: 'FORBIDDEN' });
  const accepted = await call(owner, 'books.decideProposal', { id: proposal.id, decision: 'accept', digest: 'd1' }, fake);
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.libraryId, 'saved-1');
  assert.equal(accepted.bindings.find((b: any) => b.source === 'channel').acceptedBy.role, 'owner');
  await assert.rejects(call(owner, 'books.decideProposal', { id: proposal.id, decision: 'decline', digest: 'd1' }, fake), { code: 'ALREADY_DECIDED' });
  await assert.rejects(call(owner, 'books.mapField', { sourceId: 'sheet', field: 'channel', target: 'channel', type: 'string' }), { code: 'RECIPE_PROPOSALS_NOT_INSTALLED' });
  await store.update(state => { booksPurge(state, { sourceIds: ['sheet'], removedIds: new Set(), at: '2026-10-14T00:00:00.000Z' }); });
  assert.equal(peekR2(store.read()).proposals.length, 0);
});

test('memory shows business profile entries read-only with earlier versions; delete goes through business.profile.remove', async () => {
  const { call, calls } = await setup();
  const fake: Fake = { 'business.profile.history': () => [
    { id: 'business_profile_1', field: 'products', value: 'Notebooks', origin: 'owner-told', learnedAt: '2026-09-01T00:00:00.000Z', sourceTainted: false },
    { id: 'business_profile_2', field: 'products', value: 'Notebooks and pens', origin: 'owner-told', learnedAt: '2026-09-05T00:00:00.000Z', replacesId: 'business_profile_1', sourceTainted: false },
    { id: 'business_profile_3', field: 'location', value: 'Pune', origin: 'draft-assumption', learnedAt: '2026-09-02T00:00:00.000Z', sourceTainted: true }],
    'business.profile.remove': () => ({ id: 'business_profile_2', removed: true, versionsRemoved: 2 }) };
  const { lines } = await call(viewer, 'books.memory', {}, fake);
  assert.deepEqual(lines.map((l: any) => [l.id, l.status, l.source, l.earlier.length]), [['profile:business_profile_3', 'assumed', 'outside-content', 0], ['profile:business_profile_2', 'corrected', 'told-by-owner', 1]]);
  assert.deepEqual((await call(viewer, 'books.memory', { outsideOnly: true }, fake)).lines.map((l: any) => l.id), ['profile:business_profile_3']);
  await assert.rejects(call(owner, 'books.memoryConfirm', { id: 'profile:business_profile_2' }, fake), { code: 'PROFILE_LINE_READ_ONLY' });
  assert.deepEqual(await call(owner, 'books.forget', { id: 'profile:business_profile_2' }, fake), { id: 'profile:business_profile_2', deleted: true });
  assert.deepEqual(calls.at(-1), { method: 'business.profile.remove', payload: { id: 'business_profile_2' } });
  assert.deepEqual((await call(viewer, 'books.memory', {})).lines, [], 'no profile service: only lane lines');
});

test('trial: refuses a removal, needs saved questions, keeps the copy per person and maps two columns', async () => {
  const { call } = await setup();
  const word = (await call(owner, 'books.meaning', { name: 'billed' })).word;
  const draft = await call(owner, 'books.draft', { name: 'billed', definition: { label: word.label, meaning: 'Changed.', kind: word.kind, field: word.field, nulls: word.nulls === 'exclude' ? 'reject' : 'exclude' } });
  const receipt = (total: string) => ({ status: 'calculated', receipt: { totalMinor: total, operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, coverage: { countedRows: 2, excludedRows: 1, completeness: 'partial' }, definitions: [{ name: 'billed' }] } });
  const summary = { trialId: 'trial-1', status: 'evaluated', change: { type: 'definition', target: 'billed' }, evaluationDigest: 'e1', cost: { preparationElapsedMs: 12.4, totalDiskBytes: 2048 },
    evaluation: { comparisons: [{ answerId: 'a1', request: { operation: 'billed' }, baseline: receipt('500'), candidate: receipt('400') }, { answerId: 'a2', request: { operation: 'received' }, baseline: receipt('90'), candidate: { status: 'refused', code: 'NULL_AMOUNT' } }], limitations: ['Synthetic.'] } };
  let created: any = null;
  const fake: Fake = { 'trials.savedQuestions': () => [{ id: 'a1', receiptId: 'r1', request: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } }, stale: false }, { id: 'a2', receiptId: 'r2', request: { operation: 'received' }, stale: false }],
    'trials.create': body => { created = body; return { trialId: 'trial-1', status: 'created' }; }, 'trials.evaluate': () => summary, 'trials.get': () => summary,
    'trials.impact': () => ({ digest: 'i1', affectedSavedAnswerIds: ['a1'], rebuildArtifactIds: [], activeWorkIds: [] }), 'trials.discard': () => ({ cleanupComplete: true }) };
  await assert.rejects(call(owner, 'books.trial', { draftId: draft.id }, { ...fake, 'trials.savedQuestions': () => [] }), { code: 'TRIAL_NO_SAVED_QUESTIONS' });
  const trial = await call(owner, 'books.trial', { draftId: draft.id, savedAnswerIds: ['a1', 'a2'] }, fake);
  assert.deepEqual(created.change, { type: 'definition', name: 'billed', replacement: draft.after }); assert.deepEqual(created.savedAnswerIds, ['a1', 'a2']);
  assert.deepEqual(trial.rows.map((r: any) => [r.answerId, r.now.value, r.withChange.value, r.withChange.refused, r.differs, r.now.receiptId]), [
    ['a1', { minor: '500' }, { minor: '400' }, null, true, 'r1'], ['a2', { minor: '90' }, { missing: 'unknown' }, 'NULL_AMOUNT', true, 'r2']]);
  assert.deepEqual(trial.impact, { digest: 'i1', strategy: 'prospective', affectedAnswers: 1, rebuild: 0, activeWork: 0 }); assert.deepEqual(trial.cost, { preparationMs: 12, diskBytes: 2048 });
  assert.equal((await call(viewer, 'books.trialRead', { draftId: draft.id }, fake)).trial, null, 'a copy belongs to the person who made it');
  await assert.rejects(call(viewer, 'books.trialDiscard', { trialId: 'trial-1' }, fake), { code: 'FORBIDDEN' });
  assert.deepEqual(await call(owner, 'books.trialDiscard', { trialId: 'trial-1' }, fake), { trialId: 'trial-1', status: 'discarded', cleanupComplete: true });
  await call(owner, 'books.discard', { draftId: draft.id });
  const removal = await call(owner, 'books.draft', { name: 'billed', definition: null });
  await assert.rejects(call(owner, 'books.trial', { draftId: removal.id }, fake), { code: 'TRIAL_CHANGE_UNSUPPORTED' });
});
