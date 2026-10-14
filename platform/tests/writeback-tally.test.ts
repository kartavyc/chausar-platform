import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, tallyAdapters } from '../runtime/writeback/systems/tally.ts';
import { TallyFake, tallySeed } from '../fakes/tally/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

const company = tallySeed.company;
function setup(account: Record<string, string> = {}) {
  const fake = new TallyFake();
  const ctx = fakeContext(fake, practiceConnection('tally', { host: '127.0.0.1', port: '9000', company, ...account }), {});
  return { fake, ctx };
}
const sale = (voucherNumber: string, extra: Record<string, unknown> = {}) => ({ company, voucherType: 'Sales', voucherNumber, date: '2026-10-14', party: 'Kiran Stores (synthetic)', narration: 'Cartons (synthetic)',
  lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '250050', side: 'debit' }, { ledger: 'Sales', amountMinor: '250050', side: 'credit' }], ...extra });

test('a voucher is created once under its remote id, read back from the Day Book, and a repeat finds it instead of importing again', async () => {
  const { fake, ctx } = setup(); const adapter = tallyAdapters['voucher.create'];
  const first = await cycle(adapter, ctx, sale('S-101'), 'effect-key-vch-1');
  assert.equal(first.receipt?.outcome, 'provider-claims-applied');
  assert.match(String(first.preparation.command.xml), /<AMOUNT>-2500\.50<\/AMOUNT>/);
  assert.match(String(first.preparation.command.xml), /<VOUCHER REMOTEID="effect-key-vch-1" VCHTYPE="Sales" ACTION="Create">/);
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.deepEqual((first.observation as any).observed, { voucherNumber: 'S-101', voucherType: 'Sales', date: '2026-10-14', party: 'Kiran Stores (synthetic)',
    lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '250050', side: 'debit' }, { ledger: 'Sales', amountMinor: '250050', side: 'credit' }] });
  assert.deepEqual((first.observation as any).observed, first.preparation.postconditions);
  const again = await cycle(adapter, ctx, sale('S-101'), 'effect-key-vch-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(fake.vouchers.length, 2);
});

test('a lost reply after commit is settled by reading back exactly one voucher, never by importing again', async () => {
  const { fake, ctx } = setup(); const adapter = tallyAdapters['voucher.create'];
  fake.fault('drop-after-commit');
  const result = await cycle(adapter, ctx, sale('S-102'), 'effect-key-vch-2');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.equal(result.observation.outcome, 'confirmed-applied');
  assert.equal(fake.vouchers.filter(v => v.voucherNumber === 'S-102').length, 1);
  const retry = await cycle(adapter, ctx, sale('S-102'), 'effect-key-vch-2');
  assert.ok(retry.preparation.alreadyApplied); assert.equal(fake.vouchers.filter(v => v.voucherNumber === 'S-102').length, 1);
});

test('an unbalanced voucher is refused before anything is sent', async () => {
  const { fake, ctx } = setup();
  const payload = sale('S-103', { lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '250050', side: 'debit' }, { ledger: 'Sales', amountMinor: '250049', side: 'credit' }] });
  await assert.rejects(cycle(tallyAdapters['voucher.create'], ctx, payload, 'effect-key-vch-3'), { code: 'INVALID_VOUCHER_UNBALANCED' });
  assert.throws(() => tallyAdapters['voucher.create'].validate(sale('S-103', { lines: [{ ledger: 'Sales', amountMinor: '100', side: 'credit' }] })), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => tallyAdapters['voucher.create'].validate(sale('S-103', { voucherType: 'Memo' })), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.equal(fake.log.length, 0);
});

test('an unknown ledger is refused at prepare, and Tally itself rejects one that vanished after the preview', async () => {
  const { fake, ctx } = setup(); const adapter = tallyAdapters['voucher.create'];
  const payload = sale('S-104', { lines: [{ ledger: 'Kiran Stores (synthetic)', amountMinor: '100', side: 'debit' }, { ledger: 'Freight Inward', amountMinor: '100', side: 'credit' }] });
  await assert.rejects(cycle(adapter, ctx, payload, 'effect-key-vch-4'), { code: 'WRITE_PRECONDITION_FAILED' });
  const valid = adapter.validate(sale('S-105'));
  const preparation = await adapter.prepare(ctx, valid, 'effect-key-vch-5');
  fake.ledgers = fake.ledgers.filter(l => l.name !== 'Sales');
  const receipt = await adapter.do(ctx, valid, preparation, 'effect-key-vch-5');
  assert.equal(receipt.outcome, 'rejected');
  assert.equal((await adapter.readBack(ctx, valid, preparation, 'effect-key-vch-5', receipt)).outcome, 'inconclusive');
});

test('a voucher number already taken under another remote id is refused', async () => {
  const { ctx } = setup();
  await assert.rejects(cycle(tallyAdapters['voucher.create'], ctx, sale('S-001', { date: '2026-10-01' }), 'effect-key-vch-6'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('a ledger is created once under an existing group and read back by name', async () => {
  const { fake, ctx } = setup(); const adapter = tallyAdapters['ledger.create'];
  const payload = { company, name: 'Courier Charges', parent: 'Purchase Accounts' };
  const first = await cycle(adapter, ctx, payload, 'effect-key-led-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.deepEqual((first.observation as any).observed, { name: 'Courier Charges', parent: 'Purchase Accounts' });
  const again = await cycle(adapter, ctx, payload, 'effect-key-led-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(fake.ledgers.filter(l => l.name === 'Courier Charges').length, 1);
  await assert.rejects(cycle(adapter, ctx, { company, name: 'Courier Charges', parent: 'Sales Accounts' }, 'effect-key-led-2'), { code: 'WRITE_PRECONDITION_FAILED' });
  await assert.rejects(cycle(adapter, ctx, { company, name: 'Octroi', parent: 'Indirect Expenses' }, 'effect-key-led-3'), { code: 'WRITE_PRECONDITION_FAILED' });
});

test('names with XML special characters are escaped on the wire and read back unchanged', async () => {
  const { fake, ctx } = setup(); const party = 'Sharma & Sons <synthetic> "A"';
  const ledger = await cycle(tallyAdapters['ledger.create'], ctx, { company, name: party, parent: 'Sundry Debtors' }, 'effect-key-led-4');
  assert.equal(ledger.observation.outcome, 'confirmed-applied');
  assert.match(String(ledger.preparation.command.xml), /NAME="Sharma &amp; Sons &lt;synthetic&gt; &quot;A&quot;"/);
  const payload = sale('S-106', { party, narration: 'Tea & <biscuits>', lines: [{ ledger: party, amountMinor: '5000', side: 'debit' }, { ledger: 'Sales', amountMinor: '5000', side: 'credit' }] });
  const voucher = await cycle(tallyAdapters['voucher.create'], ctx, payload, 'effect-key-vch-7');
  assert.equal(voucher.observation.outcome, 'confirmed-applied');
  assert.equal((voucher.observation as any).observed.party, party);
  assert.match(String(voucher.preparation.command.xml), /<NARRATION>Tea &amp; &lt;biscuits&gt;<\/NARRATION>/);
  assert.equal(fake.vouchers.at(-1)!.narration, 'Tea & <biscuits>');
});

test('a host other than this computer, another company, and unreadable replies are refused with fixed codes', async () => {
  const remote = setup({ host: '192.168.1.20' });
  await assert.rejects(cycle(tallyAdapters['voucher.create'], remote.ctx, sale('S-107'), 'effect-key-vch-8'), { code: 'WRITE_ORIGIN_REFUSED' });
  assert.equal(remote.fake.log.length, 0);
  const { ctx } = setup();
  await assert.rejects(cycle(tallyAdapters['ledger.create'], ctx, { company: 'Other Co (synthetic)', name: 'X', parent: 'Sundry Debtors' }, 'effect-key-led-5'), { code: 'WRITE_CONNECTION_MISMATCH' });
  const unloaded = setup({ company: 'Other Co (synthetic)' });
  await assert.rejects(cycle(tallyAdapters['ledger.create'], unloaded.ctx, { company: 'Other Co (synthetic)', name: 'X', parent: 'Sundry Debtors' }, 'effect-key-led-6'), { code: 'WRITE_SYSTEM_REFUSED' });
  for (const bad of ['<!DOCTYPE x><ENVELOPE/>', '<ENVELOPE>&bogus;</ENVELOPE>', '<A><B></A></B>', '<A/><B/>', '<?pi x?><A/>', 'plain text'])
    assert.throws(() => parseXml(bad), { code: 'WRITE_REPLY_INVALID' });
  assert.throws(() => parseXml(`<A>${'x'.repeat(4 * 1024 * 1024)}</A>`), { code: 'WRITE_REPLY_INVALID' });
});
