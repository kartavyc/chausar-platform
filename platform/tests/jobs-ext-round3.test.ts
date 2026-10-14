import test from 'node:test';
import assert from 'node:assert/strict';
import { availability } from '../runtime/jobs-ext/proposals.ts';
import { prepareReminder } from '../runtime/jobs-ext/adapters.ts';
import { template, type JobTemplate } from '../runtime/jobs-ext/templates.ts';
import { DAY, owner, csv, fixture } from './jobs-ext-fixture.ts';

// Synthetic fixtures and stub hosts only.

test('a template whose method is not registered stays "not built", whatever the base contains', async () => {
  const missing: JobTemplate = { ...template('gst-matching'), requires: { operations: [], method: 'nowhere.notBuilt' } };
  const host: any = { services: { ontology: { current: () => ({ operations: [] }) } }, options: {}, demo: true };
  assert.deepEqual(await availability(host, owner, missing), { available: false, code: 'TEMPLATE_NOT_BUILT', reason: 'This job needs a part of Chausar that is not built yet.' });
});

test('an agent-touched reminder reaches writeback with the outside-text mark on the call’s context; a clean one has none', async () => {
  const calls: { method: string; payload: any; options?: any }[] = [];
  const host: any = { services: { actions: { prepare: async () => ({ id: 'local-draft-id' }) } },
    call: async (method: string, payload: any, options?: any) => { calls.push({ method, payload, options });
      if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'sandbox', write: ['smtp.send'] }];
      if (method === 'writeback.followUp.prepare') return { id: `wb-${calls.length}`, status: 'prepared' };
      throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' }); } };
  const request = { invoiceId: 'INV-1', customerId: 'cust-1', text: 'Synthetic', channel: 'mail' as const, idempotencyKey: 'synthetic-key-1', sourceIds: ['s'] };
  const tainted = await prepareReminder(host, { ...owner, sourceTainted: true }, request);
  const clean = await prepareReminder(host, owner, request);
  const prepares = calls.filter(c => c.method === 'writeback.followUp.prepare');
  assert.deepEqual(prepares[0].options, { tainted: true }); assert.equal(prepares[1].options, undefined);
  // writeback's reminder payload is a strict record: the mark travels on the context, never as an extra field.
  assert.deepEqual(Object.keys(prepares[0].payload).sort(), ['connectionId', 'customerId', 'invoiceId', 'sourceIds']);
  assert.equal(tainted.prepared && tainted.via, 'writeback'); assert.equal(clean.prepared && clean.via, 'writeback');
  // writeback's own refusals are rules: the case is blocked with the reason, not a failed step.
  host.call = async (method: string) => { if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'live', write: ['smtp.send'] }]; throw Object.assign(new Error('x'), { code: 'FOLLOW_UP_NO_CONSENT' }); };
  assert.deepEqual(await prepareReminder(host, owner, request), { prepared: false, reason: 'no-agreement' });
  // Without a send-granted connection, a local draft is prepared and nothing is sent.
  host.call = async (method: string) => { if (method === 'writeback.connections') return [{ id: 'conn-mail', system: 'mail', environment: 'live', write: [] }]; throw Object.assign(new Error('x'), { code: 'UNKNOWN_METHOD' }); };
  assert.deepEqual(await prepareReminder(host, owner, request), { prepared: true, actionId: 'local-draft-id', via: 'local-draft' });
});

test('GST matching runs against the connectors lane, then waits for a person to file', async t => {
  const { ui, engine, clock } = await fixture(t);
  await ui('trust.update', { autonomy: true });
  const purchases = (sourceId: string, invoice: string) => { const file: any = csv([{ id: `p-${sourceId}`, kind: 'purchase', date: '2026-09-10', amount: '500.00', customer: '27AAPFU0939F1ZV', invoice }], sourceId);
    file.recipe.allowedKinds = ['purchase']; return file; };
  await ui('sources.import', purchases('synthetic-register', 'PUR-1')); await ui('sources.import', purchases('synthetic-gstr2b', 'PUR-1'));
  await assert.rejects(ui('jobsx.propose', { template: 'gst-matching' }), { code: 'GST_SOURCES_REQUIRED' });
  const card = await ui('jobsx.propose', { template: 'gst-matching', overrides: { gstSources: { registerSourceId: 'synthetic-register', gstr2bSourceId: 'synthetic-gstr2b' } } });
  const { job } = await ui('jobsx.approveProposal', { id: card.id, digest: card.digest });
  clock.now += DAY; await engine.tick();
  const view = await ui('jobsx.get', { id: job.id });
  assert.equal(view.state, 'waiting-for-you', 'filing is a step for a person');
  const step = view.waitingForYou.find((w: any) => w.kind === 'person-step');
  await ui('jobsx.personStep.done', { id: step.id }); await engine.tick();
  const result = await ui('jobsx.result', { id: job.id });
  assert.equal(result.done[0], '1 purchase lines match GSTR-2B. 0 differ in amount, 0 are in your books only, 0 are in GSTR-2B only, 0 are probable matches for you to confirm and 0 were set aside.');
  assert.equal(result.status, 'awaiting-acceptance');
});
