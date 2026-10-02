import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { EnginePhoneRuntime, StateStorePhoneCustodyStorage } from '../runtime/engine-phone-runtime.ts';
import type { EnginePhoneRuntimePorts, EnginePhoneSessions, ReviewedPhoneConversationRequest } from '../runtime/engine-phone-runtime.ts';
import { PhoneError, requirePhone } from '../runtime/phone/contracts.ts';
import type { ChatAnswer, PhoneCapability } from '../runtime/phone/contracts.ts';
import type { PhoneHostPrincipal } from '../runtime/phone/host-contracts.ts';
import { Vault } from '../runtime/vault.ts';

function gate() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
/** Synthetic StateStore/session/provider ports only; no production authentication or inference claim. */
class MemoryStore implements StateStore {
  state = initialState('Phone runtime fixture');
  private tail: Promise<unknown> = Promise.resolve();
  afterCommit?: (state: State) => Promise<void> | void;
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const committed = this.tail.then(async () => { const draft = this.read(), result = await change(draft);
      draft.revision++; this.state = structuredClone(draft); return result; });
    this.tail = committed.catch(() => undefined);
    return committed.then(async value => { await this.afterCommit?.(this.read()); return value; });
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const baseTime = Date.parse('2026-10-02T10:00:00.000Z');
const request: ReviewedPhoneConversationRequest = { question: 'What was billed in September?', purpose: 'conversation',
  questionDisclosure: 'verbatim', routeId: 'route_1', previewId: 'preview_1', approvalId: 'approval_1',
  sourceIds: ['source_1'], period: { from: '2026-09-01', to: '2026-09-30' } };
const chat: ChatAnswer = { conversationId: 'conversation_1', text: 'Retained guarded fixture answer.', receiptIds: ['receipt_1'] };
const code = (expected: string) => (error: any) => error instanceof PhoneError && error.code === expected;

async function fixture(store: StateStore = new MemoryStore(), initialize = true) {
  let clock = baseTime, calls = 0, nonce = 0;
  const principal = (): PhoneHostPrincipal => ({ channel: 'web', role: 'owner', authority: {
    binding: { workspaceId: store.read().workspace.id, memberId: 'owner', deviceId: 'device_1', epoch: 1 },
    sessionId: 'session_1', expiresAt: new Date(baseTime + 3600000).toISOString(), validatedAt: new Date(clock).toISOString(),
    capabilities: ['chat', 'brief.read', 'approval.simple'] } });
  const stateOf = (current: State | StateStore) => 'read' in current ? current.read() : current;
  const sessions: EnginePhoneSessions = {
    async authenticate() { await store.update(state => { state.sessions.push({ kind: 'synthetic-auth-nonce', id: `nonce_${++nonce}` }); }); return principal(); },
    async pair() { throw new PhoneError('OPEN_DESKTOP'); },
    assertPrincipal(value, current, capability?: PhoneCapability) {
      const state = stateOf(current), member = state.members.find(row => row.id === value.authority.binding.memberId);
      requirePhone(member?.active && member.epoch === value.authority.binding.epoch && member.role === 'owner'
        && value.authority.sessionId === 'session_1' && value.authority.binding.workspaceId === state.workspace.id, 'ACCESS_REVOKED');
      requirePhone(Date.parse(value.authority.expiresAt) > clock, 'SESSION_EXPIRED');
      requirePhone(!capability || value.authority.capabilities.includes(capability), 'CAPABILITY_FORBIDDEN');
      return { ...owner, channel: 'phone' };
    },
    target(ctx, sessionId) { requirePhone(ctx.memberId === 'owner' && sessionId === 'session_1', 'ACCESS_REVOKED'); return principal(); },
    async revoke() { await store.update(state => { state.members[0].epoch++; }); },
  };
  const commit = async () => store.update(state => {
    state.modelReceipts.find(row => row.id === request.previewId).status = 'completed';
    state.modelReceipts.find(row => row.id === request.approvalId).used = true;
    state.conversations.push({ id: chat.conversationId, kind: 'conversation-tools-answer', memberId: 'owner', epoch: 1,
      modelReceiptId: request.previewId, question: request.question, answer: structuredClone(chat) });
  });
  const ports: EnginePhoneRuntimePorts = {
    review(ctx, value, current) {
      const state = current.read(), preview = state.modelReceipts.find(row => row.id === value.previewId);
      requirePhone(preview && preview.memberId === ctx.memberId && preview.naturalQuestion === value.question
        && value.questionDisclosure === 'verbatim', 'PREVIEW_CHANGED');
      return { sourceIds: ['source_1'], operationVersion: 'conversation:fixture-v1' };
    },
    async executeConversation(_ctx, value) { calls++; assert.deepEqual(value, request); await commit(); return { ignoredUnqualifiedResult: true }; },
    reconcileConversation(ctx, previewId, current) {
      const row = current.read().conversations.find(item => item.kind === 'conversation-tools-answer'
        && item.modelReceiptId === previewId && item.memberId === ctx.memberId && item.question === request.question);
      return row?.answer;
    },
    briefs(_ctx, current) { const state = current.read(); return [{ id: 'brief_1', workspaceId: state.workspace.id,
      version: 'version_1', generatedAt: new Date(baseTime).toISOString(), title: 'Fixture brief', summary: 'Fixture summary', receiptIds: ['receipt_1'] }]; },
    receipt(_ctx, id, current) { const state = current.read(), receipt = state.receipts.find(row => row.id === id);
      requirePhone(receipt, 'ACCESS_REVOKED'); return { id, workspaceId: state.workspace.id, text: receipt.text }; },
  };
  if (initialize) await store.update(state => {
    state.policy.send = 'shape';
    state.facts.push({ id: 'fact_1', entityId: 'invoice_1', sourceId: 'source_1', sourceRow: 1, kind: 'invoice',
      validFrom: '2026-09-01', validTo: null, learnedAt: new Date(baseTime).toISOString(), supersededAt: null, fields: { amountMinor: '10000' } });
    state.imports.push({ id: 'import_1', sourceId: 'source_1', reconciled: true });
    state.receipts.push({ id: 'receipt_1', sourceIds: ['source_1'], rowIds: ['fact_1'], rows: [], text: 'Fixture receipt' });
    state.routes.push({ id: 'route_1', revision: 1, enabled: true, costConsumedMinor: '0' });
    state.modelReceipts.push({ id: request.previewId, kind: 'model-preview', status: 'preview', purpose: 'conversation',
      memberId: 'owner', epoch: 1, naturalQuestion: request.question, questionHash: hash(request.question),
      routeId: request.routeId, endpoint: 'https://fixture.invalid', digest: hash('exact fixture payload'), payload: 'exact fixture payload' },
    { id: request.approvalId, kind: 'outbound-approval', previewId: request.previewId, approverId: 'owner', approverEpoch: 1,
      routeId: request.routeId, endpoint: 'https://fixture.invalid', digest: hash('exact fixture payload'), used: false,
      expiresAt: new Date(baseTime + 300000).toISOString() });
  });
  let runtime = new EnginePhoneRuntime(store, sessions, ports, { clock: () => clock });
  const rpc = (method: string, payload: unknown) => runtime.host.handle({
    bytes: Buffer.from(JSON.stringify({ protocolVersion: 1, method, payload })), credential: 'x'.repeat(64),
    proof: { deviceId: 'device_1', keyId: 'key_1', timestamp: new Date(clock).toISOString(), nonce: `request_nonce_${++nonce}`, proof: 'synthetic-proof' } });
  return { store, sessions, ports, commit, rpc, principal, offer: () => runtime.offer(owner, { sessionId: 'session_1', request }),
    runtime: () => runtime, calls: () => calls, tick: (ms: number) => { clock += ms; },
    reopen: () => { runtime = new EnginePhoneRuntime(store, sessions, ports, { clock: () => clock }); } };
}

test('phone text alone cannot send; approval/upload remain desktop-only', async () => {
  const f = await fixture();
  await assert.rejects(f.rpc('chat.start', { requestId: 'request_1', question: request.question }), code('OPEN_DESKTOP'));
  await assert.rejects(f.rpc('approval.list', {}), code('OPEN_DESKTOP'));
  await assert.rejects(f.rpc('upload.begin', {}), code('OPEN_DESKTOP'));
  assert.equal(f.calls(), 0);
});

test('different transport IDs and runtime reopen recover one reviewed preview; nonce revisions do not stale it', async () => {
  const f = await fixture(); await f.offer();
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'request_1', question: request.question }), { status: 'succeeded', requestId: 'request_1', result: chat });
  f.reopen();
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'request_2', question: request.question }), { status: 'succeeded', requestId: 'request_2', result: chat });
  assert.equal(f.calls(), 1);
  const before = f.store.read().revision; await f.runtime().custody.list(f.principal().authority);
  assert.equal(f.store.read().revision, before, 'Read-only custody must not commit a revision.');
  f.tick(300001);
  assert.deepEqual(await f.rpc('request.status', { requestId: 'request_1' }), { status: 'succeeded', requestId: 'request_1', result: chat });
  assert.equal(f.calls(), 1, 'Expired transfer approval is not permission to send again or discard guarded history.');
});

test('crash after durable intent but before callback never replays across transport IDs', async () => {
  const store = new MemoryStore(), f = await fixture(store); await f.offer();
  let crash = true;
  store.afterCommit = state => { if (crash && state.conversations.some(row => row.kind === 'engine-phone-runtime' && row.intents.length)) {
    crash = false; throw Error('Simulated crash after intent commit'); } };
  await assert.rejects(f.rpc('chat.start', { requestId: 'request_1', question: request.question }));
  store.afterCommit = undefined; f.reopen();
  assert.deepEqual(await f.rpc('request.status', { requestId: 'request_1' }), { status: 'unknown', requestId: 'request_1' });
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'request_2', question: request.question }), { status: 'unknown', requestId: 'request_2' });
  assert.equal(f.calls(), 0);
});

test('cancellation commits a tombstone before effect admission', async () => {
  const store = new MemoryStore(), f = await fixture(store); await f.offer();
  const paused = gate(), resume = gate(); let once = true;
  store.afterCommit = async state => { const container = state.conversations.find(row => row.kind === 'engine-phone-runtime');
    if (once && container?.records.length && !container.intents.length) { once = false; paused.resolve(); await resume.promise; } };
  const started = f.rpc('chat.start', { requestId: 'request_1', question: request.question }); await paused.promise;
  assert.deepEqual(await f.rpc('request.cancel', { requestId: 'request_1' }), { status: 'cancelled', requestId: 'request_1' });
  resume.resolve();
  assert.deepEqual(await started, { status: 'cancelled', requestId: 'request_1' }); assert.equal(f.calls(), 0);
});

test('in-flight cancellation retains unknown; exact committed history wins despite a lost effect response', async () => {
  const f = await fixture(); await f.offer(); const dispatched = gate(), resume = gate(); let executions = 0;
  f.ports.executeConversation = async () => { executions++; dispatched.resolve(); await resume.promise;
    await f.commit(); throw Error('Simulated lost committed response'); };
  const started = f.rpc('chat.start', { requestId: 'request_1', question: request.question }); await dispatched.promise;
  assert.deepEqual(await f.rpc('request.cancel', { requestId: 'request_1' }), { status: 'unknown', requestId: 'request_1' });
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'request_2', question: request.question }), { status: 'unknown', requestId: 'request_2' });
  resume.resolve();
  assert.deepEqual(await started, { status: 'succeeded', requestId: 'request_1', result: chat });
  assert.deepEqual(await f.rpc('request.status', { requestId: 'request_2' }), { status: 'succeeded', requestId: 'request_2', result: chat });
  assert.equal(executions, 1);
});

test('exact reviewed payload and selected source mutations refuse before execution', async () => {
  for (const mutate of [
    (state: State) => { state.modelReceipts[0].payload = 'changed payload'; },
    (state: State) => { state.facts[0].fields.amountMinor = '20000'; },
    (state: State) => { state.sourceRules.push({ sourceId: 'source_1', revoked: true }); },
  ]) {
    const f = await fixture(); await f.offer(); await f.store.update(mutate);
    await assert.rejects(f.rpc('chat.start', { requestId: 'request_1', question: request.question })); assert.equal(f.calls(), 0);
  }
});

test('paused receipt projection and each release callback fence original provenance even when text stays equal', async () => {
  for (const pauseCall of [1, 2, 3]) {
    const f = await fixture(), paused = gate(), resume = gate(), original = f.ports.receipt; let calls = 0;
    f.ports.receipt = async (...args) => { const projected = await original(...args); if (++calls === pauseCall) { paused.resolve(); await resume.promise; } return projected; };
    const reading = f.rpc('receipt.read', { receiptId: 'receipt_1' }); await paused.promise;
    await f.store.update(state => { state.facts[0].fields.amountMinor = '20000'; }); resume.resolve();
    await assert.rejects(reading, code('PREVIEW_CHANGED'));
  }
});

test('concurrent receipt read tickets cannot overwrite another request original projection', async () => {
  const f = await fixture(), paused = gate(), resume = gate(), original = f.ports.receipt; let first = true;
  f.ports.receipt = async (...args) => { const projected = await original(...args); if (first) { first = false; paused.resolve(); await resume.promise; } return projected; };
  const old = f.rpc('receipt.read', { receiptId: 'receipt_1' }); await paused.promise;
  await f.store.update(state => { state.receipts[0].text = 'Current replacement fixture receipt'; });
  assert.equal((await f.rpc('receipt.read', { receiptId: 'receipt_1' }) as any).text, 'Current replacement fixture receipt');
  resume.resolve(); await assert.rejects(old, code('PREVIEW_CHANGED'));
});

test('custody async callbacks roll back before any commit', async () => {
  const store = new MemoryStore(), storage = new StateStorePhoneCustodyStorage(store), before = store.read();
  await assert.rejects(storage.transaction(() => Promise.reject(Error('Synthetic async callback'))) as Promise<unknown>, code('INVALID_REQUEST'));
  assert.deepEqual(store.read(), before);
});

test('real encrypted Vault reopen preserves custody/intent and guarded recovery without another callback', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-engine-phone-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, storage: 'experimental-file' as const, passphrase: 'long synthetic phone runtime test passphrase' };
  const created = await Vault.create({ ...options, name: 'Encrypted phone runtime fixture' }); let vault = created.vault;
  t.after(() => vault.close());
  const first = await fixture(vault); await first.offer(); await first.rpc('chat.start', { requestId: 'request_1', question: request.question });
  assert.ok(!(await readFile(join(directory, 'authority.encrypted.json'), 'utf8')).includes(request.question));
  await vault.close(); vault = await Vault.open(options);
  const reopened = await fixture(vault, false);
  assert.deepEqual(await reopened.rpc('request.status', { requestId: 'request_1' }), { status: 'succeeded', requestId: 'request_1', result: chat });
  assert.equal(reopened.calls(), 0);
});
