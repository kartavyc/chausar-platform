import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine, type EngineOptions} from '../../runtime/engine.ts';
import {createLocalServer} from '../../runtime/server.ts';
import type {ModelRequest} from '../../runtime/gateway.ts';
import type {PhoneCapability, SessionGrant} from '../../runtime/phone/contracts.ts';

export const SOURCE_A = 'independent-phone-invoices-a';
export const SOURCE_B = 'independent-phone-invoices-b';
export const PERIOD = {from: '2026-09-01', to: '2026-09-30'};
export const OBJECTIVE = 'What was billed for the period I choose?';
export const REPLY = 'September, please.';
export const CLARIFICATION = 'Which reporting period do you mean?';
export const SECRET = 'SYNTHETIC_PRIVATE_PHONE_INVOICE_DESCRIPTION_418907';
const PASSWORD = 'Synthetic independent phone continuation credential';
const FOLDER = 'continuation';
const ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const ROUTE = 'independent-phone-continuation-planner';

export const clarify = {kind: 'clarification', calls: [], clarification: CLARIFICATION};
export const billed = {kind: 'execute', calls: [{tool: 'calculator.calculate', args: {
  operation: 'billed', period: PERIOD, branch: null, customerId: null,
}}], clarification: null};
// Intentionally incomplete authored wire. Acceptance must not fill its missing selectors.
export const incomplete = {kind: 'execute', calls: [{tool: 'calculator.calculate', args: {
  operation: 'billed',
}}], clarification: null};

type Envelope = {result?: any; error?: {code: string; message?: string}};
type Response = {status: number; body: Envelope};
type Signed = {body: string; nonce: string; headers: Record<string, string>};

// Actual paired loopback HTTP and encrypted Vault files. Provider output alone is
// an authored fixture; neither real inference nor mobile/native qualification is claimed.
export async function fixture(t: TestContext, plans: readonly unknown[]) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:[\\/]/i);
  const prefix = 'chausar-independent-phone-continuation-';
  const directory = await realpath(await mkdtemp(join(base, prefix)));
  assert.equal(dirname(directory), base);
  const calls: {body: string; endpoint: string}[] = [];
  const options: EngineOptions = {directory, demo: true, storage: 'experimental-file', gateway: {
    http: async request => {
      const plan = plans[calls.length];
      calls.push({body: request.body, endpoint: request.endpoint});
      assert.equal(request.endpoint, ENDPOINT);
      assert.notEqual(plan, undefined, 'Only explicitly authored fixture responses are available.');
      return {status: 200, endpoint: ENDPOINT, body: JSON.stringify({done: true, done_reason: 'stop',
        message: {role: 'assistant', content: JSON.stringify(plan)}})};
    },
  }};
  let engine = new Engine(options), app = createLocalServer(engine), host = await app.listen();
  t.after(async () => {
    await app.close(5000);
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith(prefix));
    await rm(actual, {recursive: true, force: true});
  });
  const desktopRaw = async (method: string, payload: unknown = {}, token = host.token): Promise<Response> => {
    const response = await fetch(`${host.origin}/api/rpc`, {method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, body: JSON.stringify({method, payload})});
    return {status: response.status, body: await response.json() as Envelope};
  };
  const desktop = async <T = any>(method: string, payload: unknown = {}, token = host.token): Promise<T> => {
    const response = await desktopRaw(method, payload, token);
    assert.equal(response.status, 200, `${method}: ${response.body.error?.code}`);
    assert.equal(response.body.error, undefined); return response.body.result as T;
  };
  const desktopRefuse = async (method: string, payload: unknown, code: string, token = host.token) => {
    const response = await desktopRaw(method, payload, token);
    assert.notEqual(response.status, 200); assert.equal(response.body.result, undefined);
    assert.equal(response.body.error?.code, code);
  };
  async function pairDesktop() {
    assert.equal(new URL(host.origin).hostname, '127.0.0.1');
    const paired = await fetch(`${host.origin}/api/session`, {headers: {authorization: `Bearer ${host.token}`}});
    assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), {token: host.token});
  }
  await pairDesktop();
  await desktop('workspace.create', {name: `Independent synthetic phone ${SECRET}`, folder: FOLDER,
    passphrase: PASSWORD, demo: false, pack: 'ecommerce'});
  const recipe = (source: string) => ({version: 1, id: `${source}-mapping`, system: 'synthetic-csv', edition: '1',
    scope: {company: 'Independent synthetic phone invoices', branches: ['main']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      {target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject'},
      ...['currency', 'branch', 'status', 'description'].map(field => ({target: field, source: field, type: 'string', nulls: 'reject'})),
    ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject'});
  const header = 'id,kind,date,amount,currency,branch,status,description\n';
  const a = await desktop('sources.import', {sourceId: SOURCE_A, format: 'csv', recipe: recipe(SOURCE_A),
    content: header + `a-first,invoice,2026-09-02,101.03,INR,main,issued,${SECRET}\n`
      + `a-second,invoice,2026-09-21,220.07,INR,main,issued,${SECRET}\n`
      + `a-outside,invoice,2026-08-02,9000.00,INR,main,issued,${SECRET}\n`,
    expectedTotals: {rowCount: 3, amountMinor: '932110'}});
  const b = await desktop('sources.import', {sourceId: SOURCE_B, format: 'csv', recipe: recipe(SOURCE_B),
    content: header + `b-outside-scope,invoice,2026-09-05,8888.88,INR,main,issued,${SECRET}\n`,
    expectedTotals: {rowCount: 1, amountMinor: '888888'}});
  assert.equal(a.coverage.reconciled, true); assert.equal(a.totalsMinor, '932110');
  assert.equal(b.coverage.reconciled, true); assert.equal(b.totalsMinor, '888888');
  // Credential-free authored route survives a genuine Engine restart without importing any key.
  await desktop('models.configure', {config: {id: ROUTE, kind: 'ollama', model: 'authored-phone-fixture',
    endpoint: ENDPOINT, enabled: true, budgetMinor: '0', maxCostMinor: '0'}});
  await desktop('trust.update', {send: 'shape', retentionDays: 3650});

  let deviceOrdinal = 0;
  async function pair(input: {memberId?: string; desktopToken?: string; capabilities?: PhoneCapability[]} = {}) {
    deviceOrdinal++;
    const deviceId = `independent-phone-device-${deviceOrdinal}`, keyId = `independent-phone-key-${deviceOrdinal}`;
    const keys = generateKeyPairSync('ed25519');
    const devicePublicKey = keys.publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
    // Independent literal documented wire oracle; do not call production signing helpers.
    const signed = (method: string, payload: unknown = {}, credential?: string, reusedNonce?: string): Signed => {
      const body = JSON.stringify({protocolVersion: 1, method, payload}), timestamp = new Date().toISOString();
      const nonce = reusedNonce ?? randomBytes(32).toString('base64url');
      const credentialHash = credential === undefined ? null
        : createHash('sha256').update('chausar-phone-credential-v1\n' + credential).digest('hex');
      const bytes = Buffer.from(JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc',
        deviceId, keyId, timestamp, nonce, credentialHash, Buffer.byteLength(body)]) + '\n' + body);
      return {body, nonce, headers: {'content-type': 'application/json', 'x-chausar-device': deviceId,
        'x-chausar-key': keyId, 'x-chausar-time': timestamp, 'x-chausar-nonce': nonce,
        'x-chausar-proof': sign(null, bytes, keys.privateKey).toString('base64url'),
        ...(credential === undefined ? {} : {authorization: `Bearer ${credential}`})}};
    };
    const wire = async (call: Signed): Promise<Response> => {
      const response = await fetch(`${host.origin}/api/companion/rpc`, {method: 'POST', headers: call.headers, body: call.body});
      return {status: response.status, body: await response.json() as Envelope};
    };
    const invite = await desktop('phone.invite', {memberId: input.memberId ?? 'owner', deviceId, keyId, channel: 'web',
      devicePublicKey, capabilities: input.capabilities ?? ['chat', 'brief.read'], inviteTtlMs: 60000, sessionTtlMs: 3600000}, input.desktopToken);
    const proof = sign(null, Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', invite.inviteCode,
      deviceId, 'web', keyId, devicePublicKey])), keys.privateKey).toString('base64url');
    const paired = await wire(signed('pairing.accept', {inviteCode: invite.inviteCode, deviceId,
      channel: 'web', devicePublicKey, proof}));
    assert.equal(paired.status, 200); assert.equal(paired.body.error, undefined);
    const grant = paired.body.result as SessionGrant;
    assert.equal(grant.authority.binding.deviceId, deviceId); assert.equal(grant.authority.binding.memberId, input.memberId ?? 'owner');
    assert.notEqual(grant.credential, host.token); assert.notEqual(grant.credential, invite.inviteCode);
    const raw = (method: string, payload: unknown = {}) => wire(signed(method, payload, grant.credential));
    const phone = async <T = any>(method: string, payload: unknown = {}): Promise<T> => {
      const response = await raw(method, payload);
      assert.equal(response.status, 200, `${method}: ${response.body.error?.code}`);
      assert.equal(response.body.error, undefined); return response.body.result as T;
    };
    const refuse = async (method: string, payload: unknown, code: string, status: number) => {
      const response = await raw(method, payload);
      assert.equal(response.status, status); assert.equal(response.body.error?.code, code);
      assert.equal(response.body.result, undefined);
    };
    return {grant, deviceId, keyId, signed, wire, raw, phone, refuse};
  }
  const offer = async (device: Awaited<ReturnType<typeof pair>>, input: Omit<ModelRequest, 'previewId' | 'approvalId'>,
    desktopToken = host.token) => {
    const beforeCalls = calls.length;
    const request = {purpose: 'conversation' as const, questionDisclosure: 'verbatim' as const, routeId: ROUTE, ...input};
    const preview = await desktop('models.preview', request, desktopToken);
    const approval = await desktop('models.approve', {id: preview.id}, desktopToken);
    const exactRequest = {...request, previewId: preview.id, approvalId: approval.id};
    const offered = await desktop('phone.conversation.offer', {sessionId: device.grant.authority.sessionId,
      request: exactRequest}, desktopToken);
    assert.equal(offered.previewId, preview.id); assert.equal(calls.length, beforeCalls, 'Review and transfer do not dispatch.');
    return {request: exactRequest, preview, approval, offered};
  };
  const restart = async () => {
    const previousEngine = engine, previousToken = host.token;
    await desktop('workspace.lock'); await app.close(5000);
    engine = new Engine(options); assert.notEqual(engine, previousEngine);
    app = createLocalServer(engine); host = await app.listen(); await pairDesktop();
    await desktop('workspace.open', {folder: FOLDER, passphrase: PASSWORD});
    assert.notEqual(host.token, previousToken); return previousToken;
  };
  const assertLocal = () => {const state = engine.vault!.read();
    assert.deepEqual(state.actions, []); assert.deepEqual(state.jobs, []); assert.deepEqual(state.schedules, []);
  };
  const ciphertext = () => readFile(join(directory, FOLDER, 'authority.encrypted.json'));
  return {desktop, desktopRaw, desktopRefuse, pair, offer, restart, assertLocal, ciphertext, calls, directory,
    get engine() {return engine;}, get token() {return host.token;}};
}
