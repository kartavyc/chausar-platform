// One-shot A3 (S2, after two reviews): an edit of a draft made on Today, which checks it lifts, and which it runs again.
//
// - Only a real edit counts. The words are compared with every run of spaces folded and invisible characters (format
//   characters such as U+200B and U+2060, and the soft hyphen) dropped. An edit that says the same words as the agent's
//   draft, or as the text it replaced, is no edit.
// - Every edit's own words are checked again, whoever made it: claims of work not done (with the run's own proofs, so a
//   claim a tool backed survives a typo fix), words meant for the AI, the sections the draft must have and its length
//   (when the run was held to them), and the amounts in it.
// - Only the owner's own edit lifts any of the agent's checks (a cofounder may edit, and the agent's checks stay until
//   the owner's own edit), as only the owner chooses which Codex runs (A2). It lifts the checks that read the agent's
//   authorship (the rules judge, the claim check, the house style) and the agent's figures (receipts, figures-resolve:
//   the edited text is plain words, with no figure parts; its amounts are checked below).
// - Job-level checks (something acted outside Chausar, the agent ran out of turns, it never asked the client what was
//   missing) are about the run, not its words: no edit lifts them, and Today offers no edit for such a draft.
// - Amounts, as the founder's rules have it: an amount equal in value to one of the draft's receipts is the receipt's,
//   however it is written ("INR 5,000.00", "Rs 5,000", "₹5000"). An amount the agent wrote with no receipt that survives
//   in the edit still fails. Any other amount is the editor's own words: allowed, never shown as receipted, and the
//   check and the decision say "This amount is in your own words, not from a receipt."
import type { State } from '../../contracts.ts';
import type { CheckId, CheckResult, Deliverable, DeliveryRunRecord, DraftEditRecord, ServiceType, TextPart } from '../contracts.ts';
import type { AnyReceipt } from './deliverable.ts';
import { copiedTokens, findRecord, listRecords } from '../records.ts';
import { runChecks } from './checks.ts';
import { ventureReceipts } from './shared.ts';
import { proofsOf } from './harness/loop.ts';

/** The checks about the run itself, not its words: no edit lifts them. */
export const JOB_LEVEL_CHECKS: readonly CheckId[] = Object.freeze(['no-outside-writes', 'turn-limit', 'questions-raised']);
/** The agent's checks the owner's own edit lifts: who wrote the words, and the agent's figures. */
export const LIFTED_BY_OWNER_EDIT: readonly CheckId[] = Object.freeze(['rules-judge', 'claims-grounded', 'house-style', 'receipts', 'figures-resolve']);
/** Run again on every edit's own words; the second list only when the run itself was held to them. */
const ALWAYS_RECHECKED: readonly CheckId[] = Object.freeze(['no-done-claims', 'prompt-leak']);
const RECHECKED_WHEN_RUN: readonly CheckId[] = Object.freeze(['required-sections', 'length-bounds']);
/** The words for an amount the editor wrote that no receipt holds. */
export const OWN_WORDS_AMOUNT = 'This amount is in your own words, not from a receipt.';

/** The words with invisible characters dropped and every run of spaces, tabs and line breaks folded to one space. */
export const foldedWords = (text: string): string => text.normalize('NFC').replace(/[\p{Cf}­]/gu, '').replace(/\s+/g, ' ').trim();
/** Whether two texts say the same words, spaces and invisible characters aside. */
export const sameWords = (a: string | null | undefined, b: string | null | undefined): boolean => foldedWords(a ?? '') === foldedWords(b ?? '');

/**
 * The edit in force on this run, whoever made it, or null: the newest edit not undone is the run's text, no agent
 * revision is waiting or merged into it, and its words are neither the agent's draft nor the text it replaced.
 */
export function editInForce(state: State, run: DeliveryRunRecord): DraftEditRecord | null {
  if (typeof run.editedText !== 'string' || run.merge || run.revision) return null;
  const edit = listRecords(state, 'venture-draft-edit', run.ventureId).filter(item => item.runId === run.id && !item.undoneAt).at(-1);
  if (!edit || edit.text !== run.editedText) return null;
  return sameWords(edit.text, run.renderedText) || (typeof edit.replaced === 'string' && sameWords(edit.text, edit.replaced)) ? null : edit;
}

/** The failed check that is about the run itself, so no edit can free the draft; null when there is none. */
export function jobLevelFailure(checks: readonly CheckResult[]): CheckResult | null {
  return checks.find(result => !result.passed && !result.notChecked && JOB_LEVEL_CHECKS.includes(result.check)) ?? null;
}

// ---------------------------------------------------------------------------
// Amounts, by value
// ---------------------------------------------------------------------------

type Amount = { currency: string; minor: bigint; text: string };
const CURRENCY: Readonly<Record<string, string>> = {
  '₹': 'INR', rs: 'INR', 'rs.': 'INR', inr: 'INR', rupee: 'INR', rupees: 'INR', '$': 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD',
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP',
};
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const BEFORE = new RegExp(String.raw`(₹|\$|€|£|\b(?:rs\.?|inr|usd|eur|gbp))\s?(${NUMBER})`, 'giu');
const AFTER = new RegExp(String.raw`\b(${NUMBER})\s?(rupees?|inr|usd|dollars?|euros?|eur|pounds?|gbp)\b`, 'giu');

function minorOf(number: string): bigint {
  const [whole, fraction = ''] = number.replace(/,/g, '').split('.');
  return BigInt(whole!) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

/** Every amount of money written in the words, with its currency and its value in minor units. */
export function amountsIn(text: string): Amount[] {
  const found: Amount[] = [];
  for (const match of text.matchAll(BEFORE)) found.push({ currency: CURRENCY[match[1]!.toLowerCase()] ?? 'INR', minor: minorOf(match[2]!), text: match[0] });
  for (const match of text.matchAll(AFTER)) found.push({ currency: CURRENCY[match[2]!.toLowerCase()] ?? 'INR', minor: minorOf(match[1]!), text: match[0] });
  return found;
}
const keyOf = (amount: Amount) => `${amount.currency}:${amount.minor}`;

/** The receipts this run's figures may come from: the venture's price receipts and this run's own work receipts. */
function runReceipts(state: State, run: DeliveryRunRecord): AnyReceipt[] {
  const work = listRecords(state, 'venture-work-receipt', run.ventureId).filter(row => row.runRef.kind === 'delivery' && row.runRef.runId === run.id);
  return [...ventureReceipts(state, run.ventureId), ...work] as AnyReceipt[];
}

/** The values the run's receipts hold: the figures the draft cited and the order's own price. */
function receiptedValues(state: State, run: DeliveryRunRecord, receipts: readonly AnyReceipt[]): Set<string> {
  const cited = new Set<string>();
  const order = findRecord(state, 'venture-order', run.orderId);
  if (order?.priceReceiptId) cited.add(order.priceReceiptId);
  for (const section of run.deliverable?.sections ?? []) for (const part of section.parts) if (part.kind === 'figure') cited.add(part.receiptId);
  const values = new Set<string>();
  for (const receipt of receipts) {
    if (!cited.has(receipt.id)) continue;
    for (const figure of (receipt.figures as readonly { display?: string }[] | undefined) ?? []) for (const amount of amountsIn(figure.display ?? '')) values.add(keyOf(amount));
  }
  return values;
}

/** The values the agent wrote in its own words (never its figure parts). */
function agentValues(run: DeliveryRunRecord): Set<string> {
  const words = (run.deliverable?.sections ?? []).flatMap(section => section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : [])));
  return new Set(amountsIn([run.deliverable?.title ?? '', ...words, ...(run.deliverable?.questionsForClient ?? [])].join('\n')).map(keyOf));
}

/** The amounts check on an edit's words, under the money rule's id. */
function amountsCheck(text: string, receipted: ReadonlySet<string>, agent: ReadonlySet<string>): CheckResult {
  let own = 0;
  for (const amount of amountsIn(text)) {
    const key = keyOf(amount);
    if (receipted.has(key)) continue;
    if (agent.has(key)) return { check: 'no-numeric-prose', passed: false, detail: `This keeps an amount the agent wrote with no receipt: "${amount.text}". Change it or take it out.` };
    own += 1;
  }
  return { check: 'no-numeric-prose', passed: true, detail: own ? OWN_WORDS_AMOUNT : 'Every amount comes from a receipt.' };
}

// ---------------------------------------------------------------------------
// The edit's own words as a draft, and its checks
// ---------------------------------------------------------------------------

/** The edited text as a draft: its "# " title, its "## " sections, and their lines as words. */
export function deliverableOf(text: string): Deliverable {
  let title = '';
  const sections: { heading: string; parts: TextPart[] }[] = [];
  let current: { heading: string; parts: TextPart[] } = { heading: '', parts: [] };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^\s*#{2,3}\s+(.+?)\s*$/.exec(line);
    const top = /^\s*#\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.heading || current.parts.length) sections.push(current);
      current = { heading: heading[1]!, parts: [] };
    } else if (top && !title) title = top[1]!;
    else if (line.trim()) current.parts.push({ kind: 'text', text: line.trim() });
  }
  if (current.heading || current.parts.length) sections.push(current);
  return { title, sections, questionsForClient: [] };
}

/** How the run's own checks were set: the sections its draft must have, and the business's service type. */
export type EditContext = { sections: readonly string[] | null; serviceType: ServiceType };

/** The checks that read the words, run again on an edit's own text. */
export function editChecks(state: State, run: DeliveryRunRecord, text: string, context: EditContext): CheckResult[] {
  const receipts = runReceipts(state, run);
  const order = findRecord(state, 'venture-order', run.orderId);
  const venture = listRecords(state, 'venture-record').find(row => row.id === run.ventureId);
  const ran = new Set(run.checks.map(result => result.check));
  const results = runChecks({
    checks: [...ALWAYS_RECHECKED, ...RECHECKED_WHEN_RUN.filter(id => ran.has(id))], deliverable: deliverableOf(text), renderedText: text,
    serviceType: context.serviceType, flagship: null, ...(context.sections ? { sections: context.sections } : {}),
    allowed: copiedTokens(order?.request ?? '', venture?.idea ?? ''), receipts, ventureId: run.ventureId,
    mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false, proofs: proofsOf(run.harness ?? null),
  });
  return [...results, amountsCheck(text, receiptedValues(state, run, receipts), agentValues(run))];
}

/**
 * The checks a draft is held to with an edit in force. Every edit's words are checked again. The owner's own edit also
 * lifts the agent's authorship and figure checks and takes the place of the agent's word checks; a cofounder's edit
 * keeps every one of the agent's checks besides its own.
 */
export function checksWithEdit(state: State, run: DeliveryRunRecord, edit: DraftEditRecord, context: EditContext): CheckResult[] {
  const rechecked = editChecks(state, run, edit.text, context);
  if (edit.role !== 'owner') return [...run.checks, ...rechecked];
  const replaced = new Set(rechecked.map(result => result.check));
  return [...run.checks.filter(result => !LIFTED_BY_OWNER_EDIT.includes(result.check) && !replaced.has(result.check)), ...rechecked];
}

/** Whether the words of an edit hold an amount that is the editor's own, for the decision's record. */
export function ownAmounts(checks: readonly CheckResult[]): boolean {
  return checks.some(result => result.check === 'no-numeric-prose' && result.passed && result.detail === OWN_WORDS_AMOUNT);
}
