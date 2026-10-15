import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, hash, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { compileDictionary, OntologyService, starterPacks, type DictionaryDraft } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { provenanceMethods, recipesOf } from '../runtime/core-data/provenance.ts';

// Definitions (BK-08) and provenance (AS-05) without the engine. Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic provenance shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const ravi: Context = { memberId: 'ravi', role: 'accountant', epoch: 1, channel: 'desktop' };
const asha: Context = { memberId: 'asha', role: 'cofounder', epoch: 1, channel: 'desktop' };

async function setup() {
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'asha', name: 'Asha', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }); });
  const services: Record<string, any> = { memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store) };
  await services.ontology.publish(owner, 'ecommerce');
  const host = (): ModuleHost => ({ store, services, demo: true, directory: '/tmp/x', options: {}, async call() { throw new Error('unused'); } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = booksMethods[method] ?? provenanceMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host());
  };
  return { store, services, call };
}
const sale = (entityId: string, amountMinor: string): FactInput => ({ entityId, sourceId: 'shop', sourceRow: 2, kind: 'sale', validFrom: '2026-09-02', branch: 'main', fields: { currency: 'INR', status: 'delivered', amountMinor } });

test('dictionaries without the new fields keep their exact hash; the fields are validated strictly', () => {
  const draft = structuredClone(starterPacks[0]);
  const at = '2026-10-01T00:00:00.000Z';
  const plain = compileDictionary(draft, 3, 'owner', at);
  // The hash is the content hash of exactly the fields that existed before.
  const { hash: _h, ...content } = plain;
  assert.equal(plain.hash, hash(content));
  assert.ok(plain.definitions.every(d => !Object.hasOwn(d, 'example') && !Object.hasOwn(d, 'usedFrom')));
  const dated: DictionaryDraft = structuredClone(draft); dated.definitions[0].usedFrom = '2026-04-01';
  assert.notEqual(compileDictionary(dated, 3, 'owner', at).hash, plain.hash);
  const bad = (change: (d: any) => void) => { const copy: any = structuredClone(draft); change(copy.definitions[0]); assert.throws(() => compileDictionary(copy), (e: any) => e.code === 'INVALID_DEFINITION'); };
  bad(d => { d.usedFrom = '2026-02-30'; });
  bad(d => { d.usedFrom = '1 April 2026'; });
  bad(d => { d.example = { rows: [], resultMinor: '0' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: '10.5', counted: true }], resultMinor: '10' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: 10, counted: true }], resultMinor: '10' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: '10', counted: false }], resultMinor: '0' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: '10', counted: true, code: 'x' }], resultMinor: '10' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: '10', counted: true }], resultMinor: '11' }; });
  bad(d => { d.example = { rows: [{ label: 'A', amountMinor: '10', counted: true }], resultMinor: '10', note: 'x' }; });
  bad(d => { d.example = { rows: Array.from({ length: 13 }, (_, i) => ({ label: `R${i}`, amountMinor: '1', counted: true })), resultMinor: '13' }; });
  const good: any = structuredClone(draft);
  good.definitions[0].example = { rows: [{ label: 'Invoice 1', amountMinor: '118000', counted: true }, { label: 'Draft invoice', amountMinor: '5000', counted: false, reason: 'A draft is not billed.' }], resultMinor: '118000' };
  assert.deepEqual(compileDictionary(good).definitions[0].example, good.definitions[0].example);
});

test('a work-books co-sign shows on the release and is captured on receipts; the publisher never counts as reviewer', async () => {
  const f = await setup();
  const draft = await f.call(ravi, 'books.draft', { name: 'earned', definition: { label: 'Earned', meaning: 'Delivered goods excluding tax, by delivery date, synthetic.', kind: 'sale', field: 'amountMinor', nulls: 'reject' } });
  await f.call(asha, 'books.cosign', { draftId: draft.id, digest: draft.digest });
  const published = await f.call(owner, 'books.publish', { draftId: draft.id, digest: draft.digest });
  const { releases } = await f.call(owner, 'meanings.releases');
  const release = releases.find((r: any) => r.version === published.version);
  assert.deepEqual(release.coSigners.map((c: any) => [c.memberId, c.name, c.via]), [['asha', 'Asha', 'books.cosign']]);
  assert.equal(release.reviewers, 'not reviewed');
  assert.equal(releases[0].coSigners, 'not co-signed');
  // Asha already co-signed through books; recording it again is refused. Ravi reviews.
  await assert.rejects(f.call(asha, 'meanings.review', { version: published.version, hash: published.hash, kind: 'cosign' }), (e: any) => e.code === 'ALREADY_REVIEWED');
  await f.call(ravi, 'meanings.review', { version: published.version, hash: published.hash, kind: 'review' });

  await f.services.memory.append(owner, [sale('s-1', '1000'), sale('s-2', '2500')]);
  const receipt = await f.services.calculator.calculate(owner, { operation: 'earned', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(receipt.valueMinor, '3500');
  assert.equal(receipt.provenance.meaning.coSignedBy, 'asha');
  assert.equal(receipt.provenance.meaning.reviewedBy, 'ravi');
  assert.equal(receipt.provenance.meaning.publishedBy, 'owner');
  assert.deepEqual(receipt.provenance.recipes, []);
  assert.equal(receipt.provenance.allowedBy.device, 'desktop');
  // A context without a channel (an in-process host task) records no Allowed by line rather than inventing a device.
  const hostTask = await f.services.calculator.calculate({ memberId: 'owner', role: 'owner', epoch: 1 }, { operation: 'earned', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(hostTask.provenance.allowedBy, undefined);
  const served = await f.call(owner, 'receipts.provenance', { receiptId: hostTask.id });
  assert.equal(served.allowedBy, 'not recorded');
  assert.deepEqual(served.recipes, [{ sourceId: 'shop', state: 'absent' }]);
  assert.deepEqual(served.meaning.coSignedBy.map((c: any) => c.name), ['Asha']);
  assert.equal(served.meaning.atCalculation.coSignedBy.name, 'Asha');
  // A receipt made before provenance existed: served from records, with explicit missing states.
  await f.store.update(s => { delete s.receipts.find(r => r.id === receipt.id).provenance; });
  const legacy = await f.call(owner, 'receipts.provenance', { receiptId: receipt.id });
  assert.equal(legacy.recorded, 'not recorded');
  assert.equal(legacy.meaning.atCalculation, 'not recorded');
  assert.equal(legacy.allowedBy, 'not recorded');
});

test('recipe acceptance is read from connector mapping reviews and accepted connector recipe proposals', () => {
  const state = initialState('Synthetic recipes', true);
  state.imports.push(
    { type: 'connector-mapping-review-v1', id: 'mapping_1', sourceId: 'bank', reviewer: { memberId: 'asha', epoch: 1 }, reviewedAt: '2026-09-01T10:00:00.000Z' },
    { type: 'connector-capture-v1', id: 'capture_1', sourceId: 'bank', reviewId: 'mapping_1', recipe: { id: 'bank-movements-v1' }, rowIds: ['f1'] },
    { id: 'import_2', sourceId: 'tally', retainedInput: { input: { recipe: { id: 'tally-voucher-v1' } } }, rowIds: ['f2'] },
  );
  state.learning.push({ id: 'proposal_1', category: 'connector-recipe', status: 'accepted', sourceId: 'zoho', acceptedBy: 'owner', acceptedAt: '2026-09-02T10:00:00.000Z' },
    { id: 'proposal_0', category: 'connector-recipe', status: 'proposed', sourceId: 'shop' });
  const recipes = recipesOf(state, { sourceIds: ['bank', 'tally', 'zoho', 'shop'], coverage: { importIds: ['capture_1', 'import_2', 'import_missing'] } as any });
  assert.deepEqual(recipes, [
    { sourceId: 'bank', recipeId: 'bank-movements-v1', acceptedBy: 'asha', acceptedAt: '2026-09-01T10:00:00.000Z' },
    { sourceId: 'tally', recipeId: 'tally-voucher-v1', acceptedBy: null, acceptedAt: null },
    { sourceId: 'zoho', recipeId: 'proposal_1', acceptedBy: 'owner', acceptedAt: '2026-09-02T10:00:00.000Z' },
  ]);
});
