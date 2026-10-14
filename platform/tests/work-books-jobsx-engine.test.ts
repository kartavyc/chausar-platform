import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

// Through the real engine with the merged jobs-ext lane: a job from one sentence is a proposal in
// the one queue; approving it starts a lane job that Work lists and opens. Synthetic data only.
test('a sentence proposal from jobs-ext joins the queue, is approved by its digest and becomes a listed lane job', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-jobsx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Proposal Shop', passphrase: 'Synthetic proposal passphrase 2026', demo: true, pack: 'ecommerce', folder: 'main' });
  assert.deepEqual((await engine.request('approvals.jobTemplates', {})).fromSentence, { available: true });
  const proposed = await engine.request('approvals.proposeJob', { sentence: 'Tell me every Monday who owes me money.' });
  assert.match(proposed.id, /^proposal:/); assert.equal(proposed.id, `proposal:${proposed.proposal.id}`);
  const row = (await engine.request('approvals.list', {})).items.find((i: any) => i.id === proposed.id);
  assert.ok(row); assert.equal(row.source, 'proposal'); assert.equal(row.tier, 'tier-2'); assert.equal(row.state, 'prepared');
  const sheet = await engine.request('approvals.get', { id: proposed.id });
  await assert.rejects(engine.request('approvals.approve', { id: proposed.id, digest: '0'.repeat(64) }), (e: any) => e.code === 'PREVIEW_CHANGED');
  const approved = await engine.request('approvals.approve', { id: proposed.id, digest: sheet.digest, ...(sheet.needsSecondAsk ? { secondAsk: true } : {}) });
  assert.equal(approved.state, 'verified');
  const jobs = await engine.request('approvals.jobs', {});
  assert.equal(jobs.items.length, 1); assert.deepEqual(jobs.proposals, { available: true, items: [] });
  const card = await engine.request('approvals.job', { id: jobs.items[0].id });
  assert.equal(card.id, jobs.items[0].id); assert.ok('budget' in card && 'minor' in card.budget);
  await assert.rejects(engine.request('records.optIn', { customerId: 'nobody' }), (e: any) => e.code === 'RECORD_NOT_FOUND');
});
