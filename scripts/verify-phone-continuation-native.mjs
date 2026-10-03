import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { QualificationError, disposablePostgresConfiguration, assertPristinePostgres } from './verify-database-differential.mjs';

const FILE = fileURLToPath(import.meta.url);
const SOURCE_COMMIT = '87c400870563b92803841d3a198cee801f7740df';
const SOURCE_TREE = '84658363a35be7f31a148d676fdea18ec3669e68';
const TASK_ROOT = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
const PASSWORD = 'Public synthetic native phone continuation fixture passphrase only';
const FOLDER = 'continuation';
const SOURCE_A = 'synthetic-native-phone-invoices-a';
const SOURCE_B = 'synthetic-native-phone-invoices-b';
const SECRET = 'PUBLIC_SYNTHETIC_PRIVATE_PHONE_DESCRIPTION_418907';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const OBJECTIVE = 'What was billed for the period I choose?';
const REPLY = 'September, please.';
const CLARIFICATION = 'Which reporting period do you mean?';
const ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const ROUTE = 'synthetic-native-phone-continuation-planner';
const PLANS = [
  { kind: 'clarification', calls: [], clarification: CLARIFICATION },
  { kind: 'execute', calls: [{ tool: 'calculator.calculate', args: {
    operation: 'billed', period: PERIOD, branch: null, customerId: null,
  } }], clarification: null },
];
// RFC 8032 section 7.1 test vectors 1 and 2: public, deliberately unsuitable
// for real credentials. Import existing fixture material; never generate a key.
const PUBLIC_TEST_VECTORS = [
  { seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    public: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a' },
  { seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    public: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c' },
];
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
function requireCondition(condition, code, message) {
  if (!condition) throw new QualificationError(code, message);
}
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'NATIVE_PHONE_QUALIFICATION_FAILED';

async function qualificationRoot(environment) {
  const value = environment.CHAUSAR_QUALIFICATION_RUN_ROOT;
  requireCondition(typeof value === 'string' && value.length > 0 && isAbsolute(value),
    'QUALIFICATION_RUN_ROOT_REQUIRED', 'Provide an existing C-drive task-4 qualification root.');
  const selected = resolve(value);
  requireCondition(process.platform === 'win32' && /^C:\\/i.test(selected)
    && folded(selected).startsWith(folded(TASK_ROOT + sep)),
  'QUALIFICATION_RUN_ROOT_INVALID', 'The run root must be strictly inside the approved C-drive task-4 directory.');
  const physical = await realpath(selected), metadata = await lstat(selected);
  requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() && folded(physical) === folded(selected),
    'QUALIFICATION_RUN_ROOT_INVALID', 'Use an existing canonical qualification directory without a symlink.');
  const expectedTemporary = join(physical, 'temp');
  for (const name of ['TEMP', 'TMP']) requireCondition(typeof environment[name] === 'string'
    && folded(resolve(environment[name])) === folded(expectedTemporary)
    && typeof process.env[name] === 'string' && folded(resolve(process.env[name])) === folded(expectedTemporary),
  'QUALIFICATION_TEMP_ROOT_INVALID', 'Both supplied and actual TEMP/TMP must use runRoot/temp.');
  requireCondition(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE,
    'QUALIFICATION_COMPILE_CACHE_REFUSED', 'Disable inherited Node compile-cache writes.');
  const temporary = resolve(tmpdir()), tempMetadata = await lstat(temporary);
  requireCondition(folded(temporary) === folded(expectedTemporary)
    && folded(await realpath(temporary)) === folded(expectedTemporary)
    && tempMetadata.isDirectory() && !tempMetadata.isSymbolicLink(),
  'QUALIFICATION_TEMP_ROOT_INVALID', 'The actual process temporary directory must be canonical runRoot/temp.');
  return physical;
}

function sourceInput(sourceId, content, rowCount, amountMinor) {
  return { sourceId, format: 'csv', content, expectedTotals: { rowCount, amountMinor }, recipe: {
    version: 1, id: sourceId + '-mapping', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Native Phone Invoices', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject',
  } };
}
function custody(state) {
  const matches = state.conversations.filter(row => row?.kind === 'engine-phone-runtime');
  assert.equal(matches.length, 1);
  return matches[0];
}
function exactOffer(state, previewId) {
  const matches = custody(state).offers.filter(row => row.request.previewId === previewId);
  assert.equal(matches.length, 1);
  return structuredClone(matches[0]);
}
function businessIdentity(state, pendingId, conversationId, receiptId) {
  return {
    receiptIds: state.receipts.map(row => row.id).sort(),
    history: state.conversations.filter(row => [pendingId, conversationId].includes(row.id)),
    resolutions: state.conversations.filter(row => row.kind === 'conversation-continuation-resolved'),
    receipt: state.receipts.find(row => row.id === receiptId),
    offers: custody(state).offers,
    intents: custody(state).intents.map(row => ({ ...row, operationIds: [...row.operationIds].sort() })),
  };
}

/** Synthetic public-route test only. The coordinator supplies a fresh database
 * and a 240-second process ceiling. This runner does not provision/launch PG,
 * install anything, launch arbitrary helpers, write on D, or call a live model.
 * Default DuckDB verification uses the production Node child worker.
 * Only the direct CLI entry writes the single JSON report to stdout.
 */
export async function runPhoneContinuationNativeQualification(environment = process.env) {
  const report = {
    suite: 'native-postgresql-storage-duckdb-public-phone-continuation', passed: false,
    sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null, foundationCommit: SOURCE_COMMIT,
    sourceTree: SOURCE_TREE, sourceCommitVerification: 'supervisor-reported-exact-baseline',
    checks: [], blockers: [], node: process.version,
    engines: { postgresStorage: 'not-executed', duckdbArithmetic: 'not-executed' },
    syntheticGatewayCalls: 0, liveNetworkCalls: 0, loopbackHttpCalls: 0,
    signingMaterial: 'Imported known-public RFC 8032 section 7.1 test vectors 1 and 2, memory only; no generated signing keys.',
    planner: 'Exactly two literal authored Gateway.http responses; no provider, inference, or language understanding qualification.',
    scope: 'Production PostgreSQL encrypted snapshot authority, default native DuckDB arithmetic, actual signed loopback phone HTTP, reviewed continuation, immutable offered requests, nonce persistence, binding, retries, lock and new-Engine reopening.',
    productionDefaultSelected: false, fullScopeQualified: false,
    limitations: [
      'PostgreSQL stores encrypted snapshots; this gate does not qualify normalized persistent business-claim SQL.',
      'Loopback HTTP is real; no external provider request is made. liveNetworkCalls excludes the explicitly supervised loopback HTTP and PostgreSQL connections.',
      'No native mobile app, remote relay, TLS, protected-key custody, installed desktop, crash/power-loss or PGlite qualification.',
      'No encrypted archive/activation qualification; the parent owns that separate gate.',
      'Failed/incomplete planner continuation and multi-member revocation are covered by source tests, not this two-response native scenario.',
      'Signed authentication persists nonces, so idempotency concerns business results and exact reviewed selectors, not a constant global Vault revision.',
      'The coordinator must enforce the external process ceiling and recreate chausar_test between runners.',
      'Native DuckDB uses the production bounded Node child worker; the supervisor must include it in process cleanup.',
    ],
  };
  const started = Date.now(), calls = [], ownedSlots = new Set();
  let pool, engine, app, host, directory, stage = 'fixture-preflight';
  let loopbackHttpCalls = 0;
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  const failure = (name, error) => {
    const reason = safeCode(error); report.checks.push({ name, passed: false, reason }); return reason;
  };
  try {
    requireCondition(environment.CHAUSAR_SOURCE_COMMIT === SOURCE_COMMIT,
      'SOURCE_COMMIT_PIN_REQUIRED', 'The supervisor must pin the exact published source baseline.');
    const configuration = disposablePostgresConfiguration(environment), root = await qualificationRoot(environment);
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({ ...configuration, max: 2, connectionTimeoutMillis: 5000, query_timeout: 17000,
      application_name: 'chausar-native-phone-qualification', ssl: false,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
    await assertPristinePostgres(pool);
    const identity = (await pool.query("SELECT version() AS version,host(inet_server_addr()) AS host_address,inet_server_port() AS port,current_setting('data_directory') AS data_directory")).rows;
    requireCondition(identity.length === 1 && identity[0].host_address === configuration.host && identity[0].port === configuration.port,
      'DATABASE_ADDRESS_IDENTITY_MISMATCH', 'The actual server must identify the explicit loopback address and port.');
    requireCondition(typeof identity[0].data_directory === 'string' && isAbsolute(identity[0].data_directory),
      'DATABASE_DATA_DIRECTORY_INVALID', 'The PostgreSQL cluster must declare its absolute C-drive data directory.');
    const dataDirectory = resolve(identity[0].data_directory), dataMetadata = await lstat(dataDirectory);
    requireCondition(/^C:\\/i.test(dataDirectory) && folded(dataDirectory).startsWith(folded(TASK_ROOT + sep))
      && folded(await realpath(dataDirectory)) === folded(dataDirectory) && dataMetadata.isDirectory() && !dataMetadata.isSymbolicLink(),
    'DATABASE_DATA_DIRECTORY_INVALID', 'The actual PostgreSQL data directory must be canonical and strictly inside task-4.');
    report.engines.postgresStorage = { version: identity[0].version, database: 'chausar_test' };
    report.environmentGuards = { runRoot: root, temporaryDirectory: join(root, 'temp'), postgresDataDirectory: dataDirectory,
      compileCacheEnvironment: 'unset', generatedPaths: 'C-drive-task-4-only' };
    record('strict-pristine-loopback-postgresql-and-c-drive-preflight', 'actual-postgresql-read-only-identity',
      { host: identity[0].host_address, port: identity[0].port });
    directory = join(root, 'phone-continuation');
    await mkdir(directory); // Never adopt an existing fixture directory.
    assert.equal(dirname(await realpath(directory)), root);
    report.directory = directory;
    const options = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL,
      gateway: { http: async request => {
        assert.equal(request.endpoint, ENDPOINT);
        const plan = PLANS[calls.length]; assert.notEqual(plan, undefined, 'No additional authored planner response exists.');
        calls.push({ body: request.body, endpoint: request.endpoint });
        return { status: 200, endpoint: ENDPOINT, body: JSON.stringify({ done: true, done_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(plan) } }) };
      } } };
    const loopback = async (pathname, init) => {
      const selected = new URL(pathname, host.origin);
      assert.equal(selected.origin, host.origin); assert.equal(selected.hostname, '127.0.0.1');
      loopbackHttpCalls++;
      const response = await fetch(selected, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
      return { status: response.status, body: await response.json() };
    };
    const desktopRaw = (method, payload = {}, token = host.token) => loopback('/api/rpc', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }),
    });
    const desktop = async (method, payload = {}) => {
      const response = await desktopRaw(method, payload);
      assert.equal(response.status, 200, method + ': ' + response.body.error?.code);
      assert.equal(response.body.error, undefined); return response.body.result;
    };
    const desktopRefuse = async (method, payload, code) => {
      const response = await desktopRaw(method, payload);
      assert.notEqual(response.status, 200); assert.equal(response.body.error?.code, code); assert.equal(response.body.result, undefined);
    };
    let hostGeneration = 0;
    const startHost = async () => {
      engine = new Engine(options);
      // Known-public fixture bearer avoids creating a persistent host credential.
      app = createLocalServer(engine, { token: createHash('sha256').update('Public synthetic native phone host ' + (++hostGeneration)).digest('hex') });
      host = await app.listen(); assert.equal(new URL(host.origin).hostname, '127.0.0.1');
      const paired = await loopback('/api/session', { headers: { authorization: 'Bearer ' + host.token } });
      assert.equal(paired.status, 200); assert.deepEqual(paired.body, { token: host.token });
    };
    const restart = async () => {
      const oldToken = host.token, oldEngine = engine;
      await desktop('workspace.lock'); await app.close(10000); app = null; engine = null;
      await startHost(); assert.notEqual(engine, oldEngine); assert.notEqual(host.token, oldToken);
      await desktop('workspace.open', { folder: FOLDER, passphrase: PASSWORD });
      assert.equal(engine.vault.storageKind, 'postgres'); return oldToken;
    };
    await startHost();
    stage = 'public-postgresql-workspace-and-exact-imports';
    const slot = hash(join(directory, FOLDER)); ownedSlots.add(slot);
    await desktop('workspace.create', { name: 'Synthetic Native Phone ' + SECRET, folder: FOLDER,
      pack: 'ecommerce', passphrase: PASSWORD, demo: false });
    assert.equal(engine.vault.storageKind, 'postgres'); assert.equal(engine.options.demo, false);
    record('production-postgresql-workspace-through-local-public-http', 'actual-loopback-http-and-postgresql-snapshot-authority');
    const header = 'id,kind,date,amount,currency,branch,status,description\n';
    const aInput = sourceInput(SOURCE_A, header
      + `a-first,invoice,2026-09-02,101.03,INR,main,issued,${SECRET}\n`
      + `a-second,invoice,2026-09-21,220.07,INR,main,issued,${SECRET}\n`
      + `a-outside,invoice,2026-08-02,9000.00,INR,main,issued,${SECRET}\n`, 3, '932110');
    const bInput = sourceInput(SOURCE_B, header + `b-excluded,invoice,2026-09-05,8888.88,INR,main,issued,${SECRET}\n`, 1, '888888');
    const a = await desktop('sources.import', aInput), b = await desktop('sources.import', bInput);
    assert.equal(a.coverage.reconciled, true); assert.equal(a.totalsMinor, '932110');
    assert.equal(b.coverage.reconciled, true); assert.equal(b.totalsMinor, '888888');
    const facts = hash(engine.vault.read().facts), imports = hash(engine.vault.read().imports);
    const duplicate = await desktop('sources.import', aInput);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.id, a.id);
    assert.equal(hash(engine.vault.read().facts), facts); assert.equal(hash(engine.vault.read().imports), imports);
    record('public-exact-decimal-imports-and-duplicate-no-op', 'actual-postgresql-public-import', { sourceATotalMinor: '932110', sourceBTotalMinor: '888888' });
    await desktop('models.configure', { config: { id: ROUTE, kind: 'ollama', model: 'authored-native-phone-fixture',
      endpoint: ENDPOINT, enabled: true, budgetMinor: '0', maxCostMinor: '0' } });
    await desktop('trust.update', { send: 'shape', retentionDays: 3650 });
    let deviceOrdinal = 0;
    const pair = async () => {
      const vector = PUBLIC_TEST_VECTORS[deviceOrdinal]; assert.ok(vector, 'Only two public synthetic devices are available.');
      deviceOrdinal++;
      const deviceId = 'native-phone-device-' + deviceOrdinal, keyId = 'native-phone-key-' + deviceOrdinal;
      const privateKey = createPrivateKey({ format: 'der', type: 'pkcs8',
        key: Buffer.from('302e020100300506032b657004220420' + vector.seed, 'hex') });
      const devicePublicKey = Buffer.from('302a300506032b6570032100' + vector.public, 'hex').toString('base64url');
      assert.equal(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64url'), devicePublicKey);
      const signed = (method, payload = {}, credential, reusedNonce) => {
        const body = JSON.stringify({ protocolVersion: 1, method, payload }), timestamp = new Date().toISOString();
        const nonce = reusedNonce ?? randomBytes(32).toString('base64url');
        const credentialHash = credential === undefined ? null
          : createHash('sha256').update('chausar-phone-credential-v1\n' + credential).digest('hex');
        // Independent literal wire oracle, not a production signing helper.
        const bytes = Buffer.from(JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc',
          deviceId, keyId, timestamp, nonce, credentialHash, Buffer.byteLength(body)]) + '\n' + body);
        return { body, nonce, headers: { 'content-type': 'application/json', 'x-chausar-device': deviceId,
          'x-chausar-key': keyId, 'x-chausar-time': timestamp, 'x-chausar-nonce': nonce,
          'x-chausar-proof': sign(null, bytes, privateKey).toString('base64url'),
          ...(credential === undefined ? {} : { authorization: 'Bearer ' + credential }) } };
      };
      const wire = call => loopback('/api/companion/rpc', { method: 'POST', headers: call.headers, body: call.body });
      const invite = await desktop('phone.invite', { memberId: 'owner', deviceId, keyId, channel: 'web', devicePublicKey,
        capabilities: ['chat', 'brief.read'], inviteTtlMs: 60000, sessionTtlMs: 3600000 });
      const proof = sign(null, Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', invite.inviteCode,
        deviceId, 'web', keyId, devicePublicKey])), privateKey).toString('base64url');
      const paired = await wire(signed('pairing.accept', { inviteCode: invite.inviteCode, deviceId, channel: 'web', devicePublicKey, proof }));
      assert.equal(paired.status, 200); assert.equal(paired.body.error, undefined);
      const grant = paired.body.result;
      assert.equal(grant.authority.binding.deviceId, deviceId); assert.equal(grant.authority.binding.memberId, 'owner');
      assert.notEqual(grant.credential, host.token); assert.notEqual(grant.credential, invite.inviteCode);
      const raw = (method, payload = {}) => wire(signed(method, payload, grant.credential));
      const phone = async (method, payload = {}) => {
        const response = await raw(method, payload);
        assert.equal(response.status, 200, method + ': ' + response.body.error?.code);
        assert.equal(response.body.error, undefined); return response.body.result;
      };
      const refuse = async (method, payload, code, status) => {
        const response = await raw(method, payload);
        assert.equal(response.status, status); assert.equal(response.body.error?.code, code); assert.equal(response.body.result, undefined);
      };
      return { deviceId, keyId, grant, signed, wire, phone, refuse };
    };
    const offer = async (device, input) => {
      const beforeCalls = calls.length;
      const request = { purpose: 'conversation', questionDisclosure: 'verbatim', routeId: ROUTE, ...input };
      const preview = await desktop('models.preview', request), approval = await desktop('models.approve', { id: preview.id });
      const exactRequest = { ...request, previewId: preview.id, approvalId: approval.id };
      const offered = await desktop('phone.conversation.offer', { sessionId: device.grant.authority.sessionId, request: exactRequest });
      assert.equal(offered.previewId, preview.id); assert.equal(calls.length, beforeCalls);
      const stored = exactOffer(engine.vault.read(), preview.id);
      assert.deepEqual(stored.request, exactRequest); assert.deepEqual(stored.principal.authority.binding, device.grant.authority.binding);
      assert.equal(stored.principal.authority.sessionId, device.grant.authority.sessionId);
      return { request: exactRequest, preview, approval, offered, stored };
    };
    stage = 'public-owner-phone-pairing-and-reviewed-original';
    const device = await pair();
    assert.equal((await device.phone('session.validate')).status, 'current');
    const first = await offer(device, { question: OBJECTIVE, sourceIds: [SOURCE_A], branch: 'main' });
    assert.equal(calls.length, 0);
    record('public-pairing-and-exact-reviewed-owner-offer-without-dispatch', 'actual-signed-loopback-phone-and-postgresql-custody');
    const firstInput = { requestId: 'native-phone-original', question: OBJECTIVE };
    const firstResult = await device.phone('chat.start', firstInput);
    assert.equal(firstResult.status, 'succeeded'); assert.deepEqual(firstResult.result.receiptIds, []);
    assert.equal(firstResult.result.text, CLARIFICATION); assert.equal(calls.length, 1); assert.equal(calls[0].body, first.preview.payload);
    record('one-authored-clarification-dispatch-through-public-phone-http', 'actual-gateway-guards-and-postgresql-history', { syntheticGatewayCalls: 1 });
    const pendingId = firstResult.result.conversationId;
    const original = await desktop('conversation.get', { id: pendingId });
    assert.equal(original.kind, 'clarification'); assert.equal(original.answer.clarification, CLARIFICATION);
    const originalBytes = JSON.stringify(original);
    const descriptor = await desktop('conversation.continuation', { id: pendingId });
    assert.equal(descriptor.originalQuestion, OBJECTIVE); assert.equal(descriptor.turnId, pendingId);
    assert.deepEqual(descriptor.sourceIds, [SOURCE_A]);
    assert.deepEqual(descriptor.exchanges, [{ question: OBJECTIVE, clarification: CLARIFICATION }]);
    assert.deepEqual(exactOffer(engine.vault.read(), first.preview.id), first.stored);
    record('retained-original-and-continuation-scope-are-exact', 'public-guarded-conversation-continuation-and-actual-custody');

    stage = 'lock-and-new-engine-retained-clarification';
    const nonceCall = device.signed('session.validate', {}, device.grant.credential);
    assert.equal((await device.wire(nonceCall)).status, 200);
    await desktop('workspace.lock');
    await device.refuse('request.status', { requestId: firstInput.requestId }, 'VAULT_LOCKED', 400);
    await desktop('workspace.open', { folder: FOLDER, passphrase: PASSWORD });
    record('locked-postgresql-workspace-withholds-retained-phone-result', 'actual-public-phone-refusal', { code: 'VAULT_LOCKED' });
    const oldToken = await restart();
    assert.equal((await desktopRaw('workspace.status', {}, oldToken)).status, 401);
    assert.equal((await device.phone('session.validate')).status, 'current');
    assert.deepEqual(await device.phone('request.status', { requestId: firstInput.requestId }), firstResult);
    assert.deepEqual(await desktop('conversation.get', { id: pendingId }), original);
    assert.deepEqual(await desktop('conversation.continuation', { id: pendingId }), descriptor);
    assert.deepEqual(exactOffer(engine.vault.read(), first.preview.id), first.stored);
    assert.equal(calls.length, 1);
    record('new-engine-reopens-encrypted-clarification-grant-offer-and-owner-binding', 'actual-postgresql-reopen-and-loopback-http');
    const nonceReplay = await device.wire(device.signed('session.validate', {}, device.grant.credential, nonceCall.nonce));
    assert.equal(nonceReplay.status, 400); assert.equal(nonceReplay.body.error?.code, 'INVALID_REQUEST'); assert.equal(nonceReplay.body.result, undefined);
    assert.equal(calls.length, 1);
    record('consumed-signed-nonce-remains-refused-after-reopening', 'actual-postgresql-persisted-replay-guard', { code: 'INVALID_REQUEST' });

    stage = 'reviewed-short-continuation-and-default-native-duckdb';
    const followup = await offer(device, { question: REPLY, continuationId: pendingId, period: PERIOD });
    assert.equal(followup.preview.naturalQuestion, REPLY); assert.equal(followup.preview.continuationId, pendingId);
    for (const value of [OBJECTIVE, CLARIFICATION, pendingId]) assert.ok(followup.preview.payload.includes(value));
    assert.equal(followup.preview.payload.includes(SECRET), false);
    assert.equal(calls.length, 1);
    record('explicit-september-continuation-review-preserves-parent-and-private-shape', 'public-reviewed-continuation-offer-no-dispatch');
    const secondInput = { requestId: 'native-phone-continuation', question: REPLY };
    const second = await device.phone('chat.start', secondInput);
    assert.equal(second.status, 'succeeded'); assert.equal(second.result.receiptIds.length, 1);
    assert.equal(calls.length, 2); assert.equal(calls[1].body, followup.preview.payload);
    const receipt = await desktop('receipts.get', { id: second.result.receiptIds[0] });
    // Literal independent answer: 10103 + 22007 = 32110. Neither 900000
    // outside September nor 888888 from the unselected source may contribute.
    assert.equal(receipt.totalMinor, '32110'); assert.equal(receipt.operation, 'billed');
    assert.equal(receipt.currency, 'INR');
    assert.deepEqual(receipt.period, PERIOD); assert.deepEqual(receipt.requestedSourceIds, [SOURCE_A]); assert.equal(receipt.branch, 'main');
    assert.equal(receipt.rows.length, 2); assert.ok(receipt.rows.every(row => row.sourceId === SOURCE_A));
    assert.deepEqual(receipt.rows.map(row => row.amountMinor).sort(), ['10103', '22007']);
    assert.equal(receipt.coverage.completeness, 'reconciled-imports'); assert.equal(receipt.stale, false);
    assert.equal(receipt.databaseProof?.verified, true); assert.equal(receipt.databaseProof?.engine, 'duckdb');
    assert.equal(receipt.databaseProof.receiptId, receipt.id); assert.equal(receipt.databaseProof.operation, 'billed');
    assert.ok(receipt.databaseProof.checks.includes('exact-minor-unit-figures'));
    assert.equal(engine.options.analytics, undefined); // Default native worker, no injected connection.
    report.engines.duckdbArithmetic = 'actual-default-native-worker-verified-receipt';
    report.nativeProof = { engine: receipt.databaseProof.engine, verified: receipt.databaseProof.verified,
      receiptId: receipt.id, projectionDigest: receipt.databaseProof.projectionDigest };
    record('native-duckdb-exact-32110-continuation-with-month-and-source-traps', 'actual-default-native-duckdb-worker-and-postgresql-authority', { totalMinor: '32110', expectedRowMinor: ['10103', '22007'] });
    assert.ok(second.result.text.includes(receipt.explanation)); assert.ok(second.result.text.includes(receipt.figures[0].display));
    assert.equal((await device.phone('receipt.read', { receiptId: receipt.id })).id, receipt.id);
    const retained = await desktop('conversation.get', { id: second.result.conversationId });
    assert.equal(retained.kind, 'grounded-conversation'); assert.equal(retained.answer.results[0].answer.id, receipt.id);
    record('phone-answer-and-guarded-receipt-readback-match-native-grounded-history', 'actual-public-phone-and-desktop-http');
    await desktopRefuse('conversation.continuation', { id: pendingId }, 'CONVERSATION_CONTINUATION_RESOLVED');
    assert.equal(JSON.stringify(await desktop('conversation.get', { id: pendingId })), originalBytes);
    assert.deepEqual(exactOffer(engine.vault.read(), first.preview.id), first.stored);
    assert.deepEqual(exactOffer(engine.vault.read(), followup.preview.id), followup.stored);
    const resolutions = engine.vault.read().conversations.filter(row => row.kind === 'conversation-continuation-resolved');
    assert.equal(resolutions.length, 1); assert.equal(resolutions[0].continuationId, pendingId);
    assert.equal(resolutions[0].answerId, second.result.conversationId);
    record('continuation-consumed-once-and-original-answer-and-offers-immutable', 'actual-postgresql-public-resolution-and-custody', { code: 'CONVERSATION_CONTINUATION_RESOLVED' });

    stage = 'exact-retry-alias-and-request-binding';
    const beforeRetry = businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id);
    assert.deepEqual(await device.phone('chat.start', secondInput), second);
    assert.deepEqual(businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id), beforeRetry);
    record('exact-signed-retry-retains-business-result-without-recalculation', 'actual-postgresql-custody-and-public-phone-retry');
    const aliasInput = { ...secondInput, requestId: 'native-phone-continuation-alias' };
    const alias = await device.phone('chat.start', aliasInput);
    assert.equal(alias.status, 'succeeded'); assert.deepEqual(alias.result, second.result);
    assert.equal(engine.vault.read().receipts.length, beforeRetry.receiptIds.length);
    assert.equal(custody(engine.vault.read()).intents.length, 2); assert.equal(calls.length, 2);
    const aliasIntent = custody(engine.vault.read()).intents.find(row => row.previewId === followup.preview.id);
    assert.equal(aliasIntent.status, 'committed'); assert.equal(aliasIntent.operationIds.length, 2);
    assert.deepEqual(exactOffer(engine.vault.read(), followup.preview.id), followup.stored);
    record('alias-adds-only-operation-binding-and-reuses-one-grounded-result', 'actual-postgresql-custody-alias-no-provider-or-arithmetic-repeat');
    const beforeRefusals = businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id);
    await device.refuse('chat.start', { ...secondInput, question: 'A different unreviewed question' }, 'REQUEST_EXISTS', 400);
    await device.refuse('chat.start', { requestId: 'native-phone-unoffered', question: 'A different unreviewed question' }, 'OPEN_DESKTOP', 400);
    assert.deepEqual(businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id), beforeRefusals);
    assert.equal(calls.length, 2);
    record('changed-request-and-unreviewed-question-refuse-without-business-effects', 'actual-public-phone-exact-input-digest-and-desktop-offer-guards', { codes: ['REQUEST_EXISTS', 'OPEN_DESKTOP'] });
    const otherDevice = await pair();
    assert.deepEqual(await otherDevice.phone('request.status', { requestId: secondInput.requestId }), { status: 'unknown', requestId: secondInput.requestId });
    assert.deepEqual(await otherDevice.phone('request.status', { requestId: aliasInput.requestId }), { status: 'unknown', requestId: aliasInput.requestId });
    assert.equal(calls.length, 2);
    record('different-paired-device-cannot-read-first-device-request-custody', 'actual-two-public-vector-paired-device-bindings');

    stage = 'new-engine-terminal-recovery-and-ciphertext';
    const beforeReopen = businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id);
    await restart();
    assert.deepEqual(await device.phone('request.status', { requestId: secondInput.requestId }), second);
    assert.deepEqual(await device.phone('request.cancel', { requestId: secondInput.requestId }), second);
    assert.deepEqual(await device.phone('chat.start', secondInput), second);
    assert.deepEqual((await device.phone('request.status', { requestId: aliasInput.requestId })).result, second.result);
    assert.deepEqual(await desktop('conversation.get', { id: second.result.conversationId }), retained);
    assert.deepEqual(await desktop('receipts.get', { id: receipt.id }), receipt);
    assert.equal(JSON.stringify(await desktop('conversation.get', { id: pendingId })), originalBytes);
    assert.deepEqual(businessIdentity(engine.vault.read(), pendingId, second.result.conversationId, receipt.id), beforeReopen);
    assert.equal(calls.length, 2);
    record('new-engine-terminal-status-cancel-and-retry-preserve-one-native-result', 'actual-postgresql-reopening-and-public-phone-reconciliation');
    const history = await desktop('conversation.history');
    assert.equal(history.items.filter(row => row.id === pendingId).length, 1);
    assert.equal(history.items.filter(row => row.id === second.result.conversationId).length, 1);
    assert.deepEqual(exactOffer(engine.vault.read(), first.preview.id), first.stored);
    assert.deepEqual(exactOffer(engine.vault.read(), followup.preview.id), followup.stored);
    record('reopened-history-and-full-reviewed-request-selectors-remain-immutable', 'actual-postgresql-history-and-custody-retention');
    const state = engine.vault.read();
    const stored = (await pool.query('SELECT revision::text AS revision,envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [slot])).rows;
    assert.equal(stored.length, 1); assert.equal(stored[0].revision, String(state.revision));
    assert.equal(JSON.parse(stored[0].envelope).format, 'chausar.vault.v1');
    for (const plaintext of [PASSWORD, SECRET, SOURCE_A, SOURCE_B, device.grant.credential, otherDevice.grant.credential,
      firstInput.requestId, secondInput.requestId, pendingId, receipt.id, aInput.content, ...PUBLIC_TEST_VECTORS.map(row => row.seed)])
      assert.equal(stored[0].envelope.includes(plaintext), false);
    record('actual-postgresql-authority-row-keeps-phone-and-business-state-encrypted', 'actual-postgresql-ciphertext-inspection-no-secret-output');

    stage = 'current-source-policy-and-device-revocation';
    await desktop('trust.update', { allowedSources: [SOURCE_B] });
    for (const [method, payload] of [['request.status', { requestId: secondInput.requestId }], ['chat.start', secondInput], ['receipt.read', { receiptId: receipt.id }]])
      await device.refuse(method, payload, 'TRANSPORT_UNKNOWN', 503);
    assert.deepEqual(await desktop('conversation.history'), { items: [] });
    assert.equal((await device.phone('session.validate')).status, 'current');
    assert.equal(calls.length, 2);
    record('current-source-withdrawal-withholds-retained-result-without-redispatch', 'actual-postgresql-public-policy-and-phone-read-release', { code: 'TRANSPORT_UNKNOWN' });
    await restart();
    await device.refuse('receipt.read', { receiptId: receipt.id }, 'TRANSPORT_UNKNOWN', 503);
    await desktop('phone.revoke', { sessionId: device.grant.authority.sessionId });
    await device.refuse('session.validate', {}, 'ACCESS_REVOKED', 401);
    await restart();
    await device.refuse('request.status', { requestId: secondInput.requestId }, 'ACCESS_REVOKED', 401);
    assert.equal((await otherDevice.phone('session.validate')).status, 'current');
    assert.equal(calls.length, 2);
    record('source-withdrawal-and-single-device-revocation-persist-after-new-engine', 'actual-postgresql-public-policy-and-session-fences', { codes: ['TRANSPORT_UNKNOWN', 'ACCESS_REVOKED'] });
    assert.deepEqual(engine.vault.read().actions, []); assert.deepEqual(engine.vault.read().jobs, []); assert.deepEqual(engine.vault.read().schedules, []);
    assert.equal(calls.length, 2); assert.ok(loopbackHttpCalls > 0);
    record('exactly-two-authored-planner-responses-zero-live-provider-calls-and-local-only-effects', 'literal-gateway-http-responses-and-loopback-only-fetch-guard', { syntheticGatewayCalls: 2, liveNetworkCalls: 0 });
  } catch (error) {
    report.blockers.push({ stage, reason: failure(stage, error) });
  } finally {
    try { if (app) { await app.close(10000); app = null; } else await engine?.close(); }
    catch (error) { failure('close-native-phone-http-and-engine', error); }
    if (pool && ownedSlots.size > 0) try {
      const relation = (await pool.query("SELECT to_regclass('public.chausar_vault_authority')::text AS relation")).rows[0].relation;
      if (relation !== null) for (const slot of ownedSlots) await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot=$1', [slot]);
    } catch (error) { failure('delete-only-owned-disposable-phone-authority-slot', error); }
    try { await pool?.end(); } catch (error) { failure('close-disposable-postgresql-inspection-pool', error); }
    report.syntheticGatewayCalls = calls.length; report.loopbackHttpCalls = loopbackHttpCalls;
    report.ownedDisposableSlots = [...ownedSlots]; report.retainedSyntheticFilesystem = directory ?? null;
    report.elapsedMs = Date.now() - started;
    report.expectedSuccessfulChecks = 23;
    report.passed = report.checks.length === report.expectedSuccessfulChecks && report.checks.every(row => row.passed)
      && report.blockers.length === 0 && calls.length === 2 && report.liveNetworkCalls === 0;
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(FILE)) {
  const report = await runPhoneContinuationNativeQualification(process.env);
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}
