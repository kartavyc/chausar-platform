// Fake bookkeeping privacy and refusal behavior, after finance-skills (MIT ideas).
import { expect, it } from 'vitest';
import { fakeBookkeepingCfoDesk } from '../../src/engine/fake-bookkeeping-cfo';
import type { W4DeskHost } from '../../src/engine/fake-w4';

const csv = 'kind,id,invoice,debtor,on,dueOn,amount,state\ninvoice,buyer-a,INV-A,Buyer,2026-10-01,2026-10-10,100,open';
it('Forget physically erases client-source promise words even if a client is added again', () => {
  let clients = [{ id: 'client_a', name: 'Client A' }];
  const host: W4DeskHost = { current: () => 'one', now: () => '2026-10-27T10:00:00Z', emit: () => undefined, hosted: () => false, rows: () => [], setRows: () => undefined, digest: value => JSON.stringify(value), ask: method => method === 'venture.client.list' ? clients : method === 'venture.order.list' ? [{ id: 'order_a', clientId: 'client_a', status: 'open' }] : [], orderFiles: () => [{ id: 'file_a', name: 'collections.csv', format: 'csv', digest: 'source', contentBase64: btoa(csv) }] };
  const desk = fakeBookkeepingCfoDesk(host);
  desk.kinds.promise!.act!({ playbook: 'bookkeeping-cfo', kind: 'promise', id: 'new', action: 'record', payload: { clientId: 'client_a', serviceOrderId: 'order_a', sourceName: 'collections.csv', invoiceIds: ['buyer-a'], amountRupees: '100', promisedOn: '2026-11-01', method: 'bank-transfer', statedBy: 'Private contact words' } });
  expect((desk.kinds.promise!.list!({ playbook: 'bookkeeping-cfo', kind: 'promise' }) as any).rows).toHaveLength(1);
  desk.forgetPeople?.([{ id: 'person_a', clientId: 'client_a', names: ['Private contact'], emails: [], phones: [] }], true);
  clients = []; desk.kinds.promise!.list!({ playbook: 'bookkeeping-cfo', kind: 'promise' });
  clients = [{ id: 'client_a', name: 'Client A' }];
  expect((desk.kinds.promise!.list!({ playbook: 'bookkeeping-cfo', kind: 'promise' }) as any).rows).toHaveLength(0);
});
it('public fake collections uses only source debtor payments, including later same-name snapshots', async () => {
  const { FakeEngine, createFakeClient } = await import('../../src/engine/fake');
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T10:00:00Z' }));
  const order = (await client.request('venture.order.list', {}))[0]!;
  const upload = (text: string) => client.request('venture.files.add', { orderId: order.id, name: 'collections.csv', contentBase64: btoa(text) });
  await upload(csv);
  const ledger = await client.request('venture.desk.list', { playbook: 'bookkeeping-cfo', kind: 'ledger' });
  expect((ledger.rows[0] as any).invoiceId).toBe('buyer-a');
  await client.request('venture.desk.act', { playbook: 'bookkeeping-cfo', kind: 'promise', id: 'new', action: 'record', payload: { clientId: order.clientId, serviceOrderId: order.id, sourceName: 'collections.csv', invoiceIds: ['buyer-a'], amountRupees: '100', promisedOn: '2026-10-28', method: 'UPI', statedBy: 'Client contact' } });
  await upload(csv+'\npayment,receipt-1,buyer-a,Buyer,2026-10-27,,40,cleared');
  expect(((await client.request('venture.desk.list', { playbook: 'bookkeeping-cfo', kind: 'promise' })).rows[0] as any).status).toBe('pending');
  await upload(csv+'\npayment,receipt-1,buyer-a,Buyer,2026-10-27,,40,cleared\npayment,receipt-2,buyer-a,Buyer,2026-10-27,,60,cleared');
  expect(((await client.request('venture.desk.list', { playbook: 'bookkeeping-cfo', kind: 'promise' })).rows[0] as any).status).toBe('kept');
});
it('internal order files keep source bytes scoped, with no content in public metadata', async () => {
  const { FakeWorkDesk } = await import('../../src/engine/fake-work');
  const plan = { blueprint: {  backOffice: {currency:'INR',taxRegistered:{value:false}}, offers: [{ id: 'service', name: { value: 'Books' }, pricing: { unitPriceMinor: '100', defaultQuantity: '1' } }] }, offerReceipts: {}, intake: {} } as any;
  const desk = new FakeWorkDesk({ current: () => 'business', now: () => '2026-10-27T10:00:00Z', clients: () => [{ id: 'client', name: 'Shop' }] as any, country:()=>({code:'IN',currency:'INR'}), plan: () => plan, runs: () => [], agentName: () => 'Bookkeeper', emit: () => {}, fingerprint: value => value }, { fresh: true });
  const order = desk.request('venture.order.create', { clientId: 'client', offerId: 'service', request: 'Monthly records' }) as any;
  const contentBase64 = btoa('id,amount\nprivate-customer,100');
  desk.request('venture.files.add', { orderId: order.id, name: 'collections.csv', contentBase64 });
  expect(desk.orderFiles('business', order.id)[0]?.contentBase64).toBe(contentBase64);
  expect(desk.orderFiles('other-business', order.id)).toEqual([]);
  expect(desk.orderFiles('business', 'other-order')).toEqual([]);
  expect(JSON.stringify(desk.request('venture.files.list', { orderId: order.id }))).not.toContain('contentBase64');
});

it('broken promises from separate debtors do not escalate each other in the fake desk', async () => {
  const { FakeEngine, createFakeClient } = await import('../../src/engine/fake');
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-15T10:00:00Z' }));
  const order = (await client.request('venture.order.list', {}))[0]!;
  const source = 'kind,id,invoice,debtor,on,dueOn,amount,state\ninvoice,a,INV-A,Buyer A,2026-10-01,2026-10-14,100,open\ninvoice,b,INV-B,Buyer B,2026-10-01,2026-10-14,100,open';
  await client.request('venture.files.add', { orderId: order.id, name: 'collections.csv', contentBase64: btoa(source) });
  for (const invoiceId of ['a', 'b']) await client.request('venture.desk.act', { playbook: 'bookkeeping-cfo', kind: 'promise', id: 'new', action: 'record', payload: { clientId: order.clientId, serviceOrderId: order.id, sourceName: 'collections.csv', invoiceIds: [invoiceId], amountRupees: '100', promisedOn: '2026-10-14', method: 'UPI', statedBy: 'Client contact' } });
  const rows = (await client.request('venture.desk.list', { playbook: 'bookkeeping-cfo', kind: 'promise' })).rows as any[];
  expect(rows.map(row => row.stage)).toEqual(['reminder', 'reminder']);
});
