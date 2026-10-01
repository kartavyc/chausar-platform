import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash } from '../runtime/contracts.ts';
import type { BenchmarkCase, ExpectedAnswer, Observation, PublicBenchmarkPort } from '../benchmarks/bilingual/contracts.ts';
import { FIXTURE_SOURCE, loadPackage, methodUrl, packageUrl, sha256, UNSUPPORTED_MESSAGE, validatePackage } from '../benchmarks/bilingual/fixture.ts';
import { expectedFor, observePublicCase, runBilingualBenchmark, scoreObservation, summarize, type ReceiptBinding } from '../benchmarks/bilingual/runner.ts';

// This suite qualifies authored synthetic source fixtures and public Engine APIs.
// It performs no model/provider dispatch, native launch, download, or real-vault access.
async function ownedScratch(t: TestContext) {
  const base = await realpath(resolve(tmpdir()));
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Synthetic test scratch must remain on C.');
  const directory = await mkdtemp(join(base, 'chausar-bilingual-tests-'));
  t.after(async () => {
    const target = await realpath(directory), child = relative(base, target);
    assert.ok(child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep) && !child.includes(sep));
    assert.ok(basename(target).startsWith('chausar-bilingual-tests-'));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

async function benchmarkCase(id: string) {
  const c = (await loadPackage()).data.cases.find(c => c.id === id);
  assert.ok(c, `The reviewed synthetic package must include ${id}.`);
  return c;
}

function answerObservation(c: BenchmarkCase): Extract<Observation, { kind: 'answer' }> {
  const e = expectedFor(c, 'en');
  assert.equal(e.kind, 'answer');
  const expected = e as ExpectedAnswer;
  return {
    kind: 'answer', receiptVerified: true, dictionaryVerified: true, scopeVerified: true,
    semantics: {
      operation: expected.operation, valueMinor: expected.valueMinor, totalMinor: expected.valueMinor,
      currency: expected.currency, figures: structuredClone(expected.figures), entities: [...expected.entities].sort(),
      completeness: expected.completeness, gaps: expected.requiredGap ? [expected.requiredGap] : [],
      excludedEntities: [...(expected.excludedEntities ?? [])], assumptions: { ...expected.assumptions },
      period: c.payload.period ?? null, comparePeriod: c.payload.comparePeriod ?? null, branch: c.payload.branch ?? null,
    },
  };
}

test('the pinned package contains bilingual worked oracles, exact arithmetic and disclosed parser limitations', async () => {
  const loaded = await loadPackage(), p = loaded.data;
  validatePackage(p);
  assert.equal(p.cases.length, 40);
  assert.equal(p.cases.filter(c => c.track === 'authored-typed-request').length, 31);
  assert.equal(p.cases.filter(c => c.track === 'local-question-parser').length, 9);
  assert.equal(p.fixtureOrigin, 'authored-synthetic');
  assert.deepEqual([p.hiddenDatasetsIncluded, p.sealedDatasetsIncluded, p.attackPackIncluded], [false, false, false]);
  for (const c of p.cases) {
    assert.match(c.question.hi, /[\u0900-\u097f]/, `${c.id} requires a Hindi question, not a language label.`);
    assert.match(c.worked.hi, /[\u0900-\u097f]/, `${c.id} requires a Hindi worked explanation.`);
    assert.ok(c.question.en.trim() && c.worked.en.trim());
  }
  assert.equal(loaded.fingerprints.questionsSha256, sha256(await readFile(packageUrl, 'utf8')));
  assert.equal(loaded.fingerprints.methodSha256, sha256(await readFile(methodUrl, 'utf8')));
  const get = (id: string) => expectedFor(p.cases.find(c => c.id === id)!, 'en') as ExpectedAnswer;
  assert.equal(get('earned').valueMinor, String(125025n + 79975n));
  assert.equal(get('net-sales').valueMinor, String(125025n + 79975n - 12500n));
  assert.equal(get('margin').valueMinor, String(205000n - 12500n - 58000n));
  assert.equal(get('margin').figures.marginBps, String(134500n * 10000n / 192500n));
  assert.equal(get('aging').valueMinor, String(220000n - 110000n - 12500n));
  assert.equal(get('large-integer').valueMinor, '9007199254740993');
  assert.deepEqual(get('earned').entities, ['order-a', 'order-b']);
  assert.ok(get('earned').excludedEntities!.includes('sale-after'));
  assert.deepEqual(expectedFor(p.cases.find(c => c.id === 'forbidden-branch')!, 'hi'),
    { kind: 'refusal', mechanism: 'error-code', code: 'FORBIDDEN_BRANCH' });
  const parser = p.cases.filter(c => c.track === 'local-question-parser');
  assert.equal(parser.filter(c => expectedFor(c, 'en').kind === 'answer').length, 5);
  assert.ok(parser.every(c => expectedFor(c, 'hi').kind === 'refusal'));
});

test('package validation refuses unbounded, incomplete, model-directed and unpinned oracles', async () => {
  const p = (await loadPackage()).data;
  const rejects = (change: (copy: any) => void) => {
    const copy = structuredClone(p); change(copy);
    assert.throws(() => validatePackage(copy));
  };
  rejects(copy => { copy.cases = []; });
  rejects(copy => { copy.cases = Array.from({ length: 101 }, (_, n) => ({ ...copy.cases[0], id: `case-${n}` })); });
  rejects(copy => { copy.cases[1].id = copy.cases[0].id; });
  rejects(copy => { copy.hiddenDatasetsIncluded = true; });
  rejects(copy => { copy.sealedDatasetsIncluded = true; });
  rejects(copy => { copy.attackPackIncluded = true; });
  rejects(copy => { copy.cases[0].method = 'models.dispatch'; });
  rejects(copy => { copy.cases[0].track = 'local-question-parser'; });
  rejects(copy => { delete copy.cases[0].question.hi; });
  rejects(copy => { copy.cases[0].worked.hi = ''; });
  rejects(copy => { copy.cases[0].question.en = 'x'.repeat(8001); });
  rejects(copy => { copy.cases[0].expected.valueMinor = '2200.00'; });
  rejects(copy => { copy.cases[0].expected.figures.total = 220000; });
  rejects(copy => { copy.cases[0].expected.entities = ['invoice-a', 'invoice-a']; });
  rejects(copy => { copy.cases.find((c: any) => c.id === 'parser-billed').expected.hi = undefined; });
  rejects(copy => { copy.cases.find((c: any) => c.id === 'unknown-operation').expected.code = 'unknown'; });
  rejects(copy => { copy.cases.find((c: any) => c.id === 'parser-billed').expected.hi.message = 'Close enough'; });
  for (const field of ['routeId', 'purpose', 'previewId', 'approvalId']) {
    rejects(copy => { copy.cases[0].payload[field] = 'an-unreviewed-provider-route'; });
  }
});

test('the scorer requires exact units, contributing identities, figures, limitations and public verification', async () => {
  const large = await benchmarkCase('large-integer'), largeAnswer = answerObservation(large);
  assert.equal(scoreObservation(large, 'hi', largeAnswer).outcome, 'right');
  const cases: [string, BenchmarkCase, (answer: Extract<Observation, { kind: 'answer' }>) => void][] = [
    ['rounded unsafe integer', large, o => { o.semantics.valueMinor = '9007199254740992'; o.semantics.totalMinor = '9007199254740992'; }],
    ['different total with unchanged display value', large, o => { o.semantics.totalMinor = '9007199254740992'; }],
    ['same value from different rows', await benchmarkCase('earned'), o => { o.semantics.entities = ['sale-draft']; }],
    ['extra same-value figure', large, o => { o.semantics.figures.unrequested = o.semantics.valueMinor; }],
    ['missing cancelled-payment exclusion', await benchmarkCase('received'), o => { o.semantics.excludedEntities = []; }],
    ['missing imported-cost limitation', await benchmarkCase('margin'), o => { o.semantics.gaps = []; }],
    ['missing scenario assumption', await benchmarkCase('price-scenario'), o => { delete o.semantics.assumptions.volume; }],
    ['unverified current receipt authority', large, o => { o.receiptVerified = false; }],
    ['unverified published meaning', large, o => { o.dictionaryVerified = false; }],
    ['unverified source/request scope', large, o => { o.scopeVerified = false; }],
  ];
  for (const [reason, c, change] of cases) {
    const answer = answerObservation(c); change(answer);
    const result = scoreObservation(c, 'en', answer);
    assert.equal(result.outcome, 'wrong', reason);
    assert.equal(result.correct, false, reason);
    assert.ok(result.mismatches.length > 0, reason);
  }
});

test('refusal mechanisms and correctness are distinct from disjoint right/wrong/refused counts', async () => {
  const answer = await benchmarkCase('earned'), refusal = await benchmarkCase('unknown-operation'), parser = await benchmarkCase('parser-refunds');
  const results = [
    scoreObservation(answer, 'en', answerObservation(answer)),
    scoreObservation(answer, 'en', { kind: 'invalid', reason: 'Non-receipt response' }),
    scoreObservation(answer, 'en', { kind: 'refusal', mechanism: 'error-code', code: 'SOURCE_REVOKED' }),
    scoreObservation(refusal, 'en', { kind: 'refusal', mechanism: 'error-code', code: 'UNKNOWN_CALCULATION' }),
    scoreObservation(refusal, 'en', { kind: 'refusal', mechanism: 'unsupported-question', message: UNSUPPORTED_MESSAGE }),
    scoreObservation(parser, 'hi', { kind: 'refusal', mechanism: 'unsupported-question', message: UNSUPPORTED_MESSAGE }),
  ];
  assert.deepEqual(summarize(results), {
    total: 6, right: 1, wrong: 1, refused: 4, correct: 3, incorrect: 3,
    expectedRefusals: 3, matchedRefusals: 2, unexpectedRefusals: 1,
  });
  assert.equal(results[2].correct, false, 'An unexpected refusal never earns correctness.');
  assert.equal(results[4].correct, false, 'A different refusal mechanism never matches the oracle.');
  const wrongCode = scoreObservation(refusal, 'hi', { kind: 'refusal', mechanism: 'error-code', code: 'FORBIDDEN_BRANCH' });
  assert.equal(wrongCode.outcome, 'refused'); assert.equal(wrongCode.correct, false);
  const wrongMessage = scoreObservation(parser, 'hi', { kind: 'refusal', mechanism: 'unsupported-question', message: 'Unable to answer' });
  assert.equal(wrongMessage.outcome, 'refused'); assert.equal(wrongMessage.correct, false);
});

function syntheticReceipt(c: BenchmarkCase) {
  const e = expectedFor(c, 'en') as ExpectedAnswer;
  const definitions = [{ name: 'earned_source_semantics', version: 1, expression: 'synthetic earned rows' }];
  const dictionary = { hash: 'synthetic-published-dictionary-hash', version: 1, definitions,
    operations: [{ id: e.operation, definitions: ['earned_source_semantics'] }] };
  const fact = { id: 'synthetic-fact', entityId: e.entities[0], sourceId: FIXTURE_SOURCE, sourceRow: 1,
    kind: 'sale', validFrom: '2026-09-15', branch: 'main', fields: { amountMinor: e.valueMinor } };
  const receipt = { id: 'synthetic-receipt', operation: e.operation, valueMinor: e.valueMinor, totalMinor: e.valueMinor,
    currency: e.currency, dictionaryHash: dictionary.hash, ontologyVersion: dictionary.version, definitions,
    definitionHash: hash(definitions), period: c.payload.period ?? null, comparePeriod: null, branch: null,
    requestedSourceIds: undefined, stale: false, assumptions: {},
    rows: [{ factId: fact.id, entityId: fact.entityId, sourceId: fact.sourceId, sourceRow: fact.sourceRow,
      kind: fact.kind, validFrom: fact.validFrom, branch: fact.branch, amountMinor: fact.fields.amountMinor }],
    rowIds: [fact.id], figures: [{ key: 'total', minor: e.valueMinor, currency: e.currency, unit: 'money' }],
    exclusions: [], coverage: { countedRows: 1, completeness: e.completeness, gaps: [] },
  };
  const binding: ReceiptBinding = { dictionary, factsById: new Map([[fact.id, fact]]), entitiesByFactId: new Map([[fact.id, fact.entityId]]) };
  return { receipt, binding };
}

test('public observation cannot count inaccessible, forged-definition or mismatched-scope receipts as right', async () => {
  const c = await benchmarkCase('large-integer');
  type Receipt = ReturnType<typeof syntheticReceipt>['receipt'];
  const variants: [string, (receipt: Receipt) => void, string?][] = [
    ['readback no longer authorized', () => {}, 'SOURCE_REVOKED'],
    ['dictionary hash differs', r => { r.dictionaryHash = 'an-unpublished-definition'; }],
    ['definition hash differs', r => { r.definitionHash = '0'.repeat(64); }],
    ['contributing source row differs', r => { r.rows[0].sourceRow = 999; }],
    ['fact amount differs', r => { r.rows[0].amountMinor = '1'; }],
    ['row identity omitted', r => { r.rowIds = []; }],
    ['period substituted', r => { r.period = { from: '2026-08-01', to: '2026-08-31' }; }],
    ['hidden source selection', r => { (r as any).requestedSourceIds = ['another-source']; }],
    ['stale receipt', r => { r.stale = true; }],
    ['incorrect coverage row count', r => { r.coverage.countedRows = 2; }],
    ['duplicated figure', r => { r.figures.push({ ...r.figures[0] }); }],
    ['foreign monetary unit', r => { (r.figures[0] as { currency: string }).currency = 'USD'; }],
  ];
  const pristine = syntheticReceipt(c), calls: string[] = [];
  const cleanPort: PublicBenchmarkPort = { request: async method => { calls.push(method); return structuredClone(pristine.receipt); } };
  const clean = await observePublicCase(cleanPort, c, 'en', pristine.binding);
  assert.equal(scoreObservation(c, 'en', clean).outcome, 'right');
  assert.deepEqual(calls, ['calculation.run', 'receipts.get']);
  for (const [reason, change, readbackCode] of variants) {
    const { receipt, binding } = syntheticReceipt(c); change(receipt);
    const port: PublicBenchmarkPort = { request: async method => {
      if (method === 'receipts.get' && readbackCode) throw Object.assign(new Error('Synthetic current-authority refusal'), { code: readbackCode });
      return structuredClone(receipt);
    } };
    const observation = await observePublicCase(port, c, 'hi', binding), scored = scoreObservation(c, 'hi', observation);
    assert.equal(scored.outcome, 'wrong', reason); assert.equal(scored.correct, false, reason);
    if (readbackCode) {
      assert.equal(observation.kind, 'answer', 'Readback refusal cannot replace the answer with a matched refusal.');
      assert.equal((observation as Extract<Observation, { kind: 'answer' }>).receiptVerified, false);
    }
  }
  const { receipt, binding } = syntheticReceipt(c);
  const hiddenCustomer = structuredClone(c); hiddenCustomer.payload.customerId = 'different-customer';
  const port: PublicBenchmarkPort = { request: async () => structuredClone(receipt) };
  assert.equal(scoreObservation(hiddenCustomer, 'en', await observePublicCase(port, hiddenCustomer, 'en', binding)).outcome, 'wrong');
});

test('the parser track submits the original Hindi question and receives its exact unsupported response', async () => {
  const c = await benchmarkCase('parser-billed');
  const submitted: { method: string; payload?: Record<string, unknown> }[] = [];
  const port: PublicBenchmarkPort = { request: async (method, payload) => {
    submitted.push({ method, payload }); return { supported: false, receipt: null, message: UNSUPPORTED_MESSAGE };
  } };
  const binding: ReceiptBinding = { dictionary: {}, entitiesByFactId: new Map(), factsById: new Map() };
  const observation = await observePublicCase(port, c, 'hi', binding);
  assert.deepEqual(submitted, [{ method: 'conversation.ask', payload: { ...c.payload, question: c.question.hi } }]);
  const result = scoreObservation(c, 'hi', observation);
  assert.equal(result.outcome, 'refused'); assert.equal(result.correct, true);
  const malformed: PublicBenchmarkPort = { request: async () => ({ supported: false, message: UNSUPPORTED_MESSAGE }) };
  const missingReceipt = await observePublicCase(malformed, c, 'hi', binding);
  assert.equal(missingReceipt.kind, 'invalid', 'A missing receipt field is not the public unsupported-question contract.');
  assert.equal(scoreObservation(c, 'hi', missingReceipt).outcome, 'wrong');
});

test('two fresh public Engine runs retain all 80 outcomes, stable meaning and honest synthetic qualification', async t => {
  const directory = await ownedScratch(t), firstScratch = join(directory, 'first'), secondScratch = join(directory, 'second');
  const first = await runBilingualBenchmark({ scratchRoot: firstScratch });
  assert.equal(first.schema, 'chausar.bilingual-synthetic-report.v1'); assert.equal(first.passed, true);
  assert.deepEqual(first.score, { total: 80, right: 39, wrong: 0, refused: 41, correct: 80, incorrect: 0,
    expectedRefusals: 41, matchedRefusals: 41, unexpectedRefusals: 0 });
  assert.deepEqual([first.byLanguage.en.right, first.byLanguage.en.refused, first.byLanguage.hi.right, first.byLanguage.hi.refused], [22, 18, 17, 23]);
  const typed = first.byTrack['authored-typed-request'], parser = first.byTrack['local-question-parser'];
  assert.deepEqual([typed.total.total, typed.total.right, typed.total.refused], [62, 34, 28]);
  assert.deepEqual([parser.total.total, parser.total.right, parser.total.refused], [18, 5, 13]);
  assert.deepEqual([parser.byLanguage.en.right, parser.byLanguage.en.refused, parser.byLanguage.hi.right, parser.byLanguage.hi.refused], [5, 4, 0, 9]);
  assert.equal(first.results.length, 80); assert.ok(first.results.every(result => result.correct));
  assert.equal(first.execution.fixtureWorkspaces, 6); assert.equal(first.execution.storage, 'experimental-file');
  assert.equal(first.qualification.modelDispatches, 0);
  assert.equal(first.qualification.modelQualityQualified, false);
  assert.equal(first.qualification.hindiUnderstandingQualified, false);
  assert.equal(first.qualification.productionQualified, false);
  assert.equal(first.qualification.publicDistributionApproved, false);
  assert.deepEqual([first.qualification.nativeStorage, first.qualification.nativeGui, first.qualification.cleanMachine, first.qualification.textToSqlComparison], ['not-run', 'not-run', 'not-run', 'not-run']);
  assert.deepEqual([first.qualification.hiddenDatasets, first.qualification.sealedDatasets, first.qualification.attackPack], ['excluded-not-run', 'excluded-not-run', 'excluded-not-run']);
  assert.equal(first.qualification.securityAudit, 'blocked-unverified');
  assert.match(first.qualification.measureInterchange, /pinned-reviewed-schema-required/);
  assert.match(first.method.bilingualPairDependence, /not independent model trials/);
  assert.deepEqual(await readdir(firstScratch), [], 'A successful run cleans its owned encrypted synthetic workspaces.');
  const second = await runBilingualBenchmark({ scratchRoot: secondScratch });
  assert.equal(second.passed, true); assert.deepEqual(second.score, first.score);
  assert.deepEqual(second.results, first.results, 'Random encrypted-storage identities must not change semantic outcomes.');
  assert.deepEqual(second.fingerprints, first.fingerprints);
  assert.match(first.fingerprints.semanticRunSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readdir(secondScratch), []);
});

test('CLI refuses unsupported options and escaped output before creating a synthetic workspace', async t => {
  const directory = await ownedScratch(t);
  const script = fileURLToPath(new URL('../../scripts/bilingual-benchmark.mjs', import.meta.url));
  for (const args of [
    ['--model', 'live-provider'], ['--output', '../outside.json'], ['--output', join(directory, 'absolute.json')],
    ['--output', 'report.txt'], ['--output', '.git/report.json'], ['--output', '.GIT/report.json'], ['--output', ''],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /Usage:|relative JSON path inside this source copy/);
    assert.equal(result.stdout, '', 'Invalid input does not emit a qualification report.');
  }
  assert.deepEqual(await readdir(directory), []);
});
