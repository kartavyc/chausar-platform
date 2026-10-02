import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine, type EngineOptions} from '../../runtime/engine.ts';
import {DatabaseCalculator, type SQLConnection} from '../../runtime/analytics.ts';
import {ChausarError} from '../../runtime/contracts.ts';
import type {CalculationReceipt} from '../../runtime/calculator.ts';
import type {ImportInput, MappingRecipe} from '../../runtime/ingest.ts';

// In-process public Engine requests only. No server, socket, model or native SQL.
// The authored provider is injected. SQL is explicitly withheld; project:true
// additionally exercises the real projection before a refusing injected port.
// Transient receipts are diagnostics only, never native-qualified results.
export const SOURCE = 'synthetic-custom-earned', OTHER = 'synthetic-custom-unselected';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'};
export const PRIOR = {from: '2026-08-01', to: '2026-08-31'};
export const CUT = '2026-10-01T12:00:00.000Z', NEW_CUT = '2026-10-03T12:00:00.000Z';
const ROUTE = 'synthetic-custom-fields-authored';
const PASSWORD = 'Synthetic custom-field scratch workspace credential';
export type Operation = 'change' | 'scenario';
export type PublicInput = Record<string, any>;

export function request(operation: Operation, overrides: PublicInput = {}): PublicInput {
  return {question: operation === 'change' ? 'Compare my selected September earned measure with August.'
    : 'Apply my price assumption to September earned value, holding volume constant.',
  purpose: 'conversation', questionDisclosure: 'verbatim', routeId: ROUTE,
  sourceIds: [SOURCE], branch: 'main', period: PERIOD, asOf: CUT,
  ...(operation === 'change' ? {comparePeriod: PRIOR} : {assumptions: {priceChangeBps: '00500'}}), ...overrides};
}
export function plan(operation: Operation, input: PublicInput, overrides: PublicInput = {}) {
  return {kind: 'execute', calls: [{tool: 'calculator.calculate', args: {
    operation, period: input.period, branch: null, customerId: null,
    ...(operation === 'change' ? {comparePeriod: input.comparePeriod ?? PRIOR}
      : {assumptions: input.assumptions ?? {priceChangeBps: '00500'}}), ...overrides,
  }}], clarification: null};
}
export function importedInput(sourceId = SOURCE, alternative = false, missing = false): ImportInput {
  const recipe: MappingRecipe = {version: 1, id: 'synthetic-custom-earned-map', system: 'synthetic-csv', edition: '1',
    scope: {company: 'Synthetic custom earned shop', branches: ['main']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      {target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject'},
      {target: 'feeMinor', source: alternative ? 'feeAlternative' : 'fee', type: 'money', moneyUnit: 'minor',
        currency: 'INR', nulls: missing ? 'omit' : 'reject'},
      ...['currency', 'branch', 'status'].map(target => ({target, source: target,
        type: 'string' as const, nulls: 'reject' as const})),
    ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
    ignoredFields: [alternative ? 'fee' : 'feeAlternative']};
  const rows = sourceId === SOURCE ? [
    `current-start,sale,2026-09-01,111,${missing ? '' : '10001'},11001,INR,main,delivered`,
    'current-end,sale,2026-09-30,222,20001,21001,INR,main,delivered',
    'prior,sale,2026-08-01,333,30000,31000,INR,main,delivered',
  ] : ['unselected,sale,2026-09-15,999,999999,888888,INR,main,delivered'];
  return {sourceId, format: 'csv', recipe,
    content: ['id,kind,date,amount,fee,feeAlternative,currency,branch,status', ...rows].join('\r\n'),
    expectedTotals: {rowCount: rows.length, amountMinor: sourceId === SOURCE ? '666' : '999'},
    installation: {company: recipe.scope.company, edition: '1'}};
}

export async function fixture(t: TestContext, options: {missing?: boolean; nulls?: 'reject' | 'exclude'; project?: boolean; sqlConnection?: SQLConnection} = {}) {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-09-30T12:00:00.000Z')});
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:[\\/]/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-custom-fields-')));
  assert.equal(dirname(directory), base);
  const calls: {endpoint: string; body: string}[] = [], captured: CalculationReceipt[] = [];
  let response: unknown, connectionCalls = 0;
  const database = new DatabaseCalculator({connectionFactory: async () => {
    connectionCalls++; if (options.sqlConnection) return options.sqlConnection;
    throw new ChausarError('SYNTHETIC_SQL_BOUNDARY', 'This contract fixture has no qualified SQL connection.');
  }});
  const engineOptions: EngineOptions = {directory, demo: true, storage: 'experimental-file', gateway: {
    http: async input => {
      assert.ok(response, 'A deterministic authored provider response is required.');
      calls.push({endpoint: input.endpoint, body: input.body});
      return {status: 200, endpoint: input.endpoint, body: JSON.stringify({done: true, done_reason: 'stop',
        message: {role: 'assistant', content: JSON.stringify(response)}})};
    },
  }};
  let engine = new Engine(engineOptions);
  const rpc = <T = any>(method: string, payload: PublicInput = {}): Promise<T> => engine.request(method, payload);
  const refuse = async (method: string, payload: PublicInput, code: string) => {
    await assert.rejects(rpc(method, payload), (error: any) => {assert.equal(error.code, code); return true;});
  };
  const attachVerifier = () => {
    engine.services.calculator.verifier = async (receipt: CalculationReceipt) => {
      captured.push(structuredClone(receipt));
      if (!options.project) throw new ChausarError('SYNTHETIC_SQL_BOUNDARY', 'SQL verification is deliberately withheld in this provenance fixture.');
      return database.verify(receipt);
    };
  };
  t.after(async () => {
    await rpc('workspace.lock');
    const actual = await realpath(directory), scope = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(scope && !isAbsolute(scope) && !scope.startsWith('..') && scope.startsWith('chausar-custom-fields-'));
    await rm(actual, {recursive: true, force: true});
  });
  await rpc('workspace.create', {name: 'Synthetic custom earned shop', folder: 'fixture', pack: 'ecommerce',
    demo: false, passphrase: PASSWORD});
  const packs = await rpc('ontology.packs');
  const draft = structuredClone(packs.find((pack: any) => pack.pack === 'ecommerce'));
  const earned = draft.definitions.find((definition: any) => definition.name === 'earned');
  earned.field = 'feeMinor';
  if (options.nulls) earned.nulls = options.nulls;
  earned.meaning = 'Synthetic owner convention: earned value is the imported fee column in exact minor INR for delivered sale events.';
  const dictionary = await rpc('ontology.publish', {draft});
  const imported = await rpc('sources.import', importedInput(SOURCE, false, options.missing));
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, '666');
  await rpc('sources.import', importedInput(OTHER));
  t.mock.timers.setTime(Date.parse(CUT));
  await rpc('models.configure', {config: {id: ROUTE, kind: 'ollama', model: 'synthetic-authored-custom-planner',
    endpoint: 'http://127.0.0.1:11434/api/chat', budgetMinor: '0', maxCostMinor: '0'}});
  await rpc('trust.update', {send: 'shape'}); attachVerifier();
  const review = async (input: PublicInput) => {
    const before = calls.length, preview = await rpc('models.preview', input);
    assert.equal(calls.length, before);
    const approval = await rpc('models.approve', {id: preview.id});
    return {preview, approval, payload: {...input, previewId: preview.id, approvalId: approval.id}};
  };
  const turn = async (input: PublicInput, wire: unknown) => {
    response = wire; const reviewed = await review(input), before = calls.length;
    const answer = await rpc('conversation.ask', reviewed.payload);
    assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)!.body, reviewed.preview.payload);
    return {...reviewed, answer};
  };
  return {rpc, refuse, calls, captured, dictionary, draft, imported, review, turn,
    get connectionCalls() {return connectionCalls;},
    provider(wire: unknown) {response = wire;},
    advance(at: string) {t.mock.timers.setTime(Date.parse(at));},
    custody() {return structuredClone(engine.vault!.read());},
    async restart() {
      await rpc('workspace.lock'); engine = new Engine(engineOptions);
      await rpc('workspace.open', {folder: 'fixture', passphrase: PASSWORD}); attachVerifier();
    },
  };
}
export function content(preview: any) {
  return JSON.parse(JSON.parse(preview.payload).messages.find((message: any) => message.role === 'user').content);
}
export function figures(receipt: CalculationReceipt) {
  return Object.fromEntries(receipt.figures.map(figure => [figure.key, figure.minor]));
}
export function refusedAnswer(answer: any, code = 'SYNTHETIC_SQL_BOUNDARY') {
  assert.equal(answer.kind, 'grounded-conversation'); assert.equal(answer.results.length, 1);
  assert.deepEqual(Object.keys(answer.results[0]).sort(), ['error', 'tool']);
  assert.equal(answer.results[0].error.code, code); assert.equal(answer.results[0].tool, 'calculator.calculate');
}
