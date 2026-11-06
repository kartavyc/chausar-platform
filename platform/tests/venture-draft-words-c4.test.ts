// One-shot C4 task 16: client text holds no engine labels. A figure goes into a draft as words and its label stays in the
// receipt; the faithfulness check fails a model that copies a label; and the draft's view names the receipt of each
// amount, so the preview can mark it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, QueueItemView, QueueList } from '../runtime/venture/contracts.ts';
import { DELIVERY_INSTRUCTIONS, draftAmounts, renderDeliverable, reconciliationBlock } from '../runtime/venture/delivery/deliverable.ts';
import { REQUIRED_SECTIONS, figureWords, templateOutline, type TemplateServiceType } from '../runtime/venture/delivery/template-outline.ts';
import { runChecks, type CheckInput } from '../runtime/venture/delivery/checks.ts';
import { engineLabelIn } from '../runtime/venture/delivery/judge/engine-labels.ts';
import { figureLines } from '../runtime/venture/playbooks/document-desk/core.ts';
import { business, CA_IDEA, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { call, record, seedOrder, setup, startNativeDraft } from './venture-run-controls-env.ts';

const LABEL = /\bTotal:|\bPrice per \w+[^:\n]{0,30}:/;
const RECEIPT = { id: 'R-1', ventureId: 'v', operation: 'price', figures: [
  { key: 'unit', label: 'Price per month', display: 'INR 3,000.00', minor: '300000', currency: 'INR', unit: 'money' },
  { key: 'tax', label: 'GST at 18%', display: 'INR 540.00', minor: '54000', currency: 'INR', unit: 'money' },
  { key: 'total', label: 'Total', display: 'INR 3,540.00', minor: '354000', currency: 'INR', unit: 'money' },
] };
const COUNTRY = { dateOrder: 'day-month-year' } as never;

test('figureWords: a figure as words, the label left in the receipt', () => {
  assert.equal(figureWords('Total', 'INR 3,000.00'), 'INR 3,000.00 in total');
  assert.equal(figureWords('Price per month', 'INR 3,000.00'), 'INR 3,000.00 a month');
  assert.equal(figureWords('Price per hour', 'INR 500.00'), 'INR 500.00 an hour');
  assert.equal(figureWords('Price per project', 'INR 9,000.00'), 'INR 9,000.00 a project');
  assert.equal(figureWords('Price per month, GST included', 'INR 3,000.00'), 'INR 3,000.00 a month, GST included');
  // Every other figure keeps its label: a line of a report means nothing without it.
  assert.equal(figureWords('GST at 18%', 'INR 540.00'), 'GST at 18%: INR 540.00');
  assert.equal(figureWords('Money out matched to bills', 'INR 12.00'), 'Money out matched to bills: INR 12.00');
});

test('every service type\'s template draft has no engine label, and keeps the exact amount', () => {
  for (const type of Object.keys(REQUIRED_SECTIONS) as TemplateServiceType[]) {
    const text = renderDeliverable(templateOutline(type, { receiptId: 'R-1', figureKey: 'total' }) as Deliverable, [RECEIPT as never], COUNTRY);
    assert.doesNotMatch(text, LABEL, type);
    assert.match(text, /Here is the price for this work\. INR 3,540\.00 in total/, type);
  }
});

test('the engine renders a template in the form the UI\'s draft-text test holds it to', () => {
  const outline = templateOutline('other', { receiptId: 'R-1', figureKey: 'total' }) as Deliverable;
  const parts = outline.sections.map(section => `## ${section.heading}\n${section.parts.map(part => (part.kind === 'text' ? part.text : 'INR 3,540.00 in total')).join(' ')}`);
  const expected = [`# ${outline.title}`, ...parts, ['Questions for you:', ...outline.questionsForClient.map(question => `- ${question}`)].join('\n')].join('\n\n');
  assert.equal(renderDeliverable(outline, [RECEIPT as never], COUNTRY), expected);
});

test('the flagship playbooks\' template rehearsals pass with no engine label', async () => {
  for (const idea of [CA_IDEA, 'Run a YouTube channel that explains personal finance in plain words', 'A content calendar service for yoga studios in Goa', PLAIN_IDEA]) {
    const env = await business(idea);
    const run = await env.call('venture.simulation.run', { useTemplate: true });
    for (const episode of run.episodes) {
      assert.equal(episode.passed, true, `${idea}: ${episode.firstFailure}`);
      for (const turn of episode.turns ?? []) if (turn.by === 'agent') assert.doesNotMatch(turn.text ?? '', LABEL);
    }
  }
});

test('a document desk\'s exported figures hold no engine label; the desk itself keeps its own lines', () => {
  const figures = { currency: 'INR', receiptId: 'R-9', totalMinor: '83333', lines: [{ label: 'Printing', quantity: '2.5', unitMinor: '33333', lineMinor: '83333' }] } as never;
  const exported = figureLines(figures, 'exact');
  assert.equal(exported.at(-1), 'INR 833.33 in total');
  assert.equal(exported.some(line => /^Total:|^Receipt /.test(line)), false);
  assert.ok(figureLines(figures).some(line => line.startsWith('Total:')));
});

test('the drafting instructions say never to repeat a receipt\'s label or name the calculator', () => {
  assert.match(DELIVERY_INSTRUCTIONS, /Never repeat a receipt's label/);
  assert.match(DELIVERY_INSTRUCTIONS, /calculator/);
});

test('the reconciliation the client reads does not name the calculator or a receipt', () => {
  const receipt = { ...RECEIPT, reconciliation: { statementClosing: null, balanced: false, matched: [], unmatchedBank: [], unmatchedBills: [] }, figures: [...RECEIPT.figures, { key: 'matched-count', label: 'Matched', display: '0', unit: 'count' }] };
  const block = reconciliationBlock(receipt as never, COUNTRY);
  assert.doesNotMatch(block, /calculator/i);
  assert.doesNotMatch(block, /receipt/i);
});

test('engineLabelIn: an engine label fails; ordinary words a client reads pass', () => {
  for (const [text, found] of [
    ['Total: INR 3,000.00', 'Total:'],
    ['Your total: see below', 'total:'],
    ['Price per month: INR 3,000.00', 'Price per month:'],
    ['Price per month, GST included: INR 3,000.00', 'Price per month, GST included:'],
    ['Worked out by the calculator.', 'calculator'],
    ['Every amount comes from a receipt.', 'from a receipt'],
    ['See receipt R-0412 for the fee.', 'receipt R-0412'],
    ['This is on your price receipt.', 'price receipt'],
  ] as const) assert.equal(engineLabelIn(text, []), found, text);
  for (const text of [
    'Please send your bills and receipts for the month.',
    'We will total the bills and send you a short report.',
    'In total we will write three posts.',
    'The price per month is below.',
  ]) assert.equal(engineLabelIn(text, []), null, text);
  // The client's own words stand: an app that is a calculator, a request about receipts.
  assert.equal(engineLabelIn('We will test the calculator screen first.', ['Please test my calculator app']), null);
  assert.equal(engineLabelIn('We will test the calculator screen first.', ['Please test my budgeting app']), 'calculator');
});

const input = (words: string): CheckInput => ({
  checks: ['claims-grounded'], renderedText: words, serviceType: 'other', allowed: [], receipts: [], ventureId: 'v', mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 5, askedQuestions: true,
  deliverable: { title: 'A reply', sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: words }] }], questionsForClient: [] } as unknown as Deliverable,
});

test('a stand-in model draft that copies a label fails the faithfulness check, in plain words', () => {
  const [result] = runChecks(input('Total: INR 3,000.00'));
  assert.equal(result!.check, 'claims-grounded');
  assert.equal(result!.passed, false);
  assert.match(result!.detail, /Total:/);
  assert.match(result!.detail, /inside Chausar/);
  const [plain] = runChecks(input('We will send you a short report next.'));
  assert.equal(plain!.passed, true, plain!.detail);
});

test('a figure rendered from a receipt is never the model\'s label: the check reads the model\'s words only', () => {
  const deliverable = { title: 'A reply', questionsForClient: [], sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'The fee is below.' }, { kind: 'figure', receiptId: 'R-1', figureKey: 'tax' }] }] } as unknown as Deliverable;
  const [result] = runChecks({ ...input(''), deliverable, renderedText: renderDeliverable(deliverable, [RECEIPT as never], COUNTRY), receipts: [RECEIPT as never] });
  assert.equal(result!.passed, true, result!.detail);
});

test('draftAmounts: each amount with a receipt, one no receipt backs as a model estimate, none on the owner\'s own words', () => {
  const deliverable = { title: 'A reply', questionsForClient: [], sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'The fee is below.' }, { kind: 'figure', receiptId: 'R-1', figureKey: 'total' }] }] } as unknown as Deliverable;
  const text = renderDeliverable(deliverable, [RECEIPT as never], COUNTRY);
  assert.deepEqual(draftAmounts({ deliverable, text, ownWords: false }, [RECEIPT as never]), [{ display: 'INR 3,540.00', receiptId: 'R-1' }]);
  assert.deepEqual(draftAmounts({ deliverable, text: `${text}\nAlso INR 99.00 for extras.`, ownWords: false }, [RECEIPT as never]), [{ display: 'INR 3,540.00', receiptId: 'R-1' }, { display: 'INR 99.00', estimate: true }]);
  assert.deepEqual(draftAmounts({ deliverable, text: 'My own fee is INR 50.00.', ownWords: true }, [RECEIPT as never]), []);
  assert.deepEqual(draftAmounts({ deliverable, text: 'My own words, and INR 3,540.00 as it was.', ownWords: true }, [RECEIPT as never]), [{ display: 'INR 3,540.00', receiptId: 'R-1' }]);
});

test('the queue view of a draft names the receipt of each amount', async () => {
  const env = await setup();
  const order = await seedOrder(env);
  const part = (text: string) => ({ kind: 'text', text, ref: '' });
  const run = await startNativeDraft(env, { order, draft: () => ({
    title: 'Your September books', questionsForClient: [], sections: [
      { heading: 'Summary', parts: [part('Here is the plan for your September books.')] },
      { heading: 'What we will do', parts: [part('We will match each payment to a bill.')] },
      { heading: 'What we need from you', parts: [part('Please send the bank statement.')] },
      { heading: 'Next steps', parts: [part('The fee for the month is below.'), { kind: 'figure', text: '', ref: 'order.total' }] },
    ],
  }) });
  assert.doesNotMatch(record(env, run.id).renderedText!, LABEL);
  assert.ok((await call<{ passed: boolean }[]>(env, 'venture.delivery.list', {}).then(() => record(env, run.id).checks)).every(check => check.passed || check.notChecked), JSON.stringify(record(env, run.id).checks));
  const view = await call<QueueItemView>(env, 'venture.queue.view', { kind: 'draft', id: run.id });
  assert.equal(view.amounts?.length, 1);
  assert.ok(view.amounts![0]!.receiptId, 'the amount has its receipt');
  assert.ok(view.sections.flatMap(section => section.lines).some(line => line.includes(view.amounts![0]!.display)), 'the amount is in the draft\'s words');
  await call<QueueList>(env, 'venture.queue.list', {});
});
