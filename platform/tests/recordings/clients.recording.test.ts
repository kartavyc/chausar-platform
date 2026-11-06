import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

// Permission is tied to this client's disclosure and can be withdrawn immediately.
test('Clients records adding, editing and granting then withdrawing AI consent', async t => {
  await recordScenario(t, 'clients', async ({ rpc }) => {
    assert.deepEqual(await rpc.request('venture.client.list', {}), []);
    const client = await rpc.request('venture.client.add', { name: 'Sample Studio', countryCode: 'IN' });
    const list = await rpc.request('venture.client.list', {});
    assert.equal(list.length, 1);
    const before = await rpc.request('venture.client.aiConsent.get', { clientId: client.id });
    assert.equal(before.status, 'required');
    const agreed = await rpc.request('venture.client.aiConsent.agree', { clientId: client.id, disclosureDigest: before.disclosureDigest });
    assert.equal(agreed.status, 'agreed');
    await rpc.request('venture.crm.client.edit', { clientId: client.id, field: 'note', value: 'Send a short monthly report.' });
    await rpc.request('venture.crm.client', { clientId: client.id });
    const withdrawn = await rpc.request('venture.client.aiConsent.withdraw', { clientId: client.id });
    assert.equal(withdrawn.status, 'withdrawn');
    await rpc.request('venture.client.aiConsent.get', { clientId: client.id });
    await rpc.request('venture.client.list', {});
  });
});
