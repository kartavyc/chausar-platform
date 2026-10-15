import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { ActionService, Connector } from '../runtime/actions.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// WK-02 against core-gateway-auth's real secondAsk.status / secondAsk.grant and the money gate on actions.approve.
// Synthetic only: a money connector that never runs, a local vault in a temp directory, no network.
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const passphrase = 'Synthetic work queue passphrase 42';
const op = (impact: 'money' | 'reversible') => ({
  title: 'Pay a supplier', description: 'Synthetic payment; never executed here.', impact, idempotency: 'One key names one payment.', readback: 'Reads the payment by key.',
  validate: (payload: any) => payload, execute: async () => ({ businessSuccess: true }), reconcile: async () => ({ verified: true, businessSuccess: true }),
});
const connector = (): Connector => ({ id: 'synthetic-pay', title: 'Synthetic payments', operations: { pay: op('money') } as any });

async function workspace(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-second-ask-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock) });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await rm(directory, { recursive: true, force: true }); });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Work Queue Shop', passphrase, demo: false, pack: 'services' });
  (engine.services.actions as ActionService).registry.set('synthetic-pay', connector());
  const rpc = (method: string, payload: Record<string, unknown> = {}, as: Context = owner) => engine.requestAs(as, method, payload);
  const prepare = (key: string, as: Context = owner) => rpc('actions.prepare', { connector: 'synthetic-pay', operation: 'pay', payload: { amountMinor: '250000', to: 'Synthetic supplier' }, idempotencyKey: key }, as);
  return { engine, rpc, prepare };
}
const statusOf = (f: { engine: Engine }, id: string) => (f.engine.vault!.read().actions as any[]).find(a => a.id === id)?.status;

test('WK-02 through the real engine: the owner answers the second ask with the passphrase, once, for exactly this money action', async t => {
  const f = await workspace(t);
  const pay = await f.prepare('work-pay-1');
  const id = `action:${pay.id}`;
  const sheet = await f.rpc('approvals.get', { id });
  assert.deepEqual(sheet.secondAsk, { by: 'passphrase', whose: 'vault-passphrase' });
  await assert.rejects(f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true }), code('REAUTH_REQUIRED'));
  await assert.rejects(f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: 'not the passphrase' }), code('SECOND_ASK_FAILED'));
  assert.equal(statusOf(f, pay.id), 'prepared', 'a wrong answer approves nothing');
  const approved = await f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: passphrase });
  assert.equal(statusOf(f, pay.id), 'approved');
  assert.ok(approved);
  const events = f.engine.vault!.read().activity.filter((a: any) => a.event === 'secondAsk.granted');
  assert.deepEqual(events.map((e: any) => e.details), [{ kind: 'action', actionId: pay.id, digest: pay.digest, memberId: 'owner' }]);
  assert.doesNotMatch(JSON.stringify(f.engine.vault!.read()), /Synthetic work queue passphrase|not the passphrase/);
});

test('WK-02 through the real engine: a cofounder without an approval secret is told to set one; with it they answer with their own', async t => {
  const f = await workspace(t);
  await f.rpc('members.add', { name: 'Synthetic accountant', role: 'accountant', branches: ['*'] });
  const added = await f.rpc('members.add', { name: 'Synthetic cofounder', role: 'cofounder', branches: ['*'] });
  const cofounder: Context = { memberId: added.id, role: 'cofounder', epoch: added.epoch, channel: 'desktop' };
  const pay = await f.prepare('work-pay-cofounder', cofounder);
  const id = `action:${pay.id}`;
  const unset = await f.rpc('approvals.get', { id }, cofounder);
  assert.equal(unset.secondAsk.setFirst, true);
  await assert.rejects(f.rpc('approvals.approve', { id, digest: unset.digest, secondAsk: true, reauth: 'anything at all' }, cofounder), code('APPROVAL_SECRET_NOT_SET'));
  await f.rpc('secondAsk.setSecret', { secret: 'cofounder approval words' }, cofounder);
  const sheet = await f.rpc('approvals.get', { id }, cofounder);
  assert.deepEqual(sheet.secondAsk, { by: 'passphrase', whose: 'own-secret' });
  await assert.rejects(f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: passphrase }, cofounder), code('SECOND_ASK_FAILED'), 'the owner passphrase is not the cofounder’s answer');
  await f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: 'cofounder approval words' }, cofounder);
  assert.equal(statusOf(f, pay.id), 'approved');
});

test('WK-02 through the real engine: after repeated wrong answers the sheet shows the lock and nothing is asked', async t => {
  const f = await workspace(t);
  const pay = await f.prepare('work-pay-locked');
  const id = `action:${pay.id}`;
  const sheet = await f.rpc('approvals.get', { id });
  for (let n = 0; n < 5; n++) await assert.rejects(f.rpc('approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: `guess ${n}` }), code('SECOND_ASK_FAILED'));
  const locked = await f.rpc('approvals.get', { id });
  assert.ok(Date.parse(locked.secondAsk.lockedUntil) > Date.now());
  await assert.rejects(f.rpc('approvals.approve', { id, digest: locked.digest, secondAsk: true, reauth: passphrase }), code('SECOND_ASK_LOCKED'));
  assert.equal(statusOf(f, pay.id), 'prepared');
});
