import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { preloadBridge, type PreloadBridge } from './preload-bridge.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { EngineHarness } = require(join(root, 'app/desktop/engine-harness.cjs'));
export const SOURCE = 'synthetic-synthesis-invoices', SECRET = 'SYNTHETIC PRIVATE RAW INVOICE DESCRIPTION';
export const PASSWORD = 'Synthetic synthesis disposable acceptance passphrase';
export const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
export const MODEL_PROSE = 'The reviewed records support this answer: ';
type ProviderControl = { kind?: string; wire?: unknown; variant?: string; status?: string; httpStatus?: number; rawBody?: string;
  providerError?: boolean; transportFailure?: boolean; gate?: boolean; done?: boolean; finishReason?: string };
export type Scenario = { calls?: string[]; business?: 'all' | 'owner'; planner?: ProviderControl; synthesis?: ProviderControl };

export async function fixture(t: TestContext, scenarios: Record<string, Scenario>, kind = 'openai-responses', send = 'samples') {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-synthesis-acceptance-'));
  await writeFile(join(directory, 'synthesis-scenarios.json'), JSON.stringify(scenarios));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const options = { workerPath: join(root, 'platform/tests/fixtures/conversation-synthesis-acceptance-worker.ts'),
    environment: { ...environment, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1' } };
  let engine = new EngineHarness(options); const workers = [engine], trace: any[] = [];
  t.after(async () => {
    await writeFile(join(directory, 'synthesis-release-planner'), 'released');
    await writeFile(join(directory, 'synthesis-release-synthesis'), 'released');
    for (const worker of workers) await worker.stop();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-synthesis-acceptance-'));
    await rm(target, { recursive: true, force: true });
  });
  async function dispatch(method: string, payload: Record<string, unknown> = {}) {
    try { const result = await engine.request(method, payload); trace.push({ method, payload: structuredClone(payload), result: structuredClone(result) }); return result; }
    catch (error: any) { trace.push({ method, payload: structuredClone(payload), error: { code: error.code, message: error.message } }); throw error; }
  }
  await engine.start();
  await dispatch('workspace.create', { name: 'Synthetic synthesis business', folder: 'acceptance', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const imported = await dispatch('sources.import', { sourceId: SOURCE, format: 'csv',
    content: `id,kind,date,amount,currency,branch,status,description\none,invoice,2026-09-02,100.00,INR,main,issued,${SECRET}\ntwo,invoice,2026-09-03,200.00,INR,main,issued,${SECRET}\noutside,invoice,2026-08-02,900.00,INR,main,issued,${SECRET}`,
    expectedTotals: { rowCount: 3, amountMinor: '120000' }, recipe: { version: 1, id: 'synthetic-synthesis-map', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic synthesis business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  assert.equal(imported.coverage.reconciled, true);
  const config = { id: 'synthesis-acceptance-provider', kind, model: 'synthetic-authored-contract-provider',
    endpoint: kind === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : kind === 'openai-compatible'
      ? 'https://synthetic-synthesis.invalid/v1/chat/completions' : 'https://synthetic-synthesis.invalid/v1/responses',
    enabled: true, budgetMinor: '10000', maxCostMinor: '1' };
  const route = await dispatch('models.configure', { config, ...(kind === 'ollama' ? {} : { secret: 'synthetic-fixture-only' }) });
  assert.equal(route.verification, 'not-live-verified'); await dispatch('trust.update', { send });
  // A fresh desktop preload over the same engine, as a new window would have after a restart.
  const newBridge = () => preloadBridge({ dispatch });
  const bridge = await newBridge();
  const request = (method: string, payload: Record<string, unknown> = {}) => bridge.request(method, payload);
  async function calls(): Promise<any[]> {
    try { return (await readFile(join(directory, 'synthesis-provider-calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function restart() {
    assert.equal((await engine.stop()).graceful, true);
    engine = new EngineHarness(options); workers.push(engine); await engine.start();
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  return { bridge, route, config, request, calls, newBridge, restart, directory, imported, trace };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The current answer for a retained turn, read the way the desktop app reads it back (conversation.get, receipts.get). */
export async function current(bridge: PreloadBridge, data: any) {
  if (data?.kind === 'synthesized-conversation') return (await bridge.request('conversation.get', { id: data.id })).answer;
  if (data?.kind === 'grounded-conversation') return data.results?.some((result: any) => result.answer) ? (await bridge.request('conversation.get', { id: data.id })).answer : data;
  if (data?.kind === 'business-context' && data.receipt?.id) return bridge.request('business.context.receipt', { id: data.receipt.id });
  if (data?.receipt?.id) return { ...data, receipt: await bridge.request('receipts.get', { id: data.receipt.id }) };
  if (data?.figures && data.id) return bridge.request('receipts.get', { id: data.id });
  return data;
}
/** A pending clarification's continuation, checked the way the desktop app checks it before every use. */
export async function readContinuation(bridge: PreloadBridge, id: string) {
  const descriptor = await bridge.request('conversation.continuation', { id });
  assert.equal(descriptor?.schemaVersion, 1); assert.equal(descriptor.turnId, id);
  assert.equal(typeof descriptor.originalQuestion, 'string'); assert.equal(typeof descriptor.clarification, 'string');
  return descriptor;
}
/** Selects a saved clarification to continue: its saved turn, then its continuation. */
export async function selectContinuation(bridge: PreloadBridge, id: string) {
  const item = await bridge.request('conversation.get', { id });
  assert.equal(typeof item.answer?.clarification, 'string', 'The saved answer must still be a pending clarification.');
  return readContinuation(bridge, id);
}

/**
 * One reviewed planner turn through the desktop preload: models.preview, models.approve, then conversation.ask with the
 * reviewed preview, and the retained answer read back. A continuation is read again before preview, review and approval.
 */
export async function tools(f: Fixture, question: string, { bridge = f.bridge, continuationId }: { bridge?: PreloadBridge; continuationId?: string } = {}) {
  const continuation = continuationId ? { continuationId } : {};
  if (continuationId) await readContinuation(bridge, continuationId);
  const before = (await f.calls()).length;
  const preview = await bridge.request('models.preview', { question, routeId: f.route.id, purpose: 'conversation', questionDisclosure: 'verbatim', ...continuation });
  assert.ok(preview, 'The desktop preload must return a reviewed planner request.');
  assert.equal(preview.naturalQuestion, question); assert.equal((await f.calls()).length, before);
  assert.equal(typeof preview.payload, 'string', 'The exact outbound payload is reviewable text.');
  if (continuationId) { await readContinuation(bridge, continuationId); await readContinuation(bridge, continuationId); }
  const approval = await bridge.request('models.approve', { id: preview.id });
  const retained = await bridge.request('conversation.ask', { previewId: preview.id, approvalId: approval.id, question,
    routeId: preview.routeId, purpose: 'conversation', questionDisclosure: 'verbatim', ...continuation });
  const answer = await current(bridge, retained);
  assert.ok(answer, 'Approved planner must return a retained public turn.');
  const plannerApprovalId = f.trace.filter(item => item.method === 'models.approve' && item.payload.id === preview.id).at(-1)?.result?.id;
  assert.ok(plannerApprovalId); assert.equal(plannerApprovalId, approval.id);
  return { answer, preview, before, bridge, plannerApprovalId };
}
export async function prepare(f: Fixture, id: string) {
  const preview = await f.request('conversation.synthesis.preview', { id });
  const approval = await f.request('models.approve', { id: preview.id });
  return { preview, approval, payload: { id, previewId: preview.id, approvalId: approval.id } };
}
/** The current tool turn a final answer is built from; the desktop app reads it before preview, review and approval. */
async function toolTurn(bridge: PreloadBridge, id: string) {
  const item = await bridge.request('conversation.get', { id });
  assert.equal(item.answer?.kind, 'grounded-conversation'); assert.equal(item.answer.id, id);
  return item.answer;
}
/** The final-answer preview for a tool turn, with the separate disclosure the owner must review. No approval yet. */
export async function synthesisReview(f: Fixture, id: string, bridge = f.bridge) {
  const before = (await f.calls()).length;
  await toolTurn(bridge, id);
  const preview = await bridge.request('conversation.synthesis.preview', { id });
  assert.deepEqual(f.trace.filter(item => item.method === 'conversation.synthesis.preview' && item.payload.id === id).at(-1)?.result, preview,
    'The final-answer review must come from a public synthesis preview.');
  assert.equal(preview.purpose, 'conversation-synthesis'); assert.equal(preview.toolTurnId, id);
  assert.equal((await f.calls()).length, before, 'Review never calls the synthetic provider.');
  // The separate review needs Approved samples, its exact payload, the natural question and its own disclosure warning.
  assert.equal(preview.send, 'samples'); assert.equal(typeof preview.payload, 'string'); assert.equal(typeof preview.naturalQuestion, 'string');
  assert.equal(typeof preview.synthesisDisclosureWarning, 'string'); assert.ok(preview.synthesisDisclosureWarning.trim());
  await toolTurn(bridge, id);
  return { preview, bridge, before };
}
/** The owner's separate final-answer approval: the tool turn is read again, then models.approve and the run. */
export async function approveFinal(review: Awaited<ReturnType<typeof synthesisReview>>) {
  const { bridge, preview } = review;
  await toolTurn(bridge, preview.toolTurnId);
  const approval = await bridge.request('models.approve', { id: preview.id });
  const payload = { id: preview.toolTurnId, previewId: preview.id, approvalId: approval.id };
  return { payload, retained: await bridge.request('conversation.synthesis.run', payload) };
}
export async function synthesize(f: Fixture, id: string, bridge = f.bridge) {
  const review = await synthesisReview(f, id, bridge), beforeApprovals = f.trace.filter(item => item.method === 'models.approve').length;
  const { payload, retained } = await approveFinal(review);
  assert.equal(f.trace.filter(item => item.method === 'models.approve').length, beforeApprovals + 1);
  const answer = await current(bridge, retained);
  assert.equal(answer?.kind, 'synthesized-conversation', 'The retained answer must be the model-authored final answer, not a tool-only fallback.');
  // A reviewed final answer is single-use: sending the same approved run again never reaches the provider.
  const count = (await f.calls()).length;
  await bridge.request('conversation.synthesis.run', payload).catch(() => undefined);
  assert.equal((await f.calls()).length, count);
  return { ...review, answer };
}
/** A saved answer as the desktop app opens it from Recent answers: listed in history, then read by its exact ID. */
export async function openSaved(f: Fixture, id: string, bridge = f.bridge) {
  const summaries = await bridge.request('conversation.history', { limit: 20 });
  assert.ok(summaries.items.some((item: any) => item.id === id), 'Expected exact saved final ID.');
  return (await bridge.request('conversation.get', { id })).answer;
}
export async function waitEntered(f: Fixture, count: number) {
  const deadline = Date.now() + 10000;
  while ((await f.calls()).length < count) { assert.ok(Date.now() < deadline, 'Authored provider must enter before mutation.'); await delay(10); }
}
export async function release(f: Fixture, stage = 'synthesis') { await writeFile(join(f.directory, 'synthesis-release-' + stage), 'released'); }
