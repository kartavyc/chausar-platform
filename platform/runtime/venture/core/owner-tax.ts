// Found on the real Windows app, 16 November 2026: Today asked "Confirm your tax. Chausar assumed you do not charge GST.
// Say whether you do.", and an owner who does not charge it had no way to say so, so the card never left. The owner's
// own "No" on Prices is an answer like any other: venture.blueprint.update { patch: { taxRegistered: false }, ownerSave }
// from the app. Where the accepted plan already charges no tax, that answer changes no amount, price, offer or step:
// only who said it (Chausar's assumption becomes told-by-you). So, inside the one-press rule the founder approved for
// the owner's own price (owner-price.ts), it is accepted at once and recorded as the owner's decision, and nothing waits
// on Today to be accepted again. Turning tax on, or off when the plan charged it, changes what invoices say: that
// still makes a draft and waits for Accept, exactly as before. The same answer given twice writes no version.
import { type Context } from '../../contracts.ts';
import { isAppChannel, type VentureTx } from '../records.ts';
import type { BlueprintRecord, VentureRecord } from '../contracts.ts';
import { recordDecision } from '../journal/decisions.ts';

/**
 * Whether a venture.blueprint.update request is the owner's own "No, I do not charge tax": the Prices page says so
 * (ownerSave), from the app, by a member who can approve, with that answer alone and no suggestion it was based on.
 */
export function ownerTaxNoShape(ctx: Context, body: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  if (body.ownerSave !== true || !isAppChannel(ctx) || !['owner', 'cofounder'].includes(ctx.role) || Object.hasOwn(body, 'basedOn')) return false;
  return Object.keys(patch).length === 1 && patch.taxRegistered === false;
}

/** The accepted plan already charges no tax: the answer can change only who said so. */
const sameAnswer = (venture: VentureRecord, latest: BlueprintRecord) =>
  latest.status === 'accepted' && venture.acceptedBlueprintId === latest.id && latest.backOffice.taxRegistered.value === false;

/** The owner already said No on the accepted plan: saying it again writes no version. */
export function ownerTaxNoUnchanged(venture: VentureRecord, latest: BlueprintRecord): boolean {
  return sameAnswer(venture, latest) && latest.backOffice.taxRegistered.label === 'told-by-you';
}

/**
 * Inside venture.blueprint.update's transaction, once `next` is sealed: when the accepted plan already charges no tax,
 * `next` (the same plan with the owner's own answer) is stored accepted and the decision recorded. Returns the line, or
 * null when the change waits on Today as before (`next` is then left a draft). There is no Undo row: the owner changes
 * the answer on Prices.
 */
export function applyOwnerTaxNo(tx: VentureTx, venture: VentureRecord, latest: BlueprintRecord, next: BlueprintRecord): { line: string; undoRowId: null } | null {
  if (!sameAnswer(venture, latest)) return null;
  next.status = 'accepted';
  const tax = next.backOffice.taxLabel;
  // The record reads "You decided: You do not charge GST." (journal/decisions.ts).
  recordDecision(tx, { subject: `plan:${venture.id}`, action: 'approve', ruleId: null, reason: `You do not charge ${tax}.`, rowId: null });
  return { line: `You said you do not charge ${tax}.`, undoRowId: null };
}
