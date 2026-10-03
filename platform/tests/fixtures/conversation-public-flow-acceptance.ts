import assert from 'node:assert/strict';
import { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dialogFor, descendants, find, harness, hasText, lastNamedButton, namedButton } from "./conversation-acceptance-renderer.ts";

// Independent acceptance: actual UI handlers -> actual preload -> strict IPC
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
    environment: { ...environment, CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '0' } };
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
  async function renderer() { const h = await harness({ dispatch: request, mount: true }); h.renderer.state.workspace = created.workspace; return h; }
  const h = await renderer();
  async function calls(): Promise<any[]> {
    try { return (await readFile(join(directory, 'acceptance-provider-calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function restart() {
    assert.equal((await engine.stop()).graceful, true);
    engine = new EngineHarness(options); workers.push(engine); await engine.start();
    await request('workspace.open', { folder: 'acceptance', passphrase: PASSWORD });
  }
  return { h, route, config, request, calls, renderer, restart, directory, imported };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function preview(f: Fixture, question: string, h = f.h) {
  find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = f.route.id;
  const before = (await f.calls()).length; await h.ask(question);
  const result = h.renderer.state.messages.at(-1); assert.equal(result.error, undefined);
  assert.ok(result.data.preview); assert.equal((await f.calls()).length, before);
  await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  const dialog = dialogFor(h.body, 'Review model disclosure');
  assert.ok(hasText(dialog, result.data.preview.payload));
  assert.ok(hasText(dialog, result.data.preview.naturalQuestion));
  const consent = find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox');
  assert.equal(consent.checked, false);
  const warning = find(dialog, node => node.className === 'notice warn' && hasText(node, result.data.preview.definitionDisclosureWarning));
  assert.equal(warning.parent, consent.parent?.parent);
  assert.equal(warning.parent!.children.indexOf(warning) + 1, warning.parent!.children.indexOf(consent.parent!));
  for (let ancestor = warning.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.tagName, 'details');
  consent.checked = true;
  return { preview: result.data.preview, dialog, approve: namedButton(dialog, 'Approve and send once'), before, h };
}
export async function turn(f: Fixture, question: string, h = f.h) {
  const review = await preview(f, question, h), previous = h.renderer.state.messages.length;
  await review.approve.dispatch('click');
  assert.equal(review.approve.disabled, true);
  const count = h.calls.length; await review.approve.dispatch('click');
  assert.equal(h.calls.length, count, 'Review must be single-use even after a failed provider call.');
  const answer = h.renderer.state.messages.length > previous ? h.renderer.state.messages.at(-1).data : undefined;
  return { ...review, answer };
}
export async function openSaved(h: Fixture['h'], question: string) {
  const deadline = Date.now() + 5000;
  while (!descendants(h.app).some(node => node.tagName === 'button' && hasText(node, 'Recent answers'))) {
    assert.ok(Date.now() < deadline, 'Conversation must finish mounting after actual unlock.'); await delay(10);
  }
  await lastNamedButton(h.app, 'Recent answers').dispatch('click');
  const history = dialogFor(h.body, 'Recent answers');
  let row = find(history, node => node.textContent === question);
  while (!descendants(row).some(node => node.tagName === 'button' && hasText(node, 'Open saved answer'))) {
    assert.ok(row.parent); row = row.parent;
  }
  await namedButton(row, 'Open saved answer').dispatch('click');
  return dialogFor(h.body, 'Saved answer');
}
async function entered(f: Fixture, expected: number) {
  const deadline = Date.now() + 10000;
  while ((await f.calls()).length < expected) { assert.ok(Date.now() < deadline, 'Provider must enter before mutation.'); await delay(10); }
}

