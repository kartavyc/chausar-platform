import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { AppChannel, PhoneCapability, SessionGrant } from '../runtime/phone/contracts.ts';

const PASSWORD = 'SYNTHETIC phone public join disposable passphrase';
const ENDPOINT = 'https://synthetic-phone-provider.invalid/v1/responses';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-phone-public-join-')), calls: string[] = [];
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['fixture'], t.mock), gateway: {
    http: async request => {
      calls.push(request.body);
      const wire = { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
        operation: 'revenue', period: PERIOD, branch: null, customerId: null,
      } }], clarification: null };
      return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(wire) }] },
      ] }) };
    },
  } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  t.after(async () => {
    await app.close(5000);
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('chausar-phone-public-join-'));
    await rm(target, { recursive: true, force: true });
  });
  async function desktop(method: string, payload: Record<string, unknown> = {}, credential = token) {
    const response = await fetch(origin + '/api/rpc', { method: 'POST', headers: {
      Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as { result?: any; error?: { code: string; message: string } };
    if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code });
    assert.equal(response.status, 200); return body.result;
  }
  await desktop('workspace.create', { name: 'SYNTHETIC phone joined business', folder: 'fixture',
    passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  for (const [sourceId, entityId, amount] of [
    ['synthetic-phone-a', 'synthetic-phone-a-sale', '12000'],
    ['synthetic-phone-b', 'synthetic-phone-b-sale', '900000'],
  ]) await desktop('sources.import', { sourceId, format: 'csv',
    content: `id,kind,date,amount,currency,branch,status\n${entityId},sale,2026-09-05,${amount},INR,main,delivered`,
    expectedTotals: { rowCount: 1, amountMinor: amount }, recipe: {
      version: 1, id: `${sourceId}-recipe`, system: 'synthetic-csv', edition: '1',
      scope: { company: 'SYNTHETIC phone joined business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
    } });
  await desktop('models.configure', { config: { id: 'synthetic-phone-route', kind: 'openai-responses',
    model: 'synthetic-authored-phone-planner', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' }, secret: 'synthetic-fixture-only' });
  await desktop('trust.update', { send: 'shape' });
  const keys = generateKeyPairSync('ed25519'), deviceId = 'synthetic-phone-device', keyId = 'synthetic-phone-key';
  const devicePublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  // Literal documented protocol oracle, independently encoded at the public HTTP boundary.
  function signed(method: string, payload: unknown = {}, credential?: string) {
    const body = JSON.stringify({ protocolVersion: 1, method, payload }), timestamp = new Date().toISOString();
    const nonce = randomBytes(32).toString('base64url');
    const credentialDigest = credential === undefined ? null
      : createHash('sha256').update('chausar-phone-credential-v1\n' + credential).digest('hex');
    const bytes = Buffer.from(JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc',
      deviceId, keyId, timestamp, nonce, credentialDigest, Buffer.byteLength(body)]) + '\n' + body);
    return { body, headers: { 'Content-Type': 'application/json', 'x-chausar-device': deviceId,
      'x-chausar-key': keyId, 'x-chausar-time': timestamp, 'x-chausar-nonce': nonce,
      'x-chausar-proof': sign(null, bytes, keys.privateKey).toString('base64url'),
      ...(credential === undefined ? {} : { Authorization: `Bearer ${credential}` }) } };
  }
  async function wire(call: ReturnType<typeof signed>, extra: Record<string, string> = {}) {
    const response = await fetch(origin + '/api/companion/rpc', { method: 'POST', headers: { ...call.headers, ...extra }, body: call.body });
    return { status: response.status, body: await response.json() as { result?: any; error?: { code: string } } };
  }
  async function phone(method: string, payload: unknown, grant: SessionGrant) {
    const result = await wire(signed(method, payload, grant.credential));
    if (result.body.error) throw Object.assign(new Error(result.body.error.code), { code: result.body.error.code });
    assert.equal(result.status, 200); return result.body.result;
  }
  async function pair(capabilities: PhoneCapability[] = ['brief.read', 'chat', 'approval.simple']) {
    const invite = await desktop('phone.invite', { memberId: 'owner', deviceId, keyId, channel: 'web' satisfies AppChannel,
      devicePublicKey, capabilities, inviteTtlMs: 60000, sessionTtlMs: 600000 });
    const proof = sign(null, Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', invite.inviteCode,
      deviceId, 'web', keyId, devicePublicKey])), keys.privateKey).toString('base64url');
    const pairingCall = signed('pairing.accept', { inviteCode: invite.inviteCode, deviceId, channel: 'web', devicePublicKey, proof });
    const response = await wire(pairingCall);
    assert.equal(response.status, 200); assert.equal(response.body.error, undefined);
    const grant = response.body.result as SessionGrant;
    assert.notEqual(grant.credential, token); assert.notEqual(grant.credential, invite.inviteCode);
    return { grant, pairingCall };
  }
  const request = { purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-phone-route',
    question: 'SYNTHETIC: calculate September revenue from selected source A only.', sourceIds: ['synthetic-phone-a'], period: PERIOD };
  async function offer(grant: SessionGrant) {
    const preview = await desktop('models.preview', request), approval = await desktop('models.approve', { id: preview.id });
    const offered = await desktop('phone.conversation.offer', { sessionId: grant.authority.sessionId,
      request: { ...request, previewId: preview.id, approvalId: approval.id } });
    assert.equal(offered.previewId, preview.id); return { preview, approval, offered };
  }
  async function reopen() { await desktop('workspace.lock'); await desktop('workspace.open', { folder: 'fixture', passphrase: PASSWORD }); }
  return { engine, origin, token, calls, desktop, signed, wire, phone, pair, offer, request, reopen };
}

test('public companion pairing has real Ed25519 proofs, isolated credentials and private session metadata', async t => {
  const f = await fixture(t), { grant, pairingCall } = await f.pair();
  assert.equal((await f.phone('session.validate', {}, grant)).status, 'current');
  assert.equal((await f.wire(pairingCall)).status, 401, 'A consumed pairing invite and nonce cannot produce a second credential.');
  const desktopCredential = await f.wire(f.signed('session.validate', {}, f.token));
  assert.equal(desktopCredential.status, 401); assert.equal(desktopCredential.body.result, undefined);
  await assert.rejects(f.desktop('auth.sessions', {}, grant.credential));
  assert.deepEqual(await f.desktop('auth.sessions'), []);
  const metadata = await f.desktop('phone.sessions'); assert.equal(metadata.length, 1);
  assert.deepEqual(Object.keys(metadata[0]).sort(), ['binding', 'capabilities', 'channel', 'expiresAt', 'keyId', 'revoked', 'sessionId']);
  const call = f.signed('session.validate', {}, grant.credential);
  assert.equal((await f.wire(call, { Origin: 'https://outside-synthetic.invalid' })).status, 403);
  assert.equal((await f.wire(call)).status, 200, 'Global Origin rejection precedes the durable nonce admission.');
  const replay = await f.wire(call);
  assert.equal(replay.status, 400, 'An accepted exact signed nonce is durable one-use state.');
  assert.equal(replay.body.error?.code, 'INVALID_REQUEST'); assert.equal(replay.body.result, undefined);
  await f.reopen(); assert.equal((await f.phone('session.validate', {}, grant)).status, 'current');
  const reopenedReplay = await f.wire(call);
  assert.equal(reopenedReplay.status, 400); assert.equal(reopenedReplay.body.error?.code, 'INVALID_REQUEST');
});

test('public phone chat executes one exact desktop-reviewed calculation and reconciles the retained answer after Vault reopen', async t => {
  const f = await fixture(t), { grant } = await f.pair(), { preview } = await f.offer(grant);
  assert.equal(f.calls.length, 0);
  const input = { requestId: 'synthetic-public-chat-one', question: f.request.question };
  const result = await f.phone('chat.start', input, grant);
  assert.equal(result.status, 'succeeded'); assert.equal(result.result.receiptIds.length, 1);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls, [preview.payload]);
  const receiptId = result.result.receiptIds[0], receipt = await f.desktop('receipts.get', { id: receiptId });
  assert.equal(receipt.totalMinor, '12000'); assert.deepEqual(receipt.requestedSourceIds, ['synthetic-phone-a']);
  assert.ok(result.result.text.includes(receipt.figures[0].display));
  assert.equal((await f.phone('receipt.read', { receiptId }, grant)).id, receiptId);
  assert.deepEqual(await f.phone('chat.start', input, grant), result); assert.equal(f.calls.length, 1);
  await f.reopen();
  assert.deepEqual(await f.phone('request.status', { requestId: input.requestId }, grant), result);
  assert.deepEqual(await f.phone('request.cancel', { requestId: input.requestId }, grant), result);
  assert.equal(f.calls.length, 1, 'Neither status, retry nor cancel may rerun a completed provider request.');
  // Explicit synthetic age fixture through the real supported encrypted writer;
  // no host clock seam or policy-bound relaxation. Current policy minimum is one day.
  await f.engine.vault!.update(state => {
    const aged = state.receipts.find(item => item.id === receiptId)!;
    const twoDaysOld = new Date(Date.now() - 2 * 86400000).toISOString();
    aged.createdAt = twoDaysOld;
    for (const row of state.facts.filter(item => aged.rowIds.includes(item.id))) row.learnedAt = twoDaysOld;
  });
  await f.desktop('trust.update', { retentionDays: 1 });
  const expiredEvidence = await f.wire(f.signed('receipt.read', { receiptId }, grant.credential));
  assert.ok(expiredEvidence.body.error); assert.equal(expiredEvidence.body.result, undefined,
    'Current phone receipt readback must also respect withdrawn receipt and fact retention.');
});

test('public phone brief uses the exact retained guarded cache after reopen and withholds withdrawn sources', async t => {
  const f = await fixture(t), { grant } = await f.pair();
  await f.desktop('trust.update', { autonomy: true });
  const job = await f.desktop('jobs.create', { type: 'owner-brief', goal: 'SYNTHETIC review selected source A',
    sourceIds: ['synthetic-phone-a'], budgetMinor: '1', reserveMinor: '1', requiresApproval: false,
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 3600000).toISOString() } });
  const completed = await f.desktop('jobs.run', { id: job.id });
  assert.equal(completed.status, 'awaiting-acceptance');
  const first = await f.phone('brief.list', {}, grant); assert.equal(first.length, 1);
  assert.equal(first[0].id, completed.deliverable.result.id);
  assert.deepEqual(first[0].receiptIds, completed.deliverable.result.receiptIds);
  const literalPin = createHash('sha256').update(JSON.stringify(sort(completed.deliverable))).digest('hex');
  assert.equal(first[0].version, literalPin, 'Phone brief version pins exact canonical persisted cache, not current global revision.');
  await f.reopen(); assert.deepEqual(await f.phone('brief.read', { briefId: first[0].id }, grant), first[0]);
  assert.equal(f.calls.length, 0, 'Brief reads do not create a model request.');
  await f.desktop('trust.update', { allowedSources: ['synthetic-phone-b'] });
  assert.deepEqual(await f.phone('brief.list', {}, grant), []);
  const denied = await f.wire(f.signed('receipt.read', { receiptId: first[0].receiptIds[0] }, grant.credential));
  assert.ok(denied.body.error); assert.equal(denied.body.result, undefined);
});

test('public phone refusal remains explicit without a desktop offer, for approval/upload, and after owner revocation', async t => {
  const f = await fixture(t), { grant } = await f.pair();
  await assert.rejects(f.phone('chat.start', { requestId: 'synthetic-unoffered', question: f.request.question }, grant), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.phone('approval.list', {}, grant), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.phone('upload.begin', {}, grant), { code: 'OPEN_DESKTOP' });
  assert.equal(f.calls.length, 0); assert.equal(f.engine.vault!.read().actions.length, 0);
  await f.desktop('phone.revoke', { sessionId: grant.authority.sessionId });
  await assert.rejects(f.phone('session.validate', {}, grant), { code: 'ACCESS_REVOKED' });
  await f.reopen(); await assert.rejects(f.phone('session.validate', {}, grant), { code: 'ACCESS_REVOKED' });
});

function sort(value: any): any {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
