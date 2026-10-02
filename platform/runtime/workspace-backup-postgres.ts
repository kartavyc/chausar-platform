import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rmdir, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { authorize, check, ChausarError, type Context, type State } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { mapCustodyFiles } from './custody-file-reads.ts';
import { assertSourceAccess } from './trust.ts';
import { safeDirectory, Vault, type PrivateArtifactRef, type VaultEncryptedCustodyCapture } from './vault.ts';
import { WorkspaceActivationStagingInventory, preflightWorkspaceActivationStaging,
  type WorkspaceActivationStagingInventoryLease } from './workspace-activation-staging-inventory.ts';
import type { PostgresSnapshotAdapter, PostgresSnapshotLease } from './postgres.ts';
import type { WorkspacePostgresCustody, PostgresStorageIdentity, PostgresAuthorityIdentity } from './workspace-postgres-custody.ts';
import {
  captureWorkspaceBackupV2, encodeWorkspaceBackupV2, inspectWorkspaceBackupV2, validateWorkspaceBackupV2, validateWorkspaceBackupV2Capture, workspaceBackupV2Bytes,
  type WorkspaceBackupV2Archive, type WorkspaceBackupV2Budgets, type WorkspaceBackupV2Capture,
  type WorkspaceBackupV2CustodyRecord, type WorkspaceBackupV2EmptyTarget, type WorkspaceBackupV2ExternalKeyRequirement,
  type WorkspaceBackupV2HostPorts, type WorkspaceBackupV2Measurement, type WorkspaceBackupV2Namespace,
  type WorkspaceBackupV2RestoreReceipt, type WorkspaceBackupV2Source, type WorkspaceBackupV2SourcePin,
} from './workspace-backup-v2.ts';

const CONTROL = '.workspace-backup-control';
const ACTIVATION_CONTROL = '.workspace-activation-control';
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
type DiagnosticFile = Omit<Witness, 'path'>;
type DiagnosticSqlCatalog = { schema: string; oid: string; owner: string } |
  { schema: string; name: string; kind: string; oid: string; entries: number; bytes: number; generation: string };
type File = { bytes: Buffer; witness: Witness };
type SqlRelationIdentity = { schema: string; name: string; kind: string; oid: string };
type Scope = { freezeSql: boolean; sqlRelations?: SqlRelationIdentity[]; native: PostgresSnapshotLease; storage: PostgresStorageIdentity; authority: PostgresAuthorityIdentity; context: Context; locks: Map<string, Witness>; staging: Map<string, Witness>; targets: Set<string>; changes: Map<string, { ref: PrivateArtifactRef; sha256: string } | null> };
type Binding = {
  format: 'chausar.backup-postgres-binding.v2'; recordId: string; creationId: string; contextDigest: string;
  archiveDigest: string; pinDigest: string; state: 'preparing' | 'committed' | 'discarded';
  archive: PrivateArtifactRef | null; pin: PrivateArtifactRef | null;
};
type Reservation = {
  format: 'chausar.backup-postgres-target.v2'; targetId: string; locationId: string; generation: string;
  vaultId: string; workspaceId: string; contextDigest: string; physical: Physical;
  state: 'empty' | 'restored' | 'rolled-back'; creationId: string | null; archiveDigest: string | null;
  containerSha256: string | null; containerPhysical: Physical | null;
};
type TargetScope = { context: Context; reservation: Reservation; ref: PrivateArtifactRef; target: WorkspaceBackupV2EmptyTarget };
type Inventory = { postgres: { storage: PostgresStorageIdentity; authority: PostgresAuthorityIdentity; catalog: unknown[] }; physical: Physical; directories: { path: string; physical: Physical }[]; files: Witness[]; namespaces: WorkspaceBackupV2Namespace[] };
type Captured = { capture: WorkspaceBackupV2Capture; state: State; inventory: Inventory };
export type WorkspaceBackupV2FilesystemBudgets = { maxFiles: number; maxBytes: number; maxDepth: number };
export type WorkspaceBackupV2PostgresOptions = {
  vault: Vault;
  /** The exact adapter installed in this Vault; its transaction-bound lease is retained throughout custody. */
  adapter: PostgresSnapshotAdapter;
  postgres: WorkspacePostgresCustody;
  /** Root capability: one canonical application directory, never an IPC path. */
  applicationDirectory: string;
  budgets: WorkspaceBackupV2Budgets;
  filesystemBudgets: WorkspaceBackupV2FilesystemBudgets;
  /** Explicit root-reviewed dependencies. Credential wrappers do not register an OS keychain. */
  externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
  /** Root authorization to independently hash and measure named siblings without decrypting or admitting them. */
  outsideApplicationNamespaces?: { name: string; requirement: string }[];
  /** Exact constructor-issued activation journal/claim/manifest custody. Never an RPC namespace exemption. */
  activationStaging?: WorkspaceActivationStagingInventory;
  /** Constructor-only opt-in for separately scoped source/journal/target databases.
   * Retain ordinary source relation SHARE locks before callback or measurement.
   * This excludes their writers/DDL/main-table maintenance, not independent TOAST
   * maintenance. Every existing physical-size and logical-generation fence remains. */
  heldSourceSqlExclusion?: 'share-relations';
  /** CURRENT owner, source permissions, epoch admission and all managed consumer readiness. */
  assertCompleteOwner(context: Context, historicalState: State): Promise<void>;
  /** Held root owner/epoch/readiness admission through FS publication; no deferred approval. */
  withCompleteOwner<T>(context: Context, historicalState: State, work: (assertCurrent: () => void) => Promise<T>): Promise<T>;
};
export type WorkspaceBackupV2PostgresDiagnostics = {
  qualification: 'encrypted-local-host'; fullWorkspacePortable: false; source: WorkspaceBackupV2Source;
  namespaces: WorkspaceBackupV2Namespace[]; externalKeyRequirements: WorkspaceBackupV2ExternalKeyRequirement[];
  storageKind: 'postgres'; authorityKind: 'adapter-issued-envelope';
  storage: PostgresStorageIdentity; authority: PostgresAuthorityIdentity; sqlCatalog: DiagnosticSqlCatalog[];
  physicalFiles: DiagnosticFile[]; measuredCaptureMs: number;
};
export type WorkspaceBackupV2PostgresMeasurement = {
  recordId: string; state: Binding['state']; archiveCiphertextBytes: number; pinCiphertextBytes: number;
  bindingCiphertextBytes: number; totalRetainedCiphertextBytes: number; removedCiphertextBytes: number; measuredMs: number;
};

function diagnosticFile({ dev, ino, birthtimeNs, bytes, mtimeNs, ctimeNs, sha256 }: Witness): DiagnosticFile {
  return { dev, ino, birthtimeNs, bytes, mtimeNs, ctimeNs, sha256 };
}
function diagnosticSqlCatalog(catalog: unknown[]): DiagnosticSqlCatalog[] {
  return catalog.map(value => {
    // The independently measured internal catalogue retains every full witness.
    // Diagnostics allow only identifiers, measurements and row fingerprints.
    const row = value as DiagnosticSqlCatalog;
    if ('name' in row) {
      const { schema, name, kind, oid, entries, bytes, generation } = row;
      return { schema, name, kind, oid, entries, bytes, generation };
    }
    const { schema, oid, owner } = row;
    return { schema, oid, owner };
  });
}

function physical(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Physical {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function physicalValue(value: any): value is Physical {
  return value && Object.keys(value).sort().join(',') === 'birthtimeNs,dev,ino'
    && Object.values(value).every(item => typeof item === 'string' && /^\d{1,30}$/.test(item));
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
async function readRegular(path: string, logical: string, maximum: number,
  issued?: Pick<Witness, 'dev' | 'ino' | 'birthtimeNs' | 'bytes' | 'sha256'>): Promise<File> {
  await safeDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'BACKUP_UNSAFE_FILE', 'Custody requires regular files without symbolic or hard links.');
  check(!issued || same(physical(before), { dev: issued.dev, ino: issued.ino, birthtimeNs: issued.birthtimeNs }) && before.size === BigInt(issued.bytes),
    'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'An issued activation file must retain its exact physical identity and size before opening.');
  check(before.size <= BigInt(maximum), 'BACKUP_LIMIT', 'A physical file exceeds the explicit remaining filesystem budget.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await file.stat({ bigint: true });
    check(same(physical(opened), physical(before)) && opened.size === before.size, 'BACKUP_FILE_CHANGED', 'A physical file changed before capture.');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(1024 * 1024, maximum + 1 - size));
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

/** PostgreSQL source and encrypted filesystem ciphertext custody. No historical authority is mounted or admitted. */
export class WorkspaceBackupV2PostgresCustody {
  readonly ports: WorkspaceBackupV2HostPorts;
  readonly #options: WorkspaceBackupV2PostgresOptions;
  readonly #scope = new AsyncLocalStorage<Scope>();
  readonly #target = new AsyncLocalStorage<TargetScope>();
  #diagnostics: WorkspaceBackupV2PostgresDiagnostics | null = null;
  #measurements = new Map<string, WorkspaceBackupV2PostgresMeasurement>();

  constructor(options: WorkspaceBackupV2PostgresOptions) {
    check(options?.vault instanceof Vault && options.vault.storageKind === 'postgres'
      && typeof options.adapter?.withLease === 'function' && typeof options.postgres?.storageIdentity === 'function'
      && typeof options.assertCompleteOwner === 'function' && typeof options.withCompleteOwner === 'function'
      && typeof options.applicationDirectory === 'string' && isAbsolute(options.applicationDirectory),
    'BACKUP_POSTGRES_REQUIRED', 'PostgreSQL custody requires the installed adapter, storage identity, canonical application directory and held complete-owner admission.');
    const applicationDirectory = resolve(options.applicationDirectory), child = relative(applicationDirectory, options.vault.directory);
    check(child && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`) && !child.includes(sep),
      'BACKUP_SOURCE_SCOPE', 'Use one direct managed source workspace below the application directory.');
    const budget = options.filesystemBudgets;
    check(budget && Object.keys(budget).sort().join(',') === 'maxBytes,maxDepth,maxFiles'
      && Object.values(budget).every(item => Number.isSafeInteger(item) && item > 0) && budget.maxDepth <= 64 && budget.maxFiles <= 8192
      && Array.isArray(options.externalKeyRequirements), 'BACKUP_BUDGET_REQUIRED', 'Supply explicit filesystem file, byte and depth budgets and external key requirements.');
    // Validate the public codec's explicit operation budgets without generating an archive.
    check(options.budgets && Object.keys(options.budgets).sort().join(',') === 'maxArchiveUtf8Bytes,maxEntries,maxEntryBytes,maxJsonDepth,maxJsonNodes,maxTotalEntryBytes'
      && Object.values(options.budgets).every(item => Number.isSafeInteger(item) && item > 0)
      && options.budgets.maxEntryBytes <= options.budgets.maxTotalEntryBytes && options.budgets.maxJsonDepth <= 256 && options.budgets.maxEntries > 1,
    'BACKUP_BUDGET_REQUIRED', 'Supply all six explicit archive budgets.');
    check(options.heldSourceSqlExclusion === undefined || options.heldSourceSqlExclusion === 'share-relations',
      'BACKUP_SQL_EXCLUSION_REQUIRED', 'Select only the explicit constructor ordinary-relation SHARE exclusion.');
    check(options.activationStaging === undefined || options.activationStaging instanceof WorkspaceActivationStagingInventory,
      'BACKUP_ACTIVATION_SCOPE', 'Activation staging requires the exact authenticated constructor custody capability.');
    options.activationStaging?.assertBinding(options.vault, applicationDirectory);
    this.#options = { ...options, applicationDirectory, budgets: structuredClone(options.budgets), filesystemBudgets: structuredClone(budget),
      externalKeyRequirements: structuredClone(options.externalKeyRequirements), outsideApplicationNamespaces: structuredClone(options.outsideApplicationNamespaces ?? []) };
    const outside = this.#options.outsideApplicationNamespaces!;
    check(outside.every(item => item && Object.keys(item).sort().join(',') === 'name,requirement' && /^[A-Za-z0-9_.-]+$/.test(item.name)
      && ![...widerApplication, ACTIVATION_CONTROL, '.', '..', child].includes(item.name)
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

  /** Constructor-only composition: acquire the real native source lease and Vault snapshot before any
   * archive/target lock. Readers supplied below stay under that same exclusion. */
  withHeldSource<T>(context: Context, work: () => Promise<T>): Promise<T> {
    return this.#snapshot(context, async () => { await this.#guard(context, this.#options.vault.read()); return work(); });
  }
  /** Trusted composition only: measure the complete current profile under source/journal exclusion.
   * Optional fresh installed-Vault custody is authenticated against every current private file.
   * This constructor-only input never exempts a namespace or persists across calls. */
  async inspectHeldNamespaces(capture?: VaultEncryptedCustodyCapture): Promise<Inventory> {
    const scope = this.#scope.getStore(); check(scope, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Hold actual source custody before complete namespace inspection.');
    await this.#guard(scope.context, this.#options.vault.read()); const inventory = await this.#inventory(capture);
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
    check(typeof targetId === 'string' && slotPattern.test(targetId) && ![...widerWorkspace, ...widerApplication, 'private-artifacts'].includes(targetId),
      'BACKUP_TARGET_IDENTITY', 'Use one distinct short root-managed target slot.');
    const path = join(this.#options.applicationDirectory, targetId);
    check(resolve(path) !== resolve(this.#options.vault.directory),
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
    const scope = this.#scope.getStore();
    check(scope?.native.active, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Hold the native PostgreSQL source lease through every custody operation.');
    await scope.native.assertCurrent(scope.authority);
    check(same(await this.#options.postgres.storageIdentity(), scope.storage), 'BACKUP_SOURCE_CHANGED', 'The PostgreSQL storage incarnation changed.');
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
    for (const purpose of purposes) await safeDirectory(join(this.#options.vault.directory, 'private-artifacts', purpose), true);
  }
  async #snapshot<T>(context: Context, work: () => Promise<T>): Promise<T> {
    const scope = this.#scope.getStore();
    if (scope) { check(same(scope.context, context), 'BACKUP_SOURCE_SCOPE', 'Nested custody must retain the preparing owner context.'); return work(); }
    return this.#options.vault.snapshot(() => this.#options.adapter.withLease(async native => {
      const storage = await this.#options.postgres.storageIdentity();
      check(native.active && native.slot === storage.slot, 'BACKUP_SOURCE_CHANGED', 'Use the exact installed source storage slot.');
      const authority = await native.authority();
      check(authority && authority.vaultId === this.#options.vault.vaultId && authority.revision === this.#options.vault.read().revision,
        'BACKUP_SOURCE_CHANGED', 'The installed SQL authority differs from the unlocked source Vault.');
      await this.#prepareControls();
      const held: Scope = { freezeSql: this.#options.heldSourceSqlExclusion === 'share-relations', native, storage, authority, context: structuredClone(context), locks: new Map(), staging: new Map(), targets: new Set(), changes: new Map() };
      return this.#scope.run(held, async () => {
        if (held.freezeSql) { await this.#guard(context, this.#options.vault.read()); await this.#excludeSqlRelations(held); }
        const result = await work();
        if (held.freezeSql) { await this.#guard(context, this.#options.vault.read()); await this.#excludeSqlRelations(held); }
        await native.assertCurrent(authority); return result;
      });
    }));
  }
  async #locked<T>(section: 'records' | 'targets', key: string, work: () => Promise<T>) {
    const scope = this.#scope.getStore(); check(scope, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Acquire the Vault authority queue before record or target exclusion.');
    const path = join(this.#options.applicationDirectory, CONTROL, section, `${sha(key)}.lock`);
    const lock = await acquireProcessLock(path, { busyCode: 'BACKUP_BUSY', changedCode: 'BACKUP_LOCK_CHANGED' });
    const witness = (await readRegular(path, `application/workspace-backup-control/${section}/${sha(key)}.lock`, this.#options.filesystemBudgets.maxBytes)).witness;
    scope.locks.set(path, witness);
    try { return await work(); } finally { scope.locks.delete(path); await lock.release(); }
  }
  async #excludeSqlRelations(scope: Scope) {
    check(scope.native.active, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Retain the actual source transaction through relation exclusion.');
    await scope.native.query("SET LOCAL statement_timeout = '5000ms'");
    await scope.native.query("SET LOCAL lock_timeout = '5000ms'");
    const discover = async (): Promise<SqlRelationIdentity[]> => {
      // Discovery contains identity only: physical size, schema definitions,
      // counts and row generations are measured after every SHARE lock is held.
      const rows = (await scope.native.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.oid::text AS oid
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND c.relkind NOT IN ('i','I','t')
        ORDER BY n.nspname,c.relname`)).rows;
      check(rows.length <= this.#options.budgets.maxEntries, 'BACKUP_LIMIT', 'Source relation discovery exceeds its explicit inventory budget.');
      const relations = rows.map(row => {
        check(typeof row.schema === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(row.schema)
          && typeof row.name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(row.name)
          && ['r', 'p'].includes(row.kind) && typeof row.oid === 'string' && /^\d+$/.test(row.oid),
        'BACKUP_SQL_INVENTORY_REQUIRED', 'Source exclusion requires actual classified ordinary relation identities.');
        return { schema: row.schema, name: row.name, kind: row.kind, oid: row.oid };
      });
      check(new Set(relations.map(row => `${row.schema}.${row.name}`)).size === relations.length
        && new Set(relations.map(row => row.oid)).size === relations.length,
      'BACKUP_SQL_INVENTORY_REQUIRED', 'Source relation identity discovery must be complete and unambiguous.');
      return relations;
    };
    const discovered = await discover();
    if (scope.sqlRelations) {
      check(same(discovered, scope.sqlRelations), 'BACKUP_SOURCE_CHANGED', 'The exact excluded source relation set changed.'); return;
    }
    for (const row of discovered) await scope.native.query(`LOCK TABLE "${row.schema}"."${row.name}" IN SHARE MODE`);
    // Names can be replaced between discovery and lock acquisition. Never bind
    // measurements to the pre-lock identity without an independent reread.
    check(same(await discover(), discovered), 'BACKUP_SOURCE_CHANGED', 'Source relation identity changed while acquiring SHARE exclusion.');
    scope.sqlRelations = discovered;
  }
  async #sqlInventory() {
    const scope = this.#scope.getStore();
    check(scope?.native.active, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Enumerate actual SQL namespaces through the held native transaction.');
    await scope.native.assertCurrent(scope.authority);
    await scope.native.query("SET LOCAL statement_timeout = '5000ms'");
    await scope.native.query("SET LOCAL lock_timeout = '5000ms'");
    await scope.native.query('SET LOCAL row_security = off');
    if (scope.freezeSql) await this.#excludeSqlRelations(scope);
    const schemas = (await scope.native.query("SELECT nspname AS schema,oid::text AS oid,nspowner::text AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname !~ '^pg_' ORDER BY nspname")).rows;
    const relations = (await scope.native.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
      c.oid::text AS oid, pg_total_relation_size(c.oid)::text AS bytes,
      (SELECT jsonb_agg(jsonb_build_array(a.attname, a.atttypid, a.atttypmod, a.attnotnull) ORDER BY a.attnum)
       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)::text AS columns,
      jsonb_build_object('owner',c.relowner,'acl',c.relacl,'options',c.reloptions,'tablespace',c.reltablespace,
       'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
       'defaults',(SELECT jsonb_agg(jsonb_build_array(a.adnum,pg_get_expr(a.adbin,a.adrelid)) ORDER BY a.adnum) FROM pg_attrdef a WHERE a.adrelid=c.oid),
       'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
       'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
       'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid))::text AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND c.relkind NOT IN ('i','I','t')
      ORDER BY n.nspname,c.relname`)).rows;
    const routines = (await scope.native.query(`SELECT n.nspname AS schema,p.proname AS name,p.oid::text AS oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname,p.proname,p.oid`)).rows;
    check(routines.length === 0, 'BACKUP_SQL_INVENTORY_REQUIRED', 'User-defined SQL routines require a separately reviewed complete namespace recovery profile.');
    const objects = (await scope.native.query(`SELECT 'type' AS kind,t.oid::text AS oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND t.typrelid=0 AND t.typelem=0
      UNION ALL SELECT 'collation',c.oid::text FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      UNION ALL SELECT 'trigger',t.oid::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      UNION ALL SELECT 'foreign-server',oid::text FROM pg_foreign_server
      UNION ALL SELECT 'large-object',oid::text FROM pg_largeobject_metadata
      UNION ALL SELECT 'extension',oid::text FROM pg_extension WHERE extname <> 'plpgsql'`)).rows;
    check(objects.length === 0, 'BACKUP_SQL_INVENTORY_REQUIRED', 'SQL types, collations, triggers, foreign custody, large objects and extensions require explicit separate recovery.');
    check(schemas.length + relations.length <= this.#options.budgets.maxEntries, 'BACKUP_LIMIT', 'Actual SQL namespace enumeration exceeds its explicit inventory budget.');
    const portableName = (name: unknown): name is string => typeof name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(name);
    const namespaces: WorkspaceBackupV2Namespace[] = [], catalog: unknown[] = [];
    let total = 0, totalRows = 0;
    for (const schema of schemas) {
      check(portableName(schema.schema), 'BACKUP_SQL_INVENTORY_REQUIRED', 'An actual SQL schema has an unreviewed portable namespace identity.');
      if (!relations.some(row => row.schema === schema.schema)) namespaces.push({ namespace: `database/${schema.schema}`, disposition: 'empty', entries: 0, bytes: 0, requirement: '' });
      catalog.push({ schema: schema.schema, oid: schema.oid, owner: schema.owner, acl: schema.acl });
    }
    for (const row of relations) {
      check(portableName(row.schema) && portableName(row.name) && ['r','p'].includes(row.kind) && /^\d+$/.test(row.oid),
        'BACKUP_SQL_INVENTORY_REQUIRED', 'Views, materialized views, sequences, foreign tables or unclassified SQL objects require separate explicit recovery and exclusion.');
      check(typeof row.definition === 'string', 'BACKUP_SQL_INVENTORY_REQUIRED', 'Every SQL relation requires independently enumerated schema, index, policy and permission definitions.');
      const bytes = Number(row.bytes);
      check(Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(total + bytes), 'BACKUP_LIMIT', 'SQL physical namespace measurements require safe exact byte counts.');
      total += bytes;
      check(total <= this.#options.filesystemBudgets.maxBytes, 'BACKUP_LIMIT', 'Wider SQL namespace bytes exceed the explicit inspection byte budget.');
      const quoted = `"${row.schema}"."${row.name}"`;
      // Selected ordinary relation SHARE locks precede the complete catalogue
      // projection above and remain held through callback and final assertions.
      // Independent TOAST maintenance is not a claimed exclusion capability.
      const count = (await scope.native.query(`SELECT COUNT(*)::text AS entries FROM ${quoted}`)).rows[0];
      const entries = Number(count?.entries);
      totalRows += entries;
      check(Number.isSafeInteger(entries) && entries >= 0 && Number.isSafeInteger(totalRows) && totalRows <= this.#options.filesystemBudgets.maxFiles,
        'BACKUP_LIMIT', 'SQL row enumeration exceeds the explicit bounded inspection record budget.');
      const generation = (await scope.native.query(`SELECT encode(sha256(convert_to(COALESCE(string_agg(row_digest, '' ORDER BY row_digest), ''), 'UTF8')), 'hex') AS generation
        FROM (SELECT encode(sha256(convert_to(row_to_json(t)::text, 'UTF8')), 'hex') AS row_digest FROM ${quoted} t) fingerprints`)).rows[0]?.generation;
      check(typeof generation === 'string' && /^[a-f0-9]{64}$/.test(generation), 'BACKUP_SQL_INVENTORY_REQUIRED', 'Every inspected SQL table requires a complete deterministic SHA-256 row fingerprint.');
      catalog.push({ schema: row.schema, name: row.name, kind: row.kind, oid: row.oid, columns: row.columns, definition: row.definition, entries, bytes, generation });
      namespaces.push({ namespace: `database/${row.schema}/${row.name}`, disposition: entries || bytes ? 'outside-archive' : 'empty', entries, bytes,
        requirement: entries || bytes ? 'This measured SQL table is outside the State archive. Only the leased source authority envelope is included; other slots, storage/custody control rows and enterprise tables require separate recovery.' : '' });
    }
    await scope.native.assertCurrent(scope.authority);
    return { postgres: { storage: structuredClone(scope.storage), authority: structuredClone(scope.authority), catalog }, namespaces };
  }
  async #inventory(capture?: VaultEncryptedCustodyCapture): Promise<Inventory> {
    const raw = capture ? structuredClone(capture) : undefined;
    if (raw) {
      const vault = this.#options.vault, scope = this.#scope.getStore();
      check(scope?.native.active && raw.storageKind === 'postgres' && raw.authorityKind === 'adapter-issued-envelope'
        && raw.vaultId === vault.vaultId && same(raw.state, vault.read())
        && scope.authority.vaultId === raw.vaultId && scope.authority.revision === raw.state.revision
        && raw.authority instanceof Uint8Array && scope.authority.envelopeDigest === sha(raw.authority),
      'BACKUP_SOURCE_CHANGED', 'Fresh captured custody must equal the current installed Vault and held native authority.');
      const authenticated = await vault.authenticateEncryptedCustody({ authority: raw.authority, artifacts: raw.artifacts,
        source: { vaultId: raw.vaultId, workspaceId: raw.state.workspace.id, revision: raw.state.revision } }, this.#vaultBudget(true));
      check(same(authenticated, raw.state), 'BACKUP_SOURCE_CHANGED', 'Captured State must equal its independently authenticated encrypted authority.');
      check(raw.artifacts.filter(item => item.ref.purpose === 'workspace-interchange').length <= 4096,
        'ARTIFACT_LIMIT', 'Managed interchange inventory retains its existing 4096-entry bound.');
    }
    const staging = this.#options.activationStaging;
    return staging ? staging.withInventory(lease => this.#inventoryHeld(lease, raw)) : this.#inventoryHeld(undefined, raw);
  }
  async #inventoryHeld(stagingLease?: WorkspaceActivationStagingInventoryLease, capture?: VaultEncryptedCustodyCapture): Promise<Inventory> {
    const b = this.#options.filesystemBudgets, vault = this.#options.vault;
    const source = await safeDirectory(vault.directory), rootStat = await lstat(source, { bigint: true });
    const files: Witness[] = [], directories: Inventory['directories'] = [], namespaces: WorkspaceBackupV2Namespace[] = [];
    let totalBytes = 0, entries = 0;
    const measured = new Map<string, Witness>();
    let stagingLayout: Awaited<ReturnType<typeof preflightWorkspaceActivationStaging>> | undefined;
    const stagingControlled = (path: string) => stagingLayout?.controlledRoots.some(root => path === root || path.startsWith(`${root}${sep}`));
    const retainBatch = async (paths: { path: string; logical: string }[]) => {
      const planned: { path: string; logical: string; size: number }[] = []; let reserved = totalBytes;
      for (const { path, logical } of paths) {
        check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Physical enumeration exceeds its explicit entry count budget.');
        check(!stagingControlled(path) || stagingLayout!.expectedFiles.has(path),
          'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An activation file must have an exact authenticated manifest identity before opening.');
        const stat = await lstat(path, { bigint: true });
        check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n,
          'BACKUP_UNSAFE_FILE', 'Custody requires regular files without symbolic or hard links.');
        const issued = stagingLayout?.expectedFiles.get(path);
        check(!issued || same(physical(stat), { dev: issued.dev, ino: issued.ino, birthtimeNs: issued.birthtimeNs }) && stat.size === BigInt(issued.bytes),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'An issued activation file must retain its exact physical identity and size before opening.');
        check(stat.size >= 0n && stat.size <= BigInt(b.maxBytes - reserved), 'BACKUP_LIMIT', 'Files exceed their complete reserved filesystem budget.');
        const size = Number(stat.size); reserved += size;
        planned.push({ path, logical, size });
      }
      const witnesses = await mapCustodyFiles(planned, async item => {
        const found = await readRegular(item.path, item.logical, item.size, stagingLayout?.expectedFiles.get(item.path));
        check(found.witness.bytes === item.size, 'BACKUP_FILE_CHANGED', 'A physical file changed after complete budget preflight.');
        return found.witness;
      });
      for (let index = 0; index < planned.length; index++) {
        const { path } = planned[index], witness = witnesses[index]; totalBytes += witness.bytes;
        measured.set(path, witness);
        if (!this.#scope.getStore()?.locks.has(path) && !this.#scope.getStore()?.staging.has(path)) files.push(witness);
      }
      return witnesses;
    };
    const retain = async (path: string, logical: string) => (await retainBatch([{ path, logical }]))[0];
    const walk = async (path: string, logical: string, depth: number): Promise<{entries: number; bytes: number}> => {
      check(depth <= b.maxDepth && ++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Physical directory enumeration exceeds its explicit depth/count budget.');
      await safeDirectory(path); const currentPhysical = physical(await lstat(path, { bigint: true }));
      check(!stagingControlled(path) || stagingLayout!.directories.some(item => item.path === path && same(item.physical, currentPhysical)),
        'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An activation directory must have an exact authenticated manifest identity.');
      directories.push({ path: logical, physical: currentPhysical });
      let count = 0, bytes = 0;
      const children = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      check(new Set(children.map(entry => entry.name.toLowerCase())).size === children.length, 'BACKUP_INVENTORY_INCOMPLETE', 'Filesystem case aliases require separate review.');
      let pending: { path: string; logical: string }[] = [];
      const flush = async () => {
        const found = await retainBatch(pending); pending = [];
        count += found.length; bytes += found.reduce((sum, item) => sum + item.bytes, 0);
      };
      for (const entry of children) {
        const name = entry.name;
        check(/^[A-Za-z0-9_.-]+$/.test(name) && !['.','..'].includes(name) && !name.endsWith('.'), 'BACKUP_INVENTORY_INCOMPLETE', 'An actual filesystem entry has an unreviewed portable identity.');
        const child = join(path, name);
        check(!entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()), 'BACKUP_UNSAFE_FILE', 'Complete inventory requires regular files and safe directories.');
        if (entry.isDirectory()) { await flush(); const found = await walk(child, `${logical}/${name}`, depth + 1); count += found.entries; bytes += found.bytes; }
        else {
          check(entries + pending.length + 1 <= b.maxFiles, 'BACKUP_LIMIT', 'Sibling file preflight exceeds its remaining entry count budget.');
          pending.push({ path: child, logical: `${logical}/${name}` });
        }
      }
      await flush();
      return { entries: count, bytes };
    };
    await safeDirectory(this.#options.applicationDirectory);
    directories.push({ path: 'application', physical: physical(await lstat(this.#options.applicationDirectory, { bigint: true })) });
    for (const name of await readdir(source)) check(['writer.lock','private-artifacts',...widerWorkspace].includes(name),
      'BACKUP_INVENTORY_INCOMPLETE', 'An unclassified source namespace or file authority prevents PostgreSQL custody.');
    const writer = await retain(join(source, 'writer.lock'), 'workspace/writer.lock');
    namespaces.push({ namespace: 'workspace/writer.lock', disposition: 'transient', entries: 1, bytes: writer.bytes,
      requirement: 'Reacquire current process and epoch ownership; historical writer locks are never restored.' });
    const privateRoot = await directoryIfPresent(join(source, 'private-artifacts'));
    if (privateRoot) for (const purpose of await readdir(privateRoot)) check(purposes.includes(purpose as typeof purposes[number]),
      'BACKUP_INVENTORY_INCOMPLETE', 'Every actual private namespace must be typed and authenticated.');
    for (const purpose of purposes) {
      const directory = await directoryIfPresent(join(source, 'private-artifacts', purpose)); if (!directory) continue;
      directories.push({ path: `private-artifacts/${purpose}`, physical: physical(await lstat(directory, { bigint: true })) });
      const names = (await readdir(directory)).sort();
      check(names.every(name => /^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)),
        'BACKUP_INVENTORY_INCOMPLETE', 'An unclassified private entry prevents complete encrypted custody.');
      await retainBatch(names.map(name => ({ path: join(directory, name), logical: `private-artifacts/${purpose}/${name}` })));
    }
    // Archived authentication permits removed files. Prove the complete current
    // physical set before captured reservations can authorize any sibling.
    if (capture) {
      const privateFiles = files.filter(item => item.path.startsWith('private-artifacts/'));
      const privateByPath = new Map(privateFiles.map(item => [item.path, item]));
      check(privateFiles.length === capture.artifacts.length,
        'BACKUP_INVENTORY_INCOMPLETE', 'Current private files must exactly equal the complete authenticated capture.');
      const paths = new Set<string>();
      for (const item of capture.artifacts) {
        const path = `private-artifacts/${item.ref.purpose}/${item.ref.id}.encrypted.json`, found = privateByPath.get(path);
        check(!paths.has(path.toLowerCase()) && found?.bytes === item.ref.diskBytes && found.bytes === item.bytes.byteLength
          && found.sha256 === sha(item.bytes), 'BACKUP_FILE_CHANGED', 'Current private ciphertext differs from the complete authenticated capture.');
        paths.add(path.toLowerCase());
      }
    }
    for (const name of widerWorkspace) {
      const path = await directoryIfPresent(join(source, name)), found = path ? await walk(path, `workspace/${name}`, 0) : { entries: 0, bytes: 0 };
      namespaces.push({ namespace: `workspace/${name}`, disposition: found.entries ? 'outside-archive' : 'empty', ...found,
        requirement: found.entries ? 'Separately retain these measured wider workspace files before claiming complete recovery.' : '' });
    }
    const reservations = new Map<string, Reservation>();
    const selected = capture?.artifacts.filter(item => item.ref.purpose === 'workspace-interchange' && /^wbt2_[a-f0-9]{64}_reservation$/.test(item.ref.id));
    const capturedReservations = selected?.length
      ? await vault.authenticateArchivedArtifacts({ sourceVaultId: capture!.vaultId, artifacts: selected }, this.#vaultBudget(true)) : [];
    const selectedRefs = new Map(selected?.map(item => [item.ref.id, item.ref]));
    const reservationRefs = capture ? capturedReservations : await vault.listArtifacts({ purpose: 'workspace-interchange' });
    for (const ref of reservationRefs) if (/^wbt2_[a-f0-9]{64}_reservation$/.test(ref.id)) {
      const retained = capture ? ref as PrivateArtifactRef & { value: unknown } : await vault.readArtifact(ref);
      if (capture) check(same(identity(retained), selectedRefs.get(ref.id)),
        'BACKUP_FILE_CHANGED', 'Decoded reservation must retain its exact authenticated capture reference.');
      const reservation = retained.value as Reservation;
      check(reservation?.format === 'chausar.backup-postgres-target.v2' && ref.id === reservationId(reservation.targetId)
        && reservation.vaultId === vault.vaultId && reservation.workspaceId === vault.read().workspace.id && physicalValue(reservation.physical),
        'BACKUP_TARGET_CHANGED', 'Every inert sibling requires an exact source-issued physical reservation.');
      reservations.set(reservation.targetId, reservation);
    }
    const authorized = new Map(this.#options.outsideApplicationNamespaces!.map(item => [item.name, item.requirement]));
    if (stagingLease) stagingLayout = await preflightWorkspaceActivationStaging({
      applicationDirectory: this.#options.applicationDirectory, attempts: stagingLease.attempts,
      budgets: { maxFiles: b.maxFiles - entries, maxBytes: b.maxBytes - totalBytes, maxDepth: b.maxDepth },
    });
    const sourceName = relative(this.#options.applicationDirectory, source);
    for (const name of (await readdir(this.#options.applicationDirectory)).sort()) {
      if (name === sourceName || this.#scope.getStore()?.targets.has(name)) continue;
      const reserved = reservations.get(name), declared = authorized.get(name), managed = widerApplication.includes(name);
      const activation = name === ACTIVATION_CONTROL && stagingLayout !== undefined;
      check(reserved || declared || managed || activation, 'BACKUP_INVENTORY_INCOMPLETE', 'Every actual application sibling requires explicit root inventory authorization.');
      const path = await safeDirectory(join(this.#options.applicationDirectory, name));
      if (reserved) check(same(physical(await lstat(path, { bigint: true })), reserved.physical), 'BACKUP_TARGET_CHANGED', 'A reserved inert target changed its physical generation.');
      if (name.endsWith('-control') && managed) for (const section of await readdir(path)) {
        check(['records','targets'].includes(section), 'BACKUP_INVENTORY_INCOMPLETE', 'Administrative controls require reviewed sections.');
        const sectionPath = await safeDirectory(join(path, section));
        for (const entry of await readdir(sectionPath)) check(/^[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp|\.recovery-[a-f0-9]{64}\.lock(?:\.[a-f0-9-]{36}\.tmp)?)?$/.test(entry)
          || this.#scope.getStore()?.staging.has(join(sectionPath, entry)), 'BACKUP_INVENTORY_INCOMPLETE', 'Unowned staging requires exact root inspection.');
      }
      const logical = `application/${reserved ? 'targets/' : ''}${name.replace(/^\./,'')}`, found = await walk(path, logical, 0);
      namespaces.push({ namespace: logical, disposition: found.entries ? managed && name.endsWith('-control') ? 'transient' : 'outside-archive' : 'empty', ...found,
        requirement: found.entries ? activation ? 'Exact journal-issued prepared or committed staging is separately measured; prepared custody remains unresolved and never authorizes replay or live admission.'
          : declared ?? (reserved ? 'Source-reserved inert evidence is outside this archive and requires separate retained recovery.' : 'Measured application files/control metadata require separate recovery and new process ownership.') : '' });
    }
    if (stagingLayout) {
      for (const [path, expected] of stagingLayout.expectedFiles) {
        const actual = measured.get(path);
        check(actual && same({ dev: actual.dev, ino: actual.ino, birthtimeNs: actual.birthtimeNs, bytes: actual.bytes, sha256: actual.sha256 }, expected),
          'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Measured activation ciphertext must retain its exact journal-issued physical generation, size and hash.');
      }
      await stagingLayout.assertCurrent();
    }
    const sql = await this.#sqlInventory(); namespaces.push(...sql.namespaces);
    return { postgres: sql.postgres, physical: physical(rootStat), directories: directories.sort((a,b) => a.path.localeCompare(b.path)),
      files: files.sort((a,b) => a.path.localeCompare(b.path)), namespaces };
  }

  async #capture(includeOwnPublications = false): Promise<Captured> {
    const started = performance.now(), vault = this.#options.vault;
    const raw = await vault.captureEncryptedCustody(this.#vaultBudget(includeOwnPublications));
    check(raw.storageKind === 'postgres' && raw.authorityKind === 'adapter-issued-envelope' && same(raw.state, vault.read()),
      'BACKUP_POSTGRES_REQUIRED', 'PostgreSQL custody requires authenticated reconstructed adapter-issued authority.');
    const inventory = await this.#inventory(raw);
    check(inventory.postgres.authority.vaultId === raw.vaultId && inventory.postgres.authority.revision === raw.state.revision
      && inventory.postgres.authority.envelopeDigest === sha(raw.authority), 'BACKUP_SOURCE_CHANGED', 'Native leased authority differs from authenticated adapter-issued custody.');
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
    externalKeyRequirements.push({ provider: 'postgres', namespace: 'database/source-slot', requirement: canonical({
      format: 'chausar.backup-postgres-source.v1', storage: inventory.postgres.storage, authority: inventory.postgres.authority,
      recovery: 'Recreate only under distinct empty-slot admission; database namespaces outside the archive require separate recovery.' }) });
    externalKeyRequirements.sort((a, b) => `${a.provider}/${a.namespace}` < `${b.provider}/${b.namespace}` ? -1 : 1);
    const source: WorkspaceBackupV2Source = { vaultId: raw.vaultId, workspaceId: raw.state.workspace.id, revision: raw.state.revision,
      captureId: `capture_${randomUUID()}`, enumerationId: `enumeration_${sha(canonical(inventory))}` };
    const capture: WorkspaceBackupV2Capture = { source, authority: Uint8Array.from(raw.authority), artifacts, namespaces, externalKeyRequirements };
    if (!includeOwnPublications) {
      captureWorkspaceBackupV2(capture, this.#options.budgets);
      this.#diagnostics = { qualification: 'encrypted-local-host', fullWorkspacePortable: false, source, namespaces,
        externalKeyRequirements, storageKind: 'postgres', authorityKind: 'adapter-issued-envelope',
        storage: inventory.postgres.storage, authority: inventory.postgres.authority, sqlCatalog: diagnosticSqlCatalog(inventory.postgres.catalog),
        physicalFiles: inventory.files.map(diagnosticFile), measuredCaptureMs: performance.now() - started };
    }
    return { capture, state: raw.state, inventory };
  }
  async #assertCapturedCurrent(context: Context, captured: Captured) {
    await this.#guard(context, captured.state); check(same(this.#options.vault.read(), captured.state), 'BACKUP_SOURCE_CHANGED', 'Source authority changed during custody.');
    const now = await this.#capture(true), changes = this.#scope.getStore()!.changes;
    check(same(now.inventory.postgres, captured.inventory.postgres), 'BACKUP_SOURCE_CHANGED', 'The actual SQL catalog, source incarnation or wider SQL measurements changed.');
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
      this.#scope.getStore()!.freezeSql = true;
      await this.#guard(context, this.#options.vault.read()); const captured = await this.#capture();
      if (expected) {
        check(expected.source.vaultId === captured.capture.source.vaultId && expected.source.workspaceId === captured.state.workspace.id
          && expected.source.revision === captured.state.revision && expected.source.enumerationId === captured.capture.source.enumerationId,
        'BACKUP_SOURCE_CHANGED', 'Actual complete source differs from its independently retained pin and physical enumeration.');
        const actual = captureWorkspaceBackupV2({ ...captured.capture, source: structuredClone(expected.source) }, this.#options.budgets).pin;
        check(same(actual, expected), 'BACKUP_SOURCE_CHANGED', 'Actual complete source differs from its independently retained pin and physical enumeration.');
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
      this.#assertArchiveSource(archive);
      const capture = workspaceBackupV2Bytes(archive, this.#options.budgets);
      const state = await this.#options.vault.authenticateEncryptedCustody(capture, this.#vaultBudget()); await this.#guard(context, state);
    });
  }
  #assertArchiveSource(archive: WorkspaceBackupV2Archive) {
    const retained = archive.pin.externalKeyRequirements.filter(item => item.provider === 'postgres' && item.namespace === 'database/source-slot');
    check(retained.length === 1, 'BACKUP_SOURCE_CHANGED', 'Authenticate one independently retained PostgreSQL storage and slot incarnation.');
    let evidence: any;
    try { evidence = JSON.parse(retained[0].requirement); } catch { throw new ChausarError('BACKUP_SOURCE_CHANGED', 'The retained PostgreSQL source identity is incomplete.'); }
    const scope = this.#scope.getStore();
    check(scope?.native.active && evidence?.format === 'chausar.backup-postgres-source.v1'
      && same(evidence.storage, scope.storage) && same(evidence.authority, scope.authority),
      'BACKUP_SOURCE_CHANGED', 'The archived PostgreSQL authority or storage incarnation is stale.');
  }
  async #assertRestoreOwner(context: Context, source: WorkspaceBackupV2Source) {
    await this.#snapshot(context, async () => {
      const current = this.#options.vault.read();
      check(source.vaultId === this.#options.vault.vaultId && source.workspaceId === current.workspace.id && source.revision === current.revision,
        'BACKUP_SOURCE_CHANGED', 'Archive belongs to another or changed source authority.');
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
      let binding: Binding = { format: 'chausar.backup-postgres-binding.v2', recordId, creationId: record.pin.creationId, contextDigest: record.pin.contextDigest,
        archiveDigest: archive.digest, pinDigest: sha(canonical(record.pin)), state: 'preparing', archive: null, pin: null };
      let bindingRef: PrivateArtifactRef | undefined;
      try {
        await assertCurrent(); bindingRef = await this.#write(bindingId, binding, null);
        const archiveRef = await this.#write(controlId(recordId, 'archive'), { format: 'chausar.backup-postgres-archive.v2', recordId, creationId: record.pin.creationId, content: record.content }, null);
        binding = { ...binding, archive: archiveRef }; bindingRef = await this.#write(bindingId, binding, bindingRef.valueDigest);
        const pinRef = await this.#write(controlId(recordId, 'pin'), { format: 'chausar.backup-postgres-pin.v2', recordId, creationId: record.pin.creationId, pin: record.pin }, null);
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
    check(retained && binding?.format === 'chausar.backup-postgres-binding.v2' && binding.recordId === recordId && binding.state === 'committed'
      && binding.contextDigest === sha(canonical(context)) && binding.archive && binding.pin, 'BACKUP_CUSTODY_NOT_COMMITTED', 'No current committed issuance authenticates this backup for the preparing owner.');
    const archive = await this.#find(controlId(recordId, 'archive')), pin = await this.#find(controlId(recordId, 'pin'));
    check(archive && pin && same(identity(archive), binding.archive) && same(identity(pin), binding.pin), 'BACKUP_CUSTODY_CHANGED', 'Independent bound encrypted archive or pin changed.');
    const av = archive.value as any, pv = pin.value as any;
    check(av?.format === 'chausar.backup-postgres-archive.v2' && pv?.format === 'chausar.backup-postgres-pin.v2'
      && av.recordId === recordId && pv.recordId === recordId && av.creationId === binding.creationId && pv.creationId === binding.creationId
      && typeof av.content === 'string' && pv.pin && sha(canonical(pv.pin)) === binding.pinDigest && pv.pin.archiveDigest === binding.archiveDigest,
    'BACKUP_CUSTODY_CHANGED', 'Authenticated archive and independent pin differ from their durable issuance binding.');
    const checked = validateWorkspaceBackupV2(av.content, pv.pin.sourcePin, this.#options.budgets);
    check(checked.digest === binding.archiveDigest, 'BACKUP_CUSTODY_CHANGED', 'The complete archive differs from its durable issuance digest.');
    this.#assertArchiveSource(checked);
    return { record: { content: av.content, pin: structuredClone(pv.pin) } as WorkspaceBackupV2CustodyRecord,
      measurement: this.#measure(identity(archive), identity(pin)), binding, ref: identity(retained) };
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
    check(retained && reservation?.format === 'chausar.backup-postgres-target.v2' && reservation.targetId === targetId
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
      const reservation: Reservation = { format: 'chausar.backup-postgres-target.v2', targetId, locationId: `location_${randomUUID()}`, generation: `empty_${randomUUID()}`,
        vaultId: this.#options.vault.vaultId, workspaceId: this.#options.vault.read().workspace.id, contextDigest: sha(canonical(context)), physical: physical(stat),
        state: 'empty', creationId: null, archiveDigest: null, containerSha256: null, containerPhysical: null };
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
          check(file.witness.sha256 === scope.reservation.containerSha256 && physicalValue(scope.reservation.containerPhysical) && same(scope.reservation.containerPhysical,
            { dev: file.witness.dev, ino: file.witness.ino, birthtimeNs: file.witness.birthtimeNs }), 'BACKUP_TARGET_CHANGED', 'Published inert ciphertext or physical generation changed.');
        } else check(names.length === 0, 'BACKUP_TARGET_NOT_EMPTY', 'The reserved target acquired authority or unexpected entries.');
      };
      const assertEmpty = async () => { await assertCurrent(); check(scope.reservation.state === 'empty' && (await readdir(path)).length === 0,
        'BACKUP_TARGET_NOT_EMPTY', 'Actual target authority, private artifacts and all wider entries must be zero.'); };
      return this.#target.run(scope, async () => {
        try { const result = await work({ inspection: target, assertCurrent, assertEmpty }); await assertCurrent(); return result as T; }
        catch (error) {
          // Before publication, remove the exact allocated empty directory and retain the single-use reservation tombstone.
          if (error instanceof ChausarError && error.code === 'BACKUP_RESTORE_CLEANUP_REQUIRED') throw error;
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
    this.#assertArchiveSource(input.archive);
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
      const checked = validateWorkspaceBackupV2Capture(decoded.content, input.archive.pin, this.#options.budgets);
      await this.#options.vault.authenticateEncryptedCustody(checked.capture, this.#vaultBudget());
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
        archiveDigest: input.archive.digest, containerSha256: readback.witness.sha256,
        containerPhysical: {dev: readback.witness.dev, ino: readback.witness.ino, birthtimeNs: readback.witness.birthtimeNs} };
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
          check(actual.bytes.equals(Buffer.from(text)) && same({dev:actual.witness.dev,ino:actual.witness.ino,birthtimeNs:actual.witness.birthtimeNs}, stagingPhysical)
            && same(physical(await lstat(path, {bigint:true})), scope.reservation.physical) && same((await readdir(path)).sort(), [INERT]),
            'BACKUP_TARGET_CHANGED', 'Failed inert publication changed its owned physical generation and cannot be removed.');
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
    check(file.witness.sha256 === actual.reservation.containerSha256 && physicalValue(actual.reservation.containerPhysical)
      && same({dev:file.witness.dev,ino:file.witness.ino,birthtimeNs:file.witness.birthtimeNs}, actual.reservation.containerPhysical),
      'BACKUP_TARGET_CHANGED', 'The exact inert container ciphertext or owned physical generation changed.');
    const value = JSON.parse(file.bytes.toString('utf8'));
    check(value?.format === 'chausar.backup-inert-container.v2' && Object.keys(value).sort().join(',') === 'content,format,receipt'
      && value.receipt?.creationId === input.creationId && value.receipt.targetId === input.targetId && value.receipt.archiveDigest === actual.reservation.archiveDigest
      && value.receipt.inert === true && value.receipt.activation === 'root-only', 'BACKUP_PARTIAL_RESTORE', 'Inert readback must bind exact receipt identity and archive digest.');
    const { archive, capture } = validateWorkspaceBackupV2Capture(value.content, value.receipt.sourcePin, this.#options.budgets);
    check(archive.digest === value.receipt.archiveDigest, 'BACKUP_PARTIAL_RESTORE', 'Complete inert archive digest differs from receipt.');
    const expected: WorkspaceBackupV2RestoreReceipt = { targetId: input.targetId, creationId: input.creationId, archiveDigest: archive.digest,
      sourcePin: archive.pin, entries: archive.pin.artifacts.length + 1,
      bytes: archive.pin.authority.bytes + archive.pin.artifacts.reduce((sum,item) => sum + item.bytes,0), inert: true, activation: 'root-only' };
    check(same(value.receipt, expected), 'BACKUP_PARTIAL_RESTORE', 'Every inert reader requires the exact complete source pin, entry and byte receipt.');
    this.#assertArchiveSource(archive);
    const historical = await this.#options.vault.authenticateEncryptedCustody(capture, this.#vaultBudget()); await this.#guard(context, historical);
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
        && same({dev:current.witness.dev,ino:current.witness.ino,birthtimeNs:current.witness.birthtimeNs}, value.actual.reservation.containerPhysical)
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

export function createWorkspaceBackupV2PostgresPorts(options: WorkspaceBackupV2PostgresOptions) {
  return new WorkspaceBackupV2PostgresCustody(options);
}
