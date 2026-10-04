import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { authorize, ChausarError, type Context, type State } from '../runtime/contracts.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { Vault } from '../runtime/vault.ts';
import {
  WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationAuthority,
  type WorkspaceActivationCommit, type WorkspaceActivationPorts, type WorkspaceActivationReadback,
} from '../runtime/workspace-activation.ts';
import { createWorkspaceBackupV2LocalPorts } from '../runtime/workspace-backup-local.ts';
import {
  createWorkspaceBackupV2Host, validateWorkspaceBackupV2Capture, type WorkspaceBackupV2Budgets,
} from '../runtime/workspace-backup-v2.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest,
  readHistoricalWorkspaceState, validateWorkspaceInterchange,
} from '../runtime/workspace-interchange.ts';
import { RETAINED_INTERCHANGE_FORMAT } from '../runtime/workspace-interchange-contracts.ts';
import { artifactsFor, emptyTarget, fixedTime } from './fixtures/workspace-interchange-fixture.ts';

// Actual serialized Vault, encrypted complete backup custody and inert restore.
// Activation constructor ports are explicit source fixtures: they certify only
// the issued projection and ciphertext readback, without attaching an Engine,
// invoking native/database/browser/provider operations or adopting credentials.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: false };
const passphrase = 'Synthetic ontology complete backup fixture passphrase';
const prefix = 'chausar-ontology-backup-composition-';
const refusal = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 12_000_000, maxEntryBytes: 4_000_000,
  maxTotalEntryBytes: 8_000_000, maxEntries: 100, maxJsonDepth: 40, maxJsonNodes: 100_000 };
const encryptedBudgets = { maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes,
  maxArtifacts: budgets.maxEntries - 1 };

async function fixture(t: TestContext, dictionaryMode: 'legacy' | 'deferred' = 'deferred') {
  const base = await realpath(tmpdir()), applicationDirectory = await realpath(await mkdtemp(join(base, prefix)));
  assert.equal(dirname(applicationDirectory), base);
  const directory = join(applicationDirectory, 'source');
  let vault = (await Vault.create({ directory, storage: 'experimental-file', name: 'Synthetic dictionary backup cuts',
    passphrase, dictionaryMode })).vault;
  const destinations: Vault[] = [];
  t.after(async () => {
    await Promise.all([vault.close(), ...destinations.map(value => value.close())]);
    const actual = await realpath(applicationDirectory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child.startsWith(prefix) && !isAbsolute(child) && !child.startsWith('..'));
    await rm(actual, { recursive: true, force: true });
  });
  const assertCompleteOwner = async (context: Context, historical: State) => {
    const member = authorize(vault, context, 'admin');
    assert.equal(member.role, 'owner'); assert.deepEqual(member.branches, ['*']);
    assert.equal(historical.workspace.id, vault.read().workspace.id);
  };
  const local = () => createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
    filesystemBudgets: { maxFiles: 100, maxBytes: 24_000_000, maxDepth: 16 },
    externalKeyRequirements: [{ provider: 'other', namespace: 'operator/credential-wrappers',
      requirement: 'The fixture separately retains its synthetic passphrase; no host credential is acquired.' }],
    assertCompleteOwner,
    withCompleteOwner: async (context, historical, work) => {
      await assertCompleteOwner(context, historical); return vault.withCustodyWriterAdmission(work);
    },
  });
  return {
    applicationDirectory, get vault() { return vault; }, get ontology() { return new OntologyService(vault); }, local,
    authorityBytes: () => readFile(join(directory, 'authority.encrypted.json')),
    async capture() { return vault.snapshot(() => vault.captureEncryptedCustody(encryptedBudgets)); },
    async reopen() {
      await vault.close(); vault = await Vault.open({ directory, storage: 'experimental-file', passphrase });
    },
    async destination(commit: WorkspaceActivationCommit) {
      const state = commit.state;
      const destination = (await Vault.createBootstrap({ directory: join(applicationDirectory, 'synthetic_fresh_projection'),
        storage: 'experimental-file', passphrase, state, expectedStateDigest: commit.record.stateDigest,
        expectedWorkspaceId: commit.record.workspaceId, expectedOwnerId: commit.authority.owner.id,
        budgets: { maxStateBytes: 8_000_000, maxJsonDepth: 128, maxJsonNodes: 200_000, maxRecords: 100_000 } })).vault;
      destinations.push(destination);
      return destination;
    },
    async reopenDestination(destination: Vault) {
      await destination.close();
      const reopened = await Vault.open({ directory: destination.directory, storage: 'experimental-file', passphrase });
      destinations.push(reopened); return reopened;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function backup(f: Fixture, id: string) {
  const before = await f.capture(), local = f.local(), host = createWorkspaceBackupV2Host(local.ports, budgets);
  const issued = await host.create(owner, { destinationId: id, confirmed: true });
  const retained = await local.ports.custody.read(owner, issued.recordId);
  const decoded = validateWorkspaceBackupV2Capture(retained.content, retained.pin.sourcePin, budgets);
  assert.deepEqual(decoded.capture.authority, before.authority);
  assert.deepEqual(decoded.capture.artifacts, before.artifacts);
  assert.equal(decoded.archive.pin.authority.sha256, sha(before.authority));
  assert.deepEqual(f.vault.read(), before.state, 'Backup custody cannot publish or mutate dictionary state.');
  const authenticate = () => f.vault.snapshot(() => f.vault.authenticateEncryptedCustody(decoded.capture, encryptedBudgets));
  assert.deepEqual(await authenticate(), before.state);
  assert.equal(retained.content.includes(passphrase), false);
  for (const attempt of before.state.ontology?.publicationAttempts ?? []) {
    assert.equal(retained.content.includes(attempt.attemptId), false, 'Publication attribution remains inside encrypted authority.');
  }
  return { before, local, host, issued, retained, decoded, authenticate };
}
type Backup = Awaited<ReturnType<typeof backup>>;

async function restoreInert(f: Fixture, archived: Backup, targetId: string) {
  // Recreate custody after source reopen rather than use a closed captured Vault.
  const local = f.local(), host = createWorkspaceBackupV2Host(local.ports, budgets);
  const restored = await host.restoreInert(owner, { backupId: archived.issued.recordId, targetId,
    reviewedDigest: archived.issued.archiveDigest });
  assert.equal(restored.inert, true); assert.equal(restored.activation, 'root-only');
  const target = local.targetPath(targetId), container = JSON.parse(await readFile(join(target, 'backup.inert.json'), 'utf8'));
  assert.deepEqual(container.receipt, restored); assert.equal(container.content, archived.retained.content);
  const decoded = validateWorkspaceBackupV2Capture(container.content, archived.retained.pin.sourcePin, budgets);
  assert.deepEqual(decoded.capture, archived.decoded.capture);
  await assert.rejects(Vault.open({ directory: target, storage: 'experimental-file', passphrase }), refusal('UNLOCK_FAILED'));
  const historical = await f.vault.snapshot(() => f.vault.authenticateEncryptedCustody(decoded.capture, encryptedBudgets));
  assert.deepEqual(historical, archived.before.state);
  const semantic = captureWorkspaceInterchange(historical, artifactsFor(historical));
  const wire = encodeWorkspaceInterchange(semantic.package);
  assert.deepEqual(readHistoricalWorkspaceState(validateWorkspaceInterchange(wire, semantic.inventory)), historical);
  return { restored, historical, semantic };
}

async function activation(f: Fixture, archived: Backup) {
  const historical = await archived.authenticate(), material = artifactsFor(historical);
  const capture = captureWorkspaceInterchange(historical, material), target = emptyTarget();
  target.targetId = 'synthetic_publication_target'; target.workspaceId = 'workspace_synthetic_fresh_publication_owner';
  const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
    target: () => target, assertCompleteRead: context => { authorize(f.vault, context, 'admin'); },
  }).prepare(owner, { text: encodeWorkspaceInterchange(capture.package), targetId: target.targetId });
  const content = canonicalInterchangeJson(candidate);
  const pin: AuthenticatedActivationCandidate['pin'] = { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate',
    recordId: 'synthetic_publication_candidate', creationId: 'synthetic_publication_candidate_creation',
    contextDigest: interchangeDigest(owner), inventory: capture.inventory, packageDigest: candidate.packageDigest,
    candidateDigest: interchangeDigest(candidate), target };
  const archiveRef = await f.vault.writeArtifact({ id: 'composition_candidate_archive', purpose: 'workspace-interchange',
    value: { content }, expectedDigest: null });
  const pinRef = await f.vault.writeArtifact({ id: 'composition_candidate_independent_pin', purpose: 'workspace-interchange',
    value: pin, expectedDigest: null });
  const readCandidate = async (): Promise<AuthenticatedActivationCandidate> => ({
    content: ((await f.vault.readArtifact(archiveRef)).value as { content: string }).content,
    pin: (await f.vault.readArtifact(pinRef)).value as AuthenticatedActivationCandidate['pin'],
    measurement: { encrypted: true, qualification: 'test-fixture', archiveCiphertextBytes: archiveRef.diskBytes,
      inventoryPinCiphertextBytes: pinRef.diskBytes },
  });
  const fresh: WorkspaceActivationAuthority = { workspaceId: target.workspaceId,
    owner: { id: 'synthetic_fresh_owner', name: 'Fresh fixture owner', role: 'owner', active: true, epoch: 7, branches: ['*'] },
    context: { memberId: 'synthetic_fresh_owner', role: 'owner', epoch: 7, channel: 'desktop' },
    sessionAuthorityId: 'synthetic_fresh_session', createdAt: fixedTime };
  let allocations = 0, commits = 0, guards = 0;
  let commitRef: Awaited<ReturnType<Vault['writeArtifact']>> | undefined;
  const readback = async (): Promise<WorkspaceActivationReadback> => {
    if (!commitRef) return { status: 'unknown', activationId: 'synthetic_publication_activation', reasonCode: 'FIXTURE_UNCOMMITTED' };
    const committed = (await f.vault.readArtifact(commitRef)).value as WorkspaceActivationCommit;
    return { ...committed, status: 'committed', encrypted: true, qualification: 'test-fixture', ciphertextBytes: commitRef.diskBytes };
  };
  const ports: WorkspaceActivationPorts = {
    custody: { async read(context, id) {
      authorize(f.vault, context, 'admin'); assert.equal(id, pin.recordId); return readCandidate();
    } },
    async withTransaction(context, _input, work) {
      return f.vault.snapshot(async state => {
        authorize(f.vault, context, 'admin');
        const authority = await f.authorityBytes();
        const current = async () => {
          guards++; authorize(f.vault, context, 'admin');
          assert.deepEqual(f.vault.read(), state); assert.deepEqual(await f.authorityBytes(), authority);
          assert.deepEqual(await f.vault.authenticateEncryptedCustody(archived.decoded.capture, encryptedBudgets), historical);
        };
        return work({ source: { ready: true, state, artifacts: artifactsFor(state),
          authenticatedHistoricalCapture: { state: historical, artifacts: material },
          assertCurrent: current,
          async assertCompleteOwner(ctx, cut) {
            const member = authorize(f.vault, ctx, 'admin'); assert.equal(member.role, 'owner');
            assert.deepEqual(cut, historical); await current();
          } },
          target, readCandidate, assertCurrent: current,
          async allocateAuthority() { allocations++; return structuredClone(fresh); },
          async commit(value) {
            commits++; assert.equal(commitRef, undefined, 'Only one reviewed fixture publication may commit.');
            commitRef = await f.vault.writeArtifact({ id: 'composition_issued_projection', purpose: 'workspace-interchange',
              value, expectedDigest: null });
          },
          readback,
        });
      });
    },
    async readback(context) { authorize(f.vault, context, 'admin'); return readback(); },
  };
  const host = new WorkspaceActivationHost(ports, {
    approvedSyntheticWorkspaceIds: [historical.workspace.id], allowedSyntheticSourceIds: ['demo-export'], retentionDays: 90,
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 100_000 },
  });
  const request = { candidateId: pin.recordId, reviewedDigest: interchangeDigest(candidate) };
  return { host, request, fresh, historical, candidate, readback, counts: () => ({ allocations, commits, guards }) };
}

test('revision-zero deferred review survives complete encrypted backup and inert restore before and after reviewed first publication', async t => {
  const f = await fixture(t), original = f.vault.read();
  assert.equal(original.revision, 0);
  assert.deepEqual(original.ontology, { current: null, history: [], firstRunReviewRequired: true });
  const archived = await backup(f, 'before_dictionary_review');
  const restored = await restoreInert(f, archived, 'deferred_inert_before_publish');
  assert.deepEqual(restored.historical.ontology, original.ontology);
  assert.deepEqual(restored.historical.activity, []); assert.deepEqual(restored.historical.learning, []);
  const unsupported = await activation(f, archived);
  await assert.rejects(unsupported.host.review(owner, unsupported.request), refusal('ACTIVATION_DICTIONARY'));
  await assert.rejects(unsupported.host.activate(owner, { ...unsupported.request, projectionDigest: 'a'.repeat(64),
    activationId: 'synthetic_publication_activation', confirmed: true }), refusal('ACTIVATION_DICTIONARY'));
  assert.equal(unsupported.counts().allocations, 0); assert.equal(unsupported.counts().commits, 0);
  assert.ok(unsupported.counts().guards > 0);
  const first = await f.ontology.publish(owner, starterPacks[0], { expectedCurrentHash: null, attemptId: 'reviewed_after_first_backup' });
  assert.equal(first.version, 1);
  const live = f.vault.read(); await f.reopen(); assert.deepEqual(f.vault.read(), live);
  const reopened = await restoreInert(f, archived, 'deferred_inert_after_publish');
  assert.deepEqual(reopened.historical, original);
  assert.equal(Object.hasOwn(reopened.historical.ontology, 'publicationAttempts'), false);
  assert.equal(f.ontology.get(owner, { attemptId: 'reviewed_after_first_backup' }).attempt?.dictionaryHash, first.hash);
  assert.deepEqual(f.vault.read(), live, 'Reading and restoring the earlier cut cannot roll back live publication.');
});

test('publication before and after complete backups preserves exact old attempts, excludes later attempts from the first cut and reopens idempotently', async t => {
  const f = await fixture(t);
  await f.vault.update(state => {
    state.scenarioRecords = []; state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
  });
  const draft = structuredClone(starterPacks[0]), firstOptions = { expectedCurrentHash: null, attemptId: 'response_lost_before_backup' };
  await assert.rejects((async () => { await f.ontology.publish(owner, draft, firstOptions); throw Error('Synthetic dropped publication response'); })(),
    /Synthetic dropped publication response/);
  const first = f.ontology.current(owner)!, receipt = f.ontology.get(owner, { attemptId: firstOptions.attemptId }).attempt!;
  const firstCut = await backup(f, 'reviewed_first_backup');
  const laterOptions = { expectedCurrentHash: first.hash, attemptId: 'identical_content_after_backup' };
  const later = await f.ontology.publish(owner, draft, laterOptions);
  const afterPublish = f.vault.read(), beforeRetry = await f.authorityBytes();
  assert.deepEqual(await f.ontology.publish(owner, draft, firstOptions), first);
  assert.deepEqual(f.vault.read(), afterPublish); assert.deepEqual(await f.authorityBytes(), beforeRetry);
  assert.equal(f.ontology.get(owner, { attemptId: firstOptions.attemptId }).attempt?.version, 1);
  assert.equal(f.ontology.get(owner, { attemptId: laterOptions.attemptId }).attempt?.version, 2);
  const secondCut = await backup(f, 'reviewed_second_backup');
  assert.ok(secondCut.before.artifacts.length > firstCut.before.artifacts.length,
    'The second complete archive includes the first archive, independent pin and committed issuance.');
  const firstHistorical = await firstCut.authenticate(), secondHistorical = await secondCut.authenticate();
  assert.equal(firstHistorical.ontology.current.hash, first.hash);
  assert.deepEqual(firstHistorical.ontology.publicationAttempts, [receipt]);
  assert.equal(firstHistorical.ontology.publicationAttempts.some((item: any) => item.attemptId === laterOptions.attemptId), false);
  const historicalOntology = new OntologyService({ read: () => structuredClone(firstHistorical),
    update: async () => { throw Error('The authenticated backup cut is read-only historical evidence.'); } });
  assert.equal(historicalOntology.get(owner, { attemptId: laterOptions.attemptId }).attempt, null);
  assert.equal(f.ontology.get(owner, { attemptId: laterOptions.attemptId }).attempt?.version, 2,
    'Absence in the old cut says nothing about a later attempt in current authority.');
  assert.equal(secondHistorical.ontology.current.hash, later.hash);
  assert.deepEqual(secondHistorical.ontology.publicationAttempts, afterPublish.ontology.publicationAttempts);
  const restoredFirst = await restoreInert(f, firstCut, 'reviewed_first_inert');
  assert.equal(restoredFirst.semantic.package.format, RETAINED_INTERCHANGE_FORMAT);
  assert.deepEqual(restoredFirst.historical, firstHistorical);
  await f.reopen();
  assert.deepEqual(f.ontology.get(owner, { attemptId: firstOptions.attemptId }).attempt, receipt);
  const reopenedBytes = await f.authorityBytes(), reopenedState = f.vault.read();
  assert.deepEqual(await f.ontology.publish(owner, draft, firstOptions), first);
  assert.deepEqual(f.vault.read(), reopenedState); assert.deepEqual(await f.authorityBytes(), reopenedBytes);
  const restoredSecond = await restoreInert(f, secondCut, 'reviewed_second_inert_after_reopen');
  assert.deepEqual(restoredSecond.historical, secondHistorical);
  assert.deepEqual(await firstCut.authenticate(), firstHistorical, 'Later publications and restart cannot rewrite the authenticated older cut.');
  assert.deepEqual(f.vault.read(), afterPublish);
});

test('backup-derived reviewed projection retains exact origin receipts as inert evidence and a fresh owner cannot replay them after reopen', async t => {
  const f = await fixture(t);
  await f.vault.update(state => {
    state.scenarioRecords = []; state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
  });
  const draft = structuredClone(starterPacks[0]), originalOptions = { expectedCurrentHash: null, attemptId: 'original_backup_cut_attempt' };
  const original = await f.ontology.publish(owner, draft, originalOptions), archived = await backup(f, 'original_receipt_backup');
  const receipt = f.ontology.get(owner, { attemptId: originalOptions.attemptId }).attempt!;
  await f.ontology.publish(owner, starterPacks[1], { expectedCurrentHash: original.hash, attemptId: 'later_unarchived_attempt' });
  const sourceBefore = f.vault.read(), bytesBefore = await f.authorityBytes(), reviewed = await activation(f, archived);
  const review = await reviewed.host.review(owner, reviewed.request);
  assert.deepEqual(review.ontologyDisposition, { format: 'chausar.ontology-historical-projection.v1',
    sourceWorkspaceId: archived.before.state.workspace.id, sourceOntologyDigest: interchangeDigest(archived.before.state.ontology),
    publicationAttempts: 'inert-origin-evidence', historicalPublicationEvidence: 'absent' });
  assert.equal(review.inertStores.includes('ontology.publicationAttempts'), true);
  assert.equal(review.liveStores.includes('ontology.publicationAttempts'), false);
  await assert.rejects(reviewed.host.activate(owner, { ...reviewed.request, projectionDigest: 'a'.repeat(64),
    activationId: 'synthetic_publication_activation', confirmed: true }), refusal('ACTIVATION_PROJECTION_CHANGED'));
  assert.equal(reviewed.counts().allocations, 0); assert.equal(reviewed.counts().commits, 0);
  await reviewed.host.activate(owner, { ...reviewed.request, projectionDigest: review.projectionDigest,
    activationId: 'synthetic_publication_activation', confirmed: true });
  assert.equal(reviewed.counts().allocations, 1); assert.equal(reviewed.counts().commits, 1);
  const readback = await reviewed.readback(); assert.equal(readback.status, 'committed');
  if (readback.status !== 'committed') return assert.fail('Fixture projection must retain exact encrypted committed readback.');
  const issued = readback.state;
  assert.equal(issued.workspace.id, reviewed.fresh.workspaceId); assert.deepEqual(issued.members, [reviewed.fresh.owner]);
  assert.equal(issued.ontology.current.hash, original.hash);
  assert.equal(Object.hasOwn(issued.ontology, 'publicationAttempts'), false);
  assert.deepEqual(issued.ontology.historicalPublicationEvidence, [{ workspaceId: archived.before.state.workspace.id, publicationAttempts: [receipt] }]);
  assert.deepEqual(readHistoricalWorkspaceState(JSON.parse(readback.evidence.content).archive), archived.before.state);
  assert.equal(issued.ontology.historicalPublicationEvidence[0].publicationAttempts.some((item: any) => item.attemptId === 'later_unarchived_attempt'), false);
  assert.deepEqual(f.vault.read(), sourceBefore); assert.deepEqual(await f.authorityBytes(), bytesBefore);
  const destination = await f.destination(readback), ontology = new OntologyService(destination), fresh = reviewed.fresh.context;
  const before = destination.read(), destinationBytes = await readFile(join(destination.directory, 'authority.encrypted.json'));
  assert.throws(() => ontology.get(fresh, { attemptId: originalOptions.attemptId }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  await assert.rejects(ontology.publish(fresh, draft, originalOptions), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  await assert.rejects(ontology.publish(fresh, draft, { ...originalOptions, expectedCurrentHash: original.hash }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  assert.deepEqual(destination.read(), before);
  assert.deepEqual(await readFile(join(destination.directory, 'authority.encrypted.json')), destinationBytes);
  const freshDictionary = await ontology.publish(fresh, draft, { expectedCurrentHash: original.hash, attemptId: 'fresh_reviewed_publication' });
  assert.equal(freshDictionary.version, 2);
  assert.deepEqual(destination.read().ontology.historicalPublicationEvidence, issued.ontology.historicalPublicationEvidence);
  assert.equal(ontology.get(fresh, { attemptId: 'fresh_reviewed_publication' }).attempt?.workspaceId, reviewed.fresh.workspaceId);
  const destinationState = destination.read(), reopened = await f.reopenDestination(destination);
  assert.deepEqual(reopened.read(), destinationState);
  const reopenedOntology = new OntologyService(reopened);
  assert.throws(() => reopenedOntology.get(fresh, { attemptId: originalOptions.attemptId }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  await assert.rejects(reopenedOntology.publish(fresh, draft, originalOptions), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  assert.equal(reopenedOntology.get(fresh, { attemptId: 'fresh_reviewed_publication' }).attempt?.dictionaryHash, freshDictionary.hash);
  const roundtrip = captureWorkspaceInterchange(reopened.read(), artifactsFor(reopened.read()));
  assert.deepEqual(readHistoricalWorkspaceState(validateWorkspaceInterchange(encodeWorkspaceInterchange(roundtrip.package), roundtrip.inventory)), destinationState);
});
