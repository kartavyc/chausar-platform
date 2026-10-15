import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneHost } from '../runtime/phone/host.ts';
import { PhoneRequestCustody } from '../runtime/phone/request-custody.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { PhoneCustodyRecord, PhoneCustodyStorage, PhoneHostAuthentication, PhoneHostPorts, PhoneHostPrincipal } from '../runtime/phone/host-contracts.ts';

const time = Date.parse('2026-10-02T12:00:00.000Z');
const code = (expected: string) => (error: unknown) => error instanceof PhoneError && error.code === expected;
function fixture() {
  const records: PhoneCustodyRecord[] = [];
  const storage: PhoneCustodyStorage = { transaction: async work => work(records) };
  let now = time, access = true, revision = 'scope:1', starts = 0, authCalls = 0;
  const principal: PhoneHostPrincipal = { channel: 'web', role: 'owner', authority: {
    binding: { workspaceId: 'synthetic', memberId: 'owner', deviceId: 'phone', epoch: 1 }, sessionId: 'phone_session',
    expiresAt: new Date(time + 3600000).toISOString(), validatedAt: new Date(time).toISOString(), capabilities: ['brief.read', 'chat', 'approval.simple'],
  } };
  const ports: PhoneHostPorts = {
    authenticate: async () => { authCalls++; return structuredClone(principal); },
    release: async () => { if (!access) throw new PhoneError('CAPABILITY_FORBIDDEN'); if (Date.parse(principal.authority.expiresAt) <= now) throw new PhoneError('SESSION_EXPIRED'); },
    briefs: async () => [{ id: 'brief', workspaceId: 'synthetic', version: 'v1', generatedAt: new Date(time).toISOString(), title: 'Synthetic brief', summary: 'Retained receipt', receiptIds: ['receipt'] }],
    receipt: async (_p, id) => ({ id, workspaceId: 'synthetic', text: 'Synthetic receipt' }),
    admit: async () => ({ revision, operationVersion: 'chat:1', sourceIds: ['source'] }),
    check: async (_p, record) => { if (!access) throw new PhoneError('CAPABILITY_FORBIDDEN'); if (revision !== record.scope.revision) throw new PhoneError('PREVIEW_CHANGED'); },
    start: async (_p, record) => { starts++; return { status: 'succeeded', requestId: record.identity.requestId, result: { conversationId: 'conversation', text: 'Synthetic 12345 INR minor units', receiptIds: ['receipt'] } }; },
    status: async (_p, record) => ({ status: 'unknown', requestId: record.identity.requestId }),
    cancel: async (_p, record) => ({ status: 'cancelled', requestId: record.identity.requestId }),
  };
  const host = new PhoneHost({ ports, custody: new PhoneRequestCustody(storage), clock: () => now });
  const authentication = (method: string, payload: unknown): PhoneHostAuthentication => ({
    bytes: new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, method, payload })), credential: 's'.repeat(64),
    proof: { deviceId: 'phone', keyId: 'key', timestamp: new Date(now).toISOString(), nonce: 'nonce', proof: 'synthetic-proof-checked-by-port' },
  });
  return { host, ports, principal, records, authentication, starts: () => starts, authCalls: () => authCalls,
    setAccess: (value: boolean) => { access = value; }, setRevision: (value: string) => { revision = value; }, advance: (ms: number) => { now += ms; } };
}

test('fixed host rejects arbitrary engine methods, upload, extra envelope fields and invalid proof clocks', async () => {
  const f = fixture();
  await assert.rejects(f.host.handle(f.authentication('actions.execute', {})), code('INVALID_REQUEST'));
  await assert.rejects(f.host.handle(f.authentication('upload.begin', {})), code('OPEN_DESKTOP'));
  const extra = f.authentication('session.validate', {});
  extra.bytes = new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, method: 'session.validate', payload: {}, principal: f.principal }));
  await assert.rejects(f.host.handle(extra), code('INVALID_REQUEST'));
  const stale = f.authentication('session.validate', {}); stale.proof.timestamp = new Date(time - 30001).toISOString();
  await assert.rejects(f.host.handle(stale), code('ACCESS_REVOKED'));
  const wrongDevice = f.authentication('session.validate', {}); wrongDevice.proof.deviceId = 'different';
  await assert.rejects(f.host.handle(wrongDevice), code('ACCESS_REVOKED'));
  const missing = f.authentication('session.validate', {}); delete missing.credential;
  await assert.rejects(f.host.handle(missing), code('UNPAIRED'));
  assert.equal(f.starts(), 0);
});

test('host admits one exact request and reconciles repetitions without calling start again', async () => {
  const f = fixture(), input = { requestId: 'request', question: 'Synthetic total?' };
  const first = await f.host.handle(f.authentication('chat.start', input));
  assert.equal(f.starts(), 1);
  assert.deepEqual(await f.host.handle(f.authentication('chat.start', input)), first);
  assert.deepEqual(await f.host.handle(f.authentication('request.status', { requestId: 'request' })), first);
  assert.deepEqual(await f.host.handle(f.authentication('request.cancel', { requestId: 'request' })), first);
  await assert.rejects(f.host.handle(f.authentication('chat.start', { ...input, question: 'Changed input' })), code('REQUEST_EXISTS'));
  assert.equal(f.starts(), 1);
  assert.equal(JSON.stringify(f.records).includes(input.question), false);
  assert.equal(JSON.stringify(f.records).includes('s'.repeat(64)), false);
  assert.deepEqual(await f.host.handle(f.authentication('request.list', {})), [{ requestId: 'request', kind: 'chat' }]);
});

test('retained results and identity discovery require current access and the admitted revision', async () => {
  const f = fixture(); await f.host.handle(f.authentication('chat.start', { requestId: 'request', question: 'Synthetic total?' }));
  f.setRevision('scope:2');
  for (const method of ['request.status', 'request.cancel']) await assert.rejects(f.host.handle(f.authentication(method, { requestId: 'request' })), code('PREVIEW_CHANGED'));
  await assert.rejects(f.host.handle(f.authentication('request.list', {})), code('PREVIEW_CHANGED'));
  f.setRevision('scope:1'); f.setAccess(false);
  await assert.rejects(f.host.handle(f.authentication('request.status', { requestId: 'request' })), code('CAPABILITY_FORBIDDEN'));
  assert.equal(f.starts(), 1);
});

test('session/channel/capability/role identity comes from the adapter and expiry forbids release', async () => {
  const f = fixture();
  f.principal.authority.capabilities = ['brief.read'];
  await assert.rejects(f.host.handle(f.authentication('chat.start', { requestId: 'request', question: 'Synthetic total?' })), code('CAPABILITY_FORBIDDEN'));
  f.principal.authority.capabilities = ['approval.simple']; f.principal.role = 'staff';
  await assert.rejects(f.host.handle(f.authentication('approval.list', {})), code('CAPABILITY_FORBIDDEN'));
  f.principal.channel = 'desktop' as never;
  await assert.rejects(f.host.handle(f.authentication('session.validate', {})), code('CHANNEL_FORBIDDEN'));
  f.principal.channel = 'web'; f.advance(3600000);
  await assert.rejects(f.host.handle(f.authentication('session.validate', {})), code('SESSION_EXPIRED'));
  assert.equal(f.starts(), 0);
});

test('malformed typed backend results never become retained success and cannot be replayed', async () => {
  const f = fixture(); let dispatches = 0;
  f.ports.start = async (_p, record) => { dispatches++; return { status: 'succeeded', requestId: record.identity.requestId, result: { conversationId: 'conversation', text: 'synthetic', receiptIds: ['receipt'], token: 'hidden' } } as never; };
  const input = { requestId: 'request', question: 'Synthetic total?' };
  await assert.rejects(f.host.handle(f.authentication('chat.start', input)), code('INVALID_RESPONSE'));
  assert.deepEqual(await f.host.handle(f.authentication('chat.start', input)), { status: 'unknown', requestId: 'request' });
  assert.equal(dispatches, 1); assert.equal(f.records[0].state.status, 'unknown');
});

test('final protected-read checkpoint refuses withdrawal during asynchronous projection', async () => {
  for (const method of ['brief.read', 'receipt.read']) {
    const f = fixture(); let complete!: () => void, projected!: () => void;
    const paused = new Promise<void>(resolve => { complete = resolve; });
    const started = new Promise<void>(resolve => { projected = resolve; });
    if (method === 'brief.read') { const original = f.ports.briefs; f.ports.briefs = async (...args) => { const result = await original(...args); projected(); await paused; return result; }; }
    else { const original = f.ports.receipt; f.ports.receipt = async (...args) => { const result = await original(...args); projected(); await paused; return result; }; }
    const read = f.host.handle(f.authentication(method, method === 'brief.read' ? { briefId: 'brief' } : { receiptId: 'receipt' }));
    await started; f.setAccess(false); complete();
    await assert.rejects(read, code('CAPABILITY_FORBIDDEN'));
  }
});

test('protected output and principal snapshots cannot change while final release is awaiting', async () => {
  const f = fixture();
  const sharedBriefs = await f.ports.briefs(f.principal);
  const sharedReceipt = await f.ports.receipt(f.principal, 'receipt');
  const sharedItems = [{ approvalId: 'approval', title: 'Exact original title' }];
  const sharedChallenge = { preview: { approvalId: 'approval', actionId: 'action', binding: structuredClone(f.principal.authority.binding), actionRevision: 1,
    operationVersion: 'note:1', digest: 'a'.repeat(64), expiresAt: new Date(time + 300000).toISOString(), title: 'Exact original title', summary: 'Exact original summary', eligibility: 'simple-reversible' as const }, token: 'b'.repeat(64) };
  f.ports.briefs = async () => sharedBriefs; f.ports.receipt = async () => sharedReceipt;
  f.ports.approvals = async () => sharedItems; f.ports.inspectApproval = async () => sharedChallenge;
  f.ports.release = async (principal, resource) => {
    principal.authority.binding.workspaceId = 'changed';
    if (resource.kind === 'brief') { sharedBriefs[0].summary = 'changed'; sharedBriefs[0].version = 'changed'; resource.briefs[0].version = 'changed'; }
    if (resource.kind === 'receipt') sharedReceipt.text = 'changed';
    if (resource.kind === 'approval-list') sharedItems[0].title = 'changed';
    if (resource.kind === 'approval') { sharedChallenge.preview.digest = 'c'.repeat(64); sharedChallenge.preview.summary = 'changed'; sharedChallenge.token = 'd'.repeat(64); resource.preview.actionRevision = 2; }
  };
  const originalBrief = structuredClone(sharedBriefs[0]);
  assert.deepEqual(await f.host.handle(f.authentication('brief.read', { briefId: 'brief' })), originalBrief);
  const originalReceipt = structuredClone(sharedReceipt);
  assert.deepEqual(await f.host.handle(f.authentication('receipt.read', { receiptId: 'receipt' })), originalReceipt);
  const originalItems = structuredClone(sharedItems);
  assert.deepEqual(await f.host.handle(f.authentication('approval.list', {})), originalItems);
  const originalChallenge = structuredClone(sharedChallenge);
  assert.deepEqual(await f.host.handle(f.authentication('approval.inspect', { approvalId: 'approval' })), originalChallenge);
  assert.equal(f.principal.authority.binding.workspaceId, 'synthetic');
});

test('identity listing has a final batch checkpoint for withdrawal of an earlier source', async () => {
  const f = fixture();
  for (const requestId of ['first', 'second']) await f.host.handle(f.authentication('chat.start', { requestId, question: 'Synthetic total?' }));
  let firstAllowed = true;
  f.ports.check = async (_principal, record) => { if (record.identity.requestId === 'second') firstAllowed = false; };
  f.ports.release = async (_principal, resource) => {
    if (resource.kind === 'requests' && resource.records.some(record => record.identity.requestId === 'first') && !firstAllowed) throw new PhoneError('CAPABILITY_FORBIDDEN');
  };
  await assert.rejects(f.host.handle(f.authentication('request.list', {})), code('CAPABILITY_FORBIDDEN'));
});

test('approval.list passes only a known eligibility hint through and refuses an unknown one', async () => {
  const f = fixture();
  f.ports.approvals = async () => [{ approvalId: 'note', title: 'Small note', eligibility: 'simple-reversible' }, { approvalId: 'money', title: 'Payment', eligibility: 'open-desktop' }, { approvalId: 'plain', title: 'No hint' }];
  assert.deepEqual(await f.host.handle(f.authentication('approval.list', {})), [{ approvalId: 'note', title: 'Small note', eligibility: 'simple-reversible' }, { approvalId: 'money', title: 'Payment', eligibility: 'open-desktop' }, { approvalId: 'plain', title: 'No hint' }]);
  f.ports.approvals = async () => [{ approvalId: 'note', title: 'Small note', eligibility: 'always' as never }];
  await assert.rejects(f.host.handle(f.authentication('approval.list', {})), code('INVALID_RESPONSE'));
  f.ports.approvals = async () => [{ approvalId: 'note', title: 'Small note', eligibility: 'simple-reversible', extra: 'never forwarded' } as never];
  assert.deepEqual(await f.host.handle(f.authentication('approval.list', {})), [{ approvalId: 'note', title: 'Small note', eligibility: 'simple-reversible' }]);
});
