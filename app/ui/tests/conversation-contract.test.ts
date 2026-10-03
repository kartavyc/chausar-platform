import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  approveRequest, askRequest, conversationIdRequest, synthesisPreviewRequest, synthesisRunRequest,
  validateConversationContinuation, validateConversationReadback, validateConversationReply, validateConversationRequest,
  validateModelPreview, validateOutboundApproval, verifyConversationContinuation, verifyConversationReply, verifyModelPreview,
} from '../src/bridge/conversation-contract.ts';
import { ReplyValidationError } from '../src/bridge/validate.ts';
import { approvalFixture, businessFixture, continuationFixture, conversationRequestFixture, fixtureHash,
  groundedFixture, planningPreviewFixture, readbackFixture, synthesisPreviewFixture, synthesisReplyFixture } from './conversation-fixtures.ts';
import { fullCalculationReceiptFixture, jsonCopy } from './fixtures.ts';

const invalid = (error: unknown): boolean => error instanceof ReplyValidationError && error.code === 'INVALID_REPLY' && error.message === 'INVALID_REPLY';
function mutate(value: unknown, path: readonly string[], replacement: unknown): unknown {
  const copy = jsonCopy(value) as Record<string, unknown>; let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = replacement; return copy;
}

test('reviewed requests preserve exact question and explicit empty source scope without caller-authored history', () => {
  const input = { ...conversationRequestFixture(), sourceIds: [], period: { from: '2026-09-01', to: '2026-09-30' } };
  const checked = validateConversationRequest(input);
  assert.equal(checked.question, input.question); assert.deepEqual(checked.sourceIds, []); assert.ok(Object.isFrozen(checked.period)); assert.ok(Object.isFrozen(checked.sourceIds));
  assert.equal(Object.hasOwn(validateConversationRequest(conversationRequestFixture()), 'sourceIds'), false);
  for (const extra of [{ continuation: { originalQuestion: 'PRIVATE_CUSTOMER_FIXTURE' } }, { samples: [] }, { profileSamples: [] }, { previewId: 'model_preview_old' }, { approvalId: 'outbound_approval_old' }, { token: 'PRIVATE_CUSTOMER_FIXTURE' }]) assert.throws(() => validateConversationRequest({ ...input, ...extra }), invalid);
  for (const question of ['', '  ', 'x'.repeat(8001), 12, null]) assert.throws(() => validateConversationRequest({ ...input, question }), invalid);
  for (const sourceIds of [['same', 'same'], null, [123], ['foreign/url'], Array.from({ length: 65 }, (_, i) => `source_${i}`)]) assert.throws(() => validateConversationRequest({ ...input, sourceIds }), invalid);
  assert.throws(() => validateConversationRequest({ ...input, period: { from: '2026-09-30', to: '2026-09-01' } }), invalid);
  assert.throws(() => validateConversationRequest({ ...input, period: { from: '2026-02-30', to: '2026-09-01' } }), invalid);
});

test('request IDs admit real opaque Engine references and reject foreign or overlong contexts', () => {
  for (const id of ['action_01234567-89ab-cdef-0123-456789abcdef', 'model_preview_A.1:part', 'a'.repeat(200)]) assert.deepEqual(conversationIdRequest(id), { id });
  for (const id of ['', 'a'.repeat(201), 'https://foreign.test', 'id/path', 'id?extra', 'id\n']) assert.throws(() => conversationIdRequest(id), invalid);
  assert.deepEqual(synthesisPreviewRequest('conversation_tools_fixture'), { id: 'conversation_tools_fixture' });
});

test('verified model preview exposes exact disclosure fields and removes local authority internals', async () => {
  const request = conversationRequestFixture(), raw = planningPreviewFixture(request), checked = await verifyModelPreview(raw, request);
  assert.equal(checked.naturalQuestion, request.question); assert.equal(checked.payload, raw.payload); assert.equal(checked.digest, raw.digest); assert.equal(checked.endpoint, raw.endpoint);
  assert.ok(Object.isFrozen(checked)); assert.ok(!Object.hasOwn(checked, 'businessContext')); assert.ok(!Object.hasOwn(checked, 'schema')); assert.ok(!Object.hasOwn(checked, 'factIds'));
  assert.deepEqual(approveRequest(checked), { id: raw.id });
  assert.throws(() => approveRequest(validateModelPreview(raw, request)), invalid, 'a structural projection alone cannot authorize a transfer');
  assert.throws(() => approveRequest({ ...checked }), invalid, 'caller-authored copies lose their verified review identity');
});

test('model preview rejects invented fields, wrong purpose/scope and suppressed warnings', async () => {
  const request = conversationRequestFixture(), raw = planningPreviewFixture(request);
  for (const [path, value] of [[['question'], request.question], [['naturalQuestion'], request.question.trim()], [['routeId'], 'route_other'], [['purpose'], 'analysis'], [['questionDisclosure'], 'shape'], [['approvalRequired'], false], [['questionDisclosureWarning'], ''], [['definitionDisclosureWarning'], ''], [['providerPayloadObserved'], false], [['estimatedCostMinor'], '1.5'], [['schemaDigest'], 'A'.repeat(64)]] as const) {
    assert.throws(() => validateModelPreview(mutate(raw, path, value), request), invalid);
  }
  const noEndpoint = jsonCopy(raw) as Record<string, unknown>; delete noEndpoint.endpoint; assert.throws(() => validateModelPreview(noEndpoint, request), invalid);
  const scopeRequest = { ...request, sourceIds: ['source_fixture'] }; const scoped = planningPreviewFixture(scopeRequest);
  assert.throws(() => validateModelPreview(mutate(scoped, ['requestScope', 'sourceIds'], []), scopeRequest), invalid);
});

test('preview payload, question and schema digests are checked with real SHA256 before consent', async () => {
  const request = conversationRequestFixture(), raw = planningPreviewFixture(request);
  for (const changed of [mutate(raw, ['payload'], raw.payload + ' '), mutate(raw, ['questionHash'], '0'.repeat(64)), mutate(raw, ['schema', 'type'], 'array')]) await assert.rejects(verifyModelPreview(changed, request), invalid);
  const pending = verifyModelPreview(raw, request); raw.payload = 'changed after validation'; assert.equal((await pending).payload.includes('Synthetic fixture'), true);
});

test('a rehashed payload cannot change the exact disclosed question or invent retained continuity', async () => {
  const request = conversationRequestFixture(), raw = planningPreviewFixture(request), envelope = JSON.parse(raw.payload), content = JSON.parse(envelope.input);
  for (const altered of [{ ...content, question: 'Different private objective' }, { ...content, questionDisclosure: 'shape' }, { ...content, continuationDisclosure: 'verbatim', continuation: { turnId: 'invented' } }]) {
    const payload = JSON.stringify({ ...envelope, input: JSON.stringify(altered) }); await assert.rejects(verifyModelPreview({ ...raw, payload, digest: fixtureHash(payload) }, request), invalid);
  }
});

test('official CLI destinations are disclosure boundaries, never claims that provider payloads were observed', async () => {
  const request = conversationRequestFixture();
  for (const cli of ['codex', 'claude']) {
    const base = planningPreviewFixture(request), payload = `${base.instructions}\n${JSON.parse(base.payload).input}`;
    const raw = { ...base, payload, digest: fixtureHash(payload), endpoint: `cli://${cli}/provider-managed`, receiptBoundary: 'application-to-official-cli', providerPayloadObserved: false };
    const checked = await verifyModelPreview(raw, request); assert.equal(checked.endpoint, raw.endpoint); assert.equal(checked.providerPayloadObserved, false);
    assert.throws(() => validateModelPreview({ ...raw, providerPayloadObserved: true }, request), invalid);
    assert.throws(() => validateModelPreview({ ...raw, endpoint: 'cli://foreign/provider-managed' }, request), invalid);
  }
});

test('outbound approval is bound to one verified payload and cannot substitute business-action approval', async () => {
  const request = conversationRequestFixture(), preview = await verifyModelPreview(planningPreviewFixture(request), request), raw = approvalFixture(preview), approval = validateOutboundApproval(raw, preview);
  assert.deepEqual(askRequest(request, preview, approval), { ...request, previewId: preview.id, approvalId: approval.id });
  assert.throws(() => askRequest({ ...request, sourceIds: [] }, preview, approval), invalid, 'adding even an empty source scope after review changes the reviewed request');
  for (const [key, value] of [['used', true], ['previewId', 'model_preview_other'], ['digest', '0'.repeat(64)], ['routeId', 'route_other'], ['endpoint', 'https://other.invalid'], ['kind', 'approval'], ['payload', {}], ['expiresAt', raw.createdAt]] as const) assert.throws(() => validateOutboundApproval({ ...raw, [key]: value }, preview), invalid);
});

test('continuation is exact server-retained metadata with bounded exchanges and order-preserved digest', async () => {
  const raw = continuationFixture(), checked = await verifyConversationContinuation(raw, raw.turnId);
  assert.equal(checked.originalQuestion, '  What was billed?  '); assert.deepEqual(checked.requestScope.sourceIds, []); assert.ok(Object.isFrozen(checked.exchanges));
  assert.throws(() => validateConversationContinuation({ ...raw, priorText: 'invented' }, raw.turnId), invalid);
  assert.throws(() => validateConversationContinuation({ ...raw, exchanges: Array(9).fill(raw.exchanges[0]) }, raw.turnId), invalid);
  await assert.rejects(verifyConversationContinuation({ ...raw, originalQuestion: raw.originalQuestion.trim() }, raw.turnId), invalid);
  const reordered = { digest: raw.digest, requestScope: raw.requestScope, sourceIds: raw.sourceIds, exchanges: raw.exchanges, clarification: raw.clarification, originalQuestion: raw.originalQuestion, turnId: raw.turnId, schemaVersion: 1 };
  await assert.rejects(verifyConversationContinuation(reordered, raw.turnId), invalid, 'server hash is raw JSON order, not arbitrary canonicalization');
  const request = { ...conversationRequestFixture(), continuationId: raw.turnId, question: 'September' };
  const preview = await verifyModelPreview(planningPreviewFixture(request), request); assert.equal(preview.purpose, 'conversation');
  if (preview.purpose === 'conversation') assert.equal(preview.continuation?.originalQuestion, checked.originalQuestion);
});

test('retained continuation binds the exact outbound prior text and private scope digest', async () => {
  const request = { ...conversationRequestFixture(), continuationId: 'conversation_clarification_fixture', question: 'September' }, raw = planningPreviewFixture(request);
  await assert.rejects(verifyModelPreview({ ...raw, requestScopeDigest: '0'.repeat(64) }, request), invalid);
  await assert.rejects(verifyModelPreview({ ...raw, businessContext: { ...raw.businessContext, request: { ...raw.businessContext.request, branch: 'forged' } } }, request), invalid);
  const envelope = JSON.parse(raw.payload), content = JSON.parse(envelope.input);
  for (const altered of [{ ...content, continuation: { ...content.continuation, clarification: 'Changed retained question' } }, { ...content, continuation: undefined, continuationDisclosure: undefined }]) {
    const payload = JSON.stringify({ ...envelope, input: JSON.stringify(altered) }); await assert.rejects(verifyModelPreview({ ...raw, payload, digest: fixtureHash(payload) }, request), invalid);
  }
});

test('plain-data validators reject getters, sparse arrays, prototypes and unsupported nested data without reading secrets', () => {
  let reads = 0; const request = conversationRequestFixture(); const getter = { ...request };
  Object.defineProperty(getter, 'question', { enumerable: true, get() { reads++; return 'PRIVATE_CUSTOMER_FIXTURE'; } });
  assert.throws(() => validateConversationRequest(getter), invalid); assert.equal(reads, 0);
  assert.throws(() => validateConversationRequest(Object.assign(Object.create({ inherited: true }), request)), invalid);
  assert.throws(() => validateConversationRequest({ ...request, sourceIds: new Array(1) }), invalid);
  const raw = planningPreviewFixture(); const symbolic = { ...raw, [Symbol('secret')]: 'PRIVATE_CUSTOMER_FIXTURE' }; assert.throws(() => validateModelPreview(symbolic, request), invalid);
});

test('grounded tool replies keep exact receipts and separate retained answer IDs from receipt IDs', () => {
  const raw = groundedFixture(), checked = validateConversationReply(raw, { modelReceiptId: raw.modelReceiptId });
  assert.ok('kind' in checked && checked.kind === 'grounded-conversation');
  if ('kind' in checked && checked.kind === 'grounded-conversation') {
    const result = checked.results[0]!; assert.ok(!result.error && result.tool === 'calculator.calculate');
    if (!result.error && result.tool === 'calculator.calculate') assert.notEqual(result.answer.id, checked.receipt.resultRefs[0]!.answerId);
    assert.ok(Object.isFrozen(checked.results));
  }
  for (const changed of [mutate(raw, ['results', '0', 'tool'], 'http.fetch'), mutate(raw, ['results', '0', 'answer', 'stale'], true), mutate(raw, ['receipt', 'modelReceiptId'], 'other'), mutate(raw, ['receipt', 'resultRefs'], []), mutate(raw, ['results', '0', 'error'], { code: 'X', message: 'Unknown' })]) assert.throws(() => validateConversationReply(changed), invalid);
});

test('all-tool errors remain explicit unavailable results with zero successful references', () => {
  const raw = groundedFixture(), error = { ...raw, results: [{ tool: 'calculator.calculate', error: { code: 'COMPARISON_REQUIRED', message: 'Give both current and comparison periods.' } }], receipt: { ...raw.receipt, resultRefs: [] } };
  assert.deepEqual(validateConversationReply(error), error);
  assert.throws(() => validateConversationReply({ ...error, results: [{ ...error.results[0], totalMinor: '0' }] }), invalid);
  for (const code of ['invalid lower-case error', '0_INVALID', 'A'.repeat(101)]) assert.throws(() => validateConversationReply({ ...error, results: [{ tool: 'calculator.calculate', error: { code, message: 'Unavailable' } }] }), invalid);
});

test('fresh error bounds and retained history error bounds follow their separate actual Engine validators', () => {
  const raw = groundedFixture(), withMessage = (message: string) => ({ ...raw, results: [{ tool: 'calculator.calculate', error: { code: 'UNAVAILABLE', message } }], receipt: { ...raw.receipt, resultRefs: [] } });
  assert.doesNotThrow(() => validateConversationReply(withMessage('x'.repeat(512))));
  assert.throws(() => validateConversationReply(withMessage('x'.repeat(513))), invalid);
  const saved = readbackFixture(withMessage('x'.repeat(2000))); assert.doesNotThrow(() => validateConversationReadback(saved, saved.id));
  assert.throws(() => validateConversationReadback(readbackFixture(withMessage('x'.repeat(2001))), saved.id), invalid);
});

test('business answers preserve canonical unknowns and legitimate conflict references outside selected citations', () => {
  const answer = businessFixture(), tools = { ...groundedFixture(), results: [{ tool: 'business.describe', answer }], receipt: { ...groundedFixture().receipt, resultRefs: [{ tool: 'business.describe', answerId: answer.id }] } };
  assert.doesNotThrow(() => validateConversationReply(tools));
  const conflict = { category: 'records', citationIds: ['business_citation_unselected'], reason: 'Permitted sources disagree.' };
  const withConflict = { ...answer, conflicts: [conflict], message: 'Some permitted source claims conflict, so they were not treated as established business facts.' };
  assert.doesNotThrow(() => validateConversationReadback(readbackFixture(withConflict), answer.id));
  assert.throws(() => validateConversationReadback(readbackFixture({ ...answer, totalMinor: '0' }), answer.id), invalid);
  assert.throws(() => validateConversationReadback(readbackFixture({ ...answer, status: 'grounded' }), answer.id), invalid);
  assert.throws(() => validateConversationReadback(readbackFixture({ ...withConflict, conflicts: [{ ...conflict, citationIds: [] }] }), answer.id), invalid);
  for (const limitations of [[], ['Invented limitation'], [...answer.scope.limitations].reverse(), [...answer.scope.limitations, 'Invented extra']]) assert.throws(() => validateConversationReadback(readbackFixture({ ...answer, scope: { ...answer.scope, limitations } }), answer.id), invalid);
  assert.doesNotThrow(() => validateConversationReadback(readbackFixture({ ...answer, scope: { ...answer.scope, limitations: [...answer.scope.limitations, 'Imported-record context is bounded; no exhaustive source coverage is claimed.'] } }), answer.id));
});

test('readback admits only the real clarification model-receipt alias and checks kind/envelope bindings', () => {
  const clarification = { clarification: 'Which period should I use?', modelReceiptId: 'model_preview_fixture' }, raw = readbackFixture(clarification);
  const saved = validateConversationReadback(raw, clarification.modelReceiptId); assert.equal(saved.id, 'conversation_clarification_fixture'); assert.equal(saved.kind, 'clarification');
  assert.throws(() => validateConversationReadback(raw, 'model_preview_other'), invalid);
  assert.throws(() => validateConversationReadback(readbackFixture(groundedFixture()), 'conversation_tools_other'), invalid);
  assert.throws(() => validateConversationReadback({ ...raw, kind: 'grounded-conversation' }, raw.id), invalid);
  assert.throws(() => validateConversationReadback({ ...raw, receiptId: 'invented' }, raw.id), invalid);
});

test('existing calculation history supports both canonical receipt forms and preserves explicit selected-zero scope', () => {
  const receipt = { ...fullCalculationReceiptFixture(), requestedSourceIds: ['source_orders', 'source_costs'] };
  const raw = readbackFixture(receipt); assert.equal(validateConversationReadback(raw, raw.id).kind, 'calculation');
  const wrapped = readbackFixture({ supported: true, message: receipt.explanation, receipt }); assert.equal(validateConversationReadback(wrapped, wrapped.id).kind, 'calculation');
  assert.throws(() => validateConversationReadback(readbackFixture({ supported: true, message: 'Invented amount', receipt }), wrapped.id), invalid);
  assert.throws(() => validateConversationReadback(readbackFixture({ ...receipt, stale: true }), raw.id), invalid);
});

test('synthesis is a separately verified preview and approval with canonical cautions and paragraph references', async () => {
  const tools = groundedFixture(), raw = synthesisPreviewFixture(tools), preview = await verifyModelPreview(raw, { id: tools.id });
  const approval = validateOutboundApproval(approvalFixture(preview), preview);
  assert.deepEqual(synthesisRunRequest(tools.id, preview, approval), { id: tools.id, previewId: raw.id, approvalId: approval.id });
  const final = synthesisReplyFixture(tools, raw), checked = await verifyConversationReply(final, { preview }); assert.ok('kind' in checked && checked.kind === 'synthesized-conversation');
  assert.throws(() => synthesisRunRequest('conversation_tools_other', preview, approval), invalid);
  const planner = await verifyModelPreview(planningPreviewFixture(), conversationRequestFixture()); assert.throws(() => synthesisRunRequest(tools.id, preview, validateOutboundApproval(approvalFixture(planner), planner)), invalid);
  for (const changed of [mutate(final, ['cautions'], []), mutate(final, ['references', '0', 'evidenceRefs'], ['e999']), mutate(final, ['references', '0', 'answerIds'], ['receipt_fixture']), mutate(final, ['receipt', 'toolTurnId'], 'other'), mutate(final, ['receipt', 'inputDigest'], '0'.repeat(64))]) await assert.rejects(verifyConversationReply(changed, { preview }), invalid);
});

test('synthesis tool checksum rejects altered grounded values even when IDs and strings remain well formed', async () => {
  const tools = groundedFixture(), raw = synthesisPreviewFixture(tools), preview = await verifyModelPreview(raw, { id: tools.id }), final = synthesisReplyFixture(tools, raw);
  await assert.rejects(verifyConversationReply(mutate(final, ['tools', 'results', '0', 'answer', 'figures', '0', 'display'], 'INR 999.00'), { preview }), invalid);
  assert.throws(() => validateConversationReply({ ...final, paragraphs: [], references: [] }), invalid);
  assert.throws(() => validateConversationReply({ ...final, references: [] }), invalid);
});

test('synthesis preview rejects caller-provided text/results, unsupported aliases and mismatched local bindings', async () => {
  const tools = groundedFixture(), raw = synthesisPreviewFixture(tools);
  for (const changed of [mutate(raw, ['summary'], {}), mutate(raw, ['send'], 'shape'), mutate(raw, ['synthesisDisclosureWarning'], ''), mutate(raw, ['synthesisBinding', 'toolTurnId'], 'other'), mutate(raw, ['synthesisSummary', 'evidence', '0', 'minor'], '123'), mutate(raw, ['synthesisSummary', 'results', '0', 'tool'], 'money.send')]) assert.throws(() => validateModelPreview(changed, { id: tools.id }), invalid);
  await assert.rejects(verifyModelPreview(mutate(raw, ['synthesisInputDigest'], fixtureHash('different')), { id: tools.id }), invalid);
});

test('synthesis review binds outbound summary and every individual local evidence digest', async () => {
  const tools = groundedFixture(), raw = synthesisPreviewFixture(tools), envelope = JSON.parse(raw.payload);
  const payload = JSON.stringify({ ...envelope, input: JSON.stringify({ ...raw.synthesisSummary, question: 'Different objective' }) });
  await assert.rejects(verifyModelPreview({ ...raw, payload, digest: fixtureHash(payload) }, { id: tools.id }), invalid);
  const altered = jsonCopy(raw); altered.synthesisBinding.evidence[0]!.evidenceHash = '0'.repeat(64); altered.synthesisAuthority.binding = altered.synthesisBinding; altered.synthesisAuthorityDigest = fixtureHash(altered.synthesisAuthority);
  await assert.rejects(verifyModelPreview(altered, { id: tools.id }), invalid);
});

test('frozen actual Engine produces accepted planning previews, approvals and local business readback without any model dispatch', async t => {
  const root = process.env.CHAUSAR_UI_ENGINE_SOURCE ?? [resolve(import.meta.dirname, '../../..'), resolve(import.meta.dirname, '../../../../task/luna-synthesis-engine')].find(candidate => existsSync(join(candidate, 'platform/runtime/engine.ts')));
  if (!root) { t.skip('Actual Engine source is absent from this standalone UI artifact; set CHAUSAR_UI_ENGINE_SOURCE for the no-dispatch proof.'); return; }
  const backend = await import(pathToFileURL(join(root, 'platform/runtime/engine.ts')).href);
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ui-contract-')); let dispatches = 0;
  const engine = new backend.Engine({ directory, demo: true, storage: 'experimental-file', gateway: { http: async () => { dispatches++; throw new Error('Model dispatch is forbidden in this proof'); }, process: async () => { dispatches++; throw new Error('Model dispatch is forbidden in this proof'); } } });
  t.after(async () => { await engine.close(); const target = resolve(directory); assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase()); assert.ok(target.toLowerCase().startsWith(join(resolve(tmpdir()), 'chausar-ui-contract-').toLowerCase())); await rm(target, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic frontend contract workspace', folder: 'fixture', passphrase: 'synthetic-contract-fixture-only', demo: false, pack: 'ecommerce' });
  await engine.request('trust.update', { send: 'shape' });
  for (const kind of ['ollama', 'claude-cli']) {
    const routeId = `route_${kind}`; await engine.request('models.configure', { config: { id: routeId, kind, model: 'synthetic-model', budgetMinor: '1000', maxCostMinor: '1' } });
    const request = { ...conversationRequestFixture(), routeId, sourceIds: [] };
    const wire: unknown = JSON.parse(JSON.stringify(await engine.request('models.preview', request))); const preview = await verifyModelPreview(wire, request);
    const approval = validateOutboundApproval(JSON.parse(JSON.stringify(await engine.request('models.approve', approveRequest(preview)))), preview); assert.equal(approval.used, false); assert.equal(preview.naturalQuestion, request.question);
  }
  const answer = await engine.request('conversation.ask', { question: 'Tell me about my business', purpose: 'business-context' });
  const saved = await engine.request('conversation.get', { id: answer.id }); assert.equal(validateConversationReadback(JSON.parse(JSON.stringify(saved)), answer.id).kind, 'business-context');
  assert.equal(dispatches, 0);
});
