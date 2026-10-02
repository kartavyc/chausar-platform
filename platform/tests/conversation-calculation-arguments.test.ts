import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, type Context, type StateStore } from '../runtime/contracts.ts';
import { buildBusinessContext } from '../runtime/conversation-context.ts';
import { conversationPlannerSchema, validateConversationPlan, type ConversationPlannerContext } from '../runtime/conversation-planner.ts';
import { OWNER_REQUESTED_SCENARIO_LABEL, conversationCalculationArgumentSchemas, conversationCalculationClarification,
  conversationCalculationParameterDisclosure, validateConversationCalculationArguments, validateReviewedConversationCalculationParameters,
  type ReviewedConversationCalculationParameters } from '../runtime/conversation-calculation-arguments.ts';

// Authored synthetic contract fixtures only; these tests do not call or qualify a model.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const current = { from: '2026-09-01', to: '2026-09-30' };
const previous = { from: '2026-08-01', to: '2026-08-31' };
function context(parameters?: ReviewedConversationCalculationParameters): ConversationPlannerContext {
  const state = initialState('SYNTHETIC reviewed calculation contract', true);
  const store: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Read-only synthetic fixture.'); } };
  return { manifest: buildBusinessContext(store, owner), operations: ['revenue', 'aging', 'change', 'scenario'],
    selectors: { branches: ['synthetic-branch'], customerIds: ['synthetic-customer'] },
    ...(parameters === undefined ? {} : { reviewedCalculationParameters: parameters }) };
}
function wire(operation: string, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { operation, period: null, branch: null, customerId: null, ...changes };
}
function execute(...args: unknown[]) {
  return { kind: 'execute', calls: args.map(value => ({ tool: 'calculator.calculate', args: value })), clarification: null };
}
function refused(action: () => unknown, label?: string) {
  assert.throws(action, { code: 'INVALID_CONVERSATION_PLAN' }, label);
}
function allParameters(priceChangeBps = '00500'): ReviewedConversationCalculationParameters {
  return { period: { ...current }, comparePeriod: { ...previous }, assumptions: { priceChangeBps } };
}

test('ordinary calls retain four closed wire fields while unreviewed parameter operations stay unavailable', () => {
  const ctx = context(), variants = conversationCalculationArgumentSchemas(ctx);
  assert.deepEqual(variants.legacy.required, ['operation', 'period', 'branch', 'customerId']);
  assert.equal(variants.legacy.additionalProperties, false);
  assert.deepEqual(variants.legacy.properties.operation, { type: 'string', enum: ['revenue', 'aging'] });
  assert.deepEqual(Object.keys(variants.legacy.properties), ['operation', 'period', 'branch', 'customerId']);
  assert.equal(variants.comparison, undefined); assert.equal(variants.scenario, undefined);
  assert.equal(conversationPlannerSchema(ctx).properties.calls.items.anyOf.length, 2);
  assert.deepEqual(validateConversationCalculationArguments(wire('revenue'), ctx), { operation: 'revenue' });
  refused(() => validateConversationCalculationArguments(wire('change', { period: current, comparePeriod: previous }), ctx));
  refused(() => validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps: '500' } }), ctx));
});

test('comparison schema closes and pins both exact reviewed inclusive periods', () => {
  const ctx = context({ period: current, comparePeriod: previous }), variants = conversationCalculationArgumentSchemas(ctx);
  const schema = variants.comparison!;
  assert.deepEqual(schema.required, ['operation', 'period', 'branch', 'customerId', 'comparePeriod']);
  assert.equal(schema.additionalProperties, false); assert.equal(variants.scenario, undefined);
  assert.deepEqual(Object.keys(schema.properties), ['operation', 'period', 'branch', 'customerId', 'comparePeriod']);
  assert.deepEqual(schema.properties.operation, { type: 'string', enum: ['change'] });
  const periodSchema = schema.properties.period as any;
  for (const [value, expected] of [[periodSchema, current], [schema.properties.comparePeriod, previous]] as const) {
    assert.equal(value.additionalProperties, false); assert.deepEqual(value.required, ['from', 'to']);
    assert.deepEqual(value.properties.from.enum, [expected.from]); assert.deepEqual(value.properties.to.enum, [expected.to]);
    assert.equal(value.properties.from.format, 'date'); assert.equal(value.properties.to.format, 'date');
  }
  assert.deepEqual((variants.legacy.properties.period as any).properties.from.enum, [current.from]);
  assert.equal(conversationPlannerSchema(ctx).properties.calls.items.anyOf.length, 3);
});

test('scenario schema labels owner assumptions and pins their exact string without adding backend fields', () => {
  const ctx = context(allParameters()), variants = conversationCalculationArgumentSchemas(ctx), schema = variants.scenario!;
  assert.deepEqual(schema.required, ['operation', 'period', 'branch', 'customerId', 'assumptions']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), ['operation', 'period', 'branch', 'customerId', 'assumptions']);
  assert.deepEqual(schema.properties.operation, { type: 'string', enum: ['scenario'] });
  assert.equal(schema.properties.assumptions.additionalProperties, false);
  assert.deepEqual(schema.properties.assumptions.required, ['priceChangeBps']);
  assert.deepEqual(Object.keys(schema.properties.assumptions.properties), ['priceChangeBps']);
  assert.equal(schema.properties.assumptions.description, OWNER_REQUESTED_SCENARIO_LABEL);
  assert.deepEqual(schema.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
  assert.equal(schema.properties.assumptions.properties.priceChangeBps.type, 'string');
  assert.equal(conversationPlannerSchema(ctx).properties.calls.items.anyOf.length, 4);
  const noPeriod = conversationCalculationArgumentSchemas(context({ assumptions: { priceChangeBps: '0' } })).scenario!;
  assert.deepEqual((noPeriod.properties.period as any).anyOf[0], { type: 'null' });
});

test('reviewed parameters never register unsupported operations and empty catalogues have no empty enums', () => {
  const ctx = context(allParameters()); ctx.operations = ['revenue'];
  const variants = conversationCalculationArgumentSchemas(ctx);
  assert.equal(variants.comparison, undefined); assert.equal(variants.scenario, undefined);
  refused(() => validateConversationCalculationArguments(wire('change', { period: current, comparePeriod: previous }), ctx));
  refused(() => validateConversationCalculationArguments(wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' } }), ctx));
  refused(() => validateConversationCalculationArguments(wire('demand_scenario'), ctx));
  ctx.operations = [];
  assert.equal(JSON.stringify(conversationPlannerSchema(ctx)).includes('"enum":[]'), false);
  assert.deepEqual(conversationCalculationArgumentSchemas(ctx).legacy.properties.operation, { not: {} });
});

test('reviewed comparison and scenario plans normalize null selectors to detached exact calculator arguments', () => {
  const ctx = context(allParameters()), raw = execute(
    wire('change', { period: current, comparePeriod: previous }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' }, branch: 'synthetic-branch', customerId: 'synthetic-customer' }),
  );
  assert.deepEqual(validateConversationPlan(raw, ctx), { kind: 'execute', clarification: null, calls: [
    { tool: 'calculator.calculate', args: { operation: 'change', period: current, comparePeriod: previous } },
    { tool: 'calculator.calculate', args: { operation: 'scenario', period: current, branch: 'synthetic-branch', customerId: 'synthetic-customer', assumptions: { priceChangeBps: '00500' } } },
  ] });
  const unboundedPeriod = context({ assumptions: { priceChangeBps: '-10000' } });
  assert.deepEqual(validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps: '-10000' } }), unboundedPeriod),
    { operation: 'scenario', assumptions: { priceChangeBps: '-10000' } });
});

test('missing reviewed inputs produce plain admissible clarification questions and never unlock executable calls', () => {
  const cases: [string, ReviewedConversationCalculationParameters, string][] = [
    ['change', {}, 'Which current and comparison periods should I use?'],
    ['change', { period: current }, 'Which comparison period should I use?'],
    ['change', { comparePeriod: previous }, 'Which current period should I use?'],
    ['scenario', {}, 'What price change in basis points should I assume?'],
  ];
  for (const [operation, parameters, expected] of cases) {
    const question = conversationCalculationClarification(operation, parameters), ctx = context(parameters);
    assert.equal(question, expected);
    const raw = { kind: 'clarification', calls: [], clarification: question };
    assert.deepEqual(validateConversationPlan(raw, ctx), raw);
    const variants = conversationCalculationArgumentSchemas(ctx);
    assert.equal(operation === 'change' ? variants.comparison : variants.scenario, undefined);
    refused(() => validateConversationPlan(execute(wire(operation, operation === 'change'
      ? { period: current, comparePeriod: previous } : { assumptions: { priceChangeBps: '500' } })), ctx));
  }
  assert.equal(conversationCalculationClarification('change', allParameters()), null);
  assert.equal(conversationCalculationClarification('scenario', allParameters()), null);
  assert.equal(conversationCalculationClarification('revenue'), null);
});

test('disclosure preserves owner inputs, labels hypothetical assumptions and reports unresolved input separately', () => {
  const disclosure = conversationCalculationParameterDisclosure(allParameters());
  assert.deepEqual(disclosure, { kind: 'owner-requested-calculation-parameters', period: current, comparePeriod: previous,
    assumptions: { origin: 'owner-requested', label: OWNER_REQUESTED_SCENARIO_LABEL, priceChangeBps: '00500' },
    missingInputClarifications: { change: null, scenario: null } });
  assert.deepEqual(conversationCalculationParameterDisclosure(), { kind: 'owner-requested-calculation-parameters', period: null,
    comparePeriod: null, assumptions: null, missingInputClarifications: {
      change: 'Which current and comparison periods should I use?', scenario: 'What price change in basis points should I assume?',
    } });
});

test('basis-point limits, zero, negative zero and leading zeros retain the exact reviewed string', () => {
  for (const priceChangeBps of ['-10000', '100000', '0', '-0', '00500', '-000500', '000100000', '0'.repeat(20000)]) {
    const parameters = { assumptions: { priceChangeBps } }, ctx = context(parameters);
    assert.deepEqual(validateReviewedConversationCalculationParameters(parameters), parameters);
    assert.deepEqual(validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps } }), ctx),
      { operation: 'scenario', assumptions: { priceChangeBps } });
    assert.equal(conversationCalculationParameterDisclosure(parameters).assumptions!.priceChangeBps, priceChangeBps);
  }
});

test('unsupported basis-point units, fractional values, implicit coercion and adjacent out-of-range values refuse', () => {
  const ctx = context({ assumptions: { priceChangeBps: '500' } });
  for (const priceChangeBps of ['-10001', '100001', '5%', '5 percent', '500 bps', '5.00', '+500', ' 500', '500 ', '1e3', '', '-',
    'NaN', 'Infinity', '0'.repeat(20001), 500, 0, -0, 500n, null, false, undefined]) {
    refused(() => validateReviewedConversationCalculationParameters({ assumptions: { priceChangeBps } }), String(priceChangeBps));
    refused(() => validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps } }), ctx), String(priceChangeBps));
  }
});

test('leap days and same-day periods work without an invented duration or alignment convention', () => {
  for (const selected of [{ from: '2024-02-29', to: '2024-02-29' }, { from: '2024-02-29', to: '2024-03-01' }]) {
    const parameters = { period: selected, comparePeriod: previous }, ctx = context(parameters);
    assert.deepEqual(validateReviewedConversationCalculationParameters(parameters), parameters);
    assert.deepEqual(validateConversationCalculationArguments(wire('change', { period: selected, comparePeriod: previous }), ctx),
      { operation: 'change', period: selected, comparePeriod: previous });
  }
  // Overlap and unequal duration are explicit owner inputs, not silently changed.
  const overlap = { from: '2026-08-01', to: '2026-09-15' }, ctx = context({ period: current, comparePeriod: overlap });
  assert.deepEqual(validateConversationCalculationArguments(wire('change', { period: current, comparePeriod: overlap }), ctx).comparePeriod, overlap);
});

test('impossible, reversed, noncanonical and structurally invalid dates refuse in either reviewed period', () => {
  for (const invalid of [{ from: '2025-02-29', to: '2025-03-01' }, { from: '2026-04-31', to: '2026-05-01' },
    { from: '2026-09-30', to: '2026-09-01' }, { from: '2026-9-01', to: '2026-09-30' },
    { from: '2026-09-01T00:00:00Z', to: '2026-09-30' }, { from: '2026-09-01' },
    { from: '2026-09-01', to: '2026-09-30', timezone: 'UTC' }, { from: 20260901, to: '2026-09-30' }, null, [], 'September']) {
    for (const key of ['period', 'comparePeriod']) refused(() => validateReviewedConversationCalculationParameters({ [key]: invalid }));
    const ctx = context({ period: current, comparePeriod: previous });
    refused(() => validateConversationCalculationArguments(wire('change', { period: invalid, comparePeriod: previous }), ctx));
    refused(() => validateConversationCalculationArguments(wire('change', { period: current, comparePeriod: invalid }), ctx));
  }
});

test('malformed reviewed host records fail before producing a schema, disclosure or clarification', () => {
  for (const raw of [null, undefined, [], 'owner', { onDate: '2026-09-30' }, { asOf: '2026-09-30T00:00:00Z' },
    { period: undefined }, { comparePeriod: null }, { assumptions: {} }, { assumptions: { priceChangeBps: '500', volume: 'constant' } },
    Object.assign(Object.create({ inherited: true }), { period: current })]) {
    refused(() => validateReviewedConversationCalculationParameters(raw));
  }
  for (const raw of [[], 'owner', { onDate: '2026-09-30' }, { assumptions: { priceChangeBps: '100001' } }]) {
    const ctx = { ...context(), reviewedCalculationParameters: raw } as unknown as ConversationPlannerContext;
    refused(() => conversationCalculationArgumentSchemas(ctx));
    refused(() => validateConversationCalculationArguments(wire('revenue'), ctx));
    refused(() => conversationCalculationParameterDisclosure(raw as any));
    refused(() => conversationCalculationClarification('change', raw as any));
  }
  const nullContext = { ...context(), reviewedCalculationParameters: null } as unknown as ConversationPlannerContext;
  refused(() => conversationCalculationArgumentSchemas(nullContext));
  refused(() => validateConversationCalculationArguments(wire('revenue'), nullContext));
  refused(() => validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps: '500' } }), nullContext));
});

test('wire fields are operation-specific and reject unsupported selectors, override dates and answer values', () => {
  const ctx = context(allParameters());
  for (const raw of [wire('revenue', { period: current, comparePeriod: previous }),
    wire('revenue', { period: current, assumptions: { priceChangeBps: '00500' } }),
    wire('change', { period: current, comparePeriod: previous, assumptions: { priceChangeBps: '00500' } }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' }, comparePeriod: previous }),
    wire('change', { period: current }), wire('scenario', { period: current }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500', label: 'owner-requested' } }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500', volumeChangeBps: '0' } }),
    wire('scenario', { period: current, assumptions: { demandChangeBps: '500' } }),
    wire('scenario', { period: current, assumptions: null }), wire('change', { period: current, comparePeriod: null }),
    wire('revenue', { period: current, branch: 'unreviewed-branch' }), wire('revenue', { period: current, customerId: 'unavailable-customer' }),
    wire('aging', { period: current, onDate: '2026-08-01' }), wire('aging', { period: current, asOf: '2026-09-30T00:00:00Z' }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' }, sourceIds: ['outside'] }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' }, amountMinor: '10500' }),
    { operation: 'change', period: current, comparePeriod: previous, branch: null },
  ]) refused(() => validateConversationPlan(execute(raw), ctx));
});

test('changed reviewed periods and semantically equal but differently written assumptions still require fresh review', () => {
  const ctx = context(allParameters());
  for (const raw of [wire('change', { period: { ...current, to: '2026-09-29' }, comparePeriod: previous }),
    wire('change', { period: current, comparePeriod: { ...previous, from: '2026-08-02' } }),
    wire('change', { period: null, comparePeriod: previous }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '500' } }),
    wire('scenario', { period: current, assumptions: { priceChangeBps: '00600' } }),
    wire('scenario', { period: null, assumptions: { priceChangeBps: '00500' } }),
    wire('revenue', { period: null })]) refused(() => validateConversationCalculationArguments(raw, ctx));
  const zero = context({ assumptions: { priceChangeBps: '-0' } });
  refused(() => validateConversationCalculationArguments(wire('scenario', { assumptions: { priceChangeBps: '0' } }), zero));
});

test('duplicate parameterized calls are refused after exact normalization', () => {
  const ctx = context(allParameters()), change = wire('change', { period: current, comparePeriod: previous });
  refused(() => validateConversationPlan(execute(change, structuredClone(change)), ctx));
  const scenario = wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' } });
  refused(() => validateConversationPlan(execute(scenario, structuredClone(scenario)), ctx));
});

test('validated arguments, disclosures and schemas are detached without mutating source records', () => {
  const parameters = allParameters(), ctx = context(parameters), raw = wire('scenario', { period: { ...current }, assumptions: { priceChangeBps: '00500' } });
  const parametersBefore = structuredClone(parameters), rawBefore = structuredClone(raw);
  const reviewed = validateReviewedConversationCalculationParameters(parameters), args = validateConversationCalculationArguments(raw, ctx);
  const disclosure = conversationCalculationParameterDisclosure(parameters), schema = conversationCalculationArgumentSchemas(ctx).scenario!;
  reviewed.period!.from = '2026-01-01'; reviewed.comparePeriod!.to = '2026-01-02'; reviewed.assumptions!.priceChangeBps = '0';
  args.period!.from = '2026-02-01'; args.assumptions!.priceChangeBps = '1000';
  disclosure.period!.to = '2026-02-02'; disclosure.assumptions!.priceChangeBps = '2000';
  schema.properties.assumptions.properties.priceChangeBps.enum[0] = '3000';
  assert.deepEqual(parameters, parametersBefore); assert.deepEqual(raw, rawBefore);
  assert.deepEqual(ctx.reviewedCalculationParameters, parametersBefore);
  const changeRaw = wire('change', { period: { ...current }, comparePeriod: { ...previous } });
  const change = validateConversationCalculationArguments(changeRaw, ctx);
  change.comparePeriod!.from = '2026-01-01';
  assert.deepEqual(changeRaw.comparePeriod, previous); assert.deepEqual(parameters, parametersBefore);
});

test('computed and symbol fields refuse before getters are evaluated at every new parameter boundary', () => {
  let getterCalls = 0;
  const getter = (key: string, rest: Record<string, unknown> = {}) => Object.defineProperty(rest, key, {
    enumerable: true, get() { getterCalls++; throw new Error('Untrusted getter must never run.'); },
  });
  const symbol = (rest: Record<string, unknown>) => Object.assign(rest, { [Symbol('synthetic-hidden')]: 'hidden' });
  const ctx = context(allParameters());
  for (const raw of [getter('period'), getter('comparePeriod'), getter('assumptions'),
    { period: getter('from', { to: current.to }) }, { comparePeriod: getter('to', { from: previous.from }) },
    { assumptions: getter('priceChangeBps') }, symbol({}), { period: symbol({ ...current }) },
    { comparePeriod: symbol({ ...previous }) }, { assumptions: symbol({ priceChangeBps: '00500' }) }]) {
    refused(() => validateReviewedConversationCalculationParameters(raw));
  }
  for (const raw of [getter('operation', { period: current, branch: null, customerId: null }),
    getter('period', wire('change', { comparePeriod: previous })),
    getter('comparePeriod', wire('change', { period: current })),
    getter('assumptions', wire('scenario', { period: current })),
    wire('change', { period: getter('from', { to: current.to }), comparePeriod: previous }),
    wire('change', { period: current, comparePeriod: getter('to', { from: previous.from }) }),
    wire('scenario', { period: current, assumptions: getter('priceChangeBps') }),
    symbol(wire('change', { period: current, comparePeriod: previous })),
    wire('scenario', { period: current, assumptions: symbol({ priceChangeBps: '00500' }) })]) {
    refused(() => validateConversationCalculationArguments(raw, ctx));
    refused(() => validateConversationPlan(execute(raw), ctx));
  }
  assert.equal(getterCalls, 0);
});

test('inherited, non-enumerable and reserved fields cannot become reviewed parameters or executable overrides', () => {
  const hidden = Object.defineProperty({}, 'period', { enumerable: false, value: current });
  const reserved = JSON.parse('{"__proto__":{"priceChangeBps":"500"}}');
  for (const raw of [hidden, reserved, { assumptions: Object.assign(Object.create({ priceChangeBps: '00500' }), {}) },
    { period: Object.assign(Object.create({ from: current.from }), { to: current.to }) }]) {
    refused(() => validateReviewedConversationCalculationParameters(raw));
  }
  const ctx = context(allParameters());
  const inherited = Object.assign(Object.create({ sourceIds: ['outside'] }), wire('change', { period: current, comparePeriod: previous }));
  refused(() => validateConversationCalculationArguments(inherited, ctx));
  const nonEnumerable = Object.defineProperty(wire('scenario', { period: current, assumptions: { priceChangeBps: '00500' } }), 'sourceIds',
    { enumerable: false, value: ['outside'] });
  refused(() => validateConversationCalculationArguments(nonEnumerable, ctx));
});
