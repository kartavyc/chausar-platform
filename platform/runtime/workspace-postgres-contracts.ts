import type { Context, State } from './contracts.ts';
import type { Vault, EncryptedSnapshotAdapter, CreateBootstrapVaultOptions, OpenVaultOptions } from './vault.ts';
import type { WorkspaceInterchangeLocalCustody } from './workspace-interchange-local.ts';
import type { EmptyTargetInspection } from './workspace-interchange-contracts.ts';
import type { WorkspaceBackupV2HostPorts, WorkspaceBackupV2Budgets } from './workspace-backup-v2.ts';
import type { WorkspaceBackupActivationPorts, WorkspaceBackupActivationPolicy } from './workspace-backup-activation.ts';
import type { WorkspaceActivationPorts, WorkspaceActivationPolicy, WorkspaceActivationAuthority,
  WorkspaceActivationCommit, WorkspaceActivationSummary } from './workspace-activation.ts';

/** Constructor-only native identity. No connection URL, password, key or RPC capability. */
export type PostgresWorkspaceStorageIdentity = {
  storeId: string; slot: string; incarnation: string;
};
export type PostgresWorkspaceAuthorityWitness = {
  storage: PostgresWorkspaceStorageIdentity; vaultId: string; revision: number; envelopeDigest: string;
};
export type PostgresWorkspacePublicationBinding = {
  storage: PostgresWorkspaceStorageIdentity; operationId: string; creationId: string;
  targetId: string; physicalTargetDigest: string; activationId: string;
  workspaceId: string; ownerId: string; vaultId: string;
};
export type PostgresWorkspacePublicationPhase = 'reserved' | 'prepared' | 'committed' | 'unknown';

/** A holds native advisory/row exclusion across the complete awaited callback.
 * assertCurrent authenticates actual store/slot/incarnation and current encrypted
 * authority. Calls inside this lease must not reacquire its lock using a second
 * connection or release it through a nested BEGIN/COMMIT. No writable State.
 */
export type PostgresWorkspaceSourceLease = {
  witness: PostgresWorkspaceAuthorityWitness;
  assertCurrent(): Promise<void>;
};
export type PostgresWorkspaceSourceCustody = {
  withSourceLease<T>(expected: PostgresWorkspaceAuthorityWitness | null,
    work: (lease: PostgresWorkspaceSourceLease) => Promise<T>): Promise<T>;
};

export type PostgresWorkspaceStorageOperation = 'create' | 'open' | 'recover' | 'restore';
export type PostgresWorkspaceOpenAdmissionInput = {
  directory: string; operation: PostgresWorkspaceStorageOperation;
  expectedAuthority?: { workspaceId: string; ownerId: string; vaultId?: string };
};
/** A/C recheck the actual publication record, issued final slot and physical
 * target. Hold admission THROUGH work/Engine attach; transfer one owned adapter
 * to Vault. Reject reserved/prepared/unknown targets for all four operations.
 * Ordinary legacy PostgreSQL slots remain supported. No caller supplies a slot.
 */
export type PostgresWorkspaceOpenAdmission = <T>(input: PostgresWorkspaceOpenAdmissionInput,
  work: (adapter: EncryptedSnapshotAdapter) => Promise<T>) => Promise<T>;

/** Only authenticated committed readback can issue this host-local descriptor.
 * Never serialize it through HTTP/IPC. Slot refers to final live/main, not staging.
 */
export type PostgresWorkspaceLaunch = {
  backend: 'postgres'; directory: string; workspaceId: string; ownerId: string; vaultId: string;
  publication: PostgresWorkspacePublicationBinding;
  withWorkspaceAdmission: PostgresWorkspaceOpenAdmission;
};
export type FileWorkspaceLaunch = {
  backend?: 'experimental-file'; directory: string; workspaceId: string; ownerId: string; vaultId: string;
};
export type TrustedWorkspaceLaunch = FileWorkspaceLaunch | PostgresWorkspaceLaunch;
export type WorkspaceActivationTargetInspection = EmptyTargetInspection |
  { status: 'unknown'; targetId: string; reasonCode: 'ACTIVATION_TARGET_RESERVATION_UNAVAILABLE' };

/** B's actual custody exposes existing pure-host ports; it does not replace codecs. */
export type PostgresWorkspaceBackupInstallation = {
  ports: WorkspaceBackupV2HostPorts;
  /** Metadata only: no private bodies, paths, credentials or ciphertext. */
  diagnostics(): unknown;
};
/** C's transaction implementation owns durable candidate/publication claims.
 * The coordinator creates the existing pure bridge/activation hosts from these
 * ports. commit is the cross-store protocol, not a claim of SQL+FS atomicity.
 */
export type PostgresWorkspaceActivationInstallation = {
  bridgePorts: WorkspaceBackupActivationPorts; activationPorts: WorkspaceActivationPorts;
  createTarget(context: Context, targetId: string): Promise<EmptyTargetInspection>;
  inspectTarget(context: Context, targetId: string): Promise<WorkspaceActivationTargetInspection>;
  inspectOpenTarget(context: Context, activationId: string, committed: WorkspaceActivationSummary): Promise<PostgresWorkspaceLaunch>;
  inspectCurrentLive(input: { context: Context; targetId: string; publication: WorkspaceActivationCommit }): Promise<void>;
};
export type PostgresWorkspaceInstallation = {
  source: PostgresWorkspaceAuthorityWitness; journal: PostgresWorkspaceAuthorityWitness;
  backup: PostgresWorkspaceBackupInstallation; activation: PostgresWorkspaceActivationInstallation;
};
export type PostgresWorkspaceInstallInput = {
  sourceVault: Vault; journalVault: Vault; applicationDirectory: string;
  interchange: WorkspaceInterchangeLocalCustody;
  backupBudgets: WorkspaceBackupV2Budgets; backupPolicy: WorkspaceBackupActivationPolicy;
  policy: WorkspaceActivationPolicy;
  assertCompleteOwner(context: Context, historical: State): Promise<void>;
  /** Root cryptographic callbacks; returned Vault is never automatically attached. */
  bootstrap(options: CreateBootstrapVaultOptions): ReturnType<typeof import('./vault.ts').Vault.createBootstrap>;
  openVault(options: OpenVaultOptions): Promise<Vault>;
  targetPassphrase(authority: WorkspaceActivationAuthority): Promise<string>;
};

/** Frozen v1 boundary for independently owned A/B/C implementations. Supplying
 * this trusted constructor capability is not native qualification evidence.
 * Engine never installs it from a payload, demo flag, archive or retained State.
 */
export type EnginePostgresWorkspaceOptions = {
  format: 'chausar.postgres-workspace-profile.v1'; journalVault: Vault;
  policy: WorkspaceActivationPolicy;
  targetPassphrase(authority: WorkspaceActivationAuthority): Promise<string>;
  withWorkspaceAdmission: PostgresWorkspaceOpenAdmission;
  install(input: PostgresWorkspaceInstallInput): Promise<PostgresWorkspaceInstallation>;
};
