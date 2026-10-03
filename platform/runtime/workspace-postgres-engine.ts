import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { check, type Context, type State } from './contracts.ts';
import { Vault, safeDirectory } from './vault.ts';
import { WorkspaceBackupActivationHost } from './workspace-backup-activation.ts';
import { WorkspaceActivationHost } from './workspace-activation.ts';
import type { WorkspaceActivationCommit } from './workspace-activation.ts';
import type { EnginePostgresWorkspaceOptions, PostgresWorkspaceInstallInput,
  PostgresWorkspaceInstallation, PostgresWorkspaceAuthorityWitness, PostgresWorkspaceLaunch } from './workspace-postgres-contracts.ts';

const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const captureBudgets = { maxArtifacts: 4096, maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 64 * 1024 * 1024 };
type Options = { profile: EnginePostgresWorkspaceOptions; input: PostgresWorkspaceInstallInput;
  installed: PostgresWorkspaceInstallation; assertConfiguration(): void };

/** Coordinator-owned concrete facade. Native custody is supplied by reviewed
 * A/B/C constructor ports; neither the class nor an injected port certifies it.
 */
export class EnginePostgresWorkspaceActivation {
  readonly bridge: WorkspaceBackupActivationHost;
  readonly activation: WorkspaceActivationHost;
  readonly #options: Options;
  private constructor(options: Options) {
    this.#options = options;
    this.bridge = new WorkspaceBackupActivationHost(options.installed.activation.bridgePorts, options.input.backupPolicy);
    this.activation = new WorkspaceActivationHost(options.installed.activation.activationPorts, options.input.policy);
  }
  static async install(profile: EnginePostgresWorkspaceOptions, input: PostgresWorkspaceInstallInput,
    assertConfiguration: () => void): Promise<EnginePostgresWorkspaceActivation> {
    check(profile?.format === 'chausar.postgres-workspace-profile.v1'
      && profile.journalVault instanceof Vault && input.sourceVault instanceof Vault
      && input.journalVault === profile.journalVault && input.sourceVault !== input.journalVault
      && input.sourceVault.storageKind === 'postgres' && input.journalVault.storageKind === 'postgres'
      && input.sourceVault.vaultId !== input.journalVault.vaultId
      && typeof profile.install === 'function' && typeof profile.withWorkspaceAdmission === 'function'
      && typeof profile.targetPassphrase === 'function', 'POSTGRES_WORKSPACE_ROOT_REQUIRED',
    'Install distinct actual PostgreSQL source/journal custody and constructor-only publication capabilities.');
    const root = await safeDirectory(input.applicationDirectory);
    const source = relative(root, input.sourceVault.directory), journal = relative(root, input.journalVault.directory);
    check(source && journal && source !== journal && source !== '..' && journal !== '..'
      && !source.includes(sep) && !journal.includes(sep) && !isAbsolute(source) && !isAbsolute(journal),
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Source and journal must be distinct canonical managed application children.');
    check(input.policy.approvedSyntheticWorkspaceIds.includes(input.sourceVault.read().workspace.id),
      'ACTIVATION_SYNTHETIC_SCOPE', 'Only the explicitly approved synthetic PostgreSQL workspace may install transfer.');
    assertConfiguration();
    const installed = await profile.install({ ...input, applicationDirectory: root,
      policy: structuredClone(input.policy), backupPolicy: structuredClone(input.backupPolicy), backupBudgets: { ...input.backupBudgets } });
    check(installed?.backup && typeof installed.backup.restoredIdentity === 'function',
      'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Install actual committed inert identity discovery for the public inspection route.');
    const verify = async (witness: PostgresWorkspaceAuthorityWitness, vault: Vault) => {
      check(witness && opaque(witness.storage?.storeId) && opaque(witness.storage.slot) && opaque(witness.storage.incarnation)
        && witness.vaultId === vault.vaultId && witness.revision === vault.read().revision && hashPattern.test(witness.envelopeDigest),
      'POSTGRES_WORKSPACE_STORAGE_CHANGED', 'Installed storage identity must bind the actual current encrypted Vault.');
      await vault.snapshot(async () => {
        const capture = await vault.captureEncryptedCustody(captureBudgets);
        check(capture.storageKind === 'postgres' && capture.authorityKind === 'adapter-issued-envelope'
          && digest(capture.authority) === witness.envelopeDigest, 'POSTGRES_WORKSPACE_STORAGE_CHANGED',
        'Actual adapter-issued encrypted authority differs from the installed storage witness.');
      });
    };
    await verify(installed.source, input.sourceVault); await verify(installed.journal, input.journalVault);
    check(installed.source.storage.storeId !== installed.journal.storage.storeId
      || installed.source.storage.slot !== installed.journal.storage.slot,
    'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Distinct adapter objects cannot stand in for distinct native source and journal slots.');
    assertConfiguration();
    return new EnginePostgresWorkspaceActivation({ profile, input: { ...input, applicationDirectory: root,
      policy: structuredClone(input.policy), backupPolicy: structuredClone(input.backupPolicy) }, installed, assertConfiguration });
  }
  get backup() { return this.#options.installed.backup; }
  async #owner(context: Context, historical: State = this.#options.input.sourceVault.read()) {
    this.#options.assertConfiguration();
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Use the current untainted desktop owner.');
    await this.#options.input.assertCompleteOwner(structuredClone(context), structuredClone(historical));
    this.#options.assertConfiguration();
  }
  async createTarget(context: Context, targetId: string) {
    await this.#owner(context);
    const target = await this.#options.installed.activation.createTarget(context, targetId);
    await this.#owner(context); return target;
  }
  async inspectTarget(context: Context, targetId: string) {
    await this.#owner(context);
    const target = await this.#options.installed.activation.inspectTarget(context, targetId);
    await this.#owner(context); return target;
  }
  async inspectCurrentLive(input: { context: Context; targetId: string; publication: WorkspaceActivationCommit }) {
    await this.#owner(input.context);
    check(input.targetId === input.publication.record.targetId, 'ACTIVATION_LIVE_CUSTODY', 'Inspect only the exact issued live target.');
    await this.#options.installed.activation.inspectCurrentLive(input); await this.#owner(input.context);
  }
  async inspectOpenTarget(context: Context, activationId: string): Promise<PostgresWorkspaceLaunch> {
    await this.#owner(context);
    const committed = await this.activation.resolve(context, { activationId });
    check(committed.status === 'committed', 'ACTIVATION_COMMIT_UNKNOWN', 'Only authenticated committed publication may select target authority.');
    const launch = await this.#options.installed.activation.inspectOpenTarget(context, activationId, committed);
    const publication = launch?.publication;
    check(launch?.backend === 'postgres' && opaque(launch.vaultId)
      && launch.workspaceId === committed.workspaceId && launch.ownerId === committed.ownerContext.memberId
      && publication?.activationId === activationId && publication.targetId === committed.targetId
      && publication.workspaceId === launch.workspaceId && publication.ownerId === launch.ownerId && publication.vaultId === launch.vaultId
      && opaque(publication.operationId) && opaque(publication.creationId) && hashPattern.test(publication.physicalTargetDigest)
      && opaque(publication.storage?.storeId) && opaque(publication.storage.slot) && opaque(publication.storage.incarnation)
      && typeof launch.withWorkspaceAdmission === 'function', 'ACTIVATION_LIVE_CUSTODY',
    'Trusted launch must bind the exact committed target, owner, Vault, native slot and publication.');
    const expected = join(this.#options.input.applicationDirectory, committed.targetId, 'live');
    const directory = await safeDirectory(launch.directory);
    check(directory === await safeDirectory(expected) && resolve(launch.directory) === directory,
      'ACTIVATION_LIVE_CUSTODY', 'Launch must select the canonical final managed live target, not a staging alias.');
    await this.#owner(context);
    return { ...launch, directory, publication: structuredClone(publication) };
  }
}
