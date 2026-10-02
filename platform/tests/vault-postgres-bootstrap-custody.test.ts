import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { ChausarError, hash } from '../runtime/contracts.ts';
import { Vault, type CreateBootstrapVaultOptions, type EncryptedSnapshotAdapter, type VaultEnvelope, type VaultWriterGuard } from '../runtime/vault.ts';
import { WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback } from '../runtime/workspace-activation.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../runtime/workspace-interchange.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Injected SQL protocol fixture only: no PostgreSQL process, real database,
// native qualification or cross-process durability is represented here.
// Vault encryption, bootstrap admission, filesystem writer locks, authenticated
// readback and reopening are actual production Vault operations.
const credential = 'Public synthetic PostgreSQL bootstrap fixture passphrase';
const otherCredential = 'Public synthetic competing SQL occupant passphrase';
const budgets = { maxStateBytes: 1_000_000, maxJsonDepth: 32, maxJsonNodes: 20_000, maxRecords: 1000 };
const custodyBudgets = { maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000, maxArtifacts: 32 };
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

let issued: Promise<WorkspaceActivationCommit> | undefined;
function issuedBootstrap() {
  return issued ??= (async () => {
    // Reuse the host-issued bootstrap pattern and original shop fixtures from
    // vault-fresh-bootstrap.test.ts without importing/executing that test file.
    const source = deterministicShopState(), target = emptyTarget();
    source.sessions.push({ id: 'historical_sql_session_stays_inert' });
    source.receipts.push({ id: 'historical_sql_receipt_stays_inert' });
    const capture = captureWorkspaceInterchange(source, artifactsFor(source));
    const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
      target: () => target, assertCompleteRead: () => {} }).prepare(interchangeOwner,
      { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
    const retained: AuthenticatedActivationCandidate = { content: canonicalInterchangeJson(candidate),
      pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'sql_bootstrap_candidate',
        creationId: 'sql_bootstrap_creation', contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory,
        packageDigest: candidate.packageDigest, candidateDigest: interchangeDigest(candidate), target },
      measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' } };
    const authority: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
      owner: { id: 'fresh_sql_bootstrap_owner', name: 'Synthetic SQL bootstrap owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
      context: { memberId: 'fresh_sql_bootstrap_owner', role: 'owner', epoch: 7, channel: 'desktop' },
      sessionAuthorityId: 'fresh_sql_session_authority', createdAt: fixedTime };
    let publication: WorkspaceActivationCommit | undefined;
    const readback = (): WorkspaceActivationReadback => {
      assert.ok(publication); return { status: 'committed', encrypted: true, ciphertextBytes: 1,
        qualification: 'test-fixture', ...structuredClone(publication) };
    };
    const ports: WorkspaceActivationPorts = {
      custody: { async read(_context, id) { assert.equal(id, retained.pin.recordId); return structuredClone(retained); } },
      async withTransaction(_context, input, work) {
        assert.equal(input.targetId, target.targetId);
        return work({ source: { ready: true, state: structuredClone(source), artifacts: artifactsFor(source),
          async assertCompleteOwner(current, historical) { assert.equal(current.memberId, 'owner'); assert.equal(historical.workspace.id, source.workspace.id); },
          async assertCurrent() {} }, target: structuredClone(target), async readCandidate() { return structuredClone(retained); },
          async assertCurrent() {}, async allocateAuthority() { return structuredClone(authority); },
          async commit(value) { publication = structuredClone(value); }, async readback() { return readback(); } });
      }, async readback() { return readback(); },
    };
    const host = new WorkspaceActivationHost(ports, { approvedSyntheticWorkspaceIds: [source.workspace.id], allowedSyntheticSourceIds: ['demo-export'],
      budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 }, retentionDays: 90 });
    const request = { candidateId: retained.pin.recordId, reviewedDigest: interchangeDigest(candidate) };
    const review = await host.review(interchangeOwner, request);
    await host.activate(interchangeOwner, { ...request, projectionDigest: review.projectionDigest,
      activationId: 'sql_bootstrap_seed_activation', confirmed: true });
    assert.ok(publication); assert.equal(publication.record.stateDigest, hash(publication.state));
    return publication;
  })();
}

type SqlProtocolSlot = { row: VaultEnvelope | null; issued: VaultEnvelope | null; commits: number;
  loads: number; casCalls: number; unconditionalDeletes: number; closes: number; events: string[] };
type ProtocolOptions = { lostCommitAck?: boolean; failedCommitReadback?: boolean;
  casFailure?: 'before-effect' | 'after-effect'; beforeCas?: (expected: VaultEnvelope, slot: SqlProtocolSlot) => void };
function sqlSlot(): SqlProtocolSlot {
  return { row: null, issued: null, commits: 0, loads: 0, casCalls: 0, unconditionalDeletes: 0, closes: 0, events: [] };
}
class InjectedSqlProtocolAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  readonly slot: SqlProtocolSlot;
  readonly options: ProtocolOptions;
  constructor(slot: SqlProtocolSlot, options: ProtocolOptions = {}) { this.slot = slot; this.options = options; }
  async load(): Promise<VaultEnvelope | null> {
    this.slot.loads++; this.slot.events.push('load');
    if (this.options.failedCommitReadback && this.slot.commits) throw new ChausarError('TEST_SQL_READBACK_FAILED', 'Injected SQL readback unavailable.');
    return structuredClone(this.slot.row);
  }
  async commit(envelope: VaultEnvelope, expected: number | null): Promise<void> {
    this.slot.commits++; this.slot.events.push('commit');
    assert.equal(expected, null); assert.equal(envelope.revision, 0);
    if (this.slot.row) throw new ChausarError('REVISION_CONFLICT', 'Injected SQL slot is occupied.');
    this.slot.issued = structuredClone(envelope); this.slot.row = structuredClone(envelope);
    if (this.options.lostCommitAck) throw new ChausarError('TEST_SQL_COMMIT_ACK_LOST', 'Injected SQL acknowledgement lost after publication.');
  }
  async delete(): Promise<void> {
    this.slot.unconditionalDeletes++; this.slot.events.push('unconditional-delete');
    throw new ChausarError('TEST_UNCONDITIONAL_DELETE_FORBIDDEN', 'Bootstrap must use atomic conditional removal.');
  }
  async deleteIfCurrent(expected: VaultEnvelope): Promise<'deleted' | 'absent' | 'mismatch'> {
    this.slot.casCalls++; this.slot.events.push('cas');
    assert.deepEqual(expected, this.slot.issued, 'CAS must receive the exact originally attempted encrypted envelope.');
    this.options.beforeCas?.(expected, this.slot);
    if (this.options.casFailure === 'before-effect') throw new ChausarError('TEST_SQL_CAS_UNKNOWN', 'Injected conditional removal unavailable.');
    if (!this.slot.row) return 'absent';
    if (JSON.stringify(this.slot.row) !== JSON.stringify(expected)) return 'mismatch';
    this.slot.row = null;
    if (this.options.casFailure === 'after-effect') throw new ChausarError('TEST_SQL_CAS_ACK_LOST', 'Injected conditional removal acknowledgement lost.');
    return 'deleted';
  }
  async close() { this.slot.closes++; this.slot.events.push('close'); }
}

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(parent, /^C:[\\/]/i, 'Canonical C-drive scratch is required before fixture creation.');
  const root = await realpath(await mkdtemp(join(parent, 'chausar-pg-bootstrap-custody-'))), opened = new Set<Vault>();
  assert.equal(dirname(root), parent);
  t.after(async () => {
    for (const vault of opened) await vault.close();
    const actual = await realpath(root), child = relative(parent, actual);
    assert.equal(dirname(actual), parent);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-pg-bootstrap-custody-'));
    await rm(actual, { recursive: true, force: true });
  });
  const publication = structuredClone(await issuedBootstrap()), state = publication.state;
  const options = (name: string, adapter: EncryptedSnapshotAdapter, override: Partial<CreateBootstrapVaultOptions> = {}): CreateBootstrapVaultOptions => ({
    directory: join(root, name), storage: adapter, passphrase: credential, state, expectedStateDigest: hash(state),
    expectedWorkspaceId: state.workspace.id, expectedOwnerId: state.members[0].id, budgets, ...override });
  const track = (vault: Vault) => { opened.add(vault); return vault; };
  return { root, state, publication, options, track,
    async bootstrap(name: string, adapter: EncryptedSnapshotAdapter, override: Partial<CreateBootstrapVaultOptions> = {}) {
      const result = await Vault.createBootstrap(options(name, adapter, override)); track(result.vault); return result;
    }, async reopen(name: string, slot: SqlProtocolSlot, passphrase = credential) {
      return track(await Vault.open({ directory: join(root, name), storage: new InjectedSqlProtocolAdapter(slot), passphrase }));
    } };
}
function afterPublicationFailure(slot: SqlProtocolSlot): VaultWriterGuard {
  return async (_input, work) => {
    await work(() => {}); slot.events.push('guard-failed');
    throw new ChausarError('TEST_POST_PUBLICATION_REVOKED', 'Injected root admission revoked after exact publication.');
  };
}

test('injected SQL protocol: missing atomic custody hook refuses before writer admission, lock or authority publication', async t => {
  const f = await fixture(t), slot = sqlSlot(), adapter = new InjectedSqlProtocolAdapter(slot);
  const noHook: EncryptedSnapshotAdapter = { kind: 'postgres', load: adapter.load.bind(adapter), commit: adapter.commit.bind(adapter),
    delete: adapter.delete.bind(adapter), close: adapter.close.bind(adapter) };
  let admissions = 0;
  const writerGuard: VaultWriterGuard = async (_input, work) => { admissions++; return (await work(() => {})).result; };
  await assert.rejects(f.bootstrap('missing_hook', noHook, { writerGuard }), code('BOOTSTRAP_STORAGE_CUSTODY_REQUIRED'));
  assert.equal(admissions, 0);
  assert.equal(slot.commits, 0); assert.equal(slot.loads, 0); assert.equal(slot.casCalls, 0);
  assert.equal(slot.unconditionalDeletes, 0); assert.equal(slot.row, null);
  assert.deepEqual(await readdir(join(f.root, 'missing_hook')), []);
  await assert.rejects(lstat(join(f.root, 'missing_hook', 'writer.lock')), { code: 'ENOENT' });
});

test('injected SQL protocol: denied initial writer admission is not an attempted or unknown authority commit', async t => {
  const f = await fixture(t), slot = sqlSlot(), adapter = new InjectedSqlProtocolAdapter(slot);
  const writerGuard: VaultWriterGuard = async (_input, work) => {
    const result = await work(() => { throw new ChausarError('TEST_PRE_PUBLICATION_REVOKED', 'Injected initial admission denied.'); });
    return result.result;
  };
  await assert.rejects(f.bootstrap('pre_admission', adapter, { writerGuard }), code('TEST_PRE_PUBLICATION_REVOKED'));
  assert.equal(slot.commits, 0); assert.equal(slot.casCalls, 0); assert.equal(slot.unconditionalDeletes, 0); assert.equal(slot.row, null);
  assert.deepEqual(await readdir(join(f.root, 'pre_admission')), []);
});

test('injected SQL protocol: lost commit acknowledgement succeeds only through actual authenticated revision-zero readback and custody', async t => {
  const f = await fixture(t), slot = sqlSlot(), adapter = new InjectedSqlProtocolAdapter(slot, { lostCommitAck: true });
  const created = await f.bootstrap('lost_ack_confirmed', adapter), id = created.vault.vaultId;
  assert.equal(slot.commits, 1); assert.equal(slot.casCalls, 0); assert.equal(slot.unconditionalDeletes, 0);
  assert.equal(created.vault.read().revision, 0); assert.deepEqual(created.vault.read(), f.state);
  assert.deepEqual(created.vault.read().sessions, []); assert.deepEqual(created.vault.read().receipts, []);
  const raw = JSON.stringify(slot.row); assert.ok(!raw.includes(credential)); assert.ok(!raw.includes(f.state.members[0].id));
  const capture = await created.vault.snapshot(() => created.vault.captureEncryptedCustody(custodyBudgets));
  assert.equal(capture.storageKind, 'postgres'); assert.equal(capture.authorityKind, 'adapter-issued-envelope');
  assert.deepEqual(capture.state, f.state); assert.deepEqual(JSON.parse(Buffer.from(capture.authority).toString('utf8')), slot.row);
  assert.deepEqual(await created.vault.snapshot(() => created.vault.authenticateEncryptedCustody({ authority: capture.authority,
    artifacts: capture.artifacts, source: { vaultId: capture.vaultId, workspaceId: capture.state.workspace.id, revision: 0 } }, custodyBudgets)), f.state);
  await created.vault.close(); const reopened = await f.reopen('lost_ack_confirmed', slot);
  assert.equal(reopened.vaultId, id); assert.deepEqual(reopened.read(), f.state); assert.equal(JSON.stringify(slot.row), raw);
  t.diagnostic('Actual Vault crypto/custody and reopen; injected SQL protocol only, native PostgreSQL not executed.');
});

test('injected SQL protocol: lost commit acknowledgement plus failed readback retains the possibly published envelope without cleanup', async t => {
  const f = await fixture(t), slot = sqlSlot();
  await assert.rejects(f.bootstrap('lost_ack_unknown', new InjectedSqlProtocolAdapter(slot,
    { lostCommitAck: true, failedCommitReadback: true })), code('BOOTSTRAP_COMMIT_UNKNOWN'));
  assert.equal(slot.commits, 1); assert.equal(slot.casCalls, 0); assert.equal(slot.unconditionalDeletes, 0);
  assert.ok(slot.row); assert.deepEqual(slot.row, slot.issued); const retained = JSON.stringify(slot.row);
  assert.deepEqual(await readdir(join(f.root, 'lost_ack_unknown')), []);
  const reopened = await f.reopen('lost_ack_unknown', slot);
  assert.deepEqual(reopened.read(), f.state); assert.equal(JSON.stringify(slot.row), retained);
});

test('injected SQL protocol: confirmed publication cleanup uses direct CAS and accepts deleted or already absent authority', async t => {
  const f = await fixture(t);
  for (const result of ['deleted', 'absent'] as const) {
    const slot = sqlSlot(), adapter = new InjectedSqlProtocolAdapter(slot, { beforeCas(_expected, current) {
      assert.deepEqual(current.events.slice(current.events.indexOf('guard-failed') + 1), ['cas'], 'No load-then-delete window is admitted.');
      if (result === 'absent') current.row = null;
    } });
    await assert.rejects(f.bootstrap('cleanup_' + result, adapter, { writerGuard: afterPublicationFailure(slot) }), code('TEST_POST_PUBLICATION_REVOKED'));
    assert.equal(slot.commits, 1); assert.equal(slot.casCalls, 1); assert.equal(slot.unconditionalDeletes, 0); assert.equal(slot.row, null);
    assert.deepEqual(await readdir(join(f.root, 'cleanup_' + result)), []);
  }
});

test('injected SQL protocol: occupant replacement at the atomic CAS boundary preserves the independently encrypted competing State', async t => {
  const f = await fixture(t), otherSlot = sqlSlot();
  const other = await f.bootstrap('other_occupant', new InjectedSqlProtocolAdapter(otherSlot), { passphrase: otherCredential });
  const otherId = other.vault.vaultId, otherState = other.vault.read(), otherEnvelope = structuredClone(otherSlot.row);
  assert.ok(otherEnvelope); await other.vault.close();
  const slot = sqlSlot(), adapter = new InjectedSqlProtocolAdapter(slot, { beforeCas(expected, current) {
    assert.deepEqual(current.events.slice(current.events.indexOf('guard-failed') + 1), ['cas']);
    assert.deepEqual(current.row, expected); assert.notEqual(otherEnvelope.id, expected.id);
    current.row = structuredClone(otherEnvelope); // Independent writer replacement at compare-and-delete, not an earlier load.
  } });
  await assert.rejects(f.bootstrap('replaced_at_cas', adapter, { writerGuard: afterPublicationFailure(slot) }), code('BOOTSTRAP_CLEANUP_REQUIRED'));
  assert.equal(slot.casCalls, 1); assert.equal(slot.unconditionalDeletes, 0); assert.deepEqual(slot.row, otherEnvelope);
  const reopened = await f.reopen('replaced_at_cas', slot, otherCredential);
  assert.equal(reopened.vaultId, otherId); assert.deepEqual(reopened.read(), otherState); assert.deepEqual(slot.row, otherEnvelope);
});

test('injected SQL protocol: unknown conditional cleanup before its effect retains authenticated authority and never retries', async t => {
  const f = await fixture(t), slot = sqlSlot();
  await assert.rejects(f.bootstrap('cas_unknown_retained', new InjectedSqlProtocolAdapter(slot, { casFailure: 'before-effect' }),
    { writerGuard: afterPublicationFailure(slot) }), code('BOOTSTRAP_CLEANUP_REQUIRED'));
  assert.equal(slot.commits, 1); assert.equal(slot.casCalls, 1); assert.equal(slot.unconditionalDeletes, 0); assert.deepEqual(slot.row, slot.issued);
  const reopened = await f.reopen('cas_unknown_retained', slot); assert.deepEqual(reopened.read(), f.state);
});

test('injected SQL protocol: conditional delete with a lost acknowledgement remains cleanup unknown without a second deletion', async t => {
  const f = await fixture(t), slot = sqlSlot();
  await assert.rejects(f.bootstrap('cas_ack_unknown', new InjectedSqlProtocolAdapter(slot, { casFailure: 'after-effect' }),
    { writerGuard: afterPublicationFailure(slot) }), code('BOOTSTRAP_CLEANUP_REQUIRED'));
  assert.equal(slot.commits, 1); assert.equal(slot.casCalls, 1); assert.equal(slot.unconditionalDeletes, 0); assert.equal(slot.row, null);
  assert.deepEqual(await readdir(join(f.root, 'cas_ack_unknown')), []);
});
