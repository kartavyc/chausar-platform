import type { ApprovalControl, ApprovalView, PhoneHeadlineView } from './presentation.ts';
import { validateApproval, validatePhoneHeadline } from './validate.ts';

/** These are UI affordances. Engine authorization is still required for every mutation. */
export function approvalControls(value: ApprovalView): readonly ApprovalControl[] {
  const approval = validateApproval(value);
  return Object.freeze(approval.can.map(action => Object.freeze({
    action,
    keyboardPrimary: action === 'approve' && approval.kind !== 'money' && !approval.needsSecondAsk,
    requiresSecondAsk: action === 'approve' && (approval.kind === 'money' || approval.needsSecondAsk),
  })));
}
export function canUsePrimaryKeyboard(value: ApprovalView): boolean {
  return approvalControls(value).some(control => control.action === 'approve' && control.keyboardPrimary);
}
/** Expired previews have no remote approval affordance, even if the cached offer did. */
export function phoneActions(value: PhoneHeadlineView, now: number): readonly ('approve' | 'notNow' | 'open-app')[] {
  if (!Number.isFinite(now)) throw new TypeError('INVALID_UI_CLOCK');
  const headline = validatePhoneHeadline(value), approval = headline.approval;
  if (!approval) return Object.freeze([]);
  if (Date.parse(approval.expiresAt) <= now) return Object.freeze(approval.actions.filter(action => action === 'open-app'));
  return approval.actions;
}
