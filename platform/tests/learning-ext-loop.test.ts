import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { demoCsv, demoRecipe, ImportService, seedDemo } from '../runtime/ingest.ts';
import { LearningService } from '../runtime/learning.ts';
import { learningExtModule } from '../runtime/modules/lane-learning-ext.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { assertStructuralBatch, batchBytes, scanText, structuralEvent } from '../runtime/learning-ext/structure.ts';
import { constrainRecipe } from '../runtime/learning-ext/recipes.ts';
import type { IntakeRequest } from '../runtime/learning-ext/sharing.ts';
import * as vocabulary from '../runtime/learning-ext/vocabulary.ts';

class Store implements StateStore {
  state: State;
  constructor(demo = true) { this.state = initialState('Synthetic learning shop', demo); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'acct', role: 'accountant', epoch: 1, channel: 'desktop' };
function host(store: Store, options: Record<string, unknown> = {}): ModuleHost {
  const learning = new LearningService(store);
  return { store, services: { learning }, demo: store.state.workspace.demo, directory: '', options,
    call: async (method, payload) => { assert.equal(method, 'learning.sharing'); return learning.setSharing(owner, payload.enabled === true); } };
}
const call = async (h: ModuleHost, method: string, payload: Record<string, unknown> = {}, ctx = owner): Promise<any> => {
  const spec = learningExtModule.methods[method]; assert.ok(spec, method);
  return spec.handler(ctx, payload, h);
};
async function seeded(demo = true) {
  const store = new Store(demo); await new OntologyService(store).publish(owner, 'ecommerce');
  await new ImportService(store).commit(owner, { sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  return store;
}
const secrets = ['Goods delivered', 'cust-1', 'inv-1', 'Demo Shop', '1000.00', 'demo-export', 'September order'];

test('vocabulary tokens hold no digits and structural events refuse anything outside it', () => {
  for (const list of Object.values(vocabulary).filter(Array.isArray)) for (const token of list as unknown as string[]) assert.equal(/\d/.test(token), false, token);
  const event = structuralEvent({ kind: 'mapping', choice: 'corrected', reason: 'type-match', fields: [['amount', 'decimal'], { name: 'customerName', type: 'string' }, ['amountMinor', 'money']] });
  assert.deepEqual(event.fields, [['amount', 'decimal']]);
  assert.throws(() => structuralEvent({ kind: 'mapping', choice: 'accepted', note: 'Customer Ravi owes 5000' }), { code: 'INVALID_LEARNING_EVENT' });
  assert.throws(() => structuralEvent({ kind: 'mapping', choice: 'accepted', reason: 'Ravi' }), { code: 'INVALID_LEARNING_EVENT' });
  assert.throws(() => structuralEvent({ kind: 'secret-kind', choice: 'accepted' }), { code: 'INVALID_LEARNING_EVENT' });
  assert.deepEqual(scanText('ok\n27AAPFU0939F1ZV\nABCDE1234F\n98765 43210\nravi@okaxis\nravi.k@mail.example.in').map(hit => hit.code).filter(code => code !== 'DIGITS'), ['GSTIN', 'PAN', 'PHONE', 'UPI', 'UPI', 'MAIL']);
  const batch: vocabulary.StructuralBatch = { schema: vocabulary.LEARNING_SCHEMA, boxes: ['setup-shapes'], events: [event] };
  assert.deepEqual(assertStructuralBatch(JSON.parse(batchBytes(batch))), batch);
  assert.throws(() => assertStructuralBatch({ ...batch, events: [{ ...event, extra: 'x' }] }), { code: 'INVALID_LEARNING_EVENT' });
});

test('the decision log merges import decisions with lane decisions and never holds values', async () => {
  const store = await seeded(), h = host(store);
  await call(h, 'learningx.record', { event: { kind: 'procedure', choice: 'accepted', reason: 'routed', steps: ['question', 'calculator', 'calculator'] }, refs: ['procedure_1'] });
  await call(h, 'learningx.record', { event: { kind: 'action', choice: 'accepted', impact: 'message', outcome: 'read-back-matched' }, sourceIds: ['demo-export'] });
  await assert.rejects(call(h, 'learningx.record', { event: { kind: 'action', choice: 'accepted' }, sourceIds: ['bad id with spaces'] }), { code: 'INVALID_REQUEST' });
  const page = await call(h, 'learningx.log', {});
  assert.equal(page.total, 3); assert.deepEqual(page.items.map((item: any) => item.origin).sort(), ['import', 'lane', 'lane']);
  assert.deepEqual(page.items.find((item: any) => item.event.kind === 'procedure').event.steps, ['calculator', 'question']);
  const text = JSON.stringify(page); for (const secret of secrets.slice(0, 5)) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual((await call(h, 'learningx.summary')).byKind.mapping, { accepted: 1 });
  const procedures = await call(h, 'learningx.log', { kind: 'procedure', limit: 1 }); assert.equal(procedures.items.length, 1);
  // A non-owner author sees only their own decisions.
  store.state.members.push({ id: 'acct', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  await call(h, 'learningx.record', { event: { kind: 'identity', choice: 'rejected', reason: 'duplicate-record' } }, accountant);
  assert.equal((await call(h, 'learningx.log', {}, accountant)).total, 1); assert.equal((await call(h, 'learningx.log', {})).total, 4);
  // Purge removes decisions derived from a deleted source.
  assert.equal(learningExtModule.purge!(store.state, { sourceIds: ['demo-export'], removedIds: new Set(), at: new Date().toISOString() }), 1);
});

test('consent binds the exact previewed bytes and the demo test inbox receives them once', async () => {
  const store = await seeded(), h = host(store);
  await call(h, 'learningx.record', { event: { kind: 'accounts-label', choice: 'corrected', accountClass: 'bank', proposedClass: 'cash', confidence: 'low', reason: 'owner-override' } });
  assert.equal((await call(h, 'learningx.intakeStatus')).mode, 'test-inbox');
  await assert.rejects(call(h, 'learningx.preview', { boxes: ['account-words'] }), { code: 'BOX_NOT_OPEN' });
  const preview = await call(h, 'learningx.preview', {});
  assert.equal(preview.count, 2); assert.deepEqual(preview.blocked, []); assert.equal(preview.size, Buffer.byteLength(preview.bytes));
  for (const secret of secrets) assert.equal(preview.bytes.includes(secret), false, secret);
  assert.equal(/\d/.test(preview.bytes.split('\n').slice(1, -1).join('')), false);
  await assert.rejects(call(h, 'learningx.consent', { previewId: preview.id, digest: preview.digest }), { code: 'SHARING_DISABLED' });
  await new LearningService(store).setSharing(owner, true);
  await assert.rejects(call(h, 'learningx.consent', { previewId: preview.id, digest: '0'.repeat(64) }), { code: 'PREVIEW_CHANGED' });
  await assert.rejects(call(h, 'learningx.consent', { previewId: preview.id, digest: preview.digest }, { ...owner, channel: 'phone' }), { code: 'APP_CONSENT_REQUIRED' });
  const consent = await call(h, 'learningx.consent', { previewId: preview.id, digest: preview.digest });
  const batch = await call(h, 'learningx.submit', { consentId: consent.id });
  assert.equal(batch.status, 'sent'); assert.equal(batch.mode, 'test-inbox'); assert.equal(Object.hasOwn(batch, 'deletionToken'), false);
  await assert.rejects(call(h, 'learningx.submit', { consentId: consent.id }), { code: 'BATCH_ALREADY_ATTEMPTED' });
  const listed = await call(h, 'learningx.batches'); assert.deepEqual(listed.shared, { events: 2, names: 0, amounts: 0 });
  await assert.rejects(call(h, 'learningx.preview', {}), { code: 'NOTHING_TO_SHARE' });
  assert.equal((await call(h, 'learningx.deleteBatch', { batchId: batch.id })).status, 'deleted');
});

test('a changed log voids the preview; withdraw closes sharing and unused consents', async () => {
  const store = await seeded(), h = host(store); await new LearningService(store).setSharing(owner, true);
  const preview = await call(h, 'learningx.preview', {});
  learningExtModule.purge!(store.state, { sourceIds: ['demo-export'], removedIds: new Set(), at: new Date().toISOString() });
  store.state.learning = [];
  await assert.rejects(call(h, 'learningx.consent', { previewId: preview.id, digest: preview.digest }), { code: 'NOT_FOUND' });
  await call(h, 'learningx.record', { event: { kind: 'mapping', choice: 'accepted' } });
  const next = await call(h, 'learningx.preview', {}), consent = await call(h, 'learningx.consent', { previewId: next.id, digest: next.digest });
  const result = await call(h, 'learningx.withdraw');
  assert.equal(result.sharing, false); assert.equal(result.withdrawnConsents, 1); assert.equal(store.state.policy.sharing, false);
  await assert.rejects(call(h, 'learningx.submit', { consentId: consent.id }), { code: 'SHARING_DISABLED' });
});

test('a production intake is closed until configured, and a lost reply is settled under the same key', async () => {
  const store = await seeded(false), closed = host(store); await new LearningService(store).setSharing(owner, true);
  assert.deepEqual([(await call(closed, 'learningx.intakeStatus')).mode, (await call(closed, 'learningx.intakeStatus')).label], ['closed', 'Sharing is not open yet. Nothing is sent.']);
  let preview = await call(closed, 'learningx.preview', {}), consent = await call(closed, 'learningx.consent', { previewId: preview.id, digest: preview.digest });
  await assert.rejects(call(closed, 'learningx.submit', { consentId: consent.id }), { code: 'INTAKE_NOT_OPEN' });
  const requests: IntakeRequest[] = []; let fail = true;
  const transport = async (request: IntakeRequest) => {
    requests.push(request);
    if (request.method === 'DELETE') return { status: 200, body: '{"deleted":true}' };
    if (fail) { fail = false; throw new Error('connection reset'); }
    return { status: 200, body: JSON.stringify({ reference: 'batch-ref-1', accepted: 1, credits: 1, replayed: true }) };
  };
  await assert.rejects(call(host(store, { intake: { url: 'http://intake.example.com' } }), 'learningx.intakeStatus'), { code: 'INTAKE_MISCONFIGURED' });
  const open = host(store, { intake: { url: 'https://intake.example.com', transport } });
  assert.equal((await call(open, 'learningx.intakeStatus')).mode, 'intake');
  preview = await call(open, 'learningx.preview', {}); consent = await call(open, 'learningx.consent', { previewId: preview.id, digest: preview.digest });
  const unknown = await call(open, 'learningx.submit', { consentId: consent.id });
  assert.equal(unknown.status, 'unknown');
  await assert.rejects(call(open, 'learningx.submit', { consentId: consent.id }), { code: 'BATCH_ALREADY_ATTEMPTED' });
  const settled = await call(open, 'learningx.settle', { batchId: unknown.id });
  assert.equal(settled.status, 'sent'); assert.equal(settled.reference, 'batch-ref-1');
  assert.equal(requests[0].headers['idempotency-key'], requests[1].headers['idempotency-key']);
  assert.equal(requests[0].body, requests[1].body); assert.equal(requests[0].headers['x-deletion-token'], requests[1].headers['x-deletion-token']);
  const body = JSON.parse(requests[1].body!); assert.deepEqual(assertStructuralBatch(body.batch).events.length, 1);
  for (const secret of secrets) assert.equal(requests[1].body!.includes(secret), false);
  await call(open, 'learningx.deleteBatch', { batchId: unknown.id });
  assert.equal(requests[2].method, 'DELETE'); assert.equal(requests[2].path, '/v1/batches/batch-ref-1');
  await assert.rejects(call(open, 'learningx.creditName', { publicName: 'Ravi 123' }), { code: 'INVALID_PUBLIC_NAME' });
  assert.deepEqual(await call(open, 'learningx.creditName', { publicName: 'Ravi Traders' }), { publicName: 'Ravi Traders' });
});

test('the sample cleaner swaps names and identifiers locally and blocks a planted GST number in notes', async () => {
  const store = new Store(), h = host(store);
  const csv = 'Party Name,GSTIN,Mobile,Amount,Notes\nRavi Traders,27AAPFU0939F1ZV,9876543210,1200.00,ok\nRavi Traders,29ABCDE1234F1Z5,9123456780,300.00,call 9812345678 re 29ABCDE1234F1Z5\nMeena Stores,,,50.00,\n';
  const sample = await call(h, 'learningx.cleanSample', { content: csv, label: 'Sales sample' });
  assert.equal(sample.status, 'blocked'); assert.deepEqual(sample.hits.map((hit: any) => [hit.line, hit.column]).sort(), [[3, 'Notes'], [3, 'Notes'], [3, 'Notes']].slice(0, sample.hits.length));
  assert.ok(sample.hits.some((hit: any) => hit.code === 'GSTIN') && sample.hits.some((hit: any) => hit.code === 'PHONE'));
  for (const secret of ['Ravi Traders', 'Meena Stores', '27AAPFU0939F1ZV', '9876543210']) assert.equal(sample.cleaned.includes(secret), false, secret);
  assert.match(sample.cleaned, /Name A,99[A-Z]{5}\d{4}[A-Z]1Z[A-Z],90000\d{5},1200\.00,ok/); assert.match(sample.upload, /Nothing is uploaded/);
  const clean = await call(h, 'learningx.cleanSample', { content: 'Customer,Amount\nRavi,10\n' }); assert.equal(clean.status, 'clean');
  assert.equal((await call(h, 'learningx.outbox')).items.length, 2);
  await call(h, 'learningx.outboxDelete', { id: clean.id }); assert.equal((await call(h, 'learningx.outbox')).items.length, 1);
});

test('recipe lookup finds the closest past recipe and proposals always obey the grammar', async () => {
  const store = await seeded(), h = host(store);
  const lookup = await call(h, 'learningx.recipeLookup', { fields: ['id', 'kind', 'date', 'amount', 'currency', 'customerId'], system: 'canonical' });
  assert.equal(lookup.items[0].system, 'canonical'); assert.equal(lookup.items[0].origin, 'local'); assert.ok(lookup.items[0].score > 50); assert.ok(lookup.librarySize >= 7);
  assert.ok(lookup.items.some((item: any) => item.origin === 'local'));
  // A new file in another layout: the library recipe is adapted through synonyms, and absent columns are removed and named.
  const fields = ['Voucher No', 'Type', 'Invoice Date', 'Total', 'Currency', 'Party Name', 'GST Rate'];
  const proposal = await call(h, 'learningx.recipePropose', { fields, scope: { company: 'Synthetic', branches: ['main'] } });
  assert.equal(proposal.valid, true); assert.deepEqual(proposal.missingTargets, []);
  const sources = Object.fromEntries(proposal.recipe.bindings.map((binding: any) => [binding.target, binding.source]));
  assert.deepEqual([sources.entityId, sources.kind, sources.validFrom, sources.amountMinor, sources.customerId], ['Voucher No', 'Type', 'Invoice Date', 'Total', 'Party Name']);
  assert.ok(proposal.removed.some((item: any) => item.code === 'SOURCE_FIELD_ABSENT')); assert.deepEqual(proposal.unmappedFields, ['GST Rate']);
  // A model candidate naming a column the file lacks and an unknown dictionary word is constrained, never trusted.
  const candidate = { ...structuredClone(demoRecipe), id: 'model-v1', bindings: [...structuredClone(demoRecipe).bindings, { target: 'profitMinor', source: 'Total', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' }] };
  const constrained = await call(h, 'learningx.recipePropose', { fields: ['id', 'kind', 'date', 'amount'], scope: { company: 'S', branches: ['main'] }, candidate });
  assert.equal(constrained.valid, false); assert.deepEqual(constrained.missingTargets, ['currency']);
  assert.ok(constrained.removed.some((item: any) => item.code === 'UNKNOWN_BINDING'));
  assert.equal(constrainRecipe({ ...demoRecipe, script: 'fetch()' }).issues[0].code, 'RECIPE_CODE_FORBIDDEN');
  const log = await call(h, 'learningx.log', { kind: 'mapping' });
  assert.deepEqual(log.items.slice(0, 2).map((item: any) => item.event.reason), ['grammar-refused', 'library-match']);
  // Whatever the grammar accepts, the import accepts: the proposed recipe imports a file in that layout.
  const content = 'Voucher No,Type,Invoice Date,Total,Currency,Party Name,GST Rate\nv-1,sale,2026-09-04,500.00,INR,c-1,18\n';
  const preview = await new ImportService(store).preview(owner, { sourceId: 'new-file', format: 'csv', content, recipe: proposal.recipe, expectedTotals: { rowCount: 1, amountMinor: '50000' } });
  assert.equal(preview.accepted, true, JSON.stringify(preview.errors));
  const saved = await call(h, 'learningx.recipeSave', { recipe: proposal.recipe, passedTests: true, sourceIds: ['new-file'] });
  assert.ok((await call(h, 'learningx.recipeLookup', { fields })).items.some((item: any) => item.id === saved.id));
  assert.equal(learningExtModule.purge!(store.state, { sourceIds: ['new-file'], removedIds: new Set(), at: new Date().toISOString() }), 1);
});

test('the demo seed and an empty workspace give honest empty views', async () => {
  const store = new Store(), h = host(store);
  assert.deepEqual(await call(h, 'learningx.log', {}), { items: [], total: 0, next: null });
  assert.deepEqual((await call(h, 'learningx.batches')).shared, { events: 0, names: 0, amounts: 0 });
  await assert.rejects(call(h, 'learningx.preview', {}), { code: 'NOTHING_TO_SHARE' });
  await seedDemo(store, owner); assert.equal((await call(h, 'learningx.summary')).total, 1);
});
