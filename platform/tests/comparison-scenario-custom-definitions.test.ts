import assert from 'node:assert/strict';
import test from 'node:test';
import { type Context } from '../runtime/contracts.ts';
import { buildBusinessContext } from '../runtime/conversation-context.ts';
import { OntologyService, starterPacks, type Dictionary, type DictionaryDraft } from '../runtime/ontology.ts';
import { conversationPlannerSchema, validateConversationPlan, type ConversationPlannerContext } from '../runtime/conversation-planner.ts';
import { conversationCalculationArgumentSchemas, conversationCalculationClarification, conversationCalculationParameterDisclosure,
  type ReviewedConversationCalculationParameters } from '../runtime/conversation-calculation-arguments.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Pure authored synthetic contracts. No server, provider, disk or native engine.
// Publication/planner admission does not establish custom-field SQL support.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const current = { from: '2026-09-01', to: '2026-09-30' };
const previous = { from: '2026-08-01', to: '2026-08-31' };
function customDraft(field = 'feeMinor'): DictionaryDraft {
  const draft = structuredClone(starterPacks.find(pack => pack.pack === 'ecommerce')!);
  if (field !== 'feeMinor') draft.fields[field] = 'money';
  const earned = draft.definitions.find(definition => definition.name === 'earned')!;
  earned.field = field;
  earned.meaning = 'Explicit SYNTHETIC owner convention: use the separately reported custom money field on delivered sale events, by event date, excluding tax.';
  return draft;
}
async function fixture(draft = customDraft()) {
  const store = new FixtureStateStore(), ontology = new OntologyService(store);
  const dictionary = await ontology.publish(owner, draft);
  function context(parameters?: ReviewedConversationCalculationParameters, selected = dictionary): ConversationPlannerContext {
    return { manifest: buildBusinessContext(store, owner), operations: selected.operations.map(operation => operation.id),
      selectors: { branches: ['main'], customerIds: ['synthetic-customer'] },
      ...(parameters === undefined ? {} : { reviewedCalculationParameters: parameters }) };
  }
  return { store, ontology, dictionary, context };
}
function parameters(priceChangeBps = '00500'): ReviewedConversationCalculationParameters {
  return { period: { ...current }, comparePeriod: { ...previous }, assumptions: { priceChangeBps } };
}
function wire(operation: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { operation, period: { ...current }, branch: null, customerId: null,
    ...(operation === 'change' ? { comparePeriod: { ...previous } } : {}),
    ...(operation === 'scenario' ? { assumptions: { priceChangeBps: '00500' } } : {}), ...extra };
}
function execute(...args: unknown[]) {
  return { kind: 'execute', calls: args.map(value => ({ tool: 'calculator.calculate', args: value })), clarification: null };
}
function refusePlan(raw: unknown, ctx: ConversationPlannerContext) {
  assert.throws(() => validateConversationPlan(raw, ctx), { code: 'INVALID_CONVERSATION_PLAN' });
}

test('publishing an explicit custom earned money binding retains its field and existing operation meanings', async () => {
  for (const field of ['feeMinor', 'recognizedMinor']) {
    const draft = customDraft(field), before = structuredClone(draft), f = await fixture(draft);
    assert.deepEqual(draft, before);
    const earned = f.dictionary.definitions.find(definition => definition.name === 'earned')!;
    assert.equal(earned.field, field); assert.equal(earned.currency, 'INR'); assert.equal(earned.nulls, 'reject');
    assert.equal(f.dictionary.fields[field], 'money'); assert.equal(f.dictionary.schema[field], 'money');
    assert.deepEqual(f.dictionary.operations.find(operation => operation.id === 'change'), { id: 'change', label: 'Revenue change',
      type: 'change', definitions: ['earned'], parameters: ['period', 'asOf', 'branch', 'customerId', 'comparePeriod'] });
    assert.deepEqual(f.dictionary.operations.find(operation => operation.id === 'scenario'), { id: 'scenario', label: 'Price scenario',
      type: 'scenario', definitions: ['earned'], parameters: ['period', 'asOf', 'branch', 'customerId', 'assumptions'] });
    assert.deepEqual(f.ontology.current(owner), f.dictionary);
    assert.equal(f.store.read().facts.length, 0); assert.equal(f.store.read().receipts.length, 0);
    assert.equal(f.store.read().answers.length, 0);
  }
});

test('custom single-sum compiler bindings do not falsely establish compiled comparison or scenario support', async () => {
  const f = await fixture(customDraft('recognizedMinor'));
  const compiledRevenue = f.dictionary.compiledSums!.find(artifact => artifact.operationId === 'revenue')!;
  assert.equal(compiledRevenue.moneyField, 'recognizedMinor');
  assert.equal(compiledRevenue.definitionName, 'earned');
  assert.equal(f.dictionary.compiledSums!.some(artifact => ['change', 'scenario'].includes(artifact.operationId)), false);
  const ctx = f.context(parameters());
  assert.equal(validateConversationPlan(execute(wire('change'), wire('scenario')), ctx).calls.length, 2);
  assert.equal(f.store.read().receipts.length, 0, 'Planner admission only; no numeric or database proof was produced.');
});

test('missing, non-money and currency-mismatched custom bindings refuse atomically at actual publication', async () => {
  const cases: [string, (draft: DictionaryDraft) => void][] = [
    ['missing published field', draft => { delete draft.fields.feeMinor; }],
    ['string field', draft => { draft.fields.feeMinor = 'string'; }],
    ['integer field', draft => { draft.fields.feeMinor = 'integer'; }],
    ['unknown selected field', draft => { draft.definitions.find(definition => definition.name === 'earned')!.field = 'unpublishedMinor'; }],
    ['currency mismatch', draft => { draft.definitions.find(definition => definition.name === 'earned')!.currency = 'USD'; }],
  ];
  for (const [label, change] of cases) {
    const f = await fixture(), before = f.store.read(), candidate = customDraft(); change(candidate);
    await assert.rejects(f.ontology.publish(owner, candidate), { code: 'INVALID_DEFINITION' }, label);
    assert.deepEqual(f.store.read(), before, `${label} must not replace published definitions or increment their revision.`);
    assert.deepEqual(f.ontology.current(owner), f.dictionary);
  }
});

test('duplicate earned bindings and generated-name collisions refuse rather than choose a money field', async () => {
  for (const duplicateField of ['feeMinor', 'amountMinor']) {
    const f = await fixture(), before = f.store.read(), draft = customDraft();
    const duplicate = structuredClone(draft.definitions.find(definition => definition.name === 'earned')!);
    duplicate.field = duplicateField; duplicate.label = 'Competing SYNTHETIC earned meaning'; draft.definitions.push(duplicate);
    await assert.rejects(f.ontology.publish(owner, draft), { code: 'INVALID_DEFINITION' });
    assert.deepEqual(f.store.read(), before);
  }
  for (const name of ['change', 'scenario', 'revenue']) {
    const f = await fixture(), before = f.store.read(), draft = customDraft();
    const collision = structuredClone(draft.definitions.find(definition => definition.name === 'earned')!);
    collision.name = name; draft.definitions.push(collision);
    await assert.rejects(f.ontology.publish(owner, draft), { code: 'RESERVED_MEASURE' });
    assert.deepEqual(f.store.read(), before);
  }
});

test('a dictionary without earned publishes honestly but cannot register comparison or price-scenario capabilities', async () => {
  const draft = customDraft(); draft.definitions = draft.definitions.filter(definition => definition.name !== 'earned');
  const f = await fixture(draft), ctx = f.context(parameters());
  assert.equal(f.dictionary.operations.some(operation => ['revenue', 'change', 'scenario'].includes(operation.id)), false);
  const schemas = conversationCalculationArgumentSchemas(ctx);
  assert.equal(schemas.comparison, undefined); assert.equal(schemas.scenario, undefined);
  refusePlan(execute(wire('change')), ctx); refusePlan(execute(wire('scenario')), ctx);
  assert.equal(f.store.read().receipts.length, 0);
});

test('accepted sign and null policies remain published data and do not become additional scenario assumptions', async () => {
  const draft = customDraft('recognizedMinor'), earned = draft.definitions.find(definition => definition.name === 'earned')!;
  earned.sign = -1; earned.nulls = 'exclude';
  const f = await fixture(draft), published = f.dictionary.definitions.find(definition => definition.name === 'earned')!;
  assert.equal(published.sign, -1); assert.equal(published.nulls, 'exclude');
  const ctx = f.context(parameters()), accepted = validateConversationPlan(execute(wire('scenario')), ctx);
  assert.deepEqual(accepted.calls, [{ tool: 'calculator.calculate', args: { operation: 'scenario', period: current,
    assumptions: { priceChangeBps: '00500' } } }]);
  refusePlan(execute(wire('scenario', { assumptions: { priceChangeBps: '00500', nulls: 'exclude', sign: -1 } })), ctx);
  assert.equal(f.store.read().facts.length, 0);
});

test('custom definitions retain exact reviewed periods and basis-point strings in operation-specific schemas', async () => {
  const f = await fixture(), ctx = f.context(parameters()), schemas = conversationCalculationArgumentSchemas(ctx);
  const comparison = schemas.comparison!, scenario = schemas.scenario!;
  assert.deepEqual(comparison.required, ['operation', 'period', 'branch', 'customerId', 'comparePeriod']);
  assert.deepEqual(scenario.required, ['operation', 'period', 'branch', 'customerId', 'assumptions']);
  assert.equal(comparison.additionalProperties, false); assert.equal(scenario.additionalProperties, false);
  assert.deepEqual((comparison.properties.period as any).properties.from.enum, [current.from]);
  assert.deepEqual((comparison.properties.period as any).properties.to.enum, [current.to]);
  assert.deepEqual(comparison.properties.comparePeriod.properties.from.enum, [previous.from]);
  assert.deepEqual(comparison.properties.comparePeriod.properties.to.enum, [previous.to]);
  assert.deepEqual(scenario.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
  assert.deepEqual(Object.keys(scenario.properties.assumptions.properties), ['priceChangeBps']);
  assert.match(scenario.properties.assumptions.description, /Owner-requested/);
  const result = validateConversationPlan(execute(wire('change'), wire('scenario')), ctx);
  assert.deepEqual(result.calls, [
    { tool: 'calculator.calculate', args: { operation: 'change', period: current, comparePeriod: previous } },
    { tool: 'calculator.calculate', args: { operation: 'scenario', period: current, assumptions: { priceChangeBps: '00500' } } },
  ]);
  assert.equal(JSON.stringify(conversationPlannerSchema(ctx)).includes('feeMinor'), false);
  assert.equal(f.store.read().receipts.length, 0);
});

test('published custom fields never unlock calculations when required owner inputs remain unresolved', async () => {
  const f = await fixture();
  const cases: [string, ReviewedConversationCalculationParameters, string][] = [
    ['change', {}, 'Which current and comparison periods should I use?'],
    ['change', { period: current }, 'Which comparison period should I use?'],
    ['change', { comparePeriod: previous }, 'Which current period should I use?'],
    ['scenario', { period: current }, 'What price change in basis points should I assume?'],
  ];
  for (const [operation, reviewed, question] of cases) {
    const ctx = f.context(reviewed), clarification = conversationCalculationClarification(operation, reviewed);
    assert.equal(clarification, question);
    assert.deepEqual(validateConversationPlan({ kind: 'clarification', calls: [], clarification }, ctx),
      { kind: 'clarification', calls: [], clarification: question });
    refusePlan(execute(wire(operation)), ctx);
  }
  refusePlan(execute(wire('change')), f.context()); refusePlan(execute(wire('scenario')), f.context());
  assert.equal(f.store.read().receipts.length, 0);
});

test('custom field selection, derived amounts and unsupported scenario drivers cannot enter planner arguments', async () => {
  const f = await fixture(), ctx = f.context(parameters());
  for (const extra of [{ field: 'feeMinor' }, { measureField: 'feeMinor' }, { amountMinor: '31501' }, { feeMinor: '31501' },
    { baseline: '30001' }, { totalMinor: '31501' }, { formula: 'feeMinor * 1.05' }, { sourceIds: ['other-source'] }]) {
    for (const operation of ['change', 'scenario']) refusePlan(execute(wire(operation, extra)), ctx);
  }
  for (const assumptions of [{ priceChangeBps: '500' }, { priceChangeBps: 500 }, { priceChangeBps: '5%' },
    { priceChangeBps: '00500', demandBps: '100' }, { priceChangeBps: '00500', volume: 'Held constant' },
    { feeMinor: '31501' }, { priceChangeBps: '100001' }]) {
    refusePlan(execute(wire('scenario', { assumptions })), ctx);
  }
  refusePlan(execute(wire('change', { comparePeriod: { ...previous, to: '2026-08-30' } })), ctx);
  refusePlan(execute(wire('scenario', { period: { ...current, from: '2026-09-02' } })), ctx);
  refusePlan(execute(wire('scenario', { comparePeriod: previous })), ctx);
  refusePlan(execute(wire('change', { assumptions: { priceChangeBps: '00500' } })), ctx);
  assert.equal(f.store.read().receipts.length, 0); assert.equal(f.store.read().answers.length, 0);
});

test('a new custom binding publishes a distinct revision without silently rewriting prior definitions', async () => {
  const f = await fixture(), original = structuredClone(f.dictionary);
  const revised = await f.ontology.publish(owner, customDraft('recognizedMinor'));
  assert.equal(revised.version, original.version + 1); assert.notEqual(revised.hash, original.hash);
  const history = f.ontology.history(owner);
  assert.deepEqual(history[0], original); assert.deepEqual(history[1], revised);
  assert.equal(history[0].definitions.find(definition => definition.name === 'earned')!.field, 'feeMinor');
  assert.equal(history[1].definitions.find(definition => definition.name === 'earned')!.field, 'recognizedMinor');
  assert.deepEqual(f.ontology.current(owner), revised);
  assert.equal(f.store.read().facts.length, 0); assert.equal(f.store.read().receipts.length, 0);
});

test('custom definition publication and planner disclosure remain detached metadata without changing source facts', async () => {
  const f = await fixture(), sourceBefore = f.store.read().facts, reviewed = parameters(), reviewedBefore = structuredClone(reviewed);
  const ctx = f.context(reviewed), raw = execute(wire('change'), wire('scenario')), rawBefore = structuredClone(raw);
  const result = validateConversationPlan(raw, ctx), disclosure = conversationCalculationParameterDisclosure(reviewed);
  assert.equal(disclosure.assumptions!.origin, 'owner-requested'); assert.equal(disclosure.assumptions!.priceChangeBps, '00500');
  const dictionaryReadback: Dictionary = f.ontology.current(owner)!;
  dictionaryReadback.definitions.find(definition => definition.name === 'earned')!.field = 'amountMinor';
  result.calls.forEach(call => { if (call.tool === 'calculator.calculate' && call.args.assumptions) call.args.assumptions.priceChangeBps = '0'; });
  disclosure.period!.from = '2026-01-01'; disclosure.assumptions!.priceChangeBps = '1000';
  assert.deepEqual(reviewed, reviewedBefore); assert.deepEqual(raw, rawBefore);
  assert.equal(f.ontology.current(owner)!.definitions.find(definition => definition.name === 'earned')!.field, 'feeMinor');
  assert.deepEqual(f.store.read().facts, sourceBefore); assert.equal(f.store.read().receipts.length, 0);
});
