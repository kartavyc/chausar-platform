import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/money/index.ts';
import { code, owner, seedBlueprint, seedOrder, setup } from './venture-views-env.ts';
import { watchClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { apiConsentText, cliConsentText } from '../runtime/venture/models/presets.ts';
import { bindClientAiContext } from '../runtime/venture/clients/ai-context.ts';
import { ventureAction } from '../runtime/venture/records.ts';

test('retained desk permission refuses cancelled orders at capture and after an asynchronous boundary', async () => {
  const env = await setup(), { client, order } = await seedOrder(env, await seedBlueprint(env));
  const disclosure = await methods['venture.client.aiConsent.get'](env.deps, owner, { clientId: client.id });
  await methods['venture.client.aiConsent.agree'](env.deps, owner, { clientId: client.id, disclosureDigest: disclosure.disclosureDigest });
  const captured = bindClientAiContext(env.deps, owner, order.id);
  captured.assert();
  await ventureAction(env.deps, owner, 'approve', 'test.cancel-retained-desk-order', tx => {
    tx.replace({ ...tx.find('venture-order', order.id)!, status: 'cancelled' });
  });
  assert.throws(() => captured.assert(), code('JOB_SOURCE_CHANGED'));
  assert.throws(() => bindClientAiContext(env.deps, owner, order.id), code('JOB_SOURCE_CHANGED'));
});

test('connection disclosures distinguish client permission from exact outside-action approval',()=>{
  for(const words of [apiConsentText('OpenAI'),apiConsentText('Anthropic'),cliConsentText('Codex'),cliConsentText('Claude Code')]){
    assert.match(words,/separate permission.*each client/i);assert.match(words,/withdraw/i);
    assert.match(words,/outside actions still need approval/i);
    assert.doesNotMatch(words,/Real client work is shown to you first/);
  }
});

const methods = handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;
async function fixture() {
  const env = await setup();
  const { client } = await seedOrder(env, await seedBlueprint(env));
  const call = (action: string, payload: unknown = { clientId: client.id }, ctx = owner) => {
    const handler = methods[`venture.client.aiConsent.${action}`];
    assert.equal(typeof handler, 'function', `Client AI consent ${action} must be registered`);
    return handler(env.deps, ctx, payload);
  };
  return { env, client, call };
}

test('client data requires an explicit, recorded permission for that client', async () => {
  const { env, client, call } = await fixture();
  const before = await call('get');
  assert.equal(before.status, 'required');
  assert.equal(before.consent, null);
  assert.match(before.disclosure, /AI/);
  assert.match(before.disclosure, /cannot.*already shared/i);
  const agreed = await call('agree', { clientId: client.id, disclosureDigest: before.disclosureDigest });
  assert.equal(agreed.status, 'agreed');
  assert.equal(agreed.consent.grantedBy, owner.memberId);
  assert.equal(agreed.consent.grantedAt, env.now());
  assert.equal(agreed.consent.revision, 1);
  assert.equal(agreed.consent.withdrawnAt, null);
  assert.deepEqual((await call('get')).consent, agreed.consent);
});

test('consent is exact, client-bound, and refuses stale disclosures', async () => {
  const { env, client, call } = await fixture();
  const view = await call('get');
  await assert.rejects(call('agree', { clientId: client.id, disclosureDigest: 'stale' }), code('CLIENT_AI_CONSENT_CHANGED'));
  await assert.rejects(call('agree', { clientId: client.id, disclosureDigest: view.disclosureDigest, auto: true }), code('INVALID_VENTURE_REQUEST'));
  const second = await methods['venture.client.add'](env.deps, owner, { name: 'Second client' });
  await assert.rejects(call('agree', { clientId: second.id, disclosureDigest: view.disclosureDigest }), code('CLIENT_AI_CONSENT_CHANGED'));
  await assert.rejects(call('get', { clientId: 'missing' }), code('CLIENT_NOT_FOUND'));
  assert.equal((await call('get')).status, 'required');
});

test('neither tools nor client text can grant or withdraw permission', async () => {
  const { client, call } = await fixture();
  const view = await call('get');
  for (const ctx of [{ ...owner, channel: 'mcp' }, { ...owner, channel: 'phone' }, { ...owner, sourceTainted: true }] as Context[]) {
    await assert.rejects(call('agree', { clientId: client.id, disclosureDigest: view.disclosureDigest }, ctx), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(call('withdraw', { clientId: client.id }, ctx), code('APP_APPROVAL_REQUIRED'));
  }
  assert.equal((await call('get')).status, 'required');
});

test('withdrawal invalidates the old grant permanently, including after a new agreement', async () => {
  const { env, client, call } = await fixture();
  const before = await call('get');
  const first = await call('agree', { clientId: client.id, disclosureDigest: before.disclosureDigest });
  env.advance(1000);
  const withdrawn = await call('withdraw');
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(withdrawn.consent.revision, 2);
  assert.equal(withdrawn.consent.withdrawnAt, env.now());
  assert.deepEqual(await call('withdraw'), withdrawn);
  await assert.rejects(call('agree', { clientId: client.id, disclosureDigest: before.disclosureDigest }), code('CLIENT_AI_CONSENT_CHANGED'));
  const second = await call('agree', { clientId: client.id, disclosureDigest: withdrawn.disclosureDigest });
  assert.equal(second.status, 'agreed');
  assert.notEqual(second.consent.id, first.consent.id);
  assert.equal(second.consent.revision, 3);
});

test('withdrawal interrupts only this client’s live jobs after the withdrawal is stored', async () => {
  const { env, client, call } = await fixture();
  const before = await call('get');
  await call('agree', { clientId: client.id, disclosureDigest: before.disclosureDigest });
  const events: string[] = [];
  const stop = watchClientAiConsent(env.store, client.id, () => {
    const stored = env.store.read().conversations.find(row => row.id === client.id);
    assert.ok(stored.aiConsent.withdrawnAt);
    events.push('stopped');
  });
  const other = watchClientAiConsent(env.store, 'another-client', () => events.push('wrong'));
  try {
    await call('withdraw');
    assert.deepEqual(events, ['stopped']);
    stop();
    await call('withdraw');
    assert.deepEqual(events, ['stopped']);
  } finally { stop(); other(); }
});
