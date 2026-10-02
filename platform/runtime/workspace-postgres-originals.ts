import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { authorize, check, ChausarError, hash, type Context, type State } from './contracts.ts';
import { canSeeFact } from './memory.ts';
import { acquireProcessLock } from './process-lock.ts';
import { assertSourceAccess } from './trust.ts';
import { safeDirectory, Vault, type PrivateArtifactRef, type VaultEncryptedCustodyCapture } from './vault.ts';
import { WorkspaceBackupV2PostgresCustody } from './workspace-backup-postgres.ts';
import { WorkspaceInterchangeLocalCustody } from './workspace-interchange-local.ts';
import { WorkspacePostgresCustody, type PostgresStorageIdentity } from './workspace-postgres-custody.ts';
import { WorkspaceBackupActivationHost, type WorkspaceBackupActivationMaterialRefs, type WorkspaceBackupActivationPolicy } from './workspace-backup-activation.ts';
import type { WorkspaceActivationPolicy } from './workspace-activation.ts';
import type { WorkspaceActivationLocalOptions } from './workspace-activation-local.ts';
import type { WorkspacePostgresActivationCandidates, WorkspacePostgresBackupActivationOriginals } from './workspace-activation-postgres.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState, retainedArtifactBytes, validateWorkspaceInterchange, workspaceStateProfile } from './workspace-interchange.ts';
import { validateWorkspaceBackupV2, workspaceBackupV2Bytes, type WorkspaceBackupV2Capture } from './workspace-backup-v2.ts';
import type { ArtifactCapture, EmptyTargetInspection, WorkspaceInventory } from './workspace-interchange-contracts.ts';
import type { WorkspaceInterchangeCustodyRecord, WorkspaceInterchangeSourceLease } from './workspace-interchange-host.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const slotPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ref = ({ id, purpose, valueDigest, diskBytes }: PrivateArtifactRef): PrivateArtifactRef => ({ id, purpose, valueDigest, diskBytes });
const reservationId = (id: string) => `wit_${sha(id)}_reservation`;
const nativeTargetId = (id: string) => `wpg_target_${sha(id)}_identity`;
const exportId = (id: string, part: string) => `wic_${sha(id)}_${part}`;
const encryptedBudgets = { maxArtifacts: 4096, maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 64 * 1024 * 1024 };
type Physical = { dev: string; ino: string; birthtimeNs: string };
const physical = (stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Physical => ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
type Inventory = Awaited<ReturnType<WorkspaceBackupV2PostgresCustody['inspectHeldNamespaces']>>;
type Reservation = { format: 'chausar.interchange-target-reservation.v1'; sourceVaultId: string; sourceWorkspaceId: string; targetId: string; workspaceId: string; generation: string; contextDigest: string; physical: Physical };
type TargetIdentity = { format: 'chausar.activation-postgres-empty-target.v1'; reservation: PrivateArtifactRef; storage: PostgresStorageIdentity; operationId: string; creationId: string };
type HeldInspection = { candidateId: string; active: boolean; used: boolean };
type Scope = { context: Context; lease: WorkspaceInterchangeSourceLease; inspection?: HeldInspection };
const applicationRoots = ['application/backups', 'application/exports', 'application/updates'];
function applicationWitness(inventory: Inventory) {
  const selected = (path: string) => applicationRoots.some(root => path === root || path.startsWith(`${root}/`));
  return { directories: inventory.directories.filter(item => item.path === 'application' || selected(item.path)),
    files: inventory.files.filter(item => selected(item.path)), namespaces: inventory.namespaces.filter(item => applicationRoots.includes(item.namespace)) };
}
function sourceWitness(inventory: Inventory) {
  const selected = (path: string) => path.startsWith('workspace/') || path.startsWith('private-artifacts/');
  return { postgres: inventory.postgres, physical: inventory.physical, directories: inventory.directories.filter(item => selected(item.path)),
    files: inventory.files.filter(item => selected(item.path)), namespaces: inventory.namespaces.filter(item => selected(item.namespace)) };
}
function encryptedFence(capture: VaultEncryptedCustodyCapture) {
  return { state: hash(capture.state), authority: sha(capture.authority), artifacts: capture.artifacts.map(item => ({ ref: item.ref, sha256: sha(item.bytes) })) };
}

export type WorkspacePostgresOriginalsOptions = {
  sourceVault: Vault; journalVault: Vault; applicationDirectory: string;
  backup: WorkspaceBackupV2PostgresCustody; interchange: WorkspaceInterchangeLocalCustody; nativeSource: WorkspacePostgresCustody;
  backupPolicy: WorkspaceBackupActivationPolicy; policy: WorkspaceActivationPolicy;
  assertCompleteOwner(context: Context, historical: State): Promise<void>;
  /** Hold the preinstalled exact target adapter's SQL lease, not merely a per-call inspection.
   * Nested custody calls must use that same adapter. No SQL reservation is issued here. */
  withTargetCustody<T>(targetId: string, targetDirectory: string, work: (custody: WorkspacePostgresCustody) => Promise<T>): Promise<T>;
  /** Late constructor composition only; these are never RPC payloads or default ports. */
  candidates(): Pick<WorkspacePostgresActivationCandidates, 'readCandidateHeld'>;
  bridge(): WorkspaceBackupActivationHost;
};

/** Real source/archive/export/inert orchestration for PostgreSQL activation.
 * B acquires the Vault queue before the same-adapter native lease. C owns candidate
 * issuance/exclusion and physical/SQL publication. Existing codecs remain authoritative.
 * Journal/control/target namespaces require separate root-reviewed recovery: portability is false. */
export class WorkspacePostgresOriginals {
  readonly source: WorkspaceActivationLocalOptions['source'];
  readonly originals: WorkspacePostgresBackupActivationOriginals;
  readonly #options: WorkspacePostgresOriginalsOptions;
  readonly #scope = new AsyncLocalStorage<Scope>();
  constructor(options: WorkspacePostgresOriginalsOptions) {
    check(options?.sourceVault instanceof Vault && options.sourceVault.storageKind === 'postgres'
      && options.journalVault instanceof Vault && options.journalVault.storageKind === 'postgres'
      && options.sourceVault !== options.journalVault && options.sourceVault.vaultId !== options.journalVault.vaultId
      && options.backup instanceof WorkspaceBackupV2PostgresCustody && options.interchange instanceof WorkspaceInterchangeLocalCustody
      && options.nativeSource instanceof WorkspacePostgresCustody && isAbsolute(options.applicationDirectory)
      && [options.assertCompleteOwner, options.withTargetCustody, options.candidates, options.bridge].every(value => typeof value === 'function'),
    'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Install actual distinct PostgreSQL source/journal custody, held target admission and original evidence readers.');
    const applicationDirectory = resolve(options.applicationDirectory), source = relative(applicationDirectory, options.sourceVault.directory), journal = relative(applicationDirectory, options.journalVault.directory);
    check(source && journal && source !== journal && [source, journal].every(value => value !== '..' && !isAbsolute(value) && !value.includes(sep)),
      'ACTIVATION_ROOT_REQUIRED', 'Source and reviewed journal must be distinct direct managed application children.');
    this.#options = { ...options, applicationDirectory, backupPolicy: structuredClone(options.backupPolicy), policy: structuredClone(options.policy) };
    this.source = { withSource: (context, expected, work, candidateId) => this.#withSource(context, expected, work, candidateId) };
    this.originals = { withTransaction: (context, selection, work) => this.#transaction(context, selection, work),
      readCandidateHeld: (context, id) => this.#readCandidateForInspection(context, id) };
  }
  targetPath(id: string) {
    const o = this.#options;
    check(typeof id === 'string' && slotPattern.test(id) && !['main', 'backups', 'exports', 'updates', 'private-artifacts', 'reports', 'plugin-assets', 'research-evidence', 'conversation-files', 'sync-evidence',
      relative(o.applicationDirectory, o.sourceVault.directory), relative(o.applicationDirectory, o.journalVault.directory)].includes(id),
    'ACTIVATION_UNSAFE_PATH', 'Choose a distinct managed empty target ID.');
    return join(o.applicationDirectory, id);
  }
  async #owner(context: Context, historical: State) {
    const o = this.#options, current = o.sourceVault.read();
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Use the current untainted desktop owner.');
    const member = authorize(o.sourceVault, context, 'admin');
    check(member.role === 'owner' && member.branches.includes('*') && o.policy.approvedSyntheticWorkspaceIds.includes(current.workspace.id),
      'ACTIVATION_SYNTHETIC_SCOPE', 'Only constructor-approved synthetic workspaces and their current unrestricted owner may activate.');
    check(historical.workspace.id === current.workspace.id, 'ACTIVATION_SOURCE_CHANGED', 'Historical material must belong to this source workspace.');
    assertSourceAccess(current, context, [...new Set([...historical.facts.map(item => item.sourceId), ...historical.imports.map(item => item.sourceId).filter((item): item is string => typeof item === 'string')])]);
    check(historical.facts.every(item => canSeeFact(o.sourceVault, context, item)), 'INTERCHANGE_READ_SCOPE_REQUIRED', 'Current owner must be able to read every retained historical row.');
    check(await o.assertCompleteOwner(structuredClone(context), structuredClone(historical)) === undefined,
      'ACTIVATION_ROOT_GUARD', 'Current complete-owner/readiness admission must finish without a deferred value.');
  }
  async #targetLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const directory = await safeDirectory(join(this.#options.applicationDirectory, '.workspace-interchange-control', 'targets'), true);
    const lock = await acquireProcessLock(join(directory, `${sha(this.targetPath(id))}.lock`), { busyCode: 'ACTIVATION_BUSY', changedCode: 'ACTIVATION_LOCK_CHANGED' });
    try { return await work(); } finally { await lock.release(); }
  }
  async #sourceContainers() {
    // B records every file and purpose directory, but the intermediate private
    // root itself also needs a physical-generation fence against replacement.
    const root = await safeDirectory(this.#options.sourceVault.directory), names = (await readdir(root)).sort();
    let privateRoot: Physical | null = null;
    if (names.includes('private-artifacts')) {
      const directory = await safeDirectory(join(root, 'private-artifacts'));
      privateRoot = physical(await lstat(directory, { bigint: true }));
    }
    return { root: physical(await lstat(root, { bigint: true })), names, privateRoot };
  }
  async #nativeTarget<T>(id: string, work: (custody: WorkspacePostgresCustody, storage: PostgresStorageIdentity) => Promise<T>): Promise<T> {
    let calls = 0;
    const result = await this.#options.withTargetCustody(id, this.targetPath(id), async custody => {
      check(++calls === 1 && custody instanceof WorkspacePostgresCustody, 'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Execute one held actual target custody callback.');
      const storage = await custody.storageIdentity(), source = await this.#options.nativeSource.storageIdentity();
      check(!(storage.storageId === source.storageId && storage.databaseOid === source.databaseOid && storage.serverAddress === source.serverAddress
        && storage.serverPort === source.serverPort && storage.slot === source.slot), 'ACTIVATION_POSTGRES_TARGET_OCCUPIED', 'The target must use a distinct native SQL authority slot.');
      const value = await work(custody, storage);
      check(same(await custody.storageIdentity(), storage), 'ACTIVATION_TARGET_CHANGED', 'Target native storage identity changed before admission was released.');
      return value;
    });
    check(calls === 1, 'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Target custody did not execute its held callback.'); return result;
  }
  async #target(context: Context, id: string, custody: WorkspacePostgresCustody, storage: PostgresStorageIdentity): Promise<EmptyTargetInspection> {
    const o = this.#options, saved = await o.sourceVault.readArtifact({ id: reservationId(id), purpose: 'workspace-interchange' }), reservation = saved.value as Reservation;
    const native = await o.sourceVault.readArtifact({ id: nativeTargetId(id), purpose: 'workspace-interchange' }), binding = native.value as TargetIdentity;
    const path = await safeDirectory(this.targetPath(id)), stat = await lstat(path, { bigint: true });
    check(reservation?.format === 'chausar.interchange-target-reservation.v1' && reservation.sourceVaultId === o.sourceVault.vaultId
      && reservation.sourceWorkspaceId === o.sourceVault.read().workspace.id && reservation.targetId === id
      && reservation.contextDigest === interchangeDigest(context) && typeof reservation.workspaceId === 'string' && idPattern.test(reservation.workspaceId)
      && typeof reservation.generation === 'string' && idPattern.test(reservation.generation)
      && stat.isDirectory() && !stat.isSymbolicLink() && path === this.targetPath(id) && same(physical(stat), reservation.physical)
      && binding?.format === 'chausar.activation-postgres-empty-target.v1' && same(binding.reservation, ref(saved)) && same(binding.storage, storage)
      && typeof binding.operationId === 'string' && idPattern.test(binding.operationId) && typeof binding.creationId === 'string' && idPattern.test(binding.creationId),
    'ACTIVATION_TARGET_CHANGED', 'Actual target must retain both independently source-encrypted native and physical empty-target issuance.');
    const inspection = await custody.inspectOperation({ operationId: binding.operationId, creationId: binding.creationId });
    check(inspection.status === 'absent', 'ACTIVATION_TARGET_NOT_EMPTY', 'Candidate target admission requires an actual absent, unreserved SQL authority slot.');
    const entries = (await readdir(path)).sort(), profile = workspaceStateProfile();
    check(entries.length === 0, 'ACTIVATION_TARGET_NOT_EMPTY', 'Candidate target admission requires an actually empty issued physical directory.');
    return { targetId: id, workspaceId: reservation.workspaceId, generation: reservation.generation,
      accessDigest: interchangeDigest({ context, members: o.sourceVault.read().members, policy: o.sourceVault.read().policy }), ready: true, profile,
      stores: profile.stores.map(store => ({ name: store.name, records: 0 })), categoryCounts: profile.artifactCategories.map(category => ({ category, count: 0 })),
      authorityRecords: entries.length ? 1 : 0, unexpectedEntries: entries };
  }
  async createTarget(context: Context, id: string): Promise<EmptyTargetInspection> {
    check(!this.#scope.getStore(), 'ACTIVATION_ROOT_GUARD', 'Issue targets outside a frozen original source callback.');
    let attempted = false;
    try { return await this.#options.backup.withHeldSource(context, () => this.#targetLock(id, () => this.#nativeTarget(id, async (custody, storage) => {
      const o = this.#options; await this.#owner(context, o.sourceVault.read());
      const operationId = `empty_${randomUUID()}`, creationId = `empty_${randomUUID()}`;
      check((await custody.inspectOperation({ operationId, creationId })).status === 'absent', 'ACTIVATION_TARGET_NOT_EMPTY', 'Target SQL slot must be absent before physical issuance.');
      const prior = await o.sourceVault.listArtifacts({ purpose: 'workspace-interchange' });
      check(!prior.some(item => [reservationId(id), nativeTargetId(id)].includes(item.id)), 'ACTIVATION_SINGLE_USE', 'Target IDs remain single-use after every issuance attempt.');
      const path = this.targetPath(id); try { await lstat(path); throw new ChausarError('ACTIVATION_TARGET_EXISTS', 'Existing directories are never adopted.'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      await this.#owner(context, o.sourceVault.read()); attempted = true; await mkdir(path, { mode: 0o700 });
      const reservation: Reservation = { format: 'chausar.interchange-target-reservation.v1', sourceVaultId: o.sourceVault.vaultId,
        sourceWorkspaceId: o.sourceVault.read().workspace.id, targetId: id, workspaceId: `workspace_${randomUUID()}`, generation: `empty_${randomUUID()}`,
        contextDigest: interchangeDigest(context), physical: physical(await lstat(path, { bigint: true })) };
      const issued = await o.sourceVault.writeArtifact({ id: reservationId(id), purpose: 'workspace-interchange', expectedDigest: null, value: reservation });
      await o.sourceVault.writeArtifact({ id: nativeTargetId(id), purpose: 'workspace-interchange', expectedDigest: null,
        value: { format: 'chausar.activation-postgres-empty-target.v1', reservation: ref(issued), storage, operationId, creationId } satisfies TargetIdentity });
      const target = await this.#target(context, id, custody, storage); await this.#owner(context, o.sourceVault.read()); return target;
    }))); } catch (error) {
      if (attempted) throw new ChausarError('ACTIVATION_TARGET_COMMIT_UNKNOWN', `Target ${id} attempted physical/native reservation issuance without complete acknowledgement. Inspect that identity; do not retry, adopt or overwrite it.`);
      throw error;
    }
  }
  inspectTarget(context: Context, id: string) {
    return this.#options.backup.withHeldSource(context, () => this.#targetLock(id, () => this.#nativeTarget(id, async (custody, storage) => {
      await this.#owner(context, this.#options.sourceVault.read());
      try { const target = await this.#target(context, id, custody, storage); await this.#owner(context, this.#options.sourceVault.read()); return target; }
      catch (error: any) { if (error.code === 'ARTIFACT_NOT_FOUND') { await this.#owner(context, this.#options.sourceVault.read());
        return { status: 'unknown' as const, targetId: id, reasonCode: 'ACTIVATION_TARGET_RESERVATION_UNAVAILABLE' as const }; } throw error; }
    })));
  }
  async #authenticateMaterial(capture: WorkspaceBackupV2Capture, material: WorkspaceInterchangeCustodyRecord): Promise<WorkspaceBackupActivationMaterialRefs> {
    const id = material.pin.recordId, items = (['archive', 'pin', 'commit'] as const).map(part => {
      const item = capture.artifacts.find(value => value.ref.id === exportId(id, part) && value.ref.purpose === 'workspace-interchange');
      check(item, 'BACKUP_ACTIVATION_MATERIAL', 'The original capture must include all three exact independently issued semantic export envelopes.'); return item;
    });
    const [a, p, c] = await this.#options.sourceVault.authenticateArchivedArtifacts({ sourceVaultId: capture.source.vaultId, artifacts: items }, encryptedBudgets);
    const archive = a.value as any, pin = p.value as any, binding = c.value as any;
    check(archive.format === 'chausar.interchange-local-archive.v1' && pin.format === 'chausar.interchange-local-pin.v1' && binding.format === 'chausar.interchange-local-binding.v1'
      && archive.recordId === id && pin.recordId === id && binding.recordId === id && binding.state === 'committed' && binding.contextDigest === material.pin.contextDigest
      && same(binding.archive, ref(a)) && same(binding.pin, ref(p)) && archive.content === material.content && same(pin.pin, material.pin)
      && binding.contentDigest === interchangeDigest(material.content) && binding.pinDigest === interchangeDigest(material.pin),
    'BACKUP_ACTIVATION_MATERIAL', 'Archived semantic export values and exact committed ciphertext references differ.');
    return { archive: ref(a), pin: ref(p), binding: ref(c) };
  }
  async #readCandidateForInspection(context: Context, id: string) {
    const scope = this.#scope.getStore(), inspection = scope?.inspection;
    check(scope && inspection?.active && !inspection.used && inspection.candidateId === id
      && same(scope.context, context), 'ACTIVATION_ROOT_GUARD', 'Held candidate inspection requires its exact active current source context and identity.');
    // Consume before awaiting: overlapping or failed reads cannot reuse this capability.
    inspection.used = true;
    const selected = await this.#options.candidates().readCandidateHeld(structuredClone(context), id);
    check(this.#scope.getStore() === scope && scope.inspection === inspection && inspection.active
      && inspection.candidateId === id && same(scope.context, context), 'ACTIVATION_ROOT_GUARD',
    'Held candidate inspection cannot escape or change its current source scope.');
    return selected;
  }
  async #archivedCapture(expected: WorkspaceInventory, id: string) {
    const scope = this.#scope.getStore(); check(scope && idPattern.test(id), 'ACTIVATION_CANDIDATE_UNAVAILABLE', 'Archived admission requires the exact selected candidate under source custody.');
    const candidates = this.#options.candidates(); check(typeof candidates?.readCandidateHeld === 'function', 'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Install the exact committed candidate reader.');
    const selected = await candidates.readCandidateHeld(scope.context, id);
    check(same(selected.pin.inventory, expected), 'ACTIVATION_CANDIDATE_CHANGED', 'Archived inventory must equal the selected independently issued candidate pin.');
    const bridge = this.#options.bridge(); check(bridge instanceof WorkspaceBackupActivationHost, 'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Install the actual original-custody bridge.');
    check(!scope.inspection, 'ACTIVATION_ROOT_GUARD', 'Retain one current archived candidate inspection at a time.');
    const inspection: HeldInspection = { candidateId: id, active: true, used: false };
    scope.inspection = inspection;
    let inspected: Awaited<ReturnType<WorkspaceBackupActivationHost['inspectHeld']>>;
    try { inspected = await bridge.inspectHeld(scope.context, { candidateId: id }); }
    finally { inspection.active = false; if (scope.inspection === inspection) delete scope.inspection; }
    check(inspected.evidence.content === selected.content && same(inspected.evidence.pin, selected.pin), 'ACTIVATION_CANDIDATE_CHANGED', 'Current original custody must rebuild the selected candidate exactly.');
    const parsed = JSON.parse(selected.content), archive = validateWorkspaceInterchange(canonicalInterchangeJson(parsed.archive), expected);
    const entry = archive.artifacts.find(item => item.manifest.id === 'backup_activation_provenance_v1');
    check(entry, 'ACTIVATION_CANDIDATE_CHANGED', 'The complete candidate must retain its independently authenticated original provenance.');
    const provenance = JSON.parse(Buffer.from(retainedArtifactBytes(entry)).toString('utf8'));
    const encrypted = validateWorkspaceBackupV2(provenance.backup.content, provenance.backup.pin.sourcePin, this.#options.backupPolicy.backupBudgets);
    const capture = workspaceBackupV2Bytes(encrypted, this.#options.backupPolicy.backupBudgets), historical = await this.#options.sourceVault.authenticateEncryptedCustody(capture, encryptedBudgets);
    await this.#owner(scope.context, historical); await this.#authenticateMaterial(capture, provenance.material);
    const state = readHistoricalWorkspaceState(archive);
    check(same(state, historical), 'ACTIVATION_CANDIDATE_CHANGED', 'Archived semantic State must equal authenticated original encrypted authority.');
    const artifacts: ArtifactCapture = { complete: true, enumerationId: expected.enumerationId, generation: structuredClone(expected.generation), categories: workspaceStateProfile().artifactCategories,
      artifacts: archive.artifacts.map(item => ({ id: item.manifest.id, category: item.manifest.category, mediaType: item.manifest.mediaType, bytes: retainedArtifactBytes(item), generation: structuredClone(item.manifest.generation) })) };
    check(same(captureWorkspaceInterchange(state, artifacts).inventory, expected), 'ACTIVATION_CANDIDATE_CHANGED', 'Authenticated original archive must reproduce the issued inventory.');
    return { state, artifacts };
  }
  async #withSource<T>(context: Context, expected: WorkspaceInventory | null, work: (lease: WorkspaceInterchangeSourceLease) => Promise<T>, candidateId?: string): Promise<T> {
    const held = this.#scope.getStore();
    if (held) {
      check(same(held.context, context) && expected === null, 'ACTIVATION_ROOT_GUARD', 'Nested readers may reuse the current held source context, never reacquire archived admission.');
      await held.lease.assertCurrent(); const result = await work(held.lease); await held.lease.assertCurrent(); return result;
    }
    const o = this.#options;
    return o.backup.withHeldSource(context, () => o.nativeSource.withSource(async native => {
      const state = o.sourceVault.read(); await this.#owner(context, state);
      check(native.authority.vaultId === o.sourceVault.vaultId && native.authority.revision === state.revision, 'ACTIVATION_SOURCE_CHANGED', 'Hold the same installed native source authority as the Vault snapshot.');
      const captured = await o.sourceVault.captureEncryptedCustody(encryptedBudgets);
      const inventory = await o.backup.inspectHeldNamespaces(captured), files = sourceWitness(inventory), application = applicationWitness(inventory), containers = await this.#sourceContainers();
      check(captured.storageKind === 'postgres' && captured.authorityKind === 'adapter-issued-envelope' && same(captured.state, state)
        && native.authority.envelopeDigest === sha(captured.authority), 'ACTIVATION_SOURCE_CHANGED', 'Authenticated current adapter-issued envelope must match native leased authority.');
      const assertCurrent = async () => {
        await this.#owner(context, state); await native.assertCurrent();
        check(same(o.sourceVault.read(), state), 'ACTIVATION_SOURCE_CHANGED', 'Actual current source State changed during admission.');
        const current = await o.sourceVault.captureEncryptedCustody(encryptedBudgets), actual = await o.backup.inspectHeldNamespaces(current);
        check(same(encryptedFence(current), encryptedFence(captured)) && same(sourceWitness(actual), files) && same(await this.#sourceContainers(), containers),
          'ACTIVATION_SOURCE_CHANGED', 'Complete source ciphertext, physical files or native namespace identity changed.');
        check(same(applicationWitness(actual), application), 'ACTIVATION_APPLICATION_CHANGED', 'Completed application backup, export or update namespaces changed.');
        await this.#owner(context, state); await native.assertCurrent();
      };
      const generation = { workspaceId: state.workspace.id, revision: state.revision, captureId: `current_${sha(canonicalInterchangeJson(files))}` };
      const artifacts: ArtifactCapture = { complete: true, enumerationId: generation.captureId, generation, categories: workspaceStateProfile().artifactCategories,
        artifacts: captured.artifacts.map(item => ({ id: `encrypted_${sha(item.ref.purpose + ':' + item.ref.id)}`, category: 'other-retained', mediaType: 'application/octet-stream', bytes: item.bytes, generation })) };
      const lease: WorkspaceInterchangeSourceLease = { ready: true, state, artifacts, assertCurrent, assertCompleteOwner: (ctx, historical) => this.#owner(ctx, historical) };
      return this.#scope.run({ context: structuredClone(context), lease }, async () => {
        check(!expected || typeof candidateId === 'string' && idPattern.test(candidateId), 'ACTIVATION_CANDIDATE_UNAVAILABLE', 'Archived source admission requires the exact selected candidate identity.');
        if (expected) lease.authenticatedHistoricalCapture = await this.#archivedCapture(expected, candidateId!);
        await assertCurrent(); const result = await work(lease); await assertCurrent(); return result;
      });
    }));
  }
  #transaction<T>(context: Context, chosen: Parameters<WorkspacePostgresBackupActivationOriginals['withTransaction']>[1],
    work: Parameters<WorkspacePostgresBackupActivationOriginals['withTransaction']>[2]): Promise<T> {
    const run = () => this.#options.backup.withArchiveReader(context, chosen.backupId, readBackup =>
      this.#options.interchange.withRecordReader(context, chosen.materialId, readMaterial => this.#options.backup.withInertReader(context, chosen.inertTargetId, readInert =>
        this.#targetLock(chosen.targetId, () => this.#nativeTarget(chosen.targetId, async (custody, storage) => {
          const scope = this.#scope.getStore(); check(scope && same(scope.context, context), 'ACTIVATION_ROOT_GUARD', 'Original readers require current held source admission.');
          const target = await this.#target(context, chosen.targetId, custody, storage), backup = await readBackup(), material = await readMaterial(), inert = await readInert();
          const assertCurrent = async () => { await scope.lease.assertCurrent();
            check(same(await this.#target(context, chosen.targetId, custody, storage), target) && same(await readBackup(), backup)
              && same(await readMaterial(), material) && same(await readInert(), inert), 'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Independent original evidence or exact empty target changed.');
            await scope.lease.assertCurrent(); };
          const result = await work({ currentState: this.#options.sourceVault.read(), target, readBackup, readMaterial, readInert,
            authenticateArchive: async capture => { const historical = await this.#options.sourceVault.authenticateEncryptedCustody(capture, encryptedBudgets); await this.#owner(context, historical); return historical; },
            authenticateMaterial: (capture, retained) => this.#authenticateMaterial(capture, retained), assertCompleteOwner: (ctx, historical) => this.#owner(ctx, historical), assertCurrent });
          await assertCurrent(); return result as T;
        })))));
    return this.#scope.getStore() ? run() : this.#withSource(context, null, run);
  }
}
