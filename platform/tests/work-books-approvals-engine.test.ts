import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

test('the real engine routes approvals.* over a prepared local reminder draft, end to end', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-approvals-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Approvals Shop', passphrase: 'Synthetic approvals passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  const prepared = await engine.request('actions.prepare', { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-a', text: 'Your invoice is due on Friday.' }, idempotencyKey: 'reminder-invoice-a-2026-10' });
  const id = `action:${prepared.id}`;

  const list = await engine.request('approvals.list', {});
  assert.deepEqual(list.items.map((i: any) => i.id), [id]);
  assert.equal(list.items[0].tier, 'tier-1'); assert.equal(list.items[0].kind, 'record-change'); assert.equal(list.items[0].title, 'Create a payment reminder draft');
  assert.equal(list.items[0].touches, 'Chausar local workspace: invoice-a');
  assert.deepEqual(list.counts, { tier2: 0, tier1: 1, prepareOnly: 0 }); assert.deepEqual(list.expired, []);

  const sheet = await engine.request('approvals.get', { id });
  assert.equal(sheet.digest, prepared.digest); assert.equal(sheet.reason, 'autonomy-off'); assert.equal(sheet.needsSecondAsk, false);
  assert.deepEqual(sheet.can, ['approve', 'notNow', 'change', 'drop']); assert.equal(sheet.steps.length, 5);
  assert.equal(typeof (await engine.request('approvals.catalogue', {})).writeback.available, 'boolean');

  await assert.rejects(engine.request('approvals.approve', { id, digest: '0'.repeat(64) }), code('PREVIEW_CHANGED'));
  const approved = await engine.request('approvals.approve', { id, digest: sheet.digest });
  assert.equal(approved.state, 'approved');
  const done = await engine.request('approvals.execute', { id });
  assert.equal(done.state, 'verified'); assert.deepEqual(done.steps.map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.ok(done.readBack.every((r: any) => r.same)); assert.equal(done.channel, 'desktop');
  await assert.rejects(engine.request('approvals.execute', { id }), code('ACTION_ALREADY_ATTEMPTED'));

  const ledger = await engine.request('approvals.ledger', {});
  assert.deepEqual(ledger.items.map((i: any) => [i.id, i.state]), [[id, 'verified']]);
  assert.equal((await engine.request('approvals.list', {})).items.length, 0);
  assert.equal((await engine.request('approvals.afterRestore', {})).sendingClosed, false);
  // Practice on a core local action: whatever the installed write-back lane answers, nothing is sent.
  const practice = await engine.request('approvals.practice', { id }).catch((error: any) => ({ refused: error.code }));
  assert.ok(practice.refused || practice.practice === true);
  assert.equal(typeof (await engine.request('approvals.jobs', {})).proposals.available, 'boolean');
});
