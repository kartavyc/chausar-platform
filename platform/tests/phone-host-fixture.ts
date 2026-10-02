import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../runtime/engine.ts';
import { PhoneApprovalService } from '../runtime/phone/approval.ts';
import type { ApprovalPrincipal, ApprovalSession, PhoneApprovalAction, PhoneApprovalConsumption, PhoneApprovalLedger, PhoneApprovalRecord, PhoneApprovalTransaction } from '../runtime/phone/approval.ts';
import { PhoneError, requirePhone, sameBinding } from '../runtime/phone/contracts.ts';
import type { ApprovalChallenge, Brief, ChatAnswer, PhoneCapability, RemoteRequest, RequestResult, SessionGrant } from '../runtime/phone/contracts.ts';
import { PhoneHost, createPhoneHttpHandler } from '../runtime/phone/host.ts';
import type { PhoneCustodyRecord, PhoneHostAuthentication, PhoneHostOperation, PhoneHostPorts, PhoneHostPrincipal, PhoneRequestScope } from '../runtime/phone/host-contracts.ts';
import { EncryptedFilePhoneCustodyStorage, PhoneRequestCustody } from '../runtime/phone/request-custody.ts';

// This entire module is a synthetic acceptance adapter. It is never a live session,
// StateStore, pairing, relay, TLS, native database, or model qualification adapter.
export const FIXTURE_QUESTION = 'What did the synthetic business bill in September?';
export const FIXTURE_DEVICE_KEY = 'synthetic-test-only-exact-body-hmac-key';
export const FIXTURE_KEY_ID = 'synthetic_key_1';
export const FIXTURE_DEVICE_ID = 'synthetic_phone_1';
const SOURCE = 'synthetic_phone_source';
const PASSWORD = 'synthetic-phone-engine-fixture-passphrase';
const ENDPOINT = 'https://synthetic-phone-fixture.invalid/v1/responses';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const CUSTODY_KEY = createHash('sha256').update('synthetic-phone-custody-fixture-key').digest();

export function fixtureSignature(bytes: Uint8Array, proof: Omit<PhoneHostAuthentication['proof'], 'proof'>, credential?: string) {
  return createHmac('sha256', FIXTURE_DEVICE_KEY).update(JSON.stringify([
    'POST', '/api/companion/rpc', proof.deviceId, proof.keyId, proof.timestamp, proof.nonce, credential ?? '',
  ])).update('\n').update(bytes).digest('hex');
}
type BackendOperation = { record: PhoneCustodyRecord; result: RemoteRequest<RequestResult> };
type FixtureState = {
  now: number; grant: SessionGrant; revoked: boolean; sourceExists: boolean; paired: boolean; inviteUsed: boolean;
  revision: number; channel: 'ios' | 'desktop'; role: 'owner' | 'staff';
  nonces: string[]; operations: Record<string, BackendOperation>;
  effects: number; starts: number; cancels: number; statusReads: number; syntheticPlannerCalls: number;
  answer: ChatAnswer; calculation: any; brief: Brief; importReconciled: boolean;
  pending: boolean; loseBackendReply: boolean; revokeAtStart: boolean;
  action: PhoneApprovalAction; challenges: Record<string, PhoneApprovalRecord>;
  receipts: Record<string, PhoneApprovalConsumption>;
};

/** Durable rollback/serialization for one fixture process, intentionally not a production multiprocess adapter. */
class FixtureBackend {
  private tail: Promise<void> = Promise.resolve();
  readonly path: string;
  constructor(path: string) { this.path = path; }
  private async snapshot(): Promise<FixtureState> { return JSON.parse(await readFile(this.path, 'utf8')); }
  read(): Promise<FixtureState> {
    // On Windows an open read handle may prevent replacement. Fixture inspection
    // participates in the same queue so it never races an atomic writer rename.
    const result = this.tail.then(() => this.snapshot());
    this.tail = result.then(() => undefined, () => undefined); return result;
  }
  transaction<T>(work: (state: FixtureState) => T): Promise<T> {
    const result = this.tail.then(async () => {
      const draft = await this.snapshot(); const value = work(draft);
      await writeFile(this.path + '.next', JSON.stringify(draft));
      await rename(this.path + '.next', this.path);
      return structuredClone(value);
    });
    this.tail = result.then(() => undefined, () => undefined); return result;
  }
}

function current(state: FixtureState, principal?: PhoneHostPrincipal) {
  requirePhone(state.paired, 'UNPAIRED'); requirePhone(!state.revoked, 'ACCESS_REVOKED');
  requirePhone(Date.parse(state.grant.authority.expiresAt) > state.now, 'SESSION_EXPIRED');
  if (principal) requirePhone(sameBinding(state.grant.authority.binding, principal.authority.binding)
    && state.grant.authority.sessionId === principal.authority.sessionId, 'ACCESS_REVOKED');
}
function check(state: FixtureState, principal: PhoneHostPrincipal, record?: Pick<PhoneCustodyRecord, 'identity' | 'scope'>) {
  current(state, principal); requirePhone(state.sourceExists, 'ACCESS_REVOKED');
  if (!record) return;
  const capability = record.identity.kind === 'approval' ? 'approval.simple' : 'chat';
  requirePhone(state.grant.authority.capabilities.includes(capability), 'CAPABILITY_FORBIDDEN');
  requirePhone(record.scope.revision === `phone-scope:${state.revision}`, 'PREVIEW_CHANGED');
  requirePhone(record.scope.sourceIds.length === 1 && record.scope.sourceIds[0] === SOURCE, 'ACCESS_REVOKED');
  requirePhone(record.scope.operationVersion === (record.identity.kind === 'approval' ? state.action.operationVersion : 'phone-chat:1.0'), 'PREVIEW_CHANGED');
  if (record.identity.kind === 'approval') {
    const challenge = state.challenges[record.identity.target!];
    requirePhone(challenge && challenge.preview.actionRevision === state.action.actionRevision
      && challenge.preview.digest === state.action.digest && challenge.preview.operationVersion === state.action.operationVersion,
    'PREVIEW_CHANGED');
  }
}
function approvalPrincipal(state: FixtureState, desktop: boolean): ApprovalPrincipal {
  return { authority: { ...structuredClone(state.grant.authority), validatedAt: new Date(state.now).toISOString(),
    ...(desktop ? { sessionId: 'synthetic_desktop_session', binding: { ...state.grant.authority.binding, deviceId: 'synthetic_desktop' } } : {}) },
  role: state.role, channel: desktop ? 'desktop' : 'ios', online: true, sourceTainted: false };
}
function session(state: FixtureState, desktop: boolean): ApprovalSession {
  if (state.revoked) return { status: 'revoked' };
  if (Date.parse(state.grant.authority.expiresAt) <= state.now) return { status: 'expired' };
  if (!state.paired) return { status: 'unpaired' };
  return { status: 'current', principal: approvalPrincipal(state, desktop) };
}
function approvalLedger(backend: FixtureBackend): PhoneApprovalLedger<string> {
  return { transaction: work => backend.transaction(state => {
    const transaction: PhoneApprovalTransaction<string> = {
      session: context => session(state, context === 'desktop'),
      targetSession: binding => sameBinding(binding, state.grant.authority.binding) ? session(state, false) : { status: 'unpaired' },
      action: (id, principal) => state.sourceExists && id === state.action.actionId
        && principal.authority.binding.workspaceId === state.action.workspaceId ? state.action : undefined,
      challenge: id => state.challenges[id],
      insertChallenge: record => { assert.equal(state.challenges[record.preview.approvalId], undefined); state.challenges[record.preview.approvalId] = structuredClone(record); },
      commitDecision: consumption => {
        const challenge = state.challenges[consumption.approvalId];
        requirePhone(!challenge.consumed && state.action.status === 'prepared', 'APPROVAL_USED');
        const operation = Object.values(state.operations).find(row => row.record.identity.requestId === consumption.requestId);
        requirePhone(operation, 'INVALID_REQUEST');
        requirePhone(!['succeeded', 'cancelled', 'failed'].includes(operation.result.status), 'APPROVAL_USED');
        check(state, { authority: approvalPrincipal(state, false).authority, channel: 'ios', role: state.role }, operation.record);
        challenge.consumed = true; state.action.status = consumption.receipt.decision;
        state.receipts[consumption.approvalId] = structuredClone(consumption);
        // Decision disposition and readback commit together. No action execution occurs.
        operation.result = { status: 'succeeded', requestId: consumption.requestId, result: structuredClone(consumption.receipt) };
        state.effects++;
      },
      receipt: id => state.receipts[id],
    };
    return work(transaction);
  }) };
}

async function initialize(directory: string, engine: Engine, backend: FixtureBackend) {
  try { await backend.read(); await engine.request('workspace.open', { folder: 'business', passphrase: PASSWORD }); return; }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const created = await engine.request('workspace.create', { name: 'Synthetic phone business', folder: 'business', passphrase: PASSWORD, demo: false, pack: 'ecommerce' });
  const imported = await engine.request('sources.import', { sourceId: SOURCE, format: 'csv',
    content: 'id,kind,date,amount,currency,branch,status\nfirst,invoice,2026-09-02,100.00,INR,main,issued\nsecond,invoice,2026-09-03,200.00,INR,main,issued\noutside,invoice,2026-08-01,900.00,INR,main,issued',
    expectedTotals: { rowCount: 3, amountMinor: '120000' },
    recipe: { version: 1, id: 'synthetic-phone-map', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic phone business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  assert.equal(imported.coverage.reconciled, true);
  await engine.request('models.configure', { config: { id: 'synthetic_phone_route', kind: 'openai-responses', model: 'synthetic-authored-phone-planner',
    endpoint: ENDPOINT, budgetMinor: '100', maxCostMinor: '1' }, secret: 'synthetic-fixture-only-value' });
  await engine.request('trust.update', { send: 'shape' });
  // Explicit desktop review happens before this exact response is offered to the phone.
  const question = { question: FIXTURE_QUESTION, purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic_phone_route', sourceIds: [SOURCE] };
  const preview = await engine.request('models.preview', question);
  const approved = await engine.request('models.approve', { id: preview.id });
  const conversation = await engine.request('conversation.ask', { ...question, previewId: preview.id, approvalId: approved.id });
  const calculation = conversation.results[0].answer;
  assert.equal(calculation.totalMinor, '30000'); assert.equal(calculation.rowIds.length, 2);
  const report = await engine.request('reports.brief', { period: PERIOD, onDate: '2026-10-02' });
  assert.ok(report.receiptIds.length > 0);
  const now = Date.parse('2026-10-02T06:00:00.000Z');
  const grant: SessionGrant = { credential: 'synthetic_phone_scoped_credential_' + 'x'.repeat(32), authority: {
    binding: { workspaceId: created.workspace.id, memberId: 'owner', deviceId: FIXTURE_DEVICE_ID, epoch: 1 }, sessionId: 'synthetic_phone_session',
    validatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), capabilities: ['chat', 'brief.read', 'approval.simple'],
  } };
  const digest = createHash('sha256').update('synthetic reversible internal note: Reviewed').digest('hex');
  const state: FixtureState = { now, grant, revoked: false, sourceExists: true, paired: true, inviteUsed: false, revision: 1, channel: 'ios', role: 'owner', nonces: [], operations: {},
    effects: 0, starts: 0, cancels: 0, statusReads: 0, syntheticPlannerCalls: 1, pending: false, loseBackendReply: false, revokeAtStart: false,
    answer: { conversationId: conversation.id, text: `Synthetic authored planner; receipt-backed billed total: ${calculation.display}.`, receiptIds: [calculation.id] },
    calculation, importReconciled: true,
    brief: { id: report.id, workspaceId: created.workspace.id, version: 'synthetic_phone_brief_v1', generatedAt: new Date(now).toISOString(),
      title: report.headline, summary: 'Synthetic Engine brief: ' + report.report.sections.map((section: any) => `${section.title}: ${JSON.stringify(section.figures)}`).join('; '), receiptIds: report.receiptIds },
    action: { actionId: 'synthetic_internal_note', workspaceId: created.workspace.id, actionRevision: 1, operationVersion: 'internal-note:1.0', digest, computedDigest: digest,
      title: 'Review synthetic internal note', summary: 'Set the reversible workspace note to Reviewed.', status: 'prepared', impact: 'reversible', scope: 'workspace', simple: true, approvalAuthorized: true },
    challenges: {}, receipts: {},
  };
  await writeFile(backend.path, JSON.stringify(state));
}

export async function runPhoneFixture(directory: string) {
  const backend = new FixtureBackend(join(directory, 'synthetic-backend.json'));
  let now = Date.parse('2026-10-02T06:00:00.000Z');
  let plannerCalls = 0;
  const engine = new Engine({ directory: join(directory, 'engine'), demo: true, storage: 'experimental-file', gateway: {
    http: async () => { plannerCalls++; return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ status: 'completed', output_text: JSON.stringify({
      kind: 'execute', clarification: null, calls: [{ tool: 'calculator.calculate', args: { operation: 'billed', period: PERIOD, branch: null, customerId: null } }],
    }) }) }; },
  } });
  await initialize(directory, engine, backend); now = (await backend.read()).now;
  const approval = new PhoneApprovalService(approvalLedger(backend), { now: () => now });
  const tokens = new Map<string, ApprovalChallenge>();
  type Gate = { promise: Promise<void>; release: () => void; entered: boolean };
  const gate = (): Gate => { let release!: () => void; return { promise: new Promise<void>(resolvePromise => { release = resolvePromise; }), release, entered: false }; };
  let approvalGate: Gate | undefined;
  let readGate: Gate | undefined;
  let readGateKind: string | undefined;
  const pauseRead = async (kind: string) => { if (readGate && readGateKind === kind) { const paused = readGate; paused.entered = true; await paused.promise; } };
  const verify = (state: FixtureState, authentication: PhoneHostAuthentication, paired: boolean) => {
    if (paired) current(state);
    const { proof } = authentication;
    requirePhone(proof.deviceId === state.grant.authority.binding.deviceId && proof.keyId === FIXTURE_KEY_ID
      && Math.abs(Date.parse(proof.timestamp) - state.now) <= 30000 && !state.nonces.includes(proof.nonce), 'ACCESS_REVOKED');
    const signature = fixtureSignature(authentication.bytes, proof, authentication.credential);
    requirePhone(/^[a-f0-9]{64}$/.test(proof.proof) && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(proof.proof, 'hex')), 'ACCESS_REVOKED');
    if (paired) requirePhone(authentication.credential === state.grant.credential, 'ACCESS_REVOKED');
    state.nonces.push(proof.nonce);
  };
  const scope = (state: FixtureState, operation: PhoneHostOperation): PhoneRequestScope => ({
    revision: `phone-scope:${state.revision}`, operationVersion: operation.kind === 'chat' ? 'phone-chat:1.0' : state.action.operationVersion, sourceIds: [SOURCE],
  });
  const ports: PhoneHostPorts = {
    authenticate: authentication => backend.transaction(state => { verify(state, authentication, true); return {
      authority: { ...structuredClone(state.grant.authority), validatedAt: new Date(state.now).toISOString() }, channel: state.channel, role: state.role,
    } as PhoneHostPrincipal; }),
    pair: (authentication, input) => backend.transaction(state => {
      verify(state, authentication, false);
      requirePhone(!state.revoked && Date.parse(state.grant.authority.expiresAt) > state.now, 'ACCESS_REVOKED');
      requirePhone(!authentication.credential && !state.inviteUsed && input.inviteCode === 'synthetic-desktop-single-use-invite'
        && input.devicePublicKey === 'synthetic-hmac-fixture-key-registration' && input.proof === 'synthetic-fixture-possession', 'ACCESS_REVOKED');
      state.inviteUsed = true; state.paired = true; return state.grant;
    }),
    revoke: (principal, deviceId) => backend.transaction(state => { current(state, principal); requirePhone(deviceId === state.grant.authority.binding.deviceId, 'ACCESS_REVOKED'); state.revoked = true; }),
    release: (principal, resource) => backend.transaction(state => {
      current(state, principal);
      if (resource.kind === 'session') return;
      check(state, principal);
      if (resource.kind === 'requests') {
        for (const record of resource.records) {
          requirePhone(sameBinding(record.binding, principal.authority.binding) && record.sessionId === principal.authority.sessionId, 'ACCESS_REVOKED');
          requirePhone(Date.parse(record.expiresAt) > state.now, 'SESSION_EXPIRED');
          check(state, principal, record);
        }
        return;
      }
      const capability = resource.kind === 'brief' || resource.kind === 'receipt' ? 'brief.read' : 'approval.simple';
      requirePhone(state.grant.authority.capabilities.includes(capability), 'CAPABILITY_FORBIDDEN');
      requirePhone(state.revision === 1, 'PREVIEW_CHANGED');
      if (resource.kind === 'brief') requirePhone(resource.briefs.every(brief => brief.id === state.brief.id
        && brief.version === state.brief.version && JSON.stringify(brief.receiptIds) === JSON.stringify(state.brief.receiptIds)), 'PREVIEW_CHANGED');
      if (resource.kind === 'receipt') requirePhone(state.answer.receiptIds.includes(resource.receiptId) || state.brief.receiptIds.includes(resource.receiptId), 'CAPABILITY_FORBIDDEN');
      if (resource.kind === 'approval' || resource.kind === 'approval-list') {
        requirePhone(state.role === 'owner', 'CAPABILITY_FORBIDDEN');
        const previews = resource.kind === 'approval' ? [resource.preview] : resource.approvalIds.map(id => state.challenges[id]?.preview);
        for (const preview of previews) requirePhone(preview && preview.digest === state.action.digest && state.action.digest === state.action.computedDigest
          && preview.actionRevision === state.action.actionRevision && preview.operationVersion === state.action.operationVersion
          && Date.parse(preview.expiresAt) > state.now && state.action.approvalAuthorized, 'PREVIEW_CHANGED');
      }
    }),
    briefs: async (principal, briefId) => {
      const state = await backend.transaction(state => { check(state, principal); requirePhone(state.grant.authority.capabilities.includes('brief.read'), 'CAPABILITY_FORBIDDEN'); return state; });
      requirePhone(!briefId || briefId === state.brief.id, 'INVALID_REQUEST');
      for (const id of state.brief.receiptIds) await engine.request('receipts.get', { id });
      await pauseRead('brief');
      return [state.brief];
    },
    receipt: async (principal, receiptId) => {
      const state = await backend.transaction(state => { check(state, principal); return state; });
      requirePhone(state.answer.receiptIds.includes(receiptId) || state.brief.receiptIds.includes(receiptId), 'CAPABILITY_FORBIDDEN');
      const receipt = await engine.request('receipts.get', { id: receiptId });
      await pauseRead('receipt');
      return { id: receiptId, workspaceId: state.grant.authority.binding.workspaceId, text: JSON.stringify(receipt) };
    },
    approvals: async principal => { const items = await backend.transaction(state => { check(state, principal); return Object.values(state.challenges)
      .filter(record => !record.consumed).map(record => ({ approvalId: record.preview.approvalId, title: record.preview.title })); }); await pauseRead('approval-list'); return items; },
    inspectApproval: async (principal, id) => { const challenge = await backend.transaction(state => { check(state, principal); const challenge = tokens.get(id);
      requirePhone(challenge && state.challenges[id] && !state.challenges[id].consumed, 'APPROVAL_USED'); return challenge; }); await pauseRead('approval'); return challenge; },
    admit: (principal, operation) => backend.transaction(state => {
      check(state, principal);
      if (operation.kind === 'chat') requirePhone(operation.input.question === FIXTURE_QUESTION, 'OPEN_DESKTOP');
      else {
        const challenge = state.challenges[operation.input.approvalId];
        requirePhone(challenge && !challenge.consumed, 'APPROVAL_USED');
        requirePhone(state.action.impact === 'reversible' && state.action.simple && state.action.scope === 'workspace', 'OPEN_DESKTOP');
        requirePhone(challenge.preview.digest === operation.input.expectedDigest && state.action.digest === operation.input.expectedDigest
          && state.action.actionRevision === operation.input.expectedActionRevision && state.action.operationVersion === operation.input.expectedOperationVersion, 'PREVIEW_CHANGED');
      }
      return scope(state, operation);
    }),
    check: (principal, record) => backend.transaction(state => { check(state, principal, record); }),
    start: async (principal, record, operation) => {
      // Independent trusted permission change commits after admission and before
      // the result transaction, so rejecting the result cannot undo revocation.
      await backend.transaction(state => { if (state.revokeAtStart) state.grant.authority.capabilities = []; });
      const state = await backend.transaction(state => {
        check(state, principal, record);
        const existing = state.operations[record.operationId]; if (existing) return state;
        state.starts++;
        state.operations[record.operationId] = { record, result: { status: 'pending', requestId: record.identity.requestId } };
        if (!state.pending && operation.kind === 'chat') {
          state.operations[record.operationId].result = { status: 'succeeded', requestId: record.identity.requestId, result: state.answer }; state.effects++;
        }
        return state;
      });
      if (!state.pending && operation.kind === 'approval') {
        if (approvalGate) { const paused = approvalGate; paused.entered = true; await paused.promise; }
        const currentOperation = (await backend.read()).operations[record.operationId];
        if (!['succeeded', 'cancelled', 'failed'].includes(currentOperation.result.status)) await approval.decide('phone', operation.input);
      }
      if (state.loseBackendReply) throw new PhoneError('TRANSPORT_UNKNOWN');
      return (await backend.read()).operations[record.operationId].result;
    },
    status: (principal, record) => backend.transaction(state => { check(state, principal, record); state.statusReads++;
      return state.operations[record.operationId]?.result ?? { status: 'unknown', requestId: record.identity.requestId }; }),
    cancel: (principal, record) => backend.transaction(state => { check(state, principal, record); state.cancels++;
      const existing = state.operations[record.operationId];
      if (existing && ['succeeded', 'failed', 'cancelled'].includes(existing.result.status)) return existing.result;
      const cancelled = { status: 'cancelled' as const, requestId: record.identity.requestId };
      state.operations[record.operationId] = { record, result: cancelled }; return cancelled;
    }),
  };
  await mkdir(join(directory, 'request-custody'), { recursive: true });
  const custody = new PhoneRequestCustody(new EncryptedFilePhoneCustodyStorage({ directory: join(directory, 'request-custody'), custodyId: 'synthetic_phone_custody', key: CUSTODY_KEY }));
  const handler = createPhoneHttpHandler(new PhoneHost({ ports, custody, clock: () => now }));
  const server = createServer((request, response) => {
    if (request.headers['x-fixture-drop-ack'] === '1') {
      response.end = (() => { response.destroy(); return response; }) as typeof response.end;
    }
    void handler(request, response);
  });
  await new Promise<void>((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolvePromise()); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/companion/rpc`;
  return { url, engine, async command(input: any) {
    if (input.kind === 'inspect') return { ...(await backend.read()), plannerCallsInThisProcess: plannerCalls,
      approvalPaused: approvalGate?.entered ?? false, readPaused: readGate?.entered ?? false };
    if (input.kind === 'pauseApproval') { approvalGate = gate(); return true; }
    if (input.kind === 'releaseApproval') { approvalGate?.release(); approvalGate = undefined; return true; }
    if (input.kind === 'pauseRead') { readGate = gate(); readGateKind = input.resource; return true; }
    if (input.kind === 'releaseRead') { readGate?.release(); readGate = undefined; return true; }
    if (input.kind === 'issue') { const challenge = await approval.issue('desktop', (await backend.read()).grant.authority.binding, 'synthetic_internal_note'); tokens.set(challenge.preview.approvalId, challenge); return challenge; }
    if (input.kind === 'deleteSource') { await engine.request('sources.delete', { id: SOURCE }); await backend.transaction(state => { state.sourceExists = false; }); return true; }
    if (input.kind === 'change') return backend.transaction(state => {
      const allowed = ['revoked', 'sourceExists', 'paired', 'pending', 'loseBackendReply', 'revokeAtStart', 'revision', 'channel', 'role'] as const;
      for (const key of allowed) if (input[key] !== undefined) (state as any)[key] = input[key];
      if (input.advance !== undefined) { state.now += input.advance; now = state.now; }
      if (input.capabilities !== undefined) state.grant.authority.capabilities = input.capabilities as PhoneCapability[];
      if (input.action !== undefined) Object.assign(state.action, input.action);
      return true;
    });
    throw new Error('Unknown synthetic fixture command');
  }, async close() { approvalGate?.release(); readGate?.release(); await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise())); await engine.close(); } };
}

if (process.argv[2] === '--phone-http-worker' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await runPhoneFixture(resolve(process.argv[3]));
  process.send?.({ ready: true, url: fixture.url });
  process.on('message', async (message: any) => {
    try {
      if (message.kind === 'stop') { await fixture.close(); process.send?.({ id: message.id, result: true }); process.disconnect(); return; }
      const result = await fixture.command(message); process.send?.({ id: message.id, result });
    } catch (error) { process.send?.({ id: message.id, error: error instanceof PhoneError ? error.code : (error as Error).message }); }
  });
}
