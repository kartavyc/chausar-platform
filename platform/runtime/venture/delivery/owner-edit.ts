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
import { runChecks, summaryReceipts } from './checks.ts';
import { statesMoney } from './harness/patches.ts';
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

// A3 review 3 (M2): money is found with the money guard's own detector (statesMoney, which holds assertNoMoney), one
// clause at a time, so every way of writing money the guard knows is seen. Only an amount written exactly as a currency
// and a number (no scale word, no "k", no number run on after it) is read for its value; a clause the guard still calls
// money once those are taken out is kept by its words, never parsed in part.
const CURRENCY: Readonly<Record<string, string>> = {
  '₹': 'INR', rs: 'INR', 'rs.': 'INR', inr: 'INR', rupee: 'INR', rupees: 'INR', '$': 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD',
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP',
  aed: 'AED', dirham: 'AED', dirhams: 'AED', sgd: 'SGD', aud: 'AUD', cad: 'CAD', nzd: 'NZD', jpy: 'JPY',
};
const NUMBER = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const SCALE = String.raw`(?:lakhs?|lacs?|crores?|thousand|hundred|k|cr|l|mn|m|bn)\b`;
/** Nothing that would make the number part of a longer amount: more digits, a decimal, a letter, or a scale word. */
const ENDS = String.raw`(?![.,]?\d|\s*\d|\p{L}|\s*${SCALE})`;
const STARTS = String.raw`(?<![\p{L}\d.,])`;
const EXACT = new RegExp(String.raw`${STARTS}(₹|\$|€|£|(?:rs\.?|inr|usd|eur|gbp|aed|sgd|aud|cad|nzd|jpy)(?!\p{L}))\s{0,3}(${NUMBER})${ENDS}|${STARTS}(${NUMBER})\s{0,3}(rupees?|rs\.?|inr|usd|dollars?|euros?|eur|pounds?|gbp|aed|dirhams?|sgd|aud|cad|nzd|jpy)(?!\p{L})`, 'giu');

function minorOf(number: string): bigint {
  const [whole, fraction = ''] = number.replace(/,/g, '').split('.');
  return BigInt(whole!) * 100n + BigInt(`${fraction}00`.slice(0, 2));
}

/** One-shot A4 (A3 leftover): the currencies "$" may stand for; it is the business's own when that is one of them. */
const DOLLARS: ReadonlySet<string> = new Set(['USD', 'SGD', 'AUD', 'CAD', 'NZD', 'HKD']);
/** One-shot A4: what a currency word or sign means, "$" as the business's own dollar (else USD); never INR by default. */
function currencyOf(written: string, business: string | undefined): string {
  const word = written.toLowerCase();
  if (word === '$') return business && DOLLARS.has(business) ? business : 'USD';
  return CURRENCY[word] ?? business ?? 'XXX';
}
/**
 * A4 review (M1): a number joined to an exact amount as a range or a sum is money too ("Rs 5,000-9,000", "5,000 to
 * 9,000", "5,000 plus 4,000", "INR 5,000.00 x 3"). Any other number beside it (an invoice number, a count, a date, a
 * phone number, a PIN code) is words, so a sentence the agent wrote, kept unchanged, never fails over it.
 */
const JOINED = /^\s*(?:[-–]|to\b|plus\b|\+|x\b|×|\*|times\b)\s*\p{Nd}/iu;

/**
 * The money in some words: each exact amount by its value, and each clause with money that is not, by its words.
 * currency: the business's own, for "$". A clause where a number is joined to an exact amount (JOINED) is kept by
 * its words too, so the joined number is never passed over.
 */function moneyIn(words: string, currency?: string): { key: string; text: string }[] {
  const keys: { key: string; text: string }[] = [];
  for (const clause of words.split(/(?<=(?<!\brs)[.!?;])\s+|\n+/iu)) {
    if (!clause.trim() || !statesMoney(clause, '')) continue;
    let rest = clause;
    let joined = false;
    for (const match of clause.matchAll(EXACT)) {
      keys.push({ key: `${currencyOf((match[1] ?? match[4])!, currency)}:${minorOf((match[2] ?? match[3])!)}`, text: match[0].trim() });
      rest = rest.replace(match[0], ' ');
      if (JOINED.test(clause.slice(match.index! + match[0].length))) joined = true;
    }
    if (statesMoney(rest, '') || joined) keys.push({ key: `words:${foldedWords(clause).toLowerCase()}`, text: foldedWords(clause) });
  }
  return keys;
}
const keysOf = (words: string, currency?: string) => new Set(moneyIn(words, currency).map(item => item.key));

/** The receipts this run's figures may come from: the venture's price receipts and this run's own work receipts. */
function runReceipts(state: State, run: DeliveryRunRecord): AnyReceipt[] {
  const work = listRecords(state, 'venture-work-receipt', run.ventureId).filter(row => row.runRef.kind === 'delivery' && row.runRef.runId === run.id);
  return [...ventureReceipts(state, run.ventureId), ...work] as AnyReceipt[];
}

/** What the run's receipts show: the figures the draft cited and the order's own price, as their displays. */
function receiptedDisplays(state: State, run: DeliveryRunRecord, receipts: readonly AnyReceipt[]): string[] {
  const cited = new Set<string>();
  const order = findRecord(state, 'venture-order', run.orderId);
  if (order?.priceReceiptId) cited.add(order.priceReceiptId);
  for (const section of run.deliverable?.sections ?? []) for (const part of section.parts) if (part.kind === 'figure') cited.add(part.receiptId);
  return receipts.filter(receipt => cited.has(receipt.id)).flatMap(receipt => ((receipt.figures as readonly { display?: string }[] | undefined) ?? []).map(figure => figure.display ?? ''));
}

/** The words the agent wrote itself (never its figure parts), a line each. */
function agentWordsOf(run: DeliveryRunRecord): string {
  const words = (run.deliverable?.sections ?? []).flatMap(section => section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : [])));
  return [run.deliverable?.title ?? '', ...words, ...(run.deliverable?.questionsForClient ?? [])].join('\n');
}

/**
 * The amounts check on an edit's words, under the money rule's id. receipted: what the run's receipts show; agentWords:
 * the agent's own words; clientWords: the client's message and the owner's idea. An amount a receipt or the client's
 * own words hold is theirs; one the agent wrote with no receipt and that survives in the edit fails; any other is the
 * editor's own words.
 */
export function editAmountsCheck(text: string, input: { receipted: readonly string[]; agentWords: string; clientWords: string; currency?: string }): CheckResult {
  const { currency } = input;
  const receipted = new Set(input.receipted.flatMap(display => [...keysOf(display, currency)]));
  const client = keysOf(input.clientWords, currency);
  const agent = keysOf(input.agentWords, currency);
  const found = moneyIn(text, currency);
  let own = 0, sourced = 0;
  for (const item of found) {
    if (receipted.has(item.key)) continue;
    if (client.has(item.key)) { sourced += 1; continue; }
    if (agent.has(item.key)) return { check: 'no-numeric-prose', passed: false, detail: `This keeps an amount the agent wrote with no receipt: "${item.text}". Change it or take it out.` };
    own += 1;
  }
  const detail = own ? OWN_WORDS_AMOUNT : sourced ? "Every amount comes from a receipt or the client's message." : found.length ? 'Every amount comes from a receipt.' : 'The words state no amount.';
  return { check: 'no-numeric-prose', passed: true, detail };
}

/** A3 review 3 (L1): the words for a number in an edit that no receipt holds. */
export const OWN_WORDS_NUMBER = 'This number is in your own words, not from a receipt.';

/**
 * A3 review 3 (L1): the receipts check's number comparison on an edit's own words: a count or figure a receipt of the run
 * contradicts fails; any other number with no receipt is the editor's own words. Money is the amounts check's.
 */
export function editNumbersCheck(text: string, input: { receipts: readonly AnyReceipt[]; ventureId: string; clientWords: string }): CheckResult {
  const numbers = summaryReceipts(text, { receipts: input.receipts, ventureId: input.ventureId, clientRequest: input.clientWords }).numbers.filter(item => !item.amount);
  const refuted = numbers.find(item => item.status === 'refuted');
  if (refuted) return { check: 'receipts', passed: false, detail: `This number does not match its receipt: "${refuted.text}". Change it or take it out.` };
  if (numbers.some(item => item.status === 'estimate')) return { check: 'receipts', passed: true, detail: OWN_WORDS_NUMBER };
  return { check: 'receipts', passed: true, detail: numbers.length ? 'Every number matches its receipt.' : 'The words state no number.' };
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
  const clientWords = [order?.request ?? '', venture?.idea ?? ''].join('\n');
  return [
    ...results,
    editAmountsCheck(text, { receipted: receiptedDisplays(state, run, receipts), agentWords: agentWordsOf(run), clientWords, ...(venture?.country?.currency ? { currency: venture.country.currency } : {}) }),
    // A3 review 3 (L1): the numbers in the edit, against the run's receipts, as the receipts check compares them.
    editNumbersCheck(text, { receipts, ventureId: run.ventureId, clientWords }),
  ];
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
