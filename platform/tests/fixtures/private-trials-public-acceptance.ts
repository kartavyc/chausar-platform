import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Engine } from '../../runtime/engine.ts';
import type { Context, Member } from '../../runtime/contracts.ts';
import type { CalculationReceipt, CalculationRequest } from '../../runtime/calculator.ts';
import type { ImportInput, MappingRecipe } from '../../runtime/ingest.ts';
import type { Dictionary } from '../../runtime/ontology.ts';
import type { PrivateTrialChange, PrivateTrialEvaluation, PrivateTrialVersionPin } from '../../runtime/private-trial-contracts.ts';
import { harness } from './conversation-acceptance-renderer.ts';

// Fresh synthetic encrypted custody, actual preload/strict IPC and real Engine.
// This fixture grants no native database, connector, provider or security qualification.
export const SOURCE = 'private-trial-acceptance-register';
export const CLOCK = '2026-10-02T12:00:00.000Z';
export const LEARNED = '2026-09-30T23:59:58.000Z';
export const CUT = '2026-09-30T23:59:59.000Z';
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const SECRET = 'SYNTHETIC_PRIVATE_TRIAL_CUSTODY_MARKER_7F49';
const PASSWORD = 'Synthetic private trials fixture only';
const COMPANY = 'Synthetic private trials business';

function recipe(): MappingRecipe {
  return { version: 1, id: 'private-trial-acceptance-map', system: 'synthetic-csv', edition: '1',
    scope: { company: COMPANY, branches: ['main'] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      { target: 'status', source: 'status', type: 'string', nulls: 'reject', values: { OPEN: 'settled', CANCEL: 'settled' } },
      ...['currency', 'branch', 'description'].map(target => ({ target, source: target, type: 'string' as const, nulls: 'reject' as const })),
    ], allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['settled', 'cancelled'], onUnmapped: 'reject' };
}

export async function fixture(t: TestContext, mode: 'definition' | 'recipe' = 'definition', actor?: 'cofounder',
  optionsForSource: { reorderedCapture?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(LEARNED) });
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-private-trial-acceptance-'));
  const options = { directory, demo: true, storage: 'experimental-file' as const };
  let engine = new Engine(options), context: Context | undefined;
  t.after(async () => {
    await engine.close();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-private-trial-acceptance-'));
    await rm(target, { recursive: true, force: true });
  });
  const created = await engine.request('workspace.create', { name: COMPANY, folder: 'acceptance',
    passphrase: PASSWORD, demo: false, pack: 'retail' });
  const h = await harness({ dispatch: (method, payload) => context
    ? engine.requestAs(context, method, payload) : engine.request(method, payload), mount: true });
  h.renderer.state.workspace = created.workspace;
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => h.exposed.request(method, payload);
  await request('trust.update', { retentionDays: 3650 });
  const author: Member | undefined = actor ? await request('members.add', {
    name: 'Synthetic private trial author', role: 'cofounder', branches: ['main'],
  }) : undefined;
  if (author) context = { memberId: author.id, role: author.role, epoch: author.epoch, channel: 'desktop' };
  const mapping = recipe();
  const rows = mode === 'definition' ? [
    `huge,invoice,2026-09-10,900719925474099325,30,INR,main,OPEN,${SECRET}`,
    `small,invoice,2026-09-11,75,70,INR,main,OPEN,${SECRET}`,
    `payment,payment,2026-09-12,7000,0,INR,main,OPEN,${SECRET}`,
    `earned,sale,2026-09-13,12500,0,INR,main,OPEN,${SECRET}`,
  ] : [`one,invoice,2026-09-10,10000,30,INR,main,OPEN,${SECRET}`,
    `two,invoice,2026-09-11,20000,70,INR,main,CANCEL,${SECRET}`];
  const input: ImportInput = { sourceId: SOURCE, format: 'csv',
    content: ['id,kind,date,amount,tax,currency,branch,status,description', ...rows].join('\n'), recipe: mapping,
    expectedTotals: { rowCount: rows.length, amountMinor: mode === 'definition' ? '900719925474118900' : '30000' },
    installation: { company: COMPANY, edition: '1' } };
  const imported = await request('sources.import', input);
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, input.expectedTotals!.amountMinor);
  const reorderedInput: ImportInput | undefined = optionsForSource.reorderedCapture
    ? { ...input, content: ['id,kind,date,amount,tax,currency,branch,status,description', ...[...rows].reverse()].join('\r\n') }
    : undefined;
  const reordered = reorderedInput && await request('sources.import', reorderedInput);
  if (reordered) {
    assert.notEqual(reordered.id, imported.id); assert.notEqual(reordered.contentHash, imported.contentHash);
    assert.equal(reordered.coverage.reconciled, true); assert.equal(reordered.totalsMinor, input.expectedTotals!.amountMinor);
    assert.deepEqual(reordered.rowIds, [...imported.rowIds].reverse(), 'Reexport occurrence order preserves each deduplicated source claim.');
  }
  t.mock.timers.setTime(Date.parse(CLOCK));
  const dictionary = (await request('ontology.get')).current as Dictionary;
  const requests: CalculationRequest[] = ['billed', 'received', 'earned'].map(operation => ({ operation,
    sourceIds: [SOURCE], branch: 'main', period: { ...PERIOD }, asOf: CUT }));
  const receipts: CalculationReceipt[] = [];
  for (const original of requests) receipts.push(await request('calculation.run', original));
  assert.deepEqual(receipts.map(receipt => receipt.totalMinor), mode === 'definition'
    ? ['900719925474099400', '7000', '12500'] : ['30000', '0', '0']);
  assert.ok(receipts.every(receipt => !receipt.stale && receipt.asOf === CUT));
  const replacement = structuredClone(dictionary.definitions.find(definition => definition.name === 'billed')!);
  replacement.field = 'taxMinor'; replacement.meaning = 'Synthetic private trial: only explicitly imported invoice tax, by invoice date.';
  const candidateRecipe = structuredClone(mapping);
  candidateRecipe.bindings.find(binding => binding.target === 'status')!.values!.CANCEL = 'cancelled';
  const change: PrivateTrialChange = mode === 'definition' ? { type: 'definition', name: 'billed', replacement }
    : { type: 'recipe', sourceId: SOURCE, recipeId: mapping.id, replacement: candidateRecipe };
  async function evidence() {
    return { ontology: await request('ontology.get'), facts: await request('memory.list'),
      imports: await request('sources.list'), receipts: await Promise.all(receipts.map(receipt => request('receipts.get', { id: receipt.id }))) };
  }
  async function disk() {
    const files: { path: string; bytes: number; body: Buffer }[] = [];
    async function visit(folder: string) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        assert.equal(entry.isSymbolicLink(), false, 'Owned fixture custody cannot traverse a symbolic link.');
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && entry.name !== 'writer.lock') {
          const body = await readFile(path); files.push({ path: relative(directory, path), bytes: body.length, body });
        }
      }
    }
    await visit(join(directory, 'acceptance'));
    assert.ok(files.length > 0); assert.ok(files.every(file => !file.body.includes(Buffer.from(SECRET))));
    return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
  }
  async function reopen() {
    await request('workspace.lock'); await engine.close(); engine = new Engine(options);
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  const as = (member?: Member) => { context = member && { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' }; };
  function advance(milliseconds = 1000) { t.mock.timers.setTime(Date.now() + milliseconds); }
  return { h, request, requests, receipts, dictionary, change, input, imported, reorderedInput, reordered,
    evidence, disk, reopen, as, advance, directory, author };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

// Coordinator-observed public contract; verify against the final committed join
// before execution. A receipt ID is not a saved answer ID.
export async function selectSavedAnswers(f: Fixture, receipts = f.receipts): Promise<string[]> {
  const answers = await f.request('trials.savedQuestions');
  assert.ok(Array.isArray(answers), 'The public selector must return authenticated saved calculation answers.');
  return receipts.map(receipt => {
    const matches = answers.filter((answer: any) => answer.receiptId === receipt.id);
    assert.equal(matches.length, 1, 'Each selected receipt must resolve to one public saved answer.');
    const answer = matches[0]; assert.match(answer.id, /^[A-Za-z0-9_.:-]{1,200}$/);
    const original = f.requests.find(request => request.operation === receipt.operation);
    if (original) assert.deepEqual(answer.request, original);
    else {
      assert.equal(receipt.operation, 'scenario');
      assert.deepEqual(answer.request, { operation: 'scenario', sourceIds: [SOURCE], branch: 'main',
        period: { ...PERIOD }, asOf: CUT, assumptions: { priceChangeBps: '00500' } });
    }
    assert.equal(answer.receiptId, receipt.id); return answer.id as string;
  });
}

export async function saveScenario(f: Fixture) {
  const original: CalculationRequest = { operation: 'scenario', sourceIds: [SOURCE], branch: 'main',
    period: { ...PERIOD }, asOf: CUT, assumptions: { priceChangeBps: '00500' } };
  const receipt = await f.request('calculation.run', original) as CalculationReceipt;
  assert.equal(original.assumptions!.priceChangeBps, '00500');
  assert.equal(receipt.totalMinor, '13125'); assert.equal(receipt.asOf, CUT);
  assert.equal(receipt.assumptions.priceChangeBps, '500');
  assert.deepEqual(receipt.figures.map(figure => [figure.key, figure.minor]),
    [['baseline', '12500'], ['scenario', '13125'], ['change', '625'], ['priceChangeBps', '500']]);
  assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
  return { request: original, receipt };
}

export function receiptContent(receipt: CalculationReceipt) {
  const { id: _id, createdAt: _createdAt, ...content } = receipt;
  return content;
}

// Ordinary memory correction changes the explicit staleness metadata. Its
// historical identity, knowledge cut, rows, arithmetic and all other fields stay exact.
export function historicalReceiptContent(receipt: CalculationReceipt) {
  const { stale: _stale, staleReason: _staleReason, ...content } = receipt;
  return content;
}

export function assertCandidateReceipt(receipt: CalculationReceipt, original: CalculationReceipt,
  request: CalculationRequest, candidatePin: PrivateTrialVersionPin) {
  assert.equal(receipt.memberId, original.memberId); assert.equal(receipt.epoch, original.epoch);
  assert.equal(receipt.operation, request.operation); assert.deepEqual(receipt.requestedSourceIds, request.sourceIds);
  assert.equal(receipt.branch, request.branch ?? null); assert.equal(receipt.asOf, request.asOf);
  assert.deepEqual(receipt.period, request.period ?? null); assert.deepEqual(receipt.comparePeriod, request.comparePeriod ?? null);
  assert.equal(receipt.currency, original.currency); assert.equal(receipt.stale, false);
  assert.equal(receipt.ontologyVersion, candidatePin.dictionaryVersion);
  assert.equal(receipt.dictionaryHash, candidatePin.dictionaryHash,
    'Candidate arithmetic must use the exact reviewed dictionary pin, under the original actor and scope.');
}

export function assertReplay(f: Fixture, evaluation: PrivateTrialEvaluation, savedAnswerIds: string[],
  candidatePin: PrivateTrialVersionPin, mode: 'definition' | 'recipe' = 'definition') {
  assert.equal(evaluation.type, 'private-trial-evaluation-v1');
  assert.equal(evaluation.qualification, 'isolated-source-replay');
  assert.equal(evaluation.interpretation, 'restated-private-diagnostic');
  assert.equal(evaluation.comparisons.length, 3);
  assert.deepEqual(evaluation.comparisons.map(comparison => comparison.answerId), savedAnswerIds);
  assert.deepEqual(evaluation.comparisons.map(comparison => comparison.request), f.requests,
    'Replay preserves the original operation, source/branch scope, period and exact knowledge cut.');
  const candidates = mode === 'definition' ? ['100', '7000', '12500'] : ['10000', '0', '0'];
  const deltas = mode === 'definition' ? ['-900719925474099300', '0', '0'] : ['-20000', '0', '0'];
  for (const [index, comparison] of evaluation.comparisons.entries()) {
    assert.equal(comparison.baseline.status, 'calculated'); assert.equal(comparison.candidate.status, 'calculated');
    if (comparison.baseline.status !== 'calculated' || comparison.candidate.status !== 'calculated') throw new Error('Expected paired public receipts.');
    assert.deepEqual(receiptContent(comparison.baseline.receipt), receiptContent(f.receipts[index]),
      'Every baseline receipt field is replayed exactly, apart from issued ID and creation time.');
    assertCandidateReceipt(comparison.candidate.receipt, f.receipts[index], f.requests[index], candidatePin);
    assert.equal(comparison.candidate.receipt.totalMinor, candidates[index]);
    assert.equal(comparison.totalDeltaMinor, deltas[index]);
    assert.deepEqual(comparison.figures, [{ key: 'total', baselineMinor: f.receipts[index].totalMinor,
      candidateMinor: candidates[index], deltaMinor: deltas[index] }]);
    assert.match(comparison.requestDigest, /^[a-f0-9]{64}$/);
    assert.ok(comparison.differences.every(difference => difference.category !== 'receipt-identity'
      || ['/id', '/createdAt'].includes(difference.path)));
  }
  const changed = evaluation.comparisons[0];
  assert.equal(changed.meaningChanged, true);
  assert.ok(changed.differences.some(difference => difference.path === '/totalMinor'
    && difference.baseline === f.receipts[0].totalMinor && difference.candidate === candidates[0]
    && difference.baselinePresent && difference.candidatePresent && difference.category === 'meaning-or-evidence'));
  assert.match(evaluation.digest, /^[a-f0-9]{64}$/); assert.ok(evaluation.limitations.length > 0);
}

export function assertNoForkSnapshot(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  assert.ok(!(object.workspace && Array.isArray(object.facts) && Array.isArray(object.members)),
    'Host-only State snapshots cannot be disclosed through a trial RPC.');
  for (const child of Object.values(object)) assertNoForkSnapshot(child);
}

export function assertScenarioReplay(evaluation: PrivateTrialEvaluation, saved: Awaited<ReturnType<typeof saveScenario>>,
  savedAnswerId: string, candidatePin: PrivateTrialVersionPin) {
  assert.equal(evaluation.comparisons.length, 1);
  const comparison = evaluation.comparisons[0]; assert.equal(comparison.answerId, savedAnswerId);
  assert.deepEqual(comparison.request, saved.request);
  assert.equal(comparison.request.assumptions!.priceChangeBps, '00500'); assert.equal(comparison.request.asOf, CUT);
  assert.equal(comparison.baseline.status, 'calculated'); assert.equal(comparison.candidate.status, 'calculated');
  if (comparison.baseline.status !== 'calculated' || comparison.candidate.status !== 'calculated') throw new Error('Expected paired scenario replay receipts.');
  assert.deepEqual(receiptContent(comparison.baseline.receipt), receiptContent(saved.receipt));
  assertCandidateReceipt(comparison.candidate.receipt, saved.receipt, saved.request, candidatePin);
  for (const receipt of [comparison.baseline.receipt, comparison.candidate.receipt]) {
    assert.equal(receipt.totalMinor, '13125'); assert.equal(receipt.asOf, CUT);
    assert.equal(receipt.assumptions.priceChangeBps, '500'); assert.deepEqual(receipt.figures, saved.receipt.figures);
  }
  assert.equal(comparison.totalDeltaMinor, '0');
  assert.deepEqual(comparison.figures, saved.receipt.figures.map(figure => ({ key: figure.key,
    baselineMinor: figure.minor, candidateMinor: figure.minor, deltaMinor: '0' })));
}

export async function assertUnchangedAuthority(f: Fixture, before: Awaited<ReturnType<Fixture['evidence']>>) {
  assert.deepEqual(await f.evidence(), before,
    'A refused publication must leave the public dictionary, facts, import lineage and original receipts unchanged.');
}

export function assertReviewedDictionary(f: Fixture, current: Dictionary,
  reviewed: Pick<PrivateTrialVersionPin, 'dictionaryVersion' | 'dictionaryHash'>) {
  assert.equal(current.hash, reviewed.dictionaryHash,
    'Atomic activation must publish the reviewed candidate, without silently compiling a new hash.');
  assert.equal(current.version, reviewed.dictionaryVersion);
  assert.notEqual(current.hash, f.dictionary.hash);
  assert.equal(current.version, f.dictionary.version + 1);
  const change = f.change; assert.equal(change.type, 'definition');
  if (change.type !== 'definition') throw new Error('Expected reviewed definition activation.');
  assert.deepEqual(current.definitions.find(definition => definition.name === change.name), change.replacement);
  assert.deepEqual(current.definitions.filter(definition => definition.name !== change.name),
    f.dictionary.definitions.filter(definition => definition.name !== change.name));
  assert.deepEqual(current.fields, f.dictionary.fields);
}
