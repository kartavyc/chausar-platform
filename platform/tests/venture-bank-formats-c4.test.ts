// One-shot C4 task 28 (231.x1, 233.x1, 233.b1, 234.x1): which bank files work, what an import added, and why a forecast
// is flat. The banks the app names come from the parser's own list, each proved here by the parser reading its header;
// the sample the app offers is read by the same parser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { BankImportResult, CashView } from '../runtime/venture/contracts.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { emptyLedger, importStatement, parseStatementCsv } from '../runtime/venture/build/bank.ts';
import { STATEMENT_FORMATS } from '../runtime/venture/build/bank-formats.ts';
import { formatDayRange } from '../runtime/owner-format.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { bankCosts } from './venture-money-env.ts';
import { owner } from './venture-views-env.ts';

const OPTIONS = { currency: 'INR', minorDigits: 2, dateOrder: 'day-month-year' as const };
const bankImport = (env: GoalEnv, csv: string, account = 'HDFC current') => (build as Record<string, (deps: unknown, ctx: unknown, payload: unknown) => Promise<unknown>>)['venture.bank.import'](env.deps, owner, { csv, account }) as Promise<BankImportResult>;

test('every bank the app names has a header the parser reads, with the row under it read exactly', () => {
  assert.ok(STATEMENT_FORMATS.length >= 4);
  assert.deepEqual(STATEMENT_FORMATS.map(format => format.bank), ['HDFC Bank', 'State Bank of India', 'ICICI Bank', 'Axis Bank']);
  for (const format of STATEMENT_FORMATS) {
    const parsed = parseStatementCsv(`${format.header}\n${format.row}\n`, OPTIONS);
    assert.deepEqual(parsed.rejected, [], format.bank);
    assert.equal(parsed.rows.length, 1, format.bank);
    assert.equal(parsed.rows[0].date, '2026-10-03', format.bank);
    assert.equal(parsed.rows[0].amountMinor, '-120000', format.bank);
  }
});

test('the sample file the app offers is read by the parser, and holds made-up rows', async () => {
  const csv = await readFile(new URL('../../app/ui/public/samples/bank-statement-sample.csv', import.meta.url), 'utf8');
  const parsed = parseStatementCsv(csv, OPTIONS);
  assert.deepEqual(parsed.rejected, []);
  assert.equal(parsed.rows.length, 4);
  assert.match(csv, /made-up/i);
});

test('a range of days in the owner form, with or without the year', () => {
  assert.equal(formatDayRange('2026-10-01', '2026-10-31', { year: false }), '1 to 31 Oct');
  assert.equal(formatDayRange('2026-10-03', '2026-10-03', { year: false }), '3 Oct');
  assert.equal(formatDayRange('2026-10-20', '2026-11-02', { year: false }), '20 Oct to 2 Nov');
  assert.equal(formatDayRange('2025-12-20', '2026-01-02', { year: false }), '20 Dec 2025 to 2 Jan 2026');
  assert.equal(formatDayRange('2026-10-01', '2026-10-31'), '1 to 31 Oct 2026');
});

test('the result line names the dates of the rows added, and where to see them; rows added out of order still read first to last', () => {
  const csv = 'Date,Description,Amount\n2026-10-31,Rent,-100.00\n2026-10-01,Deposit,500.00\n2026-10-15,Tea,-10.00\nbad,row,1\n';
  const first = importStatement(emptyLedger('HDFC current', 'INR'), csv, OPTIONS);
  assert.equal(first.line, 'Added 3 transactions from 1 to 31 Oct. See them under Connections, in your bank account. 1 row could not be read.');
  const one = importStatement(emptyLedger('HDFC current', 'INR'), 'Date,Description,Amount\n2026-10-03,Tea,-10.00\n', OPTIONS);
  assert.equal(one.line, 'Added 1 transaction from 3 Oct. See them under Connections, in your bank account.');
  // Part of the file was here already: the dates are of what was added.
  const more = importStatement(one.ledger, 'Date,Description,Amount\n2026-10-03,Tea,-10.00\n2026-10-09,Lunch,-20.00\n', OPTIONS);
  assert.equal(more.line, 'Added 1 transaction from 9 Oct. See them under Connections, in your bank account. 1 was already here and was not counted again.');
});

test('the same file again says it was already imported and that nothing was added', async () => {
  const env = await goalBusiness();
  const csv = 'Date,Description,Amount,Counterparty,Balance\n2026-10-02,Deposit,500.00,Someone,500.00\n';
  await bankImport(env, csv);
  const again = await bankImport(env, csv);
  assert.deepEqual([again.added, again.duplicates], [0, 1]);
  assert.equal(again.line, 'Already imported, nothing added.');
});

test('cash ahead with nothing due in or out says why the line stays flat; anything due takes the words away', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,5000.00']);
  const flat = await env.money<CashView>('venture.money.cash');
  assert.equal(flat.flat, 'Nothing due in or out in the next 13 weeks, so it stays flat.');
  await invoice(env, '1', '2026-10-20');
  const moving = await env.money<CashView>('venture.money.cash');
  assert.equal(moving.flat, undefined);
});
