import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deskContext } from '../runtime/venture/agent-runtime/desk-context.ts';
import { formsFixture } from './venture-forms-env.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { owner } from './venture-views-env.ts';
import type { DeliveryRunRecord } from '../runtime/venture/contracts.ts';

test('native forms context includes only current source-bound mapping evidence and changes its binding when mappings change', async () => {
  const { env, order, file, act } = await formsFixture();
  const entry: any = await act('prepare', { orderId: order.id, fileId: file.id, identityColumn: 'Record', rowIndex: 0 });
  const venture = listRecords(env.store.read(), 'venture-record')[0];
  const run = { ventureId: venture.id, orderId: order.id } as DeliveryRunRecord;
  const current = findRecord(env.store.read(), 'venture-order', order.id)!;
  const before = deskContext(env.store.read(), run, current, 'data-entry-desk');
  const rows = (before.data as any).formsEntries;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.Customer, 'Asha');
  assert.equal(JSON.stringify(rows).includes('Dev'), false);
  await ventureAction(env.deps, owner, 'approve', 'test.mapping', tx => {
    const row = tx.find('venture-entry-record', entry.id)!;
    tx.replace({ ...row, mapping: [{ column: 'Customer', name: 'name', value: 'Asha' }] });
  });
  assert.notEqual(deskContext(env.store.read(), run, current, 'data-entry-desk').binding, before.binding);
});
