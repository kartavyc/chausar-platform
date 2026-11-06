// CFO question and figure-label ideas from cfo (MIT); original checks, never model arithmetic.
import type { KitCheck } from '../kit/define.ts';
import { tablesOfFile } from '../../delivery/harness/files.ts';
import { decimalMinor } from '../../../currency.ts';
import { validateLedger } from './checkup.ts';

/** Route an owner's finance question through named typed steps. */
export function questionRoute(question: string): string[] {
  if (/\b(hire|hiring|afford)\b/i.test(question)) return ['business-case', 'costs', 'cash', 'scenarios', 'memo'];
  if (/cash.*(fall|drop)|why.*cash/i.test(question)) return ['cash-flow', 'working-capital', 'ageing', 'payables'];
  return ['cash-flow', 'scenarios', 'memo'];
}

/** Four labels are allowed; unreceipted prose figures require a label on their own sentence. */
export function financeFindings(words: string): string[] {
  const findings: string[] = [];
  if (/\b(?:invest\s+in|buy\s+(?:shares|stocks|bonds|mutual funds)|recommend\s+(?:shares|stocks|bonds|investing)|portfolio allocation)\b|(?:निवेश करें|शेयर खरीदें|म्यूचुअल फंड खरीदें)/iu.test(words)) findings.push('spending-only');
  if (/\b(?:send|email|contact|message)\b[^.!?]*\b(?:directly to (?:the )?debtor|debtor directly)\b/i.test(words)) findings.push('no-debtor-contact');
  if (words.split(/(?<=[.!?])\s+|\n/).some(line => /\p{N}|₹|\b(?:INR|rupees)\b/iu.test(line) && !/\b(?:reported|calculated|assumption|model estimate)\b|(?:दर्ज|गणना|धारणा|मॉडल अनुमान)/iu.test(line))) findings.push('figure-labelled');
  return findings;
}

/** Deterministic checks on the actual draft text; receipt parts already carry their calculator proof. */
export const bookkeepingChecks: KitCheck = input => {
  const words = [input.deliverable.title, ...input.deliverable.sections.flatMap(section => [section.heading, ...section.parts.flatMap(part => part.kind === 'text' ? [part.text] : [])]), ...input.deliverable.questionsForClient].join('\n');
  const bad = financeFindings(words);
  for (const file of input.files) {
    if (file.format !== 'csv' && file.format !== 'xlsx') continue;
    try {
      const required = ['id', 'payee', 'on', 'amount', 'direction'];
      for (const table of tablesOfFile(file)) {
        if (!required.every(name => table.columns.includes(name))) continue;
        const rows = table.rows.map(row => { const value = (name: string) => row.cells[name] ?? ''; return { id: value('id'), payee: value('payee'), on: value('on'), amountMinor: decimalMinor(value('amount'), 'INR'), direction: value('direction') as 'in' | 'out' }; });
        if (validateLedger(rows).length) bad.push('ledger-valid');
      }
    } catch { bad.push('ledger-valid'); }
  }
  return ['no-debtor-contact', 'spending-only', 'figure-labelled', 'ledger-valid'].map(check => ({ playbook: 'bookkeeping-cfo', check, outcome: bad.includes(check) ? 'fail' : 'pass', detail: bad.includes(check) ? 'This draft needs the client-only reminder path, spending-only scope and a label beside each figure.' : 'The draft stays within its finance boundary.' }));
};
