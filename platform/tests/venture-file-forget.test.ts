// Ink v2 wave 4, package 4J8 (DPDP, the file drop): a call that carried a file the owner dropped keeps the file's text in
// its record ("What was sent"). Forget reaches it there: when a forgotten person's name is in that text, the text is
// erased, the call's digest, costs and times kept (network/forget.ts calls core/attachment.ts eraseFileCallsNaming).
// Other calls, and file calls that name no one forgotten, stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelCallRecord } from '../runtime/venture/contracts.ts';
import { ERASED_FILE_CALL } from '../runtime/venture/core/attachment.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { owner, setup } from './venture-views-env.ts';
import { CONTACTS, net, personNamed } from './venture-network-env.ts';

test('file drop: Forget erases the text of a file call that names the person, and leaves the rest', async () => {
  const env = await setup();
  await net(env, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: CONTACTS });
  const asha = personNamed(env, 'Asha Rao');
  const call = (purpose: string, containsClientData: boolean, payloadText: string) => ({
    kind: 'venture-model-call', purpose, tier: 'main', presetId: 'anthropic-sonnet-5-5', connectionId: null, routeKind: 'anthropic-messages', model: 'claude-sonnet-5-5',
    consent: containsClientData ? 'approved-preview' : 'standing', endpoint: 'https://api.anthropic.com/v1/messages', payloadText, payloadDigest: 'd'.repeat(64), payloadTruncated: false,
    containsClientData, status: 'completed', approvedDigest: null, approvedAt: null, approvedBy: null, estimatedMaxCostMicros: '100', priceConfirmed: true,
    usage: null, costMicros: '100', outputDigest: null, error: null, replay: true,
  });
  const ids = await ventureAction(env.deps, owner, 'admin', 'seed.calls', tx => [
    tx.put({ ...tx.base('venture-model-call'), ...call('plan-suggest', true, 'file: Asha Rao runs the shop next door') } as unknown as ModelCallRecord).id,
    tx.put({ ...tx.base('venture-model-call'), ...call('compose', true, 'file: notes about the walks only') } as unknown as ModelCallRecord).id,
    tx.put({ ...tx.base('venture-model-call'), ...call('chief-fit', false, 'ways and kinds only') } as unknown as ModelCallRecord).id,
  ]);
  await net(env, 'venture.network.forget', { id: asha.id });
  const after = new Map(listRecords(env.store.read(), 'venture-model-call').map(item => [item.id, item]));
  const named = after.get(ids[0])!;
  assert.equal(named.payloadText, ERASED_FILE_CALL);
  assert.ok(named.erasedAt);
  assert.deepEqual([named.payloadDigest, named.costMicros], ['d'.repeat(64), '100'], 'its digest and cost stay');
  assert.equal(after.get(ids[1])!.payloadText, 'file: notes about the walks only', 'a file call that names no one forgotten stays');
  assert.equal(after.get(ids[2])!.payloadText, 'ways and kinds only');
  assert.ok(!JSON.stringify(env.store.read().conversations).includes('Asha Rao runs the shop'));
});
