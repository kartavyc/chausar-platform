// A retained clarification: resolving it through the trusted host, and checking a reviewed conversation preview
// against it again before it is sent (split out of gateway.ts, D11).
import { check, ChausarError, hash, type Context, type StateStore } from '../contracts.ts';
import { assertSourceAccess } from '../trust.ts';
import { conversationPlannerSchema } from '../conversation-planner.ts';
import type { GatewayCore } from './model-request.ts';
import { publishedCalculationCatalog, CALCULATION_REVIEW_KEYS, reviewedCalculationRequest } from './plan.ts';
import { CONTINUATION_INVALID, CONTINUATION_STALE, continuationId, validateContinuation, continuationRequest, isRecord } from './requests.ts';

export function resolveContinuation(core: GatewayCore, context: Context, id: string, view: StateStore, resolvedByModelReceiptId?: string) {
  check(continuationId(id), CONTINUATION_INVALID, 'Choose one bounded retained continuation ID.');
  const resolver = core.options.conversationContinuation;
  check(resolver, 'CONVERSATION_CONTINUATION_UNAVAILABLE', 'This retained clarification is unavailable.');
  const key = JSON.stringify([context.memberId, context.epoch, id]);
  check(core.continuationResolutions.size < 8 && !core.continuationResolutions.has(key), CONTINUATION_INVALID, 'The retained clarification chain is cyclic or exceeds eight authority checks.');
  core.continuationResolutions.add(key);
  try { return validateContinuation(resolver(context, id, view, resolvedByModelReceiptId), id); }
  finally { core.continuationResolutions.delete(key); }
}
export function assertContinuationCurrent(core: GatewayCore, context: Context, preview: any, view: StateStore, route: any) {
  if (preview.purpose !== 'conversation') {
    check(preview.continuationId === undefined && preview.continuation === undefined && preview.continuationDigest === undefined,
      CONTINUATION_STALE, 'Retained clarification disclosure requires the conversation planner.'); return;
  }
  let content: any;
  try {
    const input = route.kind.endsWith('-cli') ? preview.payload.slice(preview.instructions.length + 1)
      : ['ollama', 'openai-compatible'].includes(route.kind) ? JSON.parse(preview.payload).messages[1].content : JSON.parse(preview.payload).input;
    content = JSON.parse(input);
  } catch { throw new ChausarError('PAYLOAD_CHANGED', 'The reviewed conversation disclosure changed.'); }
  check(content?.question === preview.naturalQuestion && content.questionDisclosure === 'verbatim', 'PAYLOAD_CHANGED', 'The exact reviewed reply changed.');
  // New reviews bind host parameters to the approved bytes and exact output contract.
  // Historical ordinary receipts have no parameter disclosure and retain their old contract.
  const hasCalculationReview = CALCULATION_REVIEW_KEYS.some(key => Object.hasOwn(preview, key)) || content.calculationParameters !== undefined;
  if (hasCalculationReview) {
    check(CALCULATION_REVIEW_KEYS.every(key => Object.hasOwn(preview, key)), 'PAYLOAD_CHANGED', 'The reviewed calculation inputs are incomplete.');
    const review = reviewedCalculationRequest(preview.reviewedCalculationParameters, preview.businessContext.request, preview.continuation);
    check(hash(review.parameters) === preview.calculationParametersDigest && hash(review.parameters) === hash(preview.reviewedCalculationParameters)
      && hash(review.origins) === hash(preview.calculationParameterOrigins) && hash(review.disclosure) === hash(preview.calculationParameterDisclosure)
      && hash(review.disclosure) === hash(content.calculationParameters), 'PAYLOAD_CHANGED', 'The exact reviewed calculation inputs changed.');
    const catalogue = publishedCalculationCatalog(view.read(), preview.operations, review.parameters);
    check(preview.definitionDisclosure === 'published' && content.definitionDisclosure === 'published'
      && hash(catalogue) === hash(preview.publishedCalculations) && hash(catalogue) === hash(content.publishedCalculations),
      'PAYLOAD_CHANGED', 'The reviewed published calculation definitions changed.');
    check(hash(conversationPlannerSchema({ manifest: preview.businessContext, operations: preview.operations, selectors: preview.selectors,
      reviewedCalculationParameters: review.parameters })) === preview.schemaDigest, 'PAYLOAD_CHANGED', 'The reviewed calculation contract no longer matches its inputs.');
  }
  const hasContinuation = preview.continuationId !== undefined || preview.continuation !== undefined || preview.continuationDigest !== undefined
    || content.continuation !== undefined || content.continuationDisclosure !== undefined;
  if (!hasContinuation) return;
  check(continuationId(preview.continuationId) && preview.continuationDisclosure === 'verbatim' && content.continuationDisclosure === 'verbatim',
    CONTINUATION_STALE, 'The exact retained continuation selection changed.');
  const saved = validateContinuation(preview.continuation, preview.continuationId);
  check(saved.digest === preview.continuationDigest && isRecord(preview.requestScope) && preview.requestScopeDigest === hash(preview.requestScope)
    && hash(preview.requestScope) === hash(preview.businessContext?.request), CONTINUATION_STALE, 'The retained continuation or reviewed private scope changed.');
  const { turnId, originalQuestion, clarification, exchanges } = saved;
  check(isRecord(content.continuation) && hash(content.continuation) === hash({ turnId, originalQuestion, clarification, ...(exchanges !== undefined ? { exchanges } : {}) }),
    CONTINUATION_STALE, 'The reviewed retained objective and clarification changed.');
  const current = resolveContinuation(core, context, preview.continuationId, view, preview.id);
  check(current.digest === saved.digest && hash(current) === hash(saved), CONTINUATION_STALE, 'The current retained clarification changed. Create a new exact preview.');
  continuationRequest(preview.requestScope, current);
  if (hasCalculationReview) reviewedCalculationRequest(preview.reviewedCalculationParameters, preview.requestScope, current);
  assertSourceAccess(view.read(), context, current.sourceIds);
}
