import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dialogFor, descendants, find, harness, hasText, lastNamedButton, namedButton } from './conversation-acceptance-renderer.ts';

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
    environment: { ...environment, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '0' } };
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
  const created = await dispatch('workspace.create', { name: 'Synthetic synthesis business', folder: 'acceptance', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
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
  async function renderer() { const h = await harness({ dispatch, mount: true }); h.renderer.state.workspace = created.workspace; return h; }
  const h = await renderer();
  const request = (method: string, payload: Record<string, unknown> = {}) => h.exposed.request(method, payload);
  async function calls(): Promise<any[]> {
    try { return (await readFile(join(directory, 'synthesis-provider-calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function restart() {
    assert.equal((await engine.stop()).graceful, true);
    engine = new EngineHarness(options); workers.push(engine); await engine.start();
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  return { h, route, config, request, calls, renderer, restart, directory, imported, trace };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function tools(f: Fixture, question: string, h = f.h) {
  find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = f.route.id;
  const before = (await f.calls()).length; await h.ask(question);
  const preview = h.renderer.state.messages.at(-1)?.data?.preview;
  assert.ok(preview, 'Actual composer must return a reviewed planner request.');
  assert.equal(preview.naturalQuestion, question); assert.equal((await f.calls()).length, before);
  await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  const dialog = dialogFor(h.body, 'Review model disclosure');
  assert.ok(hasText(dialog, preview.payload)); assert.ok(hasText(dialog, question));
  const consent = find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox');
  assert.equal(consent.checked, false); consent.checked = true;
  const approve = namedButton(dialog, 'Approve and send once'), previous = h.renderer.state.messages.length;
  await approve.dispatch('click'); assert.equal(approve.disabled, true);
  const answer = h.renderer.state.messages.length > previous ? h.renderer.state.messages.at(-1)?.data : undefined;
  assert.ok(answer, 'Approved planner must return a retained public turn.');
  const plannerApprovalId = f.trace.filter(item => item.method === 'models.approve' && item.payload.id === preview.id).at(-1)?.result?.id;
  assert.ok(plannerApprovalId);
  return { answer, preview, dialog, approve, before, h, plannerApprovalId };
}
export async function prepare(f: Fixture, id: string) {
  const preview = await f.request('conversation.synthesis.preview', { id });
  const approval = await f.request('models.approve', { id: preview.id });
  return { preview, approval, payload: { id, previewId: preview.id, approvalId: approval.id } };
}
export async function synthesisReview(f: Fixture, id: string, h = f.h) {
  const before = (await f.calls()).length;
  await lastNamedButton(h.app, 'Review final answer').dispatch('click');
  const preview = f.trace.filter(item => item.method === 'conversation.synthesis.preview' && item.payload.id === id).at(-1)?.result;
  assert.ok(preview, 'Actual final-answer button must request a public synthesis preview.');
  assert.equal(preview.purpose, 'conversation-synthesis'); assert.equal(preview.toolTurnId, id);
  assert.equal((await f.calls()).length, before, 'Review never calls the synthetic provider.');
  const dialog = dialogFor(h.body, 'Review model disclosure'), approve = namedButton(dialog, 'Approve and send once');
  assert.ok(hasText(dialog, preview.payload)); assert.ok(hasText(dialog, preview.naturalQuestion));
  const consent = find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox');
  assert.equal(consent.checked, false);
  const warning = find(dialog, node => node.className === 'notice warn' && hasText(node, preview.synthesisDisclosureWarning));
  assert.equal(warning.parent, consent.parent?.parent);
  assert.equal(warning.parent!.children.indexOf(warning) + 1, warning.parent!.children.indexOf(consent.parent!));
  for (let ancestor = warning.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.tagName, 'details');
  return { preview, dialog, approve, h, before, consent };
}
export async function synthesize(f: Fixture, id: string, h = f.h) {
  const review = await synthesisReview(f, id, h), beforeApprovals = f.trace.filter(item => item.method === 'models.approve').length;
  await review.approve.dispatch('click');
  assert.equal((await f.calls()).length, review.before, 'Unchecked second consent must not send.');
  assert.equal(f.trace.filter(item => item.method === 'models.approve').length, beforeApprovals);
  assert.equal(review.approve.disabled, false);
  review.consent.checked = true; const previous = h.renderer.state.messages.length;
  await review.approve.dispatch('click'); assert.equal(review.approve.disabled, true);
  const count = (await f.calls()).length; await review.approve.dispatch('click'); assert.equal((await f.calls()).length, count);
  const answer = h.renderer.state.messages.length > previous ? h.renderer.state.messages.at(-1)?.data : undefined;
  assert.equal(answer?.kind, 'synthesized-conversation', 'Final UI must contain the model-authored answer, not a tool-only fallback.');
  return { ...review, answer };
}
export async function openSaved(f: Fixture, id: string, h = f.h) {
  await lastNamedButton(h.app, 'Recent answers').dispatch('click');
  const history = dialogFor(h.body, 'Recent answers'), summaries = await f.request('conversation.history', { limit: 20 });
  const index = summaries.items.findIndex((item: any) => item.id === id); assert.ok(index >= 0, 'Expected exact saved final ID.');
  const rows = descendants(history).filter(node => node.tagName === 'section' && node.className === 'panel');
  assert.ok(rows[index]); await namedButton(rows[index], 'Open saved answer').dispatch('click');
  return dialogFor(h.body, 'Saved answer');
}
export async function waitEntered(f: Fixture, count: number) {
  const deadline = Date.now() + 10000;
  while ((await f.calls()).length < count) { assert.ok(Date.now() < deadline, 'Authored provider must enter before mutation.'); await delay(10); }
}
export async function release(f: Fixture, stage = 'synthesis') { await writeFile(join(f.directory, 'synthesis-release-' + stage), 'released'); }
