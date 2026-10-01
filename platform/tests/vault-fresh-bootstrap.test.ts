import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, hash, type State } from '../runtime/contracts.ts';
import {
  ExperimentalFileSnapshotAdapter, Vault, type CreateBootstrapVaultOptions, type PrivateArtifactRef, type VaultBootstrapBudgets,
  type VaultEncryptedCustodyBudgets, type VaultEnvelope, type VaultWriterGuard,
} from '../runtime/vault.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../runtime/workspace-interchange.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

const budgets: VaultBootstrapBudgets = { maxStateBytes: 1_000_000, maxJsonDepth: 32, maxJsonNodes: 20_000, maxRecords: 1000 };
const artifactBudgets: VaultEncryptedCustodyBudgets = { maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000, maxArtifacts: 32 };
const newPassphrase = 'Synthetic newly allocated bootstrap passphrase';
const sourcePassphrase = 'Synthetic historical source passphrase';
const runtimeArrays = ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts',
  'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const;
const businessArrays = ['facts', 'imports', 'conflicts', 'merges', 'tombstones', 'sourceRules'] as const;
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

let issued: Promise<WorkspaceActivationCommit> | undefined;
function issuedBootstrap() {
  return issued ??= (async () => {
    // Existing host fixture ports issue the fresh State; the tests below use real encrypted Vault persistence.
    const source = deterministicShopState(), target = emptyTarget();
    source.conflicts.push({ id: 'synthetic_conflict', kind: 'unused_kind', status: 'resolved', sourceIds: ['demo-export'] });
    source.merges.push({ id: 'synthetic_merge', type: 'merge', entityIds: ['unused_a', 'unused_b'], targetId: 'unused_a', at: fixedTime, by: 'owner' },
      { id: 'synthetic_undo', type: 'undo', mergeId: 'synthetic_merge', at: fixedTime, by: 'owner' });
    source.tombstones.push({ id: 'synthetic_tombstone', factId: 'unused_deleted_fact', deletedAt: fixedTime });
    source.sourceRules.push({ id: 'synthetic_precedence', kind: 'unused_kind', sourceIds: ['demo-export'], at: fixedTime, by: 'owner' });
    source.sessions.push({ id: 'historical_session_must_remain_inert' });
    source.receipts.push({ id: 'historical_receipt_must_remain_inert' });
    const capture = captureWorkspaceInterchange(source, artifactsFor(source));
    const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }), target: () => target,
      assertCompleteRead: () => {} }).prepare(interchangeOwner, { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
    const retained: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
      pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'bootstrap_candidate', creationId: 'bootstrap_candidate_creation',
        contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory, packageDigest: candidate.packageDigest,
        candidateDigest: interchangeDigest(candidate), target },
      measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
    const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
      owner: { id: 'fresh_bootstrap_owner', name: 'Synthetic fresh bootstrap owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
      context: { memberId: 'fresh_bootstrap_owner', role: 'owner', epoch: 7, channel: 'desktop' },
      sessionAuthorityId: 'fresh_bootstrap_session_authority', createdAt: fixedTime };
    let publication: WorkspaceActivationCommit | undefined;
    const readback = (): WorkspaceActivationReadback => {
      assert.ok(publication); return { status: 'committed', encrypted: true, ciphertextBytes: 1, qualification: 'test-fixture', ...structuredClone(publication) };
    };
    const ports: WorkspaceActivationPorts = {
      custody: { async read(_context, id) { assert.equal(id, retained.pin.recordId); return structuredClone(retained); } },
      async withTransaction(_context, input, work) {
        assert.equal(input.targetId, target.targetId);
        return work({ source: { ready: true, state: structuredClone(source), artifacts: artifactsFor(source),
          async assertCompleteOwner(current, historical) { assert.equal(current.memberId, 'owner'); assert.equal(historical.workspace.id, source.workspace.id); },
          async assertCurrent() {} }, target: structuredClone(target),
        async readCandidate() { return structuredClone(retained); }, async assertCurrent() {},
        async allocateAuthority() { return structuredClone(authority); },
        async commit(value) { publication = structuredClone(value); }, async readback() { return readback(); } });
      }, async readback() { return readback(); },
    };
    const host = new WorkspaceActivationHost(ports, { approvedSyntheticWorkspaceIds: [source.workspace.id], allowedSyntheticSourceIds: ['demo-export'],
      budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 });
    const request = { candidateId: retained.pin.recordId, reviewedDigest: interchangeDigest(candidate) };
    const review = await host.review(interchangeOwner, request);
    await host.activate(interchangeOwner, { ...request, projectionDigest: review.projectionDigest, activationId: 'bootstrap_seed_activation', confirmed: true });
    assert.ok(publication); assert.equal(publication.record.stateDigest, hash(publication.state));
    return publication;
  })();
}

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:\\/i, 'Validate canonical C-drive scratch before creating fixture files.');
  const directory = await realpath(await mkdtemp(join(parent, 'chausar-fresh-bootstrap-'))), opened = new Set<Vault>();
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    for (const vault of opened) await vault.close();
    const actual = await realpath(directory), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-fresh-bootstrap-'));
    await rm(actual, { recursive: true, force: true });
  });
  const publication = structuredClone(await issuedBootstrap()), state = publication.state;
  const options = (name: string, value: State = state, override: Partial<CreateBootstrapVaultOptions> = {}): CreateBootstrapVaultOptions => ({
    directory: join(directory, name), storage: 'experimental-file', passphrase: newPassphrase, state: value,
    expectedStateDigest: override.expectedStateDigest ?? hash(value), expectedWorkspaceId: override.expectedWorkspaceId ?? value.workspace.id,
    expectedOwnerId: override.expectedOwnerId ?? value.members[0].id, budgets, ...override,
  });
  const track = (vault: Vault) => { opened.add(vault); return vault; };
  return { directory, state, publication, options, track,
    async bootstrap(name: string, value: State = state, override: Partial<CreateBootstrapVaultOptions> = {}) {
      const result = await Vault.createBootstrap(options(name, value, override)); track(result.vault); return result;
    },
    async source(name = 'source') {
      const result = await Vault.create({ directory: join(directory, name), storage: 'experimental-file', passphrase: sourcePassphrase,
        name: 'Synthetic historical source workspace', demo: true }); track(result.vault); return result;
    } };
}

test('host-issued fresh authority persists at revision zero with exact business order, fresh keys and an independently pinned owner after reopening', async t => {
  const f = await fixture(t), source = await f.source();
  const records = 1 + [...runtimeArrays, ...businessArrays].reduce((total, name) => total + f.state[name].length, 0);
  const created = await f.bootstrap('fresh_target', f.state, { budgets: { ...budgets,
    maxStateBytes: Buffer.byteLength(JSON.stringify(f.state)), maxRecords: records } });
  const target = created.vault, targetVaultId = target.vaultId, snapshot = target.read(), file = join(target.directory, 'authority.encrypted.json');
  assert.equal(snapshot.revision, 0); assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.workspace.demo, true);
  assert.equal(hash(snapshot), f.publication.record.stateDigest); assert.equal(JSON.stringify(snapshot), JSON.stringify(f.state));
  assert.deepEqual(snapshot.members, [f.publication.authority.owner]);
  assert.equal(authorize(target, f.publication.authority.context, 'admin').id, f.state.members[0].id);
  assert.throws(() => authorize(target, interchangeOwner, 'admin'), code('ACCESS_REVOKED'));
  for (const name of runtimeArrays) assert.deepEqual(snapshot[name], [], name);
  for (const name of businessArrays) assert.equal(JSON.stringify(snapshot[name]), JSON.stringify(f.state[name]), name);
  assert.equal(JSON.stringify(snapshot.ontology), JSON.stringify(f.state.ontology));
  const raw = await readFile(file, 'utf8'), envelope = JSON.parse(raw);
  const historical = JSON.parse(await readFile(join(source.vault.directory, 'authority.encrypted.json'), 'utf8'));
  assert.notEqual(target.vaultId, source.vault.vaultId); assert.notEqual(envelope.passphrase.salt, historical.passphrase.salt);
  assert.notEqual(envelope.recovery.salt, historical.recovery.salt); assert.notEqual(envelope.snapshot.nonce, historical.snapshot.nonce);
  assert.notEqual(created.recoveryCode, source.recoveryCode);
  for (const plaintext of [newPassphrase, sourcePassphrase, created.recoveryCode, source.recoveryCode, f.state.members[0].id]) assert.ok(!raw.includes(plaintext));
  assert.deepEqual((await readdir(target.directory)).sort(), ['authority.encrypted.json', 'writer.lock']);
  await target.close();
  await assert.rejects(Vault.open({ directory: target.directory, storage: 'experimental-file', passphrase: sourcePassphrase }), code('UNLOCK_FAILED'));
  await assert.rejects(Vault.recover({ directory: target.directory, storage: 'experimental-file', recoveryCode: source.recoveryCode,
    newPassphrase: 'Synthetic unrelated recovery replacement' }), code('UNLOCK_FAILED'));
  const reopened = f.track(await Vault.open({ directory: target.directory, storage: 'experimental-file', passphrase: newPassphrase }));
  assert.equal(reopened.vaultId, targetVaultId); assert.equal(JSON.stringify(reopened.read()), JSON.stringify(f.state));
  assert.equal(await readFile(file, 'utf8'), raw);
  assert.equal(source.vault.read().members[0].id, 'owner', 'Ordinary create retains its existing owner API.');
  await source.vault.close();
  const original = f.track(await Vault.open({ directory: source.vault.directory, storage: 'experimental-file', passphrase: sourcePassphrase }));
  assert.equal(original.read().workspace.name, 'Synthetic historical source workspace');
  t.diagnostic(JSON.stringify({ synthetic: true, revision: reopened.read().revision, facts: reopened.read().facts.length,
    freshVaultKeyWrappers: true, preservedOrderedState: true, reopened: true, nativeQualified: false }));
});

test('bootstrap snapshots caller State before asynchronous key wrapping and holds root writer admission through the exact initial commit', async t => {
  const f = await fixture(t), value = structuredClone(f.state), expected = structuredClone(value);
  let admitted = 0;
  const writerGuard: VaultWriterGuard = async (input, work) => {
    admitted++; assert.equal(JSON.stringify(input.state), JSON.stringify(expected));
    let checks = 0;
    const result = await work(() => { checks++; });
    assert.ok(checks >= 2); assert.equal(JSON.stringify(result.committedState), JSON.stringify(expected));
    return result.result;
  };
  const pending = f.bootstrap('stable_target', value, { writerGuard });
  value.workspace.name = 'Caller mutation after issuing reviewed State'; value.facts[0].fields.callerMutation = 'Must never become live';
  const created = await pending;
  assert.equal(JSON.stringify(created.vault.read()), JSON.stringify(expected)); assert.equal(admitted, 1);
});

test('fresh bootstrap writer admission refuses before authority publication and leaves the allocated target exactly empty', async t => {
  const f = await fixture(t);
  const writerGuard: VaultWriterGuard = async (_input, work) => {
    const result = await work(() => { throw new ChausarError('TEST_BOOTSTRAP_REVOKED', 'Synthetic initial writer admission was revoked.'); });
    return result.result;
  };
  await assert.rejects(f.bootstrap('refused_target', f.state, { writerGuard }), code('TEST_BOOTSTRAP_REVOKED'));
  const target = join(f.directory, 'refused_target');
  assert.deepEqual(await readdir(target), []);
  await assert.rejects(lstat(join(target, 'authority.encrypted.json')), { code: 'ENOENT' });
  const retried = await f.bootstrap('refused_target');
  assert.equal(retried.vault.read().revision, 0); assert.equal(JSON.stringify(retried.vault.read()), JSON.stringify(f.state));
});

test('a completed fresh authority commit with a lost acknowledgement succeeds only after exact authenticated revision-zero readback', async t => {
  const f = await fixture(t);
  class LostAcknowledgementAdapter extends ExperimentalFileSnapshotAdapter {
    injected = false;
    override async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
      await super.commit(envelope, expectedRevision); this.injected = true;
      throw new Error('Synthetic lost acknowledgement after actual fresh authority commit');
    }
  }
  const adapter = new LostAcknowledgementAdapter(join(f.directory, 'lost_ack_target'));
  const created = await f.bootstrap('lost_ack_target', f.state, { storage: adapter });
  assert.equal(adapter.injected, true); assert.equal(created.vault.read().revision, 0);
  assert.equal(hash(created.vault.read()), f.publication.record.stateDigest);
  const vaultId = created.vault.vaultId, file = join(created.vault.directory, 'authority.encrypted.json'), raw = await readFile(file);
  await created.vault.close();
  const reopened = f.track(await Vault.open({ directory: created.vault.directory, storage: 'experimental-file', passphrase: newPassphrase }));
  assert.equal(reopened.vaultId, vaultId); assert.equal(JSON.stringify(reopened.read()), JSON.stringify(f.state));
  assert.deepEqual(await readFile(file), raw);
});

test('bootstrap refuses changed digest, workspace and owner pins plus carried authority and unsafe policy before creating any target', async t => {
  const f = await fixture(t);
  const cases: { name: string; expected: string; alter(state: State): void; options?: Partial<CreateBootstrapVaultOptions> }[] = [
    { name: 'changed_digest', expected: 'BOOTSTRAP_STATE_CHANGED', alter: () => {}, options: { expectedStateDigest: '0'.repeat(64) } },
    { name: 'bad_digest', expected: 'BOOTSTRAP_PIN_REQUIRED', alter: () => {}, options: { expectedStateDigest: 'not-a-digest' } },
    { name: 'workspace_pin', expected: 'BOOTSTRAP_STATE_INVALID', alter: () => {}, options: { expectedWorkspaceId: 'other_workspace' } },
    { name: 'owner_pin', expected: 'BOOTSTRAP_OWNER_INVALID', alter: () => {}, options: { expectedOwnerId: 'other_owner' } },
    { name: 'revision', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { state.revision = 1; } },
    { name: 'schema', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { state.schemaVersion = 2; } },
    { name: 'real_user', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { state.workspace.demo = false; } },
    { name: 'extra_state_field', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { Object.assign(state, { historicalAuthority: {} }); } },
    { name: 'extra_workspace_field', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { Object.assign(state.workspace, { historicalToken: 'forbidden' }); } },
    { name: 'extra_owner_field', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { Object.assign(state.members[0], { historicalToken: 'forbidden' }); } },
    { name: 'missing_store', expected: 'BOOTSTRAP_STATE_INVALID', alter: state => { delete (state as Partial<State>).jobs; } },
    { name: 'multiple_owners', expected: 'BOOTSTRAP_OWNER_INVALID', alter: state => { state.members.push({ ...state.members[0], id: 'extra_owner' }); } },
    { name: 'inactive_owner', expected: 'BOOTSTRAP_OWNER_INVALID', alter: state => { state.members[0].active = false; } },
    { name: 'owner_role', expected: 'BOOTSTRAP_OWNER_INVALID', alter: state => { state.members[0].role = 'cofounder'; } },
    { name: 'owner_epoch', expected: 'BOOTSTRAP_OWNER_INVALID', alter: state => { state.members[0].epoch = 0; } },
    { name: 'owner_branches', expected: 'BOOTSTRAP_OWNER_INVALID', alter: state => { state.members[0].branches = ['Main']; } },
    { name: 'send_samples', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.send = 'samples'; } },
    { name: 'autonomy', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.autonomy = true; } },
    { name: 'sharing', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.sharing = true; } },
    { name: 'wildcard_sources', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.allowedSources = ['*']; } },
    { name: 'empty_sources', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.allowedSources = []; } },
    { name: 'duplicate_sources', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.allowedSources.push(state.policy.allowedSources[0]); } },
    { name: 'retention', expected: 'BOOTSTRAP_POLICY_INVALID', alter: state => { state.policy.retentionDays = 0; } },
  ];
  for (const item of cases) {
    const state = structuredClone(f.state); item.alter(state);
    await assert.rejects(f.bootstrap(item.name, state, item.options), code(item.expected), item.name);
    await assert.rejects(lstat(join(f.directory, item.name)), { code: 'ENOENT' });
  }
  for (const name of runtimeArrays) {
    const state = structuredClone(f.state); state[name].push({ id: `historical_${name}` });
    await assert.rejects(f.bootstrap(`runtime_${name}`, state), code('BOOTSTRAP_RUNTIME_AUTHORITY'), name);
    await assert.rejects(lstat(join(f.directory, `runtime_${name}`)), { code: 'ENOENT' });
  }
});

test('bootstrap refuses lossy, accessor-backed, extended and non-JSON State without evaluating caller code', async t => {
  const f = await fixture(t), digest = hash(f.state);
  let callbacks = 0;
  const cases: { name: string; alter(state: State): void }[] = [
    { name: 'undefined', alter: state => { state.facts[0].fields.lossy = undefined; } },
    { name: 'nan', alter: state => { state.facts[0].fields.lossy = NaN; } },
    { name: 'infinity', alter: state => { state.facts[0].fields.lossy = Infinity; } },
    { name: 'negative_zero', alter: state => { state.facts[0].fields.lossy = -0; } },
    { name: 'bigint', alter: state => { state.facts[0].fields.lossy = 1n; } },
    { name: 'function', alter: state => { state.facts[0].fields.lossy = () => { callbacks++; }; } },
    { name: 'date', alter: state => { state.facts[0].fields.lossy = new Date(fixedTime); } },
    { name: 'cycle', alter: state => { state.facts[0].fields.lossy = state; } },
    { name: 'sparse', alter: state => { state.facts[0].fields.lossy = new Array(2); } },
    { name: 'array_subclass', alter: state => {
      class ExtendedArray extends Array {} const value = new ExtendedArray(2); value[0] = 1; value[1] = 2;
      state.facts[0].fields.lossy = value;
    } },
    { name: 'extra_state', alter: state => { Object.assign(state, { historicalAuthority: {} }); } },
    { name: 'missing_array', alter: state => { delete (state as Partial<State>).jobs; } },
    { name: 'symbol', alter: state => { Object.defineProperty(state.facts[0].fields, Symbol('hidden-authority'), { value: 'forbidden', enumerable: true }); } },
    { name: 'hidden', alter: state => { Object.defineProperty(state.facts[0].fields, 'hidden', { value: 'forbidden', enumerable: false }); } },
    { name: 'accessor', alter: state => { Object.defineProperty(state.workspace, 'name', { enumerable: true, get() { callbacks++; return 'Caller getter'; } }); } },
    { name: 'to_json', alter: state => { state.facts[0].fields.toJSON = () => { callbacks++; return 'Caller serializer'; }; } },
  ];
  for (const item of cases) {
    const state = structuredClone(f.state); item.alter(state);
    await assert.rejects(f.bootstrap(item.name, state, { expectedStateDigest: digest }), error => error instanceof ChausarError
      && ['BOOTSTRAP_STATE_INVALID', 'BOOTSTRAP_STATE_CHANGED'].includes(error.code), item.name);
    await assert.rejects(lstat(join(f.directory, item.name)), { code: 'ENOENT' });
  }
  assert.equal(callbacks, 0);
  const canonical = JSON.parse(canonicalInterchangeJson(f.state)) as State;
  assert.notEqual(hash(canonical), hash(f.state));
  await assert.rejects(f.bootstrap('canonical_order', canonical, { expectedStateDigest: digest }), code('BOOTSTRAP_STATE_CHANGED'));
});

test('bootstrap applies explicit complete State byte, JSON depth/node and record budgets before publication', async t => {
  const f = await fixture(t), bytes = Buffer.byteLength(JSON.stringify(f.state));
  const limits: VaultBootstrapBudgets[] = [
    { ...budgets, maxStateBytes: bytes - 1 }, { ...budgets, maxJsonDepth: 1 },
    { ...budgets, maxJsonNodes: 1 }, { ...budgets, maxRecords: 1 }, { ...budgets, maxStateBytes: 0 },
  ];
  for (const [index, budget] of limits.entries()) {
    await assert.rejects(f.bootstrap(`limited_${index}`, f.state, { budgets: budget }), code('BOOTSTRAP_LIMIT'));
    await assert.rejects(lstat(join(f.directory, `limited_${index}`)), { code: 'ENOENT' });
  }
});

test('bootstrap refuses unrelated files and existing authority while preserving every preexisting target byte', async t => {
  const f = await fixture(t), unrelated = join(f.directory, 'unrelated'); await mkdir(unrelated);
  const work = join(unrelated, 'user-work.txt'); await writeFile(work, 'Synthetic unrelated work must remain byte-exact\r\n');
  const before = await readFile(work);
  await assert.rejects(f.bootstrap('unrelated'), code('BOOTSTRAP_TARGET_NOT_EMPTY'));
  assert.deepEqual(await readdir(unrelated), ['user-work.txt']); assert.deepEqual(await readFile(work), before);
  const occupied = await f.source('occupied'); await occupied.vault.close();
  const file = join(occupied.vault.directory, 'authority.encrypted.json'), authority = await readFile(file);
  await assert.rejects(f.bootstrap('occupied'), code('BOOTSTRAP_TARGET_NOT_EMPTY'));
  assert.deepEqual(await readFile(file), authority); assert.deepEqual(await readdir(occupied.vault.directory), ['authority.encrypted.json']);
});

type ArchivedInput = Parameters<Vault['authenticateArchivedArtifacts']>[0];
async function archived(vault: Vault) {
  const values = [{ id: 'synthetic_object', purpose: 'private-trial' as const, value: { status: 'discarded', secret: 'Synthetic archived artifact secret 818171' } },
    { id: 'synthetic_string', purpose: 'workspace-interchange' as const, value: 'Synthetic archived string payload' },
    { id: 'synthetic_array', purpose: 'workspace-interchange' as const, value: ['Synthetic array value', null, 7] },
    { id: 'synthetic_null', purpose: 'private-trial' as const, value: null }];
  const entries: ArchivedInput['artifacts'] = [], authenticated: (PrivateArtifactRef & { value: unknown })[] = [];
  for (const item of values) {
    const ref = await vault.writeArtifact({ ...item, expectedDigest: null });
    entries.push({ ref, bytes: await readFile(join(vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`)) });
    authenticated.push({ ...ref, value: item.value });
  }
  return { input: { sourceVaultId: vault.vaultId, artifacts: entries }, authenticated };
}

test('archived artifact bytes authenticate after live files are removed and the source advances, without mounting historical authority', async t => {
  const f = await fixture(t), source = await f.source(), retained = await archived(source.vault);
  for (const item of retained.input.artifacts) await source.vault.removeArtifact({ ...item.ref, expectedDigest: item.ref.valueDigest });
  await source.vault.update(state => { state.workspace.name = 'Synthetic later live source revision'; });
  const before = source.vault.read();
  await assert.rejects(source.vault.readArtifact(retained.input.artifacts[0].ref), code('ARTIFACT_NOT_FOUND'));
  const result = await source.vault.snapshot(() => source.vault.authenticateArchivedArtifacts(retained.input, artifactBudgets));
  assert.deepEqual(result, retained.authenticated); assert.deepEqual(source.vault.read(), before);
  assert.deepEqual(await source.vault.listArtifacts({ purpose: 'private-trial' }), []);
  assert.deepEqual(await source.vault.listArtifacts({ purpose: 'workspace-interchange' }), []);
  const string = result.find(item => item.id === 'synthetic_string')!;
  assert.equal(string.valueDigest, hash(JSON.stringify(string.value))); assert.notEqual(string.valueDigest, hash(string.value));
  await source.vault.close();
  const reopened = f.track(await Vault.open({ directory: source.vault.directory, storage: 'experimental-file', passphrase: sourcePassphrase }));
  assert.deepEqual(await reopened.snapshot(() => reopened.authenticateArchivedArtifacts(retained.input, artifactBudgets)), retained.authenticated);
  assert.deepEqual(reopened.read(), before);
});

test('archived authentication refuses wrong source, incomplete refs, aliases, tampered bytes and exhausted budgets under its required snapshot fence', async t => {
  const f = await fixture(t), source = await f.source(), retained = await archived(source.vault), before = source.vault.read();
  const authenticate = (input: ArchivedInput, budget = artifactBudgets) => source.vault.snapshot(() => source.vault.authenticateArchivedArtifacts(input, budget));
  await assert.rejects(source.vault.authenticateArchivedArtifacts(retained.input, artifactBudgets), code('CUSTODY_SNAPSHOT_REQUIRED'));
  await assert.rejects(source.vault.update(() => source.vault.authenticateArchivedArtifacts(retained.input, artifactBudgets)), code('CUSTODY_SNAPSHOT_REQUIRED'));
  const cases: { name: string; expected: string; alter(input: ArchivedInput): void }[] = [
    { name: 'wrong_source', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.sourceVaultId = 'different_source'; } },
    { name: 'empty_inventory', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts = []; } },
    { name: 'wrong_id', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts[0].ref.id = 'different_artifact'; } },
    { name: 'wrong_purpose', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts[0].ref.purpose = 'workspace-interchange'; } },
    { name: 'wrong_digest', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts[0].ref.valueDigest = 'f'.repeat(64); } },
    { name: 'wrong_disk_bytes', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts[0].ref.diskBytes++; } },
    { name: 'missing_ref', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { delete (input.artifacts[0] as Partial<ArchivedInput['artifacts'][number]>).ref; } },
    { name: 'missing_digest', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { delete (input.artifacts[0].ref as Partial<PrivateArtifactRef>).valueDigest; } },
    { name: 'extra_ref_field', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { Object.assign(input.artifacts[0].ref, { unreviewed: true }); } },
    { name: 'empty_bytes', expected: 'ARTIFACT_LIMIT', alter: input => { input.artifacts[0].bytes = Buffer.alloc(0); } },
    { name: 'invalid_utf8', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => { input.artifacts[0].bytes = Buffer.from([0xff]); input.artifacts[0].ref.diskBytes = 1; } },
    { name: 'duplicate', expected: 'ARTIFACT_INVENTORY_INCOMPLETE', alter: input => { input.artifacts.push(structuredClone(input.artifacts[0])); } },
    { name: 'case_alias', expected: 'ARTIFACT_INVENTORY_INCOMPLETE', alter: input => { const alias = structuredClone(input.artifacts[0]); alias.ref.id = alias.ref.id.toUpperCase(); input.artifacts.push(alias); } },
    { name: 'tampered_ciphertext', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => {
      const envelope = JSON.parse(Buffer.from(input.artifacts[0].bytes).toString('utf8'));
      envelope.ciphertext.data = `${envelope.ciphertext.data[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.data.slice(1)}`;
      input.artifacts[0].bytes = Buffer.from(JSON.stringify(envelope)); input.artifacts[0].ref.diskBytes = input.artifacts[0].bytes.byteLength;
    } },
    { name: 'duplicate_envelope_field', expected: 'ARTIFACT_AUTHENTICATION_FAILED', alter: input => {
      const original = Buffer.from(input.artifacts[0].bytes).toString('utf8');
      input.artifacts[0].bytes = Buffer.from(original.replace('"format":', '"format":"chausar.private-artifact.v1","format":'));
      input.artifacts[0].ref.diskBytes = input.artifacts[0].bytes.byteLength;
    } },
  ];
  for (const item of cases) { const input = structuredClone(retained.input); item.alter(input); await assert.rejects(authenticate(input), code(item.expected), item.name); }
  const maximum = Math.max(...retained.input.artifacts.map(item => item.bytes.byteLength)), total = retained.input.artifacts.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  for (const budget of [{ ...artifactBudgets, maxArtifacts: 1 }, { ...artifactBudgets, maxEntryBytes: maximum - 1 },
    { ...artifactBudgets, maxEntryBytes: maximum, maxTotalEntryBytes: total - 1 }]) await assert.rejects(authenticate(retained.input, budget), code('ARTIFACT_LIMIT'));
  assert.deepEqual(source.vault.read(), before);
});
