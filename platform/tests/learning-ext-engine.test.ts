import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';

const passphrase = 'Synthetic learning lane passphrase 2026';
async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-learning-ext-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Learning Shop', passphrase, demo: true, pack: 'ecommerce', folder: 'main' });
  await engine.request('ontology.publish', { pack: 'ecommerce' });
  await engine.request('sources.import', { sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  return engine;
}

test('the learning loop runs through the engine dispatch: log, accounts, recipes, sharing and withdraw', async t => {
  const engine = await fixture(t);
  const log = await engine.request('learningx.log', {});
  assert.equal(log.total, 1); assert.equal(log.items[0].event.kind, 'mapping');
  const set = await engine.request('learningx.accountsPropose', { accounts: [{ id: 'a1', name: 'Sales GST 18%', parentGroup: 'Sales Accounts', sourceId: 'demo-export' }, { id: 'a2', name: 'HDFC Current', parentGroup: 'Bank Accounts', sourceId: 'demo-export' }] });
  await engine.request('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'accepted' }, { accountId: 'a2', choice: 'corrected', accountClass: 'loans' }] });
  const proposal = await engine.request('learningx.recipePropose', { fields: ['id', 'kind', 'date', 'amount', 'currency'], scope: { company: 'Synthetic', branches: ['main'] }, system: 'canonical' });
  assert.equal(proposal.valid, true);
  assert.equal((await engine.request('learningx.summary', {})).total, 4);
  await engine.request('learning.sharing', { enabled: true });
  const preview = await engine.request('learningx.preview', {});
  for (const secret of ['HDFC', 'Sales GST', 'demo-export', 'cust-1', '18']) assert.equal(preview.bytes.includes(secret), false, secret);
  const consent = await engine.request('learningx.consent', { previewId: preview.id, digest: preview.digest });
  const batch = await engine.request('learningx.submit', { consentId: consent.id });
  assert.deepEqual([batch.mode, batch.status, batch.count], ['test-inbox', 'sent', 4]);
  const withdrawn = await engine.request('learningx.withdraw', {});
  assert.equal(withdrawn.sharing, false);
  await assert.rejects(engine.request('learningx.preview', { boxes: ['question-shapes'] }), (error: any) => error.code === 'BOX_NOT_OPEN');
  // Deleting the source removes every decision derived from it.
  await engine.request('sources.delete', { id: 'demo-export' });
  const after = await engine.request('learningx.log', {});
  assert.deepEqual(after.items.map((item: any) => item.event.reason), ['library-match']);
  assert.deepEqual((await engine.request('learningx.accountsList', {})).sets, []);
});
