import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rmdir, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { authorize, check, ChausarError, hash, type Context, type State } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { assertSourceAccess } from './trust.ts';
import { safeDirectory, Vault, type PrivateArtifactRef, type VaultEncryptedCustodyCapture } from './vault.ts';
import { interchangeDigest } from './workspace-interchange.ts';
import type { WorkspaceActivationCommit } from './workspace-activation.ts';
import type { WorkspaceInterchangeLocalControlCustody, WorkspaceInterchangeLocalControlInventory } from './workspace-interchange-local.ts';
import {
  captureWorkspaceBackupV2, encodeWorkspaceBackupV2, inspectWorkspaceBackupV2, validateWorkspaceBackupV2, validateWorkspaceBackupV2Capture, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Archive, type WorkspaceBackupV2Budgets, type WorkspaceBackupV2Capture,
  type WorkspaceBackupV2CustodyRecord, type WorkspaceBackupV2EmptyTarget, type WorkspaceBackupV2ExternalKeyRequirement,
  type WorkspaceBackupV2HostPorts, type WorkspaceBackupV2Measurement, type WorkspaceBackupV2Namespace,
  type WorkspaceBackupV2RestoreReceipt, type WorkspaceBackupV2Source, type WorkspaceBackupV2SourcePin,
} from './workspace-backup-v2.ts';

const CONTROL = '.workspace-backup-control';
const ACTIVATION_CONTROL = '.workspace-activation-control';
const ACTIVATION_BOOTSTRAP = 'activation-bootstrap.encrypted.json', ACTIVATION_EVIDENCE = 'activation-evidence.encrypted.json';
const LIVE_AUTHORITY = 'live/main/authority.encrypted.json';
const INERT = 'backup.inert.json';
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const slotPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const purposes = ['private-trial', 'workspace-interchange'] as const;
const widerWorkspace = ['reports', 'plugin-assets', 'research-evidence', 'conversation-files', 'sync-evidence'];
const widerApplication = ['backups', 'exports', 'updates', '.workspace-interchange-control', CONTROL];
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const identity = (ref: PrivateArtifactRef): PrivateArtifactRef => ({ id: ref.id, purpose: ref.purpose, valueDigest: ref.valueDigest, diskBytes: ref.diskBytes });
const controlId = (recordId: string, part: 'archive' | 'pin' | 'binding') => `wb2_${sha(recordId)}_${part}`;
const reservationId = (targetId: string) => `wbt2_${sha(targetId)}_reservation`;
type Physical = { dev: string; ino: string; birthtimeNs: string };
type Witness = Physical & { path: string; bytes: number; mtimeNs: string; ctimeNs: string; sha256: string };
type File = { bytes: Buffer; witness: Witness };
type Scope = { context: Context; locks: Map<string, Witness>; staging: Map<string, Witness>; targets: Set<string>; changes: Map<string, { ref: PrivateArtifactRef; sha256: string } | null> };
type Binding = {
  format: 'chausar.backup-local-binding.v2'; recordId: string; creationId: string; contextDigest: string;
  archiveDigest: string; pinDigest: string; state: 'preparing' | 'committed' | 'discarded';
  archive: PrivateArtifactRef | null; pin: PrivateArtifactRef | null;
};
type Reservation = {
  format: 'chausar.backup-local-target.v2'; targetId: string; locationId: string; generation: string;
  vaultId: string; workspaceId: string; contextDigest: string; physical: Physical;
  state: 'empty' | 'restored' | 'rolled-back'; creationId: string | null; archiveDigest: string | null; containerSha256: string | null;
};
type TargetScope = { context: Context; reservation: Reservation; ref: PrivateArtifactRef; target: WorkspaceBackupV2EmptyTarget };
type ControlTargetWitness = { targetId: string } & ({ absent: true } | { physical: Physical; empty: true } | { physical: Physical; file: Witness });
type Inventory = { physical: Physical; directories: { path: string; physical: Physical }[]; files: Witness[]; namespaces: WorkspaceBackupV2Namespace[] };
type Captured = { capture: WorkspaceBackupV2Capture; state: State; inventory: Inventory };
type InterchangeReservation = { format: 'chausar.interchange-target-reservation.v1'; sourceVaultId: string; sourceWorkspaceId: string;
  targetId: string; workspaceId: string; generation: string; contextDigest: string; physical: Physical };
type ActivationJournal = { format: 'chausar.activation-local-journal.v1'; phase: 'attempted' | 'prepared' | 'committed' | 'failed';
  sourceVaultId: string; sourceWorkspaceId: string; journalVaultId: string; reservation: InterchangeReservation; reservationRef: PrivateArtifactRef;
  record: { activationId: string; candidateId: string; candidateCreationId: string; pinDigest: string; targetId: string; workspaceId: string; [key: string]: unknown };
  claim: { format: 'chausar.activation-local-claim.v1'; sourceVaultId: string; activationId: string; candidateId: string; candidateCreationId: string; pinDigest: string };
  staging?: { name: string; physical: Physical }; bootstrap?: PrivateArtifactRef; evidence?: PrivateArtifactRef;
  files?: { path: string; witness: Physical & { bytes: number; sha256: string } }[]; directories?: string[];
  qualification?: 'test-fixture' | 'encrypted-local-host'; liveDirectory?: Physical };
type AuthenticatedActivationJournal = { journal: ActivationJournal; publication?: WorkspaceActivationCommit };

export type WorkspaceBackupV2FilesystemBudgets = { maxFiles: number; maxBytes: number; maxDepth: number };
export type WorkspaceBackupV2LocalOptions = {
  vault: Vault;
  /** Root capability: one canonical application directory, never an IPC path. */
  applicationDirectory: string;
  budgets: WorkspaceBackupV2Budgets;
  filesystemBudgets: WorkspaceBackupV2FilesystemBudgets;
  /** Explicit root-reviewed dependencies. Credential wrappers do not register an OS keychain. */
  externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
  /** Sibling application namespaces beyond this source; no other workspace bytes are read. */
  outsideApplicationNamespaces?: { name: string; requirement: string }[];
  /** Reviewed root-only activation custody. The journal is distinct, local and directly managed. */
  workspaceActivation?: { journalVault: Vault;
    /** Authenticate the actual sealed fresh live Vault before/after measuring its sole mutable authority file. */
    inspectCurrentLive?(input: { context: Context; targetId: string; publication: WorkspaceActivationCommit }): Promise<void> };
  /** CURRENT owner, source permissions, epoch admission and all managed consumer readiness. */
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  /** Held root owner/epoch/readiness admission through FS publication; no deferred approval. */
  withCompleteOwner<T>(context: Context, historicalState: State, work: (assertCurrent: () => void) => Promise<T>): Promise<T>;
};
export type WorkspaceBackupV2LocalDiagnostics = {
  qualification: 'encrypted-local-host'; fullWorkspacePortable: false; source: WorkspaceBackupV2Source;
  namespaces: WorkspaceBackupV2Namespace[]; externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
  physicalFiles: Witness[]; measuredCaptureMs: number;
};
export type WorkspaceBackupV2LocalMeasurement = {
  recordId: string; state: Binding['state']; archiveCiphertextBytes: number; pinCiphertextBytes: number;
  bindingCiphertextBytes: number; totalRetainedCiphertextBytes: number; removedCiphertextBytes: number; measuredMs: number;
};

function physical(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Physical {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function physicalValue(value: any): value is Physical {
  return value && Object.keys(value).sort().join(',') === 'birthtimeNs,dev,ino'
    && Object.values(value).every(item => typeof item === 'string' && /^\d{1,30}$/.test(item));
}
function encryptedActivationPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 500 && (value === ACTIVATION_BOOTSTRAP || value === ACTIVATION_EVIDENCE
    || value.startsWith('live/') && value.endsWith('.encrypted.json')
      && value.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(part) && !part.endsWith('.')));
}
async function directoryIfPresent(path: string): Promise<string | null> {
  try { return await safeDirectory(path); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
async function syncDirectory(path: string) {
  let file;
  try { file = await open(path, constants.O_RDONLY); await file.sync(); }
  catch (error: any) { if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error.code)) throw error; }
  finally { await file?.close(); }
}
async function readRegular(path: string, logical: string, maximum: number): Promise<File> {
  await safeDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'BACKUP_UNSAFE_FILE', 'Custody requires regular files without symbolic or hard links.');
  check(before.size <= BigInt(maximum), 'BACKUP_LIMIT', 'A physical file exceeds the explicit remaining filesystem budget.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await file.stat({ bigint: true });
    check(same(physical(opened), physical(before)) && opened.size === before.size, 'BACKUP_FILE_CHANGED', 'A physical file changed before capture.');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - size));
      const result = await file.read(chunk, 0, chunk.length, null);
      if (!result.bytesRead) break;
      size += result.bytesRead; check(size <= maximum, 'BACKUP_LIMIT', 'A physical file grew beyond its explicit byte budget.');
      chunks.push(chunk.subarray(0, result.bytesRead));
    }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    check(current.isFile() && !current.isSymbolicLink() && current.nlink === 1n && same(physical(current), physical(before))
      && same(physical(after), physical(before)) && after.size === before.size && current.size === before.size && size === Number(before.size)
      && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs && current.mtimeNs === before.mtimeNs && current.ctimeNs === before.ctimeNs,
    'BACKUP_FILE_CHANGED', 'A physical file changed during capture.');
    const bytes = Buffer.concat(chunks);
    return { bytes, witness: { ...physical(before), path: logical, bytes: size, sha256: sha(bytes), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs) } };
  } finally { await file.close(); }
}

/** Experimental local ciphertext custody. No historical authority is mounted or admitted. */
export class WorkspaceBackupV2LocalCustody implements WorkspaceInterchangeLocalControlCustody {
  readonly ports: WorkspaceBackupV2HostPorts;
  readonly #options: WorkspaceBackupV2LocalOptions;
  readonly #scope = new AsyncLocalStorage<Scope>();
  readonly #target = new AsyncLocalStorage<TargetScope>();
  #diagnostics: WorkspaceBackupV2LocalDiagnostics | null = null;
  #measurements = new Map<string, WorkspaceBackupV2LocalMeasurement>();

  constructor(options: WorkspaceBackupV2LocalOptions) {
    check(options?.vault instanceof Vault && options.vault.storageKind === 'experimental-file'
      && typeof options.assertCompleteOwner === 'function' && typeof options.withCompleteOwner === 'function'
      && typeof options.applicationDirectory === 'string' && isAbsolute(options.applicationDirectory),
    'BACKUP_LOCAL_REQUIRED', 'Local custody requires an experimental-file Vault, canonical root application directory and held complete-owner admission.');
    const applicationDirectory = resolve(options.applicationDirectory), child = relative(applicationDirectory, options.vault.directory);
    check(child && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`) && !child.includes(sep),
      'BACKUP_SOURCE_SCOPE', 'Use one direct managed source workspace below the application directory.');
    if (options.workspaceActivation !== undefined) {
      const activation = options.workspaceActivation, journal = activation?.journalVault;
      check(activation && ['journalVault', 'inspectCurrentLive,journalVault'].includes(Object.keys(activation).sort().join(','))
        && (activation.inspectCurrentLive === undefined || typeof activation.inspectCurrentLive === 'function') && journal instanceof Vault
        && journal !== options.vault && journal.storageKind === 'experimental-file',
      'BACKUP_ACTIVATION_SCOPE', 'Reviewed activation requires a separate actual experimental-file journal Vault.');
      const name = relative(applicationDirectory, journal.directory);
      check(name && !isAbsolute(name) && !name.includes(sep) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name)
        && name.toLowerCase() !== child.toLowerCase() && ![...widerApplication, ...widerWorkspace, ACTIVATION_CONTROL, 'private-artifacts'].includes(name),
      'BACKUP_ACTIVATION_SCOPE', 'The reviewed journal must be one distinct direct managed application child.');
    }
    const budget = options.filesystemBudgets;
    check(budget && Object.keys(budget).sort().join(',') === 'maxBytes,maxDepth,maxFiles'
      && Object.values(budget).every(item => Number.isSafeInteger(item) && item > 0) && budget.maxDepth <= 64 && budget.maxFiles <= 8192
      && Array.isArray(options.externalKeyRequirements), 'BACKUP_BUDGET_REQUIRED', 'Supply explicit filesystem file, byte and depth budgets and external key requirements.');
    // Validate the public codec's explicit operation budgets without generating an archive.
    check(options.budgets && Object.keys(options.budgets).sort().join(',') === 'maxArchiveUtf8Bytes,maxEntries,maxEntryBytes,maxJsonDepth,maxJsonNodes,maxTotalEntryBytes'
      && Object.values(options.budgets).every(item => Number.isSafeInteger(item) && item > 0)
      && options.budgets.maxEntryBytes <= options.budgets.maxTotalEntryBytes && options.budgets.maxJsonDepth <= 256 && options.budgets.maxEntries > 1,
    'BACKUP_BUDGET_REQUIRED', 'Supply all six explicit archive budgets.');
    this.#options = { ...options, applicationDirectory, budgets: structuredClone(options.budgets), filesystemBudgets: structuredClone(budget),
      externalKeyRequirements: structuredClone(options.externalKeyRequirements), outsideApplicationNamespaces: structuredClone(options.outsideApplicationNamespaces ?? []),
      ...(options.workspaceActivation ? { workspaceActivation: { journalVault: options.workspaceActivation.journalVault,
        ...(options.workspaceActivation.inspectCurrentLive ? { inspectCurrentLive: options.workspaceActivation.inspectCurrentLive } : {}) } } : {}) };
    const outside = this.#options.outsideApplicationNamespaces!;
    check(outside.every(item => item && Object.keys(item).sort().join(',') === 'name,requirement' && /^[A-Za-z0-9_.-]+$/.test(item.name)
      && ![...widerApplication, ACTIVATION_CONTROL, '.', '..', child,
        ...(this.#options.workspaceActivation ? [relative(applicationDirectory, this.#options.workspaceActivation.journalVault.directory)] : [])].includes(item.name)
      && typeof item.requirement === 'string' && item.requirement.trim().length > 0)
      && new Set(outside.map(item => item.name.toLowerCase())).size === outside.length,
    'BACKUP_SOURCE_SCOPE', 'Explicitly classify every unrelated application sibling before excluding its custody.');
    this.ports = {
      withSource: (context, expected, work) => this.#withSource(context, expected, work),
      withTarget: (context, input, work) => this.#withTarget(context, input.targetId, work),
      authenticateArchive: (context, archive) => this.#authenticateArchive(context, archive),
      assertRestoreOwner: (context, source) => this.#assertRestoreOwner(context, source),
      custody: { create: (context, record, guard) => this.#create(context, record, guard), read: (context, recordId) => this.#read(context, recordId),
        remove: (context, input) => this.#remove(context, input) },
      restore: { restoreAtomic: (context, input, guard) => this.#restoreAtomic(context, input, guard),
        readRestored: (context, input) => this.#readRestored(context, input), rollback: (context, input) => this.#rollback(context, input) },
    };
  }

  /** Constructor-only composition: acquire the real source snapshot before any
   * archive/target lock. Readers supplied below stay under that same exclusion. */
  withHeldSource<T>(context: Context, work: () => Promise<T>): Promise<T> {
    return this.#snapshot(context, async () => { await this.#guard(context, this.#options.vault.read()); return work(); });
  }
  /** Root-only cross-module join. The caller already holds this exact Vault's
   * source snapshot. No nested snapshot, publication, adoption or cleanup occurs. */
  async inspectInterchangeControls(context: Context, source: { vault: Vault; applicationDirectory: string },
    inventory: readonly PrivateArtifactRef[]): Promise<WorkspaceInterchangeLocalControlInventory> {
    const vault = this.#options.vault;
    check(source.vault === vault && source.applicationDirectory === this.#options.applicationDirectory,
      'BACKUP_SOURCE_SCOPE', 'Control accounting must use the same open source Vault and canonical application root.');
    await this.#guard(context, vault.read());
    const refs = inventory.filter(ref => /^wb2_[a-f0-9]{64}_(?:archive|pin|binding)$/.test(ref.id)
      || /^wbt2_[a-f0-9]{64}_reservation$/.test(ref.id));
    const entries = new Map(refs.map(ref => [ref.id, ref])), claimed = new Set<string>();
    const artifacts: WorkspaceInterchangeLocalControlInventory['artifacts'] = [], targets: ControlTargetWitness[] = [];
    let measuredBytes = 0, measuredFiles = 0;
    const measure = async (path: string, logical: string) => {
      check(++measuredFiles <= this.#options.filesystemBudgets.maxFiles, 'BACKUP_LIMIT', 'Control accounting exceeds its existing file budget.');
      const file = await readRegular(path, logical, this.#options.filesystemBudgets.maxBytes - measuredBytes);
      measuredBytes += file.bytes.length; return file;
    };
    const claim = async (ref: PrivateArtifactRef) => {
      check(ref.purpose === 'workspace-interchange' && !claimed.has(ref.id)
        && same(entries.get(ref.id), ref), 'BACKUP_CUSTODY_CHANGED', 'Every claimed control must equal its exact enumerated reference.');
      const file = await measure(join(vault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`), ref.id);
      const read = await vault.readArtifact(ref);
      check(file.bytes.length === ref.diskBytes && same(identity(read), ref),
        'BACKUP_CUSTODY_CHANGED', 'Control ciphertext bytes and authenticated ownership changed during accounting.');
      artifacts.push({ ref: identity(ref), sha256: file.witness.sha256 }); claimed.add(ref.id);
    };
    for (const ref of refs.filter(item => item.id.endsWith('_binding'))) {
      const read = await vault.readArtifact(ref), binding = read.value as Binding;
      check(same(identity(read), ref) && binding?.format === 'chausar.backup-local-binding.v2'
        && Object.keys(binding).sort().join(',') === 'archive,archiveDigest,contextDigest,creationId,format,pin,pinDigest,recordId,state'
        && typeof binding.recordId === 'string' && idPattern.test(binding.recordId) && ref.id === controlId(binding.recordId, 'binding')
        && typeof binding.creationId === 'string' && idPattern.test(binding.creationId)
        && typeof binding.archiveDigest === 'string' && digestPattern.test(binding.archiveDigest)
        && typeof binding.pinDigest === 'string' && digestPattern.test(binding.pinDigest)
        && binding.contextDigest === sha(canonical(context)) && ['preparing', 'committed', 'discarded'].includes(binding.state),
      'BACKUP_CUSTODY_CHANGED', 'Backup control accounting requires its exact issued record, creation, owner and digest binding.');
      for (const [part, issued] of [['archive', binding.archive], ['pin', binding.pin]] as const) {
        check(issued === null || issued && Object.keys(issued).sort().join(',') === 'diskBytes,id,purpose,valueDigest'
          && issued.id === controlId(binding.recordId, part) && issued.purpose === 'workspace-interchange'
          && typeof issued.valueDigest === 'string' && digestPattern.test(issued.valueDigest)
          && Number.isSafeInteger(issued.diskBytes) && issued.diskBytes > 0,
        'BACKUP_CUSTODY_CHANGED', 'Backup issuance references must retain their exact typed payload identities.');
      }
      check(binding.state !== 'preparing', 'BACKUP_CLEANUP_REQUIRED', 'Unresolved preparing backup custody requires exact owner cleanup.');
      const archive = entries.get(controlId(binding.recordId, 'archive')), pin = entries.get(controlId(binding.recordId, 'pin'));
      if (binding.state === 'discarded') {
        check(!archive && !pin, 'BACKUP_CLEANUP_REQUIRED', 'Discarded backup payloads must be fully removed before control exclusion.');
      } else {
        const retained = await this.#readUnlocked(context, binding.recordId), custodyPin = retained.record.pin;
        check(same(retained.ref, ref) && same(retained.binding, binding) && archive && pin
          && Object.keys(custodyPin).sort().join(',') === 'archiveDigest,contextDigest,creationId,format,recordId,sourcePin'
          && custodyPin.format === 'chausar.backup-custody-pin.v2' && custodyPin.recordId === binding.recordId
          && custodyPin.creationId === binding.creationId && custodyPin.contextDigest === binding.contextDigest,
        'BACKUP_CUSTODY_CHANGED', 'Independent backup custody pin must retain the exact issued provenance.');
        // This private reader freshly validates the independently pinned wire and
        // reconstructs its bytes together; retain every current custody reread.
        const historical = await vault.authenticateEncryptedCustody(retained.capture, this.#vaultBudget());
        await this.#guard(context, historical);
        await claim(archive); await claim(pin);
      }
      await claim(ref);
    }
    for (const ref of refs.filter(item => item.id.endsWith('_reservation'))) {
      const read = await vault.readArtifact(ref), reservation = read.value as Reservation;
      const hasPublication = reservation?.creationId !== null;
      check(same(identity(read), ref) && reservation?.format === 'chausar.backup-local-target.v2'
        && Object.keys(reservation).sort().join(',') === 'archiveDigest,containerSha256,contextDigest,creationId,format,generation,locationId,physical,state,targetId,vaultId,workspaceId'
        && typeof reservation.targetId === 'string' && slotPattern.test(reservation.targetId) && ref.id === reservationId(reservation.targetId)
        && reservation.vaultId === vault.vaultId && reservation.workspaceId === vault.read().workspace.id
        && reservation.contextDigest === sha(canonical(context)) && typeof reservation.locationId === 'string' && idPattern.test(reservation.locationId)
        && typeof reservation.generation === 'string' && idPattern.test(reservation.generation) && physicalValue(reservation.physical)
        && ['empty', 'restored', 'rolled-back'].includes(reservation.state)
        && (hasPublication ? typeof reservation.creationId === 'string' && idPattern.test(reservation.creationId)
          && typeof reservation.archiveDigest === 'string' && digestPattern.test(reservation.archiveDigest)
          && typeof reservation.containerSha256 === 'string' && digestPattern.test(reservation.containerSha256)
          : reservation.archiveDigest === null && reservation.containerSha256 === null)
        && (reservation.state === 'restored' ? hasPublication : reservation.state !== 'empty' || !hasPublication),
      'BACKUP_TARGET_CHANGED', 'Backup reservation exclusion requires its exact typed source, owner, physical identity and publication state.');
      const path = this.targetPath(reservation.targetId), directory = await directoryIfPresent(path);
      if (!directory) {
        check(reservation.state === 'rolled-back' && !hasPublication,
          'BACKUP_TARGET_CLEANUP_REQUIRED', 'Only failed empty allocation cleanup may leave an absent reserved target.');
        targets.push({ targetId: reservation.targetId, absent: true });
      } else {
        const actual = await this.#reservation(context, reservation.targetId);
        check(same(actual.ref, ref) && same(actual.reservation, reservation), 'BACKUP_TARGET_CHANGED', 'Reserved inert target changed during accounting.');
        const names = (await readdir(directory)).sort();
        if (reservation.state === 'restored') {
          await this.#readRestoredUnlocked(context, { targetId: reservation.targetId, creationId: reservation.creationId! });
          const file = await measure(join(directory, INERT), `target/${reservation.targetId}/${INERT}`);
          check(file.witness.sha256 === reservation.containerSha256, 'BACKUP_TARGET_CHANGED', 'Owned inert container changed during accounting.');
          targets.push({ targetId: reservation.targetId, physical: reservation.physical, file: file.witness });
        } else {
          check(names.length === 0, 'BACKUP_TARGET_CLEANUP_REQUIRED', 'Empty or rolled-back targets must have no unresolved payloads or unknown entries.');
          targets.push({ targetId: reservation.targetId, physical: reservation.physical, empty: true });
        }
      }
      await claim(ref);
    }
    check(refs.every(ref => claimed.has(ref.id)), 'BACKUP_CUSTODY_CHANGED', 'Orphan backup archive or pin controls cannot be adopted.');
    // Only the existing reviewed process-lock sections are owned. A stale staging
    // file has no durable manifest and must continue to require root inspection.
    const control = await directoryIfPresent(join(this.#options.applicationDirectory, CONTROL));
    if (control) for (const section of await readdir(control)) {
      check(['records', 'targets'].includes(section), 'BACKUP_INVENTORY_INCOMPLETE', 'Unknown backup process control sections require root inspection.');
      const directory = await safeDirectory(join(control, section));
      for (const name of await readdir(directory)) {
        check(/^[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)?$/.test(name),
          'BACKUP_INVENTORY_INCOMPLETE', 'Unowned backup staging or process entries cannot be excluded.');
        await measure(join(directory, name), `control/${section}/${name}`);
      }
    }
    await this.#guard(context, vault.read());
    return { artifacts: artifacts.sort((a, b) => a.ref.id.localeCompare(b.ref.id)), namespaceDigest: sha(canonical(targets)) };
  }
  /** Trusted composition only: measure the complete current profile under source→journal exclusion. */
  async inspectHeldNamespaces(): Promise<Inventory> {
    const scope = this.#scope.getStore(); check(scope, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Hold actual source custody before complete namespace inspection.');
    await this.#guard(scope.context, this.#options.vault.read()); const inventory = await this.#inventory();
    await this.#guard(scope.context, this.#options.vault.read()); return structuredClone(inventory);
  }
  withArchiveReader<T>(context: Context, recordId: string,
    work: (read: () => Promise<WorkspaceBackupV2CustodyRecord & {measurement: WorkspaceBackupV2Measurement}>) => Promise<T>): Promise<T> {
    check(this.#scope.getStore() && idPattern.test(recordId), 'BACKUP_SOURCE_LEASE_REQUIRED', 'Hold actual source custody before archive exclusion.');
    return this.#locked('records', `${this.#options.vault.vaultId}:${recordId}`, () => work(async () => {
      await this.#guard(context, this.#options.vault.read()); const read = await this.#readUnlocked(context, recordId);
      return {...read.record, measurement: this.#measure(read.binding.archive!, read.binding.pin!)};
    }));
  }
  withInertReader<T>(context: Context, targetId: string, work: (read: () => Promise<{
    content: string; receipt: WorkspaceBackupV2RestoreReceipt;
    inspection: {targetId: string; locationId: string; generation: string; contextDigest: string; containerDigest: string; containerBytes: number};
  }>) => Promise<T>): Promise<T> {
    check(this.#scope.getStore(), 'BACKUP_SOURCE_LEASE_REQUIRED', 'Hold actual source custody before inert-target exclusion.');
    return this.#locked('targets', this.targetPath(targetId), () => work(async () => {
      const retained = await this.#find(reservationId(targetId)), reservation = retained?.value as Reservation;
      check(reservation?.state === 'restored' && reservation.creationId && reservation.archiveDigest,
        'BACKUP_TARGET_CHANGED', 'Resolve an exactly committed restored reservation.');
      const record = await this.#readRestoredUnlocked(context, {targetId, creationId: reservation.creationId});
      const measured = await readRegular(join(this.targetPath(targetId), INERT), 'inert-container', this.#options.filesystemBudgets.maxBytes);
      check(measured.witness.sha256 === reservation.containerSha256, 'BACKUP_TARGET_CHANGED', 'Restored physical container differs from its independent reservation.');
      return {content: record.content, receipt: record.receipt, inspection: {targetId, locationId: reservation.locationId,
        generation: reservation.generation, contextDigest: reservation.contextDigest, containerDigest: measured.witness.sha256, containerBytes: measured.bytes.length}};
    }));
  }
  diagnostics() { return structuredClone(this.#diagnostics); }
  custodyMeasurement(recordId: string) { return structuredClone(this.#measurements.get(recordId) ?? null); }
  targetPath(targetId: string) {
    check(typeof targetId === 'string' && slotPattern.test(targetId) && ![...widerWorkspace, ...widerApplication, ACTIVATION_CONTROL, 'private-artifacts'].includes(targetId),
      'BACKUP_TARGET_IDENTITY', 'Use one distinct short root-managed target slot.');
    const path = join(this.#options.applicationDirectory, targetId);
    check(resolve(path) !== resolve(this.#options.vault.directory)
      && resolve(path) !== resolve(this.#options.workspaceActivation?.journalVault.directory ?? this.#options.vault.directory),
    'BACKUP_TARGET_IDENTITY', 'Source, reviewed journal and target physical locations must be distinct.'); return path;
  }
  /** Explicit read-only discovery after a whole RPC acknowledgement was lost. */
  async restoredIdentity(context: Context, targetId: string) {
    return this.#snapshot(context, () => this.#locked('targets', this.targetPath(targetId), async () => {
      await this.#guard(context, this.#options.vault.read());
      const { reservation } = await this.#reservation(context, targetId);
      check(reservation.state === 'restored' && typeof reservation.creationId === 'string'
        && idPattern.test(reservation.creationId) && typeof reservation.archiveDigest === 'string',
        'BACKUP_TARGET_NOT_COMMITTED', 'This exact reserved target has no committed inert restore to inspect.');
      const value = await this.#readRestoredUnlocked(context, { targetId, creationId: reservation.creationId });
      await this.#guard(context, this.#options.vault.read());
      return { targetId, creationId: value.receipt.creationId, archiveDigest: value.receipt.archiveDigest };
    }));
  }
  #vaultBudget(includeOwnPublications = false) {
    const b = this.#options.budgets, fs = this.#options.filesystemBudgets;
    return includeOwnPublications ? { maxEntryBytes: Math.min(fs.maxBytes, 64 * 1024 * 1024), maxTotalEntryBytes: fs.maxBytes, maxArtifacts: fs.maxFiles }
      : { maxEntryBytes: b.maxEntryBytes, maxTotalEntryBytes: b.maxTotalEntryBytes, maxArtifacts: b.maxEntries - 1 };
  }
  async #guard(context: Context, historical: State) {
    const current = this.#options.vault.read();
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete encrypted custody requires the untainted desktop owner.');
    const member = authorize({ read: () => current, update: async () => { throw new Error('Read-only custody guard.'); } }, context, 'admin');
    check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Complete encrypted custody requires the current unrestricted owner.');
    assertSourceAccess(current, context, [...new Set([...historical.facts.map(item => item.sourceId),
      ...historical.imports.map(item => item.sourceId).filter((item): item is string => typeof item === 'string')])]);
    const result: unknown = await this.#options.assertCompleteOwner(structuredClone(context), structuredClone(historical));
    check(result === undefined, 'BACKUP_HOST_GUARD', 'Complete-owner readiness admission must complete without a deferred value.');
    for (const [path, witness] of this.#scope.getStore()?.locks ?? []) {
      check(same((await readRegular(path, witness.path, this.#options.filesystemBudgets.maxBytes)).witness, witness), 'BACKUP_LOCK_CHANGED', 'Exclusive process custody changed.');
    }
    for (const [path, witness] of this.#scope.getStore()?.staging ?? []) {
      check(same((await readRegular(path, witness.path, this.#options.filesystemBudgets.maxBytes)).witness, witness), 'BACKUP_FILE_CHANGED', 'Exact owned inert staging custody changed.');
    }
  }
  async #prepareControls() {
    const root = await safeDirectory(this.#options.applicationDirectory);
    check(root === this.#options.applicationDirectory, 'BACKUP_SOURCE_SCOPE', 'Use the canonical root application path.');
    await safeDirectory(join(root, CONTROL, 'records'), true); await safeDirectory(join(root, CONTROL, 'targets'), true);
  }
  async #snapshot<T>(context: Context, work: () => Promise<T>): Promise<T> {
    const scope = this.#scope.getStore();
    if (scope) { check(same(scope.context, context), 'BACKUP_SOURCE_SCOPE', 'Nested custody must retain the preparing owner context.'); return work(); }
    return this.#options.vault.snapshot(async () => {
      await this.#prepareControls();
      const run = () => this.#scope.run({ context: structuredClone(context), locks: new Map(), staging: new Map(), targets: new Set(), changes: new Map() }, work);
      const journal = this.#options.workspaceActivation?.journalVault;
      return journal ? journal.snapshot(run) : run();
    });
  }
  async #locked<T>(section: 'records' | 'targets', key: string, work: () => Promise<T>) {
    const scope = this.#scope.getStore(); check(scope, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Acquire the Vault authority queue before record or target exclusion.');
    const path = join(this.#options.applicationDirectory, CONTROL, section, `${sha(key)}.lock`);
    const lock = await acquireProcessLock(path, { busyCode: 'BACKUP_BUSY', changedCode: 'BACKUP_LOCK_CHANGED' });
    const witness = (await readRegular(path, `application/workspace-backup-control/${section}/${sha(key)}.lock`, this.#options.filesystemBudgets.maxBytes)).witness;
    scope.locks.set(path, witness);
    try { return await work(); } finally { scope.locks.delete(path); await lock.release(); }
  }
  async #activationJournals(raw: VaultEncryptedCustodyCapture,
    reservations: Map<string, { reservation: InterchangeReservation; ref: PrivateArtifactRef }>): Promise<AuthenticatedActivationJournal[]> {
    const journal = this.#options.workspaceActivation!.journalVault, source = this.#options.vault;
    const values = new Map<string, { ref: PrivateArtifactRef; value: any }>();
    for (const item of raw.artifacts) {
      const authenticated = await journal.readArtifact(item.ref);
      check(same(identity(authenticated), item.ref), 'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Actual journal refs must equal independently authenticated custody.');
      values.set(`${item.ref.purpose}/${item.ref.id}`, { ref: item.ref, value: authenticated.value });
    }
    const ledger = values.get('workspace-interchange/wal_ledger_v1')?.value;
    if (ledger !== undefined) check(ledger?.format === 'chausar.activation-local-ledger.v1'
      && Object.keys(ledger).sort().join(',') === 'claims,format' && Array.isArray(ledger.claims) && ledger.claims.length <= 4096
      && ledger.claims.every((claim: any) => claim?.format === 'chausar.activation-local-claim.v1'
        && Object.keys(claim).sort().join(',') === 'activationId,candidateCreationId,candidateId,format,pinDigest,sourceVaultId'
        && claim.sourceVaultId === source.vaultId && idPattern.test(claim.activationId) && idPattern.test(claim.candidateId)
        && idPattern.test(claim.candidateCreationId) && digestPattern.test(claim.pinDigest))
      && new Set(ledger.claims.map((claim: any) => claim.activationId)).size === ledger.claims.length
      && new Set(ledger.claims.map((claim: any) => claim.candidateCreationId)).size === ledger.claims.length,
    'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Activation attempts require the actual durable identity ledger.');
    const result: AuthenticatedActivationJournal[] = [];
    for (const [key, retained] of values) {
      if (!/^workspace-interchange\/wal_[a-f0-9]{64}_attempt$/.test(key)) continue;
      const value = retained.value as ActivationJournal, record = value?.record, claim = value?.claim;
      const target = reservations.get(value?.reservation?.targetId);
      check(value?.format === 'chausar.activation-local-journal.v1' && ['attempted', 'prepared', 'committed', 'failed'].includes(value.phase)
        && value.sourceVaultId === source.vaultId && value.sourceWorkspaceId === source.read().workspace.id && value.journalVaultId === journal.vaultId
        && record?.format === 'chausar.workspace-activation.v1' && record.status === 'committed'
        && idPattern.test(record.activationId) && retained.ref.id === `wal_${sha(record.activationId)}_attempt`
        && claim?.format === 'chausar.activation-local-claim.v1'
        && Object.keys(claim).sort().join(',') === 'activationId,candidateCreationId,candidateId,format,pinDigest,sourceVaultId'
        && claim.sourceVaultId === source.vaultId && claim.activationId === record.activationId
        && idPattern.test(claim.candidateId) && claim.candidateId === record.candidateId
        && idPattern.test(claim.candidateCreationId) && claim.candidateCreationId === record.candidateCreationId
        && digestPattern.test(claim.pinDigest) && claim.pinDigest === record.pinDigest
        && target && same(value.reservation, target.reservation) && same(value.reservationRef, target.ref)
        && record.targetId === target.reservation.targetId && record.workspaceId === target.reservation.workspaceId
        && ledger?.claims.some((item: unknown) => same(item, claim))
        && same(values.get(`workspace-interchange/wal_${sha(`${source.vaultId}:${claim.candidateCreationId}`)}_candidate`)?.value, claim),
      'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Attempt, paired identity claim, ledger and source-owned reservation must match exactly.');
      if (value.staging !== undefined) check(Object.keys(value.staging).sort().join(',') === 'name,physical'
        && /^attempt_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.staging.name)
        && physicalValue(value.staging.physical), 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Staging must have an exact durable attempt name and physical identity.');
      if (['prepared', 'committed'].includes(value.phase)) {
        check(value.staging && Array.isArray(value.files) && value.files.length > 0 && Array.isArray(value.directories)
          && value.directories.includes('live') && value.files.length + value.directories.length <= this.#options.filesystemBudgets.maxFiles
          && value.files.every(item => item && Object.keys(item).sort().join(',') === 'path,witness' && encryptedActivationPath(item.path)
            && item.witness && Object.keys(item.witness).sort().join(',') === 'birthtimeNs,bytes,dev,ino,sha256'
            && physicalValue({ dev: item.witness.dev, ino: item.witness.ino, birthtimeNs: item.witness.birthtimeNs })
            && Number.isSafeInteger(item.witness.bytes) && item.witness.bytes > 0 && digestPattern.test(item.witness.sha256))
          && value.directories.every(name => typeof name === 'string' && name.length <= 500 && (name === 'live' || name.startsWith('live/'))
            && name.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(part) && !part.endsWith('.')))
          && new Set(value.files.map(item => item.path.toLowerCase())).size === value.files.length
          && new Set(value.directories.map(name => name.toLowerCase())).size === value.directories.length,
        'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Prepared ownership requires one complete bounded encrypted file and directory manifest.');
        for (const [name, ref, part] of [[ACTIVATION_BOOTSTRAP, value.bootstrap, 'bootstrap'], [ACTIVATION_EVIDENCE, value.evidence, 'evidence']] as const) {
          const encrypted = ref && raw.artifacts.find(item => same(item.ref, ref));
          const file = value.files!.find(item => item.path === name);
          check(ref?.purpose === 'workspace-interchange' && ref.id === `wal_${sha(record.activationId)}_${part}`
            && encrypted && file && file.witness.bytes === encrypted.bytes.length && file.witness.sha256 === sha(encrypted.bytes),
          'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Immutable staged payloads require exact journal-issued encrypted refs and byte hashes.');
        }
      }
      let publication: WorkspaceActivationCommit | undefined;
      if (this.#options.workspaceActivation!.inspectCurrentLive && value.phase === 'committed'
        && value.qualification === 'encrypted-local-host' && value.files?.some(item => item.path === LIVE_AUTHORITY)) {
        const bootstrap = values.get(`workspace-interchange/${value.bootstrap!.id}`)?.value;
        const evidence = values.get(`workspace-interchange/${value.evidence!.id}`)?.value;
        check(bootstrap && Object.keys(bootstrap).sort().join(',') === 'authority,record,state'
          && same(bootstrap.record, value.record) && bootstrap.state?.workspace?.id === value.reservation.workspaceId
          && bootstrap.state.revision === 0 && hash(bootstrap.state) === value.record.stateDigest
          && interchangeDigest(bootstrap.authority) === value.record.authorityDigest
          && evidence?.format === 'chausar.workspace-activation-evidence.v1' && evidence.inert === true
          && interchangeDigest(evidence) === value.record.evidenceDigest
          && physicalValue(value.liveDirectory),
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Mutable current-live custody requires the complete authenticated original bootstrap, evidence, authority and committed live directory binding.');
        publication = { record: structuredClone(bootstrap.record), state: structuredClone(bootstrap.state),
          authority: structuredClone(bootstrap.authority), evidence: structuredClone(evidence) };
      }
      result.push({ journal: value, ...(publication ? { publication } : {}) });
    }
    check(new Set(result.flatMap(({ journal }) => journal.staging ? [journal.staging.name.toLowerCase()] : [])).size === result.filter(({ journal }) => journal.staging).length,
      'BACKUP_ACTIVATION_STAGING_UNBOUND', 'A physical staging attempt cannot belong to two durable journal records.');
    return result;
  }
  async #inventory(): Promise<Inventory> {
    const b = this.#options.filesystemBudgets, vault = this.#options.vault;
    const source = await safeDirectory(vault.directory), rootStat = await lstat(source, { bigint: true });
    const files: Witness[] = [], directories: Inventory['directories'] = [], namespaces: WorkspaceBackupV2Namespace[] = [];
    let totalBytes = 0, entries = 0;
    await safeDirectory(this.#options.applicationDirectory);
    check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Application directory identity exceeds the explicit entry budget.');
    directories.push({ path: 'application', physical: physical(await lstat(this.#options.applicationDirectory, { bigint: true })) });
    const retain = async (path: string, logical: string) => {
      check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Physical enumeration exceeds its explicit entry count budget.');
      const item = await readRegular(path, logical, b.maxBytes - totalBytes); totalBytes += item.bytes.length;
      if (!this.#scope.getStore()?.locks.has(path) && !this.#scope.getStore()?.staging.has(path)) files.push(item.witness);
      return item.witness;
    };
    const walk = async (path: string, logical: string, depth: number,
      permit?: { prefix: string; files: Map<string, Physical & { bytes: number; sha256: string }>; directories: Set<string>; mutableAuthority?: string }): Promise<{ entries: number; bytes: number }> => {
      check(depth <= b.maxDepth && ++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Physical directory enumeration exceeds its explicit depth/count budget.');
      await safeDirectory(path); const stat = await lstat(path, { bigint: true }); directories.push({ path: logical, physical: physical(stat) });
      let count = 0, bytes = 0;
      for (const name of (await readdir(path)).sort()) {
        check(/^[A-Za-z0-9_.-]+$/.test(name) && name !== '.' && name !== '..', 'BACKUP_INVENTORY_INCOMPLETE', 'A filesystem entry has no reviewed portable namespace identity.');
        const child = join(path, name), info = await lstat(child, { bigint: true });
        check(!info.isSymbolicLink(), 'BACKUP_UNSAFE_FILE', 'Physical inventory cannot traverse symbolic links.');
        if (permit) {
          const relativePath = `${logical}/${name}`.slice(permit.prefix.length + 1), issued = permit.files.get(relativePath);
          check(info.isDirectory() ? permit.directories.has(relativePath) : info.isFile() && issued
            && (relativePath === permit.mutableAuthority || same(physical(info), { dev: issued.dev, ino: issued.ino, birthtimeNs: issued.birthtimeNs }) && info.size === BigInt(issued.bytes)),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Every opened activation file must retain its exact issued name, physical generation and measured size.');
        }
        if (info.isDirectory()) { const found = await walk(child, `${logical}/${name}`, depth + 1, permit); count += found.entries; bytes += found.bytes; }
        else { check(info.isFile(), 'BACKUP_UNSAFE_FILE', 'Every enumerated wider entry must be a regular file or directory.'); const found = await retain(child, `${logical}/${name}`); count++; bytes += found.bytes; }
      }
      return { entries: count, bytes };
    };
    for (const name of (await readdir(source)).sort()) {
      if (['authority.encrypted.json', 'writer.lock', 'private-artifacts', ...widerWorkspace].includes(name)) continue;
      throw new ChausarError('BACKUP_INVENTORY_INCOMPLETE', 'An unclassified source workspace namespace prevents complete ciphertext custody.');
    }
    await retain(join(source, 'authority.encrypted.json'), 'authority');
    const writer = await retain(join(source, 'writer.lock'), 'workspace/writer.lock');
    namespaces.push({ namespace: 'workspace/writer.lock', disposition: 'transient', entries: 1, bytes: writer.bytes,
      requirement: 'Reacquire current process and epoch ownership; historical writer locks are never restored.' });
    const privateRoot = await directoryIfPresent(join(source, 'private-artifacts'));
    if (privateRoot) for (const purpose of await readdir(privateRoot)) {
      check(purposes.includes(purpose as typeof purposes[number]), 'BACKUP_INVENTORY_INCOMPLETE', 'Every actual private-artifact purpose must be typed and authenticated.');
    }
    for (const purpose of purposes) {
      const directory = await directoryIfPresent(join(source, 'private-artifacts', purpose)); if (!directory) continue;
      for (const name of (await readdir(directory)).sort()) {
        check(/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name), 'BACKUP_INVENTORY_INCOMPLETE', 'An unclassified private entry prevents complete encrypted custody.');
        await retain(join(directory, name), `private-artifacts/${purpose}/${name}`);
      }
    }
    for (const name of widerWorkspace) {
      const path = await directoryIfPresent(join(source, name)), found = path ? await walk(path, `workspace/${name}`, 0) : { entries: 0, bytes: 0 };
      namespaces.push({ namespace: `workspace/${name}`, disposition: found.entries ? 'outside-archive' : 'empty', ...found,
        requirement: found.entries ? 'Root must separately retain these exact measured wider files before claiming workspace portability.' : '' });
    }
    for (const name of widerApplication) {
      const path = await directoryIfPresent(join(this.#options.applicationDirectory, name));
      if (path && name.endsWith('-control')) {
        for (const section of await readdir(path)) {
          check(['records', 'targets'].includes(section), 'BACKUP_INVENTORY_INCOMPLETE', 'Administrative process namespaces require explicit reviewed sections.');
          const sectionPath = await safeDirectory(join(path, section));
          for (const entry of await readdir(sectionPath)) {
            const file = join(sectionPath, entry);
            check(/^[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)?$/.test(entry)
              || name === CONTROL && this.#scope.getStore()?.staging.has(file), 'BACKUP_INVENTORY_INCOMPLETE', 'Unowned staging or unclassified control entries require exact root inspection.');
            const info = await lstat(file); check(info.isFile() && !info.isSymbolicLink(), 'BACKUP_UNSAFE_FILE', 'Administrative process entries must be regular files.');
          }
        }
      }
      if (path && ['backups', 'exports'].includes(name)) {
        const prefix = `chausar-${vault.read().workspace.id}-`;
        for (const entry of await readdir(path)) {
          check(entry.startsWith(prefix) && /^\d+\.(backup|json|vault)$/.test(entry.slice(prefix.length)),
            'BACKUP_EXTERNAL_ENUMERATION_REQUIRED', 'Unrelated backup/export identities require their own authorized physical enumeration.');
        }
      }
      const logical = `application/${name.replace(/^\./, '')}`, found = path ? await walk(path, logical, 0) : { entries: 0, bytes: 0 };
      const transient = name.endsWith('-control');
      namespaces.push({ namespace: logical, disposition: found.entries ? transient ? 'transient' : 'outside-archive' : 'empty', ...found,
        requirement: found.entries ? transient ? 'Reacquire current administrative locks; do not restore process ownership files.'
          : 'Root must separately retain measured application files and any credential/key dependencies; they are outside this archive.' : '' });
    }
    const exclusions = new Map(this.#options.outsideApplicationNamespaces!.map(item => [item.name, item.requirement]));
    const reservations = new Map<string, Reservation>();
    const interchangeReservations = new Map<string, { reservation: InterchangeReservation; ref: PrivateArtifactRef }>();
    for (const ref of await vault.listArtifacts({ purpose: 'workspace-interchange' })) if (/^wbt2_[a-f0-9]{64}_reservation$/.test(ref.id)) {
      const value = (await vault.readArtifact(ref)).value as Reservation;
      check(value?.format === 'chausar.backup-local-target.v2' && ref.id === reservationId(value.targetId) && value.vaultId === vault.vaultId
        && value.workspaceId === vault.read().workspace.id && slotPattern.test(value.targetId), 'BACKUP_INVENTORY_INCOMPLETE', 'Local target reservations require authenticated exact source binding.');
      reservations.set(value.targetId, value);
    } else if (/^wit_[a-f0-9]{64}_reservation$/.test(ref.id) && this.#options.workspaceActivation) {
      const value = (await vault.readArtifact(ref)).value as InterchangeReservation;
      check(value?.format === 'chausar.interchange-target-reservation.v1'
        && Object.keys(value).sort().join(',') === 'contextDigest,format,generation,physical,sourceVaultId,sourceWorkspaceId,targetId,workspaceId'
        && typeof value.targetId === 'string' && this.targetPath(value.targetId) && ref.id === `wit_${sha(value.targetId)}_reservation`
        && value.sourceVaultId === vault.vaultId && value.sourceWorkspaceId === vault.read().workspace.id
        && typeof value.workspaceId === 'string' && idPattern.test(value.workspaceId)
        && typeof value.generation === 'string' && idPattern.test(value.generation)
        && digestPattern.test(value.contextDigest) && physicalValue(value.physical)
        && !reservations.has(value.targetId) && !interchangeReservations.has(value.targetId),
      'BACKUP_ACTIVATION_TARGET_UNBOUND', 'Interchange target custody requires its exact authenticated source, workspace, artifact identity and physical reservation.');
      interchangeReservations.set(value.targetId, { reservation: value, ref });
    }
    const activation = this.#options.workspaceActivation;
    let journalName: string | undefined, journals: AuthenticatedActivationJournal[] = [];
    const manifestWalk = async (path: string, logical: string, owned: AuthenticatedActivationJournal, staging: boolean) => {
      const { journal, publication } = owned;
      check(['prepared', 'committed'].includes(journal.phase) && journal.files && journal.directories,
        'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'Partial attempted activation custody requires explicit root inspection.');
      const expectedFiles = staging && journal.phase === 'committed' ? [] : journal.files;
      const expectedDirectories = new Set(journal.directories), expected = new Map(expectedFiles.map(item => [item.path, item.witness]));
      const currentLive = !staging && journal.phase === 'committed' && publication && journal.qualification === 'encrypted-local-host'
        && expected.has(LIVE_AUTHORITY) ? this.#options.workspaceActivation?.inspectCurrentLive : undefined;
      const mutableAuthority = currentLive ? LIVE_AUTHORITY : undefined;
      const directoryStart = directories.length, fileStart = files.length;
      // Check every declared name and type before opening any file. A durable manifest
      // grants only its exact encrypted paths, never arbitrary token/credential files.
      const inspectNames = async (directory: string, prefix: string, depth: number,
        seen: { files: string[]; directories: string[] }): Promise<void> => {
        check(depth <= b.maxDepth, 'BACKUP_LIMIT', 'Owned activation paths exceed the explicit filesystem depth budget.');
        await safeDirectory(directory);
        for (const name of (await readdir(directory)).sort()) {
          const next = prefix ? `${prefix}/${name}` : name, child = join(directory, name), stat = await lstat(child, { bigint: true }), issued = expected.get(next);
          check(!stat.isSymbolicLink() && (stat.isDirectory() ? expectedDirectories.has(next) : stat.isFile() && expected.has(next)),
            'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An actual activation path has no exact issued encrypted manifest identity.');
          if (stat.isFile()) check(stat.nlink === 1n && stat.size > 0n && stat.size <= BigInt(b.maxBytes),
            'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Live inspection requires bounded regular singly owned encrypted files.');
          if (stat.isFile() && next !== mutableAuthority) check(issued
            && same(physical(stat), { dev: issued.dev, ino: issued.ino, birthtimeNs: issued.birthtimeNs }) && stat.size === BigInt(issued.bytes),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Immutable issued activation files must retain their exact physical generation and size before admission.');
          if (stat.isDirectory()) { seen.directories.push(next); await inspectNames(child, next, depth + 1, seen); }
          else seen.files.push(next);
        }
      };
      const inspectLayout = async () => {
        const seen = { files: [] as string[], directories: [] as string[] }; await inspectNames(path, '', 0, seen);
        check(same(seen.files.sort(), [...expected.keys()].sort()) && same(seen.directories.sort(), [...expectedDirectories].sort()),
          'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'Every admission boundary requires the complete exact issued file and directory layout.');
      };
      await inspectLayout();
      const inspectCurrent = async () => {
        if (!currentLive) return;
        const live = await lstat(join(path, 'live'), { bigint: true });
        check(live.isDirectory() && !live.isSymbolicLink() && same(physical(live), journal.liveDirectory),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Current live custody must retain the durable committed live directory generation.');
        const result: unknown = await currentLive({ context: structuredClone(this.#scope.getStore()!.context),
          targetId: journal.reservation.targetId, publication: structuredClone(publication!) });
        check(result === undefined, 'BACKUP_ACTIVATION_LIVE_GUARD', 'Current live authentication must complete without returned admission data.');
      };
      await inspectCurrent(); await inspectLayout();
      const found = await walk(path, logical, 0, { prefix: logical, files: expected, directories: expectedDirectories, mutableAuthority });
      const actualDirectories = directories.slice(directoryStart).map(item => item.path.slice(logical.length + 1)).filter(Boolean);
      check(same(actualDirectories.sort(), [...expectedDirectories].sort())
        && same(files.slice(fileStart).map(item => item.path.slice(logical.length + 1)).sort(), [...expected.keys()].sort()),
      'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'Actual owned activation files and directories must equal the complete durable phase manifest.');
      for (const file of files.slice(fileStart)) {
        const issued = expected.get(file.path.slice(logical.length + 1))!;
        check(file.path === `${logical}/${mutableAuthority}` || same({ dev: file.dev, ino: file.ino, birthtimeNs: file.birthtimeNs, bytes: file.bytes, sha256: file.sha256 }, issued),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Actual activation ciphertext generation, measured size or hash differs from durable issuance.');
      }
      await inspectCurrent(); await inspectLayout();
      if (currentLive) {
        const measured = files.slice(fileStart).find(file => file.path === `${logical}/${LIVE_AUTHORITY}`)!;
        check(same((await readRegular(join(path, LIVE_AUTHORITY), measured.path, b.maxBytes)).witness, measured),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'The bounded measured live authority must remain exact through final authentication.');
      }
      return { ...found, entries: found.entries + expectedDirectories.size };
    };
    if (activation) {
      const journal = activation.journalVault, directory = await safeDirectory(journal.directory);
      journalName = relative(this.#options.applicationDirectory, directory);
      check(directory === resolve(journal.directory) && journalName && !journalName.includes(sep),
        'BACKUP_ACTIVATION_SCOPE', 'Reviewed journal custody must retain its exact canonical direct managed location.');
      for (const name of await readdir(directory)) check(['authority.encrypted.json', 'writer.lock', 'private-artifacts'].includes(name),
        'BACKUP_INVENTORY_INCOMPLETE', 'The reviewed journal contains an unclassified physical namespace.');
      const raw = await journal.captureEncryptedCustody(this.#vaultBudget(true));
      check(raw.storageKind === 'experimental-file' && raw.authorityKind === 'exact-file-bytes' && raw.vaultId === journal.vaultId && same(raw.state, journal.read()),
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Journal namespace must authenticate with its own actual current Vault authority.');
      const logical = `application/journal/${journalName}`, journalStart = files.length;
      await walk(directory, logical, 0);
      const measured = files.slice(journalStart), authority = measured.find(item => item.path === `${logical}/authority.encrypted.json`);
      check(authority?.bytes === raw.authority.length && authority.sha256 === sha(raw.authority),
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Physical journal authority differs from independently authenticated exact bytes.');
      for (const item of raw.artifacts) {
        const file = measured.find(file => file.path === `${logical}/private-artifacts/${item.ref.purpose}/${item.ref.id}.encrypted.json`);
        check(file?.bytes === item.bytes.length && file.sha256 === sha(item.bytes),
          'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Physical journal private ciphertext differs from its own authenticated custody.');
      }
      check(measured.filter(item => item.path.startsWith(`${logical}/private-artifacts/`)).length === raw.artifacts.length,
        'BACKUP_INVENTORY_INCOMPLETE', 'Every actual journal private file must authenticate; omitted files cannot qualify.');
      for (const [namespace, retained, disposition] of [
        [`${logical}/authority`, [authority!], 'outside-archive'],
        ...purposes.map(purpose => [`${logical}/private-artifacts/${purpose}`, measured.filter(item => item.path.startsWith(`${logical}/private-artifacts/${purpose}/`)), 'outside-archive']),
        [`${logical}/writer.lock`, measured.filter(item => item.path === `${logical}/writer.lock`), 'transient'],
      ] as [string, Witness[], 'outside-archive' | 'transient'][]) {
        namespaces.push({ namespace, disposition: retained.length ? disposition : 'empty', entries: retained.length,
          bytes: retained.reduce((sum, item) => sum + item.bytes, 0), requirement: retained.length
            ? disposition === 'transient' ? 'Reacquire the separate current journal Vault writer admission; historical process ownership is never restored.'
              : 'Separately retain this reviewed journal Vault and its own operator credential/key dependencies; exact measured bytes remain outside the source archive.' : '' });
      }
      if (raw.keychainHookPresent) check(this.#options.externalKeyRequirements.some(item => item.provider === 'keychain'),
        'BACKUP_EXTERNAL_KEYS_REQUIRED', 'The actual journal keychain hook requires explicit separate external key custody.');
      journals = await this.#activationJournals(raw, interchangeReservations);
      const control = await directoryIfPresent(join(this.#options.applicationDirectory, ACTIVATION_CONTROL));
      let stagingFound = { entries: 0, bytes: 0 };
      if (control) {
        check((await readdir(control)).every(name => name === 'staging'), 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Only the reviewed activation staging section may be enumerated.');
        const staging = await directoryIfPresent(join(control, 'staging'));
        if (staging) {
          check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Activation administrative directories exceed the explicit entry budget.');
          directories.push({ path: 'application/workspace-activation-control/staging', physical: physical(await lstat(staging, { bigint: true })) });
          for (const name of (await readdir(staging)).sort()) {
            const owned = journals.find(value => value.journal.staging?.name === name), path = join(staging, name);
            check(owned?.journal.staging && ['prepared', 'committed'].includes(owned.journal.phase),
              'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An actual staging attempt must resolve to one complete durable prepared or committed journal.');
            const stat = await lstat(path, { bigint: true });
            check(stat.isDirectory() && !stat.isSymbolicLink() && same(physical(stat), owned.journal.staging.physical),
              'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'The durable staging physical generation changed.');
            const found = await manifestWalk(path, `application/workspace-activation-control/staging/${name}`, owned, true);
            stagingFound.entries += found.entries + 1; stagingFound.bytes += found.bytes;
          }
        }
        check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Activation administrative directories exceed the explicit entry budget.');
        directories.push({ path: 'application/workspace-activation-control', physical: physical(await lstat(control, { bigint: true })) });
      }
      namespaces.push({ namespace: 'application/workspace-activation-control/staging', disposition: stagingFound.entries ? 'outside-archive' : 'empty', ...stagingFound,
        requirement: control ? 'Exact durable attempt directories are measured separately, including retained empty directories; unresolved publication must be inspected under current root admission.' : '' });
    }
    const sourceName = relative(this.#options.applicationDirectory, source);
    for (const name of (await readdir(this.#options.applicationDirectory)).sort()) {
      if (name === sourceName || widerApplication.includes(name) || name === journalName
        || activation && name === ACTIVATION_CONTROL || this.#scope.getStore()?.targets.has(name)) continue;
      const path = join(this.#options.applicationDirectory, name), info = await lstat(path, { bigint: true });
      check(!info.isSymbolicLink() && (info.isFile() || info.isDirectory()), 'BACKUP_UNSAFE_FILE', 'Application siblings cannot be symbolic links or unclassified special files.');
      const reservation = reservations.get(name), requirement = exclusions.get(name);
      if (reservation) {
        check(info.isDirectory() && same(physical(info), reservation.physical), 'BACKUP_TARGET_CHANGED', 'A previously reserved inert target changed physical identity.');
        const found = await walk(path, `application/targets/${name}`, 0);
        namespaces.push({ namespace: `application/targets/${name}`, disposition: found.entries ? 'outside-archive' : 'empty', ...found,
          requirement: found.entries ? 'Previously reserved inert evidence is separately retained; its exact measured bytes are outside this source archive.' : '' });
      } else if (interchangeReservations.has(name)) {
        const reserved = interchangeReservations.get(name)!;
        check(info.isDirectory() && same(physical(info), reserved.reservation.physical),
          'BACKUP_TARGET_CHANGED', 'A source-owned interchange target changed its reserved physical identity.');
        const populated = (await readdir(path)).length > 0, matching = journals.filter(value => value.journal.phase === 'committed' && same(value.journal.reservationRef, reserved.ref));
        check(!populated || matching.length === 1, 'BACKUP_ACTIVATION_TARGET_UNBOUND', 'Populated target custody requires one exact committed durable activation manifest.');
        const logical = `application/targets/${name}`, found = populated ? await manifestWalk(path, logical, matching[0], false) : await walk(path, logical, 0);
        namespaces.push({ namespace: logical, disposition: found.entries ? 'outside-archive' : 'empty', ...found,
          requirement: found.entries ? 'Source-owned initialized target ciphertext is separately measured under its exact committed manifest; it is outside this source archive and requires fresh target credentials.' : '' });
      } else {
        check(requirement, 'BACKUP_INVENTORY_INCOMPLETE', 'An actual unrelated application namespace requires an explicit root exclusion.');
        // This codec's finite measured counts cannot represent unread foreign descendants.
        // A declaration never authorizes reading another workspace or fabricating zero measurements.
        throw new ChausarError('BACKUP_EXTERNAL_ENUMERATION_REQUIRED', 'The actual declared external namespace needs its own authorized physical enumeration; this local measured profile cannot claim complete wider accounting.');
      }
    }
    return { physical: physical(rootStat), directories: directories.sort((a, b) => a.path.localeCompare(b.path)),
      files: files.sort((a, b) => a.path.localeCompare(b.path)), namespaces };
  }
  async #capture(includeOwnPublications = false): Promise<Captured> {
    const started = performance.now(), vault = this.#options.vault;
    const raw = await vault.captureEncryptedCustody(this.#vaultBudget(includeOwnPublications));
    check(raw.storageKind === 'experimental-file' && raw.authorityKind === 'exact-file-bytes' && same(raw.state, vault.read()),
      'BACKUP_LOCAL_REQUIRED', 'Local qualification requires authenticated exact persisted file authority.');
    const inventory = await this.#inventory();
    const authority = inventory.files.find(item => item.path === 'authority');
    check(authority?.bytes === raw.authority.length && authority.sha256 === sha(raw.authority), 'BACKUP_FILE_CHANGED', 'Actual authority bytes differ from Vault-authenticated custody.');
    const artifacts = raw.artifacts.map(item => ({ ref: identity(item.ref), bytes: Uint8Array.from(item.bytes) }));
    for (const item of artifacts) {
      const found = inventory.files.find(file => file.path === `private-artifacts/${item.ref.purpose}/${item.ref.id}.encrypted.json`);
      check(found?.bytes === item.bytes.length && found.sha256 === sha(item.bytes), 'BACKUP_FILE_CHANGED', 'Physical private bytes differ from authenticated custody.');
    }
    check(inventory.files.filter(item => item.path.startsWith('private-artifacts/')).length === artifacts.length,
      'BACKUP_INVENTORY_INCOMPLETE', 'Actual private files must exactly equal the complete authenticated artifact enumeration.');
    const namespaces: WorkspaceBackupV2Namespace[] = [{ namespace: 'authority', disposition: 'included', entries: 1, bytes: raw.authority.length, requirement: '' },
      ...purposes.map(purpose => ({ namespace: `private-artifacts/${purpose}`, disposition: 'included' as const,
        entries: artifacts.filter(item => item.ref.purpose === purpose).length,
        bytes: artifacts.filter(item => item.ref.purpose === purpose).reduce((n, item) => n + item.bytes.length, 0), requirement: '' })), ...inventory.namespaces];
    namespaces.sort((a, b) => a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0);
    const externalKeyRequirements = structuredClone(this.#options.externalKeyRequirements);
    check(externalKeyRequirements.some(item => item.provider === 'other' && item.namespace === 'operator/credential-wrappers'),
      'BACKUP_EXTERNAL_KEYS_REQUIRED', 'Explicitly classify operator credentials needed to unwrap archive authority.');
    if (raw.keychainHookPresent) check(externalKeyRequirements.some(item => item.provider === 'keychain'),
      'BACKUP_EXTERNAL_KEYS_REQUIRED', 'An active keychain hook requires explicit separate destination keychain custody.');
    externalKeyRequirements.sort((a, b) => `${a.provider}/${a.namespace}` < `${b.provider}/${b.namespace}` ? -1 : 1);
    const source: WorkspaceBackupV2Source = { vaultId: raw.vaultId, workspaceId: raw.state.workspace.id, revision: raw.state.revision,
      captureId: `capture_${randomUUID()}`, enumerationId: `enumeration_${sha(canonical(inventory))}` };
    const capture: WorkspaceBackupV2Capture = { source, authority: Uint8Array.from(raw.authority), artifacts, namespaces, externalKeyRequirements };
    if (!includeOwnPublications) {
      captureWorkspaceBackupV2(capture, this.#options.budgets);
      this.#diagnostics = { qualification: 'encrypted-local-host', fullWorkspacePortable: false, source, namespaces,
        externalKeyRequirements, physicalFiles: inventory.files, measuredCaptureMs: performance.now() - started };
    }
    return { capture, state: raw.state, inventory };
  }
  async #assertCapturedCurrent(context: Context, captured: Captured) {
    await this.#guard(context, captured.state); check(same(this.#options.vault.read(), captured.state), 'BACKUP_SOURCE_CHANGED', 'Source authority changed during custody.');
    const now = await this.#capture(true), changes = this.#scope.getStore()!.changes;
    check(same(now.inventory.physical, captured.inventory.physical) && same(now.inventory.directories, captured.inventory.directories), 'BACKUP_SOURCE_CHANGED', 'Wider source directory generation changed.');
    const expectedFiles = new Map(captured.inventory.files.map(item => [item.path, item]));
    for (const [key, change] of changes) {
      const path = `private-artifacts/${key}.encrypted.json`; expectedFiles.delete(path);
      if (change) { const current = now.inventory.files.find(item => item.path === path); check(current && current.bytes === change.ref.diskBytes
        && current.sha256 === change.sha256, 'BACKUP_SOURCE_CHANGED', 'An adapter-owned custody publication changed.'); }
      else check(!now.inventory.files.some(item => item.path === path), 'BACKUP_SOURCE_CHANGED', 'Revoked adapter-owned ciphertext reappeared.');
    }
    const actualFiles = now.inventory.files.filter(item => !changes.has(item.path.replace(/^private-artifacts\//, '').replace(/\.encrypted\.json$/, '')));
    check(same(actualFiles, [...expectedFiles.values()].sort((a, b) => a.path.localeCompare(b.path))), 'BACKUP_SOURCE_CHANGED', 'Actual source bytes or wider files changed during custody.');
  }
  async #withSource<T>(context: Context, expected: WorkspaceBackupV2SourcePin | null, work: Parameters<WorkspaceBackupV2HostPorts['withSource']>[2]): Promise<T> {
    return this.#snapshot(context, async () => {
      await this.#guard(context, this.#options.vault.read()); const captured = await this.#capture();
      if (expected) {
        const actual = captureWorkspaceBackupV2({ ...captured.capture, source: structuredClone(expected.source) }, this.#options.budgets).pin;
        check(same(actual, expected) && expected.source.vaultId === captured.capture.source.vaultId && expected.source.workspaceId === captured.state.workspace.id
          && expected.source.revision === captured.state.revision && expected.source.enumerationId === captured.capture.source.enumerationId,
        'BACKUP_SOURCE_CHANGED', 'Actual complete source differs from its independently retained pin and physical enumeration.');
      }
      const assertCurrent = () => this.#assertCapturedCurrent(context, captured);
      const result = await work({ independentlyEnumerated: true, state: structuredClone(captured.state), capture: structuredClone(captured.capture), assertCurrent,
        assertCompleteOwner: (ctx, historical) => this.#guard(ctx, historical),
        authenticateCapture: async capture => { const historical = await this.#options.vault.authenticateEncryptedCustody(capture, this.#vaultBudget()); await this.#guard(context, historical); },
      }); await assertCurrent(); return result as T;
    });
  }
  async #authenticateArchive(context: Context, archive: WorkspaceBackupV2Archive) {
    await this.#snapshot(context, async () => {
      const capture = workspaceBackupV2Bytes(archive, this.#options.budgets);
      const state = await this.#options.vault.authenticateEncryptedCustody(capture, this.#vaultBudget()); await this.#guard(context, state);
    });
  }
  async #assertRestoreOwner(context: Context, source: WorkspaceBackupV2Source) {
    await this.#snapshot(context, async () => {
      const current = this.#options.vault.read();
      check(source.vaultId === this.#options.vault.vaultId && source.workspaceId === current.workspace.id, 'BACKUP_SOURCE_CHANGED', 'Archive belongs to another unlocked source authority.');
      await this.#guard(context, current);
    });
  }
  async #find(id: string) {
    try { return await this.#options.vault.readArtifact({ id, purpose: 'workspace-interchange' }); }
    catch (error: any) { if (error.code === 'ARTIFACT_NOT_FOUND') return null; throw error; }
  }
  async #write(id: string, value: unknown, expectedDigest: string | null) {
    let error: unknown;
    try { await this.#options.vault.writeArtifact({ id, purpose: 'workspace-interchange', value, expectedDigest }); } catch (failure) { error = failure; }
    // Publication may have completed before an acknowledgement failed. Exact readback decides custody.
    const persisted = await this.#find(id);
    if (!persisted || !same(persisted.value, value)) { if (error) throw error; throw new ChausarError('BACKUP_CUSTODY_CHANGED', 'Encrypted custody publication did not read back exactly.'); }
    const ref = identity(persisted), path = join(this.#options.vault.directory, 'private-artifacts', ref.purpose, `${id}.encrypted.json`);
    const bytes = await readRegular(path, `private-artifacts/${ref.purpose}/${id}.encrypted.json`, this.#options.filesystemBudgets.maxBytes);
    check(bytes.bytes.length === ref.diskBytes, 'BACKUP_CUSTODY_CHANGED', 'Actual ciphertext byte measurement differs from authenticated publication.');
    this.#scope.getStore()?.changes.set(`${ref.purpose}/${id}`, { ref, sha256: bytes.witness.sha256 }); return ref;
  }
  async #delete(ref: PrivateArtifactRef) {
    let error: unknown;
    try { await this.#options.vault.removeArtifact({ ...ref, expectedDigest: ref.valueDigest }); } catch (failure) { error = failure; }
    if (await this.#find(ref.id)) { if (error) throw error; throw new ChausarError('BACKUP_CUSTODY_CHANGED', 'Exact ciphertext removal did not complete.'); }
    this.#scope.getStore()?.changes.set(`${ref.purpose}/${ref.id}`, null); return ref.diskBytes;
  }
  #measure(archive: PrivateArtifactRef, pin: PrivateArtifactRef): WorkspaceBackupV2Measurement {
    return { encrypted: true, archiveCiphertextBytes: archive.diskBytes, pinCiphertextBytes: pin.diskBytes, qualification: 'encrypted-local-host' };
  }
  #recordMeasurement(recordId: string, binding: Binding, ref: PrivateArtifactRef, started: number, removed = 0) {
    const archive = binding.state === 'discarded' ? 0 : binding.archive?.diskBytes ?? 0, pin = binding.state === 'discarded' ? 0 : binding.pin?.diskBytes ?? 0;
    this.#measurements.set(recordId, { recordId, state: binding.state, archiveCiphertextBytes: archive, pinCiphertextBytes: pin,
      bindingCiphertextBytes: ref.diskBytes, totalRetainedCiphertextBytes: archive + pin + ref.diskBytes, removedCiphertextBytes: removed, measuredMs: performance.now() - started });
  }
  async #create(context: Context, record: WorkspaceBackupV2CustodyRecord, assertCurrent: () => Promise<void>) {
    check(this.#scope.getStore() && idPattern.test(record.pin.recordId) && record.pin.contextDigest === sha(canonical(context)),
      'BACKUP_SOURCE_LEASE_REQUIRED', 'Issue backup only under its preparing owner source lease.');
    const archive = validateWorkspaceBackupV2(record.content, record.pin.sourcePin, this.#options.budgets);
    check(archive.digest === record.pin.archiveDigest, 'BACKUP_CUSTODY_CHANGED', 'Custody pin must bind the exact complete archive.');
    return this.#locked('records', `${this.#options.vault.vaultId}:${record.pin.recordId}`, async () => {
      const started = performance.now(), recordId = record.pin.recordId, bindingId = controlId(recordId, 'binding');
      for (const part of ['archive', 'pin', 'binding'] as const) check(!await this.#find(controlId(recordId, part)), 'BACKUP_OUTPUT_EXISTS', 'Backup record IDs are durable single-use, including orphaned and discarded issuance.');
      let binding: Binding = { format: 'chausar.backup-local-binding.v2', recordId, creationId: record.pin.creationId, contextDigest: record.pin.contextDigest,
        archiveDigest: archive.digest, pinDigest: sha(canonical(record.pin)), state: 'preparing', archive: null, pin: null };
      let bindingRef: PrivateArtifactRef | undefined;
      try {
        await assertCurrent(); bindingRef = await this.#write(bindingId, binding, null);
        const archiveRef = await this.#write(controlId(recordId, 'archive'), { format: 'chausar.backup-local-archive.v2', recordId, creationId: record.pin.creationId, content: record.content }, null);
        binding = { ...binding, archive: archiveRef }; bindingRef = await this.#write(bindingId, binding, bindingRef.valueDigest);
        const pinRef = await this.#write(controlId(recordId, 'pin'), { format: 'chausar.backup-local-pin.v2', recordId, creationId: record.pin.creationId, pin: record.pin }, null);
        binding = { ...binding, pin: pinRef }; bindingRef = await this.#write(bindingId, binding, bindingRef.valueDigest);
        await assertCurrent(); await this.#guard(context, this.#options.vault.read());
        binding = { ...binding, state: 'committed' }; bindingRef = await this.#write(bindingId, binding, bindingRef.valueDigest);
        const readback = await this.#readUnlocked(context, recordId);
        check(same(readback.record, record), 'BACKUP_CUSTODY_CHANGED', 'Committed archive and independent pin differ from issuance.');
        this.#recordMeasurement(recordId, binding, bindingRef, started); return this.#measure(archiveRef, pinRef);
      } catch (error) {
        try {
          const retained = await this.#find(bindingId);
          if (retained) {
            const actual = retained.value as Binding;
            check(actual.creationId === binding.creationId && actual.archiveDigest === binding.archiveDigest && actual.pinDigest === binding.pinDigest,
              'BACKUP_CUSTODY_CHANGED', 'Failed issuance found another binding and cannot revoke it.');
            const revoked = { ...actual, state: 'discarded' as const }; const tombstone = await this.#write(bindingId, revoked, retained.valueDigest);
            let removed = 0;
            for (const part of ['pin', 'archive'] as const) {
              const item = await this.#find(controlId(recordId, part)); if (!item) continue;
              const value = item.value as any;
              check(value.recordId === recordId && value.creationId === binding.creationId && (part === 'archive' ? value.content === record.content : same(value.pin, record.pin)),
                'BACKUP_CUSTODY_CHANGED', 'Failed issuance found changed payload ciphertext and cannot remove it.');
              removed += await this.#delete(identity(item));
            }
            this.#recordMeasurement(recordId, revoked, tombstone, started, removed);
          }
        } catch { throw new ChausarError('BACKUP_CLEANUP_REQUIRED', 'Failed issuance has unresolved exact ciphertext custody; its ID remains reserved for root inspection.'); }
        throw error;
      }
    });
  }
  async #readUnlocked(context: Context, recordId: string) {
    const retained = await this.#find(controlId(recordId, 'binding')), binding = retained?.value as Binding;
    check(retained && binding?.format === 'chausar.backup-local-binding.v2' && binding.recordId === recordId && binding.state === 'committed'
      && binding.contextDigest === sha(canonical(context)) && binding.archive && binding.pin, 'BACKUP_CUSTODY_NOT_COMMITTED', 'No current committed issuance authenticates this backup for the preparing owner.');
    const archive = await this.#find(controlId(recordId, 'archive')), pin = await this.#find(controlId(recordId, 'pin'));
    check(archive && pin && same(identity(archive), binding.archive) && same(identity(pin), binding.pin), 'BACKUP_CUSTODY_CHANGED', 'Independent bound encrypted archive or pin changed.');
    const av = archive.value as any, pv = pin.value as any;
    check(av?.format === 'chausar.backup-local-archive.v2' && pv?.format === 'chausar.backup-local-pin.v2'
      && av.recordId === recordId && pv.recordId === recordId && av.creationId === binding.creationId && pv.creationId === binding.creationId
      && typeof av.content === 'string' && pv.pin && sha(canonical(pv.pin)) === binding.pinDigest && pv.pin.archiveDigest === binding.archiveDigest,
    'BACKUP_CUSTODY_CHANGED', 'Authenticated archive and independent pin differ from their durable issuance binding.');
    const checked = validateWorkspaceBackupV2Capture(av.content, pv.pin.sourcePin, this.#options.budgets);
    check(checked.archive.digest === binding.archiveDigest, 'BACKUP_CUSTODY_CHANGED', 'The complete archive differs from its durable issuance digest.');
    return { record: { content: av.content, pin: structuredClone(pv.pin) } as WorkspaceBackupV2CustodyRecord,
      measurement: this.#measure(identity(archive), identity(pin)), binding, ref: identity(retained), capture: checked.capture };
  }
  async #read(context: Context, recordId: string) {
    check(idPattern.test(recordId), 'BACKUP_RECORD_ID', 'Use one explicit managed record ID.');
    return this.#snapshot(context, () => this.#locked('records', `${this.#options.vault.vaultId}:${recordId}`, async () => {
      const started = performance.now(); await this.#guard(context, this.#options.vault.read()); const result = await this.#readUnlocked(context, recordId);
      await this.#guard(context, this.#options.vault.read()); this.#recordMeasurement(recordId, result.binding, result.ref, started);
      return { ...result.record, measurement: result.measurement };
    }));
  }
  async #remove(context: Context, input: { recordId: string; creationId: string; expectedArchiveDigest: string; expectedPinDigest: string }) {
    check(idPattern.test(input.recordId) && idPattern.test(input.creationId) && digestPattern.test(input.expectedArchiveDigest) && digestPattern.test(input.expectedPinDigest),
      'BACKUP_RECORD_ID', 'Cleanup requires exact issuance identity and both reviewed digests.');
    await this.#snapshot(context, () => this.#locked('records', `${this.#options.vault.vaultId}:${input.recordId}`, async () => {
      const started = performance.now(), result = await this.#readUnlocked(context, input.recordId);
      check(result.binding.creationId === input.creationId && result.binding.archiveDigest === input.expectedArchiveDigest && result.binding.pinDigest === input.expectedPinDigest,
        'BACKUP_CUSTODY_CHANGED', 'Only the exact original issuance may be discarded.');
      const binding = { ...result.binding, state: 'discarded' as const }, tombstone = await this.#write(result.ref.id, binding, result.ref.valueDigest);
      let removed = 0;
      try { for (const ref of [result.binding.pin!, result.binding.archive!]) removed += await this.#delete(ref); }
      catch { throw new ChausarError('BACKUP_CLEANUP_REQUIRED', 'Issuance is durably revoked; bound ciphertext cleanup requires root inspection.'); }
      this.#recordMeasurement(input.recordId, binding, tombstone, started, removed);
    }));
  }
  async #reservation(context: Context, targetId: string) {
    const retained = await this.#find(reservationId(targetId)), reservation = retained?.value as Reservation;
    check(retained && reservation?.format === 'chausar.backup-local-target.v2' && reservation.targetId === targetId
      && reservation.vaultId === this.#options.vault.vaultId && reservation.workspaceId === this.#options.vault.read().workspace.id
      && reservation.contextDigest === sha(canonical(context)), 'BACKUP_TARGET_CHANGED', 'Target has no exact encrypted current-owner reservation.');
    const path = await safeDirectory(this.targetPath(targetId)), stat = await lstat(path, { bigint: true });
    check(same(physical(stat), reservation.physical), 'BACKUP_TARGET_CHANGED', 'Reserved physical empty-target generation changed.');
    return { reservation, ref: identity(retained), path };
  }
  async #withTarget<T>(context: Context, targetId: string, work: Parameters<WorkspaceBackupV2HostPorts['withTarget']>[2]): Promise<T> {
    return this.#snapshot(context, () => this.#locked('targets', this.targetPath(targetId), async () => {
      await this.#guard(context, this.#options.vault.read()); const path = this.targetPath(targetId);
      check(!await this.#find(reservationId(targetId)), 'BACKUP_TARGET_EXISTS', 'Target IDs are durable single-use and existing targets cannot be adopted.');
      try { await lstat(path); throw new ChausarError('BACKUP_TARGET_EXISTS', 'Allocate a new managed target; an existing directory or file cannot be adopted.'); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const captured = await this.#capture();
      try { await mkdir(path, { mode: 0o700 }); } catch (error: any) { if (error.code === 'EEXIST') throw new ChausarError('BACKUP_TARGET_EXISTS', 'Allocate a new managed target; an existing empty directory cannot be adopted.'); throw error; }
      await syncDirectory(dirname(path));
      this.#scope.getStore()!.targets.add(targetId);
      const stat = await lstat(path, { bigint: true });
      const reservation: Reservation = { format: 'chausar.backup-local-target.v2', targetId, locationId: `location_${randomUUID()}`, generation: `empty_${randomUUID()}`,
        vaultId: this.#options.vault.vaultId, workspaceId: this.#options.vault.read().workspace.id, contextDigest: sha(canonical(context)), physical: physical(stat),
        state: 'empty', creationId: null, archiveDigest: null, containerSha256: null };
      let ref: PrivateArtifactRef;
      try { ref = await this.#write(reservationId(targetId), reservation, null); }
      catch (error) {
        check(same(physical(await lstat(path, { bigint: true })), reservation.physical) && (await readdir(path)).length === 0,
          'BACKUP_TARGET_CLEANUP_REQUIRED', 'Failed target allocation changed physical custody and cannot be removed.'); await rmdir(path); throw error;
      }
      const target: WorkspaceBackupV2EmptyTarget = { targetId, locationId: reservation.locationId, generation: reservation.generation, ready: true,
        authorityRecords: 0, artifactRecords: 0, unexpectedEntries: [] };
      const scope: TargetScope = { context: structuredClone(context), reservation, ref, target };
      const assertCurrent = async () => {
        await this.#assertCapturedCurrent(context, captured); const actual = await this.#reservation(context, targetId);
        check(same(actual.reservation, scope.reservation) && same(actual.ref, scope.ref), 'BACKUP_TARGET_CHANGED', 'The exact encrypted target reservation changed.');
        const names = (await readdir(path)).sort();
        if (scope.reservation.state === 'restored') {
          check(same(names, [INERT]), 'BACKUP_TARGET_CHANGED', 'An inert target acquired unclassified or executable authority entries.');
          const file = await readRegular(join(path, INERT), `target/${targetId}/${INERT}`, this.#containerLimit());
          check(file.witness.sha256 === scope.reservation.containerSha256, 'BACKUP_TARGET_CHANGED', 'Published inert ciphertext changed.');
        } else check(names.length === 0, 'BACKUP_TARGET_NOT_EMPTY', 'The reserved target acquired authority or unexpected entries.');
      };
      const assertEmpty = async () => { await assertCurrent(); check(scope.reservation.state === 'empty' && (await readdir(path)).length === 0,
        'BACKUP_TARGET_NOT_EMPTY', 'Actual target authority, private artifacts and all wider entries must be zero.'); };
      return this.#target.run(scope, async () => {
        try { const result = await work({ inspection: target, assertCurrent, assertEmpty }); await assertCurrent(); return result as T; }
        catch (error) {
          // Before publication, remove the exact allocated empty directory and retain the single-use reservation tombstone.
          if (scope.reservation.state === 'empty') {
            try {
              const actual = await this.#reservation(context, targetId);
              check(same(actual.ref, scope.ref) && same(actual.reservation, scope.reservation) && (await readdir(path)).length === 0,
                'BACKUP_TARGET_CHANGED', 'Failed target allocation changed and cannot be removed.');
              const revoked: Reservation = { ...scope.reservation, state: 'rolled-back' };
              scope.ref = await this.#write(scope.ref.id, revoked, scope.ref.valueDigest); scope.reservation = revoked; await rmdir(path); await syncDirectory(dirname(path));
            } catch { throw new ChausarError('BACKUP_TARGET_CLEANUP_REQUIRED', 'Failed empty target allocation has unresolved exact reservation custody.'); }
          }
          throw error;
        }
      });
    }));
  }
  #containerLimit() { return this.#options.budgets.maxArchiveUtf8Bytes * 2 + this.#options.budgets.maxTotalEntryBytes; }
  async #restoreAtomic(context: Context, input: { creationId: string; target: WorkspaceBackupV2EmptyTarget; archive: WorkspaceBackupV2Archive }, assertEmptyCurrent: () => Promise<void>) {
    const scope = this.#target.getStore();
    check(scope && same(scope.context, context) && same(scope.target, input.target) && idPattern.test(input.creationId),
      'BACKUP_TARGET_LEASE_REQUIRED', 'Inert publication requires its held exact newly allocated target lease.');
    const content = encodeWorkspaceBackupV2(input.archive, this.#options.budgets), capture = workspaceBackupV2Bytes(input.archive, this.#options.budgets);
    const historical = await this.#options.vault.authenticateEncryptedCustody(capture, this.#vaultBudget()); await this.#guard(context, historical);
    const receipt: WorkspaceBackupV2RestoreReceipt = { targetId: input.target.targetId, creationId: input.creationId, archiveDigest: input.archive.digest,
      sourcePin: structuredClone(input.archive.pin), entries: capture.artifacts.length + 1,
      bytes: capture.authority.length + capture.artifacts.reduce((n, item) => n + item.bytes.length, 0), inert: true, activation: 'root-only' };
    const text = JSON.stringify({ format: 'chausar.backup-inert-container.v2', content, receipt }), path = this.targetPath(input.target.targetId);
    check(Buffer.byteLength(text) <= this.#containerLimit() && Buffer.byteLength(text) <= this.#options.filesystemBudgets.maxBytes
      && Number.isSafeInteger(this.#containerLimit()), 'BACKUP_LIMIT', 'The inert staging container exceeds its explicit archive-derived or filesystem byte budget.');
    // The staging file is outside the empty target and publication is an exclusive hard-link create.
    const staging = join(this.#options.applicationDirectory, CONTROL, 'targets', `${sha(path)}.${randomUUID()}.stage`);
    const file = await open(staging, 'wx', 0o600), stagingPhysical = physical(await file.stat({ bigint: true }));
    let published = false, stagedWitness: Witness | undefined;
    try {
      await file.writeFile(text, 'utf8'); await file.sync(); await file.close();
      const staged = await readRegular(staging, 'staging/inert-container', this.#containerLimit());
      check(staged.bytes.equals(Buffer.from(text)), 'BACKUP_PARTIAL_RESTORE', 'Complete inert staging readback differs.');
      stagedWitness = staged.witness;
      this.#scope.getStore()!.staging.set(staging, staged.witness);
      const decoded = JSON.parse(staged.bytes.toString('utf8'));
      validateWorkspaceBackupV2(decoded.content, input.archive.pin, this.#options.budgets);
      await this.#options.vault.authenticateEncryptedCustody(workspaceBackupV2Bytes(inspectWorkspaceBackupV2(decoded.content, this.#options.budgets), this.#options.budgets), this.#vaultBudget());
      let admissionCalls = 0;
      const readback = await this.#options.withCompleteOwner(structuredClone(context), structuredClone(historical), async assertAdmissionCurrent => {
        check(++admissionCalls === 1 && typeof assertAdmissionCurrent === 'function', 'BACKUP_HOST_GUARD', 'Root must execute one held synchronous publication admission.');
        await assertEmptyCurrent(); await this.#guard(context, historical);
        const assertAdmission = () => { const result: unknown = assertAdmissionCurrent(); check(result === undefined,
          'BACKUP_HOST_GUARD', 'Held publication admission must assert synchronously without a deferred value.'); };
        assertAdmission();
        try { await link(staging, join(path, INERT)); published = true; }
        catch (error) {
          try {
            const actual = await lstat(join(path, INERT), { bigint: true });
            // A completed link with lost acknowledgement must be the exact staging inode,
            // not an independently created file with copied bytes or an existing target.
            if (actual.isFile() && !actual.isSymbolicLink() && actual.nlink === 2n && same(physical(actual), physical(await lstat(staging, { bigint: true })))
              && same(physical(actual), { dev: staged.witness.dev, ino: staged.witness.ino, birthtimeNs: staged.witness.birthtimeNs })) published = true;
            else throw error;
          } catch { throw error; }
        }
        const linked = await lstat(staging, { bigint: true });
        check(linked.isFile() && !linked.isSymbolicLink() && linked.nlink === 2n && same(physical(linked), physical(await lstat(join(path, INERT), { bigint: true })))
          && same(physical(linked), { dev: staged.witness.dev, ino: staged.witness.ino, birthtimeNs: staged.witness.birthtimeNs }),
        'BACKUP_TARGET_CHANGED', 'Publication must retain the exact staged physical generation.');
        let unlinkFailure: unknown;
        try { await unlink(staging); } catch (error) { unlinkFailure = error; }
        try { await lstat(staging); if (unlinkFailure) throw unlinkFailure; throw new ChausarError('BACKUP_TARGET_CHANGED', 'Owned staging ciphertext still exists after publication.'); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        this.#scope.getStore()!.staging.delete(staging); await syncDirectory(path); await syncDirectory(dirname(staging));
        const actual = await readRegular(join(path, INERT), `target/${input.target.targetId}/${INERT}`, this.#containerLimit());
        check(actual.bytes.equals(Buffer.from(text)), 'BACKUP_PARTIAL_RESTORE', 'Published complete inert ciphertext readback differs.');
        assertAdmission(); return actual;
      });
      check(admissionCalls === 1 && readback?.bytes instanceof Uint8Array && readback.bytes.equals(Buffer.from(text)),
        'BACKUP_HOST_GUARD', 'Root must complete the held actual publication and return its exact readback.');
      // Reservation is a separately guarded encrypted write after the FS admission exits.
      // Never nest a Vault writerGuard inside another writerGuard: Engine leases need not be reentrant.
      const reservation: Reservation = { ...scope.reservation, state: 'restored', creationId: input.creationId,
        archiveDigest: input.archive.digest, containerSha256: readback.witness.sha256 };
      scope.ref = await this.#write(scope.ref.id, reservation, scope.ref.valueDigest); scope.reservation = reservation;
      return receipt;
    } catch (error) {
      await file.close().catch(() => {});
      try {
        const current = await lstat(staging, { bigint: true });
        const expected = stagedWitness ?? this.#scope.getStore()!.staging.get(staging);
        const expectedPhysical = expected ? { dev: expected.dev, ino: expected.ino, birthtimeNs: expected.birthtimeNs } : stagingPhysical;
        check(current.isFile() && !current.isSymbolicLink() && current.nlink <= 2n && same(physical(current), expectedPhysical),
        'BACKUP_TARGET_CHANGED', 'Failed staging custody changed and cannot be removed.');
        await unlink(staging);
      } catch (failure: any) { if (failure.code !== 'ENOENT') throw new ChausarError('BACKUP_RESTORE_CLEANUP_REQUIRED', 'Failed staging has unresolved exact physical custody; root inspection is required.'); }
      this.#scope.getStore()!.staging.delete(staging);
      if (published) {
        try { const actual = await readRegular(join(path, INERT), `target/${input.target.targetId}/${INERT}`, this.#containerLimit());
          check(actual.bytes.equals(Buffer.from(text)), 'BACKUP_TARGET_CHANGED', 'Failed inert publication changed and cannot be removed.');
          await unlink(join(path, INERT)); await syncDirectory(path);
        } catch { throw new ChausarError('BACKUP_RESTORE_CLEANUP_REQUIRED', 'Failed publication retains unresolved inert custody; root inspection is required.'); }
      }
      throw error;
    }
  }
  async #readRestoredUnlocked(context: Context, input: { targetId: string; creationId: string }) {
    const actual = await this.#reservation(context, input.targetId);
    check(actual.reservation.state === 'restored' && actual.reservation.creationId === input.creationId
      && same((await readdir(actual.path)).sort(), [INERT]), 'BACKUP_TARGET_CHANGED', 'Only the exact inert, unadmitted target issuance may be read.');
    const file = await readRegular(join(actual.path, INERT), `target/${input.targetId}/${INERT}`, this.#containerLimit());
    check(file.witness.sha256 === actual.reservation.containerSha256, 'BACKUP_TARGET_CHANGED', 'The exact inert container changed.');
    const value = JSON.parse(file.bytes.toString('utf8'));
    check(value?.format === 'chausar.backup-inert-container.v2' && Object.keys(value).sort().join(',') === 'content,format,receipt'
      && value.receipt?.creationId === input.creationId && value.receipt.targetId === input.targetId && value.receipt.archiveDigest === actual.reservation.archiveDigest
      && value.receipt.inert === true && value.receipt.activation === 'root-only', 'BACKUP_PARTIAL_RESTORE', 'Inert readback must bind exact receipt identity and archive digest.');
    const checked = validateWorkspaceBackupV2Capture(value.content, value.receipt.sourcePin, this.#options.budgets);
    check(checked.archive.digest === value.receipt.archiveDigest, 'BACKUP_PARTIAL_RESTORE', 'Complete inert archive digest differs from receipt.');
    const historical = await this.#options.vault.authenticateEncryptedCustody(checked.capture, this.#vaultBudget()); await this.#guard(context, historical);
    return { content: value.content as string, receipt: value.receipt as WorkspaceBackupV2RestoreReceipt, actual };
  }
  async #readRestored(context: Context, input: { targetId: string; creationId: string }) {
    const work = async () => { const value = await this.#readRestoredUnlocked(context, input); return { content: value.content, receipt: structuredClone(value.receipt) }; };
    if (this.#target.getStore()) return work();
    return this.#snapshot(context, () => this.#locked('targets', this.targetPath(input.targetId), work));
  }
  async #rollback(context: Context, input: { targetId: string; creationId: string; expectedArchiveDigest: string }) {
    await this.#snapshot(context, () => this.#locked('targets', this.targetPath(input.targetId), async () => {
      const value = await this.#readRestoredUnlocked(context, input);
      check(value.receipt.archiveDigest === input.expectedArchiveDigest, 'BACKUP_TARGET_CHANGED', 'Rollback must compare the exact original inert archive digest.');
      const reservation: Reservation = { ...value.actual.reservation, state: 'rolled-back' };
      await this.#write(value.actual.ref.id, reservation, value.actual.ref.valueDigest);
      const current = await readRegular(join(value.actual.path, INERT), `target/${input.targetId}/${INERT}`, this.#containerLimit());
      check(current.witness.sha256 === value.actual.reservation.containerSha256
        && same(physical(await lstat(value.actual.path, { bigint: true })), value.actual.reservation.physical)
        && same((await readdir(value.actual.path)).sort(), [INERT]), 'BACKUP_TARGET_CHANGED', 'Only the exact still inert unadmitted publication may be removed.');
      let failure: unknown;
      try { await unlink(join(value.actual.path, INERT)); } catch (error) { failure = error; }
      if ((await readdir(value.actual.path)).includes(INERT)) { if (failure) throw failure; throw new ChausarError('BACKUP_RESTORE_CLEANUP_REQUIRED', 'Exact inert publication removal did not complete.'); }
      await syncDirectory(value.actual.path);
      check((await readdir(value.actual.path)).length === 0, 'BACKUP_RESTORE_CLEANUP_REQUIRED', 'Exact inert rollback left unexpected target entries.');
    }));
  }
}

export function createWorkspaceBackupV2LocalPorts(options: WorkspaceBackupV2LocalOptions) {
  return new WorkspaceBackupV2LocalCustody(options);
}
