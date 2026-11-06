// Checking a reviewed preview against the current route, evidence, trust and business context before approval or
// dispatch (split out of gateway.ts, D11).
import { authorize, check, hash, internalCheck, type Context } from '../contracts.ts';
import { assertSourceAccess, isNoResend, trustFingerprint, visibleFacts } from '../trust.ts';
import { assertBusinessContextCurrent } from '../conversation-context.ts';
import type { GatewayCore } from './model-request.ts';
import { CALCULATION_REVIEW_KEYS } from './plan.ts';
import { SYNTHESIS_MARKERS, CONTINUATION_STALE, continuationId, sameContinuationScope } from './requests.ts';
import { modelReceiptRetained } from './provider-output.ts';
import { assertContinuationCurrent } from './continuation-review.ts';
import { assertSynthesisCurrent } from './synthesis-review.ts';

export function assertCurrentEvidence(core: GatewayCore, context: Context, preview: any, state = core.store.read()) {
  const view = { read: () => state, update: core.store.update.bind(core.store) }; authorize(view, context, 'prepare');
  if (CALCULATION_REVIEW_KEYS.some(key => Object.hasOwn(preview, key))) check(preview.purpose === 'conversation', 'PAYLOAD_CHANGED', 'Reviewed calculation inputs require conversation mode.');
  if (SYNTHESIS_MARKERS.some(key => preview[key] !== undefined)) check(preview.purpose === 'conversation-synthesis', 'SYNTHESIS_STALE', 'The synthesis receipt purpose changed.');
  check(modelReceiptRetained(state, preview), 'MODEL_RECEIPT_EXPIRED', 'This model disclosure is outside current retention. Create a fresh preview.');
  check(preview.memberId === context.memberId && preview.epoch === context.epoch, 'FORBIDDEN', 'This model preview belongs to another account.');
  const route = core.route(context, preview.routeId, state); check(route.revision === preview.routeRevision && route.endpoint === preview.endpoint, 'ROUTE_REVOKED', 'The route changed after preview.');
  check(state.policy.send !== 'nothing' && trustFingerprint(state, context, preview.sourceIds) === preview.trustFingerprint, 'PREVIEW_STALE', 'Permissions changed after preview.');
  assertSourceAccess(state, context, preview.sourceIds);
  check(hash(visibleFacts(view, context, preview.sourceIds)) === preview.factDigest, 'PREVIEW_STALE', 'Source data changed after preview.');
  check(!isNoResend(state, preview.digest), 'NO_RESEND', 'This deleted or expired payload cannot be sent again.');
  check(hash(preview.payload) === preview.digest, 'PAYLOAD_CHANGED', 'The approved model payload changed.');
  if (preview.schema !== undefined) check(hash(preview.schema) === preview.schemaDigest, 'PAYLOAD_CHANGED', 'The reviewed output contract changed.');
  if (preview.purpose === 'business-context' || preview.purpose === 'conversation') {
    check(preview.businessContext?.digest === preview.contextDigest, 'BUSINESS_CONTEXT_STALE', 'The exact context binding changed.');
    assertBusinessContextCurrent(view, context, preview.businessContext, core.options.businessContext);
    if (preview.businessContext.request.sourceIds !== undefined) assertSourceAccess(state, context, preview.businessContext.request.sourceIds);
    if (preview.purpose === 'conversation') {
      check(preview.questionDisclosure === 'verbatim' && typeof preview.naturalQuestion === 'string'
        && hash(preview.naturalQuestion) === preview.questionHash, 'PAYLOAD_CHANGED', 'The reviewed original question changed.');
      for (const key of ['sourceIds', 'branch', 'asOf', 'onDate', 'period'] as const) if (preview.requestScope?.[key] !== undefined)
        internalCheck(preview.businessContext.request[key] !== undefined && sameContinuationScope(key, preview.requestScope[key], preview.businessContext.request[key]),
          'TOOL_SCOPE_CHANGED', 'The private request scope differs from its exact reviewed manifest.');
      const admitted = [...(CALCULATION_REVIEW_KEYS.some(key => Object.hasOwn(preview, key))
        ? preview.businessContext.request.sourceIds ?? preview.businessContext.sourceIds : preview.businessContext.sourceIds)].sort();
      check(hash(preview.sourceIds) === hash(admitted) && preview.businessContext.sourceIds.every((id: string) => admitted.includes(id)),
        'TOOL_SCOPE_CHANGED', 'The calculation admission differs from the exact reviewed source selection.');
    }
  }
  assertContinuationCurrent(core, context, preview, view, route);
  if (preview.purpose === 'conversation-synthesis') assertSynthesisCurrent(core, context, preview, view, route);
  const current = state.modelReceipts.find(r => r.id === preview.id);
  if ([preview, current].some(record => CALCULATION_REVIEW_KEYS.some(key => Object.hasOwn(record ?? {}, key)))) {
    const binding = (record: any) => Object.fromEntries(CALCULATION_REVIEW_KEYS.map(key => [key, record?.[key]]));
    check(current && hash(binding(current)) === hash(binding(preview)), 'PAYLOAD_CHANGED', 'The stored calculation review changed.');
  }
  const continuationKeys = ['continuationId', 'continuationDigest', 'continuation', 'continuationDisclosure', 'requestScopeDigest'];
  if ([preview, current].some(record => continuationKeys.some(key => record?.[key] !== undefined))) {
    const binding = (record: any) => Object.fromEntries([...continuationKeys, 'requestScope'].map(key => [key, record?.[key]]));
    check(current && hash(binding(current)) === hash(binding(preview)), CONTINUATION_STALE, 'The stored continuation review changed.');
  }
  return route;
}
