// Two pure checks a dispatched request must pass against its reviewed preview (split out of gateway.ts, D11).
import { check, hash, type Context, type State } from '../contracts.ts';
import { validateReviewedConversationCalculationParameters } from '../conversation-calculation-arguments.ts';
import type { ModelRequest } from './model-request.ts';
import { synthesisRequest, sameContinuationScope } from './requests.ts';

export function assertRequestMatchesPreview(request: Partial<ModelRequest>, preview: any) {
  if (preview.purpose === 'conversation-synthesis') synthesisRequest(request);
  if (preview.purpose !== 'conversation') check(request.comparePeriod === undefined && request.assumptions === undefined, 'INVALID_CALCULATION_PARAMETERS', 'Comparison and scenario inputs require the reviewed conversation mode.');
  check(request.toolTurnId === preview.toolTurnId, 'PREVIEW_REQUEST_CHANGED', 'Use the exact admitted tool-turn ID reviewed for synthesis.');
  check(!['business-context', 'conversation'].includes(preview.purpose) || request.samples === undefined, 'INVALID_SAMPLE', 'Context previews cannot be reused with raw fact sample selections.');
  if (request.question !== undefined) {
    check(typeof request.question === 'string', 'INVALID_QUESTION', 'The reviewed question must be plain text.');
    check(hash(['conversation', 'conversation-synthesis'].includes(preview.purpose) ? request.question : request.question.trim()) === preview.questionHash, 'PREVIEW_REQUEST_CHANGED', 'Use the exact question reviewed in this preview.');
  }
  if (request.purpose !== undefined) check(request.purpose === preview.purpose, 'PREVIEW_REQUEST_CHANGED', 'The requested purpose changed after preview.');
  if (request.questionDisclosure !== undefined) check(request.questionDisclosure === preview.questionDisclosure, 'PREVIEW_REQUEST_CHANGED', 'Original-question disclosure changed after preview.');
  if (request.routeId !== undefined) check(request.routeId === preview.routeId, 'PREVIEW_REQUEST_CHANGED', 'The requested route changed after preview.');
  check(request.continuationId === preview.continuationId, 'PREVIEW_REQUEST_CHANGED', 'Use the exact retained continuation ID reviewed in this preview.');
  for (const key of ['sourceIds', 'branch', 'asOf', 'onDate', 'period'] as const) if (request[key] !== undefined)
    check(preview.requestScope && Object.hasOwn(preview.requestScope, key) && (preview.continuationId !== undefined
      ? sameContinuationScope(key, request[key], preview.requestScope[key]) : hash(request[key]) === hash(preview.requestScope[key])), 'PREVIEW_REQUEST_CHANGED', 'Use the exact scope reviewed in this preview.');
  for (const key of ['comparePeriod', 'assumptions'] as const) if (Object.hasOwn(request, key)) {
    const supplied = validateReviewedConversationCalculationParameters({ [key]: request[key] });
    check(preview.reviewedCalculationParameters?.[key] !== undefined && hash(supplied[key]) === hash(preview.reviewedCalculationParameters[key]), 'PREVIEW_REQUEST_CHANGED', 'Use the exact calculation inputs reviewed in this preview.');
  }
  if (request.profileSamples !== undefined) check(hash(request.profileSamples) === preview.profileSamplesHash, 'PREVIEW_REQUEST_CHANGED', 'The selected disclosure samples changed after preview.');
}
export function assertUnusedOutboundApproval(state: State, preview: any, approvalId?: string) {
  const approvals = state.modelReceipts.filter(a => a.id === approvalId && a.kind === 'outbound-approval'), approval = approvals[0];
  const approver = state.members.find(m => m.id === approval?.approverId);
  check(approvals.length === 1 && approval && !approval.used && approval.previewId === preview.id && approval.digest === preview.digest
    && approval.routeId === preview.routeId && approval.endpoint === preview.endpoint && Date.parse(approval.expiresAt) > Date.now()
    && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role),
    'OUTBOUND_APPROVAL_REQUIRED', 'An owner must approve this exact model payload before it leaves the machine.');
  return approval;
}
