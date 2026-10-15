import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFakeEngine, registerFakeMethods } from '../src/bridge/fake.ts';
import { HOSTED_RECOVERY_PRE_VAULT, hostedRecoveryFixture } from '../src/bridge/fixtures/hosted-recovery.ts';
import {
  HOSTED_RECOVERY, HOSTED_RECOVERY_REFUSALS, isRecoveryCheckReply, isRecoveryCompleteReply, isRecoveryRequestReply,
} from '../src/bridge/hosted-recovery-contract.ts';
import { checkRecovery, completeRecovery, recoveryRefusalKey, startRecovery } from '../src/screens/first-run/recovery-contact.ts';
import { words } from '../src/text/lanes/frame-today.ts';

const ID = 'rcr_00000000-0000-4000-8000-000000000001';
const AT = '2026-09-30T06:15:00.000Z';
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('the hosted reply validators take the contract shapes and nothing else', () => {
  assert.ok(isRecoveryRequestReply({ requestId: ID, status: 'waiting', expiresAt: AT, contactChannel: 'mail' }));
  assert.ok(isRecoveryRequestReply({ requestId: ID, status: 'waiting', expiresAt: AT, contactChannel: 'whatsapp' }));
  for (const bad of [null, [], { requestId: ID, status: 'confirmed', expiresAt: AT, contactChannel: 'mail' }, { requestId: 'x', status: 'waiting', expiresAt: AT, contactChannel: 'mail' },
    { requestId: ID, status: 'waiting', expiresAt: 'soon', contactChannel: 'mail' }, { requestId: ID, status: 'waiting', expiresAt: AT, contactChannel: 'sms' },
    { requestId: ID, status: 'waiting', expiresAt: AT, contactChannel: 'mail', key: 'x' }]) assert.equal(isRecoveryRequestReply(bad), false, JSON.stringify(bad));
  for (const status of ['waiting', 'confirmed', 'declined', 'expired', 'failed', 'released', 'recovering', 'recovered']) assert.ok(isRecoveryCheckReply({ requestId: ID, status }, ID), status);
  assert.ok(isRecoveryCheckReply({ requestId: ID, status: 'confirmed', expiresAt: AT, failure: 'RECOVERY_CODE_REJECTED' }, ID));
  assert.equal(isRecoveryCheckReply({ requestId: ID, status: 'waiting' }, 'rcr_00000000-0000-4000-8000-000000000002'), false);
  assert.equal(isRecoveryCheckReply({ requestId: ID, status: 'open' }, ID), false);
  assert.equal(isRecoveryCheckReply({ requestId: ID, status: 'confirmed', failure: 'not a code' }, ID), false);
  assert.ok(isRecoveryCompleteReply({ requestId: ID, status: 'recovering' }, ID));
  assert.ok(isRecoveryCompleteReply({ requestId: ID, status: 'recovered' }, ID));
  assert.equal(isRecoveryCompleteReply({ requestId: ID, status: 'confirmed' }, ID), false);
});

test('the fixture walks the statuses before the vault is open, and only when registered', async () => {
  const engine = createFakeEngine({ scenario: 'locked' });
  assert.ok(!engine.methods().includes(HOSTED_RECOVERY.request));
  const fallback = await startRecovery(engine, 'main');
  assert.deepEqual(fallback, { kind: 'fallback', failure: { kind: 'refused', code: 'RECOVERY_CONTACT_RELAY_REQUIRED' } });

  const fixture = hostedRecoveryFixture({ waitingChecks: 1 });
  const done = registerFakeMethods('hosted', fixture.handlers);
  try {
    for (const method of HOSTED_RECOVERY_PRE_VAULT) assert.ok(engine.methods().includes(method), method);
    const started = await startRecovery(engine, 'main');
    assert.equal(started.kind, 'waiting');
    const seen: string[] = [];
    const step = async () => { const checked = await checkRecovery(engine, ID, 'main'); seen.push(checked.kind === 'status' ? checked.reply.status : checked.kind); };
    await step(); await step();
    assert.deepEqual(await completeRecovery(engine, ID, 'main', 'short'), { kind: 'refused', code: 'WEAK_PASSPHRASE' });
    assert.equal((await completeRecovery(engine, ID, 'main', 'synthetic-new-passphrase')).kind, 'started');
    await step(); await step(); await step();
    assert.deepEqual(seen, ['waiting', 'confirmed', 'busy', 'recovering', 'recovered']);
    assert.equal(fixture.completions(), 1);
    assert.deepEqual(await checkRecovery(engine, 'rcr_00000000-0000-4000-8000-000000000009', 'main'), { kind: 'refused', code: 'RECOVERY_REQUEST_NOT_FOUND' });
  } finally { done(); }
});

test('every refusal the screen names has words in both languages and is on frame-today\'s refusal line', () => {
  const preload = readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  const lines = preload.split('\n');
  const own = lines.find(text => text.includes('/* frame-today */')) ?? '', base = lines.find(text => text.includes("['UNKNOWN_METHOD',")) ?? '';
  for (const code of HOSTED_RECOVERY_REFUSALS) {
    assert.ok(own.includes(`'${code}'`) || base.includes(`'${code}'`), code);
    const key = recoveryRefusalKey(code);
    assert.ok(words.en[key] && words.hi[key], key);
  }
  assert.equal(recoveryRefusalKey('SOMETHING_ELSE'), 'FR-13.contact.refused');
  const methods: string[] = json('../../desktop/module-methods/hosted-link.json');
  for (const method of HOSTED_RECOVERY_PRE_VAULT) assert.ok(methods.includes(method), method);
  for (const key of Object.keys(words.en).filter(item => item.startsWith('FR-13.contact.'))) assert.ok(words.hi[key], key);
});
