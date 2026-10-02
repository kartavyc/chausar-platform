import assert from 'node:assert/strict';
import test from 'node:test';
import {ChausarError} from '../runtime/contracts.ts';
import {PostgresDatabaseCalculator} from '../runtime/postgres-analytics.ts';
import {SOURCE, OTHER, PERIOD, PRIOR, CUT, NEW_CUT, fixture, request, plan,
  importedInput, content, figures, refusedAnswer} from './fixtures/comparison-scenario-custom-fields.ts';

for (const operation of ['change', 'scenario'] as const) {
  test(`public reviewed custom-field ${operation} projects exact diagnostic provenance then stops at the explicit synthetic SQL boundary`, async t => {
    const f = await fixture(t, {project: true}), input = request(operation), facts = await f.rpc('memory.list');
    const turn = await f.turn(input, plan(operation, input)); refusedAnswer(turn.answer);
    const body = content(turn.preview);
    assert.deepEqual(body.calculationParameters.period, PERIOD);
    if (operation === 'change') assert.deepEqual(body.calculationParameters.comparePeriod, PRIOR);
    else {
      assert.equal(body.calculationParameters.assumptions.priceChangeBps, '00500');
      assert.equal(body.calculationParameters.assumptions.origin, 'owner-requested');
      assert.match(body.calculationParameters.assumptions.label, /scenario only, not a measured fact/);
    }
    assert.ok(turn.preview.payload.includes('feeMinor'));
    assert.equal(turn.preview.payload.includes('10001'), false, 'Shape disclosure must not include custom cells.');
    const schema = turn.preview.schema.properties.calls.items.anyOf.find((entry: any) =>
      entry.properties.tool.enum.includes('calculator.calculate') && entry.properties.args.properties.operation.enum?.includes(operation));
    if (operation === 'scenario') assert.deepEqual(schema.properties.args.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
    else assert.deepEqual(schema.properties.args.properties.comparePeriod.properties.to.enum, [PRIOR.to]);
    assert.equal(f.captured.length, 1); const diagnostic = f.captured[0];
    assert.deepEqual(figures(diagnostic), operation === 'change'
      ? {current: '30002', previous: '30000', change: '2', changeBps: '0'}
      : {baseline: '30002', scenario: '31502', change: '1500', priceChangeBps: '500'});
    assert.equal(diagnostic.definitions.find(definition => definition.name === 'earned')!.field, 'feeMinor');
    assert.equal(diagnostic.dictionaryHash, f.dictionary.hash); assert.equal(diagnostic.asOf, CUT);
    assert.equal(diagnostic.branch, 'main'); assert.deepEqual(diagnostic.requestedSourceIds, [SOURCE]);
    assert.ok(diagnostic.rows.every(row => row.sourceId === SOURCE));
    assert.deepEqual(diagnostic.rows.map(row => row.entityId).sort(), operation === 'change'
      ? ['current-end', 'current-start', 'prior'] : ['current-end', 'current-start']);
    if (operation === 'scenario') {
      assert.equal(diagnostic.assumptions.priceChangeBps, '500'); assert.match(String(diagnostic.assumptions.status), /Scenario only/);
    } else assert.match(String(diagnostic.assumptions.causalStatus), /not a causal explanation/);
    assert.equal(f.connectionCalls, 1); assert.deepEqual(await f.rpc('memory.list'), facts);
    assert.deepEqual(f.custody().receipts, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
    await f.refuse('receipts.get', {id: diagnostic.id}, 'RECEIPT_NOT_FOUND');
    await f.refuse('conversation.ask', turn.payload, 'PREVIEW_NOT_FOUND');
    let postgresConnections = 0;
    const postgres = PostgresDatabaseCalculator.fromPool({connect: async () => {
      postgresConnections++; throw new ChausarError('SYNTHETIC_SQL_BOUNDARY', 'No native PostgreSQL pool is available in this source fixture.');
    }, end: async () => {throw new Error('Injected pool is not owned.');}});
    await assert.rejects(postgres.verify(diagnostic), (error: any) => error.code === 'SYNTHETIC_SQL_BOUNDARY');
    await postgres.close(); assert.equal(postgresConnections, 1);
    await f.restart(); assert.deepEqual((await f.rpc('conversation.get', {id: turn.answer.id})).answer, turn.answer);
    assert.deepEqual(f.custody().receipts, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
    assert.equal(f.calls.length, 1);
  });
}

test('exact reviewed custom comparison periods and textual scenario assumptions cannot change before or after dispatch', async t => {
  const f = await fixture(t, {project: true});
  for (const operation of ['change', 'scenario'] as const) {
    const input = request(operation), review = await f.review(input); f.provider(plan(operation, input));
    const altered = operation === 'change' ? {comparePeriod: {...PRIOR, to: '2026-08-30'}}
      : {assumptions: {priceChangeBps: '500'}};
    await f.refuse('conversation.ask', {...review.payload, ...altered}, 'PREVIEW_REQUEST_CHANGED');
    assert.equal(f.calls.length, 0); assert.equal(f.captured.length, 0);
  }
  for (const operation of ['change', 'scenario'] as const) {
    const input = request(operation), review = await f.review(input);
    f.provider(plan(operation, input, operation === 'change' ? {comparePeriod: {...PRIOR, to: '2026-08-30'}}
      : {assumptions: {priceChangeBps: '500'}}));
    await f.refuse('conversation.ask', review.payload, 'INVALID_CONVERSATION_PLAN');
    await f.refuse('conversation.ask', review.payload, 'PREVIEW_NOT_FOUND');
  }
  assert.equal(f.calls.length, 2); assert.equal(f.captured.length, 0);
  assert.deepEqual(f.custody().receipts, []); assert.deepEqual((await f.rpc('conversation.history')).items, []);
});

test('missing reviewed custom comparison/scenario inputs require clarification and never infer a default', async t => {
  const f = await fixture(t, {project: true});
  for (const operation of ['change', 'scenario'] as const) {
    const input = request(operation); delete input[operation === 'change' ? 'comparePeriod' : 'assumptions'];
    f.provider(plan(operation, input)); const review = await f.review(input);
    await f.refuse('conversation.ask', review.payload, 'INVALID_CONVERSATION_PLAN');
    const clarification = operation === 'change' ? 'Which comparison period should I use?' : 'Which price assumption should I use?';
    const turn = await f.turn(input, {kind: 'clarification', calls: [], clarification});
    assert.equal(turn.answer.clarification, clarification);
  }
  assert.equal(f.captured.length, 0); assert.equal(f.connectionCalls, 0);
  assert.deepEqual(f.custody().receipts, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
});

test('a missing mapped custom amount refuses rather than falling back to amountMinor or zero', async t => {
  const f = await fixture(t, {missing: true, project: true});
  for (const operation of ['change', 'scenario'] as const) {
    const input = request(operation), turn = await f.turn(input, plan(operation, input));
    refusedAnswer(turn.answer, 'MISSING_MEASURE_VALUE');
  }
  assert.equal(f.captured.length, 0); assert.equal(f.connectionCalls, 0);
  assert.deepEqual(f.custody().receipts, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
});

test('explicit custom null exclusion keeps partial coverage and never treats the missing fee as zero', async t => {
  const f = await fixture(t, {missing: true, nulls: 'exclude', project: true});
  for (const operation of ['change', 'scenario'] as const) {
    const input = request(operation); refusedAnswer((await f.turn(input, plan(operation, input))).answer);
    const diagnostic = f.captured.at(-1)!;
    assert.deepEqual(figures(diagnostic), operation === 'change'
      ? {current: '20001', previous: '30000', change: '-9999', changeBps: '-3333'}
      : {baseline: '20001', scenario: '21001', change: '1000', priceChangeBps: '500'});
    assert.equal(diagnostic.coverage.completeness, 'partial');
    assert.ok(diagnostic.coverage.gaps.some(gap => /missing amounts are not zero/i.test(gap)));
    assert.equal(diagnostic.rows.some(row => row.entityId === 'current-start'), false);
    assert.ok(diagnostic.exclusions.some(exclusion => /null amount/.test(exclusion.reason)));
  }
  assert.equal(f.connectionCalls, 2); assert.deepEqual(f.custody().receipts, []);
});

test('custom price scenarios retain signed truncation and exact amounts beyond Number safe precision', async t => {
  const f = await fixture(t, {project: true}), facts = await f.rpc('memory.list');
  const negative = request('scenario', {assumptions: {priceChangeBps: '-00500'}});
  const turn = await f.turn(negative, plan('scenario', negative)); refusedAnswer(turn.answer);
  assert.equal(content(turn.preview).calculationParameters.assumptions.priceChangeBps, '-00500');
  assert.deepEqual(figures(f.captured.at(-1)!), {baseline: '30002', scenario: '28501', change: '-1501', priceChangeBps: '-500'});
  assert.deepEqual(await f.rpc('memory.list'), facts);
  f.advance(NEW_CUT);
  const sourceId = 'synthetic-custom-huge', imported = importedInput(sourceId);
  imported.content = ['id,kind,date,amount,fee,feeAlternative,currency,branch,status',
    'huge,sale,2026-10-01,111,900719925474099325,7,INR,main,delivered'].join('\r\n');
  imported.expectedTotals = {rowCount: 1, amountMinor: '111'};
  assert.equal((await f.rpc('sources.import', imported)).totalsMinor, '111');
  const hugeFacts = await f.rpc('memory.list');
  for (const assumption of ['00500', '-00500']) {
    const input = request('scenario', {sourceIds: [sourceId], asOf: NEW_CUT,
      period: {from: '2026-10-01', to: '2026-10-31'}, assumptions: {priceChangeBps: assumption}});
    refusedAnswer((await f.turn(input, plan('scenario', input))).answer);
    assert.deepEqual(figures(f.captured.at(-1)!), assumption === '00500'
      ? {baseline: '900719925474099325', scenario: '945755921747804291', change: '45035996273704966', priceChangeBps: '500'}
      : {baseline: '900719925474099325', scenario: '855683929200394358', change: '-45035996273704967', priceChangeBps: '-500'});
  }
  assert.deepEqual(await f.rpc('memory.list'), hugeFacts); assert.equal(f.connectionCalls, 3);
  assert.deepEqual(f.custody().receipts, []); assert.deepEqual(await f.rpc('trials.savedQuestions'), []);
});

test('ambiguous custom mapping bindings refuse atomically through public preview and import', async t => {
  const f = await fixture(t, {project: true}), facts = await f.rpc('memory.list'), imports = await f.rpc('sources.list');
  for (const variant of ['duplicate', 'constant', 'units', 'type'] as const) {
    const input = importedInput('synthetic-custom-invalid-map'), binding = input.recipe!.bindings.find(item => item.target === 'feeMinor')!;
    if (variant === 'duplicate') input.recipe!.bindings.push({...binding, source: 'feeAlternative'});
    else if (variant === 'constant') binding.constant = '123';
    else if (variant === 'units') delete binding.moneyUnit;
    else binding.type = 'string';
    const code = {duplicate: 'UNKNOWN_BINDING', constant: 'AMBIGUOUS_BINDING', units: 'AMBIGUOUS_MONEY', type: 'BINDING_TYPE_MISMATCH'}[variant];
    await f.refuse('sources.preview', input, code); await f.refuse('sources.import', input, code);
  }
  assert.deepEqual(await f.rpc('memory.list'), facts); assert.deepEqual(await f.rpc('sources.list'), imports);
  assert.equal(f.calls.length, 0); assert.equal(f.captured.length, 0);
});

test('custom field and amount overrides never become public conversation calculator arguments', async t => {
  const f = await fixture(t, {project: true}), input = request('scenario');
  for (const override of [{field: 'amountMinor'}, {amountMinor: '999999'},
    {assumptions: {priceChangeBps: '00500', volumeChangeBps: '100'}}]) {
    f.provider(plan('scenario', input, override)); const review = await f.review(input);
    await f.refuse('conversation.ask', review.payload, 'INVALID_CONVERSATION_PLAN');
  }
  assert.equal(f.calls.length, 3); assert.equal(f.captured.length, 0); assert.equal(f.connectionCalls, 0);
  assert.deepEqual(f.custody().receipts, []); assert.deepEqual((await f.rpc('conversation.history')).items, []);
});

test('custom source access revocation invalidates pending review and retained refusal readback after reopen', async t => {
  const f = await fixture(t, {project: true}), input = request('change'); f.provider(plan('change', input));
  const pending = await f.review(input); await f.rpc('trust.update', {allowedSources: [OTHER]});
  await f.refuse('conversation.ask', pending.payload, 'PREVIEW_STALE'); assert.equal(f.calls.length, 0);
  await f.rpc('trust.update', {allowedSources: [SOURCE, OTHER]});
  const turn = await f.turn(input, plan('change', input)); refusedAnswer(turn.answer);
  await f.rpc('trust.update', {allowedSources: [OTHER]});
  await f.refuse('conversation.get', {id: turn.answer.id}, 'CONVERSATION_NOT_FOUND');
  assert.deepEqual((await f.rpc('conversation.history')).items, []);
  await f.restart(); await f.refuse('conversation.get', {id: turn.answer.id}, 'CONVERSATION_NOT_FOUND');
  assert.equal(f.calls.length, 1); assert.equal(f.connectionCalls, 1);
});

test('a real custom mapping revision invalidates pending review and retained refusal without silently rebasing the old cut', async t => {
  const f = await fixture(t, {project: true}), input = request('scenario');
  const turn = await f.turn(input, plan('scenario', input)); refusedAnswer(turn.answer);
  const pending = await f.review(input), oldFacts = (await f.rpc('memory.list')).facts;
  f.advance('2026-10-02T12:00:00.000Z');
  const revised = await f.rpc('sources.import', importedInput(SOURCE, true));
  assert.equal(revised.coverage.reconciled, true); assert.equal(revised.totalsMinor, '666');
  assert.notEqual(revised.recipeHash, f.imported.recipeHash); assert.notEqual(revised.id, f.imported.id);
  await f.refuse('conversation.ask', pending.payload, 'PREVIEW_STALE');
  await f.refuse('conversation.get', {id: turn.answer.id}, 'CONVERSATION_NOT_FOUND');
  assert.deepEqual((await f.rpc('conversation.history')).items, []); assert.equal(f.calls.length, 1);
  assert.notDeepEqual((await f.rpc('memory.list')).facts, oldFacts);
  f.advance(NEW_CUT); const fresh = request('scenario', {asOf: NEW_CUT});
  refusedAnswer((await f.turn(fresh, plan('scenario', fresh))).answer);
  assert.deepEqual(figures(f.captured.at(-1)!), {baseline: '32002', scenario: '33602', change: '1600', priceChangeBps: '500'});
  assert.equal(f.connectionCalls, 2); assert.deepEqual(f.custody().receipts, []);
});

test('republishing a custom definition invalidates pending review before provider execution', async t => {
  const f = await fixture(t, {project: true}), input = request('change'), pending = await f.review(input);
  const draft = structuredClone(f.draft);
  draft.definitions.find((definition: any) => definition.name === 'earned').meaning += ' Owner reviewed revision two.';
  const dictionary = await f.rpc('ontology.publish', {draft}); assert.notEqual(dictionary.hash, f.dictionary.hash);
  f.provider(plan('change', input)); await f.refuse('conversation.ask', pending.payload, 'BUSINESS_CONTEXT_STALE');
  assert.equal(f.calls.length, 0); assert.equal(f.captured.length, 0);
});

// Authored SQL responses qualify source compilation/public contracts only.
// They are labelled injected-sql and do not establish native execution.
for (const operation of ['change', 'scenario'] as const) {
  test(`public custom ${operation} retains exact receipt provenance through injected SQL compilation and reopen`, async t => {
    const expected = operation === 'change'
      ? {current: '30002', previous: '30000', change: '2', changeBps: '0'}
      : {baseline: '30002', scenario: '31502', change: '1500', priceChangeBps: '500'};
    const statements: {sql: string; parameters: (string | number | null)[]}[] = [];
    let closed = 0;
    const f = await fixture(t, {project: true, sqlConnection: {
      async execute(sql, parameters = []) {
        statements.push({sql, parameters: structuredClone(parameters)});
        return sql.startsWith('WITH ') ? [{...expected}] : [];
      }, close() {closed++;},
    }}), input = request(operation), facts = await f.rpc('memory.list');
    const turn = await f.turn(input, plan(operation, input));
    assert.equal(turn.answer.kind, 'grounded-conversation'); assert.equal(turn.answer.results[0].error, undefined);
    const receipt = turn.answer.results[0].answer;
    assert.deepEqual(figures(receipt), expected); assert.equal(receipt.databaseProof.verified, true);
    assert.equal(receipt.databaseProof.engine, 'injected-sql'); assert.equal(closed, 1);
    const amounts: Record<string, string> = {'current-start': '10001', 'current-end': '20001', prior: '30000'};
    assert.deepEqual(receipt.rows.map((row: any) => row.entityId).sort(), operation === 'change'
      ? ['current-end', 'current-start', 'prior'] : ['current-end', 'current-start']);
    for (const row of receipt.rows) {assert.equal(row.measureField, 'feeMinor'); assert.equal(row.amountMinor, amounts[row.entityId]);}
    assert.deepEqual(statements.filter(statement => statement.sql.startsWith('INSERT INTO receipt_definitions')).map(statement => statement.parameters),
      [['earned', 'sale', 1]]);
    assert.deepEqual(statements.filter(statement => statement.sql.startsWith('INSERT INTO receipt_rows')).map(statement => statement.parameters[2]).sort(),
      operation === 'change' ? ['10001', '20001', '30000'] : ['10001', '20001']);
    const query = statements.at(-1)!;
    assert.ok(query.sql.startsWith('WITH ')); assert.equal(query.sql.includes('feeMinor'), false);
    assert.deepEqual(query.parameters, operation === 'change' ? [PERIOD.from, PERIOD.to, PRIOR.from, PRIOR.to] : ['500']);
    const saved = (await f.rpc('trials.savedQuestions')).find((item: any) => item.receiptId === receipt.id);
    assert.ok(saved); assert.deepEqual(saved.request.sourceIds, [SOURCE]);
    if (operation === 'change') assert.deepEqual(saved.request.comparePeriod, PRIOR);
    else assert.deepEqual(saved.request.assumptions, {priceChangeBps: '00500'});
    assert.deepEqual(await f.rpc('memory.list'), facts); assert.equal(f.connectionCalls, 1);
    await f.restart(); assert.deepEqual(await f.rpc('receipts.get', {id: receipt.id}), receipt);
    assert.deepEqual((await f.rpc('conversation.get', {id: turn.answer.id})).answer, turn.answer);
    assert.equal(f.calls.length, 1); assert.equal(f.connectionCalls, 1);
  });
}
