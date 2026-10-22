import assert from 'node:assert/strict';
import { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preloadBridge, type PreloadBridge } from './preload-bridge.ts';

// Independent acceptance: the desktop's request sequence -> actual preload -> strict IPC
// clone boundary -> EngineHarness -> production worker loop -> actual Engine.
// Synthetic provider contracts are authored, not LLM semantic-quality evidence.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { EngineHarness } = require(join(root, 'app/desktop/engine-harness.cjs'));
const SOURCE = 'synthetic-acceptance-invoices', SECRET = 'SYNTHETIC RAW INVOICE DESCRIPTION';
const PASSWORD = 'Synthetic acceptance disposable password';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
type Scenario = { calls?: string[]; kind?: string; wire?: any; status?: string; httpStatus?: number; rawBody?: string;
  providerError?: boolean; transportFailure?: boolean; gate?: boolean; done?: boolean; finishReason?: string };

export async function fixture(t: TestContext, scenarios: Record<string, Scenario>, kind = 'openai-responses') {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-conversation-acceptance-'));
  await writeFile(join(directory, 'acceptance-scenarios.json'), JSON.stringify(scenarios));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const options = { workerPath: join(root, 'platform/tests/fixtures/conversation-acceptance-worker.ts'),
    environment: { ...environment, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1' } };
  let engine = new EngineHarness(options); const workers = [engine];
  t.after(async () => {
    // Always release our own synthetic provider gate before worker shutdown.
    await writeFile(join(directory, 'acceptance-release'), 'released');
    for (const worker of workers) await worker.stop();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-conversation-acceptance-'));
    await rm(target, { recursive: true, force: true });
  });
  await engine.start();
  const created = await engine.request('workspace.create', { name: 'Synthetic acceptance business', folder: 'acceptance',
    passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const imported = await engine.request('sources.import', { sourceId: SOURCE, format: 'csv',
    content: `id,kind,date,amount,currency,branch,status,description\none,invoice,2026-09-02,100.00,INR,main,issued,${SECRET}\ntwo,invoice,2026-09-03,200.00,INR,main,issued,${SECRET}\noutside,invoice,2026-08-02,900.00,INR,main,issued,${SECRET}`,
    expectedTotals: { rowCount: 3, amountMinor: '120000' },
    recipe: { version: 1, id: 'synthetic-acceptance-map', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic acceptance business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  assert.equal(imported.coverage.reconciled, true);
  const config = { id: 'acceptance-provider', kind, model: 'synthetic-contract-provider',
    endpoint: kind === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : kind === 'openai-compatible'
      ? 'https://synthetic.invalid/v1/chat/completions' : 'https://synthetic.invalid/v1/responses',
    enabled: true, budgetMinor: '10000', maxCostMinor: '1' };
  const route = await engine.request('models.configure', { config, secret: 'synthetic-fixture-only' });
  assert.equal(route.verification, 'not-live-verified');
  await engine.request('trust.update', { send: 'shape' });
  const request = (method: string, payload: Record<string, unknown> = {}) => engine.request(method, payload);
  assert.ok(created.workspace);
  // One desktop window's preload; after a restart a fresh one reaches the new worker, as a reopened window would.
  const desktop = () => preloadBridge({ dispatch: request });
  const h = await desktop();
  async function calls(): Promise<any[]> {
    try { return (await readFile(join(directory, 'acceptance-provider-calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function restart() {
    assert.equal((await engine.stop()).graceful, true);
    engine = new EngineHarness(options); workers.push(engine); await engine.start();
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  return { h, route, config, request, calls, desktop, restart, directory, imported };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
/** The desktop's answer readback after a turn: a grounded turn with any answer is read again by its ID. */
async function current(h: PreloadBridge, data: any) {
  if (data?.kind === 'grounded-conversation') return data.results?.some((result: any) => result.answer) ? (await h.request('conversation.get', { id: data.id })).answer : data;
  if (data?.kind === 'business-context' && data.receipt?.id) return h.request('business.context.receipt', { id: data.receipt.id });
  if (data?.receipt?.id) return { ...data, receipt: await h.request('receipts.get', { id: data.receipt.id }) };
  return data;
}
/** A reviewed question's preview, with an optional retained clarification it continues. Nothing reaches the provider yet. */
async function preview(f: Fixture, question: string, h = f.h, continuationId?: string) {
  if (continuationId) await h.request('conversation.continuation', { id: continuationId });
  const before = (await f.calls()).length;
  const preview = await h.request('models.preview', { question, routeId: f.route.id, purpose: 'conversation', questionDisclosure: 'verbatim',
    ...(continuationId ? { continuationId } : {}) });
  assert.ok(preview); assert.equal((await f.calls()).length, before);
  assert.equal(typeof preview.payload, 'string'); assert.equal(preview.naturalQuestion, question);
  assert.equal(typeof preview.definitionDisclosureWarning, 'string'); assert.ok(preview.definitionDisclosureWarning);
  /** One approval and one ask for exactly the reviewed question; a refusal leaves the answer undefined and is in h.rejected. */
  async function approve() {
    try {
      if (continuationId) await h.request('conversation.continuation', { id: continuationId });
      const approval = await h.request('models.approve', { id: preview.id });
      return await current(h, await h.request('conversation.ask', { previewId: preview.id, approvalId: approval.id, question,
        routeId: preview.routeId, purpose: 'conversation', questionDisclosure: 'verbatim', ...(continuationId ? { continuationId } : {}) }));
    } catch { return undefined; }
  }
  return { preview, approve, before, h };
}
export async function turn(f: Fixture, question: string, h = f.h, continuationId?: string) {
  const review = await preview(f, question, h, continuationId);
  const answer = await review.approve();
  return { ...review, answer };
}
/**
 * Opens the newest saved answer for a question as the desktop does: history, then the saved turn. A retained
 * clarification is also checked as a continuation; continuationId is set when it can still be continued, and refusal
 * holds the engine's reason when its chain is resolved or full.
 */
export async function openSaved(h: Fixture['h'], question: string) {
  const history = await h.request('conversation.history', { limit: 20 });
  const item = history.items.find((entry: any) => entry.question === question); assert.ok(item, 'The saved answer must be listed.');
  const saved = await h.request('conversation.get', { id: item.id });
  let continuationId: string | undefined, refusal: { code: string; message: string } | undefined;
  if (typeof saved.answer?.clarification === 'string' && saved.answer.modelReceiptId) {
    try {
      const pending = await h.request('conversation.get', { id: item.id });
      assert.equal(typeof pending.answer?.clarification, 'string');
      const descriptor = await h.request('conversation.continuation', { id: item.id });
      assert.equal(descriptor.schemaVersion, 1); assert.equal(descriptor.turnId, item.id);
      assert.equal(typeof descriptor.originalQuestion, 'string'); assert.equal(typeof descriptor.clarification, 'string');
      continuationId = item.id;
    } catch (error: any) {
      if (!['CONVERSATION_CONTINUATION_RESOLVED', 'CONVERSATION_CONTINUATION_LIMIT'].includes(error.code)) throw error;
      refusal = { code: error.code, message: error.message };
    }
  }
  return { item, saved, continuationId, refusal };
}
async function entered(f: Fixture, expected: number) {
  const deadline = Date.now() + 10000;
  while ((await f.calls()).length < expected) { assert.ok(Date.now() < deadline, 'Provider must enter before mutation.'); await delay(10); }
}

