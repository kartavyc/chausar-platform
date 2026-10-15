/**
 * A report page as a file Tally can import (TallyPrime XML, the same envelope and amount form as the
 * write-back Tally adapter). Only a page of balances, where every line carries Dr or Cr, can go: each
 * known figure becomes one Memorandum voucher, which Tally keeps out of the books, dated the last day of
 * the period, between a ledger named for the line and the counter ledger "Chausar report figures", both
 * under Suspense A/c. Both entries carry the same exact amount from the line's receipt: nothing is added
 * up, and the receipt id is in the narration. A figure that is not known is left out of the file and said
 * in a note at its top and in the reply, never written as zero.
 */
import { check } from '../contracts.ts';
import { xmlEscape } from '../writeback/systems/tally.ts';
import { rupees, type Missing } from './common.ts';
import type { PageSpec } from './packs.ts';
import type { ReportPage } from './pages.ts';

export const TALLY_COUNTER_LEDGER = 'Chausar report figures';
export const TALLY_PARENT_GROUP = 'Suspense A/c';
export type TallyLeftOut = { section: string; line: string; missing: Missing | 'not-money' };
export type TallyFile = { xml: string; vouchers: number; leftOut: TallyLeftOut[] };

/** A page Tally can take: fixed lines only (no months, no projection, not a connector page), each with Dr or Cr. */
export function tallyExportable(page: PageSpec): boolean {
  return !page.connector && page.sections.length > 0
    && page.sections.every(section => !section.monthly && !section.forecast && (section.lines ?? []).length > 0 && (section.lines ?? []).every(line => line.side !== undefined));
}
export function requireTallyPage(page: PageSpec): void {
  check(tallyExportable(page), 'TALLY_PAGE_EXPORT_NOT_AVAILABLE', 'Only a page of balances with Dr and Cr can go to Tally. Export this page to Excel or CSV instead.');
}

const missingWords: Record<TallyLeftOut['missing'], string> = {
  'absent': 'nothing is imported for it', 'null': 'it has no value', 'unknown': 'it is not known', 'withheld': 'it is withheld from your seat',
  'not-applicable': 'it does not apply', 'not-loaded-yet': 'it is not loaded yet', 'not-counted': 'it is not counted', 'not-money': 'it is not an amount',
};
/** A comment cannot hold "--" or end with "-". */
const comment = (text: string) => `<!-- ${text.replace(/-{2,}/g, '-').replace(/-$/, '- ')} -->`;
const ledgerName = (label: string) => `Chausar: ${label}`;
const day = (date: string) => date.replaceAll('-', '');

/** One entry: a debit is a negative AMOUNT with ISDEEMEDPOSITIVE Yes, a credit a positive AMOUNT with ISDEEMEDPOSITIVE No. */
function entry(ledger: string, side: 'Dr' | 'Cr', paise: string): string {
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${side === 'Dr' ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${side === 'Dr' && /[1-9]/.test(paise) ? '-' : ''}${rupees(paise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

/** The page as a Tally import file. Every amount is the exact paise of a figure on the page, written as rupees by string formatting. */
export function tallyXml(page: ReportPage): TallyFile {
  check(page.period !== null, 'TALLY_PAGE_EXPORT_NOT_AVAILABLE', 'A page without a period cannot go to Tally.');
  const date = day(page.period.to), vouchers: string[] = [], ledgers = new Set<string>(), leftOut: TallyLeftOut[] = [], notes: string[] = [];
  for (const section of page.sections) {
    for (const line of section.lines) {
      const figure = line.figure;
      if (figure.kind !== 'money' || !line.side) {
        leftOut.push({ section: section.title, line: line.label, missing: figure.kind === 'missing' ? figure.missing : 'not-money' });
        continue;
      }
      // A negative balance on one side is the same balance on the other: the sign moves to the side, the digits are unchanged.
      const negative = figure.exact.startsWith('-'), paise = negative ? figure.exact.slice(1) : figure.exact;
      const side: 'Dr' | 'Cr' = negative ? (line.side === 'Dr' ? 'Cr' : 'Dr') : line.side, other: 'Dr' | 'Cr' = side === 'Dr' ? 'Cr' : 'Dr';
      const ledger = ledgerName(line.label); ledgers.add(ledger);
      // A figure's labels (stale, approximate, seed, from outside...) travel with it, so Tally shows them too.
      const labels = figure.labels.length ? ` Marked: ${figure.labels.join(', ')}.` : '';
      const narration = `${page.title}, ${section.title}: ${line.label}. Receipt ${figure.receiptId}.${labels}`;
      const remoteId = `chausar-report-${page.pack}-${page.page}-${section.id}-${line.id}-${figure.receiptId}`;
      vouchers.push(`<VOUCHER REMOTEID="${xmlEscape(remoteId)}" VCHTYPE="Memorandum" ACTION="Create"><DATE>${date}</DATE><VOUCHERTYPENAME>Memorandum</VOUCHERTYPENAME>`
        + `<NARRATION>${xmlEscape(narration)}</NARRATION>${entry(ledger, side, paise)}${entry(TALLY_COUNTER_LEDGER, other, paise)}</VOUCHER>`);
    }
    for (const gap of section.gaps) notes.push(`Gap in ${section.title}: ${gap}`);
  }
  check(vouchers.length > 0, 'TALLY_PAGE_NO_FIGURES', 'No amount on this page is known yet, so there is nothing for Tally to import.');
  const masters = [TALLY_COUNTER_LEDGER, ...[...ledgers].sort()].map(name =>
    `<LEDGER NAME="${xmlEscape(name)}" ACTION="Create"><NAME.LIST><NAME>${xmlEscape(name)}</NAME></NAME.LIST><PARENT>${xmlEscape(TALLY_PARENT_GROUP)}</PARENT></LEDGER>`).join('');
  const head = [
    `${page.title}, ${page.period.from} to ${page.period.to}. Memorandum vouchers: they stay out of the books in Tally.`,
    `Page state: ${page.state}.`,
    ...leftOut.map(item => `Left out, not zero: ${item.section}: ${item.line}, because ${missingWords[item.missing]}.`),
    ...notes,
    ...(page.disclaimer ? [page.disclaimer] : []),
    `Check code ${page.footer.checkCode ?? 'not available'}${page.footer.at ? `, ${page.footer.at}` : ''}.`,
  ].map(comment).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${head}\n<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>`
    + `<BODY><DESC><STATICVARIABLES></STATICVARIABLES></DESC><DATA><TALLYMESSAGE>${masters}</TALLYMESSAGE><TALLYMESSAGE>${vouchers.join('')}</TALLYMESSAGE></DATA></BODY></ENVELOPE>\n`;
  return { xml, vouchers: vouchers.length, leftOut };
}
