import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PhoneClient } from '../runtime/phone/client.ts';
import { EncryptedBriefCache } from '../runtime/phone/cache.ts';
import { PhoneError } from '../runtime/phone/contracts.ts';
import type { ApprovalChallenge, ApprovalDecision, PhoneCredentialStore, PhoneMethods, PhoneTransport, SessionGrant } from '../runtime/phone/contracts.ts';
import type { PhoneHostAuthentication, PhoneHostMethod, PhoneHostMethods } from '../runtime/phone/host-contracts.ts';
import { FIXTURE_DEVICE_ID, FIXTURE_KEY_ID, FIXTURE_QUESTION, fixtureSignature } from './phone-host-fixture.ts';

// Actual TCP loopback, actual host processes, encrypted custody and real Engine
// import/reviewed synthetic planner/calculation/brief. Session/backend adapters are
// authored fixtures and do not qualify the production Engine/StateStore join.
const workerPath = fileURLToPath(new URL('./phone-host-fixture.ts', import.meta.url));
const code = (expected: string) => (error: unknown) => error instanceof PhoneError && error.code === expected;
type WireResult = { status: number; headers: Record<string, unknown>; body: any };
type Proof = PhoneHostAuthentication['proof'];

async function startWorker(directory: string) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const child = fork(workerPath, ['--phone-http-worker', directory], { env: { ...environment, CHAUSAR_DEMO: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr?.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-12000); });
  child.stdout?.resume();
  const ready = await new Promise<{ url: string }>((resolvePromise, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Synthetic phone worker startup timeout. ' + stderr)); }, 20000);
    child.once('exit', exit => { clearTimeout(timeout); reject(new Error(`Synthetic phone worker exited ${exit}. ${stderr}`)); });
    child.on('message', (message: any) => { if (message.ready) { clearTimeout(timeout); resolvePromise(message); } });
  });
  let serial = 0;
  async function command(input: Record<string, unknown>): Promise<any> {
    const id = ++serial;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => { child.off('message', listener); reject(new Error('Synthetic phone worker command timeout.')); }, 15000);
      const listener = (message: any) => {
        if (message.id !== id) return;
        clearTimeout(timeout); child.off('message', listener);
        if (message.error) reject(new Error(message.error)); else resolvePromise(message.result);
      };
      child.on('message', listener); child.send({ ...input, id });
    });
  }
  return { child, url: ready.url, command, async stop() {
    if (child.exitCode !== null || !child.connected) return;
    const exited = once(child, 'exit'); await command({ kind: 'stop' }); await exited;
  } };
}

async function fixture(t: TestContext) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-phone-host-http-'));
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  t.after(async () => {
    await worker?.stop();
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), temporaryRoot.toLowerCase());
    assert.ok(basename(target).startsWith('chausar-phone-host-http-'));
    await rm(target, { recursive: true, force: true });
  });
  worker = await startWorker(directory);
  const initial = await worker.command({ kind: 'inspect' });
  let now: number = initial.now;
  let grant: SessionGrant = initial.grant;
  let dropNextMethod: string | undefined;
  const calls: { method: string; payload: unknown }[] = [];
  const sign = (bytes: Uint8Array, options: { credential?: string; anonymous?: boolean; nonce?: string; timestamp?: string; deviceId?: string; keyId?: string } = {}) => {
    const proof = { deviceId: options.deviceId ?? FIXTURE_DEVICE_ID, keyId: options.keyId ?? FIXTURE_KEY_ID,
      timestamp: options.timestamp ?? new Date(now).toISOString(), nonce: options.nonce ?? 'nonce_' + randomUUID().replaceAll('-', '_') };
    const credential = options.anonymous ? undefined : options.credential ?? grant.credential;
    return { ...proof, proof: fixtureSignature(bytes, proof, credential) };
  };
  function raw(bytes: Uint8Array, options: { credential?: string; anonymous?: boolean; proof?: Proof; path?: string; method?: string; extraHeaders?: Record<string, string>; signal?: AbortSignal } = {}): Promise<WireResult> {
    const credential = options.anonymous ? undefined : options.credential ?? grant.credential;
    const proof = options.proof ?? sign(bytes, { credential, anonymous: options.anonymous });
    const url = new URL(options.path ?? worker!.url, worker!.url);
    return new Promise((resolvePromise, reject) => {
      const request = httpRequest(url, { method: options.method ?? 'POST', signal: options.signal,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close', ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          'X-Chausar-Device': proof.deviceId, 'X-Chausar-Key': proof.keyId, 'X-Chausar-Time': proof.timestamp,
          'X-Chausar-Nonce': proof.nonce, 'X-Chausar-Proof': proof.proof, ...options.extraHeaders } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', bytes => chunks.push(Buffer.from(bytes)));
        response.once('end', () => { try { resolvePromise({ status: response.statusCode!, headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { reject(new PhoneError('INVALID_RESPONSE')); } });
        response.once('error', () => reject(new PhoneError('TRANSPORT_UNKNOWN')));
      });
      request.once('error', () => reject(new PhoneError('TRANSPORT_UNKNOWN'))); request.end(bytes);
    });
  }
  async function rpc<M extends PhoneHostMethod>(method: M, payload: PhoneHostMethods[M]['input'], options: { credential?: string; signal?: AbortSignal } = {}): Promise<PhoneHostMethods[M]['output']> {
    calls.push({ method, payload: structuredClone(payload) });
    const bytes = Buffer.from(JSON.stringify({ protocolVersion: 1, method, payload }));
    const drop = dropNextMethod === method; if (drop) dropNextMethod = undefined;
    const response = await raw(bytes, { ...options, ...(method === 'pairing.accept' ? { anonymous: true } : {}), ...(drop ? { extraHeaders: { 'X-Fixture-Drop-Ack': '1' } } : {}) });
    if (response.body.error) throw new PhoneError(response.body.error.code);
    assert.equal(response.status, 200); return response.body.result;
  }
  const transport: PhoneTransport = { request: <M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], options: { credential?: string; signal: AbortSignal }) => rpc(method, input, options) };
  const credentialPath = join(directory, 'synthetic-client-grant.json');
  await writeFile(credentialPath, JSON.stringify(grant));
  const credentials: PhoneCredentialStore = {
    load: async () => { try { return JSON.parse(await readFile(credentialPath, 'utf8')); } catch (error: any) { if (error.code === 'ENOENT') return; throw error; } },
    save: async value => { await writeFile(credentialPath, JSON.stringify(value)); },
    clear: async () => { await rm(credentialPath, { force: true }); },
  };
  async function client() {
    const encrypted = new Map<string, Uint8Array>();
    const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const cache = new EncryptedBriefCache({ crypto: globalThis.crypto, now: () => now,
      storage: { list: async () => [...encrypted.keys()], get: async id => encrypted.get(id)?.slice(),
        set: async (id, bytes) => { encrypted.set(id, bytes.slice()); }, remove: async id => { encrypted.delete(id); }, clear: async () => { encrypted.clear(); } },
      keys: { getKey: async () => key, clear: async () => { encrypted.clear(); } } });
    const value = new PhoneClient({ channel: 'ios', transport, credentials, cache, clock: () => now,
      requestRestoration: { list: (authority, credential, signal) => {
        assert.deepEqual(authority.binding, grant.authority.binding); return rpc('request.list', {}, { credential, signal });
      } } });
    await value.restore(); await value.reconnect(); return value;
  }
  return { directory, initial, calls, rpc, raw, sign, client, credentials,
    dropAcknowledgment(method: string) { dropNextMethod = method; },
    async inspect() { return worker!.command({ kind: 'inspect' }); },
    async change(input: Record<string, unknown>) { await worker!.command({ kind: 'change', ...input }); const state = await worker!.command({ kind: 'inspect' }); now = state.now; grant = state.grant; },
    async issue(): Promise<ApprovalChallenge> { return worker!.command({ kind: 'issue' }); },
    async pauseApproval() { await worker!.command({ kind: 'pauseApproval' }); },
    async releaseApproval() { await worker!.command({ kind: 'releaseApproval' }); },
    async pauseRead(resource: string) { await worker!.command({ kind: 'pauseRead', resource }); },
    async releaseRead() { await worker!.command({ kind: 'releaseRead' }); },
    async waitPaused(kind: 'approval' | 'read') { const deadline = Date.now() + 5000; while (!(await worker!.command({ kind: 'inspect' }))[kind + 'Paused']) {
      assert.ok(Date.now() < deadline, 'Synthetic gate must enter before authority mutation.'); await delay(5);
    } },
    async deleteSource() { return worker!.command({ kind: 'deleteSource' }); },
    async restart() { const pid = worker!.child.pid; await worker!.stop(); worker = await startWorker(directory); assert.notEqual(worker.child.pid, pid); },
  };
}

function decision(challenge: ApprovalChallenge, requestId: string): ApprovalDecision {
  assert.ok(challenge.token);
  return { requestId, approvalId: challenge.preview.approvalId, token: challenge.token, decision: 'approve',
    expectedDigest: challenge.preview.digest, expectedActionRevision: challenge.preview.actionRevision,
    expectedOperationVersion: challenge.preview.operationVersion };
}

test('signed synthetic single-use pairing joins current phone grant before chat and brief reads', async t => {
  const f = await fixture(t); await f.change({ paired: false }); await f.credentials.clear();
  const client = await f.client();
  const input: PhoneMethods['pairing.accept']['input'] = { inviteCode: 'synthetic-desktop-single-use-invite', deviceId: FIXTURE_DEVICE_ID,
    channel: 'ios', devicePublicKey: 'synthetic-hmac-fixture-key-registration', proof: 'synthetic-fixture-possession' };
  await client.pair(input); assert.equal(client.snapshot().pairing.status, 'paired');
  assert.equal((await client.chat('paired_chat', FIXTURE_QUESTION)).status, 'succeeded');
  assert.equal((await client.listBriefs()).length, 1);
  await assert.rejects(f.rpc('pairing.accept', input), code('ACCESS_REVOKED'));
  const state = await f.inspect(); assert.equal(state.inviteUsed, true); assert.equal(state.effects, 1);
});

test('real phone HTTP serves reviewed synthetic Engine chat, brief and calculation receipts', async t => {
  const f = await fixture(t), client = await f.client();
  assert.equal(f.initial.importReconciled, true); assert.equal(f.initial.calculation.totalMinor, '30000');
  assert.equal(f.initial.plannerCallsInThisProcess, 1);
  const answer = await client.chat('chat_read_1', FIXTURE_QUESTION); assert.equal(answer.status, 'succeeded');
  if (answer.status !== 'succeeded') throw new Error('Expected completed chat');
  assert.deepEqual(answer.result, f.initial.answer);
  const receipt = await f.rpc('receipt.read', { receiptId: answer.result.receiptIds[0] });
  const calculation = JSON.parse(receipt.text); assert.equal(calculation.totalMinor, String(10000n + 20000n));
  assert.equal(calculation.rowIds.length, 2); assert.deepEqual(calculation.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(receipt.workspaceId, f.initial.grant.authority.binding.workspaceId);
  const briefs = await client.listBriefs(); assert.equal(briefs.length, 1);
  const current = await client.readBrief(briefs[0].id); assert.equal(current.freshness, 'current');
  assert.deepEqual(current.brief.receiptIds, f.initial.brief.receiptIds);
  for (const receiptId of current.brief.receiptIds) assert.equal((await f.rpc('receipt.read', { receiptId })).id, receiptId);
  client.disconnect(); const cached = await client.readBrief(briefs[0].id); assert.equal(cached.freshness, 'cached');
  const state = await f.inspect(); assert.equal(state.effects, 1); assert.equal(state.syntheticPlannerCalls, 1);
  await assert.rejects(f.rpc('chat.start', { requestId: 'unreviewed', question: 'Send an unreviewed model request' }), code('OPEN_DESKTOP'));
});

test('lost HTTP acknowledgment plus host process and PhoneClient restart recover identical operation without a resend', async t => {
  const f = await fixture(t), original = await f.client();
  f.dropAcknowledgment('chat.start');
  await assert.rejects(original.chat('lost_chat', FIXTURE_QUESTION), code('TRANSPORT_UNKNOWN'));
  assert.equal(original.snapshot().requests.find(row => row.requestId === 'lost_chat')?.status, 'unknown');
  const committed = await f.inspect(); assert.equal(committed.effects, 1); assert.equal(committed.starts, 1);
  const operationId = Object.keys(committed.operations)[0]; const result = committed.operations[operationId].result;
  const before = f.calls.length; await f.restart(); const reopened = await f.client();
  assert.deepEqual(reopened.snapshot().requests.find(row => row.requestId === 'lost_chat'), result);
  assert.deepEqual(f.calls.slice(before).map(row => row.method), ['session.validate', 'request.list', 'session.validate', 'request.status']);
  const after = await f.inspect(); assert.equal(after.starts, 1); assert.equal(after.effects, 1);
  assert.deepEqual(Object.keys(after.operations), [operationId]); assert.equal(after.plannerCallsInThisProcess, 0);
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'lost_chat', question: FIXTURE_QUESTION }), result);
  await assert.rejects(f.rpc('chat.start', { requestId: 'lost_chat', question: FIXTURE_QUESTION + ' changed' }), code('REQUEST_EXISTS'));
  assert.equal((await f.inspect()).effects, 1);
});

test('uncertain backend reply reconciles operationId by read-only status after a process restart', async t => {
  const f = await fixture(t); await f.change({ loseBackendReply: true });
  await assert.rejects(f.rpc('chat.start', { requestId: 'backend_lost', question: FIXTURE_QUESTION }), code('TRANSPORT_UNKNOWN'));
  const committed = await f.inspect(); const operationId = Object.keys(committed.operations)[0];
  await f.restart(); const client = await f.client();
  assert.deepEqual(client.snapshot().requests[0], committed.operations[operationId].result);
  const after = await f.inspect(); assert.equal(after.starts, 1); assert.equal(after.effects, 1); assert.equal(after.statusReads, 1);
});

test('exact owner approval consumes the existing challenge once; acknowledgment loss recovers only its disposition', async t => {
  const f = await fixture(t), challenge = await f.issue(), client = await f.client();
  const preview = await client.inspectApproval(challenge.preview.approvalId); assert.deepEqual(preview, challenge.preview);
  f.dropAcknowledgment('approval.submit');
  await assert.rejects(client.decideApproval('lost_approval', preview.approvalId, 'approve'), code('TRANSPORT_UNKNOWN'));
  const committed = await f.inspect(); assert.equal(committed.effects, 1); assert.equal(committed.action.status, 'approved');
  assert.equal(committed.challenges[preview.approvalId].consumed, true);
  assert.equal(JSON.stringify(committed).includes(challenge.token!), false, 'Only token hash and decision receipt are durable.');
  await f.restart(); const restored = await f.client();
  const result = restored.snapshot().requests.find(row => row.requestId === 'lost_approval'); assert.equal(result?.status, 'succeeded');
  assert.deepEqual(result, Object.values((await f.inspect()).operations).map((row: any) => row.result)[0]);
  assert.deepEqual(await f.rpc('approval.submit', decision(challenge, 'lost_approval')), result);
  await assert.rejects(f.rpc('approval.submit', decision(challenge, 'another_approval')), code('APPROVAL_USED'));
  assert.equal((await f.inspect()).effects, 1);
});

test('changed approval revision and message impact refuse before disposition or execution', async t => {
  const f = await fixture(t), challenge = await f.issue();
  await f.change({ action: { actionRevision: 2 } });
  await assert.rejects(f.rpc('approval.submit', decision(challenge, 'changed_approval')), code('PREVIEW_CHANGED'));
  assert.equal((await f.inspect()).effects, 0);
  await f.change({ action: { actionRevision: 1, impact: 'message' } });
  await assert.rejects(f.rpc('approval.submit', decision(challenge, 'message_approval')), code('OPEN_DESKTOP'));
  assert.equal((await f.inspect()).effects, 0);
});

test('cancelled pending work survives process/client restart and cannot commit from a duplicate start', async t => {
  const f = await fixture(t); await f.change({ pending: true }); const client = await f.client();
  assert.equal((await client.chat('pending_chat', FIXTURE_QUESTION)).status, 'pending');
  assert.deepEqual(await client.cancel('pending_chat'), { requestId: 'pending_chat', status: 'cancelled' });
  await f.restart(); const reopened = await f.client();
  assert.deepEqual(reopened.snapshot().requests[0], { requestId: 'pending_chat', status: 'cancelled' });
  await f.change({ pending: false });
  assert.deepEqual(await f.rpc('chat.start', { requestId: 'pending_chat', question: FIXTURE_QUESTION }), { requestId: 'pending_chat', status: 'cancelled' });
  const state = await f.inspect(); assert.equal(state.effects, 0); assert.equal(state.starts, 1); assert.equal(state.cancels, 1);
});

test('cancellation tombstone wins before a paused exact approval commit', async t => {
  const f = await fixture(t), challenge = await f.issue(); await f.pauseApproval();
  const started = f.rpc('approval.submit', decision(challenge, 'cancel_approval'));
  await f.waitPaused('approval');
  const cancelled = await f.rpc('request.cancel', { requestId: 'cancel_approval' });
  assert.deepEqual(cancelled, { status: 'cancelled', requestId: 'cancel_approval' });
  await f.releaseApproval(); assert.deepEqual(await started, cancelled);
  const state = await f.inspect(); assert.equal(state.effects, 0); assert.equal(state.action.status, 'prepared');
  assert.equal(state.challenges[challenge.preview.approvalId].consumed, false);
  await f.restart(); assert.deepEqual(await f.rpc('request.status', { requestId: 'cancel_approval' }), cancelled);
  assert.equal((await f.inspect()).effects, 0);
});

test('protected read release rechecks current authority and exact resource after paused adapter IO', async t => {
  for (const scenario of [
    { resource: 'brief', change: { revoked: true }, expected: 'ACCESS_REVOKED' },
    { resource: 'brief', change: { advance: 3600001 }, expected: 'SESSION_EXPIRED' },
    { resource: 'brief', change: { revision: 2 }, expected: 'PREVIEW_CHANGED' },
    { resource: 'receipt', change: { capabilities: ['chat'] }, expected: 'CAPABILITY_FORBIDDEN' },
    { resource: 'receipt', change: { sourceExists: false }, expected: 'ACCESS_REVOKED' },
    { resource: 'approval', change: { action: { actionRevision: 2 } }, expected: 'PREVIEW_CHANGED' },
    { resource: 'approval-list', change: { role: 'staff' }, expected: 'CAPABILITY_FORBIDDEN' },
  ]) await t.test(scenario.resource + ':' + scenario.expected, async subtest => {
    const f = await fixture(subtest); const challenge = scenario.resource.startsWith('approval') ? await f.issue() : undefined;
    await f.pauseRead(scenario.resource);
    const reading = scenario.resource === 'brief' ? f.rpc('brief.read', { briefId: f.initial.brief.id })
      : scenario.resource === 'receipt' ? f.rpc('receipt.read', { receiptId: f.initial.answer.receiptIds[0] })
      : scenario.resource === 'approval' ? f.rpc('approval.inspect', { approvalId: challenge!.preview.approvalId })
      : f.rpc('approval.list', {});
    // Retain a failed assertion until after gate/control awaits, without producing
    // an unhandled rejection that would prematurely cancel the fixture process.
    const rejection = assert.rejects(reading, code(scenario.expected)).then(() => undefined, error => error);
    await f.waitPaused('read'); await f.change(scenario.change); await f.releaseRead();
    const mismatch = await rejection; if (mismatch) throw mismatch;
    assert.equal((await f.inspect()).effects, 0);
  });
});

test('retained results refuse expired grants, revocation, source deletion, changed scope and removed capabilities', async t => {
  for (const refusal of ['expired', 'revoked', 'source', 'scope', 'capability'] as const) {
    await t.test(refusal, async subtest => {
      const f = await fixture(subtest); await f.rpc('chat.start', { requestId: 'retained_chat', question: FIXTURE_QUESTION });
      let expected: string;
      if (refusal === 'expired') { await f.change({ advance: 3600001 }); expected = 'SESSION_EXPIRED'; }
      else if (refusal === 'revoked') { await f.change({ revoked: true }); expected = 'ACCESS_REVOKED'; }
      else if (refusal === 'source') { await f.deleteSource(); expected = 'ACCESS_REVOKED'; }
      else if (refusal === 'scope') { await f.change({ revision: 2 }); expected = 'PREVIEW_CHANGED'; }
      else { await f.change({ capabilities: ['brief.read'] }); expected = 'CAPABILITY_FORBIDDEN'; }
      for (const method of ['request.status', 'request.cancel'] as const)
        await assert.rejects(f.rpc(method, { requestId: 'retained_chat' }), code(expected));
      await assert.rejects(f.rpc('request.list', {}), code(expected));
      assert.equal((await f.inspect()).effects, 1);
      if (refusal === 'source' || refusal === 'revoked' || refusal === 'expired') {
        await assert.rejects(f.rpc('brief.read', { briefId: f.initial.brief.id }), code(expected));
        await assert.rejects(f.rpc('receipt.read', { receiptId: f.initial.answer.receiptIds[0] }), code(expected));
      }
    });
  }
});

test('backend atomically rechecks changed capabilities between admission and commit', async t => {
  const f = await fixture(t); await f.change({ revokeAtStart: true });
  await assert.rejects(f.rpc('chat.start', { requestId: 'revoked_at_commit', question: FIXTURE_QUESTION }), code('CAPABILITY_FORBIDDEN'));
  const state = await f.inspect(); assert.equal(state.effects, 0); assert.equal(state.starts, 0); assert.equal(Object.keys(state.operations).length, 0);
  assert.deepEqual(state.grant.authority.capabilities, []);
});

test('HTTP proof binds exact bytes, scoped credential, fresh timestamp, device and one-use nonce', async t => {
  const f = await fixture(t), bytes = Buffer.from(JSON.stringify({ protocolVersion: 1, method: 'session.validate', payload: {} }));
  const proof = f.sign(bytes, { nonce: 'single_use_nonce' });
  assert.equal((await f.raw(bytes, { proof })).status, 200);
  assert.deepEqual((await f.raw(bytes, { proof })).body, { error: { code: 'ACCESS_REVOKED' } });
  const originalProof = f.sign(bytes);
  const changedBytes = Buffer.from(JSON.stringify({ protocolVersion: 1, method: 'brief.list', payload: {} }));
  assert.deepEqual((await f.raw(changedBytes, { proof: originalProof })).body, { error: { code: 'ACCESS_REVOKED' } });
  const desktopCredential = 'synthetic_desktop_token_' + 'd'.repeat(32);
  assert.deepEqual((await f.raw(bytes, { credential: desktopCredential, proof: f.sign(bytes, { credential: desktopCredential }) })).body,
    { error: { code: 'ACCESS_REVOKED' } });
  for (const bad of [{ deviceId: 'another_phone' }, { keyId: 'another_key' }, { timestamp: new Date(f.initial.now - 30001).toISOString() }])
    assert.deepEqual((await f.raw(bytes, { proof: f.sign(bytes, bad) })).body, { error: { code: 'ACCESS_REVOKED' } });
  assert.equal((await f.inspect()).effects, 0);
});

test('HTTP boundary rejects hidden routes, malformed envelope, protocol changes and oversized bodies', async t => {
  const f = await fixture(t), normal = Buffer.from(JSON.stringify({ protocolVersion: 1, method: 'session.validate', payload: {} }));
  const valid = await f.raw(normal); assert.equal(valid.headers['cache-control'], 'no-store'); assert.equal(valid.headers['x-content-type-options'], 'nosniff');
  for (const options of [{ method: 'GET' }, { path: '/api/companion/rpc?token=forbidden' }, { path: '/api/hidden/companion' }])
    assert.deepEqual((await f.raw(normal, options)).body, { error: { code: 'INVALID_REQUEST' } });
  for (const body of [{ protocolVersion: 2, method: 'session.validate', payload: {} }, { protocolVersion: 1, method: 'session.validate', payload: {}, role: 'owner' },
    { protocolVersion: 1, method: 'session.validate', payload: { capabilities: ['chat'] } }])
    assert.deepEqual((await f.raw(Buffer.from(JSON.stringify(body)))).body, { error: { code: 'INVALID_REQUEST' } });
  assert.deepEqual((await f.raw(Buffer.from('{broken'))).body, { error: { code: 'INVALID_REQUEST' } });
  assert.deepEqual((await f.raw(normal, { extraHeaders: { 'Content-Length': String(128 * 1024 + 1) } })).body,
    { error: { code: 'INVALID_REQUEST' } });
  await assert.rejects(f.rpc('upload.begin', { requestId: 'upload', metadata: { name: 'synthetic.csv', mediaType: 'text/csv', sizeBytes: 1, sha256: 'a'.repeat(64) } }), code('OPEN_DESKTOP'));
  assert.equal((await f.inspect()).effects, 0);
});
