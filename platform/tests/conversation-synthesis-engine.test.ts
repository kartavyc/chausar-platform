import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { hash } from '../runtime/contracts.ts';
import { conversationRecordIntegrity } from '../runtime/conversation-history.ts';
import { installedConversationSynthesisCodec } from '../runtime/conversation-synthesis-codec.ts';
import type { ConversationSynthesisCodec, GroundedSynthesisOutput, GroundedToolSummary } from '../runtime/conversation-synthesis-contract.ts';

// Actual production codec and Engine/Gateway with authored synthetic HTTP
// responses only. No provider semantics, live inference or native qualification.
const ENDPOINT = 'https://synthetic-synthesis-fixture.invalid/v1/responses';
const PASSWORD = 'synthetic-synthesis-wiring-passphrase';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
function resultFor(summary: GroundedToolSummary): GroundedSynthesisOutput {
  const figure = summary.evidence.find(item => item.kind === 'figure'), scope = summary.evidence.find(item => item.kind === 'scope');
  const paragraphs: GroundedSynthesisOutput['paragraphs'] = figure && scope ? [{ parts: [{ kind: 'text', text: 'Billed invoices total ' },
    { kind: 'slot', ref: figure.ref }, { kind: 'text', text: ' for ' }, { kind: 'slot', ref: scope.ref }, { kind: 'text', text: '.' }],
    evidenceRefs: [figure.ref, scope.ref] }] : [{ parts: [{ kind: 'text', text: 'The requested result is unavailable. Review the retained limitation before asking again.' }],
    evidenceRefs: [summary.evidence[0].ref] }];
  for (const item of summary.evidence.filter(item => (item.kind === 'figure' || item.kind === 'scope' || item.kind === 'claim')
    && !paragraphs[0].evidenceRefs.includes(item.ref))) {
    paragraphs[0].parts.push({ kind: 'text', text: ' ' }, { kind: 'slot', ref: item.ref }, { kind: 'text', text: '.' });
    paragraphs[0].evidenceRefs.push(item.ref);
  }
  return { schemaVersion: 1, paragraphs, cautionRefs: summary.evidence.filter(item => item.kind === 'caution').map(item => item.ref) };
}
async function fixture(t: TestContext, options: { noCodec?: boolean; operation?: string; codec?: ConversationSynthesisCodec } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-synthesis-wiring-'));
  const control: { providerCalls: number; mutation?: () => Promise<void>; output?: (summary: GroundedToolSummary) => unknown; plan?: unknown } = { providerCalls: 0 };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['test'], t.mock),
    ...(options.noCodec ? { synthesis: {} as ConversationSynthesisCodec } : options.codec ? { synthesis: options.codec } : {}), gateway: {
      http: async request => {
        control.providerCalls++;
        const content = JSON.parse(JSON.parse(request.body).input);
        let value: unknown;
        if (content.results || content.summary?.results) {
          const summary = (content.summary ?? content) as GroundedToolSummary;
          value = control.output ? control.output(summary) : resultFor(summary);
          if (control.mutation) await control.mutation();
        } else value = typeof control.plan === 'function' ? control.plan(content) : control.plan ?? { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: { operation: options.operation ?? 'billed', period: PERIOD, branch: null, customerId: null } }], clarification: null };
        return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output: [{ type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }) };
      },
    } });
  t.after(async () => {
    await engine.close(); const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(target.toLowerCase().startsWith(join(resolve(tmpdir()), 'chausar-synthesis-wiring-').toLowerCase()));
    await rm(target, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic synthesis wiring', folder: 'test', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  await engine.request('sources.import', { sourceId: 'synthetic-selected', format: 'csv',
    content: 'id,kind,date,amount,currency,branch,status\nfixture-invoice,invoice,2026-09-02,100.00,INR,main,issued',
    expectedTotals: { rowCount: 1, amountMinor: '10000' }, recipe: { version: 1, id: 'synthetic-synthesis-map', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic synthesis wiring', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  await engine.request('models.configure', { config: { id: 'synthetic-synthesis-route', kind: 'openai-responses', model: 'synthetic-model',
    endpoint: ENDPOINT, budgetMinor: '10000', maxCostMinor: '1' }, secret: 'synthetic-test-fixture-only' });
  await engine.request('trust.update', { send: 'samples' });
  async function tools(sourceIds: string[] = ['synthetic-selected'], scope: Record<string, unknown> = {}) {
    const question = options.operation === 'aging' ? 'Age the selected September invoices.' : 'What was billed in the selected September records?';
    const request = { question, purpose: 'conversation', questionDisclosure: 'verbatim',
      routeId: 'synthetic-synthesis-route', sourceIds, ...scope };
    const preview = await engine.request('models.preview', request), approval = await engine.request('models.approve', { id: preview.id });
    return engine.request('conversation.ask', { ...request, previewId: preview.id, approvalId: approval.id });
  }
  async function prepare(id: string) {
    const preview = await engine.request('conversation.synthesis.preview', { id });
    const approval = await engine.request('models.approve', { id: preview.id });
    return { preview, approval, payload: { id, previewId: preview.id, approvalId: approval.id } };
  }
  async function reopen() { await engine.request('workspace.lock'); await engine.request('workspace.open', { folder: 'test', passphrase: PASSWORD }); }
  return { engine, control, tools, prepare, reopen };
}

test('public two-stage wiring requires another approval, renders exact receipt slots and reopens without dispatch', async t => {
  const f = await fixture(t), tools = await f.tools(); assert.equal(f.control.providerCalls, 1);
  const preview = await f.engine.request('conversation.synthesis.preview', { id: tools.id });
  assert.equal(preview.purpose, 'conversation-synthesis'); assert.equal(preview.toolTurnId, tools.id); assert.equal(preview.approvalRequired, true);
  assert.equal(f.control.providerCalls, 1);
  await assert.rejects(f.engine.request('conversation.synthesis.run', { id: tools.id, previewId: preview.id, approvalId: 'synthetic-missing-approval' }),
    { code: 'OUTBOUND_APPROVAL_REQUIRED' });
  const approval = await f.engine.request('models.approve', { id: preview.id });
  const final = await f.engine.request('conversation.synthesis.run', { id: tools.id, previewId: preview.id, approvalId: approval.id });
  assert.equal(final.kind, 'synthesized-conversation'); assert.equal(f.control.providerCalls, 2);
  assert.ok(final.paragraphs[0].startsWith(`Billed invoices total ${tools.results[0].answer.figures[0].display} for ${PERIOD.from} to ${PERIOD.to}.`));
  assert.ok(final.paragraphs[0].includes(tools.results[0].answer.asOf));
  assert.deepEqual(final.tools, tools); assert.equal(final.receipt.toolTurnId, tools.id);
  assert.equal(final.receipt.plannerModelReceiptId, tools.modelReceiptId); assert.equal(final.receipt.synthesisModelReceiptId, preview.id);
  assert.ok((await f.engine.request('conversation.history')).items.some((item: any) => item.id === final.id && item.kind === 'synthesized-conversation'));
  await f.reopen(); assert.deepEqual((await f.engine.request('conversation.get', { id: final.id })).answer, final); assert.equal(f.control.providerCalls, 2);
});

test('incomplete installed codec refuses precisely rather than silently substituting local prose', async t => {
  const f = await fixture(t, { noCodec: true }), tools = await f.tools();
  await assert.rejects(f.engine.request('conversation.synthesis.preview', { id: tools.id }), { code: 'SYNTHESIS_UNAVAILABLE' });
  assert.equal(f.control.providerCalls, 1);
});

test('preview outbound omits local receipts, rows, values, dates and source identifiers while binding them locally', async t => {
  const f = await fixture(t), tools = await f.tools(), { preview } = await f.prepare(tools.id);
  const content = JSON.parse(JSON.parse(preview.payload).input), summary = content.summary ?? content;
  assert.ok(summary.evidence.some((item: any) => item.kind === 'figure')); assert.equal(summary.question, 'What was billed in the selected September records?');
  for (const privateValue of [tools.id, tools.modelReceiptId, tools.results[0].answer.id, 'synthetic-selected', 'fixture-invoice', '10000', '100.00', PERIOD.from])
    assert.equal(preview.payload.includes(privateValue), false, privateValue);
  assert.equal(preview.synthesisInputDigest, hash(summary));
});

test('planner consent cannot dispatch a separately reviewed synthesis', async t => {
  const f = await fixture(t), tools = await f.tools();
  const planner = f.engine.vault!.read().modelReceipts.find(item => item.id === tools.modelReceiptId);
  const preview = await f.engine.request('conversation.synthesis.preview', { id: tools.id });
  await assert.rejects(f.engine.request('conversation.synthesis.run', { id: tools.id, previewId: preview.id, approvalId: planner.approvalId }), { code: 'OUTBOUND_APPROVAL_REQUIRED' });
  assert.equal(f.control.providerCalls, 1);
});

test('source changes during synthetic inference withhold final prose and do not retry', async t => {
  const f = await fixture(t), tools = await f.tools(), prepared = await f.prepare(tools.id);
  f.control.mutation = async () => { await f.engine.request('trust.update', { allowedSources: [] }); };
  await assert.rejects(f.engine.request('conversation.synthesis.run', prepared.payload));
  assert.equal(f.control.providerCalls, 2); assert.equal(f.engine.vault!.read().conversations.some(item => item.kind === 'conversation-synthesis-answer'), false);
});

test('saved final prose is withheld after source revocation without another provider call', async t => {
  const f = await fixture(t), tools = await f.tools(), prepared = await f.prepare(tools.id);
  const final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  await f.engine.request('trust.update', { allowedSources: [] });
  await assert.rejects(f.engine.request('conversation.get', { id: final.id }), { code: 'CONVERSATION_NOT_FOUND' });
  assert.equal((await f.engine.request('conversation.history')).items.some((item: any) => item.id === final.id), false); assert.equal(f.control.providerCalls, 2);
});

test('saved final text tampering is refused even when its outer integrity is recomputed', async t => {
  const f = await fixture(t), tools = await f.tools(), prepared = await f.prepare(tools.id), final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  await f.engine.vault!.update(state => { const record = state.conversations.find(item => item.id === final.id);
    record.answer.paragraphs[0] = 'Forged fixture prose.'; record.integrity = conversationRecordIntegrity(record); });
  await assert.rejects(f.engine.request('conversation.get', { id: final.id }), { code: 'CONVERSATION_NOT_FOUND' }); assert.equal(f.control.providerCalls, 2);
});

test('host refuses a materializer that replaces exact local amount slots', async t => {
  const f = await fixture(t, { codec: { ...installedConversationSynthesisCodec, materialize: () => ({ paragraphs: ['Unsupported altered amount.'] }) } });
  const tools = await f.tools(), prepared = await f.prepare(tools.id);
  await assert.rejects(f.engine.request('conversation.synthesis.run', prepared.payload), { code: 'INVALID_SYNTHESIS' });
  assert.equal(f.engine.vault!.read().conversations.some(item => item.kind === 'conversation-synthesis-answer'), false);
});

test('unavailable tools remain caution-bound rather than fabricated positive answers', async t => {
  const f = await fixture(t, { operation: 'aging' }), tools = await f.tools(); assert.equal(tools.results[0].error.code, 'AGING_LINK_REQUIRED');
  const prepared = await f.prepare(tools.id), final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  assert.equal(final.cautions.length, 1); assert.equal(final.cautions[0].text, tools.results[0].error.message);
  assert.match(final.paragraphs[0], /unavailable/); assert.deepEqual(final.tools.receipt.resultRefs, []);
});

test('required cautions cannot be removed from otherwise well-formed synthetic output', async t => {
  const f = await fixture(t, { operation: 'aging' }), tools = await f.tools(), prepared = await f.prepare(tools.id);
  assert.equal(tools.results[0].error.code, 'AGING_LINK_REQUIRED');
  f.control.output = summary => ({ ...resultFor(summary), cautionRefs: [] });
  await assert.rejects(f.engine.request('conversation.synthesis.run', prepared.payload), { code: 'INVALID_CONVERSATION_SYNTHESIS' });
  assert.equal(f.control.providerCalls, 2);
});

test('direct calculator parameter errors remain separate from unreviewed planner admission refusals', async t => {
  const f = await fixture(t);
  await assert.rejects(f.engine.request('calculation.run', { operation: 'change', period: PERIOD }), { code: 'COMPARISON_REQUIRED' });
  await assert.rejects(f.engine.request('calculation.run', { operation: 'scenario', period: PERIOD }), { code: 'SCENARIO_REQUIRED' });
  assert.equal(f.control.providerCalls, 0);
  for (const operation of ['change', 'scenario']) {
    // Missing owner-reviewed inputs are invalid planner calls. They must never
    // be converted into admitted tool results or retained calculator errors.
    f.control.plan = { kind: 'execute', clarification: null, calls: [{ tool: 'calculator.calculate',
      args: { operation, period: PERIOD, branch: null, customerId: null } }] };
    await assert.rejects(f.tools(), { code: 'INVALID_CONVERSATION_PLAN' });
  }
  assert.equal(f.control.providerCalls, 2);
  assert.equal(f.engine.vault!.read().receipts.length, 0);
  assert.deepEqual((await f.engine.request('conversation.history')).items, []);
});

test('the exact tool ID and trusted route cannot be replaced or supplemented with caller-provided results', async t => {
  const f = await fixture(t), tools = await f.tools();
  await assert.rejects(f.engine.request('conversation.synthesis.preview', { id: tools.id, routeId: 'different-route' }), { code: 'SYNTHESIS_ROUTE_CHANGED' });
  await assert.rejects(f.engine.request('conversation.synthesis.preview', { id: tools.id, summary: { fake: true } }), { code: 'INVALID_SYNTHESIS' });
  const prepared = await f.prepare(tools.id);
  await assert.rejects(f.engine.request('conversation.synthesis.run', { ...prepared.payload, id: 'different-tool-turn' })); assert.equal(f.control.providerCalls, 1);
});

test('an empty explicit selection remains empty in synthesis authority and exact calculation slots', async t => {
  const f = await fixture(t), tools = await f.tools([]), prepared = await f.prepare(tools.id);
  assert.equal(tools.results[0].answer.totalMinor, '0'); assert.deepEqual(prepared.preview.sourceIds, []);
  const final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  assert.ok(final.paragraphs[0].includes(tools.results[0].answer.figures[0].display)); assert.deepEqual(final.tools.results[0].answer.requestedSourceIds, []);
});

test('a zero-row selected source remains authoritative even when no calculation rows name it', async t => {
  const f = await fixture(t), tools = await f.tools(['synthetic-zero-row']), prepared = await f.prepare(tools.id);
  assert.deepEqual(tools.results[0].answer.sourceIds, []);
  assert.deepEqual(tools.results[0].answer.requestedSourceIds, ['synthetic-zero-row']);
  assert.deepEqual(prepared.preview.sourceIds, ['synthetic-zero-row']);
  await f.engine.request('trust.update', { allowedSources: ['synthetic-selected'] });
  await assert.rejects(f.engine.request('conversation.synthesis.run', prepared.payload)); assert.equal(f.control.providerCalls, 1);
});

test('continued synthesis preserves the current admitted original objective rather than a short latest reply', async t => {
  const f = await fixture(t);
  f.control.plan = { kind: 'clarification', calls: [], clarification: 'Which period should I use?' };
  const first = await f.tools(), parent = f.engine.vault!.read().conversations.find(item => item.modelReceiptId === first.modelReceiptId);
  f.control.plan = undefined;
  const tools = await f.tools(['synthetic-selected'], { question: 'September', continuationId: parent.id });
  const prepared = await f.prepare(tools.id);
  assert.equal(prepared.preview.naturalQuestion, 'What was billed in the selected September records?');
  const final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  assert.equal((await f.engine.request('conversation.get', { id: final.id })).question, 'What was billed in the selected September records?');
  assert.equal(f.control.providerCalls, 3);
});

test('duplicate canonical calculation receipt IDs refuse synthesis instead of selecting the first match', async t => {
  const f = await fixture(t), tools = await f.tools();
  await f.engine.vault!.update(state => { const receipt = state.receipts.find(item => item.id === tools.results[0].answer.id); state.receipts.push(structuredClone(receipt)); });
  await assert.rejects(f.engine.request('conversation.synthesis.preview', { id: tools.id }), { code: 'SYNTHESIS_STALE' });
  assert.equal(f.control.providerCalls, 1);
});

test('public original question joins current attributed business claims, calculator slots and retained citation references', async t => {
  const f = await fixture(t);
  await f.engine.request('business.profile.record', { field: 'products', value: 'Handcrafted tables', origin: 'owner-told',
    sourceId: 'synthetic-selected', validFrom: '2026-09-01' });
  f.control.plan = (content: any) => {
    const capabilities = content.evidence.business.capabilities;
    const claim = capabilities.find((item: any) => item.origin === 'owner-told'); assert.ok(claim);
    return { kind: 'execute', calls: [{ tool: 'business.describe', args: { claimIds: [claim.claimId], unknownCategories: content.evidence.business.unknownCategories } },
      { tool: 'calculator.calculate', args: { operation: 'billed', period: PERIOD, branch: null, customerId: null } }], clarification: null };
  };
  const question = 'Explain what this business sells and tell me what was billed in September.';
  const tools = await f.tools(['synthetic-selected'], { question }), prepared = await f.prepare(tools.id);
  const summary = JSON.parse(JSON.parse(prepared.preview.payload).input);
  assert.equal(summary.question, question); assert.ok(summary.evidence.some((item: any) => item.kind === 'claim' && item.qualification === 'owner-stated'));
  assert.ok(summary.citationRefs.length > 0); assert.equal(prepared.preview.payload.includes(tools.results[0].answer.citations[0].referenceId), false);
  const final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  assert.ok(final.paragraphs[0].includes('Handcrafted tables')); assert.ok(final.paragraphs[0].includes(tools.results[1].answer.figures[0].display));
  assert.deepEqual(final.references[0].citationIds, tools.results[0].answer.claims[0].citationIds);
  assert.deepEqual(final.references[0].receiptIds, [tools.results[1].answer.id]);
  assert.ok(final.cautions.some((item: any) => /established .* description/i.test(item.text)));
  await f.reopen(); assert.deepEqual((await f.engine.request('conversation.get', { id: final.id })).answer, final); assert.equal(f.control.providerCalls, 2);
});

for (const prose of ['बिल एक लाख रुपये हैं। ', 'बिल ए\u200bक ला\u200bख रुप\u200bये हैं। ']) {
  test('the joined Hindi writing path refuses extra numeric assertions outside exact local slots', async t => {
    const f = await fixture(t), tools = await f.tools(), prepared = await f.prepare(tools.id);
    f.control.output = summary => { const output = resultFor(summary); output.paragraphs[0].parts.unshift({ kind: 'text', text: prose }); return output; };
    await assert.rejects(f.engine.request('conversation.synthesis.run', prepared.payload), { code: 'INVALID_CONVERSATION_SYNTHESIS' });
    assert.equal(f.control.providerCalls, 2); assert.equal(f.engine.vault!.read().conversations.some(item => item.kind === 'conversation-synthesis-answer'), false);
  });
}

test('Hindi natural framing remains accepted when financial values come only from current receipt slots', async t => {
  const f = await fixture(t), question = 'सितंबर में दर्ज बिल का कुल मान क्या है?', tools = await f.tools(['synthetic-selected'], { question });
  const prepared = await f.prepare(tools.id); assert.equal(prepared.preview.naturalQuestion, question);
  f.control.output = summary => { const output = resultFor(summary); output.paragraphs[0].parts[0] = { kind: 'text', text: 'दर्ज बिल का कुल मान ' }; return output; };
  const final = await f.engine.request('conversation.synthesis.run', prepared.payload);
  assert.ok(final.paragraphs[0].startsWith(`दर्ज बिल का कुल मान ${tools.results[0].answer.figures[0].display}`)); assert.equal(f.control.providerCalls, 2);
});
