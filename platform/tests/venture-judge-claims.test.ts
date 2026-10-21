// Claim check tests: figures, dates, names and certifications in a draft are matched against the run's source files
// and evidence with no model. A specific claim the sources do not hold fails the draft. Figures that code renders
// from receipts are not model words, so they are not claims to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, HarnessState } from '../runtime/venture/contracts.ts';
import { DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { checkClaims, deliverableWords, extractClaims, sourcesFromFiles, sourcesFromRun } from '../runtime/venture/delivery/judge/claim-check.ts';

const claims = (text: string, options = {}) => extractClaims(text, options).map(claim => [claim.kind, claim.text, claim.key]);

test('claims: certifications are found with or without the word certified, and keyed the same way', () => {
  assert.deepEqual(claims('We are ISO 27001 certified and SOC 2 Type II.'), [
    ['certification', 'ISO 27001 certified', 'iso 27001'],
    ['certification', 'SOC 2 Type II', 'soc 2 type ii'],
  ]);
  assert.deepEqual(claims('Our team is Google certified.'), [['certification', 'Google certified', 'certif|google']]);
  assert.deepEqual(claims('An award-winning studio.'), [['certification', 'award-winning', 'award|']]);
  assert.deepEqual(claims('We follow GDPR and PCI DSS rules.'), [['certification', 'GDPR', 'gdpr'], ['certification', 'PCI DSS', 'pci dss']]);
});

test('claims: dates in several shapes become one key; a date without a year keeps only month and day', () => {
  assert.deepEqual(claims('Due on 12 March 2026, or by 2026-03-31.'), [['date', '12 March 2026', '2026-03-12'], ['date', '2026-03-31', '2026-03-31']]);
  assert.deepEqual(claims('Paid on 05/09/2026.'), [['date', '05/09/2026', '2026-09-05']]);
  assert.deepEqual(claims('Paid on 05/09/2026.', { dateOrder: 'month-day-year' }), [['date', '05/09/2026', '2026-05-09']]);
  assert.deepEqual(claims('Your March 2026 books.'), [['date', 'March 2026', '2026-03']]);
  assert.deepEqual(claims('We start on April 3rd.'), [['date', 'April 3rd', '--04-03']]);
  assert.deepEqual(claims('Ready by 3 April.'), [['date', '3 April', '--04-03']]);
});

test('claims: figures are keyed by value, so separators, currency signs and lakh or k words do not matter', () => {
  assert.deepEqual(claims('A fee of ₹1,20,000 or 1.2 lakh.'), [['figure', '₹1,20,000', '120000'], ['figure', '1.2 lakh', '120000']]);
  assert.deepEqual(claims('GST at 18% on $4.50 and 50k views since 2019.'), [
    ['figure', '18%', '18%'], ['figure', '$4.50', '4.5'], ['figure', '50k', '50000'], ['figure', '2019', '2019'],
  ]);
  assert.deepEqual(claims('Your Q3 B2B plan for t1.2 is ready.'), [], 'short names with letters are not figures');
  assert.deepEqual(claims('1. Summary\n2) Next steps'), [], 'list numbers are not figures');
});

test('claims: names are runs of capitalised words, not sentence openers, greetings, titles or months', () => {
  assert.deepEqual(claims('Dear Priya Sharma, we matched each bill from Sharma Traders and Mehta.'), [
    ['name', 'Priya Sharma', 'priya sharma'], ['name', 'Sharma Traders', 'sharma traders'], ['name', 'Mehta', 'mehta'],
  ]);
  assert.deepEqual(claims('Thanks for your message. Please send the file. We will reply on Monday.'), []);
  assert.deepEqual(claims('Thanks Priya, and Mr Sharma too.'), [['name', 'Priya', 'priya'], ['name', 'Sharma', 'sharma']]);
  assert.deepEqual(claims('Your GST and TDS working.'), [], 'a lone acronym is a term, not a name');
  assert.deepEqual(claims('We reviewed HDFC Bank statements.'), [['name', 'HDFC Bank', 'hdfc bank']]);
  assert.deepEqual(claims('Bright Books will send Sharma Traders the reply.', { known: ['Bright Books'] }), [['name', 'Sharma Traders', 'sharma traders']], 'known names are never claims');
});

test('claims: every specific claim must be found in a source; one unmatched claim fails the draft and is named', () => {
  const sources = [
    { id: 'client-message', text: 'Hi, this is Priya from SHARMA TRADERS PVT LTD. Please close my March books.' },
    { id: 'f1', text: 'Date,Narration,Amount\n12/03/2026,Rent,"1,20,000.00"\n2026-03-05,GST 18,4.50' },
    { id: 'f2', text: 'Certified Google Partner. ISO 27001:2022 certificate attached.' },
  ];
  const good = checkClaims('Priya, your March 2026 books for Sharma Traders show rent of ₹1.2 lakh paid on 12 March 2026, GST at 18%. We are Google certified and ISO 27001 certified.', sources);
  assert.equal(good.passed, true, JSON.stringify(good.unmatched));
  assert.ok(good.claims.length >= 7);
  assert.ok(good.claims.every(claim => claim.matched && claim.sourceId));
  assert.equal(good.claims.find(claim => claim.kind === 'certification' && claim.key === 'iso 27001')?.sourceId, 'f2');
  assert.match(good.detail, /matches/);

  const bad = checkClaims('We are SOC 2 certified, award-winning, and Mehta Exports paid ₹2,50,000 on 14 March 2026.', sources);
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.unmatched.map(claim => claim.text), ['SOC 2 certified', 'award-winning', 'Mehta Exports', '₹2,50,000', '14 March 2026'], 'in the order the draft says them');
  assert.match(bad.detail, /SOC 2 certified/);

  const none = checkClaims('Thanks for your message. We will look at the files and reply.', sources);
  assert.equal(none.passed, true);
  assert.deepEqual(none.claims, []);
  assert.match(none.detail, /no specific claim/);
});

test('claims: a draft reply is checked on its model words only; code-rendered receipt figures are not claims', () => {
  const draft: Deliverable = {
    title: 'Your March books',
    sections: [
      { heading: 'Summary', parts: [{ kind: 'text', text: 'We read your statement from Sharma Traders.' }, { kind: 'figure', receiptId: 'work_1', figureKey: 'total' }] },
      { heading: 'Next steps', parts: [{ kind: 'text', text: 'Send the April file.' }] },
    ],
    questionsForClient: ['Is the 4 April payment rent?'],
  };
  const words = deliverableWords(draft);
  assert.match(words, /Sharma Traders/);
  assert.match(words, /4 April payment/);
  assert.doesNotMatch(words, /work_1|Summary|Next steps/);
});

test('claims: a run gives sources from the client message, successful tool results and receipts', () => {
  const state: HarnessState = {
    ...newHarnessState(['files.read'], DEFAULT_LIMITS, []),
    toolCalls: [
      { id: 't1.1', turn: 1, tool: 'files.read', input: null, inputDigest: '', envelope: { ok: true, result: { rows: [{ cells: { Narration: 'SHARMA TRADERS', Amount: '1200.00' } }] } }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] },
      { id: 't1.2', turn: 1, tool: 'files.read', input: null, inputDigest: '', envelope: { ok: false, error: { code: 'X', name: 'X', message: 'Mehta Exports' } }, outcome: 'failed', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] },
    ],
  };
  const sources = sourcesFromRun({
    clientRequest: 'Close my books.', harness: state,
    receipts: [{ id: 'work_1', explanation: 'Money out: INR 1,200.00.', figures: [{ label: 'Money out', display: 'INR 1,200.00' }] }],
  });
  assert.deepEqual(sources.map(source => source.id), ['client-message', 't1.1', 'work_1']);
  assert.equal(checkClaims('Sharma Traders was paid 1200.', sources).passed, true);
  assert.equal(checkClaims('Mehta Exports was paid.', sources).passed, false, 'a failed tool call is not a source');
});

test('claims: the client\'s spreadsheet files can be sources whole, even rows the agent never read', () => {
  const files = practiceFiles({ id: 'bookkeeping-clean', serviceType: 'bookkeeping', source: 'template' });
  const sources = sourcesFromFiles(files);
  assert.equal(sources.length, files.filter(file => file.format !== 'pdf').length);
  assert.ok(sources.every(source => source.text.split('\n').length > 2));
  const firstRow = sources[0].text.split('\n')[2];
  const amount = firstRow.split(',').find(cell => /^\d[\d,]*\.\d{2}$/.test(cell));
  assert.ok(amount, firstRow);
  assert.equal(checkClaims(`The first payment was ${amount}.`, sources).passed, true);
  assert.equal(checkClaims('The first payment was 98765.43.', sources).passed, false);
});
