import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { authorize, check, ChausarError, hash, type Context, type State } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { safeDirectory, Vault, type PrivateArtifactRef } from './vault.ts';
import { canonicalInterchangeJson, interchangeDigest, readHistoricalWorkspaceState } from './workspace-interchange.ts';
import { proveEmptyWorkspaceTarget } from './workspace-import-candidate.ts';
import type { EmptyTargetInspection, WorkspaceImportCandidate, WorkspaceInventory } from './workspace-interchange-contracts.ts';
import type { WorkspaceInterchangeSourceLease } from './workspace-interchange-host.ts';
import type { AuthenticatedActivationCandidate, WorkspaceActivationAuthority, WorkspaceActivationCommit,
  WorkspaceActivationPorts, WorkspaceActivationReadback } from './workspace-activation.ts';
import { workspaceActivationDiagnosticErrorCode, type WorkspaceActivationDiagnosticErrorCode } from './workspace-activation.ts';

const purpose = 'workspace-interchange' as const;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => canonicalInterchangeJson(a) === canonicalInterchangeJson(b);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const slotPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const BOOTSTRAP = 'activation-bootstrap.encrypted.json', EVIDENCE = 'activation-evidence.encrypted.json';
const journalId = (id: string) => `wal_${sha(id)}_attempt`;
const claimId = (vaultId: string, creationId: string) => `wal_${sha(`${vaultId}:${creationId}`)}_candidate`;
const reservationId = (targetId: string) => `wit_${sha(targetId)}_reservation`;
type Physical = { dev: string; ino: string; birthtimeNs: string };
type Witness = Physical & { bytes: number; sha256: string };
type Reservation = { format: 'chausar.interchange-target-reservation.v1'; sourceVaultId: string; sourceWorkspaceId: string;
  targetId: string; workspaceId: string; generation: string; contextDigest: string; physical: Physical };
type ReservedTarget = { reservation: Reservation; ref: PrivateArtifactRef; path: string };
type Claim = { format: 'chausar.activation-local-claim.v1'; sourceVaultId: string; activationId: string;
  candidateCreationId: string; candidateId: string; pinDigest: string };
type Ledger = { format: 'chausar.activation-local-ledger.v1'; claims: Claim[] };
type Journal = { format: 'chausar.activation-local-journal.v1'; phase: 'attempted' | 'prepared' | 'committed' | 'failed';
  sourceVaultId: string; sourceWorkspaceId: string; journalVaultId: string; reservation: Reservation; reservationRef: PrivateArtifactRef;
  record: WorkspaceActivationCommit['record']; claim: Claim; bootstrap?: PrivateArtifactRef; evidence?: PrivateArtifactRef;
  files?: { path: string; witness: Witness }[]; directories?: string[];
  staging?: {name: string; physical: Physical};
  liveDirectory?: Physical; qualification?: 'test-fixture' | 'encrypted-local-host' };

export type WorkspaceActivationLocalDiagnostic = Readonly<{
  format: 'chausar.activation-local-diagnostic.v1';
  stage: 'pre-filesystem-publication-source-guard' | 'post-filesystem-publication-source-guard';
  /** Describes this invocation's filesystem loop only; never an outcome or SQL commit assertion. */
  publicationStarted: boolean;
  errorCode: WorkspaceActivationDiagnosticErrorCode;
}>;

/** Reviewed root capabilities. They are never RPC inputs and have no memory/default implementation. */
export type WorkspaceActivationLocalOptions = {
  sourceVault: Vault;
  /** Separately unlocked durable control Vault. Do not add unclassified artifacts to the source inventory. */
  journalVault: Vault;
  applicationDirectory: string;
  /** Root-only safe metadata observer. No errors, identities or contents are forwarded. */
  onDiagnostic?(event: WorkspaceActivationLocalDiagnostic): void;
  source: {withSource<T>(context: Context, expected: WorkspaceInventory | null,
    work: (lease: WorkspaceInterchangeSourceLease) => Promise<T>, candidateId?: string): Promise<T>};
  candidates: {
    read(context: Context, candidateId: string): Promise<AuthenticatedActivationCandidate>;
    /** Hold the issuer's exact creation-instance exclusion through the entire callback; read must not reacquire it. */
    withCandidate<T>(context: Context, candidateId: string,
      work: (read: () => Promise<AuthenticatedActivationCandidate>) => Promise<T>): Promise<T>;
  };
  bootstrap: {
    allocateAuthority(context: Context, target: EmptyTargetInspection): Promise<WorkspaceActivationAuthority>;
    /** Initialize and CLOSE an exact fresh target in staging/live, with no historical authority or copied source keys. */
    prepare(input: { stagingDirectory: string; publication: WorkspaceActivationCommit }): Promise<{
      liveFiles: string[]; qualification: 'test-fixture' | 'encrypted-local-host';
    }>;
    /** Authenticate actual CURRENT live custody, fresh owner/session and revision lineage; never rewrite or attach it. */
    inspect(input: { targetDirectory: string; publication: WorkspaceActivationCommit }): Promise<void>;
  };
  budgets: { maxFiles: number; maxBytes: number; maxDepth: number };
};

function physical(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Physical {
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
function filePath(name: string, liveOnly = false) {
  check(typeof name === 'string' && name.length <= 500 && !name.includes('\\')
    && name.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(part) && !part.endsWith('.'))
    && (!liveOnly || name.startsWith('live/')), 'ACTIVATION_UNSAFE_PATH', 'Use bounded regular files strictly below the owned live subtree.');
  return name;
}
async function syncDirectory(directory: string) {
  let handle;
  try { handle = await open(directory, constants.O_RDONLY); await handle.sync(); }
  catch (error: any) { if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'EBADF'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
async function regular(path: string, maxBytes: number): Promise<{ bytes: Buffer; witness: Witness }> {
  await safeDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(maxBytes),
    'ACTIVATION_FILE_CUSTODY', 'Custody requires bounded regular files without symbolic or extra hard links.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat({ bigint: true });
    check(same(physical(opened), physical(before)), 'ACTIVATION_FILE_CUSTODY', 'File generation changed before measurement.');
    const chunks: Buffer[] = []; let bytes = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes + 1 - bytes));
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead; check(bytes <= maxBytes, 'ACTIVATION_LIMIT', 'Custody exceeds its byte budget.');
      chunks.push(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    check(current.isFile() && !current.isSymbolicLink() && current.nlink === 1n
      && same(physical(current), physical(before)) && same(physical(after), physical(before))
      && current.size === before.size && after.size === before.size && bytes === Number(before.size)
      && current.mtimeNs === before.mtimeNs && after.mtimeNs === before.mtimeNs
      && current.ctimeNs === before.ctimeNs && after.ctimeNs === before.ctimeNs,
    'ACTIVATION_FILE_CUSTODY', 'File bytes or generation changed during measurement.');
    const value = Buffer.concat(chunks);
    return { bytes: value, witness: { ...physical(before), bytes, sha256: sha(value) } };
  } finally { await handle.close(); }
}
async function completed(work: () => Promise<void>) {
  const result: unknown = await work();
  check(result === undefined, 'ACTIVATION_ROOT_GUARD', 'Trusted guards must complete without returning admission data.');
}

/** Actual encrypted journal and no-overwrite filesystem publication; no Vault bootstrap, Engine or recovery retry. */
export class WorkspaceActivationLocalCustody {
  readonly ports: WorkspaceActivationPorts;
  readonly #options: WorkspaceActivationLocalOptions;
  constructor(options: WorkspaceActivationLocalOptions) {
    check(options?.sourceVault instanceof Vault && options.journalVault instanceof Vault
      && options.sourceVault !== options.journalVault && typeof options.source?.withSource === 'function'
      && typeof options.candidates?.read === 'function' && typeof options.candidates?.withCandidate === 'function'
      && typeof options.bootstrap?.allocateAuthority === 'function' && typeof options.bootstrap?.prepare === 'function'
      && typeof options.bootstrap?.inspect === 'function', 'ACTIVATION_ROOT_REQUIRED',
    'Provide separate actual source/journal Vault custody and reviewed source, candidate and fresh bootstrap capabilities.');
    check(typeof options.applicationDirectory === 'string' && isAbsolute(options.applicationDirectory),
      'ACTIVATION_UNSAFE_PATH', 'Supply the canonical root-owned application directory.');
    const applicationDirectory = resolve(options.applicationDirectory), child = relative(applicationDirectory, options.sourceVault.directory);
    check(child !== '' && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`) && !child.includes(sep)
      && resolve(options.sourceVault.directory) !== resolve(options.journalVault.directory), 'ACTIVATION_UNSAFE_PATH',
    'Source must be a direct managed application child, with a distinct journal Vault.');
    check(options.budgets && Object.keys(options.budgets).sort().join(',') === 'maxBytes,maxDepth,maxFiles'
      && Object.values(options.budgets).every(n => Number.isSafeInteger(n) && n > 0)
      && options.budgets.maxFiles <= 4096 && options.budgets.maxBytes <= 256 * 1024 * 1024 && options.budgets.maxDepth <= 16,
    'ACTIVATION_LIMIT', 'Supply bounded positive filesystem budgets.');
    this.#options = { ...options, applicationDirectory, budgets: structuredClone(options.budgets) };
    this.ports = { custody: { read: (context, candidateId) => options.candidates.read(structuredClone(context), candidateId) },
      withTransaction: (context, input, work) => this.#transaction(context, input, work),
      readback: (context, input) => this.#recover(context, input.activationId) };
  }
  targetPath(targetId: string) {
    check(slotPattern.test(targetId) && !['backups', 'exports', 'updates', 'private-artifacts', 'reports', 'plugin-assets',
      'research-evidence', 'conversation-files', 'sync-evidence'].includes(targetId), 'ACTIVATION_UNSAFE_PATH', 'Use a distinct managed target slot.');
    const path = join(this.#options.applicationDirectory, targetId);
    check(resolve(path) !== resolve(this.#options.sourceVault.directory)
      && resolve(path) !== resolve(this.#options.journalVault.directory), 'ACTIVATION_UNSAFE_PATH', 'Target cannot be a source or journal Vault.');
    return path;
  }
  #owner(context: Context) {
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Use the current untainted desktop owner.');
    const member = authorize(this.#options.sourceVault, context, 'admin');
    check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Use the current unrestricted source owner.');
  }
  async #publicationSourceGuard(source: WorkspaceInterchangeSourceLease, publicationStarted: boolean) {
    try { await completed(() => source.assertCurrent()); }
    catch (error) {
      const event: WorkspaceActivationLocalDiagnostic = Object.freeze({ format: 'chausar.activation-local-diagnostic.v1',
        stage: publicationStarted ? 'post-filesystem-publication-source-guard' : 'pre-filesystem-publication-source-guard',
        publicationStarted, errorCode: workspaceActivationDiagnosticErrorCode(error) });
      // Observation cannot turn a refusal into success, change an unknown result, or interrupt custody.
      try { const observed: unknown = this.#options.onDiagnostic?.(event);
        void Promise.resolve(observed).catch(() => { /* an asynchronous observer cannot affect custody */ });
      } catch { /* preserve the original refusal */ }
      throw error;
    }
  }
  async #find(id: string) {
    try { return await this.#options.journalVault.readArtifact({ id, purpose }); }
    catch (error: any) { if (error.code === 'ARTIFACT_NOT_FOUND') return null; throw error; }
  }
  #write(id: string, value: unknown, expectedDigest: string | null) {
    return this.#options.journalVault.writeArtifact({ id, purpose, value, expectedDigest });
  }
  async #ledger() {
    const retained = await this.#find('wal_ledger_v1');
    const ledger: Ledger = retained ? retained.value as Ledger : { format: 'chausar.activation-local-ledger.v1', claims: [] };
    check(ledger?.format === 'chausar.activation-local-ledger.v1' && Array.isArray(ledger.claims) && ledger.claims.length <= 4096
      && ledger.claims.every(claim => claim?.format === 'chausar.activation-local-claim.v1'
        && [claim.sourceVaultId, claim.activationId, claim.candidateCreationId, claim.candidateId].every(id => idPattern.test(id))
        && /^[a-f0-9]{64}$/.test(claim.pinDigest))
      && new Set(ledger.claims.map(claim => claim.activationId)).size === ledger.claims.length
      && new Set(ledger.claims.map(claim => `${claim.sourceVaultId}:${claim.candidateCreationId}`)).size === ledger.claims.length,
    'ACTIVATION_JOURNAL_CHANGED', 'The authoritative durable identity ledger must contain distinct exact activation/candidate claims.');
    return { ledger, ref: retained };
  }
  async #reserve(claim: Claim) {
    const { ledger, ref } = await this.#ledger();
    check(!ledger.claims.some(existing => existing.activationId === claim.activationId
      || (existing.sourceVaultId === claim.sourceVaultId && existing.candidateCreationId === claim.candidateCreationId)),
    'ACTIVATION_SINGLE_USE', 'Both IDs are consumed by any prior durable attempt, including an interrupted journal write.');
    check(ledger.claims.length < 4096, 'ACTIVATION_LIMIT', 'The durable single-use ledger reached its explicit bound; retain it and inspect with root.');
    // One actual encrypted CAS reserves BOTH identities. A lost acknowledgement cannot reopen either replay window.
    await this.#write('wal_ledger_v1', { ...ledger, claims: [...ledger.claims, claim] }, ref?.valueDigest ?? null);
  }
  async #targetLocked<T>(targetId: string, work: () => Promise<T>) {
    // Share the issuer's actual target exclusion identity, without its empty-on-exit lease.
    const directory = await safeDirectory(join(this.#options.applicationDirectory, '.workspace-interchange-control', 'targets'), true);
    const lock = await acquireProcessLock(join(directory, `${sha(this.targetPath(targetId))}.lock`),
      { busyCode: 'ACTIVATION_BUSY', changedCode: 'ACTIVATION_LOCK_CHANGED' });
    try { return await work(); } finally { await lock.release(); }
  }
  async #reservation(context: Context, targetId: string) {
    const retained = await this.#options.sourceVault.readArtifact({ id: reservationId(targetId), purpose });
    const { value, ...ref } = retained, reservation = value as Reservation;
    check(reservation?.format === 'chausar.interchange-target-reservation.v1'
      && reservation.sourceVaultId === this.#options.sourceVault.vaultId
      && reservation.sourceWorkspaceId === this.#options.sourceVault.read().workspace.id && reservation.targetId === targetId
      && reservation.contextDigest === interchangeDigest(context) && reservation.physical,
    'ACTIVATION_TARGET_CHANGED', 'Target requires its exact independently issued encrypted physical reservation.');
    const path = await safeDirectory(this.targetPath(targetId));
    check(path === this.targetPath(targetId) && same(physical(await lstat(path, { bigint: true })), reservation.physical),
      'ACTIVATION_TARGET_CHANGED', 'The reserved physical target generation changed.');
    return { reservation, ref, path };
  }
  async #transaction<T>(contextInput: Context, input: Parameters<WorkspaceActivationPorts['withTransaction']>[1],
    work: Parameters<WorkspaceActivationPorts['withTransaction']>[2]): Promise<T> {
    const context = structuredClone(contextInput), pins = structuredClone(input);
    check(idPattern.test(pins.candidateId) && pins.targetId === pins.expectedTarget.targetId, 'ACTIVATION_SHAPE', 'Bind one exact candidate and target.');
    let sourceCalls = 0, candidateCalls = 0;
    const result = await this.#options.source.withSource(context, pins.expectedInventory, async source => {
      check(++sourceCalls === 1, 'ACTIVATION_ROOT_GUARD', 'Source capability must execute once.'); this.#owner(context);
      check(same(source.state, this.#options.sourceVault.read()), 'ACTIVATION_ROOT_GUARD', 'Source lease must fence the supplied actual Vault.');
      return this.#targetLocked(pins.targetId, () => this.#options.candidates.withCandidate(context, pins.candidateId, async read => {
        check(++candidateCalls === 1 && typeof read === 'function', 'ACTIVATION_ROOT_GUARD', 'Candidate capability must execute once under issuance exclusion.');
          const target = await this.#reservation(context, pins.targetId);
          check(target.reservation.workspaceId === pins.expectedTarget.workspaceId && target.reservation.generation === pins.expectedTarget.generation,
            'ACTIVATION_TARGET_CHANGED', 'Target proof and independently issued reservation differ.');
          proveEmptyWorkspaceTarget(pins.expectedTarget);
          const candidate = await read();
          check(candidate.pin.kind === 'candidate' && candidate.pin.recordId === pins.candidateId
            && candidate.pin.contextDigest === interchangeDigest(context) && same(candidate.pin.target, pins.expectedTarget)
            && same(candidate.pin.inventory, pins.expectedInventory), 'ACTIVATION_CANDIDATE_CHANGED', 'Exact held candidate issuance and pins are required.');
          let phase: 'empty' | 'attempted' | 'committed' = 'empty', activationId: string | undefined, allocated: WorkspaceActivationAuthority | undefined;
          const sourceCurrent = async () => { this.#owner(context); await completed(() => source.assertCurrent()); };
          const current = async () => {
            check(phase === 'empty', 'ACTIVATION_TARGET_NOT_EMPTY', 'Empty-target admission is pre-publication only.');
            await sourceCurrent(); check(same(await read(), candidate), 'ACTIVATION_CANDIDATE_CHANGED', 'Held issuance changed.');
            const actual = await this.#reservation(context, pins.targetId);
            check(same(actual.reservation, target.reservation) && same(actual.ref, target.ref)
              && (await readdir(target.path)).length === 0, 'ACTIVATION_TARGET_CHANGED', 'Reserved target custody or actual emptiness changed.');
            check(pins.expectedTarget.accessDigest === interchangeDigest({ context, members: this.#options.sourceVault.read().members,
              policy: this.#options.sourceVault.read().policy }), 'ACTIVATION_TARGET_CHANGED', 'Current target access proof changed.');
          };
          await current();
          const value = await work({ source, target: structuredClone(pins.expectedTarget), readCandidate: () => read(), assertCurrent: current,
            allocateAuthority: async () => {
              await current(); check(!allocated, 'ACTIVATION_AUTHORITY', 'Fresh authority allocation is single-use within a transaction.');
              allocated = structuredClone(await this.#options.bootstrap.allocateAuthority(structuredClone(context), structuredClone(pins.expectedTarget)));
              await current(); return structuredClone(allocated);
            },
            commit: async publication => {
              await current(); check(allocated && same(allocated, publication.authority), 'ACTIVATION_AUTHORITY', 'Commit must bind the authority allocated by this held root transaction.');
              phase = 'attempted'; activationId = publication.record.activationId;
              await this.#commit(context, source, read, candidate, target, publication); phase = 'committed';
            },
            readback: async () => {
              check(phase === 'committed' && activationId, 'ACTIVATION_COMMIT_UNKNOWN', 'A committed held publication is required for immediate readback.');
              return this.#readback(context, source, read, activationId);
            } });
          if (phase === 'empty') await current();
          else {
            await sourceCurrent();
            if (phase === 'committed') {
              const final = await this.#readback(context, source, read, activationId!);
              check(final.status === 'committed', 'ACTIVATION_COMMIT_UNKNOWN', 'Phase-aware lease exit must inspect exact initialized custody.');
            }
          }
          return value;
      }));
    }, pins.candidateId);
    check(sourceCalls === 1 && candidateCalls === 1, 'ACTIVATION_ROOT_GUARD', 'Root capabilities did not complete the held callback.');
    return result as T;
  }
  async #walk(root: string, prefix: string, maxBytes: number) {
    const files: { path: string; witness: Witness }[] = [], directories: string[] = []; let bytes = 0;
    const visit = async (directory: string, name: string, depth: number) => {
      directories.push(name);
      check(depth <= this.#options.budgets.maxDepth && directories.length + files.length + 2 <= this.#options.budgets.maxFiles,
        'ACTIVATION_LIMIT', 'Live directories exceed the filesystem depth/count budget.'); await safeDirectory(directory);
      for (const entry of (await readdir(directory)).sort()) {
        const next = `${name}/${entry}`; filePath(next, true);
        const path = join(directory, entry), stat = await lstat(path);
        check(!stat.isSymbolicLink(), 'ACTIVATION_FILE_CUSTODY', 'Live custody cannot traverse links.');
        if (stat.isDirectory()) await visit(path, next, depth + 1);
        else {
          check(files.length + directories.length + 2 < this.#options.budgets.maxFiles, 'ACTIVATION_LIMIT', 'Live file/directory count exceeds its budget.');
          const value = await regular(path, maxBytes - bytes); bytes += value.witness.bytes; files.push({ path: next, witness: value.witness });
        }
      }
    };
    await visit(root, prefix, 1); return { files, bytes, directories };
  }
  async #encryptedCopy(ref: PrivateArtifactRef, destination: string) {
    const retained = await this.#options.journalVault.readArtifact(ref);
    const { value: _value, ...actual } = retained;
    check(same(actual, ref), 'ACTIVATION_JOURNAL_CHANGED', 'Immutable encrypted journal payload changed.');
    const source = join(this.#options.journalVault.directory, 'private-artifacts', purpose, `${ref.id}.encrypted.json`);
    const raw = await regular(source, this.#options.budgets.maxBytes), handle = await open(destination, 'wx', 0o600);
    try { await handle.writeFile(raw.bytes); await handle.sync(); } finally { await handle.close(); }
    const copy = await regular(destination, this.#options.budgets.maxBytes);
    check(copy.bytes.equals(raw.bytes) && copy.witness.bytes === ref.diskBytes, 'ACTIVATION_JOURNAL_CHANGED', 'Encrypted staging copy differs.');
    return copy.witness;
  }
  async #commit(context: Context, source: WorkspaceInterchangeSourceLease, read: () => Promise<AuthenticatedActivationCandidate>,
    candidate: AuthenticatedActivationCandidate, target: ReservedTarget,
    publicationInput: WorkspaceActivationCommit) {
    const publication = structuredClone(publicationInput), record = publication.record;
    check(idPattern.test(record.activationId) && candidate.pin.kind === 'candidate'
      && record.candidateId === candidate.pin.recordId && record.candidateCreationId === candidate.pin.creationId
      && record.pinDigest === interchangeDigest(candidate.pin) && record.contextDigest === interchangeDigest(context)
      && record.candidateDigest === candidate.pin.candidateDigest && record.sourceInventoryDigest === interchangeDigest(candidate.pin.inventory)
      && record.targetProofDigest === proveEmptyWorkspaceTarget(candidate.pin.target)
      && record.targetId === target.reservation.targetId && record.workspaceId === target.reservation.workspaceId
      && publication.state.workspace.id === record.workspaceId && publication.state.revision === 0
      && record.stateDigest === hash(publication.state) && record.authorityDigest === interchangeDigest(publication.authority)
      && record.evidenceDigest === interchangeDigest(publication.evidence)
      && publication.evidence.content === candidate.content && same(publication.evidence.pin, candidate.pin),
    'ACTIVATION_PUBLICATION_CHANGED', 'Publication must bind the exact held issuance, target, bootstrap and complete original.');
    const claim: Claim = { format: 'chausar.activation-local-claim.v1', sourceVaultId: this.#options.sourceVault.vaultId,
      activationId: record.activationId, candidateId: record.candidateId, candidateCreationId: record.candidateCreationId, pinDigest: record.pinDigest };
    check(!await this.#find(journalId(record.activationId)) && !await this.#find(claimId(claim.sourceVaultId, claim.candidateCreationId)),
      'ACTIVATION_SINGLE_USE', 'Activation and candidate creation IDs are durable single-use, including failed and ambiguous attempts.');
    await this.#reserve(claim);
    let journal: Journal = { format: 'chausar.activation-local-journal.v1', phase: 'attempted', sourceVaultId: claim.sourceVaultId,
      sourceWorkspaceId: source.state.workspace.id, journalVaultId: this.#options.journalVault.vaultId,
      reservation: target.reservation, reservationRef: target.ref, record, claim };
    let ref = await this.#write(journalId(record.activationId), journal, null);
    await this.#write(claimId(claim.sourceVaultId, claim.candidateCreationId), claim, null);
    const stagingParent = await safeDirectory(join(this.#options.applicationDirectory, '.workspace-activation-control', 'staging'), true);
    const staging = join(stagingParent, `attempt_${randomUUID()}`); await mkdir(staging, { mode: 0o700 });
    journal = {...journal, staging: {name: relative(stagingParent, staging), physical: physical(await lstat(staging, {bigint: true}))}};
    ref = await this.#write(ref.id, journal, ref.valueDigest);
    // Unfinished staging is deliberately retained for explicit root inspection, never adopted by a later attempt.
    const bootstrap = await this.#write(`wal_${sha(record.activationId)}_bootstrap`, { record, state: publication.state, authority: publication.authority }, null);
    const evidence = await this.#write(`wal_${sha(record.activationId)}_evidence`, publication.evidence, null);
    const bootstrapWitness = await this.#encryptedCopy(bootstrap, join(staging, BOOTSTRAP));
    const evidenceWitness = await this.#encryptedCopy(evidence, join(staging, EVIDENCE));
    await mkdir(join(staging, 'live'), { mode: 0o700 });
    const prepared = await this.#options.bootstrap.prepare({ stagingDirectory: staging, publication: structuredClone(publication) });
    check(prepared && Object.keys(prepared).sort().join(',') === 'liveFiles,qualification'
      && ['test-fixture', 'encrypted-local-host'].includes(prepared.qualification)
      && Array.isArray(prepared.liveFiles) && prepared.liveFiles.length > 0
      && prepared.liveFiles.every(name => { filePath(name, true); return true; }), 'ACTIVATION_BOOTSTRAP_REQUIRED', 'Root must return a closed encrypted live bootstrap manifest and truthful qualification.');
    const live = await this.#walk(join(staging, 'live'), 'live', this.#options.budgets.maxBytes - bootstrapWitness.bytes - evidenceWitness.bytes);
    check(same(live.files.map(file => file.path).sort(), [...prepared.liveFiles].sort())
      && same((await readdir(staging)).sort(), [BOOTSTRAP, EVIDENCE, 'live'].sort()),
    'ACTIVATION_BOOTSTRAP_REQUIRED', 'Actual complete staging entries must match the reviewed manifest exactly.');
    await completed(() => this.#options.bootstrap.inspect({ targetDirectory: staging, publication: structuredClone(publication) }));
    // Root preparation may use copyFile; sync every closed actual staged file ourselves before the prepared marker.
    for (const item of [{ path: BOOTSTRAP, witness: bootstrapWitness }, { path: EVIDENCE, witness: evidenceWitness }, ...live.files]) {
      const handle = await open(join(staging, item.path), constants.O_RDWR | (constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat({ bigint: true });
        check(stat.isFile() && stat.nlink === 1n && same(physical(stat), {
          dev: item.witness.dev, ino: item.witness.ino, birthtimeNs: item.witness.birthtimeNs }),
        'ACTIVATION_FILE_CUSTODY', 'Only the exact owned staged generation may be flushed.');
        await handle.sync();
      } finally { await handle.close(); }
    }
    for (const directory of [...live.directories].reverse()) await syncDirectory(join(staging, directory));
    await syncDirectory(staging); await syncDirectory(stagingParent);
    journal = { ...journal, phase: 'prepared', bootstrap, evidence,
      files: [{ path: BOOTSTRAP, witness: bootstrapWitness }, { path: EVIDENCE, witness: evidenceWitness }, ...live.files],
      directories: live.directories,
      qualification: candidate.measurement.qualification === 'test-fixture' ? 'test-fixture' : prepared.qualification };
    ref = await this.#write(ref.id, journal, ref.valueDigest); // The full attempt binding is durable BEFORE physical publication.
    await this.#publicationSourceGuard(source, false); this.#owner(context);
    check(same(await read(), candidate), 'ACTIVATION_CANDIDATE_CHANGED', 'Issuance changed before physical publication.');
    const actual = await this.#reservation(context, record.targetId);
    check(same(actual.reservation, target.reservation) && same(actual.ref, target.ref) && (await readdir(target.path)).length === 0,
      'ACTIVATION_TARGET_CHANGED', 'Target changed before physical publication.');
    await this.#options.sourceVault.withCustodyWriterAdmission(async assertCurrent => {
      for (const directory of journal.directories!) {
        assertCurrent(); await mkdir(join(target.path, directory), { mode: 0o700 }); await syncDirectory(dirname(join(target.path, directory)));
      }
      for (const item of journal.files!) {
        const staged = await regular(join(staging, item.path), this.#options.budgets.maxBytes);
        check(same(staged.witness, item.witness), 'ACTIVATION_FILE_CUSTODY', 'Exact staged physical ciphertext changed before publication.');
        assertCurrent(); await link(join(staging, item.path), join(target.path, item.path));
        const linked = await lstat(join(target.path, item.path), { bigint: true });
        check(linked.isFile() && !linked.isSymbolicLink() && linked.nlink === 2n && same(physical(linked), {
          dev: staged.witness.dev, ino: staged.witness.ino, birthtimeNs: staged.witness.birthtimeNs }),
          'ACTIVATION_FILE_CUSTODY', 'No-overwrite publication must retain the exact staged physical generation.');
        await unlink(join(staging, item.path)); await syncDirectory(dirname(join(target.path, item.path))); await syncDirectory(dirname(join(staging, item.path)));
        const published = await regular(join(target.path, item.path), this.#options.budgets.maxBytes);
        check(same(published.witness, item.witness), 'ACTIVATION_FILE_CUSTODY', 'Published ciphertext differs from exact staging custody.'); assertCurrent();
      }
      await syncDirectory(target.path); await syncDirectory(stagingParent); assertCurrent();
    });
    await this.#publicationSourceGuard(source, true); this.#owner(context);
    await completed(() => this.#options.bootstrap.inspect({ targetDirectory: target.path, publication: structuredClone(publication) }));
    const finalTarget = await this.#reservation(context, record.targetId);
    check(same(finalTarget.reservation, target.reservation) && same(finalTarget.ref, target.ref)
      && same((await readdir(target.path)).sort(), [BOOTSTRAP, EVIDENCE, 'live'].sort())
      && same(await read(), candidate), 'ACTIVATION_TARGET_CHANGED', 'Final publication requires the complete exact target and held candidate.');
    const finalLive = await this.#walk(join(target.path, 'live'), 'live', this.#options.budgets.maxBytes - bootstrapWitness.bytes - evidenceWitness.bytes);
    check(same(finalLive, live), 'ACTIVATION_FILE_CUSTODY', 'Final live bootstrap or directory inventory differs from exact staging.');
    for (const item of journal.files!.slice(0, 2)) {
      check(same((await regular(join(target.path, item.path), this.#options.budgets.maxBytes)).witness, item.witness),
        'ACTIVATION_FILE_CUSTODY', 'Immutable initial bootstrap or full evidence changed before the final marker.');
    }
    journal = { ...journal, phase: 'committed', liveDirectory: physical(await lstat(join(target.path, 'live'), { bigint: true })) };
    await this.#write(ref.id, journal, ref.valueDigest); // Rejected acknowledgement remains unknown until explicit inspection.
  }
  async #payload(journal: Journal): Promise<WorkspaceActivationCommit> {
    check(journal.bootstrap && journal.evidence, 'ACTIVATION_JOURNAL_CHANGED', 'Complete immutable payload references are required.');
    const bootstrap = await this.#options.journalVault.readArtifact(journal.bootstrap), evidence = await this.#options.journalVault.readArtifact(journal.evidence);
    const { value: initial, ...bootstrapRef } = bootstrap, { value: original, ...evidenceRef } = evidence;
    check(same(bootstrapRef, journal.bootstrap) && same(evidenceRef, journal.evidence), 'ACTIVATION_JOURNAL_CHANGED', 'Immutable payload references changed.');
    const publication = { ...(initial as Omit<WorkspaceActivationCommit, 'evidence'>), evidence: original as WorkspaceActivationCommit['evidence'] };
    check(same(publication.record, journal.record) && hash(publication.state) === journal.record.stateDigest
      && interchangeDigest(publication.authority) === journal.record.authorityDigest
      && interchangeDigest(publication.evidence) === journal.record.evidenceDigest, 'ACTIVATION_JOURNAL_CHANGED', 'Exact bootstrap order or complete original differs from the durable commit binding.');
    return publication;
  }
  async #readback(context: Context, source: WorkspaceInterchangeSourceLease, read: () => Promise<AuthenticatedActivationCandidate>, activationId: string): Promise<WorkspaceActivationReadback> {
    const unknown = (reasonCode: string): WorkspaceActivationReadback => ({ status: 'unknown', activationId, reasonCode });
    this.#owner(context); await completed(() => source.assertCurrent());
    const retained = await this.#find(journalId(activationId));
    if (!retained) return unknown('ACTIVATION_ATTEMPT_NOT_FOUND');
    const journal = retained.value as Journal;
    check(journal?.format === 'chausar.activation-local-journal.v1' && journal.record?.activationId === activationId
      && journal.sourceVaultId === this.#options.sourceVault.vaultId && journal.sourceWorkspaceId === source.state.workspace.id
      && journal.journalVaultId === this.#options.journalVault.vaultId && journal.record.contextDigest === interchangeDigest(context),
    'ACTIVATION_JOURNAL_CHANGED', 'Journal must bind this exact source, owner, control Vault and activation.');
    if (journal.phase !== 'committed') return unknown('ACTIVATION_ATTEMPT_UNRESOLVED');
    const candidate = await read();
    check(candidate.pin.kind === 'candidate' && candidate.pin.creationId === journal.record.candidateCreationId
      && candidate.pin.recordId === journal.record.candidateId && interchangeDigest(candidate.pin) === journal.record.pinDigest,
    'ACTIVATION_CANDIDATE_CHANGED', 'Restart requires the exact independently retained source issuance.');
    const historical = readHistoricalWorkspaceState((JSON.parse(candidate.content) as WorkspaceImportCandidate).archive);
    await completed(() => source.assertCompleteOwner(context, historical));
    let result: WorkspaceActivationReadback;
    try {
      const claim = await this.#find(claimId(journal.sourceVaultId, journal.record.candidateCreationId));
      const { ledger } = await this.#ledger();
      check(claim && same(claim.value, journal.claim)
        && ledger.claims.some(existing => same(existing, journal.claim)), 'ACTIVATION_JOURNAL_CHANGED', 'Durable paired identity consumption changed.');
      const publication = await this.#payload(journal), target = await this.#reservation(context, journal.record.targetId);
      check(same(target.reservation, journal.reservation) && same(target.ref, journal.reservationRef)
        && same((await readdir(target.path)).sort(), [BOOTSTRAP, EVIDENCE, 'live'].sort())
        && journal.liveDirectory && same(physical(await lstat(join(target.path, 'live'), { bigint: true })), journal.liveDirectory),
      'ACTIVATION_TARGET_CHANGED', 'Initialized target is partial, replaced or unrelated.');
      check(publication.evidence.content === candidate.content && same(publication.evidence.pin, candidate.pin),
        'ACTIVATION_CANDIDATE_CHANGED', 'Preserved original differs from exact current issuance custody.');
      let ciphertextBytes = 0;
      for (const [name, ref] of [[BOOTSTRAP, journal.bootstrap!], [EVIDENCE, journal.evidence!]] as const) {
        const expected = journal.files?.find(file => file.path === name);
        check(expected, 'ACTIVATION_JOURNAL_CHANGED', 'Immutable physical file binding is required.');
        const file = await regular(join(target.path, name), this.#options.budgets.maxBytes - ciphertextBytes);
        const raw = await regular(join(this.#options.journalVault.directory, 'private-artifacts', purpose, `${ref.id}.encrypted.json`), this.#options.budgets.maxBytes);
        check(same(file.witness, expected.witness) && file.bytes.equals(raw.bytes), 'ACTIVATION_TARGET_CHANGED', 'Immutable target ciphertext or physical generation changed.');
        ciphertextBytes += file.witness.bytes;
      }
      const live = await this.#walk(join(target.path, 'live'), 'live', this.#options.budgets.maxBytes - ciphertextBytes);
      ciphertextBytes += live.bytes;
      await completed(() => this.#options.bootstrap.inspect({ targetDirectory: target.path, publication: structuredClone(publication) }));
      const finalTarget = await this.#reservation(context, journal.record.targetId);
      check(same(finalTarget.reservation, journal.reservation) && same(finalTarget.ref, journal.reservationRef)
        && same((await readdir(target.path)).sort(), [BOOTSTRAP, EVIDENCE, 'live'].sort())
        && same(physical(await lstat(join(target.path, 'live'), { bigint: true })), journal.liveDirectory),
      'ACTIVATION_TARGET_CHANGED', 'Target generation or layout changed during current-live inspection.');
      for (const name of [BOOTSTRAP, EVIDENCE]) {
        const expected = journal.files!.find(file => file.path === name)!;
        check(same((await regular(join(target.path, name), this.#options.budgets.maxBytes)).witness, expected.witness),
          'ACTIVATION_TARGET_CHANGED', 'Immutable target custody changed during current-live inspection.');
      }
      const finalLive = await this.#walk(join(target.path, 'live'), 'live', this.#options.budgets.maxBytes
        - journal.files!.filter(file => [BOOTSTRAP, EVIDENCE].includes(file.path)).reduce((n, file) => n + file.witness.bytes, 0));
      check(same(finalLive, live), 'ACTIVATION_TARGET_CHANGED', 'Measured live custody changed during authentication.');
      result = { status: 'committed', encrypted: true, ciphertextBytes, qualification: journal.qualification!, ...publication };
    } catch { return unknown('ACTIVATION_CUSTODY_UNRESOLVED'); }
    // Admission errors must refuse, rather than being disguised as a target custody status.
    await completed(() => source.assertCurrent()); this.#owner(context);
    check(same(await read(), candidate), 'ACTIVATION_CANDIDATE_CHANGED', 'Exact issuance changed during restart inspection.');
    return result;
  }
  async #recover(contextInput: Context, activationId: string): Promise<WorkspaceActivationReadback> {
    check(idPattern.test(activationId), 'ACTIVATION_SHAPE', 'Inspect one exact activation ID.');
    const context = structuredClone(contextInput); let calls = 0;
    const result = await this.#options.source.withSource(context, null, async source => {
      check(++calls === 1, 'ACTIVATION_ROOT_GUARD', 'Recovery source callback must execute once.'); this.#owner(context);
      const retained = await this.#find(journalId(activationId));
      if (!retained) return { status: 'unknown' as const, activationId, reasonCode: 'ACTIVATION_ATTEMPT_NOT_FOUND' };
      const journal = retained.value as Journal;
      check(journal?.record?.contextDigest === interchangeDigest(context), 'INTERCHANGE_CONTEXT_CHANGED', 'Recovery requires the current issuance owner context.');
      return this.#targetLocked(journal.record.targetId, () => this.#options.candidates.withCandidate(context, journal.record.candidateId,
        read => this.#readback(context, source, read, activationId)));
    });
    check(calls === 1, 'ACTIVATION_ROOT_GUARD', 'Recovery must inspect under held source exclusion.'); return result;
  }
}

export function createWorkspaceActivationLocalPorts(options: WorkspaceActivationLocalOptions) {
  return new WorkspaceActivationLocalCustody(options);
}
