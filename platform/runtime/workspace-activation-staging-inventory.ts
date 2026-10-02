import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { check, hash } from './contracts.ts';
import { safeDirectory, Vault, type PrivateArtifactRef, type VaultEncryptedCustodyCapture } from './vault.ts';
import type { PostgresSnapshotAdapter } from './postgres.ts';
import type { WorkspacePostgresCustody } from './workspace-postgres-custody.ts';

const CONTROL = '.workspace-activation-control';
const BOOTSTRAP = 'activation-bootstrap.encrypted.json', EVIDENCE = 'activation-evidence.encrypted.json';
const idPattern = /^[A-Za-z0-9_-]{1,100}$/, targetPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digestPattern = /^[a-f0-9]{64}$/, attemptPattern = /^attempt_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const idValue = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value);
const digestValue = (value: unknown): value is string => typeof value === 'string' && digestPattern.test(value);
const targetValue = (value: unknown): value is string => typeof value === 'string' && targetPattern.test(value);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const digest = (value: unknown) => sha(canonical(value));
const exact = (value: any, fields: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...fields].sort());
const refIdentity = ({ id, purpose, valueDigest, diskBytes }: PrivateArtifactRef): PrivateArtifactRef => ({ id, purpose, valueDigest, diskBytes });
export type WorkspaceActivationStagingPhysical = { dev: string; ino: string; birthtimeNs: string };
export type WorkspaceActivationStagingWitness = WorkspaceActivationStagingPhysical & { bytes: number; sha256: string };
export type WorkspaceActivationStagingBudgets = { maxFiles: number; maxBytes: number; maxDepth: number };
const physical = (value: { dev: bigint; ino: bigint; birthtimeNs: bigint }): WorkspaceActivationStagingPhysical =>
  ({ dev: String(value.dev), ino: String(value.ino), birthtimeNs: String(value.birthtimeNs) });
const physicalValue = (value: any): value is WorkspaceActivationStagingPhysical => exact(value, ['dev', 'ino', 'birthtimeNs'])
  && Object.values(value).every(field => typeof field === 'string' && /^\d{1,30}$/.test(field));
function validBudgets(value: WorkspaceActivationStagingBudgets) {
  check(exact(value, ['maxFiles', 'maxBytes', 'maxDepth']) && [value.maxFiles, value.maxBytes, value.maxDepth].every(n => Number.isSafeInteger(n) && n > 0)
    && value.maxFiles <= 8192 && value.maxBytes <= 256 * 1024 * 1024 && value.maxDepth <= 16,
  'BACKUP_LIMIT', 'Use explicit bounded activation inventory budgets.');
}
const portablePart = (name: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(name) && !name.endsWith('.');
function encryptedPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 500 && (value === BOOTSTRAP || value === EVIDENCE
    || value.startsWith('live/') && value.endsWith('.encrypted.json') && value.split('/').every(portablePart));
}
function directoryPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 500 && (value === 'live' || value.startsWith('live/')) && value.split('/').every(portablePart);
}
function directChild(root: string, directory: string) {
  const name = relative(root, directory);
  return name && !isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`) && !name.includes(sep);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export type WorkspaceActivationStagingAttempt = Readonly<{
  activationId: string; phase: 'prepared' | 'committed';
  staging: { name: string; directory: string; physical: WorkspaceActivationStagingPhysical };
  target: { targetId: string; directory: string; physical: WorkspaceActivationStagingPhysical };
  directories: readonly string[];
  files: readonly { path: string; witness: WorkspaceActivationStagingWitness }[];
}>;
export type WorkspaceActivationStagingInventoryLease = Readonly<{
  attempts: readonly WorkspaceActivationStagingAttempt[];
  journalAuthorityBytes: number; journalArtifactBytes: number;
  /** Current journal/source guards, never activation readback or target admission. */
  assertCurrent(): Promise<void>;
}>;
export type WorkspaceActivationStagingInventoryOptions = {
  sourceVault: Vault; journalVault: Vault; journalAdapter: PostgresSnapshotAdapter;
  journalPostgres: WorkspacePostgresCustody; applicationDirectory: string; budgets: WorkspaceActivationStagingBudgets;
};
type SourceReservations = Map<string, { ref: PrivateArtifactRef; value: any }>;

/** Constructor-only immutable staging custody. This class neither opens staged
 * contents nor establishes SQL/local commitment, readiness or target authority. */
export class WorkspaceActivationStagingInventory {
  readonly #options: WorkspaceActivationStagingInventoryOptions;
  constructor(options: WorkspaceActivationStagingInventoryOptions) {
    check(options?.sourceVault instanceof Vault && options.sourceVault.storageKind === 'postgres'
      && options.journalVault instanceof Vault && options.journalVault.storageKind === 'postgres'
      && options.sourceVault !== options.journalVault && options.sourceVault.vaultId !== options.journalVault.vaultId
      && typeof options.journalAdapter?.withLease === 'function' && typeof options.journalPostgres?.withSource === 'function'
      && typeof options.applicationDirectory === 'string' && isAbsolute(options.applicationDirectory),
    'BACKUP_ACTIVATION_SCOPE', 'Install the actual distinct source and native journal custody capabilities.');
    validBudgets(options.budgets);
    const root = resolve(options.applicationDirectory);
    check(directChild(root, options.sourceVault.directory) && directChild(root, options.journalVault.directory),
      'BACKUP_ACTIVATION_SCOPE', 'Source and journal must be distinct direct managed application children.');
    this.#options = { ...options, applicationDirectory: root, budgets: structuredClone(options.budgets) };
  }
  assertBinding(sourceVault: Vault, applicationDirectory: string): void {
    check(sourceVault === this.#options.sourceVault && applicationDirectory === this.#options.applicationDirectory,
      'BACKUP_ACTIVATION_SCOPE', 'Staging inventory must bind this exact held source Vault and canonical application root.');
  }
  #captureBudgets() {
    const b = this.#options.budgets;
    return { maxArtifacts: Math.min(4096, b.maxFiles), maxEntryBytes: Math.min(16 * 1024 * 1024, b.maxBytes),
      maxTotalEntryBytes: Math.min(64 * 1024 * 1024, b.maxBytes) };
  }
  async #reservations() {
    const source = this.#options.sourceVault, root = this.#options.applicationDirectory;
    const directory = join(source.directory, 'private-artifacts', 'workspace-interchange');
    try { await lstat(directory); } catch (error: any) { if (error.code === 'ENOENT') return new Map() as SourceReservations; throw error; }
    check(await safeDirectory(directory) === directory, 'BACKUP_ACTIVATION_TARGET_UNBOUND', 'Source reservations require their actual managed private directory.');
    const names = (await readdir(directory)).sort();
    check(names.length <= Math.min(4096, this.#options.budgets.maxFiles)
      && new Set(names.map(name => name.toLowerCase())).size === names.length
      && names.every(name => /^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)),
    'BACKUP_LIMIT', 'Source reservation names exceed their explicit count budget or managed namespace.');
    let bytes = 0;
    const issued: { name: string; stat: BigIntStats }[] = [];
    for (const name of names) {
      if (!/^wit_[a-f0-9]{64}_reservation\.encrypted\.json$/.test(name)) continue;
      const stat = await lstat(join(directory, name), { bigint: true });
      check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.size > 0n
        && stat.size <= BigInt(Math.min(16 * 1024 * 1024, this.#options.budgets.maxBytes - bytes)),
      'BACKUP_LIMIT', 'Issued source reservation ciphertext must be regular and fit its remaining aggregate read budget.');
      bytes += Number(stat.size); issued.push({ name, stat });
    }
    const values: SourceReservations = new Map();
    for (const { name, stat } of issued) {
      const authenticated = await source.readArtifact({ id: name.slice(0, -15), purpose: 'workspace-interchange' });
      const ref = refIdentity(authenticated), value = authenticated.value as any, after = await lstat(join(directory, name), { bigint: true });
      check(after.isFile() && !after.isSymbolicLink() && after.nlink === 1n && same(physical(after), physical(stat))
        && after.size === stat.size && after.mtimeNs === stat.mtimeNs && after.ctimeNs === stat.ctimeNs && ref.diskBytes === Number(stat.size),
      'BACKUP_ACTIVATION_TARGET_UNBOUND', 'Source reservation ciphertext changed during its authenticated bounded read.');
      check(exact(value, ['format', 'sourceVaultId', 'sourceWorkspaceId', 'targetId', 'workspaceId', 'generation', 'contextDigest', 'physical'])
        && value.format === 'chausar.interchange-target-reservation.v1' && targetValue(value.targetId)
        && ref.id === `wit_${sha(value.targetId)}_reservation` && value.sourceVaultId === source.vaultId
        && value.sourceWorkspaceId === source.read().workspace.id && idValue(value.workspaceId) && idValue(value.generation)
        && digestValue(value.contextDigest) && physicalValue(value.physical)
        && ![source.directory, this.#options.journalVault.directory].includes(join(root, value.targetId))
        && !values.has(value.targetId.toLowerCase()),
      'BACKUP_ACTIVATION_TARGET_UNBOUND', 'Retain exact authenticated source-issued target reservation custody.');
      values.set(value.targetId.toLowerCase(), { ref: structuredClone(ref), value: structuredClone(value) });
    }
    return values;
  }
  async #attempts(capture: VaultEncryptedCustodyCapture, reservations: SourceReservations) {
    const { sourceVault: source, journalVault: journal, applicationDirectory: root, budgets } = this.#options;
    const captured = new Map(capture.artifacts.map(item => [`${item.ref.purpose}/${item.ref.id}`, item]));
    const values = new Map<string, { ref: PrivateArtifactRef; value: any; bytes: Uint8Array }>();
    // Both complete captures still authenticate every journal artifact. This
    // middle pass reads only exact WAL dependencies, once per invocation; inert
    // artifact writes need not advance State revision, so it cannot be reused
    // across inventory calls or across the callback's final custody fence.
    const read = async (key: string) => {
      const retained = values.get(key);
      if (retained) return retained;
      const item = captured.get(key);
      if (!item) return undefined;
      const authenticated = await journal.readArtifact(item.ref);
      check(same(refIdentity(authenticated), item.ref), 'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Journal refs must equal independently authenticated custody.');
      const value = { ref: item.ref, value: authenticated.value, bytes: item.bytes };
      values.set(key, value);
      return value;
    };
    const validClaim = (claim: any) => exact(claim, ['format', 'sourceVaultId', 'activationId', 'candidateId', 'candidateCreationId', 'pinDigest'])
      && claim.format === 'chausar.activation-local-claim.v1' && claim.sourceVaultId === source.vaultId
      && idValue(claim.activationId) && idValue(claim.candidateId) && idValue(claim.candidateCreationId) && digestValue(claim.pinDigest);
    const ledger = (await read('workspace-interchange/wal_ledger_v1'))?.value;
    if (ledger !== undefined) check(exact(ledger, ['format', 'claims']) && ledger.format === 'chausar.activation-local-ledger.v1'
      && Array.isArray(ledger.claims) && ledger.claims.length <= Math.min(4096, budgets.maxFiles) && ledger.claims.every(validClaim)
      && new Set(ledger.claims.map((claim: any) => claim.activationId)).size === ledger.claims.length
      && new Set(ledger.claims.map((claim: any) => claim.candidateCreationId)).size === ledger.claims.length,
    'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Retain the exact durable single-use identity ledger.');
    const attempts: WorkspaceActivationStagingAttempt[] = [];
    for (const key of captured.keys()) {
      if (!/^workspace-interchange\/wal_[a-f0-9]{64}_attempt$/.test(key)) continue;
      const retained = (await read(key))!;
      const value = retained.value, record = value?.record, claim = value?.claim;
      const reservation = reservations.get(String(value?.reservation?.targetId).toLowerCase());
      check(value?.format === 'chausar.activation-local-journal.v1' && ['attempted', 'prepared', 'committed', 'failed'].includes(value.phase)
        && value.sourceVaultId === source.vaultId && value.sourceWorkspaceId === source.read().workspace.id && value.journalVaultId === journal.vaultId
        && exact(record, ['format', 'status', 'activationId', 'candidateId', 'candidateCreationId', 'candidateDigest', 'pinDigest', 'contextDigest',
          'sourceInventoryDigest', 'targetProofDigest', 'targetId', 'workspaceId', 'projectionDigest', 'authorityDigest', 'stateDigest', 'evidenceDigest'])
        && record.format === 'chausar.workspace-activation.v1' && record.status === 'committed' && idValue(record.activationId)
        && ['candidateDigest', 'pinDigest', 'contextDigest', 'sourceInventoryDigest', 'targetProofDigest', 'projectionDigest', 'authorityDigest', 'stateDigest', 'evidenceDigest']
          .every(name => digestValue(record[name]))
        && retained.ref.id === `wal_${sha(record.activationId)}_attempt` && validClaim(claim) && claim.activationId === record.activationId
        && claim.candidateId === record.candidateId && claim.candidateCreationId === record.candidateCreationId && claim.pinDigest === record.pinDigest
        && reservation && same(value.reservation, reservation.value) && same(value.reservationRef, reservation.ref)
        && record.targetId === reservation.value.targetId && record.workspaceId === reservation.value.workspaceId
        && record.contextDigest === reservation.value.contextDigest && ledger?.claims.some((item: unknown) => same(item, claim)),
      'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Attempt, reservation, paired claim and single-use ledger must authenticate together.');
      const paired = await read(`workspace-interchange/wal_${sha(`${source.vaultId}:${claim.candidateCreationId}`)}_candidate`);
      check(same(paired?.value, claim), 'BACKUP_ACTIVATION_JOURNAL_CHANGED',
        'Attempt, reservation, paired claim and single-use ledger must authenticate together.');
      if (value.staging !== undefined) check(exact(value.staging, ['name', 'physical']) && typeof value.staging.name === 'string'
        && attemptPattern.test(value.staging.name) && physicalValue(value.staging.physical),
        'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Staging requires its exact durable name and physical generation.');
      // Partial records never grant a staging pathname. The metadata preflight
      // refuses any actual unbound attempt before inspecting its descendants.
      if (!['prepared', 'committed'].includes(value.phase)) continue;
      check(value.staging && Array.isArray(value.files) && value.files.length > 0 && Array.isArray(value.directories)
        && value.directories.includes('live') && value.files.length + value.directories.length <= budgets.maxFiles
        && value.files.every((item: any) => exact(item, ['path', 'witness']) && encryptedPath(item.path)
          && exact(item.witness, ['dev', 'ino', 'birthtimeNs', 'bytes', 'sha256']) && physicalValue(physicalFields(item.witness))
          && Number.isSafeInteger(item.witness.bytes) && item.witness.bytes > 0 && digestValue(item.witness.sha256))
        && value.directories.every(directoryPath) && ['test-fixture', 'encrypted-local-host'].includes(value.qualification)
        && new Set(value.files.map((item: any) => item.path.toLowerCase())).size === value.files.length
        && new Set(value.directories.map((name: string) => name.toLowerCase())).size === value.directories.length,
      'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Prepared ownership requires a complete bounded encrypted manifest.');
      let total = 0;
      for (const item of value.files) {
        total += item.witness.bytes;
        check(Number.isSafeInteger(total) && total <= budgets.maxBytes, 'BACKUP_LIMIT', 'Activation manifest exceeds its exact byte budget.');
      }
      for (const [name, ref, part] of [[BOOTSTRAP, value.bootstrap, 'bootstrap'], [EVIDENCE, value.evidence, 'evidence']] as const) {
        check(ref?.purpose === 'workspace-interchange' && ref.id === `wal_${sha(record.activationId)}_${part}`,
          'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Immutable staged payloads require exact journal-issued refs and encrypted bytes.');
        const encrypted = await read(`workspace-interchange/${ref.id}`), file = value.files.find((item: any) => item.path === name);
        check(encrypted
          && same(encrypted.ref, ref) && file && file.witness.bytes === encrypted.bytes.length && file.witness.sha256 === sha(encrypted.bytes),
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Immutable staged payloads require exact journal-issued refs and encrypted bytes.');
      }
      const bootstrap = values.get(`workspace-interchange/${value.bootstrap.id}`)!.value;
      const evidence = values.get(`workspace-interchange/${value.evidence.id}`)!.value;
      check(exact(bootstrap, ['record', 'state', 'authority']) && same(bootstrap.record, record)
        && bootstrap.state?.workspace?.id === record.workspaceId && bootstrap.state.revision === 0 && hash(bootstrap.state) === record.stateDigest
        && digest(bootstrap.authority) === record.authorityDigest && evidence?.format === 'chausar.workspace-activation-evidence.v1'
        && evidence.inert === true && digest(evidence) === record.evidenceDigest && digest(evidence.pin) === record.pinDigest
        && (value.phase !== 'committed' || physicalValue(value.liveDirectory)),
      'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Full bootstrap and evidence must retain the exact immutable publication digests.');
      attempts.push(freeze({ activationId: record.activationId, phase: value.phase,
        staging: { name: value.staging.name, directory: join(root, CONTROL, 'staging', value.staging.name), physical: structuredClone(value.staging.physical) },
        target: { targetId: record.targetId, directory: join(root, record.targetId), physical: structuredClone(reservation.value.physical) },
        directories: [...value.directories], files: structuredClone(value.files) }));
    }
    check(new Set(attempts.map(item => item.staging.name.toLowerCase())).size === attempts.length
      && new Set(attempts.map(item => item.target.targetId.toLowerCase())).size === attempts.length,
    'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Each staging attempt and target requires one unambiguous durable journal binding.');
    return Object.freeze(attempts);
  }
  async withInventory<T>(work: (lease: WorkspaceActivationStagingInventoryLease) => Promise<T>): Promise<T> {
    check(typeof work === 'function', 'BACKUP_ACTIVATION_SCOPE', 'Retain authenticated inventory through one bounded callback.');
    const o = this.#options;
    check(await safeDirectory(o.applicationDirectory) === o.applicationDirectory, 'BACKUP_ACTIVATION_SCOPE', 'Use the exact canonical application directory.');
    const sourceState = hash(o.sourceVault.read());
    const reservations = await this.#reservations(), reservationPin = canonical([...reservations]);
    return o.journalVault.snapshot(() => o.journalAdapter.withLease(async lease => o.journalPostgres.withSource(async native => {
      check(native.lease === lease && lease.active && native.storage.slot === lease.slot && native.authority.vaultId === o.journalVault.vaultId,
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Journal authentication requires the same installed transaction, slot and Vault identity.');
      const capture = async () => {
        await native.assertCurrent();
        const raw = await o.journalVault.captureEncryptedCustody(this.#captureBudgets());
        check(raw.storageKind === 'postgres' && raw.authorityKind === 'adapter-issued-envelope' && raw.vaultId === o.journalVault.vaultId
          && same(raw.state, o.journalVault.read()) && raw.state.revision === native.authority.revision
          && sha(raw.authority) === native.authority.envelopeDigest,
        'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Actual authenticated journal authority differs from its native held identity.');
        return raw;
      };
      const raw = await capture();
      const fence = (value: VaultEncryptedCustodyCapture) => canonical({ authority: sha(value.authority), state: hash(value.state),
        artifacts: value.artifacts.map(item => ({ ref: item.ref, sha256: sha(item.bytes) })) });
      const pin = fence(raw), attempts = await this.#attempts(raw, reservations);
      let active = true;
      const assertCurrent = async () => {
        check(active && lease.active, 'BACKUP_SOURCE_LEASE_REQUIRED', 'Authenticated journal inventory cannot escape its held callback.');
        check(hash(o.sourceVault.read()) === sourceState && canonical([...(await this.#reservations())]) === reservationPin,
          'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Current source authority or issued reservations changed during staging inspection.');
        check(fence(await capture()) === pin, 'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Complete current journal custody changed during staging inspection.');
      };
      const inventory = Object.freeze({ attempts, journalAuthorityBytes: raw.authority.byteLength,
        journalArtifactBytes: raw.artifacts.reduce((sum, item) => sum + item.bytes.byteLength, 0), assertCurrent });
      // The initial authenticated capture/reads are the before fence. The held
      // Vault queue and native transaction persist through the callback; one
      // complete recapture below is the after fence, rather than repeating the
      // identical complete capture immediately before work.
      try { await native.assertCurrent(); const result = await work(inventory); await assertCurrent(); return result; }
      finally { active = false; }
    })));
  }
}
function physicalFields(value: WorkspaceActivationStagingWitness): WorkspaceActivationStagingPhysical {
  return { dev: value.dev, ino: value.ino, birthtimeNs: value.birthtimeNs };
}

export type WorkspaceActivationStagingLayout = Readonly<{
  /** Only prepared targets are controlled by this staging classifier. Committed
   * target live files require the existing independent current-live admission. */
  controlledRoots: readonly string[];
  directories: readonly { path: string; physical: WorkspaceActivationStagingPhysical }[];
  files: readonly { path: string; witness: WorkspaceActivationStagingWitness; mtimeNs: string; ctimeNs: string }[];
  expectedFiles: ReadonlyMap<string, WorkspaceActivationStagingWitness>;
  states: readonly { name: string; phase: 'prepared' | 'committed'; location: 'stage' | 'target' }[];
  entries: number; bytes: number;
  /** Rechecks names/types/physical identity/size only. B must independently hash
   * every issued ciphertext file under its retained source and journal fences. */
  assertCurrent(): Promise<void>;
}>;

/** Metadata-only global preflight: unknown names, partial mixtures and changed
 * physical custody refuse before B is granted any staged/target content path. */
export async function preflightWorkspaceActivationStaging(input: {
  applicationDirectory: string; attempts: readonly WorkspaceActivationStagingAttempt[]; budgets: WorkspaceActivationStagingBudgets;
}): Promise<WorkspaceActivationStagingLayout> {
  validBudgets(input.budgets);
  check(isAbsolute(input.applicationDirectory) && resolve(input.applicationDirectory) === input.applicationDirectory
    && Array.isArray(input.attempts), 'BACKUP_ACTIVATION_SCOPE', 'Preflight only exact constructor-issued application custody.');
  const root = input.applicationDirectory, attempts: readonly WorkspaceActivationStagingAttempt[] = structuredClone(input.attempts), b = structuredClone(input.budgets);
  const scan = async () => {
    const directories: { path: string; physical: WorkspaceActivationStagingPhysical }[] = [];
    const files: { path: string; witness: WorkspaceActivationStagingWitness; mtimeNs: string; ctimeNs: string }[] = [];
    const states: { name: string; phase: 'prepared' | 'committed'; location: 'stage' | 'target' }[] = [];
    let entries = 0, bytes = 0;
    const count = () => { check(++entries <= b.maxFiles, 'BACKUP_LIMIT', 'Activation metadata exceeds its remaining count budget.'); };
    const directory = async (path: string, expected?: WorkspaceActivationStagingPhysical) => {
      count(); const stat = await lstat(path, { bigint: true });
      check(stat.isDirectory() && !stat.isSymbolicLink() && (!expected || same(physical(stat), expected)),
        'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Actual activation directory differs from its issued physical generation.');
      check(await safeDirectory(path) === path, 'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Activation directory must retain its exact canonical location.');
      directories.push({ path, physical: physical(stat) });
    };
    const names = async (path: string) => {
      const values = (await readdir(path)).sort();
      check(values.length <= b.maxFiles - entries && new Set(values.map(value => value.toLowerCase())).size === values.length,
        'BACKUP_LIMIT', 'Activation names exceed the remaining count budget or contain case aliases.');
      return values;
    };
    const control = join(root, CONTROL), staging = join(control, 'staging');
    let present = true;
    try { await lstat(control); } catch (error: any) { if (error.code === 'ENOENT') present = false; else throw error; }
    if (!present) {
      check(attempts.length === 0, 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Issued staging custody is missing.');
      return { directories, files, states, entries, bytes };
    }
    await directory(control);
    const controlNames = await names(control);
    check(controlNames.every(value => value === 'staging'), 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Only the reviewed staging control section may be inspected.');
    if (!controlNames.length) {
      check(attempts.length === 0, 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Issued staging section is missing.');
      return { directories, files, states, entries, bytes };
    }
    await directory(staging);
    const actualNames = await names(staging);
    check(new Set(attempts.map(item => item.staging.name.toLowerCase())).size === attempts.length
      && new Set(attempts.map(item => item.target.targetId.toLowerCase())).size === attempts.length
      && same(actualNames, attempts.map(item => item.staging.name).sort()),
    'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Every actual attempt requires one complete authenticated durable staging binding.');
    for (const attempt of attempts) {
      check(['prepared', 'committed'].includes(attempt.phase) && attemptPattern.test(attempt.staging.name)
        && targetPattern.test(attempt.target.targetId) && attempt.staging.directory === join(staging, attempt.staging.name)
        && attempt.target.directory === join(root, attempt.target.targetId) && physicalValue(attempt.staging.physical) && physicalValue(attempt.target.physical),
      'BACKUP_ACTIVATION_STAGING_UNBOUND', 'Use only exact issued staging and reserved target identities.');
      const expected = new Map(attempt.files.map(item => [item.path, item.witness])), expectedDirectories = new Set(attempt.directories);
      check(attempt.files.length > 0 && expected.size === attempt.files.length && expectedDirectories.size === attempt.directories.length
        && attempt.files.every(item => encryptedPath(item.path)) && attempt.directories.every(directoryPath),
      'BACKUP_ACTIVATION_STAGING_UNBOUND', 'The preflight requires its complete closed encrypted manifest.');
      const layout = async (path: string, rootPhysical: WorkspaceActivationStagingPhysical) => {
        await directory(path, rootPhysical);
        const seenFiles: string[] = [], seenDirectories: string[] = [], foundFiles: { path: string; witness: WorkspaceActivationStagingWitness; mtimeNs: string; ctimeNs: string }[] = [];
        const visit = async (parent: string, prefix: string, depth: number): Promise<void> => {
          check(depth <= b.maxDepth, 'BACKUP_LIMIT', 'Issued activation paths exceed their remaining depth budget.');
          for (const name of await names(parent)) {
            const logical = prefix ? `${prefix}/${name}` : name, child = join(parent, name);
            check(expected.has(logical) || expectedDirectories.has(logical), 'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An actual activation name is absent from its issued encrypted manifest.');
            const stat = await lstat(child, { bigint: true });
            check(!stat.isSymbolicLink() && (stat.isDirectory() ? expectedDirectories.has(logical) : stat.isFile() && expected.has(logical)),
              'BACKUP_ACTIVATION_STAGING_UNBOUND', 'An actual activation entry has an unissued type.');
            if (stat.isDirectory()) { await directory(child); seenDirectories.push(logical); await visit(child, logical, depth + 1); }
            else {
              count(); const witness = expected.get(logical)!;
              check(stat.nlink === 1n && stat.size > 0n && stat.size === BigInt(witness.bytes)
                && same(physical(stat), physicalFields(witness)), 'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Issued ciphertext requires its exact singly owned physical generation and size.');
              seenFiles.push(logical); foundFiles.push({ path: child, witness: structuredClone(witness), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
            }
          }
        };
        await visit(path, '', 0);
        return { files: seenFiles.sort(), directories: seenDirectories.sort(), foundFiles };
      };
      const stage = await layout(attempt.staging.directory, attempt.staging.physical);
      const fullFiles = [...expected.keys()].sort(), fullDirectories = [...expectedDirectories].sort();
      if (attempt.phase === 'committed') {
        check(stage.files.length === 0 && same(stage.directories, fullDirectories),
          'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'Committed staging must retain its exact empty directory skeleton.');
        // Current target writers/private files belong to the existing live/native
        // admission. A staging classifier must not freeze that mutable namespace.
        states.push({ name: attempt.staging.name, phase: attempt.phase, location: 'target' });
        continue;
      }
      const target = await layout(attempt.target.directory, attempt.target.physical);
      const staged = attempt.phase === 'prepared' && same(stage.files, fullFiles) && same(stage.directories, fullDirectories)
        && target.files.length === 0 && target.directories.length === 0;
      const published = stage.files.length === 0 && same(stage.directories, fullDirectories)
        && same(target.files, fullFiles) && same(target.directories, fullDirectories);
      check(staged || published, 'BACKUP_ACTIVATION_STAGING_UNRESOLVED', 'Prepared custody must be wholly staged or wholly published; committed staging must retain its exact empty skeleton.');
      const retained = staged ? stage.foundFiles : target.foundFiles;
      for (const file of retained) { bytes += file.witness.bytes; check(Number.isSafeInteger(bytes) && bytes <= b.maxBytes,
        'BACKUP_LIMIT', 'Issued activation ciphertext exceeds its remaining aggregate byte budget.'); files.push(file); }
      states.push({ name: attempt.staging.name, phase: attempt.phase, location: staged ? 'stage' : 'target' });
    }
    return { directories, files, states, entries, bytes };
  };
  const first = await scan(), pin = canonical(first);
  const expectedFiles = new Map(first.files.map(item => [item.path, freeze(structuredClone(item.witness))]));
  return Object.freeze({ ...freeze(first), controlledRoots: Object.freeze([join(root, CONTROL), ...attempts.filter(item => item.phase === 'prepared').map(item => item.target.directory)]), expectedFiles,
    assertCurrent: async () => { check(canonical(await scan()) === pin, 'BACKUP_ACTIVATION_CUSTODY_CHANGED', 'Complete staging/target metadata changed during ciphertext measurement.'); } });
}
