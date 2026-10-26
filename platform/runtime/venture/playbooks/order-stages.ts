// Chausar flagship playbooks (Ink v2 wave 4, package 4J3): the stages an order goes through on Work, as data. Each
// flagship playbook has its own list and every other offer takes the fixed steps. Each stage names the record rule
// money/order-steps.ts reads its state with, so a stage is done, waits on the owner or never runs only because a record
// says so. Type imports only: the stage check and the order list both read this at load time.
import type { OrderStageId } from '../contracts.ts';

/**
 * The record rules a stage reads (money/order-steps.ts STAGE_RULE_READERS): order (the order exists), price (its price
 * receipt, and a new price waiting in the plan), draft (the order's newest delivery run), files (the client's files on
 * the order), ca-signoff (the CA of record's sign-off of the run's papers), calendar (the slots code planned at
 * intake), client-ok (the client's answer on a share link), posts (the posts of the order's drafts), report (a
 * monthly report's receipted figures), sent (the owner marked it delivered), invoice and paid (the order's invoice).
 */
export const STAGE_RULES = ['order', 'price', 'draft', 'files', 'ca-signoff', 'calendar', 'client-ok', 'posts', 'report', 'sent', 'invoice', 'paid'] as const;
export type StageRule = typeof STAGE_RULES[number];
/** One stage: its id (the screen's own words key on it, in English and Hindi), its English label and its record rule. */
export type OrderStage = { id: OrderStageId; label: string; rule: StageRule };

const stage = (id: OrderStageId, label: string, rule: StageRule): OrderStage => Object.freeze({ id, label, rule });
const INVOICE = stage('invoice', 'Invoice', 'invoice');
const PAID = stage('paid', 'Paid', 'paid');

/** The fixed steps every offer without a flagship playbook goes through. */
export const FIXED_STAGES: readonly OrderStage[] = Object.freeze([
  stage('agreed', 'Agreed', 'order'), stage('price', 'Price', 'price'), stage('draft', 'Draft', 'draft'), stage('sent', 'Sent', 'sent'), INVOICE, PAID,
]);

/** Each flagship playbook's stages, by its registry id (playbooks/registry.ts), and the fixed steps under 'fixed'. */
export const ORDER_STAGE_LISTS: Readonly<Record<string, readonly OrderStage[]>> = Object.freeze({
  youtube: Object.freeze([
    stage('agreed', 'Agreed', 'order'), stage('price', 'Price', 'price'), stage('episode', 'Episode', 'draft'), stage('publish', 'Publish', 'posts'), INVOICE, PAID,
  ]),
  'ca-firm': Object.freeze([stage('files-in', 'Files in', 'files'), stage('books', 'Books', 'draft'), stage('gst', 'GST', 'ca-signoff'), INVOICE, PAID]),
  'social-agency': Object.freeze([
    stage('agreed', 'Agreed', 'order'), stage('calendar', 'Calendar', 'calendar'), stage('drafts', 'Drafts', 'draft'), stage('client-ok', 'Client OK', 'client-ok'),
    stage('posts', 'Posts', 'posts'), stage('report', 'Report', 'report'), INVOICE, PAID,
  ]),
  fixed: FIXED_STAGES,
});

/** The stages for an order of this flagship playbook; the fixed steps for none, or for a playbook with no list yet. */
export function stageListFor(flagship: string | null | undefined): readonly OrderStage[] {
  return flagship && Object.hasOwn(ORDER_STAGE_LISTS, flagship) ? ORDER_STAGE_LISTS[flagship] : FIXED_STAGES;
}
