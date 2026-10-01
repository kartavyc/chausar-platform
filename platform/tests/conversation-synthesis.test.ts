import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError } from '../runtime/contracts.ts';
import {
  CONVERSATION_SYNTHESIS_INSTRUCTIONS, conversationSynthesisSchema, materializeConversationSynthesis,
  prepareConversationSynthesis, validateConversationSynthesis,
} from '../runtime/conversation-synthesis.ts';
import type { GroundedToolSummary, GroundedSynthesisOutput, SynthesisCurrentTextResolver } from '../runtime/conversation-synthesis-contract.ts';

// Authored synthetic model output only. Transport, separate consent, persistence
// and current authority are integration responsibilities. This pure codec suite
// has no network, provider, credentials, receipt lookup or calculator invocation.
const EXACT_MINOR = '938475610293867561';
const EXACT_MONEY = 'INR 9,384,756,102,938,675.61';
const EXACT_PERCENT = '17.35%';
const EXACT_PERIOD = 'September 2026';
const EXACT_COUNT = '42 admitted invoices';
const BUSINESS_CLAIM = 'Synthetic Lantern sells reusable packaging to independent retailers.';
const INTRODUCTION = `Here is the introduction from your reviewed sources: ${BUSINESS_CLAIM}`;
const invalid = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_CONVERSATION_SYNTHESIS';

function business(): GroundedToolSummary {
  return { schemaVersion: 1, question: 'Please introduce my business in plain language.',
    results: [{ ref: 'r1', tool: 'business.describe', status: 'ok', evidenceRefs: ['e1'] }],
    evidence: [{ kind: 'claim', ref: 'e1', resultRef: 'r1',
      text: BUSINESS_CLAIM,
      origin: 'source-observation', qualification: 'evidence-qualified', citationRefs: ['c1'] }], citationRefs: ['c1'] };
}
function financial(): GroundedToolSummary {
  return { schemaVersion: 1, question: 'How much was billed in the reviewed period?',
    results: [{ ref: 'r1', tool: 'calculator.calculate', status: 'ok', evidenceRefs: ['e1', 'e2'] }],
    evidence: [{ kind: 'figure', ref: 'e1', resultRef: 'r1', label: 'Billed total', unit: 'money', currency: 'INR' },
      { kind: 'scope', ref: 'e2', resultRef: 'r1', label: 'Reviewed billing period' }], citationRefs: [] };
}
function qualified(): GroundedToolSummary {
  const summary = business(); summary.results[0].status = 'partial'; summary.results[0].evidenceRefs.push('e2', 'e3', 'e4');
  summary.evidence.push(
    { kind: 'caution', ref: 'e2', resultRef: 'r1', code: 'COVERAGE_INCOMPLETE', label: 'Reviewed coverage is incomplete', required: true },
    { kind: 'caution', ref: 'e3', resultRef: 'r1', code: 'UNKNOWN_CUSTOMER_CONCENTRATION', label: 'Customer concentration remains unknown', required: true },
    { kind: 'caution', ref: 'e4', resultRef: 'r1', code: 'SYNTHETIC_FIXTURE', label: 'This is synthetic fixture evidence', required: true },
  );
  return summary;
}
const introOutput = (): GroundedSynthesisOutput => ({ schemaVersion: 1, paragraphs: [{ parts: [
  { kind: 'text', text: 'Here is the introduction from your reviewed sources: ' }, { kind: 'slot', ref: 'e1' },
], evidenceRefs: ['e1'] }], cautionRefs: [] });
const moneyOutput = (): GroundedSynthesisOutput => ({ schemaVersion: 1, paragraphs: [{ parts: [
  { kind: 'text', text: 'The billed total is ' }, { kind: 'slot', ref: 'e1' },
  { kind: 'text', text: ' for ' }, { kind: 'slot', ref: 'e2' }, { kind: 'text', text: '.' },
], evidenceRefs: ['e1', 'e2'] }], cautionRefs: [] });

function localResolver(values: Record<string, string>) {
  const reads: string[] = [];
  const resolve: SynthesisCurrentTextResolver = ref => {
    reads.push(ref);
    if (!Object.hasOwn(values, ref)) throw new ChausarError('SYNTHESIS_AUTHORITY_CHANGED', 'The current local evidence is no longer available.');
    return values[ref];
  };
  return { resolve, reads };
}

test('synthesis prepares the exact original objective and claim disclosure without invoking a provider', () => {
  const summary = business(); summary.question = 'What do you understand about my company, and how would you introduce it?';
  const prepared = prepareConversationSynthesis(summary), disclosed = JSON.parse(prepared.input);
  assert.equal(disclosed.question, summary.question); assert.deepEqual(disclosed, summary);
  assert.equal(prepared.instructions, CONVERSATION_SYNTHESIS_INSTRUCTIONS);
  assert.deepEqual(prepared.schema, conversationSynthesisSchema(summary));
  assert.equal(typeof prepared.payloadDigest, 'string'); assert.match(prepared.payloadDigest, /^[a-f0-9]{64}$/);
  assert.match(prepared.payload, /Synthetic Lantern sells reusable packaging/);
  assert.match(prepared.instructions, /caution/i); assert.match(prepared.instructions, /slot/i);
});

test('synthesis accepts natural provider framing with an admitted claim slot and local citation closure', () => {
  const summary = business(), output = introOutput();
  const admitted = validateConversationSynthesis(output, summary);
  assert.deepEqual(admitted, output); admitted.paragraphs[0].parts[0] = { kind: 'text', text: 'A changed detached copy.' };
  assert.deepEqual(output, introOutput());
  const resolver = localResolver({ e1: BUSINESS_CLAIM });
  const rendered = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.equal(rendered.text, INTRODUCTION);
  assert.deepEqual(rendered.paragraphs[0].citationRefs, ['c1']);
  assert.deepEqual(rendered.paragraphs[0].evidenceRefs, ['e1']);
  assert.deepEqual(resolver.reads, ['e1']);
});

test('synthesis preserves the Engine financial display above the safe integer range through a local slot', () => {
  const summary = financial(), prepared = prepareConversationSynthesis(summary);
  assert.equal(prepared.payload.includes(EXACT_MINOR), false); assert.equal(prepared.payload.includes(EXACT_MONEY), false);
  assert.equal(prepared.payload.includes(EXACT_PERIOD), false);
  const resolver = localResolver({ e1: EXACT_MONEY, e2: EXACT_PERIOD });
  const rendered = materializeConversationSynthesis(moneyOutput(), summary, resolver.resolve);
  assert.equal(rendered.text, `The billed total is ${EXACT_MONEY} for ${EXACT_PERIOD}.`);
  assert.deepEqual(resolver.reads, ['e1', 'e2']);
  assert.deepEqual(rendered.paragraphs[0].citationRefs, []);
});

test('synthesis uses current local slots for percentage and count values without model arithmetic', () => {
  const summary = financial();
  summary.evidence[0] = { kind: 'figure', ref: 'e1', resultRef: 'r1', label: 'Gross margin', unit: 'basis-points' };
  summary.evidence[1] = { kind: 'scope', ref: 'e2', resultRef: 'r1', label: 'Admitted invoice count' };
  const output: GroundedSynthesisOutput = { schemaVersion: 1, paragraphs: [{ parts: [
    { kind: 'text', text: 'The reviewed margin is ' }, { kind: 'slot', ref: 'e1' },
    { kind: 'text', text: ', based on ' }, { kind: 'slot', ref: 'e2' }, { kind: 'text', text: '.' },
  ], evidenceRefs: ['e1', 'e2'] }], cautionRefs: [] };
  const resolver = localResolver({ e1: EXACT_PERCENT, e2: EXACT_COUNT });
  assert.equal(materializeConversationSynthesis(output, summary, resolver.resolve).text,
    `The reviewed margin is ${EXACT_PERCENT}, based on ${EXACT_COUNT}.`);
});

test('synthesis combines ordered business and calculation results while retaining grounded citation aliases', () => {
  const summary = business();
  summary.results.push({ ref: 'r2', tool: 'calculator.calculate', status: 'ok', evidenceRefs: ['e2'] });
  summary.evidence.push({ kind: 'figure', ref: 'e2', resultRef: 'r2', label: 'Billed total', unit: 'money', currency: 'INR' });
  const output: GroundedSynthesisOutput = { schemaVersion: 1, paragraphs: [...introOutput().paragraphs,
    { parts: [{ kind: 'text', text: 'The billed total is ' }, { kind: 'slot', ref: 'e2' }, { kind: 'text', text: '.' }], evidenceRefs: ['e2'] }], cautionRefs: [] };
  const resolver = localResolver({ e1: BUSINESS_CLAIM, e2: EXACT_MONEY }), rendered = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.equal(rendered.text, `${INTRODUCTION}\n\nThe billed total is ${EXACT_MONEY}.`);
  assert.deepEqual(rendered.paragraphs.map(paragraph => paragraph.citationRefs), [['c1'], []]);
});

test('synthesis retains partial coverage, unknown and synthetic cautions for independent canonical host rendering', () => {
  const summary = qualified(), output = introOutput(); output.cautionRefs = ['e2', 'e3', 'e4'];
  const resolver = localResolver({ e1: BUSINESS_CLAIM,
    e2: 'The reviewed profile covers the main branch only.',
    e3: 'Customer concentration is not established by the reviewed sources.',
    e4: 'This answer uses synthetic fixture evidence.' });
  const rendered = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.deepEqual(rendered.cautionRefs, ['e2', 'e3', 'e4']); assert.deepEqual(resolver.reads, ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(rendered.cautions, [
    { ref: 'e2', text: 'The reviewed profile covers the main branch only.' },
    { ref: 'e3', text: 'Customer concentration is not established by the reviewed sources.' },
    { ref: 'e4', text: 'This answer uses synthetic fixture evidence.' },
  ]);
  assert.equal(rendered.text, INTRODUCTION);
  const omitted = structuredClone(output); omitted.cautionRefs.pop();
  assert.throws(() => validateConversationSynthesis(omitted, summary), invalid);
  const repeated = structuredClone(output); repeated.cautionRefs.push('e4');
  assert.throws(() => validateConversationSynthesis(repeated, summary), invalid);
});

test('synthesis admits unavailable-only results without fabricating figures, retaining their reviewed generic error caution', () => {
  const summary: GroundedToolSummary = { schemaVersion: 1, question: 'How much was billed?',
    results: [{ ref: 'r1', tool: 'calculator.calculate', status: 'unavailable', evidenceRefs: ['e1'] }],
    evidence: [{ kind: 'caution', ref: 'e1', resultRef: 'r1', code: 'TOOL_UNAVAILABLE', label: 'The requested calculation is unavailable', required: true }], citationRefs: [] };
  const output: GroundedSynthesisOutput = { schemaVersion: 1, paragraphs: [{ parts: [
    { kind: 'text', text: 'I could not establish the requested billed result from the admitted tool response.' },
  ], evidenceRefs: ['e1'] }], cautionRefs: ['e1'] };
  const resolver = localResolver({ e1: 'The billed result is unavailable because the published definition is missing.' });
  const rendered = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.match(rendered.text, /could not establish/); assert.deepEqual(rendered.cautionRefs, ['e1']); assert.deepEqual(resolver.reads, ['e1']);
  assert.deepEqual(rendered.cautions, [{ ref: 'e1', text: 'The billed result is unavailable because the published definition is missing.' }]);
  output.paragraphs[0].parts.push({ kind: 'slot', ref: 'e1' });
  assert.throws(() => validateConversationSynthesis(output, summary), invalid);
});

test('synthesis retains unknown and conflict warnings alongside grounded prose', () => {
  const summary = qualified();
  summary.evidence[3] = { kind: 'caution', ref: 'e4', resultRef: 'r1', code: 'CONFLICT_UNRESOLVED', label: 'Sources disagree about the primary sales channel', required: true };
  const output = introOutput(); output.cautionRefs = ['e2', 'e3', 'e4'];
  assert.deepEqual(validateConversationSynthesis(output, summary).cautionRefs, ['e2', 'e3', 'e4']);
  const substituted = structuredClone(output); substituted.cautionRefs[2] = 'e1';
  assert.throws(() => validateConversationSynthesis(substituted, summary), invalid);
});

test('synthesis resolves exact claim wording from the current host instead of provider supplied source text', () => {
  const summary = business(), output = introOutput(); output.paragraphs[0].parts = [{ kind: 'slot', ref: 'e1' }];
  const resolver = localResolver({ e1: BUSINESS_CLAIM });
  const rendered = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.equal(rendered.text, BUSINESS_CLAIM);
  assert.deepEqual(resolver.reads, ['e1']); assert.deepEqual(rendered.paragraphs[0].citationRefs, ['c1']);
});

test('synthesis rejects a missing or foreign citation alias in the admitted summary', () => {
  const missing = business(); missing.citationRefs = [];
  assert.throws(() => prepareConversationSynthesis(missing), invalid);
  const foreign = business(); if (foreign.evidence[0].kind === 'claim') foreign.evidence[0].citationRefs.push('foreign_citation');
  assert.throws(() => validateConversationSynthesis(introOutput(), foreign), invalid);
});

for (const [label, prose] of [
  ['money', 'The billed total is INR 9384756102938675.61.'],
  ['percentage', 'The margin is 17.35%.'],
  ['date', 'This covers September 2026.'],
  ['count', 'There are 42 invoices.'],
  ['number word', 'The total is ten million.'],
  ['Unicode digits', 'There are ４２ invoices.'],
  ['Arabic digits', 'There are ٤٢ invoices.'],
  ['fraction', 'The share is half.'],
  ['currency symbol', 'The total is ₹ available.'],
  ['external URL', 'See https://example.test/result for details.'],
  ['Markdown link', 'Read [the report](https://example.test/report).'],
  ['HTML', '<strong>The billed result is available.</strong>'],
] as const) {
  test(`synthesis rejects free-prose ${label} instead of admitting an unsupported exact assertion`, () => {
    const output = introOutput(); output.paragraphs[0].parts = [{ kind: 'text', text: prose }];
    assert.throws(() => validateConversationSynthesis(output, business()), invalid);
  });
}

for (const [label, revise] of [
  ['foreign evidence', (output: GroundedSynthesisOutput) => { output.paragraphs[0].evidenceRefs = ['foreign_evidence']; }],
  ['missing evidence', (output: GroundedSynthesisOutput) => { output.paragraphs[0].evidenceRefs = []; }],
  ['duplicate evidence', (output: GroundedSynthesisOutput) => { output.paragraphs[0].evidenceRefs.push('e1'); }],
  ['empty paragraph', (output: GroundedSynthesisOutput) => { output.paragraphs[0].parts = []; }],
  ['empty answer', (output: GroundedSynthesisOutput) => { output.paragraphs = []; }],
  ['foreign slot', (output: GroundedSynthesisOutput) => { output.paragraphs[0].parts = [{ kind: 'slot', ref: 'foreign_evidence' }]; }],
] as const) {
  test(`synthesis rejects ${label}`, () => {
    const output = introOutput(); revise(output);
    assert.throws(() => validateConversationSynthesis(output, business()), invalid);
  });
}

test('synthesis does not borrow a slot citation from another paragraph or omit a successful tool result', () => {
  const summary = business();
  summary.results.push({ ref: 'r2', tool: 'calculator.calculate', status: 'ok', evidenceRefs: ['e2'] });
  summary.evidence.push({ kind: 'figure', ref: 'e2', resultRef: 'r2', label: 'Billed total', unit: 'money', currency: 'INR' });
  assert.throws(() => validateConversationSynthesis(introOutput(), summary), invalid);
  const split: GroundedSynthesisOutput = { schemaVersion: 1, paragraphs: [
    { parts: [{ kind: 'slot', ref: 'e2' }], evidenceRefs: ['e1'] },
    { parts: [{ kind: 'text', text: 'The reviewed billed result is available.' }], evidenceRefs: ['e2'] },
  ], cautionRefs: [] };
  assert.throws(() => validateConversationSynthesis(split, summary), invalid);
});

test('synthesis rejects generic prose that cites a useful result without rendering any admitted content', () => {
  const output = introOutput();
  output.paragraphs[0].parts = [{ kind: 'text', text: 'The business context is available.' }];
  assert.throws(() => validateConversationSynthesis(output, business()), invalid);
});

test('synthesis cannot replace an admitted business claim with only its scope and generic prose', () => {
  const summary = business(); summary.results[0].evidenceRefs.push('e2');
  summary.evidence.push({ kind: 'scope', ref: 'e2', resultRef: 'r1', label: 'Reviewed business scope' });
  const output: GroundedSynthesisOutput = { schemaVersion: 1, paragraphs: [{ parts: [
    { kind: 'text', text: 'The reviewed business scope is ' }, { kind: 'slot', ref: 'e2' }, { kind: 'text', text: '.' },
  ], evidenceRefs: ['e2'] }], cautionRefs: [] };
  assert.throws(() => validateConversationSynthesis(output, summary), invalid);
});

test('synthesis admits a full valid profile with its local source-attribution prefix', () => {
  const summary = business(), profile = 'x'.repeat(1200), attributed = `Owner-stated profile claim: ${profile}`;
  assert.equal(attributed.length, 1228);
  if (summary.evidence[0].kind === 'claim') {
    summary.evidence[0].text = attributed; summary.evidence[0].origin = 'owner-told'; summary.evidence[0].qualification = 'owner-stated';
  }
  const prepared = prepareConversationSynthesis(summary);
  assert.equal(JSON.parse(prepared.input).evidence[0].text, attributed);
  const resolver = localResolver({ e1: attributed });
  assert.equal(materializeConversationSynthesis(introOutput(), summary, resolver.resolve).text,
    `Here is the introduction from your reviewed sources: ${attributed}`);
});

test('synthesis rejects numerical and locator assertions split across adjacent prose parts', () => {
  for (const parts of [
    [{ kind: 'text', text: 'The total is t' }, { kind: 'text', text: 'en million. ' }, { kind: 'slot', ref: 'e1' }],
    [{ kind: 'text', text: 'Read htt' }, { kind: 'text', text: 'ps://example.test/report. ' }, { kind: 'slot', ref: 'e1' }],
  ] as const) {
    const output = introOutput(); output.paragraphs[0].parts = structuredClone([...parts]);
    assert.throws(() => validateConversationSynthesis(output, business()), invalid);
  }
  for (const prose of ['The total is t\u200Den million. ', 'The count is t\u200Bwo. ']) {
    const output = introOutput(); output.paragraphs[0].parts.unshift({ kind: 'text', text: prose });
    assert.throws(() => validateConversationSynthesis(output, business()), invalid);
  }
});

test('synthesis preserves owner-stated and draft claim qualification through exact current claim slots', () => {
  for (const [origin, qualification, currentText] of [
    ['owner-told', 'owner-stated', 'The owner says the business plans to open another branch.'],
    ['draft-assumption', 'draft', 'A draft assumes the business may open another branch.'],
  ] as const) {
    const summary = business();
    if (summary.evidence[0].kind === 'claim') {
      summary.evidence[0].origin = origin; summary.evidence[0].qualification = qualification; summary.evidence[0].text = currentText;
    }
    const output = introOutput(), resolver = localResolver({ e1: currentText });
    assert.equal(materializeConversationSynthesis(output, summary, resolver.resolve).text,
      `Here is the introduction from your reviewed sources: ${currentText}`);
    if (summary.evidence[0].kind === 'claim') summary.evidence[0].qualification = 'evidence-qualified';
    assert.throws(() => prepareConversationSynthesis(summary), invalid);
  }
});

test('synthesis rejects source bindings, actions, provider fields and undeclared slot fields from model output', () => {
  const summary = business();
  for (const field of ['actions', 'toolCalls', 'receiptId', 'memberId', 'providerPayload', 'rawRows']) {
    const output = { ...introOutput(), [field]: 'synthetic undeclared field' };
    assert.throws(() => validateConversationSynthesis(output, summary), invalid);
  }
  const slot = introOutput();
  slot.paragraphs[0].parts = [{ kind: 'slot', ref: 'e1', renderText: 'An invented local value.' } as unknown as GroundedSynthesisOutput['paragraphs'][number]['parts'][number]];
  assert.throws(() => validateConversationSynthesis(slot, summary), invalid);
});

test('synthesis validates bounded plain JSON before using output references', () => {
  const summary = business(), oversized = introOutput(); oversized.paragraphs[0].parts = [{ kind: 'text', text: 'a'.repeat(70000) }];
  assert.throws(() => validateConversationSynthesis(oversized, summary), invalid);
  assert.throws(() => validateConversationSynthesis(Object.assign(Object.create({ foreign: true }), introOutput()), summary), invalid);
  assert.throws(() => validateConversationSynthesis({ ...introOutput(), foreign: new Date() }, summary), invalid);
  const nested: Record<string, unknown> = {}; let cursor = nested;
  for (let index = 0; index < 40; index++) { cursor.child = {}; cursor = cursor.child as Record<string, unknown>; }
  assert.throws(() => validateConversationSynthesis({ ...introOutput(), foreign: nested }, summary), invalid);
});

test('synthesis rejects tampered result membership and duplicate opaque aliases before preparation', () => {
  const foreign = financial(); foreign.evidence[0].resultRef = 'foreign_result';
  assert.throws(() => prepareConversationSynthesis(foreign), invalid);
  const duplicate = financial(); duplicate.evidence[1].ref = 'e1';
  assert.throws(() => prepareConversationSynthesis(duplicate), invalid);
  const missing = financial(); missing.results[0].evidenceRefs = ['e1'];
  assert.throws(() => prepareConversationSynthesis(missing), invalid);
});

test('synthesis withholds the materialized answer when the installed current local resolver revokes its evidence', () => {
  const summary = financial(), output = moneyOutput();
  let reads = 0;
  const revoked: SynthesisCurrentTextResolver = () => { reads++; throw new ChausarError('SOURCE_REVOKED', 'The reviewed source is no longer readable.'); };
  assert.throws(() => materializeConversationSynthesis(output, summary, revoked), error => error instanceof ChausarError && error.code === 'SOURCE_REVOKED');
  assert.equal(reads, 1);
  const missing = localResolver({ e1: EXACT_MONEY });
  assert.throws(() => materializeConversationSynthesis(output, summary, missing.resolve), error => error instanceof ChausarError && error.code === 'SYNTHESIS_AUTHORITY_CHANGED');
});

test('synthesis uses current host text for every materialization without cached arithmetic or provider fallback', () => {
  const summary = financial(), output = moneyOutput(), resolver = localResolver({ e1: EXACT_MONEY, e2: EXACT_PERIOD });
  const first = materializeConversationSynthesis(output, summary, resolver.resolve);
  const second = materializeConversationSynthesis(output, summary, resolver.resolve);
  assert.deepEqual(second, first); assert.deepEqual(resolver.reads, ['e1', 'e2', 'e1', 'e2']);
  const changed = localResolver({ e1: 'INR 1.00', e2: 'October 2026' });
  assert.equal(materializeConversationSynthesis(output, summary, changed.resolve).text, 'The billed total is INR 1.00 for October 2026.');
});
