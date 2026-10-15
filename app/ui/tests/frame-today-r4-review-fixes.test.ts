import test from 'node:test';
import assert from 'node:assert/strict';
import { csvText, fitsRequest, pickedStatement, REQUEST_LIMIT_BYTES } from '../src/screens/first-run/pick.ts';
import { asciiDigits, projectRound4, rupeesToPaise } from '../src/host/today-round4.ts';
import { isCloseStatusReply } from '../src/bridge/todayx-contract.ts';
import type { TodayData } from '../src/screens/today/TodayData.ts';
import { words } from '../src/text/lanes/frame-today.ts';

// Synthetic values only.
const codeOf = (work: () => unknown) => { try { work(); return null; } catch (error) { return (error as { code?: string }).code ?? null; } };

test('a CSV that is not UTF-8 is refused with its fixed code, never decoded with replacement characters', () => {
  assert.equal(csvText(new TextEncoder().encode('date,amount\n2026-10-01,12\n')), 'date,amount\n2026-10-01,12\n');
  assert.equal(csvText(new TextEncoder().encode('﻿नाम,राशि\n')), 'नाम,राशि\n');
  // 0xE9 alone is Latin-1 "é": not UTF-8.
  assert.equal(codeOf(() => csvText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))), 'FILE_NOT_UTF8');
  assert.equal(codeOf(() => pickedStatement('bank.csv', btoa(String.fromCharCode(0x63, 0xe9)))), 'FILE_NOT_UTF8');
  assert.equal(pickedStatement('bank.csv', btoa('a,b\n'))?.format, 'csv');
  assert.ok(words.en['FR-07.pick.FILE_NOT_UTF8'] && words.hi['FR-07.pick.FILE_NOT_UTF8']);
});

test('a request is checked against the size limit before it is sent', () => {
  assert.equal(REQUEST_LIMIT_BYTES, 1_900_000);
  assert.equal(fitsRequest('sources.preview', { content: 'a,b\n' }), true);
  assert.equal(fitsRequest('sources.preview', { content: 'x'.repeat(REQUEST_LIMIT_BYTES) }), false);
  // Bytes, not characters: Devanagari is three bytes each in UTF-8.
  assert.equal(fitsRequest('sources.preview', { content: 'क'.repeat(700_000) }), false);
});

test('cash typed in Devanagari digits is read digit for digit; anything else is not an amount', () => {
  assert.equal(asciiDigits('१२,५००.५०'), '12,500.50');
  assert.equal(rupeesToPaise('१२५००'), '1250000');
  assert.equal(rupeesToPaise('₹ १२,५००.५'), '1250050');
  assert.equal(rupeesToPaise('12500'), '1250000');
  for (const bad of ['twelve', '१२x', '', '1.234']) assert.equal(rupeesToPaise(bad), null, bad);
});

test('told cash is a figure with no receipt link, labelled told by owner; a close part that could not be read is not sure', () => {
  const base: TodayData = { state: { kind: 'ready' }, date: 'Thursday, 15 October', review: { count: { exact: '0', display: '0' }, rows: [] } };
  const days = ['09', '10', '11', '12', '13', '14', '15'].map(d => ({ day: `2026-10-${d}`, paise: d === '15' ? '1250000' : null, entryId: d === '15' ? 'cash_20261015_x' : null }));
  const close = { month: '2026-09', parts: { bank: 'not-sure', gstr2b: 'needs-you', tds: 'not-loaded-yet', 'trial-balance': 'not-loaded-yet' } } as const;
  assert.ok(isCloseStatusReply(close));
  const data = projectRound4(base, { review: null, close, cash: { day: '2026-10-15', label: 'told-by-owner', days } }, { language: 'en', view: 'simple', role: 'owner', navigate: () => {} });
  const entered = data.cash?.entered;
  assert.ok(entered !== undefined && entered.kind === 'money');
  assert.equal(entered.told, true);
  assert.equal(entered.exact, '1250000');
  const bar = data.cash?.week.values.at(-1)?.value;
  assert.ok(bar !== undefined && bar.kind === 'money' && bar.told === true);
  assert.deepEqual(data.close?.steps.map(st => [st.step, st.state, st.mark]).slice(0, 2), [['bank', 'not-sure', 'unsure'], ['gstr2b', 'needs-you', 'you']]);
  assert.ok(words.en['TD-03.close.state.not-sure'] && words.hi['TD-03.close.state.not-sure']);
});
