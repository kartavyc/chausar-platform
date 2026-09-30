import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneError, sameBinding } from '../runtime/phone/contracts.ts';
import type { ApprovalChallenge, ApprovalDecision, DeviceBinding, PhoneChannel, PhoneCredentialStore, PhoneMethods, PhoneTransport } from '../runtime/phone/contracts.ts';
import { PhoneClient } from '../runtime/phone/client.ts';
import { MAX_PHONE_APPROVAL_TTL_MS, PhoneApprovalService, webCryptoApproval } from '../runtime/phone/approval.ts';
import type { ApprovalPrincipal, ApprovalSession, PhoneApprovalAction, PhoneApprovalConsumption, PhoneApprovalCrypto, PhoneApprovalLedger, PhoneApprovalRecord, PhoneApprovalTransaction } from '../runtime/phone/approval.ts';

const instant = Date.parse('2026-09-30T12:00:00.000Z');
const binding: DeviceBinding = { workspaceId: 'workspace_1', memberId: 'owner_1', deviceId: 'phone_1', epoch: 1 };
const code = (expected: string) => (error: unknown) => error instanceof PhoneError && error.code === expected;
function principal(channel: PhoneChannel | 'desktop', deviceId: string): ApprovalPrincipal {
  return { authority: { binding: { ...binding, deviceId }, sessionId: `session_${deviceId}`,
    expiresAt: new Date(instant + 60 * 60 * 1000).toISOString(), validatedAt: new Date(instant).toISOString(), capabilities: ['approval.simple'] },
    role: 'owner', channel, online: true, sourceTainted: false };
}
type LedgerState = {
  sessions: Record<string, ApprovalSession>;
  action: PhoneApprovalAction;
  challenges: Record<string, PhoneApprovalRecord>;
  receipts: Record<string, PhoneApprovalConsumption>;
  actionVisible: boolean;
};
/** Test adapter demonstrates serialization and rollback, not production persistence. */
class AtomicTestLedger implements PhoneApprovalLedger<string> {
  state: LedgerState = {
    sessions: { desktop: { status: 'current', principal: principal('desktop', 'desktop_1') },
      phone: { status: 'current', principal: principal('ios', 'phone_1') },
      forwarded: { status: 'current', principal: principal('android', 'phone_2') } },
    action: { actionId: 'action_1', workspaceId: 'workspace_1', actionRevision: 1, operationVersion: 'internal-note:1.0', digest: 'a'.repeat(64), computedDigest: 'a'.repeat(64),
      title: 'Update an internal note', summary: 'Change the workspace note to Reviewed.', status: 'prepared', impact: 'reversible', scope: 'workspace', simple: true, approvalAuthorized: true },
    challenges: {}, receipts: {}, actionVisible: true,
  };
  failDecision = false;
  private tail: Promise<void> = Promise.resolve();
  transaction<T>(work: (transaction: PhoneApprovalTransaction<string>) => T): Promise<T> {
    const result = this.tail.then(() => {
      const draft = structuredClone(this.state);
      const transaction: PhoneApprovalTransaction<string> = {
        session: context => draft.sessions[context] ?? { status: 'unpaired' },
        targetSession: target => {
          const session = draft.sessions.phone;
          return session.status !== 'current' || sameBinding(session.principal.authority.binding, target) ? session : { status: 'unpaired' };
        },
        action: (id, caller) => draft.actionVisible && draft.action.actionId === id && draft.action.workspaceId === caller.authority.binding.workspaceId ? draft.action : undefined,
        challenge: id => draft.challenges[id],
        insertChallenge: record => { assert.equal(draft.challenges[record.preview.approvalId], undefined); draft.challenges[record.preview.approvalId] = structuredClone(record); },
        commitDecision: consumption => {
          const record = draft.challenges[consumption.approvalId];
          if (record.consumed) throw new PhoneError('APPROVAL_USED');
          if (Object.values(draft.receipts).some(result => result.requestId === consumption.requestId)) throw new PhoneError('REQUEST_EXISTS');
          assert.equal(draft.action.status, 'prepared');
          record.consumed = true;
          draft.action.status = consumption.receipt.decision;
          draft.receipts[consumption.approvalId] = structuredClone(consumption);
          if (this.failDecision) throw new Error('Injected durable commit failure');
        },
        receipt: id => draft.receipts[id],
      };
      const value = work(transaction);
      this.state = draft;
      return value;
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  principal(context = 'phone'): ApprovalPrincipal {
    const session = this.state.sessions[context];
    assert.equal(session.status, 'current');
    return (session as Extract<ApprovalSession, { status: 'current' }>).principal;
  }
}
function fixture(crypto?: PhoneApprovalCrypto) {
  const ledger = new AtomicTestLedger();
  let time = instant;
  const service = new PhoneApprovalService(ledger, { crypto, now: () => time });
  return { ledger, service, advance: (milliseconds: number) => { time += milliseconds; },
    issue: (ttlMs?: number) => service.issue('desktop', binding, 'action_1', ttlMs) };
}
function decision(challenge: ApprovalChallenge, requestId = 'request_1'): ApprovalDecision {
  assert.ok(challenge.token);
  return { requestId, approvalId: challenge.preview.approvalId, token: challenge.token, decision: 'approve',
    expectedDigest: challenge.preview.digest, expectedActionRevision: challenge.preview.actionRevision, expectedOperationVersion: challenge.preview.operationVersion };
}
function unused(ledger: AtomicTestLedger, challenge: ApprovalChallenge) {
  assert.equal(ledger.state.challenges[challenge.preview.approvalId].consumed, false);
  assert.equal(Object.keys(ledger.state.receipts).length, 0);
}

test('approval issue persists only a hash, bounds expiry, and does not share mutable previews', async () => {
  const f = fixture();
  const challenge = await f.issue();
  assert.equal(Date.parse(challenge.preview.expiresAt) - instant, MAX_PHONE_APPROVAL_TTL_MS);
  assert.equal(challenge.token?.length, 64);
  const stored = f.ledger.state.challenges[challenge.preview.approvalId];
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.tokenHash, challenge.token);
  assert.equal(JSON.stringify(f.ledger.state).includes(challenge.token!), false);
  challenge.preview.binding.deviceId = 'mutated';
  challenge.preview.digest = 'b'.repeat(64);
  assert.equal(stored.preview.binding.deviceId, binding.deviceId);
  assert.equal(stored.preview.digest, 'a'.repeat(64));
  assert.equal(f.ledger.state.action.status, 'prepared');
  await assert.rejects(f.issue(MAX_PHONE_APPROVAL_TTL_MS + 1), code('INVALID_REQUEST'));
  await assert.rejects(f.issue(0), code('INVALID_REQUEST'));
});

test('approval, token consumption and exact durable receipt commit together without execution', async () => {
  const f = fixture(); const challenge = await f.issue();
  const result = await f.service.decide('phone', decision(challenge));
  assert.equal(result.decision, 'approved');
  assert.equal(f.ledger.state.action.status, 'approved');
  assert.equal(f.ledger.state.challenges[result.approvalId].consumed, true);
  assert.deepEqual(await f.service.receipt('phone', result.approvalId), result);
  assert.deepEqual(f.ledger.state.receipts[result.approvalId], {
    requestId: 'request_1', approvalId: result.approvalId, binding, sessionId: 'session_phone_1',
    actionRevision: 1, operationVersion: 'internal-note:1.0', digest: 'a'.repeat(64), receipt: result,
  });
});

test('concurrent approve/reject taps consume a challenge exactly once', async () => {
  const f = fixture(); const challenge = await f.issue();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => f.service.decide('phone', {
    ...decision(challenge, `request_${i}`), decision: i % 2 ? 'reject' : 'approve',
  })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const refused = results.filter(result => result.status === 'rejected');
  assert.equal(refused.length, 19);
  for (const result of refused) assert.ok(code('APPROVAL_USED')(result.reason));
  assert.equal(Object.keys(f.ledger.state.receipts).length, 1);
});

test('rejection also consumes the token and persists a rejection receipt', async () => {
  const f = fixture(); const challenge = await f.issue();
  const request = { ...decision(challenge), decision: 'reject' as const };
  const receipt = await f.service.decide('phone', request);
  assert.equal(receipt.decision, 'rejected');
  assert.equal(f.ledger.state.action.status, 'rejected');
  assert.equal(f.ledger.state.challenges[receipt.approvalId].consumed, true);
  await assert.rejects(f.service.decide('phone', { ...request, requestId: 'another_request' }), code('APPROVAL_USED'));
});

test('durability failure rolls back both token consumption and the action decision', async () => {
  const f = fixture(); const challenge = await f.issue();
  f.ledger.failDecision = true;
  await assert.rejects(f.service.decide('phone', decision(challenge)), /Injected durable commit failure/);
  unused(f.ledger, challenge);
  assert.equal(f.ledger.state.action.status, 'prepared');
  f.ledger.failDecision = false;
  assert.equal((await f.service.decide('phone', decision(challenge))).decision, 'approved');
});

test('live action revision, digest and operation catalogue version changes require a new preview', async () => {
  for (const change of [
    (action: PhoneApprovalAction) => { action.actionRevision++; },
    (action: PhoneApprovalAction) => { action.digest = 'b'.repeat(64); },
    (action: PhoneApprovalAction) => { action.computedDigest = 'b'.repeat(64); },
    (action: PhoneApprovalAction) => { action.operationVersion = 'internal-note:2.0'; },
    (action: PhoneApprovalAction) => { action.status = 'cancelled'; },
  ]) {
    const f = fixture(); const challenge = await f.issue(); change(f.ledger.state.action);
    await assert.rejects(f.service.decide('phone', decision(challenge)), code('PREVIEW_CHANGED'));
    unused(f.ledger, challenge);
  }
});

test('the submitted digest, revision and operation version must exactly match the shown preview', async () => {
  for (const change of [
    { expectedDigest: 'b'.repeat(64) }, { expectedActionRevision: 2 }, { expectedOperationVersion: 'internal-note:2.0' },
  ]) {
    const f = fixture(); const challenge = await f.issue();
    await assert.rejects(f.service.decide('phone', { ...decision(challenge), ...change }), code('PREVIEW_CHANGED'));
    unused(f.ledger, challenge);
  }
});

test('live permission withdrawal and loss of read access deny decisions and receipt reads', async () => {
  for (const withdraw of [
    (ledger: AtomicTestLedger) => { ledger.state.action.approvalAuthorized = false; },
    (ledger: AtomicTestLedger) => { ledger.state.actionVisible = false; },
    (ledger: AtomicTestLedger) => { ledger.principal().authority.capabilities = []; },
    (ledger: AtomicTestLedger) => { ledger.principal().role = 'staff'; },
    (ledger: AtomicTestLedger) => { ledger.principal().sourceTainted = true; },
  ]) {
    const f = fixture(); const challenge = await f.issue(); withdraw(f.ledger);
    await assert.rejects(f.service.decide('phone', decision(challenge)), code('CAPABILITY_FORBIDDEN'));
    await assert.rejects(f.service.receipt('phone', challenge.preview.approvalId), code('CAPABILITY_FORBIDDEN'));
    unused(f.ledger, challenge);
  }
});

test('revoked, expired, unpaired or offline sessions cannot use a cached challenge', async () => {
  for (const status of ['revoked', 'expired', 'unpaired'] as const) {
    const f = fixture(); const challenge = await f.issue(); f.ledger.state.sessions.phone = { status };
    await assert.rejects(f.service.decide('phone', decision(challenge)), code(status === 'revoked' ? 'ACCESS_REVOKED' : status === 'expired' ? 'SESSION_EXPIRED' : 'UNPAIRED'));
    unused(f.ledger, challenge);
  }
  const f = fixture(); const challenge = await f.issue(); f.ledger.principal().online = false;
  await assert.rejects(f.service.decide('phone', decision(challenge)), code('VALIDATION_REQUIRED'));
  unused(f.ledger, challenge);
});

test('session expiry is checked live even if the adapter incorrectly reports current', async () => {
  const f = fixture(); const challenge = await f.issue();
  f.ledger.principal().authority.expiresAt = new Date(instant).toISOString();
  await assert.rejects(f.service.decide('phone', decision(challenge)), code('SESSION_EXPIRED'));
  unused(f.ledger, challenge);
});

test('challenge expiration includes the exact boundary and is capped by session expiry', async () => {
  const f = fixture(); const challenge = await f.issue(1_000); f.advance(1_000);
  await assert.rejects(f.service.decide('phone', decision(challenge)), code('APPROVAL_EXPIRED')); unused(f.ledger, challenge);
  const shorter = fixture(); shorter.ledger.principal().authority.expiresAt = new Date(instant + 500).toISOString();
  assert.equal((await shorter.issue()).preview.expiresAt, new Date(instant + 500).toISOString());
});

test('forwarded tokens cannot be used by another device, workspace, member, epoch or refreshed session', async () => {
  for (const change of [
    (caller: ApprovalPrincipal) => { caller.authority.binding.deviceId = 'phone_2'; },
    (caller: ApprovalPrincipal) => { caller.authority.binding.workspaceId = 'workspace_2'; },
    (caller: ApprovalPrincipal) => { caller.authority.binding.memberId = 'owner_2'; },
    (caller: ApprovalPrincipal) => { caller.authority.binding.epoch++; },
    (caller: ApprovalPrincipal) => { caller.authority.sessionId = 'refreshed_session'; },
  ]) {
    const f = fixture(); const challenge = await f.issue();
    const original = structuredClone(f.ledger.principal()); change(f.ledger.principal());
    await assert.rejects(f.service.decide('phone', decision(challenge)), code('CAPABILITY_FORBIDDEN'));
    unused(f.ledger, challenge);
    f.ledger.state.sessions.phone = { status: 'current', principal: original };
    assert.equal((await f.service.decide('phone', decision(challenge))).decision, 'approved');
  }
});

test('an invalid forwarded token does not consume the real owner challenge', async () => {
  const f = fixture(); const challenge = await f.issue();
  await assert.rejects(f.service.decide('forwarded', decision(challenge)), code('CAPABILITY_FORBIDDEN'));
  await assert.rejects(f.service.decide('phone', { ...decision(challenge), token: '0'.repeat(64) }), code('INVALID_REQUEST'));
  unused(f.ledger, challenge);
  assert.equal((await f.service.decide('phone', decision(challenge))).decision, 'approved');
});

test('money, messages outside the workspace, destructive and complex actions open desktop without a token', async () => {
  for (const change of [
    { impact: 'money' as const }, { impact: 'message' as const }, { impact: 'destructive' as const },
    { scope: 'outside-workspace' as const }, { simple: false },
  ]) {
    const f = fixture(); Object.assign(f.ledger.state.action, change);
    const challenge = await f.issue();
    assert.equal(challenge.preview.eligibility, 'open-desktop');
    assert.equal(challenge.token, undefined);
    assert.equal(Object.keys(f.ledger.state.challenges).length, 0);
    assert.equal(Object.keys(f.ledger.state.receipts).length, 0);
  }
});

test('changed live eligibility blocks an old token for both approval and rejection', async () => {
  for (const change of [{ impact: 'money' as const }, { scope: 'outside-workspace' as const }, { simple: false }]) {
    const f = fixture(); const challenge = await f.issue(); Object.assign(f.ledger.state.action, change);
    await assert.rejects(f.service.decide('phone', decision(challenge)), code('OPEN_DESKTOP'));
    await assert.rejects(f.service.decide('phone', { ...decision(challenge), decision: 'reject' }), code('OPEN_DESKTOP'));
    unused(f.ledger, challenge);
  }
});

test('only the trusted current desktop owner can issue to their own current paired companion', async () => {
  const f = fixture();
  await assert.rejects(f.service.issue('phone', binding, 'action_1'), code('CHANNEL_FORBIDDEN'));
  await assert.rejects(f.service.issue('desktop', { ...binding, memberId: 'someone_else' }, 'action_1'), code('CAPABILITY_FORBIDDEN'));
  await assert.rejects(f.service.issue('desktop', { ...binding, workspaceId: 'elsewhere' }, 'action_1'), code('CAPABILITY_FORBIDDEN'));
  await assert.rejects(f.service.issue('desktop', { ...binding, epoch: 2 }, 'action_1'), code('CAPABILITY_FORBIDDEN'));
  f.ledger.principal('desktop').role = 'staff';
  await assert.rejects(f.issue(), code('CAPABILITY_FORBIDDEN'));
  f.ledger.principal('desktop').role = 'owner';
  f.ledger.state.sessions.phone = { status: 'revoked' };
  await assert.rejects(f.issue(), code('ACCESS_REVOKED'));
  assert.equal(Object.keys(f.ledger.state.challenges).length, 0);
});

test('all five authenticated companion channels support the same simple internal decision', async () => {
  for (const channel of ['ios', 'android', 'web', 'whatsapp', 'email'] as const) {
    const f = fixture(); f.ledger.principal().channel = channel;
    const challenge = await f.issue();
    assert.equal((await f.service.decide('phone', decision(challenge))).decision, 'approved');
  }
});

test('multiple challenges cannot approve the same prepared action twice', async () => {
  const f = fixture(); const first = await f.issue(); const second = await f.issue();
  await f.service.decide('phone', decision(first));
  await assert.rejects(f.service.decide('phone', decision(second, 'request_2')), code('PREVIEW_CHANGED'));
  assert.equal(f.ledger.state.challenges[second.preview.approvalId].consumed, false);
  assert.equal(Object.keys(f.ledger.state.receipts).length, 1);
});

test('fresh online receipt lookup recovers a lost decision response without another approval', async () => {
  const f = fixture(); const challenge = await f.issue();
  assert.equal(await f.service.receipt('phone', challenge.preview.approvalId), undefined);
  await f.service.decide('phone', decision(challenge));
  f.advance(MAX_PHONE_APPROVAL_TTL_MS + 1);
  assert.equal((await f.service.receipt('phone', challenge.preview.approvalId))?.decision, 'approved');
  f.ledger.state.sessions.phone = { status: 'revoked' };
  await assert.rejects(f.service.receipt('phone', challenge.preview.approvalId), code('ACCESS_REVOKED'));
});

test('revocation during asynchronous hashing is checked in the eventual atomic transaction', async () => {
  const f = fixture(); const challenge = await f.issue();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const crypto: PhoneApprovalCrypto = { randomBytes: webCryptoApproval.randomBytes,
    sha256: async bytes => { await blocked; return webCryptoApproval.sha256(bytes); } };
  const service = new PhoneApprovalService(f.ledger, { crypto, now: () => instant });
  const pending = service.decide('phone', decision(challenge));
  f.ledger.state.sessions.phone = { status: 'revoked' }; release();
  await assert.rejects(pending, code('ACCESS_REVOKED')); unused(f.ledger, challenge);
});

test('request mutation during asynchronous hashing cannot change an approval tap into rejection', async () => {
  const f = fixture(); const challenge = await f.issue();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const crypto: PhoneApprovalCrypto = { randomBytes: webCryptoApproval.randomBytes,
    sha256: async bytes => { await blocked; return webCryptoApproval.sha256(bytes); } };
  const service = new PhoneApprovalService(f.ledger, { crypto, now: () => instant });
  const request = decision(challenge); const pending = service.decide('phone', request);
  request.decision = 'reject'; request.expectedActionRevision = 999; release();
  assert.equal((await pending).decision, 'approved');
});

test('phone client consumes the service challenge and recovers a lost response without resubmitting', async () => {
  for (const loseResponse of [false, true]) {
    const f = fixture();
    f.ledger.state.action.summary = 'S'.repeat(16_000);
    let delivery: ApprovalChallenge | undefined = await f.issue();
    const approvalId = delivery.preview.approvalId;
    const calls: (keyof PhoneMethods)[] = [];
    const credential = 'synthetic-test-credential-not-a-real-secret';
    const credentials: PhoneCredentialStore = {
      load: async () => ({ authority: structuredClone(f.ledger.principal().authority), credential }),
      save: async () => {}, clear: async () => {},
    };
    const transport: PhoneTransport = {
      async request<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], options: { credential?: string; signal: AbortSignal }): Promise<PhoneMethods[M]['output']> {
        assert.equal(options.credential, credential);
        calls.push(method);
        let output: unknown;
        if (method === 'session.validate') output = { status: 'current', authority: structuredClone(f.ledger.principal().authority) };
        else if (method === 'approval.inspect') {
          assert.ok(delivery);
          assert.equal((input as PhoneMethods['approval.inspect']['input']).approvalId, approvalId);
          output = delivery; delivery = undefined;
        } else if (method === 'approval.submit') {
          const request = input as ApprovalDecision;
          const result = await f.service.decide('phone', request);
          if (loseResponse) throw new Error('Simulated lost response after durable decision');
          output = { status: 'succeeded', requestId: request.requestId, result };
        } else if (method === 'request.status') {
          const request = input as PhoneMethods['request.status']['input'];
          output = { status: 'succeeded', requestId: request.requestId, result: await f.service.receipt('phone', approvalId) };
        } else throw new Error('Unexpected fixture method');
        return output as PhoneMethods[M]['output'];
      },
    };
    const client = new PhoneClient({ channel: 'ios', transport, credentials, clock: () => instant,
      cache: { put: async () => {}, read: async () => undefined, clear: async () => {} } });
    await client.restore(); await client.reconnect();
    const preview = await client.inspectApproval(approvalId);
    assert.equal(preview.operationVersion, 'internal-note:1.0');
    assert.equal(preview.summary.length, 16_000);
    assert.equal('token' in preview, false);
    if (loseResponse) {
      await assert.rejects(client.decideApproval('request_1', approvalId, 'reject'), code('TRANSPORT_UNKNOWN'));
      assert.equal(client.snapshot().requests[0].status, 'unknown');
      client.disconnect(); await client.reconnect();
      const state = client.snapshot().requests[0];
      assert.equal(state.status, 'succeeded');
      assert.equal(state.status === 'succeeded' && 'decision' in state.result && state.result.decision, 'rejected');
    } else {
      const state = await client.decideApproval('request_1', approvalId, 'approve');
      assert.equal(state.status, 'succeeded');
      assert.equal(state.status === 'succeeded' && state.result.decision, 'approved');
    }
    assert.equal(calls.filter(method => method === 'approval.submit').length, 1);
    assert.equal(Object.keys(f.ledger.state.receipts).length, 1);
  }
});
