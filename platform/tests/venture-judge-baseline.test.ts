// Baseline tests: each playbook commits a file of held-back cases and the pass rate they reached. The check suite
// runs every case through the code checks (claims against sources, must and must-not mentions, house style) and
// fails when the pass rate drops below the committed baseline. No model: drafts come from a function or the
// cases' reference drafts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadBaseline, raiseBaseline, runBaselineSuite, scoreCase, validateBaseline, type BaselineFile, type HeldBackCase,
} from '../runtime/venture/delivery/judge/baseline.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const fixture = async (): Promise<BaselineFile> => validateBaseline(JSON.parse(await readFile(new URL('./fixtures/venture-judge-baseline.json', import.meta.url), 'utf8')));

test('baseline: the file is checked; the baseline must count the cases it holds', async () => {
  const file = await fixture();
  assert.equal(file.playbook, 'fixture-books');
  assert.equal(file.cases.length, 4);
  const broken = (change: (copy: any) => void) => { const copy = structuredClone(file) as any; change(copy); return () => validateBaseline(copy); };
  assert.throws(broken(copy => { copy.baseline.of = 5; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.baseline.passed = 5; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.baseline.passed = 1.5; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.cases[1].id = copy.cases[0].id; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.playbook = 'Fixture Books'; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.version = 2; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { delete copy.cases[0].reference; }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(broken(copy => { copy.cases = []; copy.baseline = { passed: 0, of: 0 }; }), code('INVALID_VENTURE_REQUEST'));
});

test('baseline: a case passes only when every code check passes, and each failure is named', async () => {
  const [clean, , , weak] = (await fixture()).cases;
  assert.deepEqual(scoreCase(clean, clean.reference), { id: 'clean-month', passed: true, failures: [] });
  const bad = scoreCase(weak, weak.reference);
  assert.equal(bad.passed, false);
  assert.match(bad.failures[0], /ISO 9001 certified/);
  const longDash = String.fromCharCode(0x2014);
  const many = scoreCase(clean, `We filed your return ${longDash} Mehta Exports was paid ₹99,000.`);
  assert.equal(many.passed, false);
  assert.ok(many.failures.some(line => /never mentions "September"/.test(line)), many.failures.join(' | '));
  assert.ok(many.failures.some(line => /mentions "filed"/.test(line)));
  assert.ok(many.failures.some(line => /Mehta Exports/.test(line)));
  assert.ok(many.failures.some(line => /long dash/.test(line)));
});

test('baseline: the suite passes at the baseline and fails when the pass rate drops below it', async () => {
  const file = await fixture();
  const atBaseline = await runBaselineSuite(file);
  assert.deepEqual([atBaseline.passed, atBaseline.of, atBaseline.ok], [3, 4, true]);
  assert.deepEqual(atBaseline.cases.map(item => item.passed), [true, true, true, false]);
  assert.match(atBaseline.detail, /3 of 4/);

  const regressed = await runBaselineSuite(file, (item: HeldBackCase) => item.id === 'gst-rate' ? 'Your printing invoices carry GST at 12%.' : item.reference);
  assert.deepEqual([regressed.passed, regressed.ok], [2, false]);
  assert.match(regressed.detail, /dropped/);

  const failing = await runBaselineSuite(file, async item => { if (item.id === 'clean-month') throw new Error('The model was not reachable.'); return item.reference; });
  assert.equal(failing.ok, false);
  assert.match(failing.cases[0].failures[0], /No draft: The model was not reachable\./);

  const better = await runBaselineSuite(file, item => item.id === 'weak-reference' ? 'Yes, Bright Books can take on your books from next month.' : item.reference);
  assert.deepEqual([better.passed, better.ok], [4, true]);
  const raised = raiseBaseline(file, better, '2026-10-22');
  assert.deepEqual(raised.baseline, { passed: 4, of: 4 });
  assert.equal(raised.recordedAt, '2026-10-22');
  assert.equal(raiseBaseline(file, regressed, '2026-10-22'), file, 'a baseline only ever rises');
});

test('baseline: each committed playbook baseline loads and its reference drafts meet it', async () => {
  const books = await loadBaseline('bookkeeping');
  assert.equal(books.playbook, 'bookkeeping');
  assert.ok(books.cases.length >= 4);
  const result = await runBaselineSuite(books);
  assert.equal(result.ok, true, JSON.stringify(result.cases.filter(item => !item.passed)));
  await assert.rejects(() => loadBaseline('../secrets'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(() => loadBaseline('no-such-playbook'), code('PLAYBOOK_NOT_FOUND'));
});
