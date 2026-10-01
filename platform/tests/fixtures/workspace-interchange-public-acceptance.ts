import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import type { CalculationReceipt, CalculationRequest } from '../../runtime/calculator.ts';
import type { Context, State } from '../../runtime/contracts.ts';
import { Engine } from '../../runtime/engine.ts';
import type { MappingRecipe } from '../../runtime/ingest.ts';
import { harness } from './conversation-acceptance-renderer.ts';

export const SOURCE = 'synthetic-public-interchange-shop';
export const PASSWORD = 'Synthetic workspace interchange disposable passphrase';
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const START = Date.parse('2026-10-01T12:00:00.000Z');
export const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const LEADING_ZERO_ID = '000000000000001';
export const LARGE_ID = '900719925474099399';
export const HINDI = '\u0939\u093f\u0928\u094d\u0926\u0940';
export const LITERAL_DESCRIPTION = '=1+1 "literal, quoted"\n' + HINDI;
export const UNSUPPORTED_QUESTION = 'unpublished_future_kpi "literal"\n' + HINDI;
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-public-interchange-map', system: 'synthetic-csv', edition: '1',
  scope: { company: 'Synthetic interchange business', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string' as const, nulls: 'reject' as const })),
  ], allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['issued', 'settled', 'delivered'], onUnmapped: 'reject',
};
export const RECIPE_BYTES = Buffer.from(JSON.stringify(recipe), 'utf8');
const csvCell = (value: string) => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
export function sourceContent(corrected = false): string {
  const rows = [
    [LEADING_ZERO_ID, 'invoice', '2026-09-02', corrected ? '110000' : '100000', 'INR', 'main', 'issued', LITERAL_DESCRIPTION],
    [LARGE_ID, 'invoice', '2026-09-03', '200000', 'INR', 'main', 'issued', HINDI + ' PRIVATE_INTERCHANGE_SOURCE'],
    ['payment-one', 'payment', '2026-09-05', '60000', 'INR', 'main', 'settled', 'Independent receipt one'],
    ['payment-two', 'payment', '2026-09-06', '200000', 'INR', 'main', 'settled', 'Independent receipt two'],
    ['sale-one', 'sale', '2026-09-07', '100000', 'INR', 'main', 'delivered', 'Independent delivery one'],
    ['sale-two', 'sale', '2026-09-08', '150000', 'INR', 'main', 'delivered', 'Independent delivery two'],
    ['outside-negative', 'invoice', '2026-08-02', '-7', 'INR', 'main', 'issued', 'Literal negative outside selected period'],
  ];
  return '\uFEFFid,kind,date,amount,currency,branch,status,description\r\n'
    + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export const ORIGINAL_SOURCE_BYTES = Buffer.from(sourceContent(), 'utf8');
export const CORRECTED_SOURCE_BYTES = Buffer.from(sourceContent(true), 'utf8');
export const BENCH = [
  { operation: 'billed', originalMinor: '300000', correctedMinor: '310000' },
  { operation: 'received', originalMinor: '260000', correctedMinor: '260000' },
  { operation: 'earned', originalMinor: '250000', correctedMinor: '250000' },
];

// Existing real preload/strict IPC/Engine; no invented source inventory, target
// witness, historical StateStore or custody host. Only synthetic Date is mocked.
export async function fixture(t: TestContext, withHistoricalAuthority = true) {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const temporaryRoot = await realpath(tmpdir()), prefix = '.workspace-interchange-public-';
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:[\\/]/i);
  const directory = await mkdtemp(join(temporaryRoot, prefix));
  const options = { directory, demo: true, storage: 'experimental-file' as const };
  let engine = new Engine(options), context = OWNER;
  const engines = [engine];
  t.after(async () => {
    for (const current of engines) await current.close();
    const target = await realpath(directory), child = relative(temporaryRoot, target);
    assert.equal(target, resolve(directory)); assert.equal(dirname(target), temporaryRoot);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && basename(target).startsWith(prefix));
    await rm(target, { recursive: true, force: true });
  });
  const h = await harness({ dispatch: (method, payload) => engine.requestAs(context, method, payload) });
  const request = (method: string, payload: Record<string, unknown> = {}): Promise<any> => h.exposed.request(method, payload);
  async function requestAs(current: Context, method: string, payload: Record<string, unknown> = {}) {
    const prior = context; context = current;
    try { return await request(method, payload); } finally { context = prior; }
  }
  await request('workspace.create', { name: 'Synthetic interchange business', folder: 'source', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const at = (minute: number) => new Date(START + minute * 60_000).toISOString();
  const advance = (minute: number) => { t.mock.timers.setTime(START + minute * 60_000); return at(minute); };
  async function importSource(corrected = false) {
    const imported = await request('sources.import', { sourceId: SOURCE, format: 'csv', recipe, content: sourceContent(corrected),
      expectedTotals: { rowCount: 7, amountMinor: corrected ? '819993' : '809993' } });
    assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.rowIds.length, 7); assert.equal(imported.contentHash, sha256(sourceContent(corrected)));
    assert.equal(imported.recipeHash, sha256(RECIPE_BYTES));
    return imported;
  }
  const imports = [await importSource()];
  const requests: CalculationRequest[] = [], receipts: CalculationReceipt[] = [];
  async function calculateBench(corrected: boolean, minute: number) {
    for (const item of BENCH) {
      const input: CalculationRequest = { operation: item.operation, period: PERIOD, sourceIds: [SOURCE], branch: 'main', asOf: at(minute) };
      const receipt: CalculationReceipt = await request('calculation.run', input);
      assert.equal(receipt.totalMinor, corrected ? item.correctedMinor : item.originalMinor);
      assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.deepEqual(receipt.requestedSourceIds, [SOURCE]);
      assert.ok(receipt.coverage.importIds.length > 0); requests.push(input); receipts.push(receipt);
    }
  }
  await calculateBench(false, 0);
  const originalFacts = (await request('memory.list', { sourceIds: [SOURCE], asOf: at(0) })).facts;
  advance(1); imports.push(await importSource(true)); await calculateBench(true, 1);
  const currentFacts = (await request('memory.list', { sourceIds: [SOURCE], asOf: at(1) })).facts;
  assert.equal(originalFacts.find((fact: any) => fact.entityId === LEADING_ZERO_ID).fields.amountMinor, '100000');
  assert.equal(currentFacts.find((fact: any) => fact.entityId === LEADING_ZERO_ID).fields.amountMinor, '110000');
  assert.equal(currentFacts.find((fact: any) => fact.entityId === LARGE_ID).entityId, LARGE_ID);
  assert.equal(currentFacts.find((fact: any) => fact.entityId === LEADING_ZERO_ID).fields.description, LITERAL_DESCRIPTION);
  const conversation = await request('conversation.ask', { question: 'What was billed?', period: PERIOD,
    sourceIds: [SOURCE], branch: 'main', asOf: at(1) });
  assert.equal(conversation.supported, true); assert.equal(conversation.receipt.totalMinor, '310000');
  const history = await request('conversation.history', { limit: 20 });
  const conversationId = history.items.find((item: any) => item.receiptId === conversation.receipt.id)?.id;
  assert.equal(typeof conversationId, 'string');
  const savedConversation = await request('conversation.get', { id: conversationId });
  const unsupported = await request('conversation.ask', { question: UNSUPPORTED_QUESTION, period: PERIOD, sourceIds: [SOURCE], asOf: at(1) });
  assert.equal(unsupported.supported, false); assert.equal(unsupported.receipt, null);
  let job: any, plugin: any, sessionId: string | undefined;
  if (withHistoricalAuthority) {
    job = await request('jobs.create', { type: 'owner-brief', goal: 'Retain this synthetic mandate without executing it',
      sourceIds: [SOURCE], budgetMinor: '10', reserveMinor: '1', stopRule: { maxRuns: 1, deadline: at(60) },
      nextRunAt: at(10), intervalMs: 60_000, graceMs: 0, catchup: 'latest', requiresApproval: true });
    assert.equal(job.status, 'scheduled'); assert.equal(job.runs, 0); assert.equal(job.execution, undefined);
    plugin = await request('plugins.install', { manifest: { id: 'interchange-inert-wasm', name: 'Synthetic disabled header only', version: '1.0.0',
      runtime: 'wasm', entrypoint: 'run', capabilities: [], sourceIds: [SOURCE], maxMemoryPages: 1, timeoutMs: 50 },
      moduleBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64') });
    assert.equal(plugin.status, 'disabled'); assert.deepEqual(plugin.runs, []);
    // Own disposable fixture token is created but never used, printed or exported
    // as a credential. The archive must preserve its inert historical hash record.
    const issued = await request('auth.session', { ttlMs: 60_000 }); sessionId = issued.sessionId;
  }
  const retainedReceipts: CalculationReceipt[] = [];
  for (const receipt of receipts) retainedReceipts.push(await request('receipts.get', { id: receipt.id }));
  let lastReferenceTime = START;
  async function referenceState(): Promise<{ state: State; bytes: Buffer; path: string }> {
    // An existing authenticated public export is an independent expected-State
    // readback, not a supplied source inventory or empty-target admission proof.
    lastReferenceTime = Math.max(Date.now(), lastReferenceTime) + 1;
    t.mock.timers.setTime(lastReferenceTime);
    const exported = await request('workspace.export', { confirmed: true, plaintext: true });
    const path = await realpath(exported.path), child = relative(directory, path);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    const bytes = await readFile(path); return { state: JSON.parse(bytes.toString('utf8')), bytes, path };
  }
  async function restart() {
    await engine.close(); engine = new Engine(options); engines.push(engine);
    await request('workspace.open', { folder: 'source', passphrase: PASSWORD });
  }
  const encrypted = () => readFile(join(directory, 'source', 'authority.encrypted.json'), 'utf8');
  async function readOwned(pathInput: unknown): Promise<Buffer> {
    assert.equal(typeof pathInput, 'string');
    const path = await realpath(pathInput as string), child = relative(directory, path);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Readback belongs to this disposable C-scoped fixture.');
    return readFile(path);
  }
  async function ownedPath(...parts: string[]): Promise<string> {
    assert.ok(parts.length > 0 && parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !['.', '..'].includes(part)));
    const path = resolve(directory, ...parts), child = relative(directory, path);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    const parent = await realpath(dirname(path)), parentChild = relative(directory, parent);
    assert.ok(parent === directory || (parentChild && !parentChild.startsWith('..') && !isAbsolute(parentChild)),
      'Physical fixture mutations stay within the disposable owned C directory.');
    return path;
  }
  function otherEngine() { const other = new Engine(options); engines.push(other); return other; }
  return { request, requestAs, h, directory, at, advance, restart, encrypted, readOwned, ownedPath, otherEngine, referenceState, importSource,
    imports, requests, retainedReceipts, originalFacts, currentFacts, conversation, conversationId, history, savedConversation, job, plugin, sessionId };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export const code = (expected: string) => (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && error.code === expected;
