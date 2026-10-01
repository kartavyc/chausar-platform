import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeConversationSynthesis, validateConversationSynthesis } from '../runtime/conversation-synthesis.ts';
import type { GroundedSynthesisOutput, GroundedToolSummary, SynthesisPart } from '../runtime/conversation-synthesis-contract.ts';

// Authored model-output fixtures. This suite only checks the pure codec's
// currency/unit boundary; citations do not establish general prose entailment.
const invalid = (error: unknown) => error instanceof Error && 'code' in error
  && error.code === 'INVALID_CONVERSATION_SYNTHESIS';

function money(currency = 'INR'): GroundedToolSummary {
  return { schemaVersion: 1, question: 'How much was billed?',
    results: [{ ref: 'r1', tool: 'calculator.calculate', status: 'ok', evidenceRefs: ['e1'] }],
    evidence: [{ kind: 'figure', ref: 'e1', resultRef: 'r1', label: 'Billed total', unit: 'money', currency }],
    citationRefs: [] };
}
function margin(): GroundedToolSummary {
  const summary = money();
  summary.evidence[0] = { kind: 'figure', ref: 'e1', resultRef: 'r1', label: 'Gross margin', unit: 'basis-points' };
  return summary;
}
function output(...parts: SynthesisPart[]): GroundedSynthesisOutput {
  return { schemaVersion: 1, paragraphs: [{ parts: [...parts, { kind: 'slot', ref: 'e1' }, { kind: 'text', text: '.' }],
    evidenceRefs: ['e1'] }], cautionRefs: [] };
}

for (const [label, prose] of [
  ['conflicting CAD code', 'The billed total in CAD is '],
  ['conflicting CHF code', 'The billed total in CHF is '],
  ['other recognized currency code', 'The billed total in AUD is '],
  ['lowercase currency code', 'The billed total in cad is '],
  ['mixed-case currency code', 'The billed total in cHf is '],
  ['fullwidth currency code', 'The billed total in \uFF23\uFF21\uFF24 is '],
  ['currency code with ignorable Unicode', 'The billed total in C\u200bAD is '],
  ['currency name absent from the original fixed list', 'The billed total in Swiss francs is '],
  ['minor money measure', 'The billed total in cents is '],
  ['local minor money measure', 'The billed total in paise is '],
] as const) {
  test(`synthesis requires a local slot for ${label}`, () => {
    assert.throws(() => validateConversationSynthesis(output({ kind: 'text', text: prose }), money()), invalid);
  });
}

test('synthesis cannot split a conflicting currency assertion between adjacent prose parts', () => {
  assert.throws(() => validateConversationSynthesis(output(
    { kind: 'text', text: 'The billed total in C' }, { kind: 'text', text: 'AD is ' }), money()), invalid);
});

test('an admitted nonstandard currency code must still remain in the local figure slot', () => {
  const summary = money('ZZZ');
  assert.throws(() => validateConversationSynthesis(output({ kind: 'text', text: 'The billed total in ZZZ is ' }), summary), invalid);
});

for (const prose of [
  'The reviewed margin in basis points is ',
  'The reviewed margin in bps is ',
  'The reviewed margin in bp is ',
  'The reviewed margin in percentage points is ',
] as const) {
  test(`synthesis cannot override the local margin measure with prose: ${prose.trim()}`, () => {
    assert.throws(() => validateConversationSynthesis(output({ kind: 'text', text: prose }), margin()), invalid);
  });
}

test('synthesis cannot split a margin measure between adjacent prose parts', () => {
  assert.throws(() => validateConversationSynthesis(output(
    { kind: 'text', text: 'The reviewed margin in ba' }, { kind: 'text', text: 'sis points is ' }), margin()), invalid);
});

for (const [currency, exactDisplay] of [
  ['CAD', 'CAD 938,475.61'],
  ['CHF', 'CHF 938,475.61'],
  ['ZZZ', 'ZZZ 938,475.61'],
] as const) {
  test(`natural prose preserves the current exact ${currency} display through its local slot`, () => {
    const summary = money(currency), authored = output({ kind: 'text', text: 'The reviewed billed total is ' });
    const reads: string[] = [];
    const rendered = materializeConversationSynthesis(authored, summary, ref => { reads.push(ref); return exactDisplay; });
    assert.equal(rendered.text, `The reviewed billed total is ${exactDisplay}.`);
    assert.deepEqual(reads, ['e1']);
  });
}

test('natural prose preserves the current exact margin display through its local slot', () => {
  const rendered = materializeConversationSynthesis(output({ kind: 'text', text: 'The reviewed margin is ' }), margin(), () => '17.35%');
  assert.equal(rendered.text, 'The reviewed margin is 17.35%.');
});

test('unrelated ordinary acronyms in grounded business prose are not treated as currency codes', () => {
  const claim = 'The NGO uses an API to maintain its published product catalogue.';
  const summary: GroundedToolSummary = { schemaVersion: 1, question: 'Introduce the organization.',
    results: [{ ref: 'r1', tool: 'business.describe', status: 'ok', evidenceRefs: ['e1'] }],
    evidence: [{ kind: 'claim', ref: 'e1', resultRef: 'r1', text: claim, origin: 'source-observation',
      qualification: 'evidence-qualified', citationRefs: ['c1'] }], citationRefs: ['c1'] };
  const authored = output({ kind: 'text', text: 'Here is the reviewed NGO profile and API context: ' });
  assert.equal(materializeConversationSynthesis(authored, summary, () => claim).text,
    `Here is the reviewed NGO profile and API context: ${claim}.`);
});

for (const prose of [
  'All permitted records support this result: ',
  'Try reviewing the admitted result: ',
  'Ron\'s reviewed billed result is ',
  'The rub with this result is ',
] as const) {
  test(`ordinary prose with an ambiguous currency word remains valid: ${prose.trim()}`, () => {
    assert.equal(materializeConversationSynthesis(output({ kind: 'text', text: prose }), money(), () => 'INR 938,475.61').text,
      `${prose}INR 938,475.61.`);
  });
}

for (const prose of [
  'The billed total in ALL is ',
  'The billed total in TRY is ',
  'The currency is all: ',
  'The billed total is denominated in try: ',
  'The currency code is all: ',
  'The billing currency was try: ',
] as const) {
  test(`an ambiguous word asserting a currency still requires a local slot: ${prose.trim()}`, () => {
    assert.throws(() => validateConversationSynthesis(output({ kind: 'text', text: prose }), money()), invalid);
  });
}

test('grounded CRM, ERP and VAT business prose is not blocked as arbitrary uppercase currency text', () => {
  const claim = 'The organization maintains CRM and ERP records for VAT reporting.';
  const summary: GroundedToolSummary = { schemaVersion: 1, question: 'Describe the reporting context.',
    results: [{ ref: 'r1', tool: 'business.describe', status: 'ok', evidenceRefs: ['e1'] }],
    evidence: [{ kind: 'claim', ref: 'e1', resultRef: 'r1', text: claim, origin: 'source-observation',
      qualification: 'evidence-qualified', citationRefs: ['c1'] }], citationRefs: ['c1'] };
  const authored = output({ kind: 'text', text: 'Here is the reviewed CRM, ERP and VAT context: ' });
  assert.equal(materializeConversationSynthesis(authored, summary, () => claim).text,
    `Here is the reviewed CRM, ERP and VAT context: ${claim}.`);
});
