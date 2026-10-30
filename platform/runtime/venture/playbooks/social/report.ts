// Chausar flagship playbook, social media agency: the monthly report (design 7.6, 7.8). Every figure comes from the
// platform exports the client uploads, computed here in exact whole numbers (BigInt), each with a receipt naming the
// file, its digest, the rows and the columns it used. A model never computes a report figure; the narrative may only
// cite figures a receipt holds (checkReportNarrative). Unknown is never zero: an empty or broken cell stops the figure
// that needs it and says which row, while the other figures still compute.
//
// The column names follow the exports as recorded in the rules register (export-meta-content, export-linkedin-updates),
// which are not yet confirmed against a live export: a file of another shape is refused, never guessed at.
//
// Idea taken, code written here: xjli360/sealeap-ecommerce-skills (MIT): exact arithmetic, every input named, and
// "unknown is not zero".
import { createHash } from 'node:crypto';
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import { extractClaims } from '../../delivery/judge/claim-check.ts';

export * from './report-core.ts';
import {createReportComputer,type ReportReceipt} from './report-core.ts';
export const {groupDigits,parseExport,computePlatformReport,monthlyReport}=createReportComputer({text:text=>createHash('sha256').update(text).digest('hex'),value:digest,error:(code,message)=>new ChausarError(code,message)});

const NUMBER_WORD = '(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|crores?|millions?|billions?|dozens?)';
/**
 * Figures written another way than digits, which no receipt holds: a multiplier ("3x", "×2", "2 times" or a bare ×),
 * a number in words with any "per cent" or "times" after it ("forty per cent", "three times"), and words that state a
 * change ("doubled", "twice", "twofold").
 */
const WORD_FIGURES: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?:x|\s*×|\s+times)(?![\p{L}\p{N}])|×\s*\d+(?:[.,]\d+)?|×/giu,
  new RegExp(`(?<![\\p{L}\\p{N}])${NUMBER_WORD}(?:[\\s-]+(?:and[\\s-]+)?${NUMBER_WORD})*(?:\\s+(?:per\\s*cent|percent|times))?(?![\\p{L}\\p{N}])`, 'giu'),
  /(?<![\p{L}\p{N}])(?:doubled|doubles|doubling|double|tripled|triples|triple|quadrupled|halved|twice|thrice|(?:two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|many|multi)fold)(?![\p{L}\p{N}])/giu,
];

/** The figures a text writes in words or as multipliers, with where each starts; the spans are blanked in rest. */
function wordFigures(text: string): { found: { text: string; at: number }[]; rest: string } {
  let rest = text;
  const found: { text: string; at: number }[] = [];
  for (const pattern of WORD_FIGURES) {
    for (const match of rest.matchAll(pattern)) {
      found.push({ text: match[0].trim(), at: match.index! });
      rest = rest.slice(0, match.index!) + ' '.repeat(match[0].length) + rest.slice(match.index! + match[0].length);
    }
  }
  return { found, rest };
}

/**
 * The narrative may cite only figures a receipt holds. Every figure in the text is compared with the receipts'
 * displays (1,521 and 1521 are the same figure); the month's year is allowed. A figure written in words, as a
 * multiplier or as a change ("doubled") never matches a receipt, so it is always listed. Dates and names are left to
 * the judge.
 */
export function checkReportNarrative(text: string, receipts: readonly Pick<ReportReceipt, 'display' | 'value' | 'month'>[]): { passed: boolean; unmatched: string[]; line: string } {
  const allowed = new Set<string>();
  for (const item of receipts) {
    for (const claim of extractClaims(item.display)) if (claim.kind === 'figure') allowed.add(claim.key);
    allowed.add(item.value);
    allowed.add(item.month.slice(0, 4));
  }
  const words = wordFigures(text);
  const digits = extractClaims(words.rest).filter(claim => claim.kind === 'figure' && !allowed.has(claim.key)).map(claim => ({ text: claim.text.trim(), at: claim.at }));
  const unmatched = [...words.found, ...digits].sort((a, b) => a.at - b.at).map(item => item.text);
  const line = unmatched.length
    ? `These figures have no receipt: ${unmatched.map(item => `"${item}"`).join(', ')}. Report figures come from the client's exports, computed by code.`
    : 'Every figure in the narrative comes from a receipt.';
  return { passed: unmatched.length === 0, unmatched, line };
}

/** A run's work receipt as the narrative check reads it: only the fields it needs, so this file imports no record types. */
type WorkReceiptLike = { operation?: unknown; figures?: readonly { display: string; minor: string; unit: string }[]; report?: readonly { month: string }[] };

/**
 * The report figures a run's work receipts hold (operation 'social.report', made by the social.report tool), as
 * checkReportNarrative reads them: each figure's display, its exact value (a count's whole number, a rate without its
 * percent sign, a post's id) and its month. Price receipts and other work receipts hold none.
 */
export function reportFiguresOf(receipts: readonly unknown[]): Pick<ReportReceipt, 'display' | 'value' | 'month'>[] {
  return receipts.flatMap(receipt => {
    const work = receipt as WorkReceiptLike;
    if (!work || work.operation !== 'social.report' || !Array.isArray(work.figures)) return [];
    return work.figures.map((figure, index) => ({
      display: figure.display,
      value: figure.unit === 'percent' ? figure.display.replace(/%$/, '') : figure.unit === 'post' ? figure.display : figure.minor,
      month: work.report?.[index]?.month ?? '',
    }));
  });
}
