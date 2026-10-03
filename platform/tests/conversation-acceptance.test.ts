import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dialogFor, descendants, find, harness, hasText, lastNamedButton, namedButton } from './fixtures/conversation-acceptance-renderer.ts';

// Independent acceptance: actual UI handlers -> actual preload -> strict IPC
// clone boundary -> EngineHarness -> production worker loop -> actual Engine.
// Synthetic provider contracts are authored, not LLM semantic-quality evidence.
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(import.meta.url);
const { EngineHarness } = require(join(root, 'app/desktop/engine-harness.cjs'));
const SOURCE = 'synthetic-acceptance-invoices', SECRET = 'SYNTHETIC RAW INVOICE DESCRIPTION';
const PASSWORD = 'Synthetic acceptance disposable password';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
type Scenario = { calls?: string[]; kind?: string; wire?: any; status?: string; httpStatus?: number; rawBody?: string;
  providerError?: boolean; transportFailure?: boolean; gate?: boolean; done?: boolean; finishReason?: string };

async function fixture(t: TestContext, scenarios: Record<string, Scenario>, kind = 'openai-responses') {
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
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  return { preview: result.data.preview, dialog, approve: namedButton(dialog, 'Approve and send once'), before, h };
}
async function turn(f: Fixture, question: string, h = f.h) {
  const review = await preview(f, question, h), previous = h.renderer.state.messages.length;
  await review.approve.dispatch('click');
  assert.equal(review.approve.disabled, true);
  const count = h.calls.length; await review.approve.dispatch('click');
  assert.equal(h.calls.length, count, 'Review must be single-use even after a failed provider call.');
  const answer = h.renderer.state.messages.length > previous ? h.renderer.state.messages.at(-1).data : undefined;
  return { ...review, answer };
}
async function openSaved(h: Fixture['h'], question: string) {
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

test('acceptance: natural wording routes context, calculation, clarification and mixed turns through UI/preload/worker', async t => {
  const context = 'Could you explain what we actually do here—using only our records?', calculation = 'How much did we invoice in September?',
    clarification = 'Could we explore this further?', mixed = 'Describe this business, then tell me September billing.';
  const f = await fixture(t, { [context]: { calls: ['business.describe'] }, [calculation]: { calls: ['billed'] },
    [clarification]: { kind: 'clarification' }, [mixed]: { calls: ['business.describe', 'billed'] } });
  for (const question of [context, calculation, clarification, mixed, mixed]) {
    const result = await turn(f, question); assert.ok(result.answer);
    const call = (await f.calls()).at(-1);
    assert.equal(call.input.question, question); assert.equal(call.payload, result.preview.payload);
    assert.equal(call.input.questionDisclosure, 'verbatim'); assert.equal(call.input.evidence.calculator.selectors, undefined);
    assert.equal(call.payload.includes(SECRET), false); assert.equal(call.payload.includes('120000'), false);
    if (question === clarification) {
      assert.ok(hasText(f.h.app, result.answer.clarification)); assert.equal(result.answer.results, undefined);
    } else {
      assert.equal(result.answer.kind, 'grounded-conversation');
      for (const item of result.answer.results) {
        if (item.tool === 'business.describe') { assert.ok(item.answer.citations.length); assert.equal(item.answer.unknowns.length, 5); }
        else { assert.equal(item.answer.totalMinor, '30000'); assert.deepEqual(item.answer.period, PERIOD); assert.equal(item.answer.rowIds.length, 2); }
      }
    }
    assert.equal(find(f.h.app, node => node.tagName === 'button' && node.attributes.type === 'submit').disabled, false);
  }
  assert.equal((await f.calls()).length, 5); assert.equal(f.h.rejected.length, 0);
});

test('acceptance: mixed answers and exact child evidence survive actual UI lock, unlock and worker reopen without another dispatch', async t => {
  const question = 'What is our business and September invoice total?';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'billed'] } });
  const { answer } = await turn(f, question), calculation = answer.results[1].answer;
  const history = await f.request('conversation.history', { limit: 20 });
  const composite = history.items.find((item: any) => item.kind === 'grounded-conversation'); assert.ok(composite);
  assert.deepEqual((await f.request('conversation.get', { id: composite.id })).answer, answer);
  assert.deepEqual(await f.request('receipts.get', { id: calculation.id }), calculation);
  await openSaved(f.h, question); await f.h.renderer.showWorkspace();
  await namedButton(dialogFor(f.h.body, 'Your workspace'), 'Lock vault').dispatch('click');
  assert.equal(f.h.renderer.state.messages.length, 0); assert.equal(hasText(f.h.body, question), false);
  await assert.rejects(f.h.exposed.request('conversation.get', { id: composite.id }), { code: 'VAULT_LOCKED' });
  await namedButton(f.h.app, 'Open a vault').dispatch('click');
  const form = find(f.h.app, node => node.tagName === 'form');
  find(form, node => node.tagName === 'input' && node.attributes.type === 'text').value = 'acceptance';
  find(form, node => node.tagName === 'input' && node.attributes.type === 'password').value = PASSWORD;
  await form.dispatch('submit');
  await openSaved(f.h, question);
  assert.ok(descendants(f.h.body).some(node => node.textContent?.includes('"totalMinor": "30000"')));
  await f.restart(); const fresh = await f.renderer();
  assert.equal(fresh.renderer.state.messages.length, 0); await openSaved(fresh, question);
  assert.deepEqual((await fresh.exposed.request('conversation.get', { id: composite.id })).answer, answer);
  assert.deepEqual(await fresh.exposed.request('receipts.get', { id: calculation.id }), calculation);
  assert.equal((await f.calls()).length, 1, 'Readback must not invoke a provider or recalculate.');
  const encrypted = await readFile(join(f.directory, 'acceptance/authority.encrypted.json'), 'utf8');
  assert.equal(encrypted.includes(question), false); assert.equal(encrypted.includes(SECRET), false);
});

test('acceptance: ungrounded provider tool contracts fail at actual worker admission without child answers', async t => {
  const calc = { tool: 'calculator.calculate', args: { operation: 'billed', period: null, branch: null, customerId: null } };
  const cases: Record<string, any[]> = {
    'Use an unregistered command.': [{ tool: 'shell.execute', args: {} }],
    'Invent the invoice total.': [{ ...calc, args: { ...calc.args, amountMinor: '99999' } }],
    'Run SQL as an operation.': [{ ...calc, args: { ...calc.args, operation: 'SELECT SUM(amount) FROM facts' } }],
    'Select an unavailable branch.': [{ ...calc, args: { ...calc.args, branch: 'foreign' } }],
    'Use an impossible date.': [{ ...calc, args: { ...calc.args, period: { from: '2026-02-30', to: '2026-03-01' } } }],
    'Calculate the same thing twice.': [calc, calc],
    'Select invented business evidence.': [{ tool: 'business.describe', args: { claimIds: ['invented-claim'], unknownCategories: [] } }],
  };
  const f = await fixture(t, Object.fromEntries(Object.entries(cases).map(([question, calls]) =>
    [question, { wire: { kind: 'execute', calls, clarification: null } }])));
  for (const question of Object.keys(cases)) {
    const result = await turn(f, question); assert.equal(result.answer, undefined);
    assert.equal(f.h.rejected.at(-1).error.code, question === 'Select invented business evidence.' ? 'INVALID_BUSINESS_SELECTION' : 'INVALID_CONVERSATION_PLAN');
    assert.deepEqual(await f.request('conversation.history'), { items: [] });
  }
  const activity = await f.request('activity.list');
  const attempted = activity.modelReceipts.filter((receipt: any) => receipt.kind === 'model-preview');
  assert.equal(attempted.length, 7); assert.ok(attempted.every((receipt: any) => receipt.status === 'failed' && receipt.attempts === 1));
  assert.equal((await f.calls()).length, 7);
});

test('acceptance: incomplete, malformed, failed and thrown provider turns preserve one attempt and allow a fresh subsequent turn', async t => {
  const cases = { 'Incomplete turn.': { calls: ['billed'], status: 'incomplete' },
    'Provider error turn.': { calls: ['billed'], providerError: true },
    'HTTP failure turn.': { calls: ['billed'], httpStatus: 503 },
    'Malformed JSON turn.': { rawBody: '{', calls: ['billed'] },
    'Thrown transport turn.': { calls: ['billed'], transportFailure: true },
    'Fresh successful turn.': { calls: ['billed'] } };
  const f = await fixture(t, cases);
  const expected = ['MODEL_INCOMPLETE', 'MODEL_FAILED', 'MODEL_FAILED', 'INVALID_PLAN', 'MODEL_FAILED'];
  for (const [index, question] of Object.keys(cases).slice(0, -1).entries()) {
    const result = await turn(f, question); assert.equal(result.answer, undefined);
    assert.equal(f.h.rejected.at(-1).error.code, expected[index]);
    assert.equal((await f.calls()).length, index + 1);
  }
  const success = await turn(f, 'Fresh successful turn.'); assert.equal(success.answer.results[0].answer.totalMinor, '30000');
  const receipts = (await f.request('activity.list')).modelReceipts.filter((item: any) => item.kind === 'model-preview');
  assert.equal(receipts.length, 6); assert.ok(receipts.every((item: any) => item.attempts === 1));
  assert.equal(receipts.filter((item: any) => item.status === 'failed').length, 5);
});

test('acceptance: changed question, changed route and revoked privacy block reviewed dispatch before provider entry', async t => {
  const question = 'Explain our invoices.'; const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const first = await preview(f, question), approval = await f.h.exposed.request('models.approve', { id: first.preview.id });
  await assert.rejects(f.h.exposed.request('conversation.ask', { question: question + ' changed', previewId: first.preview.id,
    approvalId: approval.id, routeId: f.route.id, purpose: 'conversation', questionDisclosure: 'verbatim' }), { code: 'PREVIEW_REQUEST_CHANGED' });
  first.dialog.close();
  const route = await preview(f, question);
  await f.request('models.configure', { config: { ...f.config, model: 'changed-synthetic-model' } });
  await route.approve.dispatch('click'); assert.equal(f.h.rejected.at(-1).error.code, 'ROUTE_REVOKED'); route.dialog.close();
  const privacy = await preview(f, question); await f.request('trust.update', { send: 'nothing' });
  await privacy.approve.dispatch('click'); assert.equal(f.h.rejected.at(-1).error.code, 'PREVIEW_STALE');
  assert.equal((await f.calls()).length, 0);
});

test('acceptance: source authority revoked while provider is in flight withholds the whole turn and retained history', async t => {
  const question = 'Describe our business and invoices while awaiting a response.';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'billed'], gate: true } });
  const review = await preview(f, question), pending = review.approve.dispatch('click');
  await entered(f, 1); await f.h.exposed.request('trust.update', { allowedSources: ['other-synthetic-source'] });
  await writeFile(join(f.directory, 'acceptance-release'), 'released'); await pending;
  assert.equal(f.h.rejected.at(-1).error.code, 'PREVIEW_STALE');
  assert.deepEqual(await f.request('conversation.history'), { items: [] });
  assert.equal(f.h.renderer.state.messages.some((message: any) => message.data?.kind === 'grounded-conversation'), false);
  assert.equal((await f.calls()).length, 1);
});

test('acceptance requirement: full wording typed in the composer reaches the reviewed planner verbatim', async t => {
  const question = '  Please describe this business.\nKeep the words exactly as I typed them—please.  ', trimmed = question.trim();
  const f = await fixture(t, { [question]: { calls: ['business.describe'] }, [trimmed]: { calls: ['business.describe'] } });
  await turn(f, question);
  assert.equal((await f.calls())[0].input.question, question, 'The advertised exact original question must survive the composer.');
  const messages = f.h.renderer.state.messages.length;
  await f.h.ask(' \n\t ');
  assert.equal(f.h.renderer.state.messages.length, messages, 'Whitespace-only text is not a conversational turn.');
  assert.equal((await f.calls()).length, 1);
});

test('acceptance requirement: clarification and all-tool-error turns remain user-visible after reopening', async t => {
  const clarification = 'Which business picture can we explore?', failure = 'Age the September invoices without required links.';
  const f = await fixture(t, { [clarification]: { kind: 'clarification' }, [failure]: { calls: ['aging'] } });
  const clarified = await turn(f, clarification); assert.ok(clarified.answer.clarification);
  const failed = await turn(f, failure); assert.equal(failed.answer.results[0].error.code, 'AGING_LINK_REQUIRED');
  await f.restart(); const fresh = await f.renderer();
  await lastNamedButton(fresh.app, 'Recent answers').dispatch('click');
  const history = await fresh.exposed.request('conversation.history');
  assert.deepEqual(history.items.map((item: any) => item.question).sort(), [clarification, failure].sort(),
    'Clarification and all-tool-error turns vanished after reopen.');
});

test('acceptance: partial tool failure retains ordered successful evidence and exact error after reopening', async t => {
  const question = 'Describe our business and age the September invoices.';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'aging'] } });
  const { answer } = await turn(f, question);
  assert.equal(answer.results[0].answer.kind, 'business-context');
  assert.equal(answer.results[1].error.code, 'AGING_LINK_REQUIRED');
  assert.equal(answer.receipt.resultRefs.length, 1);
  assert.ok(hasText(f.h.app, `${answer.results[1].error.code}: ${answer.results[1].error.message}`));
  await f.restart(); const fresh = await f.renderer(); await openSaved(fresh, question);
  const saved = await fresh.exposed.request('conversation.get', { id: answer.id });
  assert.deepEqual(saved.answer, answer);
  assert.ok(hasText(dialogFor(fresh.body, 'Saved answer'), `${answer.results[1].error.code}: ${answer.results[1].error.message}`));
  assert.equal((await f.calls()).length, 1);
});

test('acceptance requirement: revoking source access removes cached composer evidence as well as RPC history', async t => {
  const question = 'Tell me the invoice total from our source.';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  const { answer } = await turn(f, question), compositeId = answer.id;
  assert.ok(f.h.renderer.state.messages.some((message: any) => message.data?.id === compositeId));
  await f.h.renderer.request('trust.update', { allowedSources: ['other-synthetic-source'] });
  assert.equal(descendants(f.h.app).some(node => node.textContent?.includes('"totalMinor": "30000"')), false,
    'Revocation must erase the currently mounted body immediately.');
  assert.equal(f.h.renderer.state.messages.length, 0);
  assert.deepEqual(await f.h.exposed.request('conversation.history'), { items: [] });
  await assert.rejects(f.h.exposed.request('conversation.get', { id: compositeId }), { code: 'CONVERSATION_NOT_FOUND' });
  await assert.rejects(f.h.exposed.request('receipts.get', { id: answer.results[0].answer.id }));
  const rerendered = await f.h.renderer.renderConversation();
  assert.equal(descendants(rerendered).some(node => node.textContent?.includes('"totalMinor": "30000"')), false,
    'Previously permitted invoice body remains visible when revisiting Conversation after source revocation.');
});

test('acceptance: revisiting Conversation rechecks cached evidence after authority changes outside the renderer', async t => {
  const question = 'Show our currently permitted invoice evidence.';
  const f = await fixture(t, { [question]: { calls: ['billed'] } });
  await turn(f, question);
  await f.request('trust.update', { allowedSources: ['other-synthetic-source'] });
  const current = await f.h.renderer.renderConversation();
  assert.equal(descendants(current).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  assert.equal(f.h.renderer.state.messages.length, 0);
  assert.equal((await f.calls()).length, 1, 'Revalidation must not invoke another provider.');
});

test('acceptance: a completed worker answer delayed across renderer authority revocation never becomes visible', async t => {
  const question = 'Explain the business and billed invoices before a permission change.';
  const f = await fixture(t, { [question]: { calls: ['business.describe', 'billed'] } });
  let enter!: () => void, release!: () => void;
  const held = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    const result = await f.request(method, payload);
    if (method === 'conversation.ask') { enter(); await released; }
    return result;
  } });
  h.renderer.state.workspace = f.h.renderer.state.workspace;
  const pending = turn(f, question, h);
  await held;
  await h.renderer.request('trust.update', { allowedSources: ['other-synthetic-source'] });
  release(); const result = await pending;
  assert.equal(result.answer, undefined);
  assert.equal(h.renderer.state.messages.length, 0);
  assert.equal(hasText(h.app, question), false);
  assert.equal(descendants(h.body).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal((await f.calls()).length, 1);
});

for (const provider of ['ollama', 'openai-compatible']) {
  test(`acceptance requirement: ${provider} explicitly incomplete provider output cannot execute tools`, async t => {
    const question = 'Calculate invoices from an explicitly incomplete provider turn.';
    const f = await fixture(t, { [question]: { calls: ['billed'], done: false, finishReason: 'length' } }, provider);
    const result = await turn(f, question);
    assert.equal((await f.calls()).length, 1);
    assert.equal(result.answer?.kind, undefined, 'A syntactically valid plan in an explicitly incomplete response must not execute Calculator.');
    assert.equal(f.h.rejected.at(-1).error.code, 'MODEL_INCOMPLETE');
    assert.deepEqual(await f.request('conversation.history'), { items: [] });
  });
}
