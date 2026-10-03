import { createHash } from 'node:crypto';
import type { ConversationRequest } from '../src/bridge/conversation-contract.ts';
import type { ReviewedCalculationParameters, CalculationParameterOrigins } from '../src/bridge/calculation-parameters.ts';
import { fullCalculationReceiptFixture } from './fixtures.ts';

/** Synthetic source-shaped wire DTOs, never examples of live business evidence. */
export const fixtureHash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const conversationRequestFixture = (): ConversationRequest => ({ question: '  What was billed?  ', purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'route_fixture' });
const at = '2026-10-01T09:00:00.000Z';
const profileCategories = ['industry', 'products', 'customers', 'business_model', 'location'];
export function businessFixture(modelReceiptId = 'model_preview_fixture') {
  const contextDigest = fixtureHash('synthetic-business-context');
  return {
    id: 'business_answer_fixture', kind: 'business-context' as const, status: 'unknown' as const, message: '', claims: [], citations: [], unknowns: [], conflicts: [],
    scope: { branch: null, asOf: at, onDate: '2026-10-01', syntheticFixture: true, corpus: 'currently-authorized-local-evidence', completeness: 'bounded', limitations: ['Only currently permitted, retained local evidence was searched.', 'Absence in this context does not establish absence elsewhere.', 'Owner statements and draft assumptions are not verified financial results.'] },
    contextDigest, sourceIds: [], rowIds: [], profileIds: [],
    receipt: { id: 'business_answer_fixture', kind: 'business-context-receipt', contextDigest, financialCalculation: false, sourceIds: [], rowIds: [], modelReceiptId },
  };
}
export function continuationFixture(id = 'conversation_clarification_fixture') {
  const body = { schemaVersion: 1, turnId: id, originalQuestion: '  What was billed?  ', clarification: 'Which period should I use?',
    exchanges: [{ question: '  What was billed?  ', clarification: 'Which period should I use?' }], sourceIds: [], requestScope: { sourceIds: [], asOf: at, onDate: '2026-10-01' } };
  return { ...body, digest: fixtureHash(body) };
}
export function planningPreviewFixture(request: ConversationRequest = conversationRequestFixture()) {
  const schema = { type: 'object', additionalProperties: false, properties: { kind: { enum: ['execute', 'clarification'] } } };
  const requestScope = Object.fromEntries(['sourceIds', 'branch', 'asOf', 'onDate', 'period'].filter(k => Object.hasOwn(request, k)).map(k => [k, Object.getOwnPropertyDescriptor(request, k)!.value]));
  const manifest = { schemaVersion: 1, kind: 'business-context-manifest', workspaceId: 'workspace_fixture', memberId: 'owner', epoch: 1,
    request: { ...requestScope, asOf: at, onDate: '2026-10-01' }, dictionaryHash: null, claims: [], citations: [], unknownCategories: profileCategories,
    sourceIds: [...(request.sourceIds ?? [])], rowIds: [], profileIds: [], conflicts: [], scope: businessFixture().scope,
    trustFingerprint: fixtureHash('synthetic-trust'), observedContentHash: fixtureHash([]), digest: fixtureHash('synthetic-manifest') };
  const retained = request.continuationId ? continuationFixture(request.continuationId) : undefined;
  const reviewedCalculationParameters: ReviewedCalculationParameters = Object.fromEntries(['period', 'comparePeriod', 'assumptions']
    .filter(key => Object.hasOwn(request, key)).map(key => [key, Object.getOwnPropertyDescriptor(request, key)!.value]));
  const calculationParameterOrigins: CalculationParameterOrigins = Object.fromEntries(Object.keys(reviewedCalculationParameters).map(key => [key, 'owner-requested']));
  const calculationParameterDisclosure = {
    kind: 'owner-requested-calculation-parameters' as const,
    period: reviewedCalculationParameters.period ?? null, comparePeriod: reviewedCalculationParameters.comparePeriod ?? null,
    assumptions: reviewedCalculationParameters.assumptions ? { origin: 'owner-requested' as const,
      label: 'Owner-requested price assumption in basis points; scenario only, not a measured fact.', ...reviewedCalculationParameters.assumptions } : null,
    missingInputClarifications: {
      change: !reviewedCalculationParameters.period && !reviewedCalculationParameters.comparePeriod ? 'Which current and comparison periods should I use?'
        : !reviewedCalculationParameters.period ? 'Which current period should I use?' : !reviewedCalculationParameters.comparePeriod ? 'Which comparison period should I use?' : null,
      scenario: reviewedCalculationParameters.assumptions ? null : 'What price change in basis points should I assume?',
    }, origins: calculationParameterOrigins,
  };
  const payload = JSON.stringify({ model: 'synthetic-model', instructions: 'Synthetic fixture planner.', input: JSON.stringify({ question: request.question, questionDisclosure: 'verbatim', calculationParameters: calculationParameterDisclosure, ...(retained ? { continuationDisclosure: 'verbatim', continuation: { turnId: retained.turnId, originalQuestion: retained.originalQuestion, clarification: retained.clarification, exchanges: retained.exchanges } } : {}) }), tools: [] });
  return {
    id: 'model_preview_fixture', kind: 'model-preview' as const, status: 'preview' as const, purpose: 'conversation' as const,
    createdAt: at, at, memberId: 'owner', epoch: 1, routeId: request.routeId, routeRevision: 1, endpoint: 'https://synthetic-fixture.invalid/v1/responses',
    questionDisclosure: 'verbatim', naturalQuestion: request.question, questionHash: fixtureHash(request.question),
    questionDisclosureWarning: 'The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.',
    reviewedCalculationParameters, calculationParameterOrigins, calculationParametersDigest: fixtureHash(reviewedCalculationParameters), calculationParameterDisclosure,
    calculationParameterDisclosureWarning: 'Exact owner-requested periods and scenario assumptions are included separately from evidence Shape. Review them before approving this payload once; scenario inputs never alter source facts.',
    definitionDisclosure: 'published', publishedCalculations: { dictionaryHash: null, dictionaryVersion: null, operations: [], unavailableReason: 'No published calculation definitions are available.' },
    definitionDisclosureWarning: 'Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.',
    ...(retained ? { continuationId: retained.turnId, continuationDigest: retained.digest, continuation: retained, continuationDisclosure: 'verbatim',
      continuationDisclosureWarning: 'The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.',
      requestScopeDigest: fixtureHash(manifest.request) } : {}),
    requestScope: retained ? manifest.request : requestScope, profileSamplesHash: fixtureHash([]), schema, schemaDigest: fixtureHash(schema), instructions: 'Synthetic fixture planner.',
    businessContext: manifest, contextDigest: manifest.digest, profileIds: [], sourceIds: manifest.sourceIds, factIds: [], rowIds: [], factDigest: fixtureHash([]),
    operations: [], selectors: { branches: [], customerIds: [] }, payload, digest: fixtureHash(payload), approvalRequired: true,
    send: 'shape', trustFingerprint: manifest.trustFingerprint, receiptBoundary: 'application-to-provider-http', providerPayloadObserved: true,
    costReservedMinor: '0', estimatedCostMinor: '1', costCurrency: 'INR', experimental: true,
  };
}
export function approvalFixture(preview: { readonly id: string; readonly digest: string; readonly routeId: string; readonly endpoint?: string }) {
  return { id: `outbound_approval_${preview.id}`, kind: 'outbound-approval', previewId: preview.id, digest: preview.digest, routeId: preview.routeId,
    ...(preview.endpoint !== undefined ? { endpoint: preview.endpoint } : {}), approverId: 'owner', approverEpoch: 1, createdAt: at, expiresAt: '2030-01-01T00:00:00.000Z', used: false };
}
export function groundedFixture(modelReceiptId = 'model_preview_fixture') {
  return { id: 'conversation_tools_fixture', kind: 'grounded-conversation' as const, modelReceiptId,
    results: [{ tool: 'calculator.calculate' as const, answer: fullCalculationReceiptFixture() }],
    receipt: { id: 'conversation_tools_fixture', kind: 'conversation-tool-receipt', modelReceiptId, resultRefs: [{ tool: 'calculator.calculate', answerId: 'message_calculation_fixture' }] } };
}
export function synthesisPreviewFixture(tools = groundedFixture()) {
  const resultRef = 'r1', answerId = tools.receipt.resultRefs[0]!.answerId, receipt = tools.results[0]!.answer;
  const evidence: Record<string, unknown>[] = [], local: Record<string, unknown>[] = [];
  const add = (item: Record<string, unknown>, renderText: string, metadata: Record<string, unknown> = {}) => {
    const ref = `e${evidence.length + 1}`; evidence.push({ ...item, ref, resultRef });
    local.push({ ref, resultRef, answerId, evidenceHash: fixtureHash({ item, renderText, metadata }), renderText, ...metadata });
  };
  receipt.figures.forEach(f => add({ kind: 'figure', label: f.label, unit: f.unit, ...('currency' in f ? { currency: f.currency } : {}) }, f.display, { receiptId: receipt.id, figureKey: f.key }));
  add({ kind: 'scope', label: 'Calculation period' }, `${receipt.period!.from} to ${receipt.period!.to}`);
  add({ kind: 'scope', label: 'Selected branch' }, 'All permitted branches in the selected sources');
  add({ kind: 'scope', label: 'Known-on timestamp' }, receipt.asOf);
  receipt.coverage.gaps.forEach(gap => add({ kind: 'caution', code: 'CALCULATION_GAP', label: 'A calculation coverage gap remains.', required: true }, gap));
  if (receipt.exclusions.length) add({ kind: 'caution', code: 'CALCULATION_EXCLUSIONS', label: 'Some selected records were excluded.', required: true }, `${receipt.exclusions.length} selected records were excluded; see the exact calculation receipt.`);
  const synthesisSummary = { schemaVersion: 1, question: '  What was billed?  ', results: [{ ref: resultRef, tool: 'calculator.calculate', status: 'ok', evidenceRefs: evidence.map(e => e.ref) }], evidence, citationRefs: [] };
  const synthesisBinding = { toolTurnId: tools.id, plannerModelReceiptId: tools.modelReceiptId, toolResultsDigest: fixtureHash(tools), inputDigest: fixtureHash(synthesisSummary), evidence: local };
  const sourceIds = receipt.sourceIds, factIds = receipt.rowIds, rowIds = receipt.rowIds;
  const synthesisAuthority = { summary: synthesisSummary, binding: synthesisBinding, sourceIds, factIds, rowIds };
  const schema = { type: 'object', additionalProperties: false, required: ['schemaVersion', 'paragraphs', 'cautionRefs'] };
  const payload = JSON.stringify({ model: 'synthetic-model', instructions: 'Synthetic fixture synthesis.', input: JSON.stringify(synthesisSummary), tools: [] });
  return { id: 'model_preview_synthesis_fixture', kind: 'model-preview' as const, status: 'preview' as const, purpose: 'conversation-synthesis' as const,
    createdAt: at, at, memberId: 'owner', epoch: 1, routeId: 'route_fixture', routeRevision: 1, endpoint: 'https://synthetic-fixture.invalid/v1/responses',
    questionDisclosure: 'verbatim', naturalQuestion: synthesisSummary.question, questionHash: fixtureHash(synthesisSummary.question), toolTurnId: tools.id,
    synthesisAuthority, synthesisAuthorityDigest: fixtureHash(synthesisAuthority), synthesisSummary, synthesisBinding, synthesisInputDigest: fixtureHash(synthesisSummary), synthesisDisclosure: 'admitted-tool-summary',
    synthesisDisclosureWarning: 'The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once.',
    sourceIds, factIds, rowIds, factDigest: fixtureHash([]), trustFingerprint: fixtureHash('synthetic-trust'), schema, schemaDigest: fixtureHash(schema), instructions: 'Synthetic fixture synthesis.',
    payload, digest: fixtureHash(payload), approvalRequired: true, send: 'samples', receiptBoundary: 'application-to-provider-http', providerPayloadObserved: true, costReservedMinor: '0', estimatedCostMinor: '1', costCurrency: 'INR', experimental: true };
}
export function synthesisReplyFixture(tools = groundedFixture(), preview = synthesisPreviewFixture(tools)) {
  const cautionRefs = preview.synthesisSummary.evidence.filter(e => e.kind === 'caution').map(e => e.ref);
  const substantive = preview.synthesisBinding.evidence.filter(local => preview.synthesisSummary.evidence.some(e => e.ref === local.ref && e.kind !== 'caution'));
  const groups = [substantive.slice(0, 6), substantive.slice(6)].filter(items => items.length);
  return { id: 'conversation_final_fixture', kind: 'synthesized-conversation' as const, paragraphs: groups.map(items => `Retained evidence: ${items.map(item => item.renderText).join('; ')}.`),
    cautions: cautionRefs.map(ref => ({ ref, text: preview.synthesisBinding.evidence.find(e => e.ref === ref)!.renderText })),
    references: groups.map(items => ({ evidenceRefs: items.map(item => item.ref), answerIds: [...new Set(items.map(item => item.answerId))], receiptIds: [...new Set(items.flatMap(item => item.receiptId ? [item.receiptId] : []))], citationIds: [...new Set(items.flatMap(item => (item.citationIds as string[] | undefined) ?? []))] })), tools,
    receipt: { id: 'conversation_final_fixture', kind: 'conversation-synthesis-receipt', toolTurnId: tools.id, plannerModelReceiptId: tools.modelReceiptId,
      synthesisModelReceiptId: preview.id, inputDigest: preview.synthesisInputDigest, outputDigest: fixtureHash('synthetic-output') } };
}
export function readbackFixture(answer: unknown, question = '  What was billed?  ') {
  const v = answer as Record<string, unknown>, kind = Object.hasOwn(v, 'clarification') ? 'clarification' : v.kind ?? 'calculation';
  const id = kind === 'clarification' ? 'conversation_clarification_fixture' : kind === 'calculation' ? 'message_calculation_fixture' : v.id;
  return { id: id as string, at, question, kind, answer };
}
