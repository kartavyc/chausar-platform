// Accounting write decisions after the MIT marketplace-to-books pattern; original Chausar regressions.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decidePosting, booksFinancialDigest, fitLines, externalPostingId, postingDay, prepareBooksBatch, type BooksOrder } from '../runtime/venture/playbooks/bookkeeping-cfo/posting-core.ts';

const order = (extra: Partial<BooksOrder> = {}): BooksOrder => ({ shopId: 'shop-a', orderId: 'sale-a', source: 'orders.csv:2', occurredAt: '2026-10-27T20:00:00Z', timeZone: 'Asia/Kolkata', status: 'paid', eligible: true, currency: 'INR', goodsMinor: '10000', sellerDiscountMinor: '500', platformDiscountMinor: '500', subtotalMinor: '9000', shippingMinor: '1000', taxMinor: '1800', totalMinor: '11800', lines: [{ sku: 'tea', itemId: 'item-1', amountMinor: '6000' }, { sku: 'cup', itemId: 'item-2', amountMinor: '4000' }], ...extra });
const code = (value: string) => (error: unknown) => (error as {code?:string}).code === value;

test('books decisions have ordered skip reasons and preserve tax in the code-calculated draft', () => {
  assert.equal(decidePosting(order({eligible:false,status:'cancelled'}), []).reason, 'not-eligible');
  assert.equal(decidePosting(order({status:'cancelled'}), []).reason, 'cancelled-before-posting');
  assert.equal(decidePosting(order({status:'unpaid',totalMinor:'1'}), []).reason, 'not-paid');
  assert.equal(decidePosting(order({totalMinor:'1'}), []).reason, 'money-does-not-tie');
  assert.equal(decidePosting(order({lines:[{sku:'tea',itemId:null,amountMinor:'10000'}]}), []).reason, 'item-not-mapped');
  const row = decidePosting(order(), []);
  assert.equal(row.action, 'create-draft');
  assert.equal(row.postingDate, '2026-10-28');
  assert.equal(row.totalMinor, '11800');
  assert.equal(row.taxMinor, '1800');
  assert.deepEqual(row.lines.map(line=>line.amountMinor), ['5400','3600']);
  assert.ok(row.reason.length > 0 && row.receiptId.startsWith('books_'));
});

test('line fitting allocates the full proportion and puts the integer remainder on the largest line', () => {
  assert.deepEqual(fitLines(['3','2','2'],'10'), ['6','2','2']);
  assert.deepEqual(fitLines(['3','2','2'],'5'), ['3','1','1']);
  assert.deepEqual(fitLines(['1','1'],'1'), ['1','0']);
  assert.throws(()=>fitLines(['0','0'],'1'), code('BOOKS_MONEY_INVALID'));
  assert.throws(()=>fitLines(['-1','2'],'1'), code('BOOKS_MONEY_INVALID'));
  assert.throws(()=>fitLines(['1.5'],'1'), code('BOOKS_MONEY_INVALID'));
  for (let target=0;target<101;target++) assert.equal(fitLines(['3','2','2'],String(target)).reduce((sum,x)=>sum+BigInt(x),0n), BigInt(target));
});

test('existing drafts and issued books never silently overwrite a changed total; reversals have separate identity', () => {
  const externalId=externalPostingId(order());
  const posted={externalId,id:'remote-sale',status:'issued' as const,postingDate:'2026-10-28',document:'invoice' as const,originalId:null,totalMinor:'11800',recipientId:'77',materialDigest:null,financialDigest:booksFinancialDigest(decidePosting(order(),[]))};
  assert.equal(decidePosting(order(),[posted]).reason,'already-posted');
  assert.equal(decidePosting(order(),[{...posted,totalMinor:'12000'}]).reason,'existing-record-differs');
  const refund=decidePosting(order({status:'cancelled'}),[posted]);
  assert.equal(refund.action,'create-refund-draft');
  assert.equal(refund.externalId,externalId+'-refund');
  assert.equal(refund.originalId,'remote-sale');
  assert.equal(decidePosting(order({status:'cancelled'}),[posted,{...posted,id:'remote-refund',externalId:externalId+'-refund'}]).reason,'refund-already-posted');
  assert.notEqual(externalPostingId(order({shopId:'shop-b'})), externalId);
  assert.notEqual(externalPostingId(order({orderId:'sale-a-refund'})), externalId+'-refund');
});

test('failed or ambiguous existing-record reads stop the whole dry run before any proposal', async () => {
  await assert.rejects(prepareBooksBatch([order()],async()=>{throw Error('unreachable');}),code('BOOKS_READ_FAILED'));
  const externalId=externalPostingId(order());
  await assert.rejects(prepareBooksBatch([order()],async()=>[{externalId,id:'one',status:'draft',postingDate:'2026-10-28',document:'invoice',originalId:null,totalMinor:'11800',recipientId:'77',materialDigest:null,financialDigest:null},{externalId,id:'two',status:'draft',postingDate:'2026-10-28',document:'invoice',originalId:null,totalMinor:'11800',recipientId:'77',materialDigest:null,financialDigest:null}]),code('BOOKS_READ_FAILED'));
  let reads=0;
  await assert.rejects(prepareBooksBatch([order(),order()],async()=>{reads++;return [];}),code('BOOKS_INPUT_INVALID'));
  assert.equal(reads,0);
  const batch=await prepareBooksBatch([order()],async()=>[]);
  assert.equal(batch.rows.length,1);
  assert.equal(batch.totalMinor,'11800');
  assert.equal(batch.truncated,false);
});

test('posting days require a real timestamp and named shop time zone', () => {
  assert.equal(postingDay('2026-10-27T23:00:00Z','Asia/Kolkata'),'2026-10-28');
  assert.equal(postingDay('2026-10-27T01:00:00Z','America/Los_Angeles'),'2026-10-26');
  assert.throws(()=>postingDay('2026-02-30T10:00:00Z','Asia/Kolkata'),code('BOOKS_INPUT_INVALID'));
  assert.throws(()=>postingDay('2026-10-27T10:00:00','Asia/Kolkata'),code('BOOKS_INPUT_INVALID'));
  assert.throws(()=>postingDay('2026-10-27T10:00:00Z','Not/AZone'),code('BOOKS_INPUT_INVALID'));
});

test('books dry run keeps the source identity and lines that were actually looked up', async () => {
  const mutable=order();const expected=externalPostingId(mutable);
  const batch=await prepareBooksBatch([mutable],async ids=>{
    assert.ok(ids.includes(expected));mutable.orderId='changed-order';mutable.lines[0]!.itemId='changed-item';return [];
  });
  assert.equal(batch.rows[0]!.externalId,expected);
  assert.equal(batch.rows[0]!.orderId,'sale-a');
  assert.equal(batch.rows[0]!.lines[0]!.itemId,'item-1');
});

test('refund evidence must match the issued original, amount and remote identity', () => {
  const externalId=externalPostingId(order());
  const sale={externalId,id:'sale',status:'issued' as const,postingDate:'2026-10-28',document:'invoice' as const,originalId:null,totalMinor:'11800',recipientId:'77',materialDigest:null,financialDigest:booksFinancialDigest(decidePosting(order(),[]))};
  const refund={...sale,id:'refund',externalId:externalId+'-refund'};
  assert.equal(decidePosting(order({status:'cancelled'}),[sale,{...refund,status:'draft'}]).reason,'existing-refund-needs-review');
  assert.equal(decidePosting(order({status:'cancelled'}),[sale,{...refund,totalMinor:'1'}]).reason,'existing-refund-needs-review');
  assert.equal(decidePosting(order(),[refund]).reason,'refund-without-issued-original');
  assert.equal(decidePosting(order(),[sale,refund]).reason,'refunded-sale-needs-review');
  assert.throws(()=>decidePosting(order(),[sale,{...refund,id:'sale'}]),code('BOOKS_READ_FAILED'));
});

test('posting date rejects offset-only zones and normalized or unrepresentable calendar times', () => {
  for(const [stamp,zone] of [['2026-10-27T10:00:00Z','+05:30'],['0000-01-01T00:00:00Z','UTC'],['2026-10-27T24:00:00Z','UTC'],['9999-12-31T23:00:00Z','Asia/Kolkata'],['0001-01-01T00:00:00Z','America/Los_Angeles']]) {
    assert.throws(()=>postingDay(stamp!,zone!),code('BOOKS_INPUT_INVALID'));
  }
});

test('a same-total changed tax or item cannot reverse an original with unbound financial details',()=>{
 const externalId=externalPostingId(order());const original={externalId,id:'sale',status:'issued' as const,postingDate:'2026-10-28',document:'invoice' as const,originalId:null,totalMinor:'11800',recipientId:'77',materialDigest:null,financialDigest:null};
 const changed=order({status:'cancelled',taxMinor:'0',subtotalMinor:'10800',goodsMinor:'11800',lines:[{sku:'other',itemId:'new-item',amountMinor:'11800'}]});
 assert.equal(decidePosting(changed,[original]).action,'skip');
 assert.equal(decidePosting(changed,[original]).reason,'original-details-required');
 assert.equal(decidePosting(changed,[{...original,financialDigest:booksFinancialDigest(decidePosting(order(),[]))}]).reason,'original-details-differ');
});
