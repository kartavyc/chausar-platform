// Wave 6 (6E7 / D49): the trading journal desk. The owner imports their own broker tradebooks (synthetic fixtures),
// adds opening holdings and prepares a tax pack for their CA. Every amount is worked by code and saved with a work
// receipt. The desk keeps no client data, reaches no broker and never says what to trade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kitBusiness } from './fixtures/venture/kit-business.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook } from '../runtime/venture/playbooks/registry.ts';
import { PLAYBOOK_DEFINITIONS } from '../runtime/venture/playbooks/definitions.ts';
import { deskHandler } from '../runtime/venture/playbooks/desks.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/venture/trading-journal/${name}`, import.meta.url), 'utf8');
const code = (expected: string, words?: RegExp) => (error: any) => { assert.equal(error?.code, expected, error?.message); if (words) assert.match(error.message, words); return true; };
const base = { playbook: 'trading-journal', kind: 'journal' };

test('6E7 the trading journal is a registered playbook with a kit definition, a desk and its own picks', () => {
  const entry = PLAYBOOK_REGISTRY.find(item => item.id === 'trading-journal');
  assert.ok(entry, 'registered');
  assert.equal(pickPlaybook('I am an options trader and want a trading journal')?.id, 'trading-journal');
  const definition = PLAYBOOK_DEFINITIONS.find(item => item.registration.id === 'trading-journal');
  assert.ok(definition, 'defined');
  assert.ok(definition.rules.some(rule => rule.id === 'securities-guard' && rule.read === 'house'));
  assert.ok(definition.scope.outOfScope.includes('Stock tips or trade calls'));
  assert.ok(deskHandler('trading-journal', 'journal'));
});

test('6E7 import a tradebook: trades read, charges worked and a work receipt saved', async () => {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  const made = await env.call('venture.desk.act', { ...base, id: 'new', action: 'import', payload: { broker: null, name: 'zerodha-2025.csv', csv: fixture('zerodha-tradebook.csv') } });
  assert.deepEqual([made.result.trades, made.result.formatChecked], [6, true]);
  assert.match(made.line, /contract notes/);
  const state = env.store.read();
  const work = state.conversations.find((row: any) => row.kind === 'venture-work-receipt' && row.id === made.result.receiptId) as any;
  assert.ok(work, 'receipt saved');
  assert.equal(work.figures.find((f: any) => f.key === 'charges-total').minor, '13122');
  const view = await env.call('venture.desk.get', { ...base, id: 'journal' });
  assert.equal(view.item.journal.totals.total, '13122');
  assert.equal(view.item.imports[0].brokerName, 'Zerodha');
  assert.equal(view.item.summary.receiptId, made.result.receiptId);
  assert.equal(view.item.summary.figures.find((f: any) => f.key === 'charges-total').display, '₹131.22');
  assert.match(view.digest, /^[a-f0-9]{64}$/);
  const list = await env.call('venture.desk.list', base);
  assert.deepEqual(list.rows.map((row: any) => [row.kind, row.label]), [['import', 'Zerodha: zerodha-2025.csv']]);
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'new', action: 'import', payload: { broker: null, name: 'again.csv', csv: fixture('zerodha-tradebook.csv') } }), code('TRADEBOOK_DUPLICATE'));
});

test('6E7 an unchecked broker format says so; a bad file is refused with the columns expected', async () => {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  const made = await env.call('venture.desk.act', { ...base, id: 'new', action: 'import', payload: { broker: 'dhan', name: 'dhan.csv', csv: fixture('dhan-trades.csv') } });
  assert.equal(made.result.formatChecked, false);
  assert.match(made.line, /not checked against a real export/);
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'new', action: 'import', payload: { broker: 'groww', name: 'x.csv', csv: 'a,b\n1,2\n' } }), code('TRADEBOOK_INVALID', /execution date and time/));
});

test('6E7 opening holdings and the tax pack: grandfathered cost, the rule and year of each figure, check with your CA', async () => {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'new', action: 'tax-pack', payload: { yearId: 'fy-2025-26' } }), code('JOURNAL_EMPTY'));
  await env.call('venture.desk.act', { ...base, id: 'new', action: 'add-opening', payload: { symbol: 'HDFCBANK', isin: 'INE040A01034', boughtOn: '2017-06-01', quantity: '10', cost: '1000', fmv: '150' } });
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'new', action: 'add-opening', payload: { symbol: 'TCS', isin: null, boughtOn: '2020-06-01', quantity: '1', cost: '100', fmv: '150' } }), code('OPENING_INVALID'));
  const csv = 'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time\n'
    + 'HDFCBANK,INE040A01034,2025-06-10,NSE,EQ,EQ,sell,false,10.000000,300.000000,52000001,1200000000000001,2025-06-10T10:00:00\n';
  await env.call('venture.desk.act', { ...base, id: 'new', action: 'import', payload: { broker: 'zerodha', name: 'june.csv', csv } });
  const made = await env.call('venture.desk.act', { ...base, id: 'new', action: 'tax-pack', payload: { yearId: 'fy-2025-26' } });
  const figure = (key: string) => made.result.pack.figures.find((f: any) => f.key === key);
  assert.deepEqual([figure('ltcg').minor, figure('grandfathered').minor, figure('ltcg').rule.section, figure('ltcg').act], ['150000', '1', '112A', 'Income-tax Act 1961']);
  assert.match(made.line, /Check with your CA/);
  const view = await env.call('venture.desk.get', { ...base, id: 'journal' });
  assert.deepEqual(view.item.packs.map((p: any) => [p.yearId, p.stale]), [['fy-2025-26', false]]);
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'new', action: 'tax-pack', payload: { yearId: 'fy-2019-20' } }), code('TAX_YEAR_UNSUPPORTED'));
});

test('6E7 desk actions come only from the app, and only as new entries', async () => {
  const env = await kitBusiness({ now: new Date('2026-11-01T05:00:00.000Z') });
  const handler = deskHandler('trading-journal', 'journal')!;
  await assert.rejects(handler.act!(env.deps, { memberId: 'owner', role: 'owner', epoch: 1 } as any, { ...base, id: 'new', action: 'import', payload: { broker: null, name: 'a.csv', csv: fixture('zerodha-tradebook.csv') } } as any), (error: any) => typeof error?.code === 'string');
  await assert.rejects(env.call('venture.desk.act', { ...base, id: 'journal', action: 'import', payload: {} }), code('INVALID_VENTURE_REQUEST'));
});
