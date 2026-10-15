import test from 'node:test';
import assert from 'node:assert/strict';
import { tallyExportable, tallyXml } from '../runtime/reports-ext/tally.ts';
import { packs } from '../runtime/reports-ext/packs.ts';
import type { ReportPage } from '../runtime/reports-ext/pages.ts';

// A synthetic page of balances: one Dr line, one Cr line that came out negative, one withheld line and one line not counted.
const page: ReportPage = {
  pack: 'investor', page: 'receivables', title: 'Receivables & dues', language: 'en', period: { from: '2026-04-01', to: '2026-09-30' }, generatedAt: '2026-10-14T06:00:00.000Z', state: 'ready-untested',
  sections: [{ id: 'receivables', title: 'On the last day', projection: false, gaps: ['One import is not reconciled -- check it.'], lines: [
    { id: 'outstanding', label: 'Receivables <outstanding>', side: 'Dr', figure: { kind: 'money', exact: '123456789012345', receiptId: 'receipt_a', labels: [] } },
    { id: 'unallocated', label: 'Unallocated', side: 'Cr', figure: { kind: 'money', exact: '-5', receiptId: 'receipt_b', labels: [] } },
    { id: 'over-90', label: 'Overdue more than 90 days', side: 'Dr', figure: { kind: 'missing', missing: 'withheld' } },
    { id: 'old', label: 'Old dues', side: 'Dr', figure: { kind: 'missing', missing: 'not-counted' } },
  ] }],
  notes: [], disclaimer: null, gaps: [], markings: [], footer: { checkCode: 'abc123', at: '2026-10-14T05:00:00.000Z' }, receiptIds: ['receipt_a', 'receipt_b'],
};

test('the Tally file is exact: amounts by string from paise, a negative balance on the other side, missing lines left out in a note', () => {
  const file = tallyXml(page);
  assert.equal(file.vouchers, 2);
  assert.deepEqual(file.leftOut, [
    { section: 'On the last day', line: 'Overdue more than 90 days', missing: 'withheld' },
    { section: 'On the last day', line: 'Old dues', missing: 'not-counted' },
  ]);
  const ledger = (name: string) => `<LEDGER NAME="${name}" ACTION="Create"><NAME.LIST><NAME>${name}</NAME></NAME.LIST><PARENT>Suspense A/c</PARENT></LEDGER>`;
  const entry = (name: string, dr: boolean, amount: string) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISDEEMEDPOSITIVE>${dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  assert.equal(file.xml, '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!-- Receivables & dues, 2026-04-01 to 2026-09-30. Memorandum vouchers: they stay out of the books in Tally. -->\n'
    + '<!-- Page state: ready-untested. -->\n'
    + '<!-- Left out, not zero: On the last day: Overdue more than 90 days, because it is withheld from your seat. -->\n'
    + '<!-- Left out, not zero: On the last day: Old dues, because it is not counted. -->\n'
    + '<!-- Gap in On the last day: One import is not reconciled - check it. -->\n'
    + '<!-- Check code abc123, 2026-10-14T05:00:00.000Z. -->\n'
    + '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES></STATICVARIABLES></DESC><DATA>'
    + `<TALLYMESSAGE>${ledger('Chausar report figures')}${ledger('Chausar: Receivables &lt;outstanding&gt;')}${ledger('Chausar: Unallocated')}</TALLYMESSAGE><TALLYMESSAGE>`
    + '<VOUCHER REMOTEID="chausar-report-investor-receivables-receivables-outstanding-receipt_a" VCHTYPE="Memorandum" ACTION="Create"><DATE>20260930</DATE><VOUCHERTYPENAME>Memorandum</VOUCHERTYPENAME>'
    + '<NARRATION>Receivables &amp; dues, On the last day: Receivables &lt;outstanding&gt;. Receipt receipt_a.</NARRATION>'
    + `${entry('Chausar: Receivables &lt;outstanding&gt;', true, '-1234567890123.45')}${entry('Chausar report figures', false, '1234567890123.45')}</VOUCHER>`
    + '<VOUCHER REMOTEID="chausar-report-investor-receivables-receivables-unallocated-receipt_b" VCHTYPE="Memorandum" ACTION="Create"><DATE>20260930</DATE><VOUCHERTYPENAME>Memorandum</VOUCHERTYPENAME>'
    + '<NARRATION>Receivables &amp; dues, On the last day: Unallocated. Receipt receipt_b.</NARRATION>'
    + `${entry('Chausar: Unallocated', true, '-0.05')}${entry('Chausar report figures', false, '0.05')}</VOUCHER>`
    + '</TALLYMESSAGE></DATA></BODY></ENVELOPE>\n');
});

test('only fixed pages of Dr and Cr balances can go to Tally; a page with nothing known refuses', () => {
  const exportable = packs.flatMap(pack => pack.pages.filter(tallyExportable).map(p => `${pack.id}.${p.id}`));
  assert.deepEqual(exportable, ['lender.receivables-ageing', 'ca.ageing', 'investor.receivables']);
  const empty: ReportPage = { ...page, sections: [{ ...page.sections[0]!, lines: page.sections[0]!.lines.slice(2) }] };
  assert.throws(() => tallyXml(empty), (error: any) => error.code === 'TALLY_PAGE_NO_FIGURES');
});

test('the labels of a figure travel into its Tally narration', () => {
  const stale: ReportPage = { ...page, sections: [{ ...page.sections[0], lines: [{ ...page.sections[0].lines[0], figure: { kind: 'money', exact: '100', receiptId: 'receipt_s', labels: ['stale', 'seed'] } }] }] };
  assert.match(tallyXml(stale).xml, /<NARRATION>[^<]*Receipt receipt_s\. Marked: stale, seed\.<\/NARRATION>/);
});
