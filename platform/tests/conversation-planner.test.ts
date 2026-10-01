import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, type Context, type StateStore } from '../runtime/contracts.ts';
import { buildBusinessContext } from '../runtime/conversation-context.ts';
import { CONVERSATION_PLANNER_INSTRUCTIONS, CONVERSATION_PLANNER_TOOLS, conversationPlannerSchema, validateConversationPlan,
  type ConversationPlannerContext } from '../runtime/conversation-planner.ts';

// Synthetic source contract fixtures only. These do not model or qualify an LLM.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
function context(): ConversationPlannerContext {
  const state = initialState('SYNTHETIC planner business', true);
  const store: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Read-only synthetic fixture.'); } };
  return { manifest: buildBusinessContext(store, owner), operations: ['billed', 'received', 'margin', 'aging'],
    selectors: { branches: ['synthetic-branch'], customerIds: ['synthetic-customer'] } };
}
function calculation(operation = 'billed', changes: Record<string, unknown> = {}) {
  return { tool: 'calculator.calculate', args: { operation, period: null, branch: null, customerId: null, ...changes } };
}
function description(ctx: ConversationPlannerContext) {
  return { tool: 'business.describe', args: { claimIds: ctx.manifest.claims.map(claim => claim.id), unknownCategories: [...ctx.manifest.unknownCategories] } };
}
function execute(...calls: unknown[]) { return { kind: 'execute', calls, clarification: null }; }
function refused(value: unknown, ctx = context()) {
  assert.throws(() => validateConversationPlan(value, ctx), (error: unknown) => error instanceof Error && 'code' in error &&
    (error.code === 'INVALID_CONVERSATION_PLAN' || error.code === 'INVALID_BUSINESS_SELECTION'));
}

test('natural paraphrase fixtures select the same registered context contract without a phrase matcher', () => {
  const ctx = context();
  const fixtures = [
    { question: 'what is this business about', plan: execute(description(ctx)) },
    { question: 'Can you help me understand what we actually do here?', plan: execute(description(ctx)) },
    { question: 'Give me a sense of our company and what remains unknown.', plan: execute(description(ctx)) },
  ];
  for (const fixture of fixtures) {
    const result = validateConversationPlan(fixture.plan, ctx);
    assert.equal(result.kind, 'execute', fixture.question);
    assert.deepEqual(result.calls, [description(ctx)]);
  }
  // Inputs above are authored contracts, not provider-generated predictions.
  assert.equal(CONVERSATION_PLANNER_INSTRUCTIONS.includes('original reviewed business question'), true);
});

test('a mixed introduction and calculation stays ordered and normalizes explicit null selectors', () => {
  const ctx = context();
  const result = validateConversationPlan(execute(description(ctx), calculation()), ctx);
  assert.deepEqual(result, { kind: 'execute', calls: [description(ctx), { tool: 'calculator.calculate', args: { operation: 'billed' } }], clarification: null });
  assert.deepEqual(CONVERSATION_PLANNER_TOOLS, ['business.describe', 'calculator.calculate']);
});

test('four distinct registered calculations are allowed with current selectors and a leap-day period', () => {
  const ctx = context();
  const result = validateConversationPlan(execute(...ctx.operations.map(operation => calculation(operation, {
    period: { from: '2024-02-29', to: '2024-03-01' }, branch: 'synthetic-branch', customerId: 'synthetic-customer',
  }))), ctx);
  assert.equal(result.calls.length, 4);
  assert.deepEqual(result.calls[0], { tool: 'calculator.calculate', args: { operation: 'billed', period: { from: '2024-02-29', to: '2024-03-01' }, branch: 'synthetic-branch', customerId: 'synthetic-customer' } });
});

test('clarification needs no calculation operation or executable call', () => {
  const ctx = { ...context(), operations: [] };
  assert.deepEqual(validateConversationPlan({ kind: 'clarification', calls: [], clarification: 'Which period and branch should I use?' }, ctx),
    { kind: 'clarification', calls: [], clarification: 'Which period and branch should I use?' });
  refused({ kind: 'clarification', calls: [calculation()], clarification: 'Which period should I use?' }, ctx);
  refused({ kind: 'clarification', calls: [], clarification: null }, ctx);
  refused({ kind: 'execute', calls: [calculation()], clarification: 'Which period should I use?' }, ctx);
});

test('the wire schema declares exact fields and the same null normalization contract', () => {
  const ctx = context(), schema = conversationPlannerSchema(ctx);
  assert.deepEqual(schema.required, ['kind', 'calls', 'clarification']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.calls.maxItems, 4);
  assert.equal(schema.properties.calls.uniqueItems, true);
  const [describe, calculate] = schema.properties.calls.items.anyOf;
  assert.deepEqual(describe.required, ['tool', 'args']);
  assert.deepEqual(calculate.properties.args.required, ['operation', 'period', 'branch', 'customerId']);
  assert.deepEqual(calculate.properties.args.properties.branch.anyOf[0], { type: 'null' });
  assert.deepEqual(schema.anyOf[0].properties.clarification, { type: 'null' });
  assert.deepEqual(schema.anyOf[1].properties.calls, { maxItems: 0 });
});

test('empty allowlists permit empty context selections and clarification without invalid empty enums', () => {
  const ctx = context(); ctx.manifest.claims = []; ctx.manifest.unknownCategories = []; ctx.operations = []; ctx.selectors = {};
  const schema = conversationPlannerSchema(ctx);
  assert.equal(JSON.stringify(schema).includes('"enum":[]'), false);
  assert.deepEqual(validateConversationPlan(execute(description(ctx)), ctx), execute(description(ctx)));
  refused(execute(calculation()), ctx);
});

test('plans and calls reject all missing, extra and conflicting fields', () => {
  const ctx = context();
  for (const value of [
    {}, [], null, { kind: 'execute', calls: [calculation()] },
    { ...execute(calculation()), text: 'SYNTHETIC invented response' },
    { ...execute(calculation()), kind: 'other' },
    execute({ ...calculation(), code: 'SELECT amount FROM facts' }),
    execute({ tool: 'calculator.calculate' }),
    execute({ tool: 'business.describe', args: { ...description(ctx).args, text: 'Invented' } }),
    execute(calculation('billed', { clarification: 'Which period?' })),
    execute({ tool: 'calculator.calculate', args: { operation: 'billed' } }),
  ]) refused(value, ctx);
});

test('unregistered tools, injected SQL and financial answer values are refused', () => {
  for (const value of [
    execute({ tool: 'shell.execute', args: { command: 'whoami' } }),
    execute({ tool: 'research.search', args: { query: 'SYNTHETIC' } }),
    execute({ tool: 'actions.execute', args: {} }),
    execute({ tool: 'calculator.calculate', args: { operation: 'billed', period: null, branch: null, customerId: null, amountMinor: '30000' } }),
    execute(calculation('SELECT SUM(amount) FROM facts')),
    execute(calculation('unsupported_operation')),
    execute(calculation('billed', { branch: 'SELECT' })),
    execute(calculation('billed', { customerId: 'unavailable-customer' })),
  ]) refused(value);
});

test('description selections require the exact current claim and unknown allowlists', () => {
  const ctx = context();
  for (const args of [
    { claimIds: ['unavailable-claim'], unknownCategories: [] },
    { claimIds: [], unknownCategories: ['unavailable-category'] },
    { claimIds: ['context_workspace', 'context_workspace'], unknownCategories: [] },
    { claimIds: [], unknownCategories: ['industry', 'industry'] },
    { claimIds: null, unknownCategories: [] },
    { claimIds: [], unknownCategories: null },
  ]) refused(execute({ tool: 'business.describe', args }), ctx);
});

test('impossible, reversed and noncanonical calendar periods are refused', () => {
  for (const period of [
    { from: '2025-02-29', to: '2025-03-01' },
    { from: '2026-04-31', to: '2026-05-01' },
    { from: '2026-03-01', to: '2026-02-28' },
    { from: '2026-1-01', to: '2026-01-31' },
    { from: '2026-01-01T00:00:00Z', to: '2026-01-31' },
    { from: '2026-01-01' }, { from: '2026-01-01', to: '2026-01-31', timezone: 'UTC' },
  ]) refused(execute(calculation('billed', { period })));
});

test('empty, duplicate and excessive call lists are refused', () => {
  const ctx = context();
  refused(execute(), ctx);
  refused(execute(calculation(), calculation()), ctx);
  refused(execute(description(ctx), description(ctx)), ctx);
  refused(execute(...Array.from({ length: 5 }, (_, i) => calculation('billed', { period: { from: `2026-01-0${i + 1}`, to: `2026-01-0${i + 1}` } }))), ctx);
});

test('clarifications refuse amounts, code, URLs, action requests and oversized or empty prose', () => {
  for (const clarification of [
    '', ' ', '??', ' Which period?', 'Which period? ', 'Which period\nshould I use?',
    'Your margin is 25 percent.', 'Your sales are one lakh rupees.', 'Pay the customer.',
    'Approve the transfer.', 'Upload the ledger.', 'SELECT amount FROM facts;',
    'Visit https://example.test.', '<script>cash</script>', 'Use `cash`.', 'Your revenue is ₹many.',
    'a'.repeat(501),
  ]) refused({ kind: 'clarification', calls: [], clarification });
  const ctx = context(), schema = conversationPlannerSchema(ctx);
  const pattern = new RegExp(schema.properties.clarification.anyOf[1].pattern!);
  assert.equal(pattern.test('Which period should I use?'), true);
  assert.equal(pattern.test('SEND the ledger.'), false);
});

test('computed, reserved, non-JSON and oversized input is refused before validation', () => {
  const ctx = context();
  const getter = Object.defineProperty(execute(calculation()), 'calls', { get() { throw new Error('Computed input was evaluated.'); }, enumerable: true });
  assert.throws(() => validateConversationPlan(getter, ctx), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CONVERSATION_PLAN');
  refused(Object.assign(Object.create({ inherited: true }), execute(calculation())), ctx);
  refused({ ...execute(calculation()), unsafe: undefined }, ctx);
  refused(JSON.parse('{"kind":"execute","calls":[],"clarification":null,"__proto__":{}}'), ctx);
  refused({ ...execute(calculation()), payload: 'a'.repeat(65537) }, ctx);
});

test('validation returns detached records and leaves the reviewed input unchanged', () => {
  const ctx = context(), raw = execute(description(ctx), calculation('billed', { period: { from: '2026-01-01', to: '2026-01-31' } }));
  const before = structuredClone(raw), validated = validateConversationPlan(raw, ctx);
  assert.deepEqual(raw, before);
  assert.equal(validated.kind, 'execute');
  const first = validated.calls[0]; assert.equal(first.tool, 'business.describe');
  if (first.tool === 'business.describe') first.args.claimIds.length = 0;
  assert.deepEqual(raw, before);
});
