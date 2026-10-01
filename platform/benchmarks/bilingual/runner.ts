import { deepStrictEqual } from 'node:assert';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import { hash, type Context } from '../../runtime/contracts.ts';
import type { BenchmarkCase, CaseResult, ExpectedAnswer, ExpectedRefusal, FixtureId, Language, Observation, PublicBenchmarkPort, Score, Track } from './contracts.ts';
import { canonical, FIXTURE_SOURCE, importInput, invariant, loadPackage, PERIOD, sha256 } from './fixture.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const languages: Language[] = ['en', 'hi'];
const tracks: Track[] = ['authored-typed-request', 'local-question-parser'];
export type ReceiptBinding = { dictionary: any; entitiesByFactId: Map<string, string>; factsById: Map<string, any>; savedReceiptId?: string };
type Binding = ReceiptBinding;
type Fixture = { engine: Engine; port: PublicBenchmarkPort; binding: Binding; directory: string; forbiddenDispatches: () => number };
export type RunOptions = { scratchRoot: string };

function exact(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
export function expectedFor(c: BenchmarkCase, language: Language): ExpectedAnswer | ExpectedRefusal { return 'kind' in c.expected ? c.expected : c.expected[language]; }
export function scoreObservation(c: BenchmarkCase, language: Language, observation: Observation): CaseResult {
  const expected = expectedFor(c, language), mismatches: string[] = [];
  const mismatch = (condition: boolean, detail: string) => { if (!condition) mismatches.push(detail); };
  mismatch(expected.kind === observation.kind, `Expected ${expected.kind}, observed ${observation.kind}.`);
  if (expected.kind === 'answer' && observation.kind === 'answer') {
    const actual = observation.semantics;
    mismatch(actual.operation === expected.operation, 'Operation differs.');
    mismatch(actual.valueMinor === expected.valueMinor && actual.totalMinor === expected.valueMinor, 'Exact minor-unit amount differs.');
    mismatch(actual.currency === expected.currency, 'Currency differs.');
    mismatch(exact(actual.figures, expected.figures), 'Exact figure set differs.');
    mismatch(exact(actual.entities, [...expected.entities].sort()), 'Contributing entity set differs.');
    mismatch(actual.completeness === expected.completeness, 'Coverage completeness differs.');
    mismatch(observation.receiptVerified && observation.dictionaryVerified && observation.scopeVerified, 'Public receipt readback, definition or request scope is unverified.');
    if (expected.requiredGap) mismatch(actual.gaps.some(gap => gap.includes(expected.requiredGap!)), 'Required limitation is absent.');
    if (expected.excludedEntities) mismatch(expected.excludedEntities.every(entity => actual.excludedEntities.includes(entity)), 'Required excluded source rows are absent.');
    if (expected.assumptions) mismatch(Object.entries(expected.assumptions).every(([key, value]) => actual.assumptions[key] === value), 'Declared assumptions or limitations differ.');
  }
  if (expected.kind === 'refusal' && observation.kind === 'refusal') {
    mismatch(expected.mechanism === observation.mechanism, 'Refusal mechanism differs.');
    if (expected.mechanism === 'error-code' && observation.mechanism === 'error-code') mismatch(expected.code === observation.code, 'Refusal code differs.');
    if (expected.mechanism === 'unsupported-question' && observation.mechanism === 'unsupported-question') mismatch(expected.message === observation.message, 'Unsupported-question message differs.');
  }
  if (observation.kind === 'invalid') mismatches.push(observation.reason);
  const correct = mismatches.length === 0;
  // Refused is an observed outcome, even if the oracle required an answer or a different refusal.
  const outcome = observation.kind === 'refusal' ? 'refused' : correct ? 'right' : 'wrong';
  return { id: c.id, language, track: c.track, question: c.question[language], expectedKind: expected.kind, outcome, correct, mismatches, observation };
}
export function summarize(results: CaseResult[]): Score {
  const count = (predicate: (result: CaseResult) => boolean) => results.filter(predicate).length;
  return { total: results.length, right: count(r => r.outcome === 'right'), wrong: count(r => r.outcome === 'wrong'), refused: count(r => r.outcome === 'refused'),
    correct: count(r => r.correct), incorrect: count(r => !r.correct), expectedRefusals: count(r => r.expectedKind === 'refusal'),
    matchedRefusals: count(r => r.expectedKind === 'refusal' && r.outcome === 'refused' && r.correct), unexpectedRefusals: count(r => r.expectedKind === 'answer' && r.outcome === 'refused') };
}
export async function observePublicCase(port: PublicBenchmarkPort, c: BenchmarkCase, language: Language, binding: Binding): Promise<Observation> {
  const payload = structuredClone(c.payload);
  if (c.method === 'conversation.ask') payload.question = c.question[language];
  if (c.method === 'receipts.get') { invariant(binding.savedReceiptId, 'A saved-receipt fixture must provide its public receipt identity.'); payload.id = binding.savedReceiptId; }
  let response: any;
  try { response = await port.request(c.method, payload); }
  catch (error: unknown) {
    const code = (error as { code?: unknown })?.code;
    return typeof code === 'string' ? { kind: 'refusal', mechanism: 'error-code', code } : { kind: 'invalid', reason: `Public API threw without a product refusal code: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response?.supported === false) {
    if (response.receipt !== null || typeof response.message !== 'string') return { kind: 'invalid', reason: 'Unsupported response must contain a message and a null receipt.' };
    return { kind: 'refusal', mechanism: 'unsupported-question', message: response.message };
  }
  const receipt = c.method === 'conversation.ask' ? response?.supported === true ? response.receipt : undefined : response;
  if (!receipt || typeof receipt.id !== 'string' || typeof receipt.valueMinor !== 'string' || !Array.isArray(receipt.rows) || !Array.isArray(receipt.rowIds)
    || !Array.isArray(receipt.figures) || !Array.isArray(receipt.exclusions) || !receipt.coverage || !Array.isArray(receipt.coverage.gaps)) return { kind: 'invalid', reason: 'Public result is not a calculation receipt.' };
  let receiptVerified = false;
  try { deepStrictEqual(await port.request('receipts.get', { id: receipt.id }), receipt); receiptVerified = true; } catch { /* Record a failed current-authority readback as wrong, never as a matched refusal. */ }
  const definitions = binding.dictionary.definitions.filter((definition: any) => binding.dictionary.operations.find((operation: any) => operation.id === receipt.operation)?.definitions.includes(definition.name));
  const dictionaryVerified = receipt.dictionaryHash === binding.dictionary.hash && receipt.ontologyVersion === binding.dictionary.version
    && exact(receipt.definitions, definitions) && receipt.definitionHash === hash(definitions);
  const seen = new Set<string>();
  const rowsBound = receipt.rows.every((row: any) => {
    const fact = binding.factsById.get(row.factId);
    if (!fact || seen.has(row.factId)) return false;
    seen.add(row.factId);
    return fact.entityId === row.entityId && row.sourceId === FIXTURE_SOURCE && fact.sourceId === row.sourceId
      && fact.sourceRow === row.sourceRow && fact.kind === row.kind && fact.validFrom === row.validFrom
      && fact.branch === row.branch && fact.fields.amountMinor === row.amountMinor;
  });
  const scopeVerified = rowsBound && exact([...receipt.rowIds].sort(), [...seen].sort()) && exact(receipt.period, payload.period ?? null)
    && exact(receipt.comparePeriod, payload.comparePeriod ?? null) && exact(receipt.branch, payload.branch ?? null)
    && exact(receipt.requestedSourceIds, payload.sourceIds)
    && (payload.asOf === undefined || receipt.asOf === new Date(String(payload.asOf)).toISOString())
    && (payload.onDate === undefined || receipt.assumptions.onDate === payload.onDate)
    && receipt.rows.every((row: any) => (payload.customerId === undefined || row.customerId === payload.customerId)
      && (payload.orderId === undefined || row.orderId === payload.orderId) && (payload.branch === undefined || row.branch === payload.branch))
    && receipt.coverage.countedRows === receipt.rows.length && receipt.stale === false;
  const figures: Record<string, string> = {};
  for (const figure of receipt.figures) {
    if (!figure || typeof figure.key !== 'string' || Object.hasOwn(figures, figure.key) || typeof figure.minor !== 'string' || !/^-?\d+$/.test(figure.minor)
      || !['money', 'basis-points'].includes(figure.unit) || figure.unit === 'money' && figure.currency !== receipt.currency) return { kind: 'invalid', reason: 'Receipt figures are malformed, duplicated or have inconsistent units.' };
    figures[figure.key] = figure.minor;
  }
  return { kind: 'answer', receiptVerified, dictionaryVerified, scopeVerified,
    semantics: { operation: receipt.operation, valueMinor: receipt.valueMinor, totalMinor: receipt.totalMinor, currency: receipt.currency, figures,
      entities: receipt.rows.map((row: any) => row.entityId).sort(), completeness: receipt.coverage.completeness, gaps: [...receipt.coverage.gaps],
      excludedEntities: [...new Set<string>(receipt.exclusions.map((row: any) => binding.entitiesByFactId.get(row.rowId) ?? '<unknown-row>'))].sort(),
      assumptions: receipt.assumptions, period: receipt.period, comparePeriod: receipt.comparePeriod, branch: receipt.branch } };
}

async function makeFixture(id: FixtureId, scratchRoot: string, shop: string, large: string): Promise<Fixture> {
  const directory = await mkdtemp(join(scratchRoot, 'chausar-bilingual-'));
  let dispatches = 0;
  const deniedTransport = async () => { dispatches++; throw new Error('Live and synthetic provider dispatch are forbidden in this benchmark.'); };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: deniedTransport, process: deniedTransport } });
  try {
    await engine.request('workspace.create', { name: 'Synthetic Bilingual Shop', folder: 'bench', passphrase: 'Synthetic disposable bilingual benchmark passphrase', demo: false, pack: 'ecommerce' });
    const dictionary = await engine.request('ontology.publish', { pack: 'ecommerce' });
    const input = importInput(id === 'large' ? large : shop, id === 'large');
    const imported = await engine.request('sources.import', input);
    invariant(imported.coverage.reconciled === true && imported.rowIds.length === input.expectedTotals!.rowCount, 'Synthetic source controls did not reconcile.');
    invariant((await engine.request('sources.import', input)).duplicate === true, 'Duplicate fixture import must remain idempotent.');
    const facts = (await engine.request('memory.list')).facts;
    invariant(facts.length === input.expectedTotals!.rowCount, 'Duplicate synthetic imports changed source row count.');
    const binding: Binding = { dictionary, entitiesByFactId: new Map(facts.map((fact: any) => [fact.id, fact.entityId])), factsById: new Map(facts.map((fact: any) => [fact.id, fact])) };
    let context = owner;
    if (['viewer-main', 'member-revoked', 'other-receipt-owner'].includes(id)) {
      const member = await engine.request('members.add', { id: 'benchmark-viewer', name: 'Synthetic main-only viewer', role: 'viewer', branches: ['main'] });
      context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
      if (id === 'member-revoked') await engine.request('members.revoke', { id: member.id });
      if (id === 'other-receipt-owner') binding.savedReceiptId = (await engine.request('calculation.run', { operation: 'earned', period: PERIOD })).id;
    }
    if (id === 'source-revoked') await engine.request('trust.update', { allowedSources: [] });
    const port: PublicBenchmarkPort = { request: (method, payload = {}) => engine.requestAs(context, method, payload) };
    return { engine, port, binding, directory, forbiddenDispatches: () => dispatches };
  } catch (error) { await engine.close(); await removeFixture(scratchRoot, directory); throw error; }
}
async function removeFixture(scratchRoot: string, directory: string) {
  const parent = await realpath(scratchRoot), target = await realpath(directory), child = relative(parent, target);
  invariant(child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep) && !child.includes(sep) && basename(target).startsWith('chausar-bilingual-'), 'Refusing cleanup outside the direct owned synthetic scratch directory.');
  await rm(target, { recursive: true, force: true });
}
function completedCalculations(activity: any): number { return activity.items.filter((item: any) => item.event === 'calculation.completed').length; }

export async function runBilingualBenchmark(options: RunOptions) {
  invariant(options && typeof options.scratchRoot === 'string' && options.scratchRoot.length > 0, 'An explicit owned scratch root is required.');
  const scratchRoot = resolve(options.scratchRoot);
  if (process.platform === 'win32') invariant(/^C:\\/i.test(scratchRoot), 'Windows synthetic benchmark scratch must stay on C.');
  let existingAncestor = scratchRoot;
  for (;;) {
    try { existingAncestor = await realpath(existingAncestor); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = dirname(existingAncestor); if (parent === existingAncestor) throw error; existingAncestor = parent; }
  }
  if (process.platform === 'win32') invariant(/^C:\\/i.test(existingAncestor), 'Resolved synthetic benchmark scratch must stay on C.');
  await mkdir(scratchRoot, { recursive: true });
  const loaded = await loadPackage(), fixtures = new Map<FixtureId, Fixture>(), results: CaseResult[] = [];
  const startedAt = new Date().toISOString(); let providerDispatches = 0;
  try {
    for (const c of loaded.data.cases) {
      let fixture = fixtures.get(c.fixture);
      if (!fixture) { fixture = await makeFixture(c.fixture, scratchRoot, loaded.shop, loaded.large); fixtures.set(c.fixture, fixture); }
      for (const language of languages) {
        const before = await fixture.engine.request('activity.list');
        const observation = await observePublicCase(fixture.port, c, language, fixture.binding);
        const after = await fixture.engine.request('activity.list');
        const result = scoreObservation(c, language, observation);
        if (observation.kind === 'refusal' && completedCalculations(before) !== completedCalculations(after)) { result.correct = false; result.mismatches.push('Refused request retained a completed calculation.'); }
        results.push(result);
      }
    }
    for (const fixture of fixtures.values()) {
      const activity = await fixture.engine.request('activity.list');
      invariant(activity.modelReceipts.length === 0 && fixture.forbiddenDispatches() === 0, 'Benchmark attempted model dispatch or created model receipts.');
      providerDispatches += fixture.forbiddenDispatches();
    }
    const byLanguage = Object.fromEntries(languages.map(language => [language, summarize(results.filter(r => r.language === language))]));
    const byTrack = Object.fromEntries(tracks.map(track => [track, { total: summarize(results.filter(r => r.track === track)),
      byLanguage: Object.fromEntries(languages.map(language => [language, summarize(results.filter(r => r.track === track && r.language === language))])) }]));
    const dictionary = fixtures.get('shop')!.binding.dictionary;
    const dictionarySemantics = { pack: dictionary.pack, currency: dictionary.currency, gstMode: dictionary.gstMode, fields: dictionary.fields, definitions: dictionary.definitions, operations: dictionary.operations, version: dictionary.version };
    const score = summarize(results), passed = score.incorrect === 0 && results.length === loaded.data.cases.length * 2;
    const stable = { package: loaded.fingerprints, dictionarySemanticsSha256: sha256(canonical(dictionarySemantics)), score, byLanguage, byTrack, results };
    return { schema: 'chausar.bilingual-synthetic-report.v1', packageVersion: 1, passed, score, byLanguage, byTrack,
      fingerprints: { ...loaded.fingerprints, dictionarySemanticsSha256: stable.dictionarySemanticsSha256, semanticRunSha256: sha256(canonical(stable)) },
      qualification: { scope: 'Deterministic authored synthetic fixtures through public Engine APIs', typedSelection: 'authored-reference-requests',
        questionParser: 'actual-local-literal-parser', modelDispatches: providerDispatches, modelQualityQualified: false, hindiUnderstandingQualified: false,
        textToSqlComparison: 'not-run', nativeStorage: 'not-run', nativeGui: 'not-run', cleanMachine: 'not-run',
        publicDistributionApproved: false, hiddenDatasets: 'excluded-not-run', sealedDatasets: 'excluded-not-run', attackPack: 'excluded-not-run',
        productionQualified: false, securityAudit: 'blocked-unverified', measureInterchange: 'not-run-pinned-reviewed-schema-required' },
      method: { money: 'Exact integer minor-unit strings; truncated basis points', outcome: 'right/wrong/refused are disjoint observed outcomes; correctness checks expected refusals separately',
        sourceFingerprints: 'SHA-256 over UTF-8 source text with CRLF normalized to LF for portable fresh-copy equivalence',
        semanticDigest: 'Excludes random receipt/fact/import/workspace identities, absolute scratch paths, and wall-clock creation/publication/as-of timestamps; retains source hashes, case results and meaning',
        bilingualPairDependence: 'Two language labels on the same authored typed request are not independent model trials' },
      execution: { startedAt, finishedAt: new Date().toISOString(), nodeVersion: process.version, storage: 'experimental-file', fixtureWorkspaces: fixtures.size }, results };
  } finally {
    for (const fixture of fixtures.values()) { await fixture.engine.close(); await removeFixture(scratchRoot, fixture.directory); }
  }
}
