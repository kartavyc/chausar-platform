// Wave 6 (6E7 / D49): the trading journal core. Broker tradebooks (synthetic fixtures that follow each broker's export
// columns; never real account data) become exact trade rows; code works every charge per contract note line with the
// dated rates and realised profit or loss first in, first out; the tax pack names the rule and year of every figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readTradebook } from '../runtime/venture/playbooks/trading-journal/brokers.ts';
import { buildJournal, contractNotes, legsOf, addMonths, longTermOn, type OpeningLot } from '../runtime/venture/playbooks/trading-journal/journal.ts';
import { taxPack } from '../runtime/venture/playbooks/trading-journal/tax-pack.ts';
import { journalReceipt, taxPackReceipt } from '../runtime/venture/playbooks/trading-journal/receipt.ts';
import { STT_PERIODS, EXCHANGE_PERIODS, BROKER_RATES, BROKER_IDS } from '../runtime/venture/playbooks/trading-journal/rates.ts';
import { TAX_YEARS } from '../runtime/venture/playbooks/trading-journal/tax-rules.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/venture/trading-journal/${name}`, import.meta.url), 'utf8');
const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
const figure = (pack: ReturnType<typeof taxPack>, key: string) => pack.figures.find(f => f.key === key)!;

test('the Zerodha tradebook reads into exact rows, detected from its columns', () => {
  const book = readTradebook(fixture('zerodha-tradebook.csv'));
  assert.equal(book.broker, 'zerodha');
  assert.equal(book.format.checked, true);
  assert.equal(book.trades.length, 6);
  const option = book.trades.find(t => t.symbol === 'NIFTY25JUL25000CE')!;
  assert.deepEqual([option.instrument, option.exchange, option.side, option.quantity, option.value4, option.expiry], ['option', 'NSE', 'buy', '75', String(75n * 1_000_000n), '2025-07-31']);
});

test('every charge per contract note line, from the dated rates, matches the worked example to the paisa', () => {
  const journal = buildJournal(readTradebook(fixture('zerodha-tradebook.csv')).trades, [], '2026-11-01');
  const note = (date: string, kind: string) => journal.notes.find(n => n.date === date && n.kind === kind)!.charges;
  assert.deepEqual(note('2025-04-10', 'delivery'), { brokerage: '0', stt: '1500', exchange: '45', sebi: '2', ipft: '2', stamp: '225', dp: '0', gst: '9', total: '1783' });
  assert.deepEqual(note('2025-06-02', 'intraday'), { brokerage: '903', stt: '378', exchange: '89', sebi: '3', ipft: '3', stamp: '45', dp: '0', gst: '180', total: '1601' });
  assert.deepEqual(note('2025-07-03', 'options'), { brokerage: '4000', stt: '900', exchange: '578', sebi: '2', ipft: '8', stamp: '23', dp: '0', gst: '826', total: '6337' });
  // From 1 March 2026 the investor protection charge is folded into the exchange rate; DP charges apply to the delivery sell.
  assert.deepEqual(note('2026-05-12', 'delivery'), { brokerage: '0', stt: '1800', exchange: '55', sebi: '2', ipft: '0', stamp: '0', dp: '1300', gst: '244', total: '3401' });
  assert.equal(journal.totals.total, '13122');
});

test('realised profit or loss: intraday, futures and options, and long-term capital gains', () => {
  const journal = buildJournal(readTradebook(fixture('zerodha-tradebook.csv')).trades, [], '2026-11-01');
  const of = (kind: string) => journal.realised.filter(l => l.kind === kind);
  assert.deepEqual(of('intraday').map(l => [l.symbol, l.pnlMinor]), [['INFY', '10000']]);
  assert.deepEqual(of('fno').map(l => [l.symbol, l.pnlMinor, l.closedBy]), [['NIFTY25JUL25000CE', '150000', 'trade']]);
  assert.deepEqual(of('capital').map(l => [l.symbol, l.costMinor, l.saleMinor, l.pnlMinor, l.longTerm]), [['TCS', '1500000', '1800000', '300000', true]]);
  assert.deepEqual(journal.unmatched, []);
  assert.deepEqual(journal.open, []);
});

test('the tax pack names each figure with its rule, Act and year, and says check with your CA', () => {
  const journal = buildJournal(readTradebook(fixture('zerodha-tradebook.csv')).trades, [], '2026-11-01');
  const fy = taxPack(journal, 'fy-2025-26');
  assert.equal(fy.act, 'Income-tax Act 1961');
  assert.match(fy.line, /Check with your CA/);
  assert.deepEqual(['speculative-pnl', 'speculative-turnover', 'speculative-charges', 'speculative-net'].map(k => figure(fy, k).minor), ['10000', '10000', '1601', '8399']);
  assert.deepEqual(['fno-pnl', 'fno-turnover', 'fno-charges', 'fno-net'].map(k => figure(fy, k).minor), ['150000', '150000', '6337', '143663']);
  assert.equal(figure(fy, 'speculative-pnl').rule.section, '43(5)');
  assert.equal(figure(fy, 'stcg-rate').minor, '2000');
  assert.equal(figure(fy, 'stcg-rate').rule.section, '111A');
  assert.deepEqual([figure(fy, 'delivery-stt').minor, figure(fy, 'delivery-other-charges').minor], ['1500', '283']);
  const ty = taxPack(journal, 'ty-2026-27');
  assert.equal(ty.act, 'Income-tax Act 2025');
  assert.deepEqual([figure(ty, 'ltcg').minor, figure(ty, 'ltcg-limit').minor, figure(ty, 'ltcg-above-limit').minor], ['300000', '12500000', '0']);
  assert.equal(figure(ty, 'ltcg').rule.section, '198');
  assert.equal(figure(ty, 'stcg').rule.section, '196');
  assert.ok(ty.figures.every(f => f.year === 'Tax year 2026-27' && f.rule.source.startsWith('https://')));
  assert.throws(() => taxPack(journal, 'fy-2023-24'), code('TAX_YEAR_UNSUPPORTED'));
});

test('grandfathering: cost is the higher of actual cost and the lower of the 31 January 2018 value and the sale value', () => {
  const csv = 'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time\n'
    + 'HDFCBANK,INE040A01034,2025-06-10,NSE,EQ,EQ,sell,false,10.000000,300.000000,52000001,1200000000000001,2025-06-10T10:00:00\n';
  const trades = readTradebook(csv).trades;
  const opening = (fmvMinor: string | null): OpeningLot => ({ id: 'open-1', symbol: 'HDFCBANK', isin: 'INE040A01034', boughtOn: '2017-06-01', quantity: '10', costMinor: '100000', fmvMinor });
  const lower = buildJournal(trades, [opening('15000')], '2026-11-01').realised[0];
  assert.deepEqual([lower.grandfathered, lower.pnlMinor, lower.longTerm], [{ fmvMinor: '150000', costUsedMinor: '150000' }, '150000', true]);
  const above = buildJournal(trades, [opening('40000')], '2026-11-01').realised[0];
  assert.deepEqual([above.grandfathered?.costUsedMinor, above.pnlMinor], ['300000', '0']);
  const missing = buildJournal(trades, [opening(null)], '2026-11-01');
  assert.equal(missing.realised[0].needsFmv, true);
  const pack = taxPack(missing, 'fy-2025-26');
  assert.deepEqual([figure(pack, 'ltcg').minor, figure(pack, 'needs-fmv').minor], ['0', '1']);
  assert.equal(figure(pack, 'grandfathered').rule.section, '55(2)(ac)');
  const unmatched = buildJournal(trades, [], '2026-11-01');
  assert.equal(unmatched.unmatched.length, 1);
  assert.equal(unmatched.realised.length, 0);
});

test('Groww, Upstox and Dhan tradebooks read with their own brokerage, and are labelled unchecked', () => {
  const brokerage = (name: string) => buildJournal(readTradebook(fixture(name)).trades, [], '2026-11-01').notes.find(n => n.kind === 'intraday')!.charges.brokerage;
  const groww = readTradebook(fixture('groww-orders.csv'));
  assert.deepEqual([groww.broker, groww.format.checked, groww.trades.length], ['groww', false, 2], 'preamble rows skipped, the cancelled order left out');
  assert.equal(brokerage('groww-orders.csv'), '3010');
  assert.equal(brokerage('upstox-trades.csv'), '3010');
  assert.equal(brokerage('dhan-trades.csv'), '903');
  assert.equal(readTradebook(fixture('dhan-trades.csv')).format.checked, false);
});

test('options sold from 1 April 2026 carry the Finance Act 2026 securities transaction tax', () => {
  const notes = buildJournal(readTradebook(fixture('upstox-trades.csv')).trades, [], '2026-11-01').notes;
  const options = notes.find(n => n.kind === 'options')!.charges;
  assert.equal(options.stt, '1013');
  assert.equal(options.exchange, '453');
  assert.equal(options.ipft, '0');
});

test('an open option with a known expiry closes at zero on expiry; without one it stays open', () => {
  const csv = 'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date\n'
    + 'NIFTY25AUG24000PE,,2025-08-01,NSE,FO,,buy,false,75.000000,10.000000,53000001,1300000000000001,2025-08-01T10:00:00,2025-08-28\n';
  const expired = buildJournal(readTradebook(csv).trades, [], '2026-11-01');
  assert.deepEqual(expired.realised.map(l => [l.closedBy, l.closedOn, l.pnlMinor]), [['expiry', '2025-08-28', '-75000']]);
  const early = buildJournal(readTradebook(csv).trades, [], '2025-08-15');
  assert.equal(early.realised.length, 0);
  assert.equal(early.open.length, 1);
});

test('refusals: unknown columns name the expected ones, old dates, extra decimals and repeated trades', () => {
  assert.throws(() => readTradebook('a,b,c\n1,2,3\n'), code('TRADEBOOK_INVALID', /columns/));
  assert.throws(() => readTradebook('a,b\n1,2\n', 'dhan'), code('TRADEBOOK_INVALID', /trade price/));
  const head = 'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time\n';
  const row = (date: string, price = '100.000000', id = '1') => `INFY,INE009A01021,${date},NSE,EQ,EQ,buy,false,1.000000,${price},${id},9,${date}T10:00:00\n`;
  assert.throws(() => buildJournal(readTradebook(head + row('2024-09-30')).trades, [], '2026-11-01'), code('TRADEBOOK_INVALID', /opening holdings/));
  assert.throws(() => readTradebook(head + row('2025-06-02', '100.123456')), code('TRADEBOOK_INVALID', /four decimal/));
  assert.throws(() => readTradebook(head + row('2025-06-02') + row('2025-06-02')), code('TRADEBOOK_INVALID', /twice/));
});

test('trades repeated across two imports count once', () => {
  const trades = readTradebook(fixture('zerodha-tradebook.csv')).trades;
  assert.equal(buildJournal([...trades, ...trades], [], '2026-11-01').totals.total, '13122');
});

test('the holding period rule: more than twelve months is long term', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(longTermOn('2025-04-10', '2026-04-10'), false);
  assert.equal(longTermOn('2025-04-10', '2026-04-11'), true);
});

test('rates and rules are versioned data with a source, a start day and how each was read', () => {
  for (const period of [...STT_PERIODS, ...EXCHANGE_PERIODS]) { assert.match(period.from, /^\d{4}-\d{2}-\d{2}$/); assert.match(period.source.url, /^https:\/\//); assert.ok(['official', 'secondary', 'unchecked'].includes(period.source.read)); }
  for (const id of BROKER_IDS) assert.match(BROKER_RATES[id].source.url, /^https:\/\//);
  assert.deepEqual(TAX_YEARS.map(y => [y.id, y.act]), [['fy-2025-26', 'Income-tax Act 1961'], ['ty-2026-27', 'Income-tax Act 2025']]);
});

test('the receipts carry every figure, the steps that add them and their sources', () => {
  const journal = buildJournal(readTradebook(fixture('zerodha-tradebook.csv')).trades, [], '2026-11-01');
  const source = { id: 'import-1', name: 'tradebook.csv', digest: 'a'.repeat(64) };
  const receipt = journalReceipt('journal-1', [source], journal);
  assert.equal(receipt.figures.find(f => f.key === 'charges-total')!.display, 'INR 131.22');
  assert.ok(receipt.steps.find(s => s.result === '4578')!.rule.includes('BSE notice'));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  const pack = taxPackReceipt('pack-1', [source], taxPack(journal, 'fy-2025-26'));
  assert.match(pack.explanation, /Check with your CA/);
  assert.ok(pack.steps.every(step => /section/.test(step.rule)));
});
