import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { questionText } from '../runtime/reports-ext/questions.ts';

// Synthetic records only: two weeks of an invented business, the second week the same as the first.
const csv = `id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,description
sale-a,sale,2026-08-25,1000.00,INR,customer-a,invoice-a,,delivered,Delivered goods
sale-b,sale,2026-09-01,1000.00,INR,customer-a,invoice-b,,delivered,Delivered goods
payment-a,payment,2026-09-02,500.00,INR,customer-a,invoice-a,,settled,Settled receipt
`;
const recipe = {
  version: 1, id: 'synthetic-reports-language-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Language Co', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'status', 'description'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['sale', 'payment'], allowedStatuses: ['settled', 'delivered'], onUnmapped: 'reject',
};
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const devanagari = /[ऀ-ॿ]/;

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-reports-language-'));
  let now = Date.parse('2026-09-08T06:00:00.000Z');
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'reports-tools-trust': { clock: () => now } } });
  t.after(async () => {
    await engine.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-reports-language-')); await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic Language Co', passphrase: 'Synthetic language passphrase 2026', demo: false, pack: 'ecommerce' });
  await engine.request('sources.import', { sourceId: 'synthetic-language-source', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 3, amountMinor: '250000' } });
  return { engine, directory, at: (iso: string) => { now = Date.parse(iso); } };
}

test('packs, the week ahead, the Friday review, rhythm previews and due dates are written in Hindi when asked, English by default', async t => {
  const { engine } = await fixture(t);
  const en = await engine.request('reportsx.packs', {}), hi = await engine.request('reportsx.packs', { language: 'hi' });
  assert.equal(en.packs[0].title, 'Lender pack'); assert.equal(hi.packs[0].title, 'ऋणदाता पैक');
  const bank = hi.packs[0].pages.find((page: any) => page.id === 'bank-summary');
  assert.equal(bank.title, 'बैंक विवरण सारांश'); assert.equal(bank.reason, 'अभी तक कोई बैंक विवरण आयात नहीं हुआ है।');
  await assert.rejects(engine.request('reportsx.packs', { language: 'fr' }), code('INVALID_LANGUAGE'));

  const week = await engine.request('reportsx.weekAhead', { onDate: '2026-09-08' });
  const weekHi = await engine.request('reportsx.weekAhead', { onDate: '2026-09-08', language: 'hi' });
  assert.equal(weekHi.id, week.id, 'one brief per period, read in either language');
  const sales = week.changed.find((item: any) => item.id === 'net_sales'), salesHi = weekHi.changed.find((item: any) => item.id === 'net_sales');
  assert.equal(salesHi.text, 'शुद्ध बिक्री, 2026-08-31 से 2026-09-06 तक का सप्ताह, 2026-08-24 से 2026-08-30 तक के सप्ताह की तुलना में');
  assert.deepEqual(salesHi.chart.map((bar: any) => bar.label), ['उससे पहले का सप्ताह', 'पिछला सप्ताह']);
  assert.deepEqual(salesHi.figure, sales.figure, 'the figures do not change with the language');
  // Both weeks hold the same exact amount, so nothing moved; the money received has no earlier week to compare with.
  assert.equal(sales.movement, 'same'); assert.equal(sales.coverage, 'complete');
  assert.equal(week.changed.find((item: any) => item.id === 'received').movement, 'not-enough');
  for (const item of weekHi.due) assert.match(item.text, devanagari);
  assert.ok(weekHi.due.some((item: any) => item.text.startsWith('पिछले महीने का GSTR-1')));

  const friday = await engine.request('reportsx.friday', { onDate: '2026-09-11', language: 'hi' });
  assert.deepEqual(friday.period, { from: '2026-09-07', to: '2026-09-13' });
  await assert.rejects(engine.request('reportsx.friday', { language: 'xx' }), code('INVALID_LANGUAGE'));

  const rhythm = await engine.request('reportsx.rhythm', { language: 'hi' });
  for (const text of Object.values(rhythm.previews) as string[]) { assert.match(text, devanagari); assert.doesNotMatch(text, /\d|₹/); }
  assert.equal((await engine.request('reportsx.rhythm', {})).previews.mail, 'The week ahead is ready. Open Chausar to see it.');

  const due = await engine.request('reportsx.due', { from: '2026-10-14', days: 30, profile: { kind: 'services', gstMode: 'regular', state: 'MH' }, language: 'hi' });
  assert.equal(due.caNote, 'अभी किसी CA ने नहीं जाँचा है।'); assert.match(due.tableNote, devanagari);
  for (const row of due.rows) {
    assert.match(row.what, devanagari);
    assert.equal(row.appliesToWords.kinds.length, row.appliesTo.kinds.length);
    assert.equal(row.appliesToWords.states.length, row.appliesTo.states.length);
  }
  const pt = due.rows.find((row: any) => row.id.startsWith('pt-mh-employer'));
  assert.deepEqual(pt.appliesToWords.states, ['महाराष्ट्र']); assert.ok(pt.appliesToWords.kinds.includes('सेवाएँ'));
  assert.deepEqual(due.rows.find((row: any) => row.id.startsWith('gstr3b-monthly')).appliesToWords.gstModes, ['नियमित GST']);
  assert.deepEqual(due.profileWords, { kind: 'सेवाएँ', gstMode: 'नियमित GST', state: 'महाराष्ट्र' });
  assert.deepEqual(due.kinds.find((kind: any) => kind.id === 'retail'), { id: 'retail', name: 'दुकान या खुदरा' });
  assert.equal(due.states.length, 36);
  const dueEn = await engine.request('reportsx.due', { from: '2026-10-14', days: 30, profile: { kind: 'services', gstMode: 'regular', state: 'MH' } });
  assert.equal(dueEn.caNote, 'Not yet checked by a CA.');
  assert.deepEqual(dueEn.rows.find((row: any) => row.id.startsWith('pt-mh-employer')).appliesToWords.states, ['Maharashtra']);
  assert.deepEqual(dueEn.rows.map((row: any) => row.id), due.rows.map((row: any) => row.id), 'the dates do not change with the language');
});

test('a question file opens as text for an accountant seat only, by its plain name inside the questions folder', async t => {
  const { engine, directory } = await fixture(t);
  await engine.request('members.add', { id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant' });
  await engine.request('members.add', { id: 'viewer-1', name: 'Synthetic viewer', role: 'viewer' });
  const accountant: Context = { memberId: 'accountant-1', role: 'accountant', epoch: 1, channel: 'desktop' };
  const viewer: Context = { memberId: 'viewer-1', role: 'viewer', epoch: 1, channel: 'desktop' };
  assert.deepEqual(await engine.requestAs(accountant, 'reportsx.questions', {}), { items: [] });
  const made = await engine.request('reportsx.askPerson', { question: 'Is <b>this</b> & that right?', reason: 'Chausar said not yet.' });
  const { items } = await engine.requestAs(accountant, 'reportsx.questions', {});
  assert.deepEqual(items.map((item: any) => item.name), [made.file.name]);
  const opened = await engine.requestAs(accountant, 'reportsx.openQuestion', { name: made.file.name });
  assert.equal(opened.sha256, made.file.sha256); assert.equal(opened.bytes, made.file.bytes);
  assert.match(opened.text, /^A question for my accountant\nQuestion\nIs <b>this<\/b> & that right\?\n/);
  assert.doesNotMatch(opened.text, /<style|<h1|&lt;/);
  // Only an accountant or CA seat opens question files.
  await assert.rejects(engine.request('reportsx.openQuestion', { name: made.file.name }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'reportsx.questions', {}), code('FORBIDDEN'));
  // Anything but a plain question file name inside the folder is refused before the disk is read.
  await writeFile(join(directory, 'secret.html'), '<p>not a question</p>');
  for (const name of ['../secret.html', '../../secret.html', `..%2F${made.file.name}`, `question-x/../../secret.html`, join(directory, 'secret.html'), 'question-a.html\u0000', 'secret.html', '', 42])
    await assert.rejects(engine.requestAs(accountant, 'reportsx.openQuestion', { name }), code('INVALID_QUESTION_FILE'), String(name));
  await assert.rejects(engine.requestAs(accountant, 'reportsx.openQuestion', { name: 'question-missing.html' }), code('QUESTION_FILE_NOT_FOUND'));
  await assert.rejects(engine.requestAs(accountant, 'reportsx.openQuestion', { name: made.file.name, path: '/etc/passwd' }), code('INVALID_QUESTION_FILE'));
  // A link planted in the folder is not followed.
  await symlink(join(directory, 'secret.html'), join(directory, 'exports', 'questions', 'question-link.html'));
  await assert.rejects(engine.requestAs(accountant, 'reportsx.openQuestion', { name: 'question-link.html' }), code('QUESTION_FILE_NOT_FOUND'));
  assert.ok(!(await engine.requestAs(accountant, 'reportsx.questions', {})).items.some((item: any) => item.name === 'question-link.html'));
});

test('question text drops markup and keeps the words', () => {
  assert.equal(questionText('<!doctype html><title>T</title><style>b{}</style><h1>A</h1><p>x &lt;y&gt; &amp;amp;</p><table><tr><td>a</td><td>b</td></tr></table>'), 'A\nx <y> &amp;\na  b');
});
