import { randomUUID } from 'node:crypto';
import { authorize, check, ChausarError, type Context, type State } from './contracts.ts';
import { canSeeFact } from './memory.ts';
import { assertSourceAccess } from './trust.ts';
import { proveEmptyWorkspaceTarget, WorkspaceImportCandidateService } from './workspace-import-candidate.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest, retainedArtifactBytes,
  validateWorkspaceInterchange, workspaceStateProfile,
} from './workspace-interchange.ts';
import { validateWorkspaceBackupV2, validateWorkspaceBackupV2Capture,
  type WorkspaceBackupV2Budgets, type WorkspaceBackupV2Capture, type WorkspaceBackupV2CustodyRecord,
  type WorkspaceBackupV2Measurement, type WorkspaceBackupV2RestoreReceipt,
} from './workspace-backup-v2.ts';
import type { ArtifactCapture, EmptyTargetInspection, WorkspaceImportCandidate, WorkspaceInterchange, WorkspaceCapture } from './workspace-interchange-contracts.ts';
import type { WorkspaceInterchangeCustodyRecord, WorkspaceInterchangeCustodyMeasurement } from './workspace-interchange-host.ts';
import type { AuthenticatedActivationCandidate, WorkspaceActivationEvidence } from './workspace-activation.ts';
import type { PrivateArtifactRef } from './vault.ts';

const PROVENANCE = 'chausar.backup-activation-provenance.v1' as const;
const EVIDENCE_ID = 'backup_activation_provenance_v1';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);
type BackupRead = WorkspaceBackupV2CustodyRecord & { measurement: WorkspaceBackupV2Measurement };
type MaterialRead = WorkspaceInterchangeCustodyRecord & { measurement: WorkspaceInterchangeCustodyMeasurement };
export type WorkspaceBackupActivationMaterialRefs = { archive: PrivateArtifactRef; pin: PrivateArtifactRef; binding: PrivateArtifactRef };
type CheckedOriginal = { archive: ReturnType<typeof validateWorkspaceBackupV2>; semantic: WorkspaceInterchange; provenance: WorkspaceBackupActivationProvenance };
type Derived = { candidate: WorkspaceImportCandidate; content: string; capture: WorkspaceCapture };

/** Root authenticates the durable restored reservation AND remeasures its actual physical container. */
export type WorkspaceBackupActivationInertRead = {
  content: string; receipt: WorkspaceBackupV2RestoreReceipt;
  inspection: { targetId: string; locationId: string; generation: string; contextDigest: string; containerDigest: string; containerBytes: number };
};
export type WorkspaceBackupActivationSelection = {
  backupId: string; materialId: string; inertTargetId: string; inertCreationId: string; candidateId: string; targetId: string;
};
export type WorkspaceBackupActivationPolicy = {
  approvedSyntheticWorkspaceIds: string[];
  backupBudgets: WorkspaceBackupV2Budgets;
  maxMaterialUtf8Bytes: number; maxCandidateUtf8Bytes: number;
};
/** All reads below authenticate independent committed issuance; payload hashes are never admission. */
export type WorkspaceBackupActivationLease = {
  currentState: State; target: EmptyTargetInspection;
  readBackup(): Promise<BackupRead>;
  readMaterial(): Promise<MaterialRead>;
  readInert(): Promise<WorkspaceBackupActivationInertRead>;
  /** Authenticates every original encrypted entry and returns historical State without exporting keys. */
  authenticateArchive(capture: WorkspaceBackupV2Capture): Promise<State>;
  /** Authenticate archived export/archive-pin/commit ENVELOPES and VALUES against this independent export; no same-revision inference. */
  authenticateMaterial(capture: WorkspaceBackupV2Capture, material: WorkspaceInterchangeCustodyRecord): Promise<WorkspaceBackupActivationMaterialRefs>;
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  /** Current source/owner/readiness + exact backup/export/inert issuance + empty activation target. */
  assertCurrent(): Promise<void>;
  /** Durable no-overwrite, single-use record/creation CAS. Invoke guard at actual publication. */
  createCandidate(record: WorkspaceInterchangeCustodyRecord, guard: () => Promise<void>): Promise<WorkspaceInterchangeCustodyMeasurement>;
  readCandidate(): Promise<AuthenticatedActivationCandidate>;
};
export type WorkspaceBackupActivationPorts = {
  /** Hold current owner/epoch/readiness, archive/export/reservation, candidate and empty target exclusion through exit. */
  withTransaction<T>(context: Context, selection: WorkspaceBackupActivationSelection & { mode: 'prepare' | 'inspect' },
    work: (lease: WorkspaceBackupActivationLease) => Promise<T>): Promise<T>;
  /** Authenticated candidate/pin/creation binding with CURRENT complete-owner admission, including after restart. */
  custody: {
    read(context: Context, candidateId: string): Promise<AuthenticatedActivationCandidate>;
    /** Constructor-only current source-scope reader. Never accepts retained data through RPC. */
    readHeld?(context: Context, candidateId: string): Promise<AuthenticatedActivationCandidate>;
  };
};
export type WorkspaceBackupActivationProvenance = {
  format: typeof PROVENANCE;
  backup: WorkspaceBackupV2CustodyRecord;
  material: WorkspaceInterchangeCustodyRecord;
  inert: WorkspaceBackupActivationInertRead;
  materialRefs: WorkspaceBackupActivationMaterialRefs;
  custodyQualification: WorkspaceInterchangeCustodyMeasurement['qualification'];
};
export type WorkspaceBackupActivationReview = {
  candidateId: string; candidateCreationId: string; reviewedDigest: string; packageDigest: string;
  source: WorkspaceBackupV2CustodyRecord['pin']['sourcePin']['source'];
  backupId: string; backupCreationId: string; archiveDigest: string;
  materialId: string; materialCreationId: string; inertTargetId: string; inertCreationId: string;
  targetId: string; targetWorkspaceId: string; targetProofDigest: string;
  scope: 'authority-and-all-typed-private-artifacts'; fullWorkspacePortable: false;
  inert: true; activation: 'root-only';
  namespaces: WorkspaceBackupV2CustodyRecord['pin']['sourcePin']['namespaces'];
  externalKeyRequirements: WorkspaceBackupV2CustodyRecord['pin']['sourcePin']['externalKeyRequirements'];
  measurement: WorkspaceInterchangeCustodyMeasurement;
};

function exact(value: unknown, keys: string[]): asserts value is Record<string, any> {
  canonicalInterchangeJson(value);
  check(value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort()),
    'BACKUP_ACTIVATION_SHAPE', 'Bridge fields must match the reviewed format exactly.');
}
async function completed(work: () => Promise<void>) {
  const result: unknown = await work();
  check(result === undefined, 'BACKUP_ACTIVATION_GUARD', 'Trusted bridge guards must complete and return undefined.');
}
function owner(context: Context, state: State) {
  check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'The bridge requires the current untainted desktop owner.');
  const member = authorize({ read: () => state, update: async () => { throw new Error('Read-only bridge.'); } }, context, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Unrestricted current owner admission is required.');
}
function measured(value: WorkspaceBackupV2Measurement | WorkspaceInterchangeCustodyMeasurement, backup: boolean) {
  const pinBytes = backup ? 'pinCiphertextBytes' : 'inventoryPinCiphertextBytes';
  exact(value, ['encrypted', 'archiveCiphertextBytes', pinBytes, 'qualification']);
  check(value.encrypted === true && ['test-fixture', 'encrypted-local-host'].includes(value.qualification)
    && [value.archiveCiphertextBytes, (value as any)[pinBytes]].every(n => Number.isSafeInteger(n) && n > 0),
  'BACKUP_ACTIVATION_CUSTODY', 'Both independent encrypted payload and pin require measured authenticated custody.');
}
function selection(value: WorkspaceBackupActivationSelection) {
  exact(value, ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId']);
  check(Object.values(value).every(id) && value.targetId !== value.inertTargetId
    && new Set([value.backupId, value.materialId, value.candidateId]).size === 3,
  'BACKUP_ACTIVATION_IDENTITY', 'Select distinct issued records and a separate empty activation target.');
}

/** Derives only inert candidate evidence. No Vault, filesystem, active authority, Engine or public route capability. */
export class WorkspaceBackupActivationHost {
  readonly #ports: WorkspaceBackupActivationPorts;
  readonly #policy: WorkspaceBackupActivationPolicy;
  constructor(ports: WorkspaceBackupActivationPorts, policy: WorkspaceBackupActivationPolicy) {
    check(ports && typeof ports.withTransaction === 'function' && typeof ports.custody?.read === 'function'
      && (ports.custody.readHeld === undefined || typeof ports.custody.readHeld === 'function'),
      'BACKUP_ACTIVATION_ROOT_REQUIRED', 'Held root archive/material/target custody and authenticated candidate read ports are required.');
    exact(policy, ['approvedSyntheticWorkspaceIds', 'backupBudgets', 'maxMaterialUtf8Bytes', 'maxCandidateUtf8Bytes']);
    exact(policy.backupBudgets, ['maxArchiveUtf8Bytes', 'maxEntryBytes', 'maxTotalEntryBytes', 'maxEntries', 'maxJsonDepth', 'maxJsonNodes']);
    check(Array.isArray(policy.approvedSyntheticWorkspaceIds) && policy.approvedSyntheticWorkspaceIds.length > 0
      && policy.approvedSyntheticWorkspaceIds.every(id) && new Set(policy.approvedSyntheticWorkspaceIds).size === policy.approvedSyntheticWorkspaceIds.length
      && [...Object.values(policy.backupBudgets), policy.maxMaterialUtf8Bytes, policy.maxCandidateUtf8Bytes].every(n => Number.isSafeInteger(n) && n > 0)
      && policy.backupBudgets.maxEntryBytes <= policy.backupBudgets.maxTotalEntryBytes && policy.backupBudgets.maxJsonDepth <= 256
      && policy.maxMaterialUtf8Bytes <= 64 * 1024 * 1024 && policy.maxCandidateUtf8Bytes <= 64 * 1024 * 1024,
    'BACKUP_ACTIVATION_POLICY', 'Declare exact trusted synthetic sources and explicit complete operation budgets.');
    this.#ports = ports; this.#policy = structuredClone(policy);
  }
  #provenance(context: Context, chosen: WorkspaceBackupActivationSelection, backup: BackupRead, material: MaterialRead, inert: WorkspaceBackupActivationInertRead,
    refs: WorkspaceBackupActivationMaterialRefs): CheckedOriginal {
    exact(backup, ['content', 'pin', 'measurement']); measured(backup.measurement, true);
    exact(backup.pin, ['format', 'recordId', 'creationId', 'contextDigest', 'archiveDigest', 'sourcePin']);
    check(backup.pin.format === 'chausar.backup-custody-pin.v2' && backup.pin.recordId === chosen.backupId && id(backup.pin.creationId)
      && backup.pin.contextDigest === interchangeDigest(context), 'BACKUP_ACTIVATION_CUSTODY', 'Use the exact independently issued backup creation and owner context.');
    const archive = validateWorkspaceBackupV2(backup.content, backup.pin.sourcePin, this.#policy.backupBudgets);
    check(archive.digest === backup.pin.archiveDigest, 'BACKUP_ACTIVATION_CUSTODY', 'Backup differs from independently authenticated issuance.');
    check(this.#policy.approvedSyntheticWorkspaceIds.includes(archive.pin.source.workspaceId), 'ACTIVATION_SYNTHETIC_ONLY', 'Root must approve the exact synthetic source identity.');
    exact(inert, ['content', 'receipt', 'inspection']);
    exact(inert.receipt, ['targetId', 'creationId', 'archiveDigest', 'sourcePin', 'entries', 'bytes', 'inert', 'activation']);
    exact(inert.inspection, ['targetId', 'locationId', 'generation', 'contextDigest', 'containerDigest', 'containerBytes']);
    const receipt = inert.receipt, inspection = inert.inspection;
    check(inert.content === backup.content && receipt.targetId === chosen.inertTargetId && receipt.creationId === chosen.inertCreationId
      && receipt.archiveDigest === archive.digest && equal(receipt.sourcePin, archive.pin) && receipt.inert === true && receipt.activation === 'root-only'
      && receipt.entries === archive.pin.artifacts.length + 1 && receipt.bytes === archive.pin.authority.bytes + archive.pin.artifacts.reduce((sum, item) => sum + item.bytes, 0)
      && inspection.targetId === chosen.inertTargetId && id(inspection.locationId) && id(inspection.generation)
      && inspection.contextDigest === interchangeDigest(context) && digest(inspection.containerDigest)
      && Number.isSafeInteger(inspection.containerBytes) && inspection.containerBytes > Buffer.byteLength(inert.content),
    'BACKUP_ACTIVATION_INERT_CHANGED', 'Actual restored reservation, physical container and complete encrypted original must agree with independent backup custody.');
    exact(material, ['content', 'pin', 'measurement']); measured(material.measurement, false);
    exact(material.pin, ['format', 'recordId', 'creationId', 'contextDigest', 'inventory', 'packageDigest', 'kind']);
    check(material.pin.format === 'chausar.interchange-custody-pin.v1' && material.pin.kind === 'export'
      && material.pin.recordId === chosen.materialId && id(material.pin.creationId) && material.pin.contextDigest === interchangeDigest(context),
    'BACKUP_ACTIVATION_MATERIAL', 'Retained semantic material requires a separate authenticated export issuance and context.');
    check(typeof material.content === 'string' && Buffer.byteLength(material.content) <= this.#policy.maxMaterialUtf8Bytes,
      'BACKUP_ACTIVATION_LIMIT', 'The complete semantic export exceeds its explicit byte budget.');
    const semantic = validateWorkspaceInterchange(material.content, material.pin.inventory);
    check(semantic.digest === material.pin.packageDigest && semantic.inventory.generation.workspaceId === archive.pin.source.workspaceId
      && semantic.inventory.generation.revision === archive.pin.source.revision,
    'BACKUP_ACTIVATION_MATERIAL', 'Independent semantic export must belong to the exact archived workspace and authority revision.');
    exact(refs, ['archive', 'pin', 'binding']);
    for (const ref of Object.values(refs)) {
      exact(ref, ['id', 'purpose', 'valueDigest', 'diskBytes']);
      check(ref.purpose === 'workspace-interchange' && archive.pin.artifacts.some(item => item.id === ref.id && item.purpose === ref.purpose
        && item.valueDigest === ref.valueDigest && item.bytes === ref.diskBytes),
      'BACKUP_ACTIVATION_MATERIAL', 'The authenticated semantic export, independent pin and committed binding must all be present in the original encrypted capture.');
    }
    check(new Set(Object.values(refs).map(ref => ref.id)).size === 3, 'BACKUP_ACTIVATION_MATERIAL', 'Export, independent pin and committed binding require distinct archived identities.');
    const provenance: WorkspaceBackupActivationProvenance = { format: PROVENANCE,
      backup: { content: backup.content, pin: structuredClone(backup.pin) },
      material: { content: material.content, pin: structuredClone(material.pin) }, inert: structuredClone(inert), materialRefs: structuredClone(refs),
      custodyQualification: [backup.measurement.qualification, material.measurement.qualification].includes('test-fixture') ? 'test-fixture' : 'encrypted-local-host' };
    return { archive, semantic, provenance };
  }
  #derive(context: Context, chosen: WorkspaceBackupActivationSelection, historical: State, target: EmptyTargetInspection,
    checked: CheckedOriginal): Derived {
    // The interchange codec orders top-level stores. Every retained nested key and array order must remain exact.
    check(equal(Object.keys(historical).sort(), checked.semantic.stores.map(item => item.manifest.name).sort())
      && checked.semantic.stores.every(item => item.text === JSON.stringify(historical[item.manifest.name as keyof State])),
    'BACKUP_ACTIVATION_STATE_CHANGED', 'Every semantic store must match the authenticated original authority, including nested semantic key order.');
    check(!historical.imports.some(item => typeof item?.type === 'string' && item.type.startsWith('connector-')),
      'ACTIVATION_MANAGED_SOURCE', 'Managed connector history requires fresh profiles and all current consumer gates before activation.');
    check(target.targetId === chosen.targetId, 'INTERCHANGE_TARGET_CHANGED', 'Root inspected another activation target.');
    proveEmptyWorkspaceTarget(target);
    const generation = { workspaceId: checked.archive.pin.source.workspaceId, revision: checked.archive.pin.source.revision, captureId: checked.archive.pin.source.captureId };
    check(!checked.semantic.artifacts.some(item => item.manifest.id === EVIDENCE_ID), 'BACKUP_ACTIVATION_MATERIAL', 'Retained material conflicts with the reserved provenance artifact identity.');
    const artifacts: ArtifactCapture = { complete: true, generation, enumerationId: checked.archive.pin.source.enumerationId,
      categories: workspaceStateProfile().artifactCategories,
      artifacts: [...checked.semantic.artifacts.map(item => ({ id: item.manifest.id, category: item.manifest.category, mediaType: item.manifest.mediaType,
        bytes: retainedArtifactBytes(item), generation: structuredClone(generation) })),
      { id: EVIDENCE_ID, category: 'other-retained', mediaType: 'application/json', bytes: Buffer.from(canonicalInterchangeJson(checked.provenance)), generation: structuredClone(generation) }] };
    const capture = captureWorkspaceInterchange(historical, artifacts);
    const candidate = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }), target: () => target,
      assertCompleteRead: (ctx, state) => owner(ctx, state) }).prepare(context, { text: canonicalInterchangeJson(capture.package), targetId: chosen.targetId });
    const content = canonicalInterchangeJson(candidate);
    check(Buffer.byteLength(content) <= this.#policy.maxCandidateUtf8Bytes, 'BACKUP_ACTIVATION_LIMIT', 'The entire candidate and encrypted original exceed the explicit byte budget.');
    return { candidate, content, capture };
  }
  #candidate(context: Context, candidateId: string, read: AuthenticatedActivationCandidate) {
    exact(read, ['content', 'pin', 'measurement']); measured(read.measurement, false);
    exact(read.pin, ['format', 'recordId', 'creationId', 'contextDigest', 'inventory', 'packageDigest', 'kind', 'candidateDigest', 'target']);
    check(read.pin.format === 'chausar.interchange-custody-pin.v1' && read.pin.kind === 'candidate' && read.pin.recordId === candidateId
      && id(candidateId) && id(read.pin.creationId) && read.pin.contextDigest === interchangeDigest(context),
    'BACKUP_ACTIVATION_CUSTODY', 'Use the independently retained candidate creation and current issuing context.');
    const pin = read.pin;
    check(typeof read.content === 'string' && Buffer.byteLength(read.content) <= this.#policy.maxCandidateUtf8Bytes,
      'BACKUP_ACTIVATION_LIMIT', 'Complete retained candidate exceeds its constructor byte budget.');
    let candidate: WorkspaceImportCandidate;
    try { candidate = JSON.parse(read.content); } catch { throw new ChausarError('BACKUP_ACTIVATION_CUSTODY', 'Retained candidate is incomplete JSON.'); }
    check(canonicalInterchangeJson(candidate) === read.content && interchangeDigest(candidate) === read.pin.candidateDigest,
      'BACKUP_ACTIVATION_CUSTODY', 'Candidate differs from its independent authenticated digest.');
    const rebuilt = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: pin.inventory }), target: () => pin.target,
      assertCompleteRead: (ctx, state) => owner(ctx, state) }).prepare(context, { text: canonicalInterchangeJson(candidate.archive), targetId: pin.target.targetId });
    check(equal(candidate, rebuilt) && candidate.packageDigest === read.pin.packageDigest, 'BACKUP_ACTIVATION_CUSTODY', 'Candidate differs from independently issued inventory and target proof.');
    const item = candidate.archive.artifacts.find(entry => entry.manifest.id === EVIDENCE_ID);
    check(item?.manifest.category === 'other-retained' && item.manifest.mediaType === 'application/json' && item.manifest.representation === 'literal-utf8',
      'BACKUP_ACTIVATION_CUSTODY', 'Complete bridge provenance must remain in inert evidence.');
    let provenance: WorkspaceBackupActivationProvenance;
    try { provenance = JSON.parse(item.text); } catch { throw new ChausarError('BACKUP_ACTIVATION_CUSTODY', 'Bridge provenance is incomplete JSON.'); }
    exact(provenance, ['format', 'backup', 'material', 'inert', 'materialRefs', 'custodyQualification']);
    exact(provenance.backup, ['content', 'pin']); exact(provenance.material, ['content', 'pin']);
    check(provenance.format === PROVENANCE && canonicalInterchangeJson(provenance) === item.text, 'BACKUP_ACTIVATION_CUSTODY', 'Use the exact complete bridge provenance format.');
    check(['test-fixture', 'encrypted-local-host'].includes(provenance.custodyQualification)
      && (provenance.custodyQualification !== 'test-fixture' || read.measurement.qualification === 'test-fixture'),
    'BACKUP_ACTIVATION_CUSTODY', 'Fixture evidence cannot be promoted to qualified local custody.');
    const chosen = { backupId: provenance.backup.pin.recordId, materialId: provenance.material.pin.recordId, inertTargetId: provenance.inert.receipt.targetId,
      inertCreationId: provenance.inert.receipt.creationId, candidateId, targetId: read.pin.target.targetId };
    selection(chosen);
    return { chosen, provenance, candidate };
  }
  async #transaction<T>(context: Context, chosen: WorkspaceBackupActivationSelection, mode: 'prepare' | 'inspect',
    work: (lease: WorkspaceBackupActivationLease, derived: Derived, current: () => Promise<void>, provenance: WorkspaceBackupActivationProvenance) => Promise<T>) {
    let calls = 0;
    const result = await this.#ports.withTransaction(structuredClone(context), { ...structuredClone(chosen), mode }, async lease => {
      check(++calls === 1 && lease && ['readBackup', 'readMaterial', 'readInert', 'authenticateArchive', 'authenticateMaterial', 'assertCompleteOwner', 'assertCurrent', 'createCandidate', 'readCandidate'].every(key => typeof (lease as any)[key] === 'function'),
        'BACKUP_ACTIVATION_ROOT_REQUIRED', 'Root must execute exactly one complete held bridge transaction.');
      const currentState = structuredClone(lease.currentState), target = structuredClone(lease.target); owner(context, currentState);
      await completed(() => lease.assertCurrent());
      const backup = structuredClone(await lease.readBackup()), material = structuredClone(await lease.readMaterial()), inert = structuredClone(await lease.readInert());
      // Validate untrusted wire/independent pins before handing bounded ciphertext to cryptographic root ports.
      const { capture } = validateWorkspaceBackupV2Capture(backup.content, backup.pin.sourcePin, this.#policy.backupBudgets);
      exact(material, ['content', 'pin', 'measurement']); measured(material.measurement, false);
      check(typeof material.content === 'string' && Buffer.byteLength(material.content) <= this.#policy.maxMaterialUtf8Bytes,
        'BACKUP_ACTIVATION_LIMIT', 'Complete material must fit its budget before cryptographic admission.');
      const refs = structuredClone(await lease.authenticateMaterial(structuredClone(capture), { content: material.content, pin: structuredClone(material.pin) }));
      const checked = this.#provenance(context, chosen, backup, material, inert, refs);
      check(currentState.workspace.id === checked.archive.pin.source.workspaceId, 'INTERCHANGE_AUTHORITY_CHANGED',
        'Current owner admission must belong to the exact independently archived source workspace.');
      await completed(() => lease.assertCurrent());
      const historical = structuredClone(await lease.authenticateArchive(structuredClone(capture)));
      check(historical.workspace.id === checked.archive.pin.source.workspaceId && historical.revision === checked.archive.pin.source.revision,
        'BACKUP_ACTIVATION_STATE_CHANGED', 'Authenticated historical authority must retain the exact independently pinned workspace and revision.');
      owner(context, currentState);
      const sourceIds = [...new Set([...historical.facts.map(item => item.sourceId), ...historical.imports.map(item => item?.sourceId).filter((value): value is string => typeof value === 'string')])];
      assertSourceAccess(currentState, context, sourceIds);
      check(historical.facts.every(fact => canSeeFact({ read: () => currentState, update: async () => { throw new Error('Read-only bridge.'); } }, context, fact)),
        'INTERCHANGE_READ_SCOPE_REQUIRED', 'Current owner must see every archived row.');
      const current = async () => {
        await completed(() => lease.assertCompleteOwner(structuredClone(context), structuredClone(historical)));
        await completed(() => lease.assertCurrent());
        // Reread each independent issuance as well as the root's physical/admission fence.
        check(equal(await lease.readBackup(), backup) && equal(await lease.readMaterial(), material) && equal(await lease.readInert(), inert),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Independent backup, semantic export or restored creation changed during the transaction.');
        await completed(() => lease.assertCurrent());
      };
      await current(); const derived = this.#derive(context, chosen, historical, target, checked); await current();
      return work(lease, derived, current, checked.provenance);
    });
    check(calls === 1, 'BACKUP_ACTIVATION_ROOT_REQUIRED', 'Root did not execute the held bridge callback.');
    return result;
  }
  #summary(read: AuthenticatedActivationCandidate, provenance: WorkspaceBackupActivationProvenance): WorkspaceBackupActivationReview {
    check(read.pin.kind === 'candidate', 'BACKUP_ACTIVATION_CUSTODY', 'A candidate pin is required.');
    const sourcePin = provenance.backup.pin.sourcePin;
    return { candidateId: read.pin.recordId, candidateCreationId: read.pin.creationId, reviewedDigest: read.pin.candidateDigest, packageDigest: read.pin.packageDigest,
      source: structuredClone(sourcePin.source), backupId: provenance.backup.pin.recordId, backupCreationId: provenance.backup.pin.creationId,
      archiveDigest: provenance.backup.pin.archiveDigest, materialId: provenance.material.pin.recordId, materialCreationId: provenance.material.pin.creationId,
      inertTargetId: provenance.inert.receipt.targetId, inertCreationId: provenance.inert.receipt.creationId,
      targetId: read.pin.target.targetId, targetWorkspaceId: read.pin.target.workspaceId, targetProofDigest: proveEmptyWorkspaceTarget(read.pin.target),
      scope: sourcePin.scope, fullWorkspacePortable: false, inert: true, activation: 'root-only', namespaces: structuredClone(sourcePin.namespaces),
      externalKeyRequirements: structuredClone(sourcePin.externalKeyRequirements), measurement: structuredClone(read.measurement) };
  }
  async prepare(contextInput: Context, input: WorkspaceBackupActivationSelection & { reviewedArchiveDigest: string; confirmed: true }): Promise<WorkspaceBackupActivationReview> {
    exact(input, ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId', 'reviewedArchiveDigest', 'confirmed']);
    check(input.confirmed === true && digest(input.reviewedArchiveDigest), 'CONFIRMATION_REQUIRED', 'Confirm one reviewed complete encrypted archive.');
    const context = structuredClone(contextInput), { reviewedArchiveDigest, confirmed: _confirmed, ...chosen } = structuredClone(input); selection(chosen);
    let attempted = false;
    try {
      return await this.#transaction(context, chosen, 'prepare', async (lease, derived, current, provenance) => {
        check(provenance.backup.pin.archiveDigest === reviewedArchiveDigest, 'INTERCHANGE_REVIEW_CHANGED', 'Review the exact independently issued archive digest.');
        const record: WorkspaceInterchangeCustodyRecord = { content: derived.content,
          pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: chosen.candidateId, creationId: `bridge_${randomUUID()}`,
            contextDigest: interchangeDigest(context), inventory: derived.capture.inventory, packageDigest: derived.candidate.packageDigest,
            candidateDigest: interchangeDigest(derived.candidate), target: structuredClone(lease.target) } };
        await current(); let publicationChecks = 0; attempted = true;
        const measurement = await lease.createCandidate(structuredClone(record), async () => { await current(); publicationChecks++; }); measured(measurement, false);
        check(provenance.custodyQualification !== 'test-fixture' || measurement.qualification === 'test-fixture',
          'BACKUP_ACTIVATION_CUSTODY', 'Fixture original custody cannot become qualified local evidence.');
        check(publicationChecks > 0, 'BACKUP_ACTIVATION_GUARD', 'Root must check the held physical and current admission fences at actual publication.');
        const read = structuredClone(await lease.readCandidate()); this.#candidate(context, chosen.candidateId, read);
        check(equal({ content: read.content, pin: read.pin }, record) && equal(read.measurement, measurement), 'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Actual candidate readback differs from the exact issued publication.');
        await current(); return this.#summary(read, provenance);
      });
    } catch (error) {
      if (attempted) throw new ChausarError('BACKUP_ACTIVATION_COMMIT_UNKNOWN', `Candidate ${chosen.candidateId} attempted issuance without exact acknowledgement. Inspect that identity; do not retry, overwrite or delete.`);
      throw error;
    }
  }
  /** Explicit authenticated inspection after restart or lost issuance acknowledgement. Never publishes. */
  async inspect(contextInput: Context, input: { candidateId: string }): Promise<{ review: WorkspaceBackupActivationReview; evidence: WorkspaceActivationEvidence }> {
    return this.#inspect(contextInput, input, this.#ports.custody.read);
  }
  /** Trusted composition only: the installed reader must enforce a live exact source scope. */
  async inspectHeld(contextInput: Context, input: { candidateId: string }): Promise<{ review: WorkspaceBackupActivationReview; evidence: WorkspaceActivationEvidence }> {
    check(typeof this.#ports.custody.readHeld === 'function', 'BACKUP_ACTIVATION_ROOT_REQUIRED',
      'Held inspection requires a constructor-installed current source-scope reader.');
    return this.#inspect(contextInput, input, this.#ports.custody.readHeld);
  }
  async #inspect(contextInput: Context, input: { candidateId: string }, readCandidate: WorkspaceBackupActivationPorts['custody']['read']): Promise<{ review: WorkspaceBackupActivationReview; evidence: WorkspaceActivationEvidence }> {
    exact(input, ['candidateId']); check(id(input.candidateId), 'BACKUP_ACTIVATION_IDENTITY', 'Inspect one explicit candidate identity.');
    const context = structuredClone(contextInput), read = structuredClone(await readCandidate.call(this.#ports.custody, structuredClone(context), input.candidateId));
    const checked = this.#candidate(context, input.candidateId, read);
    return this.#transaction(context, checked.chosen, 'inspect', async (lease, derived, current, provenance) => {
      const held = structuredClone(await lease.readCandidate()); this.#candidate(context, input.candidateId, held);
      check(equal(read, held) && read.content === derived.content && equal(checked.provenance, provenance)
        && equal(read.pin.inventory, derived.capture.inventory) && equal(read.pin.kind === 'candidate' && read.pin.target, lease.target),
      'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Retained candidate must rebuild exactly from independent original custody and the current target.');
      await current();
      return { review: this.#summary(read, provenance), evidence: { format: 'chausar.workspace-activation-evidence.v1', inert: true, content: read.content, pin: structuredClone(read.pin) } };
    });
  }
}
