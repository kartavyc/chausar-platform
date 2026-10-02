import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { authorize, check, hash, type Context, type State } from './contracts.ts';
import { safeDirectory, Vault } from './vault.ts';
import { PostgresSnapshotAdapter, type PostgresSnapshotLease } from './postgres.ts';
import { WorkspacePostgresCustody, type PostgresSourceCustodyLease, type PostgresStorageIdentity, type PostgresTargetInspection } from './workspace-postgres-custody.ts';
import { createWorkspaceBackupV2PostgresPorts, type WorkspaceBackupV2FilesystemBudgets } from './workspace-backup-postgres.ts';
import { WorkspacePostgresOriginals } from './workspace-postgres-originals.ts';
import { WorkspacePostgresActivationCandidates, createWorkspaceActivationPostgresPorts, type WorkspaceActivationPostgresCustody } from './workspace-activation-postgres.ts';
import { WorkspaceBackupActivationHost } from './workspace-backup-activation.ts';
import { canonicalInterchangeJson, interchangeDigest } from './workspace-interchange.ts';
import type { WorkspaceActivationAuthority, WorkspaceActivationCommit, WorkspaceActivationPolicy } from './workspace-activation.ts';
import type { WorkspaceBackupV2ExternalKeyRequirement } from './workspace-backup-v2.ts';
import type { EnginePostgresWorkspaceOptions, PostgresWorkspaceAuthorityWitness, PostgresWorkspaceInstallInput, PostgresWorkspaceInstallation, PostgresWorkspaceLaunch, PostgresWorkspaceOpenAdmission, PostgresWorkspacePublicationBinding } from './workspace-postgres-contracts.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);
const bootstrapId = (id: string) => 'wal_root_live_' + sha(id);
const captureBudgets = { maxArtifacts: 4096, maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 64 * 1024 * 1024 };
type Target = { targetId: string; adapter: PostgresSnapshotAdapter; ownedAdapter(): Promise<PostgresSnapshotAdapter> };
type ActiveTarget = { targetId: string; adapter: PostgresSnapshotAdapter; custody: WorkspacePostgresCustody };
type Joined = {
  input: PostgresWorkspaceInstallInput; source: WorkspacePostgresCustody;
  backup: ReturnType<typeof createWorkspaceBackupV2PostgresPorts>; originals: WorkspacePostgresOriginals;
  candidates: WorkspacePostgresActivationCandidates; activation: WorkspaceActivationPostgresCustody;
  bridge: WorkspaceBackupActivationHost;
};
export type InstalledPostgresWorkspaceProfileOptions = {
  applicationDirectory: string; sourceDirectory: string;
  /** A new owned instance at the preinstalled ordinary canonical source slot. */
  sourceAdapter(): Promise<PostgresSnapshotAdapter>;
  /** This exact adapter is already installed in this independently opened Vault. */
  journalVault: Vault; journalAdapter: PostgresSnapshotAdapter;
  policy: WorkspaceActivationPolicy; targetPassphrase(authority: WorkspaceActivationAuthority): Promise<string>;
  /** All stable target adapters must be installed before source capture. */
  targets: Target[];
  filesystemBudgets?: WorkspaceBackupV2FilesystemBudgets;
  externalKeyRequirements?: WorkspaceBackupV2ExternalKeyRequirement[];
};

function store(storage: PostgresStorageIdentity, incarnation: string) {
  const { slot, ...nativeStore } = storage;
  return { storeId: 'store_' + interchangeDigest(nativeStore), slot, incarnation };
}
function witness(held: PostgresSourceCustodyLease): PostgresWorkspaceAuthorityWitness {
  return { storage: store(held.storage, held.authority.creationId), vaultId: held.authority.vaultId,
    revision: held.authority.revision, envelopeDigest: held.authority.envelopeDigest };
}

/** Actual A/B/C constructor composition for an explicit synthetic native profile.
 * Constructor capabilities never come from archives or RPC. Source queue precedes
 * native source and target exclusion. SQL publication remains FS-first and once.
 */
export class InstalledPostgresWorkspaceProfile implements EnginePostgresWorkspaceOptions {
  readonly format = 'chausar.postgres-workspace-profile.v1' as const;
  readonly journalVault: Vault;
  readonly policy: WorkspaceActivationPolicy;
  readonly targetPassphrase: InstalledPostgresWorkspaceProfileOptions['targetPassphrase'];
  readonly withWorkspaceAdmission: PostgresWorkspaceOpenAdmission;
  readonly #options: InstalledPostgresWorkspaceProfileOptions;
  readonly #sourceAdmission = new AsyncLocalStorage<PostgresSnapshotAdapter>();
  readonly #targetAdmission = new AsyncLocalStorage<ActiveTarget>();
  readonly #targets = new Map<string, Target & { custody: WorkspacePostgresCustody }>();
  #joined: Joined | undefined;

  constructor(options: InstalledPostgresWorkspaceProfileOptions) {
    check(options?.journalVault instanceof Vault && options.journalVault.storageKind === 'postgres'
      && options.journalAdapter instanceof PostgresSnapshotAdapter && typeof options.sourceAdapter === 'function'
      && typeof options.targetPassphrase === 'function' && Array.isArray(options.targets) && options.targets.length > 0,
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Install actual source/journal adapters and preinstalled native targets.');
    const applicationDirectory = resolve(options.applicationDirectory), sourceDirectory = resolve(options.sourceDirectory);
    const source = relative(applicationDirectory, sourceDirectory), journal = relative(applicationDirectory, options.journalVault.directory);
    check(source && journal && source !== journal && [source, journal].every(name => name !== '..' && !name.includes(sep))
      && options.journalAdapter.slot === hash(options.journalVault.directory),
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Bind distinct canonical direct-child source and journal slots.');
    this.#options = { ...options, applicationDirectory, sourceDirectory };
    this.journalVault = options.journalVault;
    this.policy = structuredClone(options.policy);
    this.targetPassphrase = options.targetPassphrase;
    for (const target of options.targets) {
      check(target && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(target.targetId)
        && !['main', source, journal, 'backups', 'exports', 'updates', 'private-artifacts'].includes(target.targetId)
        && !this.#targets.has(target.targetId) && target.adapter instanceof PostgresSnapshotAdapter
        && typeof target.ownedAdapter === 'function'
        && target.adapter.slot === hash(join(applicationDirectory, target.targetId, 'live', 'main')),
      'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Preinstall each distinct final ordinary target slot without adopting directories.');
      this.#targets.set(target.targetId, { ...target,
        custody: new WorkspacePostgresCustody({ adapter: target.adapter, targetDirectory: join(applicationDirectory, target.targetId) }) });
    }
    this.withWorkspaceAdmission = (input, work) => this.#admitSource(input, work);
  }

  /** Trusted host inspection/instrumentation only. Never expose through RPC. */
  installedCustody(): Joined {
    check(this.#joined, 'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Open the actual profiled source before reading installed custody.');
    return this.#joined;
  }
  targetCustody(targetId: string): WorkspacePostgresCustody { return this.#target(targetId).custody; }
  #target(targetId: string) {
    const target = this.#targets.get(targetId);
    check(target, 'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Only an explicitly preinstalled native target may be selected.');
    return target;
  }
  async #owned<T>(adapter: PostgresSnapshotAdapter, work: (lease: PostgresSnapshotLease) => Promise<T>): Promise<T> {
    check(adapter instanceof PostgresSnapshotAdapter, 'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Transfer an actual owned native adapter.');
    // Vault also closes transferred storage on invalid credentials or failed attach.
    // Defer ONLY resource closure; native rollback/commit and durable data stay A-owned.
    const close = adapter.close.bind(adapter);
    let held = true, requested = false, closed = false;
    adapter.close = async () => {
      if (held) { requested = true; return; }
      if (!closed) { closed = true; await close(); }
    };
    try { return await adapter.withLease(work); }
    catch (error) { requested = true; throw error; }
    finally { held = false; if (requested) await adapter.close(); }
  }
  async #admitSource<T>(input: Parameters<PostgresWorkspaceOpenAdmission>[0],
    work: (adapter: PostgresSnapshotAdapter) => Promise<T>): Promise<T> {
    check(await safeDirectory(this.#options.applicationDirectory) === this.#options.applicationDirectory
      && resolve(input.directory) === this.#options.sourceDirectory
      && await safeDirectory(input.directory) === this.#options.sourceDirectory,
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Source admission accepts only the exact canonical managed source.');
    const adapter = await this.#options.sourceAdapter();
    try {
      check(adapter instanceof PostgresSnapshotAdapter && !adapter.hasActiveLease
        && adapter.slot === hash(this.#options.sourceDirectory), 'POSTGRES_WORKSPACE_STORAGE_CHANGED',
      'Source factory must transfer a fresh owned adapter at the ordinary canonical source slot.');
    } catch (error) { if (adapter instanceof PostgresSnapshotAdapter && !adapter.hasActiveLease) await adapter.close(); throw error; }
    return this.#owned(adapter, lease => this.#sourceAdmission.run(adapter, async () => {
      await lease.load(); // A rejects any reserved, prepared or unknown native authority.
      const result = await work(adapter);
      check(lease.active, 'POSTGRES_LEASE_INACTIVE', 'Retain native source exclusion through Vault/Engine attachment.');
      await lease.load(); return result;
    }));
  }
  async #withTarget<T>(targetId: string, directory: string, work: (custody: WorkspacePostgresCustody) => Promise<T>) {
    check(resolve(directory) === join(this.#options.applicationDirectory, targetId),
      'ACTIVATION_LIVE_CUSTODY', 'Native target custody must bind the exact managed outer directory.');
    const active = this.#targetAdmission.getStore(), target = this.#target(targetId);
    const adapter = active?.targetId === targetId ? active.adapter : target.adapter;
    const custody = active?.targetId === targetId ? active.custody : target.custody;
    return adapter.withLease(() => work(custody));
  }
  async #nativeWitness(vault: Vault, custody: WorkspacePostgresCustody) {
    return vault.snapshot(() => custody.withSource(async held => {
      check(held.authority.vaultId === vault.vaultId && held.authority.revision === vault.read().revision,
        'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Actual native authority differs from the installed Vault.');
      const capture = await vault.captureEncryptedCustody(captureBudgets);
      check(sha(Buffer.from(capture.authority).toString('utf8')) === held.authority.envelopeDigest,
        'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Actual encrypted authority differs from native custody.');
      return witness(held);
    }));
  }

  async install(input: PostgresWorkspaceInstallInput): Promise<PostgresWorkspaceInstallation> {
    const adapter = this.#sourceAdmission.getStore();
    check(adapter && input.sourceVault.storageKind === 'postgres' && input.journalVault === this.journalVault
      && input.sourceVault.directory === this.#options.sourceDirectory
      && input.applicationDirectory === this.#options.applicationDirectory && same(input.policy, this.policy),
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Compose only the actual admitted source, installed journal and frozen constructor policy.');
    const source = new WorkspacePostgresCustody({ adapter });
    const backup = createWorkspaceBackupV2PostgresPorts({ vault: input.sourceVault, adapter, postgres: source,
      applicationDirectory: input.applicationDirectory, budgets: input.backupBudgets,
      // Installation below verifies source, journal and targets use distinct
      // databases. Retain source relation writer/DDL/main-maintenance exclusion
      // throughout original admission; physical metric drift still refuses.
      heldSourceSqlExclusion: 'share-relations',
      filesystemBudgets: this.#options.filesystemBudgets ?? { maxFiles: 8192, maxBytes: 128 * 1024 * 1024, maxDepth: 16 },
      externalKeyRequirements: this.#options.externalKeyRequirements ?? [{ provider: 'other', namespace: 'operator/credential-wrappers',
        requirement: 'Retain the independent operator passphrase or recovery credential. Encrypted wrappers do not include it.' }],
      outsideApplicationNamespaces: [
        { name: relative(input.applicationDirectory, input.journalVault.directory), requirement: 'Independently authenticate the encrypted activation journal; separate recovery is required.' },
        ...[...this.#targets.keys()].map(name => ({ name, requirement: 'Independently authenticate exact issued filesystem and native publication; separate recovery is required.' })),
      ],
      assertCompleteOwner: input.assertCompleteOwner,
      withCompleteOwner: (context, historical, work) => input.sourceVault.withCustodyWriterAdmission(async assertVault => {
        const statePin = hash(input.sourceVault.read());
        const assertCurrent = () => {
          assertVault(); authorize(input.sourceVault, context, 'admin');
          check(hash(input.sourceVault.read()) === statePin, 'ACTIVATION_SOURCE_CHANGED', 'Held source owner, epoch, access, readiness or authority changed.');
        };
        await input.assertCompleteOwner(context, historical); assertCurrent();
        const value = await work(assertCurrent);
        await input.assertCompleteOwner(context, historical); assertCurrent(); return value;
      }),
    });
    let candidates: WorkspacePostgresActivationCandidates, bridge: WorkspaceBackupActivationHost;
    const originals = new WorkspacePostgresOriginals({ sourceVault: input.sourceVault, journalVault: input.journalVault,
      applicationDirectory: input.applicationDirectory, backup, interchange: input.interchange, nativeSource: source,
      backupPolicy: input.backupPolicy, policy: input.policy, assertCompleteOwner: input.assertCompleteOwner,
      withTargetCustody: (id, directory, work) => this.#withTarget(id, directory, work),
      candidates: () => candidates, bridge: () => bridge });
    candidates = new WorkspacePostgresActivationCandidates({ sourceVault: input.sourceVault, journalVault: input.journalVault,
      applicationDirectory: input.applicationDirectory, nativeSource: source, source: originals.source,
      maxCandidateBytes: input.policy.budgets.maxCandidateBytes });
    const bridgePorts = candidates.backupActivationPorts(originals.originals);
    bridge = new WorkspaceBackupActivationHost(bridgePorts, input.backupPolicy);
    const activation = createWorkspaceActivationPostgresPorts({ sourceVault: input.sourceVault, journalVault: input.journalVault,
      applicationDirectory: input.applicationDirectory, source: originals.source, nativeSource: source,
      targetCustody: async (id, directory) => {
        check(directory === join(input.applicationDirectory, id), 'ACTIVATION_LIVE_CUSTODY', 'Target path differs from the issued native slot.');
        const active = this.#targetAdmission.getStore();
        return active?.targetId === id ? active.custody : this.#target(id).custody;
      },
      candidates: { read: (ctx, id) => candidates.readCandidate(ctx, id), withCandidate: (ctx, id, work) => candidates.withCandidate(ctx, id, work) },
      bootstrap: {
        allocateAuthority: async (context, target) => {
          await input.assertCompleteOwner(context, input.sourceVault.read());
          const ownerId = 'owner_' + randomUUID();
          return { workspaceId: target.workspaceId, owner: { id: ownerId, name: 'Fresh workspace owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
            context: { memberId: ownerId, role: 'owner', epoch: 1, channel: 'desktop' },
            sessionAuthorityId: 'session_' + randomUUID(), createdAt: new Date().toISOString() };
        },
        prepare: async ({ stagingDirectory, publication, storage }) => {
          const made = await input.bootstrap({ directory: join(stagingDirectory, 'live', 'main'), storage,
            passphrase: await input.targetPassphrase(structuredClone(publication.authority)), state: publication.state,
            expectedStateDigest: publication.record.stateDigest, expectedWorkspaceId: publication.authority.workspaceId,
            expectedOwnerId: publication.authority.owner.id, budgets: { maxStateBytes: 16 * 1024 * 1024, maxJsonDepth: 128, maxJsonNodes: 200000, maxRecords: 50000 } });
          try {
            await input.journalVault.writeArtifact({ id: bootstrapId(publication.record.activationId), purpose: 'workspace-interchange', expectedDigest: null,
              value: { format: 'chausar.root-live-bootstrap.v1', vaultId: made.vault.vaultId, recordDigest: interchangeDigest(publication.record),
                stateDigest: publication.record.stateDigest, authority: structuredClone(publication.authority) } });
          } finally { await made.vault.close(); }
          return { liveFiles: [], qualification: 'encrypted-local-host' };
        },
        inspect: value => this.#inspectLive(input, value.targetDirectory, value.publication, value.inspection),
      },
      budgets: { maxFiles: 4096, maxBytes: 64 * 1024 * 1024, maxDepth: 16 },
    });
    const sourceWitness = await this.#nativeWitness(input.sourceVault, source);
    const journalWitness = await this.#nativeWitness(input.journalVault, new WorkspacePostgresCustody({ adapter: this.#options.journalAdapter }));
    check(sourceWitness.storage.storeId !== journalWitness.storage.storeId,
      'POSTGRES_WORKSPACE_DATABASE_SCOPE', 'This sealed synthetic transfer profile requires separate source and journal databases.');
    for (const target of this.#targets.values()) {
      const targetStore = store(await target.custody.storageIdentity(), 'preinstalled').storeId;
      check(targetStore !== sourceWitness.storage.storeId && targetStore !== journalWitness.storage.storeId,
        'POSTGRES_WORKSPACE_DATABASE_SCOPE', 'Preinstall targets in a separate native database; same-database transfer remains unqualified.');
    }
    input.interchange.installPostgresSourceCustody(source);
    this.#joined = { input, source, backup, originals, candidates, activation, bridge };
    return { source: sourceWitness, journal: journalWitness,
      backup: { ports: backup.ports, restoredIdentity: (context, targetId) => backup.restoredIdentity(context, targetId), diagnostics: () => {
        const measured = backup.diagnostics();
        return { qualification: measured?.qualification ?? 'unmeasured', storageKind: 'postgres', authorityKind: 'adapter-issued-envelope',
          fullWorkspacePortable: false, namespaceCount: measured?.namespaces.length ?? null };
      } },
      activation: { bridgePorts, activationPorts: activation.ports,
        createTarget: (ctx, id) => originals.createTarget(ctx, id), inspectTarget: (ctx, id) => originals.inspectTarget(ctx, id),
        inspectCurrentLive: async ({ context, publication }) => {
          const result = await activation.ports.readback(context, { activationId: publication.record.activationId });
          check(result.status === 'committed' && same(result.record, publication.record), 'ACTIVATION_LIVE_CUSTODY', 'Current live publication differs from exact committed readback.');
        },
        inspectOpenTarget: (ctx, id) => this.#launch(ctx, id),
      } };
  }

  async #binding(input: PostgresWorkspaceInstallInput, publication: WorkspaceActivationCommit) {
    const pin = await input.journalVault.readArtifact({ id: bootstrapId(publication.record.activationId), purpose: 'workspace-interchange' });
    const value = pin.value as { format: string; vaultId: string; recordDigest: string; stateDigest: string; authority: WorkspaceActivationAuthority };
    check(value?.format === 'chausar.root-live-bootstrap.v1' && value.recordDigest === interchangeDigest(publication.record)
      && value.stateDigest === publication.record.stateDigest && same(value.authority, publication.authority) && typeof value.vaultId === 'string',
    'ACTIVATION_LIVE_CUSTODY', 'Independent fresh-Vault bootstrap binding differs.');
    return value;
  }
  async #inspectLive(input: PostgresWorkspaceInstallInput, directory: string, publication: WorkspaceActivationCommit, supplied: PostgresTargetInspection) {
    const id = publication.record.targetId, target = this.#target(id), active = this.#targetAdmission.getStore();
    const adapter = active?.targetId === id ? active.adapter : target.adapter;
    const custody = active?.targetId === id ? active.custody : target.custody;
    check(supplied.proof && ['prepared', 'committed'].includes(supplied.status), 'POSTGRES_TARGET_NOT_COMMITTED', 'Authenticate exact prepared or committed issued custody.');
    const pin = await this.#binding(input, publication);
    return adapter.withLease(async lease => {
      const inspect = async () => {
        check(lease.active, 'POSTGRES_LEASE_INACTIVE', 'Retain exact native target exclusion through authentication.');
        const current = await custody.inspect(supplied.proof!);
        check(current.status === supplied.status && same(current.proof, supplied.proof) && current.envelope,
          'ACTIVATION_LIVE_CUSTODY', 'Held issued target proof or publication phase changed.');
        return current;
      };
      const first = await inspect();
      const expected = supplied.status === 'committed' ? await lease.authority() : null;
      const assertHeld = async () => {
        await inspect(); if (expected) await lease.assertCurrent(expected);
      };
      const authenticated = await Vault.inspectPostgresSnapshot({ passphrase: await input.targetPassphrase(structuredClone(publication.authority)),
        loadHeldEnvelope: async () => supplied.status === 'prepared' ? (await inspect()).envelope! : lease.load(), assertHeld });
      const state = authenticated.state, owner = state.members.find(member => member.id === publication.authority.owner.id);
      check(authenticated.vaultId === pin.vaultId && state.workspace.id === publication.authority.workspaceId && state.revision >= 0
        && owner?.active && owner.role === 'owner' && owner.epoch === publication.authority.owner.epoch
        && state.policy.send === 'nothing' && !state.policy.autonomy && !state.policy.sharing,
      'ACTIVATION_LIVE_CUSTODY', 'Actual current target authority differs from its fresh owner and restrictive policy.');
      if (state.revision === 0) check(hash(state) === publication.record.stateDigest, 'ACTIVATION_LIVE_CUSTODY', 'Initial live State differs from exact bootstrap.');
      const sealed: (keyof State)[] = ['schemaVersion', 'workspace', 'members', 'policy', 'ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones', 'sourceRules',
        'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts', 'routes', 'sessions', 'schedules'];
      check(sealed.every(key => same(state[key], publication.state[key])), 'ACTIVATION_LIVE_CUSTODY', 'Fresh receipts cannot import provider, job, session, owner or business authority.');
      check(state.facts.every(fact => input.policy.allowedSyntheticSourceIds.includes(fact.sourceId)), 'ACTIVATION_SYNTHETIC_SCOPE', 'Live source scope exceeds approved synthetic evidence.');
      await assertHeld(); check(first.proof!.vaultId === authenticated.vaultId, 'ACTIVATION_LIVE_CUSTODY', 'Authenticated Vault differs from the native publication proof.');
      return { authorityKind: 'adapter-issued-envelope' as const, authorityCiphertextBytes: authenticated.authorityCiphertextBytes };
    });
  }
  async #launch(context: Context, activationId: string): Promise<PostgresWorkspaceLaunch> {
    const joined = this.installedCustody();
    const result = await joined.activation.ports.readback(context, { activationId });
    check(result.status === 'committed', 'ACTIVATION_COMMIT_UNKNOWN', 'Only exact authenticated committed publication issues a launch.');
    const publication: WorkspaceActivationCommit = { record: result.record, state: result.state, evidence: result.evidence, authority: result.authority };
    const id = publication.record.targetId;
    const retained = await joined.input.journalVault.readArtifact({ id: 'wpg_' + sha(activationId) + '_attempt', purpose: 'workspace-interchange' });
    const journal = retained.value as { record: WorkspaceActivationCommit['record']; proof?: NonNullable<PostgresTargetInspection['proof']> };
    check(journal.proof && same(journal.record, publication.record), 'ACTIVATION_LIVE_CUSTODY', 'Exact authenticated native publication proof is required.');
    const inspected = await this.#target(id).custody.inspect(journal.proof);
    check(inspected.status === 'committed' && inspected.proof, 'POSTGRES_TARGET_NOT_COMMITTED', 'Actual target publication must remain committed.');
    const pin = await this.#binding(joined.input, publication), proof = inspected.proof;
    const binding: PostgresWorkspacePublicationBinding = { storage: store(proof.storage, proof.creationId), operationId: proof.operationId,
      creationId: proof.creationId, targetId: id, physicalTargetDigest: interchangeDigest(proof.target), activationId,
      workspaceId: publication.authority.workspaceId, ownerId: publication.authority.owner.id, vaultId: pin.vaultId };
    const directory = await safeDirectory(join(this.#options.applicationDirectory, id, 'live'));
    return { backend: 'postgres', directory, workspaceId: binding.workspaceId, ownerId: binding.ownerId, vaultId: binding.vaultId,
      publication: binding, withWorkspaceAdmission: (request, work) => joined.originals.source.withSource(context, null, async source => {
        check(request.operation !== 'recover', 'ACTIVATION_RECOVERY_PROFILE_REQUIRED',
          'This sealed transfer profile requires a separately reviewed current credential recovery capability.');
        check(await safeDirectory(request.directory) === join(directory, 'main') && resolve(request.directory) === join(directory, 'main')
          && (!request.expectedAuthority || request.expectedAuthority.workspaceId === binding.workspaceId
            && request.expectedAuthority.ownerId === binding.ownerId && request.expectedAuthority.vaultId === binding.vaultId),
        'ACTIVATION_LIVE_CUSTODY', 'Select only the canonical final issued target and its fresh authority.');
        const adapter = await this.#target(id).ownedAdapter();
        try {
          check(adapter instanceof PostgresSnapshotAdapter && !adapter.hasActiveLease
            && adapter.slot === proof.storage.slot && adapter.slot === hash(join(directory, 'main')),
          'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Transfer a fresh owned target adapter at the ordinary final slot.');
        } catch (error) { if (adapter instanceof PostgresSnapshotAdapter && !adapter.hasActiveLease) await adapter.close(); throw error; }
        const custody = new WorkspacePostgresCustody({ adapter, targetDirectory: join(this.#options.applicationDirectory, id) });
        return this.#owned(adapter, lease => this.#targetAdmission.run({ targetId: id, adapter, custody }, async () => {
          const before = await joined.activation.ports.readback(context, { activationId });
          check(before.status === 'committed' && same({ record: before.record, state: before.state, evidence: before.evidence, authority: before.authority }, publication),
            'ACTIVATION_LIVE_CUSTODY', 'Exact committed publication changed before open.');
          check(same(store(await custody.storageIdentity(), proof.creationId), binding.storage), 'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Actual native target storage changed.');
          await lease.load(); await source.assertCurrent();
          const value = await work(adapter);
          const after = await joined.activation.ports.readback(context, { activationId });
          check(after.status === 'committed' && same({ record: after.record, state: after.state, evidence: after.evidence, authority: after.authority }, publication),
            'ACTIVATION_LIVE_CUSTODY', 'Exact committed publication changed during open/attach.');
          await source.assertCurrent(); await lease.load(); return value;
        }));
      }) };
  }
}
