// The second reviewer (Ink v2 wave 4, package 4J15, catalogue Q17). Two reviewers' findings merge by key, keeping the
// higher severity and naming both; disagreements are recorded; findings and observations stay apart; a lens (a rule
// file with triggers) stands down on an item a code check already covered. The second review is an extra check: it
// can only make a verdict stricter, never looser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lensesFor, mergeReviews, stricterVerdict, type Lens, type Review } from '../runtime/venture/delivery/second-review.ts';

const first: Review = { reviewer: 'Rules judge', items: [
  { key: 'figure:total', type: 'finding', severity: 'medium', title: 'The total has no receipt', detail: 'The September total is typed.' },
  { key: 'tone', type: 'observation', severity: 'low', title: 'A little formal', detail: 'Could be warmer.' },
  { key: 'promise:date', type: 'finding', severity: 'high', title: 'Promises a date', detail: 'Says Friday.' },
] };
const second: Review = { reviewer: 'Second reviewer', items: [
  { key: 'figure:total', type: 'finding', severity: 'high', title: 'Total not worked out', detail: 'No calculator receipt backs it.' },
  { key: 'tone', type: 'finding', severity: 'medium', title: 'Too formal for a cafe', detail: 'Reads like a bank.' },
  { key: 'greeting', type: 'observation', severity: 'low', title: 'No greeting', detail: 'Starts cold.' },
] };

test('merge: by key, the higher severity kept and both reviewers named; one reviewer\'s own items kept with its name', () => {
  const merged = mergeReviews(first, second);
  const total = merged.findings.find(item => item.key === 'figure:total')!;
  assert.equal(total.severity, 'high');
  assert.deepEqual(total.by, ['Rules judge', 'Second reviewer']);
  assert.equal(total.title, 'Total not worked out', 'the words of the reviewer with the higher severity');
  assert.deepEqual(merged.findings.find(item => item.key === 'promise:date')!.by, ['Rules judge']);
  assert.deepEqual(merged.findings.map(item => item.key), ['figure:total', 'promise:date', 'tone'], 'highest severity first, then by key');
});

test('merge: disagreements are recorded, on severity and on finding or observation', () => {
  const merged = mergeReviews(first, second);
  assert.deepEqual(merged.disagreements, [
    { key: 'figure:total', about: 'severity', first: 'medium', second: 'high', kept: 'high' },
    { key: 'tone', about: 'type', first: 'observation', second: 'finding', kept: 'finding' },
  ]);
});

test('merge: a finding on one side and an observation on the other keeps the higher of the two severities', () => {
  const merged = mergeReviews(
    { reviewer: 'A', items: [{ key: 'tax', type: 'finding', severity: 'low', title: 'Tax line', detail: 'Check the rate.' }] },
    { reviewer: 'B', items: [{ key: 'tax', type: 'observation', severity: 'critical', title: 'Tax rate', detail: 'The rate looks wrong.' }] },
  );
  const [tax] = merged.findings;
  assert.deepEqual([tax.type, tax.severity, tax.by], ['finding', 'critical', ['A', 'B']]);
  assert.deepEqual(merged.disagreements, [{ key: 'tax', about: 'type', first: 'finding', second: 'observation', kept: 'finding' }]);
  assert.equal(stricterVerdict('pass', merged).outcome, 'fail');
});

test('merge: findings and observations stay apart; an item one reviewer called a finding is a finding and is not also an observation', () => {
  const merged = mergeReviews(first, second);
  assert.deepEqual(merged.observations.map(item => item.key), ['greeting']);
  assert.ok(merged.findings.every(item => item.type === 'finding'));
  assert.ok(merged.observations.every(item => item.type === 'observation'));
  assert.ok(!merged.observations.some(item => merged.findings.some(finding => finding.key === item.key)));
});

test('lenses: a lens is triggered by its words; it stands down on an item a code check already covered', () => {
  const lenses: Lens[] = [
    { id: 'money-lens', triggers: [/\bINR\b/, /\btotal\b/i] },
    { id: 'promise-lens', triggers: [/\bby (?:monday|tuesday|wednesday|thursday|friday)\b/i] },
  ];
  assert.deepEqual(lensesFor(lenses, 'The total comes to INR 12,400.00.').map(lens => lens.id), ['money-lens']);
  const lensReview: Review = { reviewer: 'Money lens', lens: 'money-lens', items: [
    { key: 'figure:total', type: 'finding', severity: 'critical', title: 'Total may be wrong', detail: 'Check it.' },
    { key: 'figure:tax', type: 'finding', severity: 'medium', title: 'Tax line unclear', detail: 'Which rate?' },
  ] };
  const merged = mergeReviews(first, lensReview, { codeCovered: ['figure:total'] });
  assert.deepEqual(merged.stoodDown, [{ lens: 'money-lens', key: 'figure:total', line: 'A code check already covered figure:total, so the money-lens lens stood down.' }]);
  assert.equal(merged.findings.find(item => item.key === 'figure:total')!.severity, 'medium', 'the lens did not raise what code covered');
  assert.deepEqual(merged.findings.find(item => item.key === 'figure:tax')!.by, ['Money lens']);
  // A reviewer that is not a lens never stands down: code covering an item does not silence a second reviewer.
  assert.equal(mergeReviews(first, second, { codeCovered: ['figure:total'] }).findings.find(item => item.key === 'figure:total')!.severity, 'high');
});

test('stricter only: the second review can turn a pass into unverified or fail, and never loosens a verdict', () => {
  const merged = mergeReviews(first, second);
  assert.equal(stricterVerdict('pass', merged).outcome, 'fail', 'a high finding fails');
  assert.match(stricterVerdict('pass', merged).line, /Promises a date/);
  const mediumOnly = mergeReviews({ reviewer: 'A', items: [{ key: 'x', type: 'finding', severity: 'medium', title: 'Unclear', detail: '' }] }, { reviewer: 'B', items: [] });
  assert.equal(stricterVerdict('pass', mediumOnly).outcome, 'unverified');
  const lowOnly = mergeReviews({ reviewer: 'A', items: [{ key: 'x', type: 'finding', severity: 'low', title: 'Nit', detail: '' }] }, { reviewer: 'B', items: [] });
  assert.equal(stricterVerdict('pass', lowOnly).outcome, 'pass');
  const nothing = mergeReviews({ reviewer: 'A', items: [] }, { reviewer: 'B', items: [{ key: 'y', type: 'observation', severity: 'critical', title: 'Note', detail: '' }] });
  assert.equal(stricterVerdict('pass', nothing).outcome, 'pass', 'an observation never changes a verdict');
  for (const primary of ['fail', 'unverified'] as const) assert.equal(stricterVerdict(primary, nothing).outcome, primary, `${primary} stays ${primary}`);
  assert.equal(stricterVerdict('fail', mediumOnly).outcome, 'fail');
});

test('merge refuses what it cannot read: an unknown severity or type, a key twice from one reviewer, the same reviewer twice', () => {
  const bad = (items: unknown[]) => mergeReviews({ reviewer: 'A', items: items as Review['items'] }, { reviewer: 'B', items: [] });
  const code = (error: any) => error.code === 'INVALID_VENTURE_REQUEST';
  assert.throws(() => bad([{ key: 'x', type: 'finding', severity: 'huge', title: 't', detail: '' }]), code);
  assert.throws(() => bad([{ key: 'x', type: 'opinion', severity: 'low', title: 't', detail: '' }]), code);
  assert.throws(() => bad([{ key: 'x', type: 'finding', severity: 'low', title: 't', detail: '' }, { key: 'x', type: 'finding', severity: 'high', title: 't', detail: '' }]), code);
  assert.throws(() => mergeReviews({ reviewer: 'A', items: [] }, { reviewer: 'A', items: [] }), code);
});
