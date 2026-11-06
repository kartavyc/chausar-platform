// Chausar delivery (Ink v2 wave 4, package 4J2; catalogue O6): the changes an agent's revision made, as tracked changes
// the owner takes or drops. When a revision lands (delivery/revise.ts), its paragraph merge is kept on the run; here
// the owner reads each change (venture.delivery.changes) and decides each one (venture.delivery.decideChange), and the
// draft's text follows. When the owner had their own version, the agent's new version sits beside it ("You edited this.
// The agent's new version is beside yours.") and the owner can Confirm replacement, which takes the agent's version
// whole and does not merge the entries, or Keep current, reject change, which keeps their own version as it was.
import { check, type Context } from '../../contracts.ts';
import { exactPayload, identifier, requireAppChannel, ventureAction } from '../records.ts';
import type { DeliveryRunRecord, DraftChangesView, DraftMerge, VentureDeps } from '../contracts.ts';
import { recordDecision } from '../journal/decisions.ts';
import { readAs } from './shared.ts';
import { changeViews, joinParagraphs, mergedText, paragraphs } from './merge.ts';
import { reopenMark, revisableRun } from './revise.ts';

/** The words beside a merge, and the replacement's own words. */
export const CHANGE_WORDS = Object.freeze({
  edited: "You edited this. The agent's new version is beside yours.",
  revised: 'The agent revised this. Each change it made is marked; drop any you do not want.',
  review: 'Review replacement',
  confirm: 'Confirm replacement',
  confirmLine: 'This does not merge the entries.',
  keep: 'Keep current, reject change',
});
/** The id of the whole replacement, beside the paragraph changes. */
export const REPLACEMENT_ID = 'replacement';

/** A run's changes as the screens read them: none until a revision landed. */
export function changesView(run: Pick<DeliveryRunRecord, 'merge'>): DraftChangesView {
  const merge = run.merge;
  if (!merge) return { changes: [] };
  return {
    changes: changeViews(merge.parts),
    line: merge.edited ? CHANGE_WORDS.edited : CHANGE_WORDS.revised,
    ...(merge.edited ? {
      replacement: {
        id: REPLACEMENT_ID, status: merge.replacement ?? 'open', review: CHANGE_WORDS.review, confirm: CHANGE_WORDS.confirm,
        confirmLine: CHANGE_WORDS.confirmLine, keep: CHANGE_WORDS.keep,
      },
    } : {}),
  };
}

/** venture.delivery.changes { runId } (read): the paragraph changes between the owner's text and the agent's later revision. */
export async function deliveryChangesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DraftChangesView> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Draft reply');
  const { state, venture } = readAs(deps, ctx, 'read');
  return changesView(revisableRun(state, venture, runId));
}

/** The draft's text after the owner's choices: null when it is the agent's own version. */
function textOf(run: DeliveryRunRecord, merge: DraftMerge): string | null {
  if (merge.replacement === 'confirmed') return null;
  if (merge.replacement === 'kept') return merge.owner;
  const text = mergedText(merge.parts);
  return joinParagraphs(paragraphs(text)) === joinParagraphs(paragraphs(run.renderedText)) ? null : text;
}

/**
 * venture.delivery.decideChange { runId, changeId, accept } (approve, app only): takes (accept) or drops one change of
 * the agent's revision, while the draft waits for the owner's review. changeId 'replacement' decides the owner's whole
 * version: accept takes the agent's version and does not merge; no keeps the owner's version as it was.
 */
export async function decideChangeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DraftChangesView> {
  requireAppChannel(ctx, 'venture.delivery.decideChange');
  const body = exactPayload(payload, ['runId', 'changeId', 'accept'], ['runId', 'changeId', 'accept']);
  const runId = identifier(body.runId, 'Draft reply');
  check(typeof body.changeId === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(body.changeId), 'INVALID_VENTURE_REQUEST', 'Send the id of the change you decided on.');
  check(typeof body.accept === 'boolean', 'INVALID_VENTURE_REQUEST', 'accept must be true or false.');
  const changeId = body.changeId, accept = body.accept;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'delivery.change', tx => {
    const run = revisableRun(tx.state, tx.venture!, runId);
    check(run.status === 'ready-for-review', 'DELIVERY_NOT_READY', 'This draft is not waiting for your review.');
    check(run.merge, 'INVALID_VENTURE_REQUEST', 'The agent has not revised this draft, so there is nothing to decide.');
    const merge: DraftMerge = structuredClone(run.merge);
    if (changeId === REPLACEMENT_ID) {
      check(merge.edited, 'INVALID_VENTURE_REQUEST', 'There is no version of yours to replace.');
      merge.replacement = accept ? 'confirmed' : 'kept';
      for (const part of merge.parts) if (part.kind === 'change') part.status = accept ? 'taken' : 'dropped';
    } else {
      const part = merge.parts.find(item => item.kind === 'change' && item.id === changeId);
      check(part && part.kind === 'change', 'INVALID_VENTURE_REQUEST', 'That change was not found on this draft.');
      part.status = accept ? 'taken' : 'dropped';
      merge.replacement = null;
    }
    // The text the owner approves changed, so Today's review row takes a new version (the old digest is spent).
    const next: DeliveryRunRecord = { ...run, merge, editedText: textOf(run, merge), reopened: reopenMark(run, tx.now) };
    tx.replace(next);
    const what = changeId === REPLACEMENT_ID ? (accept ? 'You took the agent\'s whole version.' : 'You kept your own version.') : accept ? 'You took one of the agent\'s changes.' : 'You dropped one of the agent\'s changes.';
    recordDecision(tx, { subject: `run:${runId}`, action: accept ? 'change-taken' : 'change-dropped', who: 'owner', ruleId: null, reason: what, rowId: null });
    tx.emit('run.step', { runId });
    return changesView(next);
  });
}
