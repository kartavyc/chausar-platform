// The grounded synthesis mode: the host's codec, resolving admitted tool results, checking a reviewed synthesis
// preview again, and building one (split out of gateway.ts, D11).
import { check, ChausarError, hash, newId, now, type Context, type StateStore } from '../contracts.ts';
import { assertSourceAccess, isNoResend, trustFingerprint, visibleFacts } from '../trust.ts';
import type { ConversationSynthesisCodec, GatewaySynthesisAuthority } from '../conversation-synthesis-contract.ts';
import type { ModelRequest, GatewayOptions, GatewayCore } from './model-request.ts';
import { modelPayload } from './plan.ts';
import { SYNTHESIS_INVALID, synthesisJson, synthesisObject, synthesisIds, synthesisRequest, continuationId, continuationText, isRecord } from './requests.ts';

export function synthesisCodec(options: GatewayOptions): ConversationSynthesisCodec {
  const codec = options.synthesisCodec;
  check(codec && typeof codec.instructions === 'string' && codec.instructions.trim().length > 0 && codec.instructions.length <= 32768
    && typeof codec.schema === 'function' && typeof codec.validate === 'function' && typeof codec.materialize === 'function',
  'SYNTHESIS_UNAVAILABLE', 'The trusted host has not installed the complete synthesis contract.');
  return codec;
}
export function resolveSynthesis(core: GatewayCore, context: Context, id: string, view: StateStore): GatewaySynthesisAuthority {
  check(continuationId(id), SYNTHESIS_INVALID, 'Select one bounded admitted tool-turn ID.');
  const resolve = core.options.conversationSynthesis;
  check(typeof resolve === 'function', 'SYNTHESIS_UNAVAILABLE', 'Current admitted synthesis evidence is unavailable.');
  synthesisCodec(core.options);
  const key = JSON.stringify([context.memberId, context.epoch, id]);
  check(core.synthesisResolutions.size < 8 && !core.synthesisResolutions.has(key), 'SYNTHESIS_STALE', 'The synthesis authority chain is cyclic or exceeds its bound.');
  core.synthesisResolutions.add(key);
  try {
    const authority = resolve(context, id, view);
    synthesisJson(authority); synthesisObject(authority, ['summary', 'binding', 'sourceIds', 'factIds', 'rowIds']);
    synthesisIds(authority.sourceIds, 64); synthesisIds(authority.factIds); synthesisIds(authority.rowIds);
    synthesisObject(authority.summary, ['schemaVersion', 'question', 'results', 'evidence', 'citationRefs']);
    check(authority.summary.schemaVersion === 1 && continuationText(authority.summary.question, 10000), SYNTHESIS_INVALID, 'Synthesis requires the exact bounded retained objective.');
    synthesisObject(authority.binding, ['toolTurnId', 'plannerModelReceiptId', 'toolResultsDigest', 'inputDigest', 'evidence']);
    const binding = authority.binding;
    check(binding.toolTurnId === id && continuationId(binding.plannerModelReceiptId)
      && typeof binding.toolResultsDigest === 'string' && /^[a-f0-9]{64}$/.test(binding.toolResultsDigest)
      && binding.inputDigest === hash(authority.summary) && Array.isArray(binding.evidence), SYNTHESIS_INVALID, 'The current synthesis binding does not match its exact input.');
    check(Array.isArray(authority.summary.results) && Array.isArray(authority.summary.evidence), SYNTHESIS_INVALID, 'The synthesis summary needs admitted ordered results.');
    for (const result of authority.summary.results) synthesisObject(result, ['ref', 'tool', 'status', 'evidenceRefs']);
    for (const evidence of authority.summary.evidence) check(isRecord(evidence), SYNTHESIS_INVALID, 'Synthesis evidence requires plain reference descriptors.');
    const resultRefs = authority.summary.results.map(result => result.ref), evidenceRefs = authority.summary.evidence.map(evidence => evidence.ref);
    synthesisIds(resultRefs, 4); synthesisIds(evidenceRefs, 256);
    const boundRefs: string[] = [];
    for (const evidence of binding.evidence) {
      synthesisObject(evidence, ['ref', 'resultRef', 'answerId', 'evidenceHash', 'renderText', 'receiptId', 'figureKey', 'citationIds'],
        ['ref', 'resultRef', 'answerId', 'evidenceHash', 'renderText']);
      const descriptor = authority.summary.evidence.find(item => item.ref === evidence.ref);
      check(descriptor && descriptor.resultRef === evidence.resultRef && resultRefs.includes(evidence.resultRef)
        && continuationId(evidence.answerId) && typeof evidence.evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(evidence.evidenceHash)
        && typeof evidence.renderText === 'string' && evidence.renderText.length <= 32768, SYNTHESIS_INVALID, 'A synthesis reference has no exact local evidence binding.');
      if (evidence.receiptId !== undefined) check(continuationId(evidence.receiptId), SYNTHESIS_INVALID, 'A synthesis receipt reference is invalid.');
      if (evidence.figureKey !== undefined) check(typeof evidence.figureKey === 'string' && evidence.figureKey.length > 0 && evidence.figureKey.length <= 200, SYNTHESIS_INVALID, 'A synthesis figure reference is invalid.');
      if (evidence.citationIds !== undefined) synthesisIds(evidence.citationIds, 256);
      boundRefs.push(evidence.ref);
    }
    synthesisIds(boundRefs, 256);
    check(hash([...boundRefs].sort()) === hash([...evidenceRefs].sort()), SYNTHESIS_INVALID, 'Every synthesis alias needs one exact local binding.');
    assertSourceAccess(view.read(), context, authority.sourceIds);
    const visibleIds = new Set(visibleFacts(view, context, authority.sourceIds).map(fact => fact.id));
    check([...authority.factIds, ...authority.rowIds].every(id => visibleIds.has(id)), 'SYNTHESIS_STALE', 'Current synthesis fact authority is unavailable.');
    synthesisJson(synthesisCodec(core.options).schema(structuredClone(authority.summary)));
    return structuredClone(authority);
  } finally { core.synthesisResolutions.delete(key); }
}
export function assertSynthesisCurrent(core: GatewayCore, context: Context, preview: any, view: StateStore, route: any) {
  check(view.read().policy.send === 'samples', 'SYNTHESIS_DISCLOSURE_REQUIRED', 'Private synthesis claim text requires samples policy and a separate exact approval.');
  check(continuationId(preview.toolTurnId) && preview.questionDisclosure === 'verbatim' && preview.synthesisDisclosure === 'admitted-tool-summary'
    && preview.approvalRequired === true && preview.send === 'samples' && continuationText(preview.synthesisDisclosureWarning, 4096)
    && typeof preview.naturalQuestion === 'string' && hash(preview.naturalQuestion) === preview.questionHash,
  'SYNTHESIS_STALE', 'The exact synthesis objective or tool-turn selection changed.');
  synthesisJson(preview.synthesisAuthority);
  synthesisObject(preview.synthesisAuthority, ['summary', 'binding', 'sourceIds', 'factIds', 'rowIds']);
  check(isRecord(preview.synthesisSummary) && isRecord(preview.synthesisBinding), 'SYNTHESIS_STALE', 'The stored synthesis projection is unavailable.');
  check(preview.synthesisAuthorityDigest === hash(preview.synthesisAuthority) && preview.synthesisAuthority?.binding?.toolTurnId === preview.toolTurnId
    && hash({ summary: preview.synthesisSummary, binding: preview.synthesisBinding }) === hash({ summary: preview.synthesisAuthority.summary, binding: preview.synthesisAuthority.binding })
    && preview.synthesisInputDigest === hash(preview.synthesisSummary) && preview.naturalQuestion === preview.synthesisSummary.question,
  'SYNTHESIS_STALE', 'The exact synthesis evidence binding changed.');
  let content: unknown;
  try {
    const input = route.kind.endsWith('-cli') ? preview.payload.slice(preview.instructions.length + 1)
      : ['ollama', 'openai-compatible'].includes(route.kind) ? JSON.parse(preview.payload).messages[1].content : JSON.parse(preview.payload).input;
    content = JSON.parse(input);
  } catch { throw new ChausarError('PAYLOAD_CHANGED', 'The reviewed synthesis disclosure changed.'); }
  check(hash(content) === hash(preview.synthesisSummary), 'SYNTHESIS_STALE', 'The outbound synthesis summary does not match its exact review.');
  const codec = synthesisCodec(core.options), schema = codec.schema(structuredClone(preview.synthesisSummary)); synthesisJson(schema);
  check(codec.instructions === preview.instructions && hash(schema) === preview.schemaDigest, 'SYNTHESIS_STALE', 'The installed synthesis output contract changed.');
  const current = resolveSynthesis(core, context, preview.toolTurnId, view);
  check(hash(current) === preview.synthesisAuthorityDigest && hash(current.sourceIds) === hash(preview.sourceIds)
    && hash(current.factIds) === hash(preview.factIds) && hash(current.rowIds) === hash(preview.rowIds),
  'SYNTHESIS_STALE', 'Current admitted tool results changed. Build a fresh exact synthesis preview.');
  const records = view.read().modelReceipts.filter(item => item?.id === preview.id), saved = records[0];
  const keys = ['purpose', 'routeId', 'routeRevision', 'endpoint', 'approvalRequired', 'send', 'factDigest', 'trustFingerprint', 'questionDisclosure',
    'toolTurnId', 'synthesisAuthority', 'synthesisAuthorityDigest', 'synthesisSummary', 'synthesisBinding', 'synthesisInputDigest',
    'synthesisDisclosure', 'synthesisDisclosureWarning', 'naturalQuestion', 'questionHash', 'sourceIds', 'factIds', 'rowIds', 'payload', 'digest', 'schema', 'schemaDigest', 'instructions'];
  const binding = (record: any) => Object.fromEntries(keys.map(key => [key, record?.[key]]));
  check(records.length === 1 && hash(binding(saved)) === hash(binding(preview)), 'SYNTHESIS_STALE', 'The stored synthesis review changed.');
}
export async function previewSynthesis(core: GatewayCore, context: Context, request: ModelRequest): Promise<any> {
  synthesisRequest(request);
  check(core.store.read().policy.send === 'samples', 'SYNTHESIS_DISCLOSURE_REQUIRED', 'Private synthesis claim text requires samples policy and a separate exact approval.');
  check(typeof request.routeId === 'string' && request.routeId.length > 0, 'MODEL_ROUTE_REQUIRED', 'Choose the exact model route for synthesis.');
  check(request.questionDisclosure === 'verbatim', 'QUESTION_DISCLOSURE_REQUIRED', 'Review the exact synthesis objective separately from evidence Shape.');
  const authority = resolveSynthesis(core, context, request.toolTurnId!, core.store);
  check(request.question === authority.summary.question, 'PREVIEW_REQUEST_CHANGED', 'Review the exact admitted objective for this synthesis.');
  const route = core.route(context, request.routeId), codec = synthesisCodec(core.options);
  const summary = authority.summary, schema = codec.schema(structuredClone(summary)); synthesisJson(schema);
  const instructions = codec.instructions, payload = modelPayload(route, instructions, JSON.stringify(summary), schema, 'grounded_conversation_synthesis');
  check(Buffer.byteLength(payload) <= 262144, 'PAYLOAD_TOO_LARGE', 'The exact synthesis payload is too large.');
  const digest = hash(payload), state = core.store.read(); check(!isNoResend(state, digest), 'NO_RESEND', 'This deleted or expired payload cannot be sent again.');
  const record = { id: newId('model_preview'), kind: 'model-preview', status: 'preview', purpose: 'conversation-synthesis',
    createdAt: now(), at: now(), memberId: context.memberId, epoch: context.epoch, routeId: route.id, routeRevision: route.revision, endpoint: route.endpoint,
    questionDisclosure: 'verbatim', naturalQuestion: request.question, questionHash: hash(request.question), toolTurnId: request.toolTurnId,
    synthesisAuthority: authority, synthesisAuthorityDigest: hash(authority), synthesisSummary: summary, synthesisBinding: authority.binding,
    synthesisInputDigest: hash(summary), synthesisDisclosure: 'admitted-tool-summary',
    synthesisDisclosureWarning: 'The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once.',
    sourceIds: authority.sourceIds, factIds: authority.factIds, rowIds: authority.rowIds,
    factDigest: hash(visibleFacts(core.store, context, authority.sourceIds)), trustFingerprint: trustFingerprint(state, context, authority.sourceIds),
    schema, schemaDigest: hash(schema), instructions, payload, digest, approvalRequired: true, send: state.policy.send,
    receiptBoundary: route.kind.endsWith('-cli') ? 'application-to-official-cli' : 'application-to-provider-http', providerPayloadObserved: !route.kind.endsWith('-cli'),
    costReservedMinor: '0', estimatedCostMinor: route.maxCostMinor, costCurrency: 'INR', experimental: true };
  return core.store.update(current => {
    current.modelReceipts.push(record); core.assertCurrent(context, record, current); return structuredClone(record);
  });
}
