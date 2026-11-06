import { type ClaudeInstallPorts } from '../venture/models/claude-code-install.ts';
import { Vault, type EncryptedSnapshotAdapter, type KdfMemo } from '../vault.ts';
import { type PreparedAnswerRecovery, type CompletedAnswerRecovery } from '../answer-recovery.ts';
import { type ReportOptions } from '../reports.ts';
import { type BridgeServiceOptions } from '../bridge-service.ts';
import { type ResearchSearchPort } from '../research-search.ts';
import type { GatewayOptions } from '../gateway.ts';
import type { ReviewedConversationCalculationParameters } from '../conversation-calculation-arguments.ts';
import type { ConversationSynthesisCodec } from '../conversation-synthesis-contract.ts';
import { type BusinessContextManifest } from '../conversation-context.ts';
import { type SpeechOptions } from '../speech.ts';
import { type SyncOptions } from '../sync.ts';
import { type SyncWriterAdmission } from '../sync-writer-admission.ts';
import { digest } from '../actions.ts';
import { type EngineJobOptions, type JobLifecycle } from '../engine-jobs.ts';
import type { CalendarRules } from '../calendar-zone.ts';
import type { CalendarBounds } from '../calendar.ts';
import { type CredentialBroker } from '../connectors.ts';
import { type EngineConnectorOptions } from '../engine-connectors.ts';
import { type WorkspaceBackupV2Budgets, type WorkspaceBackupV2ExternalKeyRequirement } from '../workspace-backup-v2.ts';
import { type WorkspaceBackupV2FilesystemBudgets } from '../workspace-backup-local.ts';
import { type EngineWorkspaceActivationOptions } from '../workspace-activation-engine.ts';
import { type DatabaseCalculatorOptions } from '../analytics.ts';
import { type UpdateServiceOptions } from '../update-service.ts';
import { hash, type Context, type State, type StateStore } from '../contracts.ts';
import type { VentureHostOptions } from '../venture/contracts.ts';
import type { DraftHandoverPort } from '../venture/onboarding-contracts.ts';
import { type DeviceKeyStore } from '../device-custody.ts';
import { type DriveEndpoints, type DriveTokens } from '../drive-backup.ts';
import { type BackupCopySetting } from '../workspace-custody.ts';
import { type BackupCopyView, type RecoveryState, type UnlockMode } from '../workspace-custody-contracts.ts';
import type { Engine } from '../engine.ts';
export type DraftDeskHandle = {
  sampleState(authority: StateStore, state?: State): Promise<State>;
  request(ctx: Context, method: string, payload: unknown): Promise<unknown>;
  /** workspace.create succeeded: reset and pause the idle timer while the owner keeps the plan safe. */
  hold(): void;
  /** Wipes keys, records and the compose session. */
  clear(): void;
  handover: DraftHandoverPort;
};

export type EngineBackupCustodyOptions = {
  budgets?: WorkspaceBackupV2Budgets; filesystemBudgets?: WorkspaceBackupV2FilesystemBudgets;
  externalKeyRequirements?: WorkspaceBackupV2ExternalKeyRequirement[];
  /** Trusted installed host capability, never supplied by an RPC payload. */
  withCompleteOwner?<T>(context: Context, historical: State, work: (assertCurrent: () => void) => Promise<T>): Promise<T>;
};

export type EngineOptions = {
  kdfMemo?: KdfMemo; capture?: { dir: string }; directory: string; version?: string; demo?: boolean; storage?: 'experimental-file' | 'postgres'; postgresUrl?: string; connectorCredentials?: CredentialBroker; connectorRuntime?: EngineConnectorOptions; analytics?: DatabaseCalculatorOptions; sync?: SyncOptions & { writerAdmission?: SyncWriterAdmission }; pythonExecutable?: string; updatePublicKey?: string; durableJobs?: EngineJobOptions; gateway?: GatewayOptions; synthesis?: ConversationSynthesisCodec; reports?: Pick<ReportOptions, 'executionReceipt'>; jobCalendar?: { rules: CalendarRules; bounds: CalendarBounds }; bridge?: Pick<BridgeServiceOptions, 'factorAdmission'>; research?: { search?: ResearchSearchPort }; backupCustody?: EngineBackupCustodyOptions;
  /** Trusted local composition: how the speech service starts the local whisper.cpp (tests inject a stand-in). */
  speech?: SpeechOptions;
  /** Trusted local composition capabilities. Never supplied by an RPC or archive. */
  workspaceActivation?: EngineWorkspaceActivationOptions;
  workspaceAuthority?: { workspaceId: string; ownerId: string; vaultId?: string };
  venture?: VentureHostOptions;
  /** Trusted host composition, never from an RPC: with storage 'postgres', the PostgreSQL vault adapter for a workspace
   * folder, over a pool the host owns. The hosted server uses it for one slot per business (hosted/runtime/business.ts). */
  vaultStorage?: (folder: string) => Promise<EncryptedSnapshotAdapter>;
  /** Trusted host composition (server.ts, worker.ts): keep each business's vault key with this computer's login and
   * write automatic encrypted backups. Absent: today's behaviour, a passphrase for every vault and no automatic backups. */
  workspaceCustody?: { deviceKeys: 'os' | 'none' | DeviceKeyStore; autoBackups: boolean; clock?: () => number };
  /** D5: Install Claude Code. Only the desktop worker passes this, with the real ports; a test passes fakes. Absent: refused. */
  claudeInstall?: { host: 'desktop' | 'hosted-web'; ports: ClaudeInstallPorts; platform?: NodeJS.Platform; environment?: NodeJS.ProcessEnv; onFound?: (path: string) => void };
  /** C5 task 31: the daily update check: main hands the worker the build's key, feed and folder (update-service.ts). Tests add seams. */
  updates?: Omit<UpdateServiceOptions, 'version' | 'isBusy'>;
  /** C5 task 24: the Google client, for tests; a build's comes from package.json. tokens: where tests keep the refresh token. */
  drive?: { clientId: string | null; clientSecret?: string | null; endpoints?: DriveEndpoints; tokens?: DriveTokens; chunkBytes?: number };
};

export const defaultBackupBudgets: WorkspaceBackupV2Budgets = {
  maxArchiveUtf8Bytes: 32 * 1024 * 1024,
  maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 16 * 1024 * 1024, maxEntries: 4096, maxJsonDepth: 128, maxJsonNodes: 200_000
};

export const defaultBackupFilesystemBudgets: WorkspaceBackupV2FilesystemBudgets = { maxFiles: 8192, maxBytes: 128 * 1024 * 1024, maxDepth: 16 };

export const JOURNAL_SWEEP_EVERY_MS = 5 * 60_000;

export const NOTIFY_EVERY_MS = 55_000;

export type ConversationContinuation = {
  schemaVersion: 1; turnId: string; originalQuestion: string; clarification: string;
  sourceIds: string[]; requestScope: BusinessContextManifest['request'] | Record<string, unknown>; digest: string;
  exchanges?: { question: string; clarification: string }[]; reviewedCalculationParameters?: ReviewedConversationCalculationParameters
};

export type AnswerRecoveryRecord = {
  id: string; type: 'answer-recovery-request-v1'; workspaceId: string; memberId: string; epoch: number;
  at: string; preparation: PreparedAnswerRecovery; evidencePin: string; dictionary: { hash: string; version: number };
  status: 'prepared' | 'completed'; lineage?: CompletedAnswerRecovery; integrity: string
};

export function answerRecoveryRecordIntegrity(record: Omit<AnswerRecoveryRecord, 'integrity'> | AnswerRecoveryRecord) {
  // Other output-management flows may add staleness labels. Those labels grant no recovery authority.
  return hash({
    id: record.id, type: record.type, workspaceId: record.workspaceId, memberId: record.memberId, epoch: record.epoch,
    at: record.at, preparation: record.preparation, evidencePin: record.evidencePin, dictionary: record.dictionary,
    status: record.status, lineage: record.lineage ?? null
  });
}

export function transferHint(parsed: any): RecoveryState {
  return parsed?.transfer?.format === 'chausar.transfer.v1' && ['made', 'not-made'].includes(parsed.transfer.recovery) ? parsed.transfer.recovery : 'unknown';
}

export function moveMadeOf(activity: readonly { at: string; event: string }[]): string | null {
  let made: string | null = null;
  for (const item of activity) {
    if (item.event === 'custody.transfer-exported') made = item.at;
    else if (item.event === 'custody.transfer-dismissed') made = null;
  }
  return made;
}

export function copyViewOf(copy: BackupCopySetting | null | undefined): BackupCopyView | null {
  return copy ? { folderName: copy.folder.split(/[\\/]/).filter(Boolean).pop() ?? copy.folder, lastCopiedAt: copy.lastCopiedAt, problem: copy.problem } : null;
}

export type LegacyInternals = {
  store: Vault;
  context: Context;
  services: Engine['services'];
  journalPayload: Engine['journalPayload'];
  privateRestatementContext: Engine['privateRestatementContext'];
  companionRuntime: Engine['companionRuntime'];
  writerStatus: Engine['writerStatus'];
  writerConfiguration: Engine['writerConfiguration'];
  workspacePath: Engine['workspacePath'];
  adapter: Engine['adapter'];
  visibleImports: Engine['visibleImports'];
  visibleActivity: Engine['visibleActivity'];
  executeConversationPlan: Engine['executeConversationPlan'];
  retainConversationAnswer: Engine['retainConversationAnswer'];
  purgeManagedCopies: Engine['purgeManagedCopies'];
  answerRecoveryEvidence: Engine['answerRecoveryEvidence'];
  answerRecoveryView: Engine['answerRecoveryView'];
  answerRecoveryCalculator: Engine['answerRecoveryCalculator'];
  answerRecoveryRead: Engine['answerRecoveryRead'];
  executeAnswerRecovery: Engine['executeAnswerRecovery'];
  workbookBytes: Engine['workbookBytes'];
  workbookInput: Engine['workbookInput'];
  journalWriter: Engine['journalWriter'];
  journalRevision: Engine['journalRevision'];
  createBriefJob: Engine['createBriefJob'];
  jobRunner: Engine['jobRunner'];
  typedJob: Engine['typedJob'];
  runJob: Engine['runJob'];
  openUnlock: UnlockMode | null;
  stageVault(vault: Vault): void;
  jobLifecycle: JobLifecycle;
  recordIntegrity: typeof answerRecoveryRecordIntegrity;
};
