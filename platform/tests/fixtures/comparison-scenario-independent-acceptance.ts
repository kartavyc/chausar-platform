import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine, type EngineOptions} from '../../runtime/engine.ts';
import {createLocalServer} from '../../runtime/server.ts';
import type {ImportInput, MappingRecipe} from '../../runtime/ingest.ts';

// All writes are public HTTP operations on an owned synthetic C-temp workspace.
// The only provider is an injected authored Ollama fixture, without a socket.
export const A = 'synthetic-comparison-a', B = 'synthetic-comparison-b-prior', C = 'synthetic-comparison-c-unselected';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'};
export const PRIOR = {from: '2026-08-01', to: '2026-08-31'};
export const OCTOBER = {from: '2026-10-01', to: '2026-10-31'};
export const CUT = '2026-10-01T12:00:00.000Z', NEW_CUT = '2026-10-03T12:00:00.000Z';
export const PASSWORD = 'Synthetic independent comparison scratch credential only';
export const PRIVATE_CELL = 'SYNTHETIC_COMPARISON_PRIVATE_DESCRIPTION_731204';
export const ROUTE = 'synthetic-independent-comparison-route';
const ENDPOINT = 'http://127.0.0.1:11434/api/chat';
export type Operation = 'change' | 'scenario';
export type PublicRequest = Record<string, any>;

export function request(operation: Operation, overrides: PublicRequest = {}): PublicRequest {
  return {question: operation === 'change'
    ? 'Compare September revenue with August for the main branch, using the two books I selected.'
    : 'What would September revenue be with my price assumption, keeping volume fixed?',
  purpose: 'conversation', questionDisclosure: 'verbatim', routeId: ROUTE,
  sourceIds: [A, B], branch: 'main', period: PERIOD, asOf: CUT,
  ...(operation === 'change' ? {comparePeriod: PRIOR} : {assumptions: {priceChangeBps: '00500'}}), ...overrides};
}

export function plan(operation: Operation, input: PublicRequest, overrides: PublicRequest = {}) {
  return {kind: 'execute', calls: [{tool: 'calculator.calculate', args: {
    operation, period: input.period ?? PERIOD, branch: null, customerId: null,
    ...(operation === 'change' ? {comparePeriod: input.comparePeriod ?? PRIOR}
      : {assumptions: input.assumptions ?? {priceChangeBps: '00500'}}), ...overrides,
  }}], clarification: null};
}

function imports(): ImportInput[] {
  const recipe: MappingRecipe = {version: 1, id: 'synthetic-independent-comparison-map', system: 'synthetic-csv', edition: '1',
    scope: {company: 'Independent comparison shop', branches: ['main', 'west']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      {target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject'},
      ...['currency', 'branch', 'status', 'description'].map(target => ({target, source: target,
        type: 'string' as const, nulls: 'reject' as const})),
    ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject'};
  const rowsA = [
    '00017,sale,2026-09-01,10001,INR,main,delivered',
    'A-current-end,sale,2026-09-30,20001,INR,main,delivered',
    'A-prior-start,sale,2026-08-01,12001,INR,main,delivered',
    'A-prior-end,sale,2026-08-31,7999,INR,main,delivered',
    'A-west-current,sale,2026-09-15,500000,INR,west,delivered',
    'A-west-prior,sale,2026-08-15,700000,INR,west,delivered',
    'A-large-october,sale,2026-10-01,900719925474099325,INR,main,delivered',
  ];
  return [[A, rowsA, '900719925475349327'],
    [B, ['B-prior-only,sale,2026-08-20,10000,INR,main,delivered'], '10000'],
    [C, ['C-current,sale,2026-09-10,800000,INR,main,delivered',
      'C-prior,sale,2026-08-10,900000,INR,main,delivered'], '1700000'],
  ].map<ImportInput>(([sourceId, rows, total]) => ({sourceId: sourceId as string, format: 'csv', recipe,
    content: ['id,kind,date,amount,currency,branch,status,description',
      ...(rows as string[]).map(row => `${row},${PRIVATE_CELL}`)].join('\r\n'),
    expectedTotals: {rowCount: (rows as string[]).length, amountMinor: total as string},
    installation: {company: recipe.scope.company, edition: '1'},
  }));
}

export async function fixture(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now: new Date('2026-09-30T12:00:00.000Z')});
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:[\\/]/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-comparison-independent-')));
  assert.equal(dirname(directory), base);
  const calls: {endpoint: string; body: string}[] = [];
  let response: {wire: unknown; status: 'completed' | 'incomplete'} | undefined;
  const options: EngineOptions = {directory, demo: true, storage: 'experimental-file', gateway: {
    http: async input => {
      assert.ok(response, 'This synthetic provider requires an explicitly authored response.');
      calls.push({endpoint: input.endpoint, body: input.body});
      return {status: 200, endpoint: input.endpoint,
        body: JSON.stringify({done: response.status === 'completed',
          done_reason: response.status === 'completed' ? 'stop' : 'length',
          message: {role: 'assistant', content: JSON.stringify(response.wire)}})};
    },
  }};
  let engine = new Engine(options), app = createLocalServer(engine);
  let {origin, token} = await app.listen();
  const raw = async (method: string, payload: PublicRequest = {}, bearer = token) => {
    const result = await fetch(`${origin}/api/rpc`, {method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${bearer}`}, body: JSON.stringify({method, payload})});
    return {status: result.status, body: await result.json() as any};
  };
  const rpc = async <T = any>(method: string, payload: PublicRequest = {}, bearer = token): Promise<T> => {
    const result = await raw(method, payload, bearer);
    if (result.body.error) throw Object.assign(new Error(`${method}: ${result.body.error.message}`), {code: result.body.error.code});
    assert.equal(result.status, 200); return result.body.result as T;
  };
  const refuse = async (method: string, payload: PublicRequest, code?: string, bearer = token) => {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200, `${method} must refuse.`); assert.equal(result.body.result, undefined);
    assert.equal(typeof result.body.error?.code, 'string');
    if (code !== undefined) assert.equal(result.body.error.code, code);
    return result.body.error.code as string;
  };
  t.after(async () => {
    await app.close(5000);
    const actual = await realpath(directory), scope = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(scope && !isAbsolute(scope) && !scope.startsWith('..') && scope.startsWith('chausar-comparison-independent-'));
    await rm(actual, {recursive: true, force: true});
  });
  const pair = async () => {
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const result = await fetch(`${origin}/api/session`, {headers: {authorization: `Bearer ${token}`}});
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), {token});
  };
  await pair();
  await rpc('workspace.create', {name: 'Independent comparison shop', folder: 'fixture', pack: 'ecommerce', demo: false, passphrase: PASSWORD});
  const packs = await rpc('ontology.packs');
  const draft = structuredClone(packs.find((pack: any) => pack.pack === 'ecommerce'));
  draft.definitions.find((definition: any) => definition.name === 'earned').meaning =
    'Independent owner convention: delivered sale value in exact minor INR by sale event date, excluding tax.';
  const dictionary = await rpc('ontology.publish', {draft});
  for (const input of imports()) {
    const imported = await rpc('sources.import', input);
    assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, input.expectedTotals!.amountMinor);
  }
  t.mock.timers.setTime(Date.parse(CUT));
  const configureRoute = () => rpc('models.configure', {config: {id: ROUTE, kind: 'ollama',
    model: 'synthetic-independent-authored-planner', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0'}});
  await configureRoute(); await rpc('trust.update', {send: 'shape'});
  const review = async (input: PublicRequest, bearer = token) => {
    const before = calls.length, preview = await rpc('models.preview', input, bearer);
    assert.equal(calls.length, before);
    const approval = await rpc('models.approve', {id: preview.id}, bearer);
    return {preview, approval, payload: {...input, previewId: preview.id, approvalId: approval.id}};
  };
  const turn = async (input: PublicRequest, wire: unknown, bearer = token) => {
    response = {wire, status: 'completed'};
    const reviewed = await review(input, bearer), before = calls.length;
    const answer = await rpc('conversation.ask', reviewed.payload, bearer);
    assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)!.body, reviewed.preview.payload);
    return {...reviewed, answer};
  };
  return {directory, rpc, raw, refuse, calls, dictionary, review, turn,
    get token() {return token;},
    provider(wire: unknown, status: 'completed' | 'incomplete' = 'completed') {response = {wire, status};},
    advance(at: string) {t.mock.timers.setTime(Date.parse(at));},
    async ciphertext() {return readFile(join(directory, 'fixture', 'authority.encrypted.json'), 'utf8');},
    async restart() {
      await rpc('workspace.lock'); await app.close(5000);
      engine = new Engine(options); app = createLocalServer(engine); ({origin, token} = await app.listen());
      await pair(); await rpc('workspace.open', {folder: 'fixture', passphrase: PASSWORD});
    },
  };
}

export function content(preview: any) {
  const payload = JSON.parse(preview.payload);
  const messages = payload.messages.filter((message: any) => message.role === 'user');
  assert.equal(messages.length, 1); assert.equal(typeof messages[0].content, 'string');
  return JSON.parse(messages[0].content);
}
export function figures(receipt: any) {return Object.fromEntries(receipt.figures.map((figure: any) => [figure.key, figure.minor]));}
export function receipt(answer: any) {
  assert.equal(answer.kind, 'grounded-conversation'); assert.equal(answer.results.length, 1);
  assert.equal(answer.results[0].error, undefined); return answer.results[0].answer;
}
