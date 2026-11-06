// C2 task 1: one matcher for every kind of thing the command bar finds (clients, invoices, orders, runs, chats). Pure and
// browser safe, so the engine, the fake and the page catalogue rank on one scale. Literal cases from the plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIND_KINDS, match, parseFindRequest, rank, snippetOf, wordsOf } from '../runtime/venture/views/find-core.ts';
import type { ChatPart } from '../runtime/venture/contracts.ts';

const refused = (error: any) => error.code === 'INVALID_VENTURE_REQUEST';

test('the request: text is required; kinds and limit are checked; any other field or a bad value is refused without the text', () => {
  assert.deepEqual(FIND_KINDS, ['client', 'invoice', 'order', 'run', 'chat']);
  assert.deepEqual(parseFindRequest({ text: 'meera' }), { text: 'meera', kinds: [...FIND_KINDS], limit: 5 });
  assert.deepEqual(parseFindRequest({ text: 'inv', kinds: ['invoice', 'client'], limit: 20 }), { text: 'inv', kinds: ['invoice', 'client'], limit: 20 });
  const secret = 'my private words about a client';
  for (const payload of [{}, { text: 7 }, { text: 'x'.repeat(201) }, { text: secret, kinds: ['person'] }, { text: secret, kinds: [] }, { text: secret, limit: 0 }, { text: secret, limit: 21 }, { text: secret, limit: 2.5 }, { text: secret, extra: true }, null, 'text']) {
    assert.throws(() => parseFindRequest(payload as any), (error: any) => refused(error) && !error.message.includes(secret) && !error.message.includes('x'.repeat(50)), JSON.stringify(payload)?.slice(0, 40));
  }
});

test('words: accents dropped, lower case, spaces collapsed; under two characters finds nothing', () => {
  assert.deepEqual(wordsOf('  Mēera   IYER '), ['meera', 'iyer']);
  assert.deepEqual(wordsOf('a'), []);
  assert.deepEqual(wordsOf(' '), []);
  assert.deepEqual(wordsOf('ab'), ['ab']);
});

test('every word must match; a whole field beats a word start, which beats a match inside a word; the title weighs more', () => {
  const meera = match('meera', [{ name: 'name', text: 'Mēera Iyer' }]);
  assert.ok(meera); assert.deepEqual(meera!.hit, { field: 'name', start: 0, length: 5 });
  assert.ok(match('events sit', [{ name: 'name', text: 'Sitara Events' }]));
  assert.equal(match('events cafe', [{ name: 'name', text: 'Sitara Events' }]), null);
  const whole = match('sitara events', [{ name: 'name', text: 'Sitara Events' }])!.score;
  const start = match('sitara', [{ name: 'name', text: 'Sitara Events' }])!.score;
  const inside = match('tara', [{ name: 'name', text: 'Sitara Events' }])!.score;
  assert.ok(whole > start && start > inside, `${whole} > ${start} > ${inside}`);
  const inTitle = match('meera', [{ name: 'request', text: 'Logo for Meera' }, { name: 'client', text: 'Test Bakery' }])!.score;
  const inOther = match('meera', [{ name: 'request', text: 'Logo for a cafe' }, { name: 'client', text: 'Meera Iyer' }])!.score;
  assert.ok(inTitle > inOther);
  assert.equal(match('meera', [{ name: 'request', text: 'Logo for a cafe' }, { name: 'client', text: 'Meera Iyer' }])!.hit, null, 'the hit is only for the title');
});

test('a number field drops punctuation and leading zeros: INV, inv-41, INV-0041, 0041 and 41 find INV-0041, 4 does not', () => {
  const fields = [{ name: 'number', text: 'INV-0041', number: true }, { name: 'client', text: 'Meera Iyer' }];
  for (const query of ['INV', 'inv-41', 'INV-0041', '0041', '41']) assert.ok(match(query, fields), query);
  assert.equal(match('4', fields), null);
  assert.equal(match('42', fields), null);
  assert.ok(match('inv-0041', fields)!.score > match('41', fields)!.score);
  assert.deepEqual(match('0041', fields)!.hit, { field: 'number', start: 0, length: 8 });
});

test('rank: score, then newest, then id; more says how many were left out', () => {
  const items = [
    { id: 'b', score: 4, at: '2026-11-01T00:00:00.000Z' }, { id: 'a', score: 4, at: '2026-11-03T00:00:00.000Z' },
    { id: 'c', score: 9, at: '2026-10-01T00:00:00.000Z' }, { id: 'e', score: 1, at: '2026-11-05T00:00:00.000Z' },
    { id: 'd', score: 4, at: '2026-11-03T00:00:00.000Z' },
  ];
  assert.deepEqual(rank(items, 5).items.map(item => item.id), ['c', 'a', 'd', 'b', 'e']);
  const two = rank(items, 2);
  assert.deepEqual(two.items.map(item => item.id), ['c', 'a']); assert.equal(two.more, 3);
});

test('a snippet of a long answer holds the hit, starts and ends on whole words, and keeps a receipted amount', () => {
  const filler = 'The books for this quarter were read line by line and every entry was matched against the bank statement. ';
  const parts: ChatPart[] = [
    { kind: 'text', text: filler.repeat(5) },
    { kind: 'text', text: 'Your Razorpay payouts came to' },
    { kind: 'figure', receiptId: 'receipt_1', key: 'payouts', display: '₹12,400' },
    { kind: 'text', text: `this month. ${filler.repeat(4)}` },
  ];
  const whole = parts.map(part => part.kind === 'figure' ? part.display : part.text).join(' ');
  assert.ok(whole.length > 900, `${whole.length}`);
  const snippet = snippetOf(parts, 'razorpay')!;
  assert.ok(snippet.line.length <= 120, `${snippet.line.length}`);
  assert.match(snippet.line, /Razorpay/);
  assert.ok(whole.replace(/\s+/g, ' ').includes(snippet.line));
  const at = whole.replace(/\s+/g, ' ').indexOf(snippet.line), flat = whole.replace(/\s+/g, ' ');
  assert.ok(at === 0 || flat[at - 1] === ' ', 'starts on a word');
  assert.ok(at + snippet.line.length === flat.length || flat[at + snippet.line.length] === ' ', 'ends on a word');
  assert.deepEqual(snippet.amounts, [{ text: '₹12,400', start: snippet.line.indexOf('₹12,400'), length: 7, receiptId: 'receipt_1' }]);
  assert.equal(snippetOf(parts, 'invoice'), null);
});

test('an amount cut by the window edge is dropped with its words', () => {
  const parts: ChatPart[] = [
    { kind: 'text', text: 'aaaa '.repeat(20) },
    { kind: 'figure', receiptId: 'receipt_2', key: 'total', display: '₹1,00,000' },
    { kind: 'text', text: `and then ${'xx '.repeat(8)}the Sitara wedding paid${' more'.repeat(40)}` },
  ];
  const snippet = snippetOf(parts, 'sitara')!;
  assert.match(snippet.line, /^and then xx .* the Sitara wedding paid more/);
  assert.ok(snippet.line.length <= 120);
  assert.deepEqual(snippet.amounts, []);
  assert.doesNotMatch(snippet.line, /1,00|₹/);
});

test('find-core is browser safe: no node: import and its first statement is an import or export', async () => {
  const text = await readFile(new URL('../runtime/venture/views/find-core.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /from ['"]node:/);
  const first = text.split('\n').find(line => line.trim() && !line.trim().startsWith('//'))!;
  assert.match(first, /^(?:import|export)\b/);
});
