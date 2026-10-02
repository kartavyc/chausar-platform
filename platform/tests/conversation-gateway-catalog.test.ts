import assert from 'node:assert/strict';
import test from 'node:test';
import { hash, initialState, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway } from '../runtime/gateway.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';

// Authored local fixtures only. Preview/approval never invokes a model.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC PRIVATE WORKSPACE', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
const input = { question: 'What were cash collections?', purpose: 'conversation' as const,
  questionDisclosure: 'verbatim' as const, routeId: 'synthetic-local' };
async function fixture(reverse = false, standard = false) {
  const store = new MemoryStore(); store.state.policy.send = 'shape';
  const draft = structuredClone(starterPacks[0]);
  if (!standard) draft.definitions = [
    { ...draft.definitions[0], name: 'measure_a', label: reverse ? 'Delivered revenue' : 'Cash collections', kind: reverse ? 'sale' : 'payment',
      meaning: reverse ? 'Goods delivered excluding tax by delivery date.' : 'Settled cash receipts excluding cancelled payments by settlement date.' },
    { ...draft.definitions[0], name: 'measure_b', label: reverse ? 'Cash collections' : 'Delivered revenue', kind: reverse ? 'payment' : 'sale',
      meaning: reverse ? 'Settled cash receipts excluding cancelled payments by settlement date.' : 'Goods delivered excluding tax by delivery date.' },
  ];
  await new OntologyService(store).publish(owner, draft);
  store.state.facts.push({ id: 'synthetic-private-fact', sourceId: 'synthetic-private-source', entityId: 'synthetic-private-invoice', sourceRow: 1,
    kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null,
    branch: 'SYNTHETIC PRIVATE BRANCH', fields: { amountMinor: '938475610293847561', customerName: 'SYNTHETIC PRIVATE CUSTOMER', note: 'SYNTHETIC PRIVATE SOURCE TEXT' } });
  let calls = 0;
  const gateway = new ModelGateway(store, { http: async request => {
    calls++;
    return { status: 200, endpoint: request.endpoint, body: JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify({
      kind: 'clarification', calls: [], clarification: 'Which period should I use?' }) } }) };
  } });
  await gateway.configureRoute(owner, { id: 'synthetic-local', kind: 'ollama', model: 'synthetic-fixture' });
  return { store, gateway, calls: () => calls };
}
function content(preview: any) { return JSON.parse(JSON.parse(preview.payload).messages[1].content); }

test('published cash/revenue meanings distinguish identical operation IDs in the exact reviewed payload', async () => {
  const a = await fixture(), b = await fixture(true);
  const first = await a.gateway.preview(owner, input), second = await b.gateway.preview(owner, input);
  assert.notEqual(first.payload, second.payload, 'A planner must receive the semantic difference between valid dictionaries.');
  const catalogue = content(first).publishedCalculations;
  assert.equal(catalogue.dictionaryHash, a.store.read().ontology.current.hash);
  assert.equal(catalogue.dictionaryVersion, a.store.read().ontology.current.version);
  const cash = catalogue.operations.find((operation: any) => operation.id === 'measure_a');
  assert.equal(cash.label, 'Cash collections'); assert.equal(cash.type, 'sum');
  assert.equal(cash.definitions[0].meaning, 'Settled cash receipts excluding cancelled payments by settlement date.');
  assert.equal(cash.definitionHash, hash(a.store.read().ontology.current.definitions.filter((definition: any) => definition.name === 'measure_a')));
  assert.equal(a.calls(), 0); assert.equal(b.calls(), 0);
});

test('calculation descriptors distinguish planner parameters, reviewed scope and unavailable required inputs', async () => {
  const f = await fixture(false, true), preview = await f.gateway.preview(owner, input);
  const operations = content(preview).publishedCalculations.operations;
  const sum = operations.find((operation: any) => operation.id === 'billed');
  assert.deepEqual(sum.plannerParameters, ['period', 'branch', 'customerId']);
  assert.deepEqual(sum.reviewedScopeParameters, ['asOf']);
  const change = operations.find((operation: any) => operation.id === 'change');
  assert.deepEqual(change.requiredParameters, ['period', 'comparePeriod']);
  assert.deepEqual(change.unavailableParameters, ['period', 'comparePeriod']);
  const scenario = operations.find((operation: any) => operation.id === 'scenario');
  assert.deepEqual(scenario.requiredParameters, ['assumptions']);
  assert.deepEqual(scenario.unavailableParameters, ['assumptions']);
  assert.match(preview.instructions, /unavailable required parameter.*clarification/i);
});

test('published definition disclosure is separately warned and evidence Shape stays value-free', async () => {
  const f = await fixture(), preview = await f.gateway.preview(owner, input), body = content(preview);
  assert.equal(preview.definitionDisclosure, 'published');
  assert.equal(body.definitionDisclosure, 'published');
  assert.ok(preview.definitionDisclosureWarning);
  assert.match(preview.definitionDisclosureWarning, /published.*definition/i);
  assert.match(preview.definitionDisclosureWarning, /private names.*amounts/i);
  const evidence = JSON.stringify(body.evidence);
  assert.equal(evidence.includes('Cash collections'), false); assert.equal(evidence.includes('Settled cash receipts'), false);
  for (const value of ['938475610293847561', 'SYNTHETIC PRIVATE CUSTOMER', 'SYNTHETIC PRIVATE SOURCE TEXT', 'synthetic-private-source',
    'synthetic-private-invoice', 'SYNTHETIC PRIVATE BRANCH', 'SYNTHETIC PRIVATE WORKSPACE']) assert.equal(preview.payload.includes(value), false, value);
  await assert.rejects(f.gateway.execute(owner, { ...input, previewId: preview.id }), (error: any) => error.code === 'OUTBOUND_APPROVAL_REQUIRED');
  assert.equal(f.calls(), 0);
});

test('published semantic changes invalidate previous exact payload approvals before provider entry', async () => {
  const f = await fixture(), preview = await f.gateway.preview(owner, input), approval = await f.gateway.approveOutbound(owner, preview.id);
  const draft = structuredClone(starterPacks[0]);
  draft.definitions = f.store.read().ontology.current.definitions;
  draft.definitions[0].meaning = 'Cash includes explicitly classified settled collections under a revised published definition.';
  await new OntologyService(f.store).publish(owner, draft);
  await assert.rejects(f.gateway.execute(owner, { ...input, previewId: preview.id, approvalId: approval.id }),
    (error: any) => error.code === 'BUSINESS_CONTEXT_STALE');
  assert.equal(f.calls(), 0);
});

test('reviewed comparison periods and scenario inputs make only their typed catalogue parameters available', async () => {
  const f = await fixture(false, true), period = { from: '2026-09-01', to: '2026-09-30' },
    comparePeriod = { from: '2026-08-01', to: '2026-08-31' };
  const preview = await f.gateway.preview(owner, { ...input, period, comparePeriod, assumptions: { priceChangeBps: '00500' } });
  const body = content(preview), operations = body.publishedCalculations.operations;
  const change = operations.find((operation: any) => operation.id === 'change'), scenario = operations.find((operation: any) => operation.id === 'scenario');
  assert.deepEqual(change.plannerParameters, ['period', 'branch', 'customerId', 'comparePeriod']);
  assert.deepEqual(change.unavailableParameters, []); assert.deepEqual(scenario.unavailableParameters, []);
  assert.deepEqual(body.calculationParameters.period, period); assert.deepEqual(body.calculationParameters.comparePeriod, comparePeriod);
  assert.equal(body.calculationParameters.assumptions.priceChangeBps, '00500');
  assert.match(body.calculationParameters.assumptions.label, /scenario only, not a measured fact/);
  assert.match(preview.calculationParameterDisclosureWarning, /separately from evidence Shape/);
  assert.equal(f.calls(), 0);
});