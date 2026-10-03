import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PublicRpc} from './postgres-transfer-independent-goldens.ts';
import type {WorkspaceInterchangeHostSummary} from '../../runtime/workspace-interchange-host.ts';
import type {EmptyTargetInspection} from '../../runtime/workspace-interchange-contracts.ts';
import type {WorkspaceBackupV2Readback, WorkspaceBackupV2RestoreReceipt,
  WorkspaceBackupV2RestoredReadback, WorkspaceBackupV2Summary} from '../../runtime/workspace-backup-v2.ts';
import type {WorkspaceBackupActivationReview} from '../../runtime/workspace-backup-activation.ts';
import type {WorkspaceActivationReview, WorkspaceActivationSummary} from '../../runtime/workspace-activation.ts';
import type {VaultEncryptedCustodyCapture} from '../../runtime/vault.ts';

// Stable public journey only. The caller owns actual HTTP pairing, source/journal
// custody, native lifecycle and the trusted fresh target factory. No Engine,
// adapter, SQL response, historical State or receipt is installed by this helper.
export type TransferIds = {
  materialId: string; backupId: string; inertTargetId: string;
  candidateId: string; targetId: string; activationId: string;
};
export type CiphertextContents = Pick<VaultEncryptedCustodyCapture, 'authority' | 'artifacts'>;
export type CiphertextObserver = {
  /** Return actual current source custody, not a caller-authored pin or success flag. */
  captureSource(): Promise<CiphertextContents>;
  /** Independently read actual inert bytes; do not reconstruct them from the public sourcePin. */
  readInert(receipt: WorkspaceBackupV2RestoreReceipt): Promise<CiphertextContents>;
};
export type RawPublicRpc = (method: string, payload?: unknown) => Promise<{
  status: number; body: {result?: unknown; error?: {code: string; message?: string}};
}>;

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const storeNames = ['members', 'facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs',
  'learning', 'plugins', 'modelReceipts', 'activity', 'conflicts', 'merges', 'tombstones', 'conversations',
  'routes', 'sessions', 'unsupported', 'schedules', 'sourceRules', 'schemaVersion', 'revision',
  'workspace', 'policy', 'ontology'].sort();
const categories = ['source-originals', 'mapping-recipes', 'dictionary-artifacts', 'report-files',
  'plugin-assets', 'research-evidence', 'conversation-files', 'sync-evidence', 'other-retained'].sort();
function identity(value: string) {assert.match(value, /^[A-Za-z0-9_-]{1,100}$/);}
function hash(value: string) {assert.match(value, /^[a-f0-9]{64}$/);}
function positive(value: number) {assert.ok(Number.isSafeInteger(value) && value > 0);}
function assertArchive(summary: WorkspaceBackupV2Summary) {
  assert.ok(summary && typeof summary === 'object'); identity(summary.recordId); hash(summary.archiveDigest);
  assert.equal(summary.scope, 'authority-and-all-typed-private-artifacts');
  assert.equal(summary.fullWorkspacePortable, false); assert.equal(summary.inert, true);
  assert.equal(summary.activation, 'root-only'); positive(summary.entries); positive(summary.encryptedEntryBytes);
  assert.equal(summary.measurement.encrypted, true);
  assert.equal(summary.measurement.qualification, 'encrypted-local-host');
  positive(summary.measurement.archiveCiphertextBytes); positive(summary.measurement.pinCiphertextBytes);
  assert.ok(Array.isArray(summary.namespaces) && summary.namespaces.length > 0);
  for (const item of summary.namespaces) {
    assert.ok(Number.isSafeInteger(item.entries) && item.entries >= 0);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0);
    if (item.disposition === 'outside-archive' || item.disposition === 'transient') {
      assert.ok(typeof item.requirement === 'string' && item.requirement.trim().length > 0);
    }
  }
}
function assertEmpty(target: EmptyTargetInspection, targetId: string, sourceWorkspaceId: string) {
  assert.equal(target.targetId, targetId); assert.notEqual(target.workspaceId, sourceWorkspaceId);
  assert.ok(target.workspaceId); assert.ok(target.generation); hash(target.accessDigest);
  assert.equal(target.ready, true); assert.equal(target.authorityRecords, 0);
  assert.deepEqual(target.unexpectedEntries, []);
  assert.deepEqual(target.stores.map(item => item.name).sort(), storeNames);
  assert.ok(target.stores.every(item => item.records === 0));
  assert.deepEqual(target.categoryCounts.map(item => item.category).sort(), categories);
  assert.ok(target.categoryCounts.every(item => item.count === 0));
  assert.equal(target.profile.id, 'chausar.persisted-state.v1');
  assert.deepEqual(target.profile.stores.map(item => item.name).sort(), storeNames);
  assert.deepEqual([...target.profile.artifactCategories].sort(), categories);
}
function assertOriginalBytes(original: CiphertextContents, retained: CiphertextContents, complete: boolean) {
  assert.deepEqual(Buffer.from(retained.authority), Buffer.from(original.authority));
  if (complete) assert.equal(retained.artifacts.length, original.artifacts.length);
  const retainedKeys = retained.artifacts.map(item => `${item.ref.purpose}/${item.ref.id}`);
  assert.equal(new Set(retainedKeys).size, retainedKeys.length);
  for (const item of original.artifacts) {
    const found = retained.artifacts.find(value => value.ref.id === item.ref.id && value.ref.purpose === item.ref.purpose);
    assert.ok(found, `Retain original encrypted ${item.ref.purpose}/${item.ref.id}.`);
    assert.deepEqual(found.ref, item.ref); assert.deepEqual(Buffer.from(found.bytes), Buffer.from(item.bytes));
  }
}

/** Run only against the caller's real public source endpoint after business setup.
 * Completion supplies public evidence; it does not itself qualify PostgreSQL/native custody. */
export async function runPostgresTransferPublicJourney(rpc: PublicRpc, input: TransferIds, observer?: CiphertextObserver) {
  const ids = structuredClone(input); Object.values(ids).forEach(identity);
  assert.equal(new Set(Object.values(ids)).size, 6, 'Use distinct managed record, inert, target and activation identities.');
  const material = await rpc('workspace.interchange.export', {destinationId: ids.materialId, confirmed: true}) as WorkspaceInterchangeHostSummary;
  assert.equal(material.recordId, ids.materialId); assert.equal(material.kind, 'export');
  assert.equal(material.inert, true); assert.equal(material.activation, 'root-only');
  hash(material.packageDigest); hash(material.reviewedDigest);
  assert.equal(material.inventory.stores, 26);
  assert.deepEqual(material.inventory.categoryCounts.map(item => item.category).sort(), categories);
  assert.ok(material.inventory.categoryCounts.every(item => Number.isSafeInteger(item.count) && item.count >= 0));
  assert.equal(material.custodyQualification, 'encrypted-local-host');
  positive(material.bytes.archiveCiphertext); positive(material.bytes.inventoryPinCiphertext);
  const original = observer ? await observer.captureSource() : undefined;

  const backup = await rpc('workspace.backup.v2.create', {destinationId: ids.backupId, confirmed: true}) as WorkspaceBackupV2Summary;
  assertArchive(backup); assert.equal(backup.recordId, ids.backupId);
  assert.equal(backup.source.workspaceId, material.source.workspaceId); assert.equal(backup.source.revision, material.source.revision);
  const read = await rpc('workspace.backup.v2.read', {backupId: ids.backupId}) as WorkspaceBackupV2Readback;
  assert.deepEqual(read.summary, backup); identity(read.creationId);
  assert.deepEqual(read.sourcePin.source, backup.source); assert.equal(read.sourcePin.fullWorkspacePortable, false);
  assert.deepEqual(read.sourcePin.namespaces, backup.namespaces);
  assert.deepEqual(read.sourcePin.externalKeyRequirements, backup.externalKeyRequirements);
  assert.equal(backup.entries, read.sourcePin.artifacts.length + 1);
  assert.equal(backup.encryptedEntryBytes, read.sourcePin.authority.bytes + read.sourcePin.artifacts.reduce((sum, item) => sum + item.bytes, 0));
  if (original) {
    positive(original.authority.length);
    assert.equal(read.sourcePin.authority.bytes, original.authority.length);
    assert.equal(read.sourcePin.authority.sha256, digest(original.authority));
    assert.equal(read.sourcePin.artifacts.length, original.artifacts.length);
    assert.deepEqual(original.artifacts.map(item => `${item.ref.purpose}/${item.ref.id}`).sort(),
      read.sourcePin.artifacts.map(item => `${item.purpose}/${item.id}`).sort());
    for (const item of original.artifacts) {
      const manifest = read.sourcePin.artifacts.find(value => value.id === item.ref.id && value.purpose === item.ref.purpose);
      assert.ok(manifest); assert.equal(manifest.valueDigest, item.ref.valueDigest);
      assert.equal(manifest.bytes, item.bytes.length); assert.equal(item.ref.diskBytes, item.bytes.length);
      assert.equal(manifest.sha256, digest(item.bytes));
    }
  }

  const inertRequest = {backupId: ids.backupId, targetId: ids.inertTargetId, reviewedDigest: backup.archiveDigest};
  const inert = await rpc('workspace.backup.v2.restoreInert', {...inertRequest, confirmed: true}) as WorkspaceBackupV2RestoreReceipt;
  assert.equal(inert.targetId, ids.inertTargetId); identity(inert.creationId);
  assert.equal(inert.archiveDigest, backup.archiveDigest); assert.deepEqual(inert.sourcePin, read.sourcePin);
  assert.equal(inert.entries, backup.entries); assert.equal(inert.bytes, backup.encryptedEntryBytes);
  assert.equal(inert.inert, true); assert.equal(inert.activation, 'root-only');
  const restored = await rpc('workspace.backup.v2.readRestored', {...inertRequest, creationId: inert.creationId}) as WorkspaceBackupV2RestoredReadback;
  assert.deepEqual(restored.receipt, inert); assert.deepEqual(restored.summary, backup);
  assert.deepEqual(restored.sourcePin, read.sourcePin);
  assert.deepEqual(await rpc('workspace.backup.v2.inspectRestored', inertRequest), restored);
  if (original && observer) assertOriginalBytes(original, await observer.readInert(inert), true);

  const target = await rpc('workspace.activation.target.create', {targetId: ids.targetId, confirmed: true}) as EmptyTargetInspection;
  assertEmpty(target, ids.targetId, backup.source.workspaceId);
  assert.deepEqual(await rpc('workspace.activation.target.get', {targetId: ids.targetId}), target);
  const selection = {backupId: ids.backupId, materialId: ids.materialId, inertTargetId: ids.inertTargetId,
    inertCreationId: inert.creationId, candidateId: ids.candidateId, targetId: ids.targetId,
    reviewedArchiveDigest: backup.archiveDigest, confirmed: true};
  const bridge = await rpc('workspace.backup.activation.prepare', selection) as WorkspaceBackupActivationReview;
  assert.equal(bridge.candidateId, ids.candidateId); identity(bridge.candidateCreationId);
  assert.equal(bridge.backupId, ids.backupId); assert.equal(bridge.backupCreationId, read.creationId);
  assert.equal(bridge.materialId, ids.materialId); identity(bridge.materialCreationId);
  assert.equal(bridge.inertTargetId, ids.inertTargetId); assert.equal(bridge.inertCreationId, inert.creationId);
  assert.equal(bridge.targetId, ids.targetId); assert.equal(bridge.targetWorkspaceId, target.workspaceId);
  assert.deepEqual(bridge.source, backup.source); assert.equal(bridge.archiveDigest, backup.archiveDigest);
  hash(bridge.reviewedDigest); hash(bridge.packageDigest); hash(bridge.targetProofDigest);
  assert.equal(bridge.scope, backup.scope); assert.equal(bridge.fullWorkspacePortable, false);
  assert.equal(bridge.inert, true); assert.equal(bridge.activation, 'root-only');
  assert.deepEqual(bridge.namespaces, read.sourcePin.namespaces);
  assert.deepEqual(bridge.externalKeyRequirements, read.sourcePin.externalKeyRequirements);
  assert.equal(bridge.measurement.encrypted, true); assert.equal(bridge.measurement.qualification, 'encrypted-local-host');
  positive(bridge.measurement.archiveCiphertextBytes); positive(bridge.measurement.inventoryPinCiphertextBytes);
  assert.deepEqual(await rpc('workspace.backup.activation.inspect', {candidateId: ids.candidateId}), bridge);

  const reviewRequest = {candidateId: ids.candidateId, reviewedDigest: bridge.reviewedDigest};
  const review = await rpc('workspace.activation.review', reviewRequest) as WorkspaceActivationReview;
  assert.equal(review.candidateId, ids.candidateId); assert.equal(review.reviewedDigest, bridge.reviewedDigest);
  assert.equal(review.packageDigest, bridge.packageDigest); hash(review.projectionDigest);
  assert.equal(review.targetId, ids.targetId); assert.equal(review.workspaceId, target.workspaceId);
  assert.equal(review.sourceWorkspaceId, backup.source.workspaceId); assert.equal(review.qualification, 'encrypted-local-host');
  const execute = {...reviewRequest, projectionDigest: review.projectionDigest, activationId: ids.activationId, confirmed: true};
  const activated = await rpc('workspace.activation.execute', execute) as WorkspaceActivationSummary;
  assert.equal(activated.status, 'committed'); assert.equal(activated.activationId, ids.activationId);
  assert.equal(activated.candidateId, ids.candidateId); assert.equal(activated.targetId, ids.targetId);
  assert.equal(activated.workspaceId, review.workspaceId); assert.equal(activated.projectionDigest, review.projectionDigest);
  hash(activated.stateDigest); hash(activated.evidenceDigest); positive(activated.ciphertextBytes);
  assert.equal(activated.qualification, 'encrypted-local-host'); assert.ok(activated.sessionAuthorityId);
  assert.equal(activated.ownerContext.role, 'owner'); assert.equal(activated.ownerContext.channel, 'desktop');
  assert.ok(activated.ownerContext.memberId); positive(activated.ownerContext.epoch);
  assert.deepEqual(await rpc('workspace.activation.get', {activationId: ids.activationId}), activated);
  if (original && observer) assertOriginalBytes(original, await observer.captureSource(), false);
  return {ids, material, backup, read, inert, restored, target, selection, bridge, review, execute, activated,
    factorySelection: {activationId: activated.activationId, targetId: activated.targetId,
      workspaceId: activated.workspaceId, ownerContext: structuredClone(activated.ownerContext),
      projectionDigest: activated.projectionDigest, evidenceDigest: activated.evidenceDigest}};
}

export type PublicTransferJourney = Awaited<ReturnType<typeof runPostgresTransferPublicJourney>>;
function refusal(response: Awaited<ReturnType<RawPublicRpc>>) {
  assert.ok(response.status >= 400 && response.status < 500, `Require an actual public refusal, received HTTP ${response.status}.`);
  assert.equal(response.body.result, undefined); assert.ok(response.body.error);
  assert.match(response.body.error.code, /^[A-Z][A-Z0-9_]+$/);
  assert.ok(!['UNAUTHENTICATED', 'VAULT_LOCKED', 'VAULT_OPEN', 'INVALID_REQUEST', 'FORBIDDEN', 'ENGINE_STOPPING'].includes(response.body.error.code),
    'Authentication/setup refusal does not establish target or replay admission.');
  return response;
}

/** Real public execute replay must refuse and preserve the currently committed readback.
 * A distinct new activationId additionally probes reuse of the same consumed candidate. */
export async function assertCandidateReplayRefused(raw: RawPublicRpc, journey: PublicTransferJourney, newActivationId?: string) {
  const before = await raw('workspace.activation.get', {activationId: journey.ids.activationId});
  assert.equal(before.status, 200); assert.equal(before.body.error, undefined);
  assert.ok(before.body.result && typeof before.body.result === 'object');
  const committed = before.body.result as WorkspaceActivationSummary;
  assert.equal(committed.status, 'committed'); assert.equal(committed.activationId, journey.ids.activationId);
  assert.equal(committed.candidateId, journey.ids.candidateId); assert.equal(committed.workspaceId, journey.activated.workspaceId);
  assert.equal(committed.projectionDigest, journey.activated.projectionDigest);
  const rejected = refusal(await raw('workspace.activation.execute', journey.execute));
  let alias: Awaited<ReturnType<RawPublicRpc>> | undefined;
  if (newActivationId !== undefined) {
    identity(newActivationId); assert.ok(!Object.values(journey.ids).includes(newActivationId));
    alias = refusal(await raw('workspace.activation.execute', {...journey.execute, activationId: newActivationId}));
  }
  const after = await raw('workspace.activation.get', {activationId: journey.ids.activationId});
  assert.equal(after.status, 200); assert.equal(after.body.error, undefined); assert.deepEqual(after.body.result, before.body.result);
  return {rejected, alias, retained: after.body.result};
}

/** Supply a separate actual public endpoint for the closed inert/prepared target.
 * The caller verifies joined phase-specific codes; this helper installs no host or path. */
export async function assertNormalOpenRefused(raw: RawPublicRpc, payload: {folder: string; passphrase: string}, expectedCodes: readonly string[]) {
  assert.ok(expectedCodes.length > 0, 'Pin the real joined target-phase refusal codes.');
  const response = refusal(await raw('workspace.open', payload));
  assert.ok(expectedCodes.includes(response.body.error!.code));
  const status = await raw('workspace.status', {});
  assert.equal(status.status, 200); assert.equal(status.body.error, undefined);
  assert.equal((status.body.result as {open: boolean}).open, false);
  return response;
}
