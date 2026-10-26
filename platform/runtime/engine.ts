import { resolve, join, relative, isAbsolute } from 'node:path';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Vault, safeDirectory, type EncryptedSnapshotAdapter, type VaultWriterGuard } from './vault.ts';
import { PostgresSnapshotAdapter } from './postgres.ts';
import { OntologyService } from './ontology.ts';
import { ImportService, importPublicRecord, seedDemo } from './ingest.ts';
import { MemoryService } from './memory.ts';
import { canSeeFact } from './memory.ts';
import { CalculatorService, type CalculatorOptions, type CalculationRequest, type CalculationReceipt } from './calculator.ts';
import { explainAnswerRecovery, prepareAnswerRecovery, assertPreparedAnswerRecoveryCurrent, completeAnswerRecovery,
  type AnswerRecoveryEvidence, type AnswerRecoverySource, type AnswerRecoveryTimeScope, type PreparedAnswerRecovery,
  type CompletedAnswerRecovery } from './answer-recovery.ts';
import { ForecastService } from './forecast-service.ts';
import { AlertsService } from './alerts.ts';
import { ReportService, type ReportOptions } from './reports.ts';
import { createJournalExecutionResolver } from './journal-execution.ts';
import { BridgeService, type BridgeServiceOptions } from './bridge-service.ts';
import { InvestigationService } from './investigations.ts';
import { PostgresInvestigationSearch } from './investigation-search.ts';
import { ResearchSearchService, type ResearchSearchPort } from './research-search.ts';
import { TrustService, sourceAllowed, assertSourceAccess } from './trust.ts';
import { ModelGateway } from './gateway.ts';
import type { GatewayOptions } from './gateway.ts';
import type { ReviewedConversationCalculationParameters } from './conversation-calculation-arguments.ts';
import { conversationPurpose } from './conversation-purpose.ts';
import { ConversationHistoryService, createCalculationAnswerRecord, conversationRecordIntegrity } from './conversation-history.ts';
import { ConversationSynthesisHost } from './conversation-synthesis-host.ts';
import { installedConversationSynthesisCodec } from './conversation-synthesis-codec.ts';
import type { ConversationSynthesisCodec } from './conversation-synthesis-contract.ts';
import { buildBusinessContext, assertBusinessContextCurrent, renderBusinessAnswer, BusinessProfileService, type BusinessContextHooks, type BusinessContextManifest } from './conversation-context.ts';
import { SpeechService, type SpeechOptions } from './speech.ts';
import { AuthService } from './auth.ts';
import { PhoneSessionService } from './engine-phone-sessions.ts';
import { EnginePhoneRuntime, type ReviewedPhoneConversationRequest } from './engine-phone-runtime.ts';
import { createPhoneHttpHandler } from './phone/host.ts';
import { requirePhone } from './phone/contracts.ts';
import type { Brief, ChatAnswer } from './phone/contracts.ts';
import { SyncService, type SyncOptions } from './sync.ts';
import { writerStateDigest, type SyncWriterAdmission, type SyncWriterReview } from './sync-writer-admission.ts';
import { ActionService, digest } from './actions.ts';
import { JobService } from './jobs.ts';
import { createEngineJobRunner, type EngineJobOptions, type JobLifecycle } from './engine-jobs.ts';
import type { Job } from './jobs.ts';
import type { CalendarRules } from './calendar-zone.ts';
import type { CalendarBounds } from './calendar.ts';
import { PluginService } from './plugins.ts';
import { LearningService } from './learning.ts';
import { MCPService } from './mcp.ts';
import { ConnectorService, type CredentialBroker } from './connectors.ts';
import { EngineConnectorService, type EngineConnectorOptions } from './engine-connectors.ts';
import { PrivateTrialHostService } from './private-trial-host.ts';
import type { PrivateTrialAtomicPublication } from './private-trial-host.ts';
import type { PrivateTrialRecipeEvidence } from './private-trial-contracts.ts';
import { producerReplacementPins, producerReplacementOutputDigest, publishProducerReplacement } from './producer-replacement.ts';
import { WorkspaceInterchangeHost } from './workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from './workspace-interchange-local.ts';
import { WorkspaceBackupV2Host, type WorkspaceBackupV2Budgets, type WorkspaceBackupV2ExternalKeyRequirement } from './workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts, type WorkspaceBackupV2FilesystemBudgets } from './workspace-backup-local.ts';
import { EngineWorkspaceActivation, type EngineWorkspaceActivationOptions } from './workspace-activation-engine.ts';
import { readWorkbook, workbookSheetToCSV } from './workbook.ts';
import { DatabaseCalculator, type DatabaseCalculatorOptions } from './analytics.ts';
import { AnalyticalHelper } from './helper.ts';
import { ReleaseUpdater, compareVersions } from './updater.ts';
import { authorize, audit, check, ChausarError, hash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import type { BusinessSnapshot, BusinessSnapshotRead, SecretShelf, VentureClosingPort, VentureHostOptions, VentureRunEvent, VentureWorkspacePort } from './venture/contracts.ts';
import type { DraftHandoverPort } from './venture/onboarding-contracts.ts';
import { deviceKeyFailed, deviceKeysUnavailable, noDeviceKeyStore, osDeviceKeyStore, type DeviceKeyRecord, type DeviceKeyStore, type ProbeResult } from './device-custody.ts';
import { CustodyFiles, MANAGED_COPY_TAIL, backupDue, backupName, computerView, keepBackups, makeTransferCode, newCard, nextBackupAt, nextFolder,
  normalizeTransferCode, parseBackupName, slugFolder, type BackupSchedule, type VaultCard } from './workspace-custody.ts';
import { BACKUP_AFTER_METHODS, CUSTODY_WORDS, TRANSFER, type BackupKind, type BackupView, type CustodyView, type RecoveryState, type UnlockMode } from './workspace-custody-contracts.ts';
import { SNAPSHOT_FORMAT, WorkspaceSnapshots, snapshotDue } from './workspace-snapshots.ts';

/** The engine's view of the draft desk (platform/runtime/venture/draft/): AI and plan state before any vault exists. */
type DraftDeskHandle = {
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
export type EngineOptions = { directory: string; version?: string; demo?: boolean; storage?: 'experimental-file' | 'postgres'; postgresUrl?: string; connectorCredentials?: CredentialBroker; connectorRuntime?: EngineConnectorOptions; analytics?: DatabaseCalculatorOptions; sync?: SyncOptions & { writerAdmission?: SyncWriterAdmission }; pythonExecutable?: string; updatePublicKey?: string; durableJobs?: EngineJobOptions; gateway?: GatewayOptions; synthesis?: ConversationSynthesisCodec; reports?: Pick<ReportOptions, 'executionReceipt'>; jobCalendar?: { rules: CalendarRules; bounds: CalendarBounds }; bridge?: Pick<BridgeServiceOptions, 'factorAdmission'>; research?: { search?: ResearchSearchPort }; backupCustody?: EngineBackupCustodyOptions;
  /** Trusted local composition: how the speech service starts the local whisper.cpp (tests inject a stand-in). */
  speech?: SpeechOptions;
  /** Trusted local composition capabilities. Never supplied by an RPC or archive. */
  workspaceActivation?: EngineWorkspaceActivationOptions;
  workspaceAuthority?: {workspaceId: string; ownerId: string; vaultId?: string};
  venture?: VentureHostOptions;
  /** Trusted host composition, never from an RPC: with storage 'postgres', the PostgreSQL vault adapter for a workspace
   * folder, over a pool the host owns. The hosted server uses it for one slot per business (hosted/runtime/business.ts). */
  vaultStorage?: (folder: string) => Promise<EncryptedSnapshotAdapter>;
  /** Trusted host composition (server.ts, worker.ts): keep each business's vault key with this computer's login and
   * write automatic encrypted backups. Absent: today's behaviour, a passphrase for every vault and no automatic backups. */
  workspaceCustody?: { deviceKeys: 'os' | 'none' | DeviceKeyStore; autoBackups: boolean; clock?: () => number };
};
// Operational admission ceilings reject the complete operation; no namespace is truncated.
const defaultBackupBudgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 32 * 1024 * 1024,
  maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 16 * 1024 * 1024, maxEntries: 4096, maxJsonDepth: 128, maxJsonNodes: 200_000 };
const defaultBackupFilesystemBudgets: WorkspaceBackupV2FilesystemBudgets = { maxFiles: 8192, maxBytes: 128 * 1024 * 1024, maxDepth: 16 };
/** How often the scheduler tick sweeps the venture action journal (venture/build/journal-sweep.ts). */
const JOURNAL_SWEEP_EVERY_MS = 5 * 60_000;
/**
 * How often the scheduler tick lets the notification centre look at Today (venture/notify/centre.ts, Ink v2 wave 4 4G1):
 * a little under a minute, so the hosted app's 60 s housekeeping tick looks every time, never every other minute (4G3).
 */
export const NOTIFY_EVERY_MS = 55_000;

/** Trusted host result. Identifiers and private scope are not automatic outbound disclosure. */
export type ConversationContinuation = { schemaVersion: 1; turnId: string; originalQuestion: string; clarification: string;
  sourceIds: string[]; requestScope: BusinessContextManifest['request'] | Record<string, unknown>; digest: string;
  exchanges?: { question: string; clarification: string }[]; reviewedCalculationParameters?: ReviewedConversationCalculationParameters };

type AnswerRecoveryRecord = { id: string; type: 'answer-recovery-request-v1'; workspaceId: string; memberId: string; epoch: number;
  at: string; preparation: PreparedAnswerRecovery; evidencePin: string; dictionary: { hash: string; version: number };
  status: 'prepared' | 'completed'; lineage?: CompletedAnswerRecovery; integrity: string };
function answerRecoveryRecordIntegrity(record: Omit<AnswerRecoveryRecord, 'integrity'> | AnswerRecoveryRecord) {
  // Other output-management flows may add staleness labels. Those labels grant no recovery authority.
  return hash({ id: record.id, type: record.type, workspaceId: record.workspaceId, memberId: record.memberId, epoch: record.epoch,
    at: record.at, preparation: record.preparation, evidencePin: record.evidencePin, dictionary: record.dictionary,
    status: record.status, lineage: record.lineage ?? null });
}

/** The sole product authority. The renderer receives named, bounded results only. */
/** The recovery state a move file says it carries (plaintext metadata, written by transfer.export). */
function transferHint(parsed: any): RecoveryState {
  return parsed?.transfer?.format === 'chausar.transfer.v1' && ['made', 'not-made'].includes(parsed.transfer.recovery) ? parsed.transfer.recovery : 'unknown';
}
export class Engine {
  options: EngineOptions;
  readonly version: string;
  vault: Vault | null = null;
  #baseContext: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  #requestContext = new AsyncLocalStorage<Context>();
  #stagedVaults = new Set<Vault>();
  #transition = false;
  #activeRequests = 0;
  #closing = false;
  #companion: { store: Vault; sessions: PhoneSessionService; runtime: EnginePhoneRuntime } | undefined;
  #idleWaiters = new Set<() => void>();
  /**
   * Long local work a closing workspace stops (a transcript being made, Ink v2 wave 2 2E2): lock, close, switch and
   * quit abort the signal, and wait (capped) for the requests to end instead of answering VAULT_BUSY.
   */
  #stopWork = new AbortController();
  #stoppable = 0;
  #closingPort: VentureClosingPort = (() => {
    const engine = this;
    return Object.freeze({
      get signal() { return engine.#stopWork.signal; },
      hold: () => { engine.#stoppable += 1; let released = false; return () => { if (!released) { released = true; engine.#stoppable -= 1; } }; },
    });
  })();
  #searchAdapter: Promise<PostgresInvestigationSearch> | null = null;
  #unknownAnswerRecoveries = new Set<string>();
  #answerRecoveryExecutions = new Map<string, Promise<void>>();
  // Unknown host state is closed to scheduled dispatch. Only a trusted host sets it.
  #jobLifecycle: JobLifecycle = { awake: false, windowOpen: false, backgroundEnabled: false };
  get context(): Context { return this.#requestContext.getStore() || this.#baseContext; }
  set context(value: Context) { this.#baseContext = { ...value }; }
  services: Record<string, any> = {};
  // Ink v2 wave 4 (4G3): settle and outsideWork wait for phone alerts under way; endPushSessions ends a hosted session's subscriptions.
  #venture: { request(ctx: Context, method: string, payload: unknown): Promise<unknown>; close(): void; settle(timeoutMs?: number): Promise<void>; outsideWork(): Promise<void> | null } | null = null;
  #venturePromise: Promise<{ request(ctx: Context, method: string, payload: unknown): Promise<unknown>; close(): void; shareLink(ctx: Context, op: 'page' | 'decide' | 'comment' | 'upload', token: string, input?: unknown): Promise<unknown>; endPushSessions(ctx: Context, hashes: readonly string[]): Promise<number>; settle(timeoutMs?: number): Promise<void>; outsideWork(): Promise<void> | null }> | null = null;
  #ventureModule() {
    return import('./venture/host.ts').catch(() => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); });
  }
  // The draft desk: one per engine process, memory only, loaded on the first draft request. Keys never touch disk.
  #draft: DraftDeskHandle | null = null;
  #draftPending: Promise<DraftDeskHandle> | null = null;
  #draftDesk(): Promise<DraftDeskHandle> {
    if (this.#draft) return Promise.resolve(this.#draft);
    const pending = this.#draftPending ??= import('./venture/draft/index.ts').then(module => {
      const desk = module.createDraftDesk({
        ...(this.options.venture ?? {}), demo: !!this.options.demo,
        ventureExists: () => !!this.vault && this.vault.read().conversations.some(record => record?.kind === 'venture-record'),
        vaultOpen: () => !!this.vault,
      }) as DraftDeskHandle;
      this.#draft = desk;
      return desk;
    });
    pending.catch(() => { if (this.#draftPending === pending) this.#draftPending = null; });
    return pending.catch(() => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); });
  }
  /** What venture.create sees: the desk when it is loaded, else nothing to adopt. Trusted host composition only. */
  #draftHandover: DraftHandoverPort = Object.freeze({
    ai: () => this.#draft?.handover.ai() ?? null,
    compose: (composeId: string) => this.#draft?.handover.compose(composeId) ?? null,
    moveKeys: (target: SecretShelf) => { this.#draft?.handover.moveKeys(target); },
    settle: () => { this.#draft?.handover.settle(); },
  });
  // Run events for the Ink frontend: the desktop worker forwards them over IPC, the local server streams them at /api/events.
  #ventureEventListeners = new Set<(event: VentureRunEvent) => void>();
  /** Trusted host hook: hears each run event a venture action committed. Returns the unsubscribe function. */
  onVentureEvent(listener: (event: VentureRunEvent) => void): () => void {
    this.#ventureEventListeners.add(listener);
    return () => { this.#ventureEventListeners.delete(listener); };
  }
  #publishVentureEvents(events: VentureRunEvent[]) {
    for (const event of events) for (const listener of [...this.#ventureEventListeners]) {
      try { listener(Object.freeze({ ...event })); } catch { /* A listener's failure is its own. */ }
    }
  }
  // Whether the owner is looking at Chausar (Ink v2 wave 4, 4G1): the desktop window shown, not minimised and focused,
  // or the owner's own event stream (the local server's /api/events). Alerts outside the app wait while they are and
  // for 2 minutes after (venture/notify).
  #watchers = 0;
  #windowWatched = false;
  #watchedAt = 0;
  /** Trusted host hook: the owner's event stream opened. Returns its release, which the host calls when it closes. */
  watchEvents(): () => void {
    this.#watchers += 1;
    let open = true;
    return () => { if (!open) return; open = false; this.#watchers -= 1; this.#watchedAt = Date.now(); };
  }
  /** Trusted host hook (the desktop main process, through the worker): the window is shown, not minimised and focused. */
  updateOwnerWatching(watching: boolean): void {
    if (this.#windowWatched && watching !== true) this.#watchedAt = Date.now();
    this.#windowWatched = watching === true;
  }
  /** Now while the owner is looking; else when they last were; null when not since this process started. */
  #watchingAt(): string | null {
    if (this.#watchers > 0 || this.#windowWatched) return new Date().toISOString();
    return this.#watchedAt ? new Date(this.#watchedAt).toISOString() : null;
  }
  /** What Today's queue may know about the businesses on this computer. The id is the workspace folder, as in workspace.list. */
  #ventureWorkspace: VentureWorkspacePort = Object.freeze({
    current: () => {
      const workspace = this.vault?.read().workspace;
      return { id: this.#openFolder ?? workspace?.id ?? 'main', name: workspace?.name ?? '' };
    },
    businesses: async () => this.options.venture?.host === 'hosted-web' ? []
      : (await this.custodyFiles().listBusinesses(this.storageKind())).businesses.map(item => ({ id: item.folder, name: item.name, opens: item.opens, openedAt: item.openedAt })),
    recovery: async () => this.options.venture?.host === 'hosted-web' || !this.custodyHost() ? null : (await this.custodyView()).business?.recovery ?? null,
    // Keeper's backups job (Ink v2 wave 4, 4A1): whether automatic backups are on and the automatic ones only (a copy
    // made by hand or a safety copy is not Keeper's run), with the schedule's last error; none on the hosted app.
    backups: async () => {
      const custody = this.custodyHost(), vault = this.vault;
      if (this.options.venture?.host === 'hosted-web' || !custody || !vault) return null;
      const automatic = (await this.custodyFiles().backupFiles(vault.read().workspace.id)).filter(file => file.kind === 'auto');
      const view = (await this.custodyView()).business?.backups;
      return { auto: !!custody.autoBackups, count: automatic.length, newestAt: automatic[0] ? new Date(automatic[0].at).toISOString() : null, nextDueAt: view?.nextDueAt ?? null, lastError: view?.lastError ?? null };
    },
    // Business snapshots (Ink v2 wave 4, 4J6): the other businesses as Chausar saved them when each was last open; a
    // passphrase one is locked and never read; none on the hosted app.
    snapshots: async () => this.snapshotReads(),
    // The never-contact list the businesses on this computer share (C10), as keyed checks; nothing on the hosted app.
    neverContact: Object.freeze({
      has: async (values: readonly string[]) => this.snapshotStore()?.neverContactHas(values) ?? false,
      add: async (values: readonly string[]) => { await this.snapshotStore()?.neverContactAdd(values); },
    }),
  });
  #ventureHost() {
    const vault = this.store();
    const pending = this.#venturePromise ??= this.#ventureModule().then(({ VentureHost }) => {
      check(this.vault === vault, 'VAULT_LOCKED', 'Open your workspace first.');
      const venture = this.options.venture ?? {};
      const host = new VentureHost(vault, { calculator: this.services.calculator, ontology: this.services.ontology, trust: this.services.trust, helper: this.services.helper, speech: this.services.speech },
        { ...venture, demo: !!this.options.demo, storage: this.options.storage === 'postgres' ? 'postgres' : 'experimental-file',
          ...(venture.host === 'hosted-web' ? {} : { draft: this.#draftHandover }),
          workspace: venture.workspace ?? this.#ventureWorkspace,
          notify: (events: VentureRunEvent[]) => { venture.notify?.(events); this.#publishVentureEvents(events); },
          watching: venture.watching ?? (() => this.#watchingAt()),
          // Phone alerts run as the owner inside the app, whoever's request started the look (4G3).
          ownerContext: venture.ownerContext ?? (() => ({ ...this.#baseContext })),
          closing: this.#closingPort });
      this.#venture = host;
      return host;
    });
    pending.catch(() => { if (this.#venturePromise === pending) this.#venturePromise = null; });
    return pending;
  }
  constructor(options: EngineOptions) { this.version = options.version ?? '0.1.0-preview.1'; compareVersions(this.version, this.version); this.options = { ...options, directory: resolve(options.directory) }; }
  /** Resolve retained objective text only through current private authority. No inference or resend. */
  conversationContinuation(ctx: Context, id: string, view: StateStore = this.store(), resolvedByModelReceiptId?: string): ConversationContinuation {
    authorize(view, ctx);
    const state = view.read(), records = state.conversations.filter(record => record?.id === id), record = records[0];
    const unavailable = 'CONVERSATION_CONTINUATION_UNAVAILABLE';
    check(typeof id === 'string' && records.length === 1 && record?.kind === 'conversation-clarification-answer'
      && record.memberId === ctx.memberId && record.epoch === ctx.epoch && record.integrity === conversationRecordIntegrity(record), unavailable, 'This pending clarification is unavailable.');
    check(typeof record.question === 'string' && record.question.trim().length > 0 && record.question.length <= 8000
      && Number.isFinite(Date.parse(record.at)) && Number.isFinite(state.policy.retentionDays) && state.policy.retentionDays >= 0
      && Date.parse(record.at) >= Date.now() - state.policy.retentionDays * 86400000, unavailable, 'This pending clarification is unavailable.');
    const model = this.services.gateway.assertConversationReceipt(ctx, record.modelReceiptId, view);
    const models = state.modelReceipts.filter(item => item?.id === record.modelReceiptId);
    check(models.length === 1 && hash(models[0]) === hash(model), unavailable, 'This pending clarification is unavailable.');
    check(model.naturalQuestion === record.question && model.plan?.kind === 'clarification' && model.businessContext?.request
      && hash(model.sourceIds) === hash([...(model.reviewedCalculationParameters !== undefined
        ? model.businessContext.request.sourceIds ?? model.businessContext.sourceIds : model.businessContext.sourceIds)].sort())
      && model.businessContext.sourceIds.every((sourceId: string) => model.sourceIds.includes(sourceId)), unavailable, 'This pending clarification is unavailable.');
    const expected = { clarification: model.plan.clarification, modelReceiptId: model.id };
    check(hash(record.answer) === hash(expected), unavailable, 'This pending clarification is unavailable.');
    const rowIds = [...new Set<string>([...(model.factIds ?? []), ...(model.rowIds ?? [])])].sort();
    const sourceIds = [...new Set<string>([...(model.sourceIds ?? []),
      ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
    check(hash(record.rowIds) === hash(rowIds) && hash(record.sourceIds) === hash(sourceIds), unavailable, 'This pending clarification is unavailable.');
    assertSourceAccess(state, ctx, sourceIds);
    const resolutions = state.conversations.filter(item => item?.kind === 'conversation-continuation-resolved' && item.continuationId === id);
    if (resolutions.length) {
      const resolution = resolutions[0], answers = state.conversations.filter(item => item?.id === resolution.answerId), answer = answers[0];
      check(resolutions.length === 1 && resolution.memberId === ctx.memberId && resolution.epoch === ctx.epoch && resolution.integrity === conversationRecordIntegrity(resolution)
        && answers.length === 1 && answer.memberId === ctx.memberId && answer.epoch === ctx.epoch && answer.modelReceiptId === resolution.modelReceiptId
        && answer.integrity === conversationRecordIntegrity(answer), unavailable, 'This clarification has already been continued.');
      check(resolvedByModelReceiptId !== undefined, 'CONVERSATION_CONTINUATION_RESOLVED', 'This clarification has already been answered. Start a new question.');
      check(typeof resolvedByModelReceiptId === 'string' && resolution.modelReceiptId === resolvedByModelReceiptId, unavailable, 'This clarification has already been continued by a different turn.');
    }
    // Preserve selected zero-row sources separately from observed fact lineage.
    const selectedSourceIds = [...(model.businessContext.request.sourceIds ?? model.sourceIds)].sort();
    assertSourceAccess(state, ctx, selectedSourceIds);
    const prior = model.continuation, exchanges = [...(prior?.exchanges ?? (prior ? [{ question: prior.originalQuestion, clarification: prior.clarification }] : [])),
      { question: record.question, clarification: model.plan.clarification }];
    check(exchanges.length <= 8, 'CONVERSATION_CONTINUATION_LIMIT', 'This clarification chain is full. Start a new question.');
    const body = { schemaVersion: 1 as const, turnId: id, originalQuestion: prior?.originalQuestion ?? record.question, clarification: model.plan.clarification,
      exchanges, sourceIds: selectedSourceIds, requestScope: structuredClone(model.businessContext.request),
      ...(model.reviewedCalculationParameters !== undefined ? { reviewedCalculationParameters: structuredClone(model.reviewedCalculationParameters) } : {}) };
    check(Buffer.byteLength(JSON.stringify(body)) <= 65536, 'CONVERSATION_CONTINUATION_LIMIT', 'This clarification context is too long. Start a new question.');
    return { ...body, digest: hash(body) };
  }
  private resolveContinuationTurn(ctx: Context, model: any, answerId: string, state: ReturnType<StateStore['read']>) {
    if (model.continuationId === undefined) return;
    const store = this.store(), view = { read: () => state, update: store.update.bind(store) };
    // The resulting answer and consumption marker commit together. Failure leaves the objective pending.
    const continuation = this.conversationContinuation(ctx, model.continuationId, view);
    check(continuation.digest === model.continuationDigest && hash(continuation) === hash(model.continuation),
      'CONVERSATION_CONTINUATION_UNAVAILABLE', 'The pending objective changed before this turn could be retained.');
    const answer = state.conversations.find(item => item?.id === answerId);
    check(answer && answer.modelReceiptId === model.id && answer.memberId === ctx.memberId && answer.epoch === ctx.epoch,
      'CONVERSATION_CONTINUATION_UNAVAILABLE', 'Retain the resulting turn before resolving its clarification.');
    const record = { id: newId('conversation_resolution'), kind: 'conversation-continuation-resolved', at: now(), memberId: ctx.memberId, epoch: ctx.epoch,
      continuationId: model.continuationId, answerId, modelReceiptId: model.id,
      sourceIds: [...new Set<string>([...continuation.sourceIds, ...answer.sourceIds])].sort(), rowIds: [...answer.rowIds] };
    state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
  }
  private async retainConversationAnswer(ctx: Context, question: string, answer: any, manifest?: BusinessContextManifest, modelReceiptId?: string) {
    const store = this.store(), s = this.services;
    let result = answer;
    if (manifest) {
      const id = newId('business_answer');
      result = { ...result, id, receipt: { id, kind: 'business-context-receipt', contextDigest: manifest.digest, financialCalculation: false,
        sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, ...(modelReceiptId ? { modelReceiptId } : {}) } };
    }
    const record = await store.update(state => {
      const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx);
      let saved: any;
      if (manifest) {
        assertBusinessContextCurrent(view, ctx, manifest, s.businessContextHooks);
        const body = { id: result.id, kind: 'business-context-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question,
          manifest, answer: structuredClone(result), sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, profileIds: manifest.profileIds };
        saved = { ...body, integrity: conversationRecordIntegrity(body) };
      } else {
        const receiptId = result.receipt?.id ?? (result.figures ? result.id : undefined);
        saved = receiptId ? createCalculationAnswerRecord(ctx, question, result, s.conversationHistory.currentReceipt(ctx, receiptId, view))
          : { id: newId('message'), at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question, role: 'user' };
      }
      state.conversations.push(saved); return structuredClone(saved);
    });
    return { answer: result, record };
  }
  private async executeConversationPlan(ctx: Context, request: any, gateway: Extract<Awaited<ReturnType<ModelGateway['execute']>>, { kind: 'conversation' }>) {
    const s = this.services, store = this.store();
    const model = s.gateway.assertConversationReceipt(ctx, gateway.receipt.id);
    if (gateway.plan.kind === 'clarification') {
      const id = newId('conversation_clarification');
      const answer = { clarification: gateway.plan.clarification, modelReceiptId: model.id };
      await store.update(state => {
        const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx);
        const current = s.gateway.assertConversationReceipt(ctx, model.id, view);
        check(current.plan.kind === 'clarification' && current.plan.clarification === answer.clarification, 'PAYLOAD_CHANGED', 'The admitted clarification changed.');
        const rowIds = [...new Set<string>([...(current.factIds ?? []), ...(current.rowIds ?? [])])].sort();
        const sourceIds = [...new Set<string>([...(current.sourceIds ?? []),
          ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
        const record = { id, kind: 'conversation-clarification-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question: request.question,
          answer, modelReceiptId: current.id, sourceIds, rowIds };
        state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
        this.resolveContinuationTurn(ctx, current, id, state);
      });
      return answer;
    }
    const results: any[] = [], children: any[] = [], resultRefs: { tool: string; answerId: string }[] = [];
    for (const call of gateway.plan.calls) {
      s.gateway.assertConversationReceipt(ctx, model.id);
      try {
        let answer: any, manifest: BusinessContextManifest | undefined;
        if (call.tool === 'business.describe') {
          manifest = model.businessContext;
          answer = renderBusinessAnswer(store, ctx, manifest!, call.args, s.businessContextHooks);
        } else {
          // Source admission precedes version/conflict resolution and arithmetic.
          // Empty reviewed scopes stay empty; they never mean "all visible".
          check(model.businessContext?.request
            && hash(model.sourceIds) === hash([...(model.reviewedCalculationParameters !== undefined
              ? model.businessContext.request.sourceIds ?? model.businessContext.sourceIds : model.businessContext.sourceIds)].sort())
            && model.businessContext.sourceIds.every((sourceId: string) => model.sourceIds.includes(sourceId)),
            'TOOL_SCOPE_CHANGED', 'The calculation source scope no longer matches the exact reviewed source admission.');
          const scope = model.businessContext.request, args: any = { ...call.args, sourceIds: [...(model.businessContext.request.sourceIds ?? model.sourceIds)] };
          for (const key of ['period', 'branch'] as const) if (scope[key] !== undefined) {
            check(args[key] === undefined || hash(args[key]) === hash(scope[key]), 'TOOL_SCOPE_CHANGED', 'The calculation must use the exact reviewed scope.'); args[key] = scope[key];
          }
          // Comparison periods and scenario assumptions come only from the admitted
          // planner arguments, already validated against the exact owner review.
          for (const key of ['comparePeriod', 'assumptions'] as const) if (args[key] !== undefined)
            check(model.reviewedCalculationParameters?.[key] !== undefined && hash(args[key]) === hash(model.reviewedCalculationParameters[key]),
              'TOOL_SCOPE_CHANGED', 'The calculation inputs differ from the exact reviewed owner parameters.');
          for (const key of ['asOf', 'onDate'] as const) if (scope[key] !== undefined) args[key] = scope[key];
          answer = await s.calculator.calculate(ctx, args);
          check(answer.sourceIds.every((id: string) => model.sourceIds.includes(id)) && answer.rowIds.every((id: string) => model.factIds.includes(id)),
            'TOOL_SCOPE_CHANGED', 'The calculation used evidence outside the reviewed source scope.');
        }
        s.gateway.assertConversationReceipt(ctx, model.id);
        const saved = await this.retainConversationAnswer(ctx, request.question, answer, manifest, model.id);
        results.push({ tool: call.tool, answer: saved.answer }); children.push(saved.record); resultRefs.push({ tool: call.tool, answerId: saved.record.id });
      } catch (error) {
        if (!(error instanceof ChausarError)) throw error;
        results.push({ tool: call.tool, error: { code: error.code, message: error.message.slice(0, 512) } });
      }
      // A scope, grant, route or privacy change withholds the whole response, including earlier results.
      s.gateway.assertConversationReceipt(ctx, model.id);
    }
    const id = newId('conversation_tools');
    const answer = { id, kind: 'grounded-conversation', results, modelReceiptId: model.id,
      receipt: { id, kind: 'conversation-tool-receipt', modelReceiptId: model.id, resultRefs } };
    await store.update(state => {
      const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx); s.gateway.assertConversationReceipt(ctx, model.id, view);
      // Readback rechecks each retained child; no recalculation or new provider invocation.
      for (const ref of resultRefs) s.conversationHistory.get(ctx, ref.answerId);
      const rowIds = [...new Set<string>([...(model.factIds ?? []), ...(model.rowIds ?? []), ...children.flatMap(child => child.rowIds ?? [])])].sort();
      const sourceIds = [...new Set<string>([...(model.sourceIds ?? []), ...children.flatMap(child => child.sourceIds ?? []),
        ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
      const record = { id, kind: 'conversation-tools-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question: request.question,
        answer, resultRefs, modelReceiptId: model.id, sourceIds, rowIds };
      state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
      this.resolveContinuationTurn(ctx, model, id, state);
    });
    return answer;
  }
  contextForSession(token: string, channel: Context['channel'] = 'desktop'): Context { this.store(); return this.services.auth.authenticate(token, channel); }
  /** Fixed loopback companion host; authority comes only from the current encrypted workspace. */
  private companionRuntime() {
    check(!this.#closing && !this.#transition, 'VAULT_BUSY', 'The current workspace is not available for companion requests.');
    const store = this.store();
    if (this.#companion?.store === store) return this.#companion;
    const sessions = new PhoneSessionService(store);
    const runtime = new EnginePhoneRuntime(store, sessions, {
      review: (ctx, request, view) => {
        const matches = view.read().modelReceipts.filter(item => item.id === request.previewId);
        requirePhone(matches.length === 1, 'PREVIEW_CHANGED');
        const model = ['dispatching', 'failed'].includes(matches[0].status)
          ? this.services.gateway.assertDispatchedConversationRequest(ctx, request, view)
          : this.services.gateway.assertReviewedConversationRequest(ctx, request, view);
        return { sourceIds: [...model.sourceIds], operationVersion: hash({ schemaDigest: model.schemaDigest,
          dictionaryHash: model.publishedCalculations.dictionaryHash, dictionaryVersion: model.publishedCalculations.dictionaryVersion }) };
      },
      executeConversation: (ctx, request) => this.requestAs(ctx, 'conversation.ask', request),
      reconcileConversation: (ctx, previewId, view) => this.companionConversation(ctx, previewId, view),
      briefs: (ctx, view) => this.companionBriefs(ctx, view),
      receipt: (ctx, id, view) => {
        // Reuse the current history boundary, including receipt/fact retention
        // and its actual calculator/managed-source readiness guards on this view.
        const receipt = new ConversationHistoryService(view, this.services.conversationHistory.options).currentReceipt(ctx, id, view);
        return { id: receipt.id, workspaceId: view.read().workspace.id, text: this.companionAnswerText(receipt) };
      },
    });
    this.#companion = { store, sessions, runtime }; return this.#companion;
  }
  async handleCompanionHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    check(!this.#closing && !this.#transition, 'VAULT_BUSY', 'Wait for the workspace operation to finish.');
    this.#activeRequests++;
    try { await createPhoneHttpHandler(this.companionRuntime().runtime.host)(request, response); }
    finally { this.#activeRequests--; this.notifyIdle(); }
  }
  /** Project already guarded local text and exact displayed figures; never synthesize a new answer. */
  private companionAnswerText(answer: any): string {
    const parts: string[] = [];
    if (answer?.kind === 'grounded-conversation') {
      for (const result of answer.results) parts.push(result.error
        ? `Unable to complete this part: ${result.error.message}` : this.companionAnswerText(result.answer));
    } else {
      const explanation = answer?.text ?? answer?.message ?? answer?.explanation ?? answer?.clarification;
      if (typeof explanation === 'string') parts.push(explanation);
      for (const figure of answer?.figures ?? answer?.receipt?.figures ?? []) parts.push(`${figure.label}: ${figure.display}`);
      for (const gap of answer?.coverage?.gaps ?? []) parts.push(`Coverage: ${gap}`);
    }
    const text = parts.filter(Boolean).join('\n');
    requirePhone(text.length > 0 && text.length <= 64000, 'OPEN_DESKTOP'); return text;
  }
  private companionConversation(ctx: Context, previewId: string, view: StateStore): ChatAnswer | undefined {
    authorize(view, ctx);
    const records = view.read().conversations.filter(item => ['conversation-tools-answer', 'conversation-clarification-answer'].includes(item.kind)
      && item.modelReceiptId === previewId && item.memberId === ctx.memberId && item.epoch === ctx.epoch);
    if (!records.length) return undefined;
    requirePhone(records.length === 1, 'CACHE_INVALID');
    this.services.gateway.assertConversationReceipt(ctx, previewId, view);
    const history = new ConversationHistoryService(view, this.services.conversationHistory.options);
    const saved = history.get(ctx, records[0].id), receiptIds: string[] = [];
    for (const ref of records[0].resultRefs ?? []) {
      const child = history.get(ctx, ref.answerId);
      if (child.kind === 'calculation') {
        const receiptId = child.answer.receipt?.id ?? child.answer.id;
        history.currentReceipt(ctx, receiptId, view); receiptIds.push(receiptId);
      }
    }
    return { conversationId: saved.id, text: this.companionAnswerText(saved.answer), receiptIds: [...new Set(receiptIds)] };
  }
  private companionBriefs(ctx: Context, view: StateStore): Brief[] {
    const installed = this.services.jobs as JobService;
    const jobs = new JobService(view, { clock: installed.clock, deliverableGuard: installed.deliverableGuard,
      calendarRules: installed.calendarRules, calendarBounds: installed.calendarBounds });
    const briefs: Brief[] = [];
    for (const job of jobs.list(ctx)) {
      const deliverable = job.deliverable as any, result = deliverable?.result;
      if (job.type !== 'owner-brief' || job.plan || deliverable?.kind !== 'brief' || !result) continue;
      const parts = (result.report?.sections ?? []).map((section: any) => this.companionAnswerText(section));
      for (const gap of result.report?.gaps ?? []) parts.push(`Coverage: ${gap}`);
      for (const item of result.alerts?.items ?? []) parts.push(`${item.label}. Last recorded observation: ${item.observation
        ? `${item.observation.state} at ${item.observation.observedAt}` : 'not observed'}. Retained episodes: ${item.episodes
        .map((episode: any) => `${episode.status} (${episode.severity}${episode.uncertain ? ', uncertain' : ''})`).join('; ') || 'none'}. Evidence: ${item.evidence.state}${item.evidence.issues.length
        ? ` — ${item.evidence.issues.join('; ')}` : ''}.`);
      const summary = parts.join('\n');
      requirePhone(summary.length <= 16000 && briefs.length < 100, 'OPEN_DESKTOP');
      briefs.push({ id: result.id, workspaceId: view.read().workspace.id, version: digest(deliverable),
        generatedAt: deliverable.at, title: result.headline, summary, receiptIds: [...result.receiptIds] });
    }
    return briefs;
  }
  async withContext<T>(context: Context, work: () => T | Promise<T>): Promise<T> {
    const scoped = Object.freeze({ ...context }); if (this.vault) authorize(this.vault, scoped);
    return this.#requestContext.run(scoped, async () => await work());
  }
  async requestAs(context: Context, method: string, payload: any = {}): Promise<any> { return this.withContext(context, () => this.request(method, payload)); }
  /** The hosted /share/<token> page (VentureHost.shareLink). Trusted host only: request() never routes here. */
  async ventureShareLink(context: Context, op: 'page' | 'decide' | 'comment' | 'upload', token: string, input: unknown = {}): Promise<unknown> {
    return this.withContext(context, async () => (await this.#ventureHost()).shareLink(context, op, token, input));
  }
  /** Trusted host hook (the hosted server, 4G3): sessions that signed out or were revoked end their phone alert subscriptions. */
  async ventureEndPushSessions(context: Context, hashes: readonly string[]): Promise<number> {
    return this.withContext(context, async () => (await this.#ventureHost()).endPushSessions(context, hashes));
  }
  /** Trusted host hook (4G3): work the notification centre started outside its looks, or null; the hosted runtime waits on it. */
  ventureOutsideWork(): Promise<void> | null {
    return this.#venture?.outsideWork() ?? null;
  }
  bootstrapContext(): Context {
    if (!this.vault) return { ...this.#baseContext };
    const member = this.currentWorkspaceOwner(this.vault);
    check(member, 'OWNER_REQUIRED', 'The local workspace owner is no longer available.'); return { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  }
  private currentWorkspaceOwner(vault: Vault) {
    const state = vault.read(), authority = this.options.workspaceAuthority;
    check(!authority || state.workspace.id === authority.workspaceId, 'WORKSPACE_AUTHORITY_CHANGED', 'The trusted launch workspace differs from actual encrypted custody.');
    check(!authority?.vaultId || vault.vaultId === authority.vaultId, 'WORKSPACE_AUTHORITY_CHANGED', 'The actual Vault differs from the independently pinned launch identity.');
    return state.members.find(m => m.id === (authority?.ownerId ?? 'owner') && m.active && m.role === 'owner');
  }
  /** Local host launch only: a separately paired Engine/server, explicit fresh
   * credential on workspace.open, and no historical routes/session tokens. */
  async activatedWorkspaceEngine(context: Context, activationId: string): Promise<Engine> {
    const selected = await this.activationHost().inspectOpenTarget(context, activationId);
    return new Engine({directory: selected.directory, version: this.version, demo: true, storage: 'experimental-file',
      workspaceAuthority: {workspaceId: selected.workspaceId, ownerId: selected.ownerId, vaultId: selected.vaultId}});
  }
  private store(): Vault { check(this.vault, 'VAULT_LOCKED', 'Open your workspace first.'); return this.vault; }
  private writerGuard(): VaultWriterGuard | undefined {
    if (this.options.sync === undefined) return undefined;
    return (input, work) => {
      const admission = this.options.sync?.writerAdmission;
      check(admission && admission.deviceId === this.options.sync?.deviceId, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Configured sync requires a reviewed writer admission bound to this device.');
      return admission.run({ ...input, context: this.context }, work);
    };
  }
  private async writerStatus() {
    const vault = this.store(), admission = this.options.sync?.writerAdmission;
    if (!admission || admission.deviceId !== this.options.sync?.deviceId) return {
      readonly: true, reason: 'SYNC_WRITER_ADMISSION_REQUIRED', available: false,
      fence: 0, stateDigest: writerStateDigest(vault.read()), localStateDigest: writerStateDigest(vault.read()), grant: null,
      qualification: 'local-cooperative-process-only',
    };
    return { ...await admission.status({ state: vault.read(), vaultId: vault.vaultId, context: this.context }), available: true };
  }
  private async writerConfiguration<T>(work: () => T): Promise<T> {
    const vault = this.store(), guard = this.writerGuard();
    authorize(vault, this.context, 'admin');
    check(guard, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Configure reviewed writer admission before changing device sync.');
    return guard({ state: vault.read(), vaultId: vault.vaultId }, async assertCurrent => {
      assertCurrent();
      const rollback = this.services.sync.configurationCheckpoint();
      try { const result = work(); return { result, committedState: vault.read(), rollback }; }
      catch (error) { rollback(); throw error; }
    });
  }
  private async adapter(folder = 'main') {
    if (this.options.storage === 'experimental-file' && this.options.demo) {
      if (!this.options.vaultStorage) return 'experimental-file' as const;
      // A trusted host's own file store (the hosted server's capped one, 4J23); the same folder-name check first.
      this.workspacePath(folder);
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'experimental-file') { await adapter.close?.(); throw new ChausarError('STORAGE_REQUIRED', 'Experimental file storage needs a file vault adapter.'); }
      return adapter;
    }
    if (this.options.storage === 'postgres' && this.options.vaultStorage) {
      this.workspacePath(folder); // the same folder-name check as the other storage paths
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'postgres') { await adapter.close?.(); throw new ChausarError('INVALID_POSTGRES_CONFIG', 'PostgreSQL storage needs a PostgreSQL vault adapter.'); }
      return adapter;
    }
    check(this.options.storage === 'postgres' && this.options.postgresUrl, 'DATABASE_REQUIRED', 'Production requires configured PostgreSQL. File storage is available only in the explicitly experimental demo.');
    const url = new URL(this.options.postgresUrl);
    check(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
    return PostgresSnapshotAdapter.connect({ host: url.hostname.replace(/^\[|\]$/g, '') as '127.0.0.1' | '::1', port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), vaultSlot: hash(this.workspacePath(folder)) });
  }
  private workspacePath(name = 'main') {
    check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name), 'INVALID_PATH', 'Use a short workspace folder name without path separators.');
    const path = resolve(this.options.directory, name); const rel = relative(this.options.directory, path);
    check(!rel.startsWith('..') && !isAbsolute(rel), 'INVALID_PATH', 'Workspace path is outside the vault folder.'); return path;
  }
  private async attach(vault: Vault) {
    this.#venture?.close(); this.#venture = null; this.#venturePromise = null;
    // A new workspace starts with long local work allowed again.
    if (this.#stopWork.signal.aborted) this.#stopWork = new AbortController();
    // Vault paths are canonicalized when opened. Resolve the independently
    // configured root under the same no-symlink checks before comparing scope
    // (Windows may spell the same directory with a short-name alias).
    const applicationDirectory = await safeDirectory(this.options.directory);
    const owner = this.currentWorkspaceOwner(vault);
    check(owner, 'OWNER_REQUIRED', 'No current owner is available for this vault.');
    this.vault = vault; delete this.services.workspaceActivation;
    this.#unknownAnswerRecoveries.clear();
    this.context = { memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop' };
    const store: StateStore = vault;
    this.services.ontology = new OntologyService(store);
    this.services.imports = new ImportService(store);
    this.services.memory = new MemoryService(store);
    // Preview arithmetic is exact integer math. Production additionally refuses
    // numbers until the registered isolated SQL query verifies the same projection.
    const database = this.options.demo ? null : new DatabaseCalculator(this.options.analytics);
    const connectorRuntime = new EngineConnectorService(store, this.options.connectorRuntime);
    this.services.connectorRuntime = connectorRuntime;
    const calculationOptions: CalculatorOptions = {
      ...(database ? { verifier: (receipt: any) => database.verify(receipt) } : {}),
      consumerGuard: (ctx, request) => connectorRuntime.assertCalculationReady(ctx, request),
      receiptGuard: (ctx, receipt) => connectorRuntime.assertReceiptReady(ctx, receipt),
    };
    this.services.calculator = new CalculatorService(store, calculationOptions);
    this.services.forecasts = new ForecastService(store, calculationOptions);
    // Execution resolution is a trusted host port, never a route or RPC setting.
    const reportOptions: ReportOptions = { ...calculationOptions, executionReceipt: (ctx, id, view) => {
      const resolver = this.options.reports?.executionReceipt ?? createJournalExecutionResolver(this.services.actions);
      return resolver(ctx, id, view);
    }, alertBrief: (ctx, scope, view) => new AlertsService(view, { calculatorOptions: current => {
      const connectors = connectorForView(current);
      return { consumerGuard: (member, request) => connectors.assertCalculationReady(member, request),
        receiptGuard: (member, receipt) => connectors.assertReceiptReady(member, receipt) };
    } }).brief(ctx, scope) };
    this.services.reports = new ReportService(store, reportOptions);
    this.services.bridge = new BridgeService(store, { calculator: calculationOptions, ...this.options.bridge });
    this.services.investigations = new InvestigationService(store, calculationOptions);
    this.services.research = new ResearchSearchService(store, { calculator: calculationOptions, reports: reportOptions,
      adapter: () => this.privateSearchAdapter() });
    this.services.connectors = new ConnectorService(store, { credentialBroker: this.options.connectorCredentials });
    this.services.helper = new AnalyticalHelper({ executable: this.options.pythonExecutable });
    if (this.options.updatePublicKey) this.services.updater = new ReleaseUpdater({ publicKey: this.options.updatePublicKey, version: this.version, stageDirectory: resolve(this.options.directory, 'updates') });
    this.services.trust = new TrustService(store);
    const connectorForView = (view: StateStore) => view === store ? connectorRuntime : new EngineConnectorService(view, this.options.connectorRuntime);
    this.services.privateTrials = new PrivateTrialHostService(store, {
      custody: {
        write: input => vault.writeArtifact(input).then(ref => ({ ...ref, purpose: 'private-trial' as const })),
        read: input => vault.readArtifact(input).then(ref => ({ ...ref, purpose: 'private-trial' as const })),
        list: input => vault.listArtifacts(input).then(refs => refs.map(ref => ({ ...ref, purpose: 'private-trial' as const }))),
        remove: input => vault.removeArtifact(input),
      },
      now,
      resolveRecipeEvidence: (ctx, sourceId) => this.privateRecipeEvidence(ctx, sourceId),
      calculatorGuards: view => {
        const connectors = connectorForView(view);
        return { consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
          receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt) };
      },
      resolvePromotionImpact: (ctx, _fork, _evaluation, strategy) => this.privatePromotionImpact(ctx, this.store().read(), strategy),
      promoteAtomic: (ctx, publication) => this.promotePrivateTrial(ctx, publication),
    });
    const interchangeLocal = createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory,
      assertCompleteOwner: async (ctx, historical) => this.interchangeOwner(ctx, historical) });
    this.services.interchangeLocal = interchangeLocal;
    this.services.interchange = new WorkspaceInterchangeHost(interchangeLocal.ports);
    if (vault.storageKind === 'experimental-file') {
      const backup = this.options.backupCustody;
      const budgets = backup?.budgets ?? defaultBackupBudgets;
      let installedActivation: EngineWorkspaceActivation | undefined;
      const backupLocal = createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
        ...(this.options.workspaceActivation ? {workspaceActivation: {journalVault: this.options.workspaceActivation.journalVault,
          inspectCurrentLive: async (input: Parameters<EngineWorkspaceActivation['inspectCurrentLive']>[0]) => {
            check(installedActivation, 'ACTIVATION_ROOT_REQUIRED', 'Complete the trusted activation composition before live custody inspection.');
            await installedActivation.inspectCurrentLive(input);
          }}} : {}),
        filesystemBudgets: backup?.filesystemBudgets ?? defaultBackupFilesystemBudgets,
        externalKeyRequirements: backup?.externalKeyRequirements ?? [{ provider: 'other', namespace: 'operator/credential-wrappers',
          requirement: 'Retain the operator passphrase or recovery credential separately. Encrypted wrappers do not include that credential.' }],
        assertCompleteOwner: async (ctx, historical) => this.backupCompleteOwner(ctx, historical),
        withCompleteOwner: async (ctx, historical, work) => vault.withCustodyWriterAdmission(async assertVault => {
          const admission = async (assertAdditional: () => void) => {
            const assertCurrent = () => {
              check(this.options.backupCustody === backup, 'BACKUP_HOST_CONFIGURATION_CHANGED', 'Installed custody admission changed during publication.');
              assertVault(); this.backupCompleteOwner(ctx, historical);
              check(assertAdditional() === undefined, 'BACKUP_HOST_GUARD', 'Held readiness admission must be synchronous and complete.');
            };
            assertCurrent(); const result = await work(assertCurrent); assertCurrent(); return result;
          };
          if (!backup?.withCompleteOwner) return admission(() => {});
          let calls = 0;
          const result = await backup.withCompleteOwner(structuredClone(ctx), structuredClone(historical), async assertAdditional => {
            check(++calls === 1 && typeof assertAdditional === 'function', 'BACKUP_HOST_GUARD', 'Use one held installed readiness admission.');
            return admission(assertAdditional);
          });
          check(calls === 1, 'BACKUP_HOST_GUARD', 'Installed admission did not execute the backup publication.'); return result;
        }),
      });
      this.services.backupLocal = backupLocal;
      this.services.backupV2 = new WorkspaceBackupV2Host(backupLocal.ports, budgets);
      const activation = this.options.workspaceActivation;
      if (activation) {
        check(this.options.demo === true && this.options.sync === undefined
          && !vault.read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
        'ACTIVATION_SOURCE_PROFILE', 'This joined activation profile supports explicitly approved synthetic local sources; sync and managed connector activation need their separate qualified profiles.');
        installedActivation = new EngineWorkspaceActivation({...activation, sourceVault: vault, applicationDirectory,
          backup: backupLocal, interchange: interchangeLocal,
          backupPolicy: {approvedSyntheticWorkspaceIds: [...activation.policy.approvedSyntheticWorkspaceIds], backupBudgets: budgets,
            maxMaterialUtf8Bytes: activation.policy.budgets.maxCandidateBytes, maxCandidateUtf8Bytes: activation.policy.budgets.maxCandidateBytes},
          assertCompleteOwner: async (ctx, historical) => {
            check(this.options.workspaceActivation === activation && this.options.sync === undefined,
              'ACTIVATION_HOST_CONFIGURATION_CHANGED', 'Installed activation admission changed during custody.');
            this.backupCompleteOwner(ctx, historical);
            check(!this.store().read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
              'ACTIVATION_SOURCE_PROFILE', 'Current managed connector imports need a separately qualified activation profile.');
          }});
        this.services.workspaceActivation = installedActivation;
      }
    }
    this.services.alerts = new AlertsService(store, { calculatorOptions: view => {
      const connectors = connectorForView(view);
      return {
        consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
        receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt),
      };
    } });
    const businessContextHooks: BusinessContextHooks = { assertEvidenceReady: (ctx, refs, view = store) => {
      this.options.gateway?.businessContext?.assertEvidenceReady?.(ctx, refs, view);
      return connectorForView(view).assertBusinessEvidenceReady(ctx, refs);
    } };
    this.services.businessContextHooks = businessContextHooks;
    this.services.conversationHistory = new ConversationHistoryService(store, {
      assertBusinessContext: (ctx, manifest, view) => assertBusinessContextCurrent(view, ctx, manifest, businessContextHooks),
      receipt: (ctx, id, view) => new CalculatorService(view, {
        receiptGuard: (currentCtx, receipt) => connectorForView(view).assertReceiptReady(currentCtx, receipt),
      }).receipt(ctx, id),
      assertModelReceipt: (ctx, id, view) => this.services.gateway.assertConversationReceipt(ctx, id, view),
      assertSynthesisAnswer: (ctx, record, view) => this.services.synthesisHost.assertRecord(ctx, record, view),
    });
    this.services.synthesisHost = new ConversationSynthesisHost(store, {
      history: view => new ConversationHistoryService(view, this.services.conversationHistory.options),
      planner: (ctx, id, view) => this.services.gateway.assertConversationReceipt(ctx, id, view),
      synthesis: (ctx, id, view) => this.services.gateway.assertSynthesisReceipt(ctx, id, view),
      codec: () => this.options.synthesis ?? this.options.gateway?.synthesisCodec ?? installedConversationSynthesisCodec,
    });
    this.services.businessProfile = new BusinessProfileService(store);
    this.services.gateway = new ModelGateway(store, { ...this.options.gateway, businessContext: businessContextHooks,
      conversationContinuation: (ctx, id, view, resolvedBy) => this.conversationContinuation(ctx, id, view, resolvedBy),
      conversationSynthesis: (ctx, id, view) => this.services.synthesisHost.resolve(ctx, id, view),
      synthesisCodec: this.options.synthesis ?? this.options.gateway?.synthesisCodec ?? installedConversationSynthesisCodec });
    this.services.speech = new SpeechService(store, this.options.speech);
    // The whisper.cpp the owner set up in Connections > Your AI, kept in the vault; never on the hosted server.
    if (this.options.venture?.host !== 'hosted-web') this.services.speech.restoreLocal(store.read());
    this.services.auth = new AuthService(store);
    this.services.sync = new SyncService(store, { ...this.options.sync, vault, requireWriterAdmission: true });
    this.services.actions = new ActionService(store, this.builtinActions(store));
    this.services.jobs = new JobService(store, { clock: this.options.durableJobs?.clock,
      calendarRules: this.options.jobCalendar?.rules, calendarBounds: this.options.jobCalendar?.bounds,
      deliverableGuard: (ctx: Context, job: any, candidateView?: StateStore) => {
      if (!job.deliverable) return true;
      if (job.plan) return this.services.jobRunner?.canRelease(ctx, job) === true;
      const ids = job.deliverable.result?.receiptIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      try {
        const snapshot = store.read();
        const view = candidateView ?? { read: () => structuredClone(snapshot), update: async () => { throw new Error('Brief evidence is read-only.'); } };
        const connectors = connectorForView(view);
        const evidenceOptions = { ...reportOptions,
          consumerGuard: (member: Context, request: CalculationRequest) => connectors.assertCalculationReady(member, request),
          receiptGuard: (member: Context, receipt: CalculationReceipt) => connectors.assertReceiptReady(member, receipt) };
        const calculator = new CalculatorService(view, evidenceOptions);
        // Alert episodes intentionally retain historical receipts. Their current
        // uncertainty and observation state are checked by the exact section pin.
        // Every reference still needs current access; only the current report's
        // arithmetic must be fresh and within current receipt/row retention.
        const reportIds = job.deliverable.result?.report?.receiptIds;
        if (!Array.isArray(reportIds) || reportIds.length === 0 || reportIds.some((id: string) => !ids.includes(id))) return false;
        for (const id of ids) calculator.receipt(ctx, id);
        const history = new ConversationHistoryService(view, this.services.conversationHistory.options);
        for (const id of reportIds) history.currentReceipt(ctx, id, view);
        const currentDecisions = new Set(new ReportService(view, evidenceOptions).decisions(ctx).map((item: any) => item.id));
        const savedAlerts = job.deliverable.result?.alerts;
        if (savedAlerts) {
          if (savedAlerts.configured !== true || savedAlerts.evaluated !== false || typeof savedAlerts.pin !== 'string'
            || !savedAlerts.scope || !Array.isArray(savedAlerts.items)) return false;
          const currentAlerts = reportOptions.alertBrief!(ctx, {
            ...(savedAlerts.scope.branch === null ? {} : { branch: savedAlerts.scope.branch }),
            ...(savedAlerts.scope.sourceIds === null ? {} : { sourceIds: savedAlerts.scope.sourceIds }),
          }, view);
          if (currentAlerts.pin !== savedAlerts.pin || digest(currentAlerts.items) !== digest(savedAlerts.items)) return false;
        }
        return (job.deliverable.result?.decisions ?? []).every((item: any) => currentDecisions.has(item.id));
      } catch { return false; }
    } });
    if (this.options.durableJobs) this.services.jobRunner = createEngineJobRunner(store, this.services.jobs, this.services.actions, calculationOptions, this.options.durableJobs);
    this.services.plugins = new PluginService(store, {});
    this.services.learning = new LearningService(store);
    this.services.mcp = new MCPService(store, { calculations: [{
      name: 'calculate', description: 'Run a published read-only business calculation and return its exact receipt.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: { operation: { type: 'string', enum: ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'revenue', 'net_sales', 'margin', 'aging', 'change', 'scenario'] }, period: { type: 'object' }, asOf: { type: 'string' }, branch: { type: 'string' }, customerId: { type: 'string' }, orderId: { type: 'string' }, comparePeriod: { type: 'object' }, assumptions: { type: 'object' }, onDate: { type: 'string' } } },
      calculate: async (request: any, ctx: Context) => { const receipt = await this.services.calculator.calculate(ctx, request); return { value: receipt.totalMinor, receipt }; },
    }], receiptReader: (ctx: Context, id: string) => this.services.calculator.receipt(ctx, id) });
  }
  private builtinActions(store: StateStore): any {
    const draft = {
      title: 'Create a payment reminder draft', description: 'Creates a local draft. It does not send a message.', impact: 'reversible',
      validate: (payload: any) => { check(payload && typeof payload.invoiceId === 'string' && typeof payload.text === 'string' && payload.text.length <= 4000, 'INVALID_ACTION', 'Provide an invoice and reminder text.'); return payload; },
      execute: async (payload: any, key: string) => store.update(state => {
        const existing = state.conversations.find(item => item.kind === 'reminder-draft' && item.key === key);
        if (existing) { check(hash(existing.payload) === hash(payload), 'IDEMPOTENCY_CONFLICT', 'The draft key belongs to different content.'); return { externalId: existing.id, data: existing, businessSuccess: false }; }
        const item = { id: newId('draft'), key, payload, kind: 'reminder-draft', status: 'drafted', delivered: false, at: now() }; state.conversations.push(item); audit(state, 'reminder.drafted', { draftId: item.id }); return { externalId: item.id, data: item, businessSuccess: false };
      }),
      reconcile: async (payload: any, key: string) => { const item = store.read().conversations.find(item => item.kind === 'reminder-draft' && item.key === key); return { verified: !!item && hash(item.payload) === hash(payload), businessSuccess: false, externalId: item?.id, data: item, absent: !item }; },
      idempotency: 'A stable key identifies a persisted local draft; changed content is refused.', readback: 'Reads the persisted draft and compares its exact content.',
    };
    return [{ id: 'local', title: 'Chausar local workspace', operations: { 'reminder-draft': draft } }];
  }
  async close() {
    if (this.#activeRequests && !this.#transition) await this.stopLongWork();
    check(!this.#activeRequests && !this.#transition, 'VAULT_BUSY', 'Drain pending engine requests before closing its authority.');
    await this.closeVault();
  }
  private async closeVault() {
    // The business's summary for the others on this computer, written again on lock (4J6). Never throws.
    await this.writeSnapshot(true);
    // Phone alerts under way finish first, for 12 s at most (4G3).
    await this.#venture?.settle().catch(() => {});
    this.#venture?.close(); this.#venture = null; this.#venturePromise = null;
    this.#draft?.clear();
    this.services.connectorRuntime?.close();
    this.services.gateway?.clearCredentials(); this.services.speech?.clearCredentials();
    let failure: unknown;
    if (this.#searchAdapter) {
      const pending = this.#searchAdapter; this.#searchAdapter = null;
      const adapter = await pending.catch(() => null);
      try { await adapter?.close(); } catch (error) { failure = error; }
    }
    for (const staged of this.#stagedVaults) {
      try { await staged.close(); this.#stagedVaults.delete(staged); } catch (error) { failure ??= error; }
    }
    if (this.vault) {
      try { await this.vault.close(); this.vault = null; this.services = {}; this.resetCustodySession(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
  private async privateSearchAdapter(): Promise<ResearchSearchPort> {
    if (this.options.research?.search) return this.options.research.search;
    check(this.options.storage === 'postgres' && this.options.postgresUrl, 'SEARCH_DATABASE_REQUIRED',
      'Private token search requires configured local PostgreSQL; no fallback search engine is selected.');
    if (!this.#searchAdapter) {
      const url = new URL(this.options.postgresUrl);
      check(['postgresql:', 'postgres:'].includes(url.protocol), 'INVALID_POSTGRES_CONFIG', 'Use a local PostgreSQL connection URL.');
      this.#searchAdapter = PostgresInvestigationSearch.connect({ host: url.hostname.replace(/^\[|\]$/g, '') as '127.0.0.1' | '::1',
        port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)) }).catch(error => { this.#searchAdapter = null; throw error; });
    }
    return this.#searchAdapter;
  }
  async shutdown(timeoutMs = 70000) {
    check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded engine shutdown deadline.');
    this.#closing = true;
    // Quitting stops a transcript being made: whisper.cpp and ffmpeg never outlive the engine, nor their temp folders.
    this.#stopWork.abort();
    this.services.connectorRuntime?.close();
    this.services.jobRunner?.interruptActive();
    if (this.#activeRequests || this.#transition) await new Promise<void>((accept, reject) => {
      const finished = () => { clearTimeout(timer); this.#idleWaiters.delete(finished); accept(); };
      const timer = setTimeout(() => { this.#idleWaiters.delete(finished); reject(new Error('Engine shutdown exceeded its deadline; unfinished actions require reconciliation.')); }, timeoutMs);
      this.#idleWaiters.add(finished);
    });
    await this.closingBackup();
    await this.closeVault();
    this.#snapshots?.forgetKey(); // the summary key leaves memory with the engine (4J6)
  }
  private notifyIdle() { if (!this.#activeRequests && !this.#transition) for (const finished of this.#idleWaiters) finished(); }
  private async attachSafely(vault: Vault) { try {
    await this.attach(vault);
    // Read-only devices may inspect/review enrollment without mutating recovery
    // state. A reviewed writer later performs ordinary recovery on reopen.
    if (this.options.sync !== undefined && (await this.writerStatus()).readonly) return;
    // Opening holds the Engine transition fence. Do not publish a new authority
    // revision when there is no interrupted work: retained source pins must
    // survive an otherwise read-only lock/reopen.
    if (vault.read().actions.some(action => action.status === 'executing')) await this.services.actions.recoverInterrupted(this.context);
    if (this.services.jobRunner && vault.read().jobs.some(job => job.status === 'running')) await this.services.jobRunner.recoverInterrupted(this.context);
    // The action journal: nothing of this process is in flight while a vault opens, so any claim left behind was
    // interrupted. It becomes outcome_unknown and is never run again on its own. Only for a vault with a business.
    this.#journalSweptAt = Date.now();
    await this.sweepVentureJournal(1);
  } catch (error) { await vault.close(); this.vault = null; this.services = {}; this.resetCustodySession(); throw error; } }
  /** When the tick last swept the action journal (wall clock, ms). Opening a vault sweeps it too. */
  #journalSweptAt = 0;
  /** Sweeps the open business's action journal through the venture host. Never throws; null when it did not run. */
  private async sweepVentureJournal(claimLimitMs?: number): Promise<number | null> {
    const vault = this.vault;
    if (!vault || !vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return null;
    try {
      const host = await this.#ventureHost() as unknown as { sweepJournal?: (ctx: Context, claimLimitMs?: number) => Promise<number | null> };
      if (this.vault !== vault || typeof host.sweepJournal !== 'function') return null;
      return await host.sweepJournal({ ...this.#baseContext }, claimLimitMs);
    } catch { return null; }
  }
  /** At a tick, every few minutes: the journal sweep, with the longest claim limit any effect needs. Never throws. */
  private async journalTick() {
    if (this.#closing || this.#transition || !this.vault || Date.now() - this.#journalSweptAt < JOURNAL_SWEEP_EVERY_MS) return;
    this.#journalSweptAt = Date.now();
    this.#activeRequests++;
    try { await this.sweepVentureJournal(); } finally { this.#activeRequests--; this.notifyIdle(); }
  }
  /** When the tick last let the notification centre look (wall clock, ms). */
  #notifiedAt = 0;
  /**
   * At a tick, once a minute: the notification centre looks at Today, so time alone can bring an alert (quiet hours
   * that ended, the wait between alerts, the digest's hour). Only for a vault with a business. Never throws.
   */
  private async notifyTick() {
    const vault = this.vault;
    if (this.#closing || this.#transition || !vault || Date.now() - this.#notifiedAt < NOTIFY_EVERY_MS) return;
    if (!vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return;
    this.#notifiedAt = Date.now();
    this.#activeRequests++;
    try {
      const host = await this.#ventureHost() as unknown as { notifyTick?: (ctx: Context) => Promise<boolean | null> };
      if (this.vault === vault && typeof host.notifyTick === 'function') await host.notifyTick({ ...this.#baseContext });
    } catch { /* The next tick looks again. */ } finally { this.#activeRequests--; this.notifyIdle(); }
  }
  async request(method: string, payload: any = {}): Promise<any> {
    check(!this.#closing, 'ENGINE_STOPPING', 'The engine is completing pending work before shutdown.');
    const transitions = new Set(['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.delete', 'workspace.transfer.import', 'workspace.backups.restore']);
    const transition = transitions.has(method);
    // Lock, open, switch, delete and restore stop a transcript being made, and wait for it (capped), instead of VAULT_BUSY.
    if (transition && !this.#transition && this.#activeRequests) await this.stopLongWork();
    check(!this.#transition && (!transition || this.#activeRequests === 0), 'VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.');
    if (transition) this.#transition = true; else this.#activeRequests++;
    try {
      const result = await this.handleRequest(method, payload);
      // An important change: the next tick writes an automatic backup (KEYCHAIN-SPEC 4.1).
      if (BACKUP_AFTER_METHODS.includes(method)) this.#schedule.due = true;
      return result;
    }
    finally {
      if (transition) { this.#transition = false; if (this.#stopWork.signal.aborted) this.#stopWork = new AbortController(); } else this.#activeRequests--;
      this.notifyIdle();
    }
  }
  /**
   * Stops long local work (a transcript being made: whisper.cpp and ffmpeg are killed, waited for and their folders
   * removed) and waits for the requests to end, at most twenty seconds. Nothing else is stopped.
   */
  private async stopLongWork(): Promise<void> {
    if (!this.#stoppable) return;
    this.#stopWork.abort();
    if (!this.#activeRequests && !this.#transition) return;
    await new Promise<void>(accept => {
      const finished = () => { clearTimeout(timer); this.#idleWaiters.delete(finished); accept(); };
      const timer = setTimeout(finished, 20000);
      this.#idleWaiters.add(finished);
    });
  }
  private async handleRequest(method: string, payload: any = {}): Promise<any> {
    check(typeof method === 'string' && method.length <= 80 && payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_REQUEST', 'Use a named request with an object payload.');
    if (method === 'workspace.status') return { open: !!this.vault, workspace: this.vault?.read().workspace, storage: this.options.storage, experimental: !!this.options.demo, version: this.version,
      ...(this.options.workspaceCustody ? { ...(this.vault && this.#openUnlock ? { unlock: this.#openUnlock } : {}), closedByOwner: this.#closedByOwner } : {}) };
    if (method === 'venture.countries') return (await this.#ventureModule()).ventureCountries();
    if (method === 'venture.preview') return (await this.#ventureModule()).venturePreview(payload);
    // The ways to earn (4J8); while a vault is open its state is read (never written) so its business says "You run this".
    // The other businesses here say it from what Chausar saved when each was last open (4J6), never their vaults.
    if (method === 'venture.playbooks.list') return (await this.#ventureModule()).venturePlaybooks(payload, this.vault ? { state: this.vault.read(), businessId: (this.options.venture?.workspace ?? this.#ventureWorkspace).current().id } : null,
      (await this.snapshotReads()).flatMap(read => (read.snapshot ? [{ businessId: read.id, name: read.snapshot.name, playbook: read.snapshot.playbook }] : [])));
    // The draft desk answers these before the vault check: connect an AI and compose a plan before any vault exists.
    switch (method) {
      case 'venture.ai.options':
      case 'venture.ai.connect':
      case 'venture.ai.disconnect':
      case 'venture.ai.status':
      case 'venture.ai.calls':
      case 'venture.compose.decide':
      case 'venture.compose.fill':
      case 'venture.compose.get':
      case 'venture.compose.update':
        return (await this.#draftDesk()).request(this.context, method, payload);
    }
    // Keeping the vault key on this computer (KEYCHAIN-SPEC 2 to 4). Answered before the vault check.
    switch (method) {
      case 'workspace.custody.get': return this.custodyView();
      case 'workspace.list': return this.custodyFiles().listBusinesses(this.storageKind());
      case 'workspace.backups.list': return this.backupList();
      case 'workspace.transfer.import': return this.transferImport(payload);
    }
    if (method === 'workspace.create') {
      check(this.options.sync === undefined, 'SYNC_EXISTING_WORKSPACE_REQUIRED', 'Create a local workspace before enrolling its exact identity in device sync.');
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before creating another.');
      check(typeof payload.name === 'string' && payload.name.trim().length >= 2 && payload.name.length <= 100, 'INVALID_NAME', 'Give your business a name.');
      const pack = payload.pack ?? 'ecommerce'; check(new OntologyService({ read: () => { throw new Error('No vault'); }, update: async () => { throw new Error('No vault'); } }).packs().some(p => p.pack === pack), 'UNKNOWN_PACK', 'Choose an available business starter pack.');
      const custody = this.custodyHost(), files = this.custodyFiles(), name = payload.name.trim();
      // No passphrase: this computer keeps a random secret in the passphrase slot (KEYCHAIN-SPEC 2.1, 2.9).
      const computer = payload.passphrase === undefined || payload.passphrase === null;
      if (computer) {
        if (!custody) throw deviceKeysUnavailable('not-configured');
        const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
      }
      const taken = payload.folder === null ? await files.takenFolders() : null;
      let folder: string = taken ? slugFolder(name, taken) : payload.folder ?? 'main';
      this.workspacePath(folder);
      let wroteCard = false, record: DeviceKeyRecord | null = null;
      const secret = computer ? randomBytes(32) : null;
      try {
        let result!: Awaited<ReturnType<typeof Vault.create>>;
        for (;;) {
          if (custody && !(await files.readCard(folder))) {
            await files.writeCard(newCard({ folder, name, demo: !!payload.demo, unlock: computer ? 'this-computer' : 'passphrase', recovery: computer ? 'not-made' : 'made', state: 'creating' }));
            wroteCard = true;
          }
          try { result = await Vault.create({ directory: this.workspacePath(folder), passphrase: secret ? secret.toString('base64url') : payload.passphrase, name, demo: !!payload.demo, storage: await this.adapter(folder) }); break; }
          catch (error) {
            // The engine picked the folder, and an old vault with no card holds that slot (PostgreSQL storage
            // keeps no folder to find): take the next name instead. slugFolder stops after -99.
            if (!taken || (error as ChausarError).code !== 'VAULT_EXISTS') throw error;
            if (wroteCard) { await files.removeCard(folder).catch(() => {}); wroteCard = false; }
            taken.push(folder); folder = slugFolder(name, taken); this.workspacePath(folder);
          }
        }
        if (custody && secret) {
          try { record = await custody.keys.protect(result.vault.vaultId, secret); await files.writeKey(record); }
          catch (error) {
            await result.vault.delete().catch(() => {});
            if (record) { await custody.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
            throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed();
          }
        }
        try {
          await this.attach(result.vault); await this.services.ontology.publish(this.context, pack);
          if (payload.demo) await seedDemo(this.store(), this.context);
          this.#draft?.hold();
          await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: computer ? 'not-made' : 'made', created: true });
          wroteCard = false;
          const recoveryCode = computer ? null : result.recoveryCode;
          return { workspace: this.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase', recoveryKit: recoveryCode, recoveryCode, experimental: !!this.options.demo };
        } catch (error) {
          await result.vault.delete(); this.vault = null; this.services = {}; this.resetCustodySession();
          if (record && custody) { await custody.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
          throw error;
        }
      } catch (error) {
        if (wroteCard) await files.removeCard(folder).catch(() => {});
        throw error;
      } finally { secret?.fill(0); }
    }
    if (method === 'workspace.open') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); this.#draft?.clear();
      const folder = payload.folder ?? payload.path ?? 'main'; this.workspacePath(folder);
      const custody = this.custodyHost(), typed = payload.passphrase !== undefined && payload.passphrase !== null;
      const files = this.custodyFiles(), card = custody ? await files.readCard(folder) : null;
      const unlockWith = async (passphrase: string) => Vault.open({ directory: this.workspacePath(folder), passphrase, storage: await this.adapter(folder), writerGuard: this.writerGuard() });
      const unlockFailed = (error: unknown) => (error as ChausarError)?.code === 'UNLOCK_FAILED';
      const passphraseRequired = () => new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
      // A lock change cut short (KEYCHAIN-SPEC 3.1, 3.2) leaves its marker on the card: the vault may already open the new way.
      const changing = card?.pending === 'to-passphrase' || card?.pending === 'to-this-computer';
      let vault: Vault, how: 'this-computer' | 'typed';
      if (!custody || typed) {
        try { vault = await unlockWith(payload.passphrase); how = 'typed'; }
        catch (error) {
          const secret = custody && changing && unlockFailed(error) && card?.vaultId ? await this.existingComputerSecret(card.vaultId) : null;
          if (!secret) throw error;
          try { vault = await unlockWith(secret); how = 'this-computer'; } catch { throw error; }
        }
      } else if (card?.unlock === 'passphrase') {
        // Try this computer's key only when the change to it was cut short, or a key record for the vault is on disk.
        const record = card.vaultId ? await files.readKey(card.vaultId) : null;
        const secret = card.vaultId && (card.pending === 'to-this-computer' || record) ? await this.existingComputerSecret(card.vaultId) : null;
        if (!secret) throw passphraseRequired();
        try { vault = await unlockWith(secret); how = 'this-computer'; }
        catch (error) { if (unlockFailed(error)) throw passphraseRequired(); throw error; }
      } else {
        // No card and no envelope to read (PostgreSQL storage, or no such folder): it needs a passphrase.
        const secret = await this.computerSecret(card?.vaultId ?? await files.folderVaultId(folder));
        try { vault = await unlockWith(secret); how = 'this-computer'; }
        catch (error) {
          // Turning the passphrase on was cut short after the rewrap: only the passphrase opens it now.
          if (unlockFailed(error)) throw card?.pending === 'to-passphrase' ? passphraseRequired() : deviceKeyFailed();
          throw error;
        }
      }
      await this.attachSafely(vault);
      await this.afterOpen(folder, how);
      return { workspace: this.store().read().workspace };
    }
    if (method === 'workspace.recover') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); this.#draft?.clear();
      const folder = payload.folder ?? 'main'; this.workspacePath(folder);
      const custody = this.custodyHost(), computer = !!custody && (payload.passphrase === undefined || payload.passphrase === null);
      let newPassphrase = payload.passphrase, fresh: Buffer | null = null;
      if (computer) {
        const probe = await custody!.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
        const files = this.custodyFiles(), card = await files.readCard(folder);
        const vaultId = card?.vaultId ?? await files.folderVaultId(folder);
        // Another folder may already open this vault with this computer's key: keep its secret.
        newPassphrase = vaultId ? await this.existingComputerSecret(vaultId) : null;
        if (!newPassphrase) { fresh = randomBytes(32); newPassphrase = fresh.toString('base64url'); }
      }
      try {
        const vault = await Vault.recover({ directory: this.workspacePath(folder), recoveryCode: payload.recoveryCode, newPassphrase, storage: await this.adapter(folder), writerGuard: this.writerGuard() });
        if (fresh) await this.storeComputerSecret(vault, fresh);
        await this.attachSafely(vault);
      } finally { fresh?.fill(0); }
      await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: 'made', reseal: true });
      return { workspace: this.store().read().workspace };
    }
    if (method === 'workspace.restore') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before restoring.');
      this.#draft?.clear();
      check(typeof payload.backupFile === 'string', 'INVALID_PATH', 'Choose a backup from this app.');
      const backupRoot = resolve(this.options.directory, 'backups'); const backupFile = resolve(backupRoot, payload.backupFile); const rel = relative(backupRoot, backupFile);
      check(!rel.startsWith('..') && !isAbsolute(rel) && rel.endsWith('.backup'), 'INVALID_PATH', 'Choose a managed backup file.');
      const custody = this.custodyHost(), files = this.custodyFiles();
      const header = custody && !rel.includes('/') && !rel.includes('\\') ? await files.backupHeader(rel) : null;
      const original = header ? (await files.listCards()).find(card => card.vaultId === header.vaultId && card.state === 'ready') ?? null : null;
      const folder = payload.folder === null ? nextFolder(`${original?.folder ?? 'restored'}${original ? '-restored' : ''}`.slice(0, 64), await files.takenFolders()) : payload.folder ?? 'restored';
      this.workspacePath(folder);
      const recoveryCode = typeof payload.recoveryCode === 'string' ? payload.recoveryCode : undefined;
      const typed = payload.passphrase !== undefined && payload.passphrase !== null;
      let how: 'this-computer' | 'typed' = typed ? 'typed' : 'this-computer', fresh: Buffer | null = null, credentials: { passphrase: string } | { recoveryCode: string; newPassphrase: string };
      if (recoveryCode !== undefined && typed) credentials = { recoveryCode, newPassphrase: payload.passphrase };
      else if (recoveryCode !== undefined && custody) {
        const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
        let secret = header ? await this.existingComputerSecret(header.vaultId) : null;
        if (!secret) { fresh = randomBytes(32); secret = fresh.toString('base64url'); }
        credentials = { recoveryCode, newPassphrase: secret };
      } else if (!typed && custody) {
        check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
        credentials = { passphrase: (await this.computerSecret(header.vaultId))! };
      } else { credentials = { passphrase: payload.passphrase }; how = 'typed'; }
      try {
        let vault: Vault;
        try { vault = await Vault.restore({ directory: this.workspacePath(folder), backupFile, ...credentials, storage: await this.adapter(folder), writerGuard: this.writerGuard() }); }
        catch (error) { if (custody && how === 'this-computer' && !('recoveryCode' in credentials) && (error as ChausarError).code === 'UNLOCK_FAILED') throw deviceKeyFailed(); throw error; }
        if (fresh) await this.storeComputerSecret(vault, fresh);
        await this.attachSafely(vault);
      } finally { fresh?.fill(0); }
      const rewrapped = 'recoveryCode' in credentials;
      await this.afterOpen(folder, how, { recovery: rewrapped ? 'made' : original?.recovery ?? (how === 'typed' ? 'made' : 'unknown'), reseal: rewrapped });
      return { workspace: this.store().read().workspace, folder };
    }
    if (method === 'workspace.lock') {
      if (this.vault) { authorize(this.vault, this.context, 'admin'); await this.closingBackup(); }
      await this.closeVault(); this.#closedByOwner = true; return { locked: true };
    }
    const store = this.store(); const ctx = this.context; authorize(store, ctx);
    const s = this.services;
    switch (method) {
      case 'workspace.custody.passphraseOn': this.requireAppOwner(ctx); return this.custodySerial(() => this.passphraseOn(payload));
      case 'workspace.custody.passphraseOff': this.requireAppOwner(ctx); return this.custodySerial(() => this.passphraseOff(payload));
      case 'workspace.custody.recoveryCode': this.requireAppOwner(ctx); return this.custodySerial(() => this.makeRecoveryCode(payload));
      case 'workspace.custody.neverContactReset': this.requireAppOwner(ctx); return this.custodySerial(() => this.neverContactReset(payload));
      case 'workspace.backups.create': this.requireAppOwner(ctx); return this.custodySerial(() => this.writeBackup('manual'));
      case 'workspace.backups.restore': this.requireAppOwner(ctx); return this.custodySerial(() => this.restoreManagedBackup(payload));
      case 'workspace.transfer.export': this.requireAppOwner(ctx); return this.custodySerial(() => this.transferExport(payload));
      case 'workspace.backup.v2.create': return this.backupHost().create(ctx, this.journalPayload(payload,
        ['destinationId', 'confirmed'], ['destinationId', 'confirmed'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['create']>[1]);
      case 'workspace.backup.v2.read': return this.backupHost().read(ctx, this.journalPayload(payload,
        ['backupId'], ['backupId'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['read']>[1]);
      case 'workspace.backup.v2.restoreInert': {
        const input = this.journalPayload(payload, ['backupId', 'targetId', 'reviewedDigest', 'confirmed'],
          ['backupId', 'targetId', 'reviewedDigest', 'confirmed'], 'INVALID_BACKUP_REQUEST');
        check(input.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the exact reviewed archive and separate closed copy.');
        return this.backupHost().restoreInert(ctx, { backupId: input.backupId as string, targetId: input.targetId as string, reviewedDigest: input.reviewedDigest as string });
      }
      case 'workspace.backup.v2.readRestored': return this.backupHost().readRestored(ctx, this.journalPayload(payload,
        ['backupId', 'targetId', 'creationId', 'reviewedDigest'], ['backupId', 'targetId', 'creationId', 'reviewedDigest'], 'INVALID_BACKUP_REQUEST') as Parameters<WorkspaceBackupV2Host['readRestored']>[1]);
      case 'workspace.backup.v2.inspectRestored': {
        const input = this.journalPayload(payload, ['backupId', 'targetId', 'reviewedDigest'],
          ['backupId', 'targetId', 'reviewedDigest'], 'INVALID_BACKUP_REQUEST');
        const host = this.backupHost(); const reviewed = await host.read(ctx, { backupId: input.backupId as string });
        check(input.reviewedDigest === reviewed.summary.archiveDigest, 'BACKUP_REVIEW_CHANGED', 'Inspect the exact reviewed archive digest.');
        const identity = await s.backupLocal.restoredIdentity(ctx, input.targetId);
        check(identity.archiveDigest === reviewed.summary.archiveDigest, 'BACKUP_TARGET_CHANGED', 'The reserved copy belongs to a different archive.');
        return host.readRestored(ctx, { backupId: input.backupId as string, targetId: identity.targetId,
          creationId: identity.creationId, reviewedDigest: reviewed.summary.archiveDigest });
      }
      case 'workspace.backup.v2.diagnostics': {
        this.journalPayload(payload, [], [], 'INVALID_BACKUP_REQUEST'); this.backupHost(); this.backupCompleteOwner(ctx, store.read());
        return s.backupLocal.diagnostics();
      }
      case 'workspace.activation.target.create': {
        const input = this.journalPayload(payload, ['targetId', 'confirmed'], ['targetId', 'confirmed'], 'INVALID_ACTIVATION_REQUEST');
        check(input.confirmed === true && typeof input.targetId === 'string', 'CONFIRMATION_REQUIRED', 'Confirm a new empty managed activation target.');
        return this.activationHost().createTarget(ctx, input.targetId);
      }
      case 'workspace.activation.target.get': return this.activationHost().inspectTarget(ctx,
        this.journalPayload(payload, ['targetId'], ['targetId'], 'INVALID_ACTIVATION_REQUEST').targetId as string);
      case 'workspace.backup.activation.prepare': return this.activationHost().bridge.prepare(ctx, this.journalPayload(payload,
        ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId', 'reviewedArchiveDigest', 'confirmed'],
        ['backupId', 'materialId', 'inertTargetId', 'inertCreationId', 'candidateId', 'targetId', 'reviewedArchiveDigest', 'confirmed'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['bridge']['prepare']>[1]);
      case 'workspace.backup.activation.inspect': return (await this.activationHost().bridge.inspect(ctx,
        this.journalPayload(payload, ['candidateId'], ['candidateId'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['bridge']['inspect']>[1])).review;
      case 'workspace.activation.review': return this.activationHost().activation.review(ctx, this.journalPayload(payload,
        ['candidateId', 'reviewedDigest'], ['candidateId', 'reviewedDigest'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['review']>[1]);
      case 'workspace.activation.execute': return this.activationHost().activation.activate(ctx, this.journalPayload(payload,
        ['candidateId', 'reviewedDigest', 'projectionDigest', 'activationId', 'confirmed'],
        ['candidateId', 'reviewedDigest', 'projectionDigest', 'activationId', 'confirmed'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['activate']>[1]);
      case 'workspace.activation.get': return this.activationHost().activation.resolve(ctx, this.journalPayload(payload,
        ['activationId'], ['activationId'], 'INVALID_ACTIVATION_REQUEST') as Parameters<EngineWorkspaceActivation['activation']['resolve']>[1]);
      case 'workspace.interchange.export': return s.interchange.export(ctx, this.journalPayload(payload,
        ['destinationId', 'confirmed'], ['destinationId', 'confirmed'], 'INVALID_INTERCHANGE_REQUEST'));
      case 'workspace.interchange.prepare': return s.interchange.prepare(ctx, this.journalPayload(payload,
        ['exportId', 'candidateId', 'targetId'], ['exportId', 'candidateId', 'targetId'], 'INVALID_INTERCHANGE_REQUEST'));
      case 'workspace.interchange.review': return s.interchange.review(ctx, this.journalPayload(payload,
        ['candidateId', 'reviewedDigest'], ['candidateId', 'reviewedDigest'], 'INVALID_INTERCHANGE_REQUEST'));
      case 'workspace.interchange.discard': return s.interchange.discard(ctx, this.journalPayload(payload,
        ['recordId', 'reviewedDigest'], ['recordId', 'reviewedDigest'], 'INVALID_INTERCHANGE_REQUEST'));
      case 'workspace.interchange.diagnostics': {
        this.journalPayload(payload, [], [], 'INVALID_INTERCHANGE_REQUEST'); this.interchangeOwner(ctx, store.read());
        return s.interchangeLocal.diagnostics();
      }
      case 'trials.create': return s.privateTrials.create(ctx, this.journalPayload(payload, ['version', 'savedAnswerIds', 'change'], ['version', 'savedAnswerIds', 'change'], 'INVALID_PRIVATE_TRIAL'));
      case 'trials.evaluate': return s.privateTrials.evaluate(ctx, this.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.get': return s.privateTrials.read(ctx, this.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.receiptContext': return this.privateRestatementContext(ctx, this.journalPayload(payload, ['receiptId'], ['receiptId'], 'INVALID_PRIVATE_TRIAL').receiptId);
      case 'trials.list': this.journalPayload(payload, [], [], 'INVALID_PRIVATE_TRIAL'); return s.privateTrials.list(ctx);
      case 'trials.savedQuestions': {
        this.journalPayload(payload, [], [], 'INVALID_PRIVATE_TRIAL');
        return store.read().answers.flatMap(answer => {
          try { const receipt = s.calculator.receipt(ctx, answer.receiptId);
            return answer.request ? [{ id: answer.id, receiptId: receipt.id, request: structuredClone(answer.request), stale: answer.stale === true || receipt.stale === true }] : [];
          } catch { return []; }
        });
      }
      case 'trials.discard': return s.privateTrials.discard(ctx, this.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.impact': { const input = this.journalPayload(payload, ['trialId', 'strategy'], ['trialId', 'strategy'], 'INVALID_PRIVATE_TRIAL'); return s.privateTrials.promotionImpact(ctx, input.trialId, input.strategy); }
      case 'trials.promote': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Review the exact private trial publication in the desktop app.');
        return s.privateTrials.promote(ctx, this.journalPayload(payload, ['trialId', 'evaluationDigest', 'strategy', 'acknowledgedImpactDigest'], ['trialId', 'evaluationDigest', 'strategy', 'acknowledgedImpactDigest'], 'INVALID_PRIVATE_TRIAL'));
      }
      case 'auth.invite': return s.auth.invite(ctx, payload);
      case 'auth.accept': return s.auth.accept(payload.token);
      case 'auth.session': return s.auth.issueSession(ctx, payload.memberId ?? ctx.memberId, payload.ttlMs);
      case 'auth.revoke': return payload.inviteId ? s.auth.revokeInvite(ctx, payload.inviteId) : s.auth.revokeSession(ctx, payload.sessionId ?? payload.id);
      case 'auth.sessions': return s.auth.sessions(ctx);
      case 'phone.invite': return this.companionRuntime().sessions.issueInvite(ctx, this.journalPayload(payload,
        ['memberId', 'deviceId', 'keyId', 'channel', 'devicePublicKey', 'capabilities', 'inviteTtlMs', 'sessionTtlMs'],
        ['memberId', 'deviceId', 'keyId', 'channel', 'devicePublicKey', 'capabilities', 'inviteTtlMs', 'sessionTtlMs'], 'INVALID_PHONE_INVITE') as any);
      case 'phone.sessions': this.journalPayload(payload, [], [], 'INVALID_PHONE_REQUEST'); return this.companionRuntime().sessions.list(ctx);
      case 'phone.revoke': {
        const input = this.journalPayload(payload, ['sessionId'], ['sessionId'], 'INVALID_PHONE_REQUEST');
        await this.companionRuntime().sessions.revokeByOwner(ctx, input.sessionId as string); return { sessionId: input.sessionId, revoked: true };
      }
      case 'phone.conversation.offer': {
        const input = this.journalPayload(payload, ['sessionId', 'request'], ['sessionId', 'request'], 'INVALID_PHONE_REQUEST');
        return this.companionRuntime().runtime.offer(ctx, input as { sessionId: string; request: ReviewedPhoneConversationRequest });
      }
      case 'sync.status': authorize(store, ctx, 'admin'); return { ...s.sync.status(ctx), writerAdmission: await this.writerStatus() };
      case 'sync.writer.status': authorize(store, ctx, 'admin'); this.journalPayload(payload, [], [], 'INVALID_SYNC_REQUEST'); return this.writerStatus();
      case 'sync.writer.review': {
        authorize(store, ctx, 'admin');
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Review the exact device writer grant in the untainted app.');
        const input = this.journalPayload(payload, ['expectedFence', 'expectedStateDigest', 'deviceId', 'memberId', 'epoch', 'expiresAt', 'reason'], ['expectedFence', 'expectedStateDigest', 'deviceId', 'memberId', 'epoch', 'expiresAt', 'reason'], 'INVALID_SYNC_REQUEST');
        const admission = this.options.sync?.writerAdmission;
        check(admission && admission.deviceId === this.options.sync?.deviceId, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Configure exact reviewed device writer admission first.');
        return admission.review(ctx, store.read(), store.vaultId, input as SyncWriterReview);
      }
      case 'sync.identity': return s.sync.identity(ctx);
      case 'sync.enable':
        // Another device can't open a vault whose secret only this computer holds.
        check(!payload.enabled || this.#openUnlock !== 'this-computer', 'SYNC_NEEDS_PASSPHRASE', CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
        return this.writerConfiguration(() => {
        if (payload.enabled) check(this.options.sync?.signingKey && this.options.sync?.deviceId && this.options.sync?.signerId, 'SYNC_DEVICE_CONFIGURATION_REQUIRED', 'Configure a persistent broker-supplied signing key and reviewed device identity before publication.');
        return s.sync.enable(ctx, payload.enabled);
      });
      case 'sync.trust': return this.writerConfiguration(() => s.sync.trustDevice(ctx, payload));
      case 'sync.preview': return s.sync.preview(ctx);
      case 'sync.approve': return s.sync.approve(ctx, payload.id ?? payload.previewId);
      case 'sync.push': return s.sync.push(ctx, payload);
      case 'sync.reconcile': {
        authorize(store, ctx, 'admin');
        const input = this.journalPayload(payload, ['previewId'], ['previewId'], 'INVALID_SYNC_REQUEST');
        check(typeof input.previewId === 'string' && input.previewId.length > 0 && input.previewId.length <= 200, 'INVALID_SYNC_REQUEST', 'Choose one existing publication receipt.');
        return s.sync.reconcile(ctx, input.previewId);
      }
      case 'sync.pull': {
        authorize(store, ctx, 'admin'); const folder = payload.folder ?? 'sync-staged';
        const staged = await s.sync.pull(ctx, { directory: this.workspacePath(folder), passphrase: payload.passphrase, recoveryCode: payload.recoveryCode, newPassphrase: payload.newPassphrase, expectedWorkspaceId: payload.expectedWorkspaceId, storage: await this.adapter(folder) });
        this.#stagedVaults.add(staged.stagedVault); return { directory: staged.directory, receipt: staged.receipt, experimental: true, liveAuthorityChanged: false };
      }
      case 'dashboard.get': {
        const facts = s.memory.query(ctx, {}); const state = store.read();
        const calculations: any[] = [];
        for (const operation of ['billed', 'received', 'earned', 'margin']) {
          try { calculations.push(await s.calculator.calculate(ctx, { operation, ...(payload.period ? { period: payload.period } : {}) })); } catch (error) { calculations.push({ operation, error: (error as Error).message }); }
        }
        return { workspace: state.workspace, calculations, factCount: facts.facts?.length ?? facts.length ?? 0, sources: this.visibleImports().length, decisions: s.reports.decisions(ctx).filter((d: any) => d.status === 'open'), waitingActions: s.actions.list(ctx).filter((a: any) => !['verified', 'cancelled', 'rejected'].includes(a.status)), jobs: s.jobs.list(ctx), policy: state.policy, dictionary: s.ontology.current(ctx), lastActivity: ['owner', 'cofounder'].includes(ctx.role) ? this.visibleActivity(ctx).slice(-8).reverse() : [] };
      }
      case 'conversation.ask': {
        check(typeof payload.question === 'string' && payload.question.trim().length > 0 && payload.question.length <= 8000, 'INVALID_QUESTION', 'Ask a short business question.');
        check(payload.continuationId === undefined || payload.purpose === 'conversation' && typeof payload.routeId === 'string' && payload.routeId.length > 0,
          'MODEL_ROUTE_REQUIRED', 'Choose and review a model route to continue this question.');
        if (payload.purpose === 'conversation') {
          check(typeof payload.routeId === 'string' && payload.routeId.length > 0 && payload.questionDisclosure === 'verbatim', 'MODEL_ROUTE_REQUIRED', 'Choose a model route and review the original question before sending it.');
          const result = await s.gateway.execute(ctx, payload);
          check(result.kind === 'conversation', 'PREVIEW_REQUEST_CHANGED', 'Use the unified conversation preview for this request.');
          return this.executeConversationPlan(ctx, payload, result);
        }
        const purpose = conversationPurpose(payload.question, payload.purpose);
        let result: any;
        let businessManifest: BusinessContextManifest | undefined;
        let modelReceiptId: string | undefined;
        if (payload.routeId) {
          const gatewayResult = await s.gateway.execute(ctx, { ...payload, purpose });
          check(gatewayResult.kind !== 'conversation' && gatewayResult.kind !== 'conversation-synthesis', 'PREVIEW_REQUEST_CHANGED', 'Use the exact conversation mode reviewed in the model preview.');
          if (gatewayResult.kind === 'business-context') { result = gatewayResult.answer; businessManifest = gatewayResult.receipt.businessContext; modelReceiptId = gatewayResult.receipt.id; }
          else { const plan = gatewayResult.plan; if (plan.clarification || !plan.operation) return plan; result = await s.calculator.calculate(ctx, plan); }
        } else if (purpose === 'business-context') {
          check(payload.previewId === undefined && payload.approvalId === undefined && payload.profileSamples === undefined, 'MODEL_ROUTE_REQUIRED', 'A model preview requires its exact selected route. Local context stays on this device.');
          const request = { ...(payload.sourceIds !== undefined ? { sourceIds: payload.sourceIds } : {}), ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.asOf !== undefined ? { asOf: payload.asOf } : {}), ...(payload.onDate !== undefined ? { onDate: payload.onDate } : {}), ...(payload.period !== undefined ? { period: payload.period } : {}) };
          businessManifest = buildBusinessContext(store, ctx, request, s.businessContextHooks);
          result = renderBusinessAnswer(store, ctx, businessManifest, { claimIds: businessManifest.claims.map(claim => claim.id), unknownCategories: businessManifest.unknownCategories }, s.businessContextHooks);
        } else { const { question, purpose: ignoredPurpose, routeId, previewId, approvalId, ...filters } = payload; result = await s.calculator.ask(ctx, payload.question, filters); }
        return (await this.retainConversationAnswer(ctx, payload.question, result, businessManifest, modelReceiptId)).answer;
      }
      case 'conversation.synthesis.preview': {
        const input = this.journalPayload(payload, ['id', 'routeId'], ['id'], 'INVALID_SYNTHESIS');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_SYNTHESIS', 'Choose one current retained tool turn.');
        s.synthesisHost.codec();
        const authority = s.synthesisHost.resolve(ctx, input.id);
        const planner = s.gateway.assertConversationReceipt(ctx, authority.binding.plannerModelReceiptId);
        check(input.routeId === undefined || input.routeId === planner.routeId, 'SYNTHESIS_ROUTE_CHANGED', 'Use the exact reviewed planning route for this final answer.');
        return s.gateway.preview(ctx, { question: authority.summary.question, purpose: 'conversation-synthesis',
          questionDisclosure: 'verbatim', toolTurnId: authority.binding.toolTurnId, routeId: planner.routeId });
      }
      case 'conversation.synthesis.run': {
        const input = this.journalPayload(payload, ['id', 'previewId', 'approvalId'], ['id', 'previewId', 'approvalId'], 'INVALID_SYNTHESIS');
        check([input.id, input.previewId, input.approvalId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200),
          'INVALID_SYNTHESIS', 'Choose the exact tool turn, reviewed preview and one-use approval.');
        const result = await s.gateway.execute(ctx, { purpose: 'conversation-synthesis', toolTurnId: input.id,
          previewId: input.previewId, approvalId: input.approvalId });
        check(result.kind === 'conversation-synthesis', 'PREVIEW_REQUEST_CHANGED', 'Use a separately reviewed final-answer preview.');
        return s.synthesisHost.retain(ctx, result.receipt.id);
      }
      case 'conversation.history': return s.conversationHistory.list(ctx, payload);
      case 'conversation.continuation': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'INVALID_HISTORY_REFERENCE');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_HISTORY_REFERENCE', 'Choose one saved clarification.');
        return this.conversationContinuation(ctx, input.id);
      }
      case 'conversation.get': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'INVALID_HISTORY_REFERENCE');
        return s.conversationHistory.get(ctx, input.id);
      }
      case 'business.context.receipt': {
        check(typeof payload.id === 'string', 'INVALID_REFERENCE', 'Choose a saved business context receipt.');
        const saved = store.read().conversations.find(item => item.kind === 'business-context-answer' && item.id === payload.id);
        check(saved && saved.memberId === ctx.memberId && saved.epoch === ctx.epoch, 'RECEIPT_NOT_FOUND', 'This business context receipt is unavailable to the current account.');
        assertBusinessContextCurrent(store, ctx, saved.manifest, s.businessContextHooks);
        return s.conversationHistory.get(ctx, payload.id).answer;
      }
      case 'business.profile.record': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_PROFILE_REQUIRED', 'Record explicit business descriptions inside the app.');
        return s.businessProfile.record(ctx, payload);
      }
      case 'business.profile.history': return s.businessProfile.history(ctx, payload.field);
      case 'business.profile.remove': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_PROFILE_REQUIRED', 'Remove business descriptions inside the app.');
        const result = await s.businessProfile.remove(ctx, payload.id); const removed = await this.purgeManagedCopies(); return { ...result, copiesRemoved: removed };
      }
      case 'calculation.run': return s.calculator.calculate(ctx, payload);
      case 'answers.recovery.review': {
        const input = this.journalPayload(payload, ['answerId'], ['answerId'], 'INVALID_ANSWER_RECOVERY');
        const resolved = this.answerRecoveryEvidence(ctx, input.answerId, store);
        return { ...explainAnswerRecovery(resolved.evidence), originalRequest: resolved.evidence.answer.request,
          reviewedEvidencePin: resolved.evidencePin, dictionary: resolved.dictionary,
          retrospectivePromotion: 'still-blocked-by-preserved-unpinned-original' };
      }
      case 'answers.recovery.prepare': {
        const input = this.journalPayload(payload, ['answerId', 'source', 'reviewedEvidencePin', 'timeScope', 'confirmedNewCalculation'],
          ['answerId', 'source', 'reviewedEvidencePin', 'timeScope', 'confirmedNewCalculation'], 'INVALID_ANSWER_RECOVERY');
        check(typeof input.reviewedEvidencePin === 'string' && /^[a-f0-9]{64}$/.test(input.reviewedEvidencePin),
          'INVALID_ANSWER_RECOVERY', 'Review the exact current source evidence before preparing a fresh calculation.');
        const id = await store.update(state => {
          const view = this.answerRecoveryView(state), resolved = this.answerRecoveryEvidence(ctx, input.answerId, view);
          check(input.reviewedEvidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Current evidence or access changed after review. Review again.');
          const newRequestId = newId('answer_recovery');
          const preparation = prepareAnswerRecovery(resolved.evidence, { version: 1, newRequestId,
            source: input.source as AnswerRecoverySource, timeScope: input.timeScope as AnswerRecoveryTimeScope,
            confirmedNewCalculation: input.confirmedNewCalculation as true });
          this.answerRecoveryCalculator(view).consumerGuard?.(ctx, structuredClone(preparation.request));
          const record: Omit<AnswerRecoveryRecord, 'integrity'> = { id: newRequestId, type: 'answer-recovery-request-v1',
            workspaceId: state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch, at: now(), preparation,
            evidencePin: resolved.evidencePin, dictionary: resolved.dictionary, status: 'prepared' };
          state.answers.push({ ...record, integrity: answerRecoveryRecordIntegrity(record) });
          audit(state, 'answer-recovery.prepared', { newRequestId, originalAnswerId: preparation.source.originalAnswerId,
            preparationDigest: preparation.digest });
          return newRequestId;
        });
        return this.answerRecoveryRead(ctx, id);
      }
      case 'answers.recovery.get': {
        const input = this.journalPayload(payload, ['newRequestId'], ['newRequestId'], 'INVALID_ANSWER_RECOVERY');
        return this.answerRecoveryRead(ctx, input.newRequestId);
      }
      case 'answers.recovery.list': {
        const input = this.journalPayload(payload, ['answerId'], ['answerId'], 'INVALID_ANSWER_RECOVERY');
        this.answerRecoveryEvidence(ctx, input.answerId, store);
        return { items: store.read().answers.filter(record => record.type === 'answer-recovery-request-v1'
          && record.preparation?.source.originalAnswerId === input.answerId && record.memberId === ctx.memberId && record.epoch === ctx.epoch)
          .map(record => {
            try { return this.answerRecoveryRead(ctx, record.id); }
            catch (error) {
              if (!(error instanceof ChausarError)) throw error;
              return { newRequestId: record.id, status: 'unavailable', code: error.code, message: error.message,
                historicalReplay: false, grantsAuthority: false };
            }
          }) };
      }
      case 'answers.recovery.execute': {
        const input = this.journalPayload(payload, ['newRequestId', 'preparationDigest'], ['newRequestId', 'preparationDigest'], 'INVALID_ANSWER_RECOVERY');
        return this.executeAnswerRecovery(ctx, input.newRequestId, input.preparationDigest);
      }
      case 'forecasts.evaluate': return s.forecasts.evaluate(ctx, payload);
      case 'forecasts.get': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'INVALID_FORECAST');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_FORECAST', 'Choose one saved forecast evaluation.');
        return s.forecasts.get(ctx, input.id);
      }
      case 'alerts.create': return s.alerts.create(ctx, payload);
      case 'alerts.list': this.journalPayload(payload, [], [], 'INVALID_ALERT'); return s.alerts.list(ctx);
      case 'alerts.get': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'INVALID_ALERT'); return s.alerts.get(ctx, input.id);
      }
      case 'alerts.publish': {
        const input = this.journalPayload(payload, ['id', 'expectedRevision'], ['id', 'expectedRevision'], 'INVALID_ALERT');
        const { id, ...update } = input; return s.alerts.publish(ctx, id, update);
      }
      case 'alerts.evaluate': {
        const input = this.journalPayload(payload, ['id', 'expectedRevision', 'observationId', 'observedAt', 'receiptId', 'missingReason', 'correction'], ['id', 'expectedRevision', 'observationId', 'observedAt'], 'INVALID_ALERT');
        const { id, ...update } = input; return s.alerts.evaluate(ctx, id, update);
      }
      case 'analysis.bridge.publish': return s.bridge.publish(ctx, payload);
      case 'analysis.bridge.profiles': this.journalPayload(payload, [], [], 'BRIDGE_PROFILE_INVALID'); return s.bridge.profiles(ctx);
      case 'analysis.bridge.run': return s.bridge.run(ctx, payload);
      case 'analysis.bridge.get': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'BRIDGE_REFERENCE_INVALID'); return s.bridge.get(ctx, input);
      }
      case 'investigations.create': return s.investigations.create(ctx, payload);
      case 'investigations.list': this.journalPayload(payload, [], [], 'INVALID_INVESTIGATION'); return s.investigations.list(ctx);
      case 'investigations.get':
      case 'investigations.capsule': {
        const input = this.journalPayload(payload, ['id'], ['id'], 'INVALID_INVESTIGATION');
        return method === 'investigations.get' ? s.investigations.get(ctx, input.id) : s.investigations.capsule(ctx, input.id);
      }
      case 'investigations.advance':
      case 'investigations.resume':
      case 'investigations.cancel':
      case 'investigations.pause':
      case 'investigations.revise': {
        const keys = method === 'investigations.revise' ? ['id', 'expectedRevision', 'reason', 'objective', 'hypotheses', 'budget']
          : method === 'investigations.pause' ? ['id', 'expectedRevision', 'reason'] : ['id', 'expectedRevision'];
        const required = ['id', 'expectedRevision', ...(['investigations.pause', 'investigations.revise'].includes(method) ? ['reason'] : [])];
        const input = this.journalPayload(payload, keys, required, 'INVALID_INVESTIGATION');
        const { id, ...update } = input; return s.investigations[method.slice('investigations.'.length)](ctx, id, update);
      }
      case 'investigations.drilldown': {
        const input = this.journalPayload(payload, ['id', 'receiptId', 'offset', 'limit'], ['id', 'receiptId', 'offset', 'limit'], 'INVALID_INVESTIGATION');
        const { id, ...page } = input; return s.investigations.drilldown(ctx, id, page);
      }
      case 'research.search': return s.research.search(ctx, payload);
      case 'receipts.get': return s.calculator.receipt(ctx, payload.id);
      case 'sources.list': return this.visibleImports();
      case 'sources.delete': { const result = await s.trust.deleteSource(ctx, payload.id); const removed = await this.purgeManagedCopies(); return { ...result, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' }; }
      case 'sources.preview': return s.imports.preview(ctx, payload);
      case 'sources.import': return s.imports.commit(ctx, payload);
      case 'sources.catalogue': return s.connectors.catalogue(ctx);
      case 'sources.groups': return s.connectors.groups(ctx);
      case 'connectors.profiles':
      case 'connectors.read':
      case 'connectors.reviewMapping':
      case 'connectors.capture':
      case 'connectors.publish':
      case 'connectors.ready':
      case 'connectors.captureStatus':
      case 'connectors.releaseRead': return s.connectorRuntime.request(ctx, method, payload);
      case 'sources.fetch': return s.connectors.fetch(ctx, payload);
      case 'sources.recipe': return s.connectors.proposeRecipe(ctx, payload);
      case 'sources.accept': return s.connectors.acceptRecipe(ctx, payload);
      case 'sources.workbook': return readWorkbook(this.workbookBytes(payload), { sheet: payload.sheet });
      case 'sources.workbookPreview': return s.imports.preview(ctx, this.workbookInput(payload));
      case 'sources.workbookImport': return s.imports.commit(ctx, this.workbookInput(payload));
      case 'ontology.packs': return s.ontology.packs();
      case 'ontology.get': return { current: s.ontology.current(ctx), history: s.ontology.history(ctx) };
      case 'ontology.publish': return s.ontology.publish(ctx, payload.draft ?? payload.pack ?? payload);
      case 'memory.list': return s.memory.query(ctx, payload);
      case 'memory.correct': return s.memory.correct(ctx, payload.id, payload.fields);
      case 'memory.merge': return s.memory.merge(ctx, payload.entityIds, payload.targetId);
      case 'memory.undo': return s.memory.undoMerge(ctx, payload.id);
      case 'memory.precedence': return s.memory.setSourcePrecedence(ctx, payload.kind, payload.sourceIds);
      case 'decisions.list': return s.reports.decisions(ctx);
      case 'decisions.create': return s.reports.decision(ctx, payload);
      case 'decisions.review': { const { id, ...review } = payload; return s.reports.reviewDecision(ctx, id, review); }
      case 'decisions.journal.draft': {
        this.journalWriter(ctx);
        const input = this.journalPayload(payload, ['content'], ['content'], 'INVALID_DECISION');
        return s.reports.draftDecision(ctx, input.content);
      }
      case 'decisions.journal.confirm': {
        this.journalWriter(ctx);
        const input = this.journalPayload(payload, ['draft', 'reviewedDigest'], ['draft', 'reviewedDigest'], 'INVALID_CONFIRMATION');
        check(typeof input.reviewedDigest === 'string' && input.reviewedDigest.trim().length > 0, 'INVALID_CONFIRMATION', 'Confirm the exact reviewed draft digest.');
        const draft = this.journalPayload(input.draft, ['kind', 'content', 'receipts', 'digest'], ['kind', 'content', 'receipts', 'digest'], 'INVALID_DRAFT');
        check(draft.kind === 'journal-draft' && Array.isArray(draft.receipts) && typeof draft.digest === 'string', 'INVALID_DRAFT', 'Confirm a prepared journal draft.');
        return s.reports.confirmDecision(ctx, input.draft, { reviewedDigest: input.reviewedDigest });
      }
      case 'decisions.journal.revise': {
        this.journalWriter(ctx);
        const input = this.journalPayload(payload, ['id', 'content', 'expectedRevision', 'reason'], ['id', 'content', 'expectedRevision', 'reason'], 'INVALID_REVISION');
        check(typeof input.id === 'string' && input.id.trim().length > 0 && typeof input.reason === 'string' && input.reason.trim().length > 0, 'INVALID_REVISION', 'Identify the journal and explain the revision.');
        this.journalRevision(input.expectedRevision);
        return s.reports.reviseDecision(ctx, input.id, input.content, { expectedRevision: input.expectedRevision, reason: input.reason });
      }
      case 'decisions.journal.review': {
        this.journalWriter(ctx);
        const input = this.journalPayload(payload, ['id', 'review', 'expectedRevision'], ['id', 'review', 'expectedRevision'], 'INVALID_REVIEW');
        check(typeof input.id === 'string' && input.id.trim().length > 0, 'INVALID_REVIEW', 'Identify the journal being reviewed.');
        this.journalRevision(input.expectedRevision);
        const review = this.journalPayload(input.review, ['outcome', 'notes', 'observation', 'nextReviewDate'], ['outcome', 'observation'], 'INVALID_REVIEW');
        this.journalPayload(review.observation, ['state', 'measurements', 'notes', 'uncertainty', 'concurrentInterventions', 'executionReceiptIds'], ['state', 'measurements', 'notes', 'uncertainty', 'concurrentInterventions', 'executionReceiptIds'], 'INVALID_REVIEW');
        return s.reports.reviewJournalDecision(ctx, input.id, input.review, { expectedRevision: input.expectedRevision });
      }
      case 'decisions.journal.due': {
        const input = this.journalPayload(payload, ['dueOn', 'branch'], [], 'INVALID_FILTER');
        check(input.branch === undefined || (typeof input.branch === 'string' && input.branch.trim().length > 0), 'INVALID_FILTER', 'A branch filter must be nonblank.');
        return s.reports.dueDecisions(ctx, input);
      }
      case 'reports.get': { const { type, ...filters } = payload; return s.reports.report(ctx, type ?? 'investor', filters); }
      case 'reports.brief': return s.reports.brief(ctx, payload);
      case 'reports.forecast': return s.reports.forecast(ctx, { receiptIds: payload.receiptIds });
      case 'actions.list': return s.actions.list(ctx);
      case 'actions.catalogue': return s.actions.catalogue(ctx);
      case 'actions.prepare': return s.actions.prepare(ctx, { ...payload, connector: payload.connector ?? 'local', operation: payload.operation ?? 'reminder-draft', idempotencyKey: payload.idempotencyKey ?? newId('effect') });
      case 'actions.approve': return s.actions.approve(ctx, payload.id, payload.digest);
      case 'actions.revise': return s.actions.revise(ctx, payload.id, payload.payload);
      case 'actions.execute': return s.actions.execute(ctx, payload.id);
      case 'actions.reconcile': return s.actions.reconcile(ctx, payload.id);
      case 'jobs.list': return s.jobs.list(ctx);
      case 'jobs.types': return { types: ['owner-brief', ...(s.jobRunner ? [...s.jobRunner.runners.keys()] : [])], configured: !!s.jobRunner, policy: this.options.durableJobs ? { maxActiveJobs: this.options.durableJobs.maxActiveJobs, leaseMs: this.options.durableJobs.leaseMs } : null, calendar: this.options.jobCalendar ? { configured: true, rulesRevision: this.options.jobCalendar.rules.revision, minYear: this.options.jobCalendar.rules.minYear, maxYear: this.options.jobCalendar.rules.maxYear, bounds: { ...this.options.jobCalendar.bounds } } : { configured: false }, localOnly: true, externalEffects: 'prepare-only', lifecycle: { ...this.#jobLifecycle } };
      case 'jobs.create': {
        if (payload.type === 'owner-brief') {
          check(!Object.hasOwn(payload, 'calendar'), 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
          return this.createBriefJob(ctx, payload);
        }
        check(['calculation-set', 'evidence-review', 'action-preparation', 'private-investigation'].includes(payload.type), 'JOB_TYPE_UNSUPPORTED', 'Choose an installed goal type explicitly.');
        return this.jobRunner().create(ctx, payload);
      }
      case 'jobs.amend': return this.jobRunner().amend(ctx, payload.id, payload.config);
      case 'jobs.calendar.preview': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        check(job.plan, 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
        this.jobRunner().runner(job.type);
        return s.jobs.calendarEvaluation(job);
      }
      case 'jobs.calendar.configure': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        check(job.plan, 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
        this.jobRunner().runner(job.type);
        return s.jobs.configureCalendar(ctx, payload.id, payload.definition,
          payload.expectedScheduleRevision, payload.expectedObjectiveRevision, payload.replacement);
      }
      case 'jobs.calendar.pause': return s.jobs.pauseCalendar(ctx, payload.id);
      case 'jobs.calendar.resume': return s.jobs.resumeCalendar(ctx, payload.id);
      case 'jobs.cancel': return this.typedJob(payload.id) ? this.jobRunner().cancel(ctx, payload.id) : s.jobs.cancel(ctx, payload.id);
      case 'jobs.reconcile': return this.jobRunner().reconcile(ctx, payload.id);
      case 'jobs.progress': return this.jobRunner().progress(ctx, payload.id);
      case 'jobs.pause': return s.jobs.pause(ctx, payload.id);
      case 'jobs.resume': return s.jobs.resume(ctx, payload.id);
      case 'jobs.accept': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        if (job.plan) check(this.jobRunner().canRelease(ctx, job), 'JOB_EVIDENCE_REVOKED', 'Review currently accessible evidence before accepting this result.');
        return s.jobs.accept(ctx, payload.id, payload.repeat === true);
      }
      case 'jobs.approve': return s.jobs.approve(ctx, payload.id, payload.digest);
      case 'jobs.reject': return s.jobs.reject(ctx, payload.id, payload.reason);
      case 'jobs.run': return this.runJob(payload.id);
      case 'trust.get': return { ...store.read().policy, policy: store.read().policy, members: ['owner', 'cofounder'].includes(ctx.role) ? store.read().members : [] };
      case 'trust.update': return s.trust.updatePolicy(ctx, payload.policy ?? payload);
      case 'members.list': authorize(store, ctx, 'admin'); return store.read().members;
      case 'members.add': return s.trust.addMember(ctx, payload);
      case 'members.revoke': return s.trust.revokeMember(ctx, payload.id);
      case 'models.list': return s.gateway.listRoutes(ctx);
      case 'models.configure': return s.gateway.configureRoute(ctx, payload.config ?? payload, payload.secret);
      case 'models.preview': return s.gateway.preview(ctx, payload);
      case 'models.approve': return s.gateway.approveOutbound(ctx, payload.id);
      case 'models.test': return s.gateway.execute(ctx, { question: 'What was billed?', ...payload });
      case 'speech.list': return s.speech.providers(ctx);
      case 'speech.configure': return s.speech.configure(ctx, payload.config ?? payload, payload.secret);
      case 'speech.preview': return s.speech.preview(ctx, payload);
      case 'speech.approve': return s.speech.approve(ctx, payload.id);
      case 'speech.transcribe': return s.speech.transcribe(ctx, payload);
      case 'activity.list': authorize(store, ctx, 'admin'); return { items: this.visibleActivity(ctx).slice(-200).reverse(), modelReceipts: s.gateway.receipts(ctx) };
      case 'learning.list': return s.learning.list(ctx);
      case 'learning.log': return s.learning.recordDecision(ctx, payload);
      case 'learning.preview': return s.learning.preview(ctx, payload.ids ?? store.read().learning.filter(item => item.type === 'decision').map(item => item.id));
      case 'learning.consent': return s.learning.consent(ctx, payload.id ?? payload.previewId, payload.digest);
      case 'learning.sharing': return s.learning.setSharing(ctx, payload.enabled === true);
      case 'learning.share': return s.learning.share(ctx, payload.id);
      case 'plugins.list': return s.plugins.list(ctx);
      case 'plugins.install': return s.plugins.install(ctx, { manifest: payload.manifest, moduleBase64: payload.moduleBase64 ?? payload.code });
      case 'plugins.enable': return s.plugins.enable(ctx, payload.id, payload.digest);
      case 'plugins.disable': return s.plugins.disable(ctx, payload.id);
      case 'plugins.remove': return s.plugins.remove(ctx, payload.id);
      case 'plugins.run': return s.plugins.run(ctx, payload.id);
      case 'plugins.miniapp': return s.plugins.miniappDescriptor(ctx, payload);
      case 'mcp.info': return { name: 'Chausar verified numbers', endpoint: '/mcp', readOnly: true, availableTools: s.ontology.current(ctx)?.operations ?? [] };
      case 'mcp.handle': return s.mcp.handle(ctx, payload);
      case 'helpers.run': {
        authorize(store, ctx, 'admin'); check(!ctx.sourceTainted, 'TAINTED_HELPER', 'Only an explicit app request can run an analytical helper.');
        const result = await s.helper.run(payload.operation, payload.input); authorize(store, ctx, 'admin');
        return { ...result, qualification: 'analytical-preview', financialReceipt: false, requiresHumanReview: true };
      }
      case 'updates.status': authorize(store, ctx, 'admin'); return { configured: !!s.updater, version: this.version, installMode: 'manual-native-installer-required' };
      case 'updates.verify': authorize(store, ctx, 'admin'); check(!ctx.sourceTainted && s.updater, 'UPDATES_UNAVAILABLE', 'Configure a publisher-pinned release key in the engine.'); return s.updater.verify(payload.manifest, payload.signature);
      case 'updates.stage': authorize(store, ctx, 'admin'); check(!ctx.sourceTainted && s.updater && payload.confirmed === true, 'UPDATES_UNAVAILABLE', 'Review and explicitly confirm a publisher-signed update.'); return s.updater.stage(payload.manifest, payload.signature);
      case 'workspace.backup': {
        this.requireWorkspaceOwner(ctx); const folder = join(this.options.directory, 'backups'); await mkdir(folder, { recursive: true });
        const path = join(folder, `chausar-${store.read().workspace.id}-${Date.now()}.backup`); await store.backup(path); return { path, encrypted: true };
      }
      case 'workspace.export': {
        this.requireWorkspaceOwner(ctx); check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the export in the app.');
        const folder = join(this.options.directory, 'exports'); await mkdir(folder, { recursive: true }); const path = join(folder, `chausar-${store.read().workspace.id}-${Date.now()}.${payload.plaintext ? 'json' : 'vault'}`);
        await store.export(path, { plaintext: payload.plaintext === true }); return { path, encrypted: payload.plaintext !== true };
      }
      case 'workspace.delete': this.requireWorkspaceOwner(ctx); check(payload.confirmation === store.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete the vault.'); const removed = await this.purgeManagedCopies(); const deletedVault = store.vaultId, deletedFolder = this.#openFolder; await store.delete(); await this.closeVault(); await this.forgetBusiness(deletedFolder, deletedVault); return { deleted: true, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' };
      case 'venture.create':
      case 'venture.get':
      case 'venture.events':
      case 'venture.interview.next':
      case 'venture.interview.answer':
      case 'venture.blueprint.draft':
      case 'venture.blueprint.get':
      case 'venture.blueprint.update':
      case 'venture.blueprint.accept':
      case 'venture.models.presets':
      case 'venture.models.connect':
      case 'venture.models.disconnect':
      case 'venture.models.status':
      case 'venture.models.calls':
      case 'venture.price.quote':
      case 'venture.receipt.get':
      case 'venture.client.add':
      case 'venture.client.list':
      case 'venture.order.create':
      case 'venture.order.list':
      case 'venture.order.deliver':
      case 'venture.invoice.prepare':
      case 'venture.invoice.issue':
      case 'venture.invoice.get':
      case 'venture.invoice.list':
      case 'venture.payment.record':
      case 'venture.books.summary':
      case 'venture.spend.list':
      case 'venture.spend.policy.get':
      case 'venture.spend.policy.set':
      case 'venture.build.brief':
      case 'venture.build.handoff':
      case 'venture.build.handoffOpened':
      case 'venture.build.link':
      case 'venture.build.sync':
      case 'venture.build.status':
      case 'venture.connectors.list':
      case 'venture.delivery.playbook':
      case 'venture.simulation.scenarios':
      case 'venture.simulation.run':
      case 'venture.simulation.get':
      case 'venture.simulation.fromSignal':
      case 'venture.launch.status':
      case 'venture.launch.advance':
      case 'venture.delivery.run':
      case 'venture.delivery.approve':
      case 'venture.delivery.review':
      case 'venture.delivery.list':
      case 'venture.capabilities':
      case 'venture.files.add':
      case 'venture.files.list':
      case 'venture.delivery.answer':
      case 'venture.work.get':
      case 'venture.improve.status':
      case 'venture.improve.run':
      case 'venture.improve.get':
      case 'venture.improve.adopt':
      case 'venture.delivery.delegate':
      case 'venture.delegate.get':
      case 'venture.queue.list':
      case 'venture.queue.decide':
      case 'venture.runs.list':
      case 'venture.runs.get':
      case 'venture.team.list':
      case 'venture.team.gate':
      case 'venture.evidence.list':
      case 'venture.evidence.apply':
      case 'venture.journal.list':
      case 'venture.journal.resolve':
      case 'venture.untrusted.mode':
      case 'venture.untrusted.release':
      case 'venture.bank.import':
      case 'venture.bank.consent':
      case 'venture.site.stage':
      case 'venture.site.apply':
      case 'venture.site.revert':
      case 'venture.leads.add':
      case 'venture.leads.list':
      case 'venture.leads.draft':
      case 'venture.leads.recordSend':
      case 'venture.queue.view':
      case 'venture.team.posture':
      case 'venture.evidence.dismiss':
      case 'venture.money.overview':
      case 'venture.tax.working':
      case 'venture.ca.get':
      case 'venture.ca.setOfRecord':
      case 'venture.ca.recordSignoff':
      case 'venture.ca.confirmRates':
      case 'venture.leads.block':
      case 'venture.share.create':
      case 'venture.share.list':
      case 'venture.share.revoke':
      case 'venture.delivery.judge':
      case 'venture.delivery.judgeSend':
      case 'venture.improve.rollback':
      case 'venture.files.transcribe':
      case 'venture.posting.propose':
      case 'venture.posting.signIn':
      case 'venture.posting.checkSteps':
      case 'venture.share.recordAnswer':
      case 'venture.social.calendar':
      case 'venture.bank.ledger':
      case 'venture.bank.apply':
      case 'venture.bank.alerts.get':
      case 'venture.bank.alerts.set':
      case 'venture.ca.receipt':
      case 'venture.ca.explainDiff':
      case 'venture.rules.list':
      case 'venture.judge.auto.get':
      case 'venture.judge.auto.set':
      case 'venture.posting.limits.get':
      case 'venture.posting.limits.set':
      case 'venture.transcription.get':
      case 'venture.transcription.set':
      // Ink v2 wave 4 (venture/contracts.ts W4_METHODS; venture.playbooks.list is answered before the vault check)
      case 'venture.team.keeper':
      case 'venture.team.clearQuarantine':
      case 'venture.agents.thread.list':
      case 'venture.agents.thread.send':
      case 'venture.agents.proposal.decide':
      case 'venture.agents.version.undo':
      case 'venture.agents.orders.list':
      case 'venture.chats.consent':
      case 'venture.agents.notes.list':
      case 'venture.agents.notes.edit':
      case 'venture.agents.notes.forget':
      case 'venture.agents.notes.undo':
      case 'venture.chief.threads':
      case 'venture.chief.thread.list':
      case 'venture.chief.thread.send':
      case 'venture.chief.thread.pin':
      case 'venture.chief.fit':
      case 'venture.proposals.raise':
      case 'venture.proposals.dismiss':
      case 'venture.network.import':
      case 'venture.network.importUndo':
      case 'venture.network.merge':
      case 'venture.network.split':
      case 'venture.network.forget':
      case 'venture.network.hide':
      case 'venture.network.people':
      case 'venture.network.person':
      case 'venture.network.sources':
      case 'venture.network.recompute':
      case 'venture.network.know':
      case 'venture.network.link':
      case 'venture.network.search':
      case 'venture.network.searchMore':
      case 'venture.network.saveSearch':
      case 'venture.network.research':
      case 'venture.pipeline.list':
      case 'venture.pipeline.followups':
      case 'venture.pipeline.add':
      case 'venture.pipeline.setNext':
      case 'venture.pipeline.move':
      case 'venture.pipeline.settings':
      case 'venture.outreach.draft':
      case 'venture.outreach.open':
      case 'venture.outreach.sent':
      case 'venture.outreach.restricted':
      case 'venture.mailbox.connect':
      case 'venture.mailbox.disconnect':
      case 'venture.mailbox.sync':
      case 'venture.inbound.list':
      case 'venture.inbound.confirm':
      case 'venture.network.calendar':
      case 'venture.meeting.digest':
      case 'venture.runs.stop':
      case 'venture.runs.resume':
      case 'venture.runs.roundGate':
      case 'venture.runs.steer':
      case 'venture.business.pause':
      case 'venture.away.set':
      case 'venture.away.get':
      case 'venture.runs.allowWrites':
      case 'venture.notify.list':
      case 'venture.notify.read':
      case 'venture.notify.settings':
      case 'venture.notify.push.key':
      case 'venture.notify.push.subscribe':
      case 'venture.notify.push.unsubscribe':
      case 'venture.notify.relay':
      case 'venture.models.cli.status':
      case 'venture.models.roles':
      case 'venture.goals.get':
      case 'venture.goals.set':
      case 'venture.goals.suggest':
      case 'venture.decisions.list':
      case 'venture.policy.allowSession':
      case 'venture.queue.sendBack':
      case 'venture.queue.edit':
      case 'venture.queue.undo':
      case 'venture.queue.set':
      case 'venture.triage.set':
      case 'venture.triage.preview':
      case 'venture.delivery.fix':
      case 'venture.delivery.decideChange':
      case 'venture.delivery.changes':
      case 'venture.settings.draft':
      case 'venture.settings.drafts':
      case 'venture.queue.setPreview':
      case 'venture.delivery.copy':
      case 'venture.files.poster':
      case 'venture.money.aging':
      case 'venture.money.flow':
      case 'venture.money.cash':
      case 'venture.money.margins':
      case 'venture.money.export':
      case 'venture.bills.add':
      case 'venture.bills.pay':
      case 'venture.bills.list':
      case 'venture.credit.issue':
      case 'venture.invoice.recurring':
      case 'venture.invoice.recurringList':
      case 'venture.invoice.remind':
      case 'venture.payment.clear':
      case 'venture.bills.stop':
      case 'venture.money.across':
      case 'venture.runs.across':
      case 'venture.connectors.check':
      case 'venture.share.request':
      case 'venture.blueprint.suggest':
      case 'venture.owner.get':
      case 'venture.owner.set':
      case 'venture.receipt.verify':
      case 'venture.journal.chain':
      case 'venture.journal.acceptBreak':
      case 'venture.order.contract':
      case 'venture.order.contract.propose':
      case 'venture.order.contract.sign':
      case 'venture.routines.list':
      case 'venture.routines.runs':
      case 'venture.routines.set':
      case 'venture.routines.remove':
      case 'venture.options.rerank':
      case 'venture.drills.run':
      case 'venture.drills.list':
      case 'venture.auto.readiness':
      case 'venture.shadow.summary':
      case 'venture.playbook.guidance':
      case 'venture.voice.get':
      case 'venture.voice.set':
      case 'venture.voice.learn':
      case 'venture.persona.get':
      case 'venture.persona.set':
      case 'venture.persona.test':
      case 'venture.agents.export':
      case 'venture.agents.import':
      case 'venture.knowledge.list':
      case 'venture.knowledge.add':
      case 'venture.knowledge.remove':
      case 'venture.knowledge.test':
      case 'venture.ideas.list':
      case 'venture.ideas.start':
      case 'venture.ideas.dismiss':
      case 'venture.agents.capabilities':
        return (await this.#ventureHost()).request(ctx, method, payload);
      default: throw new Error(`Unknown request: ${method}`);
    }
  }
  private async runJob(id: string) {
    const configured = this.store().read().jobs.find((item: any) => item.id === id);
    check(configured, 'NOT_FOUND', 'Job not found.');
    if (configured.plan) return this.jobRunner().run(this.context, id);
    check(configured.type === 'owner-brief', 'JOB_TYPE_UNSUPPORTED', 'This job has no installed runner.');
    check(this.context.memberId === configured.ownerId || this.context.role === 'owner', 'JOB_OWNER_REQUIRED', 'Only the job owner or workspace owner can run this job.');
    const owner = this.store().read().members.find(member => member.id === configured.ownerId);
    check(owner?.active && owner.epoch === configured.ownerEpoch && owner.role === configured.ownerRole, 'JOB_OWNER_REVOKED', 'The job owner changed or was revoked.');
    const jobContext: Context = { memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop' };
    const job = await this.services.jobs.acquire(jobContext, id, 'desktop-engine');
    if (job.status !== 'running' || !job.lease) return job;
    const result = await this.services.reports.brief(jobContext, { sourceIds: [...job.sourceIds] });
    const completed = await this.services.jobs.complete(jobContext, id, job.lease, { kind: 'brief', result, at: now() }, '0');
    // The scheduler may administer another member's run, but does not disclose
    // that member's cached report to a different requesting identity.
    if (this.context.memberId !== owner.id) return { id: completed.id, status: completed.status };
    return completed;
  }
  private answerRecoveryOwner(ctx: Context, view: StateStore) {
    const member = authorize(view, ctx, 'admin');
    check(member.role === 'owner' && ctx.channel === 'desktop' && !ctx.sourceTainted,
      'ANSWER_RECOVERY_OWNER_REQUIRED', 'Only the current owner in the untainted app can review and create this fresh calculation.');
  }
  private answerRecoveryView(state: State): StateStore {
    // Calculator writes affect only this candidate. The caller performs ONE Vault.update commit;
    // this store never re-enters the non-reentrant Vault guard or commits a partial receipt.
    return { read: () => structuredClone(state), update: async change => await change(state) };
  }
  private answerRecoveryCalculator(view: StateStore) {
    const configured = this.services.calculator as CalculatorService;
    const connectors = new EngineConnectorService(view, this.options.connectorRuntime);
    return new CalculatorService(view, {
      ...(configured.verifier ? { verifier: configured.verifier } : {}),
      consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
      receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt),
    });
  }
  private answerRecoveryEvidence(ctx: Context, answerId: unknown, view: StateStore) {
    this.answerRecoveryOwner(ctx, view);
    check(typeof answerId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(answerId), 'INVALID_ANSWER_RECOVERY', 'Choose one saved answer.');
    const state = view.read(), matches = state.answers.filter(answer => answer.id === answerId), answer = matches[0];
    check(matches.length === 1 && answer.request && typeof answer.receiptId === 'string'
      && state.receipts.filter(receipt => receipt.id === answer.receiptId).length === 1,
      'ANSWER_RECOVERY_SOURCE_CHANGED', 'The exact original answer and private receipt are unavailable.');
    const calculator = this.answerRecoveryCalculator(view), receipt = calculator.receipt(ctx, answer.receiptId);
    const evidence: AnswerRecoveryEvidence = { workspaceId: state.workspace.id,
      answer: { id: answer.id, receiptId: answer.receiptId, request: structuredClone(answer.request) }, receipt };
    explainAnswerRecovery(evidence);
    calculator.consumerGuard?.(ctx, structuredClone(answer.request));
    const current = new OntologyService(view).current(ctx);
    check(current, 'DICTIONARY_REQUIRED', 'Publish current business definitions before preparing a fresh calculation.');
    // Exclude unrelated output/audit appends and the issuing record itself. Every input,
    // meaning, retained connector binding and current authority dependency stays pinned.
    const evidencePin = hash({ vaultId: this.store().vaultId, workspaceId: state.workspace.id,
      memberId: ctx.memberId, epoch: ctx.epoch, originalAnswer: answer, originalReceipt: receipt,
      ontology: state.ontology, facts: state.facts, imports: state.imports, sourceRules: state.sourceRules,
      merges: state.merges, tombstones: state.tombstones, members: state.members, policy: state.policy });
    return { evidence, evidencePin, dictionary: { hash: current.hash, version: current.version } };
  }
  private answerRecoveryRecord(ctx: Context, newRequestId: unknown, view: StateStore) {
    this.answerRecoveryOwner(ctx, view);
    check(typeof newRequestId === 'string' && /^answer_recovery_[A-Za-z0-9_-]{1,160}$/.test(newRequestId),
      'INVALID_ANSWER_RECOVERY', 'Use a host-issued fresh calculation request.');
    const state = view.read(), records = state.answers.filter(answer => answer.id === newRequestId), record = records[0] as AnswerRecoveryRecord;
    check(records.length === 1 && record?.type === 'answer-recovery-request-v1' && record.workspaceId === state.workspace.id
      && record.memberId === ctx.memberId && record.epoch === ctx.epoch && record.preparation?.newRequestId === newRequestId
      && ['prepared', 'completed'].includes(record.status) && record.integrity === answerRecoveryRecordIntegrity(record),
      'ANSWER_RECOVERY_REQUEST_UNAVAILABLE', 'This exact issued request is unavailable under your current private ownership.');
    const resolved = this.answerRecoveryEvidence(ctx, record.preparation.source.originalAnswerId, view);
    assertPreparedAnswerRecoveryCurrent(resolved.evidence, record.preparation);
    return { record, resolved };
  }
  private answerRecoveryRead(ctx: Context, newRequestId: unknown) {
    const view = this.store(), { record, resolved } = this.answerRecoveryRecord(ctx, newRequestId, view);
    const base = { newRequestId: record.id, preparationDigest: record.preparation.digest,
      interpretation: 'new-calculation-with-declared-time-scope', historicalReplay: false, grantsAuthority: false,
      preservesOriginalRecords: true, retrospectivePromotion: 'still-blocked-by-preserved-unpinned-original' };
    if (record.status === 'prepared') {
      if (this.#unknownAnswerRecoveries.has(record.id)) return { ...base, status: 'outcome-unknown', requiresReopen: true,
        message: 'The commit acknowledgement is unknown. Lock and reopen this workspace, then inspect this issued request before explicitly retrying.' };
      check(record.evidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Evidence or access changed. Review and prepare a separate fresh request.');
      this.answerRecoveryCalculator(view).consumerGuard?.(ctx, structuredClone(record.preparation.request));
      return { ...base, status: 'prepared', preparation: structuredClone(record.preparation), dictionary: record.dictionary };
    }
    check(record.lineage, 'ANSWER_RECOVERY_RESULT_CHANGED', 'The completed request lacks its retained lineage.');
    const state = view.read(), answers = state.answers.filter(answer => answer.id === record.lineage!.newAnswerId), answer = answers[0];
    check(answers.length === 1 && answer?.newRequestId === record.id && answer.interpretation === base.interpretation
      && state.receipts.filter(receipt => receipt.id === record.lineage!.newReceiptId).length === 1,
      'ANSWER_RECOVERY_RESULT_CHANGED', 'The separate fresh answer and receipt are unavailable.');
    const receipt = this.answerRecoveryCalculator(view).receipt(ctx, record.lineage.newReceiptId);
    const result = { answer: { id: answer.id, receiptId: answer.receiptId, request: structuredClone(answer.request) }, receipt };
    const lineage = completeAnswerRecovery(resolved.evidence, record.preparation, result);
    check(hash(lineage) === hash(record.lineage), 'ANSWER_RECOVERY_RESULT_CHANGED', 'The retained completed lineage does not match its exact issued result.');
    return { ...base, status: 'completed', lineage: structuredClone(lineage), answer: result.answer, receipt };
  }
  private async executeAnswerRecovery(ctx: Context, newRequestId: unknown, preparationDigest: unknown) {
    check(typeof preparationDigest === 'string' && /^[a-f0-9]{64}$/.test(preparationDigest), 'INVALID_ANSWER_RECOVERY', 'Confirm the exact reviewed preparation digest.');
    const vault = this.store(), issued = this.answerRecoveryRecord(ctx, newRequestId, vault);
    check(issued.record.preparation.digest === preparationDigest, 'ANSWER_RECOVERY_PREPARATION_CHANGED', 'Review this exact issued preparation before execution.');
    if (issued.record.status === 'completed') return this.answerRecoveryRead(ctx, newRequestId);
    check(!this.#unknownAnswerRecoveries.has(issued.record.id), 'ANSWER_RECOVERY_OUTCOME_UNKNOWN', 'Lock and reopen, then inspect this issued request. Do not repeat an ambiguous calculation.');
    const pending = this.#answerRecoveryExecutions.get(issued.record.id);
    if (pending) { await pending; return this.answerRecoveryRead(ctx, newRequestId); }
    let completed!: () => void, failed!: (error: unknown) => void;
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => { completed = resolveCompletion; failed = rejectCompletion; });
    void completion.catch(() => {}); // The issuing request still reports its own failure.
    this.#answerRecoveryExecutions.set(issued.record.id, completion);
    let calculated = false;
    try {
      await vault.update(async state => {
        const view = this.answerRecoveryView(state), { record, resolved } = this.answerRecoveryRecord(ctx, newRequestId, view);
        check(record.preparation.digest === preparationDigest, 'ANSWER_RECOVERY_PREPARATION_CHANGED', 'The issued preparation changed before commit.');
        if (record.status === 'completed') return; // A concurrent exact retry observes the same result.
        check(record.evidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Current evidence or access changed before execution. Review again.');
        const calculator = this.answerRecoveryCalculator(view);
        const receipt = await calculator.calculate(ctx, structuredClone(record.preparation.request)); calculated = true;
        const fresh = state.answers.filter(answer => answer.receiptId === receipt.id);
        check(fresh.length === 1, 'ANSWER_RECOVERY_RESULT_CHANGED', 'The fresh calculation must retain one separate answer.');
        // Re-resolve the original after verification and calculator candidate writes.
        const after = this.answerRecoveryEvidence(ctx, record.preparation.source.originalAnswerId, view);
        check(after.evidencePin === record.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Original evidence or current authority changed during execution.');
        const result = { answer: { id: fresh[0].id, receiptId: receipt.id, request: structuredClone(fresh[0].request) },
          receipt: calculator.receipt(ctx, receipt.id) };
        const lineage = completeAnswerRecovery(after.evidence, record.preparation, result);
        fresh[0].newRequestId = record.id; fresh[0].interpretation = lineage.interpretation;
        const persisted = state.answers.find(answer => answer.id === record.id) as AnswerRecoveryRecord;
        persisted.status = 'completed'; persisted.lineage = structuredClone(lineage); persisted.integrity = answerRecoveryRecordIntegrity(persisted);
        audit(state, 'answer-recovery.completed', { newRequestId: record.id, originalAnswerId: lineage.source.originalAnswerId,
          newAnswerId: lineage.newAnswerId, newReceiptId: lineage.newReceiptId, historicalReplay: false });
      });
      completed();
    } catch (error) {
      // Once a candidate result exists, an error may be an adapter's lost commit acknowledgement.
      // This handle refuses another computation until reopen resolves durable authority.
      if (calculated) {
        this.#unknownAnswerRecoveries.add(issued.record.id);
        const unknown = new ChausarError('ANSWER_RECOVERY_OUTCOME_UNKNOWN', 'The fresh calculation commit acknowledgement is unknown. Lock and reopen, then inspect this issued request; do not automatically retry.');
        failed(unknown); throw unknown;
      }
      failed(error); throw error;
    } finally {
      this.#answerRecoveryExecutions.delete(issued.record.id);
    }
    return this.answerRecoveryRead(ctx, newRequestId);
  }
  private journalPayload(value: unknown, allowed: readonly string[], required: readonly string[], code: string): Record<string, unknown> {
    check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code, 'Use a journal object payload.');
    check(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), code, 'Supply the required journal fields without unknown properties.');
    return value as Record<string, unknown>;
  }
  private journalWriter(ctx: Context) {
    authorize(this.store(), ctx, 'prepare');
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_DECISION_REQUIRED', 'Prepare and review an internal decision explicitly inside the app.');
  }
  private journalRevision(value: unknown): asserts value is number {
    check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1, 'REVISION_CONFLICT', 'Supply the loaded journal revision before changing it.');
  }
  private workbookBytes(payload: any): Uint8Array {
    const value = payload.bytesBase64 ?? payload.moduleBase64;
    check(typeof value === 'string' && value.length > 0 && value.length <= 2_800_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'INVALID_WORKBOOK', 'Choose a bounded XLSX workbook.');
    return Buffer.from(value, 'base64');
  }
  private workbookInput(payload: any) {
    const workbook = readWorkbook(this.workbookBytes(payload), { sheet: payload.sheet });
    check(workbook.sheets.length === 1 || typeof payload.sheet === 'string', 'SHEET_REQUIRED', 'Choose the exact worksheet to import.');
    const sheet = payload.sheet ? workbook.sheets.find(item => item.name === payload.sheet) : workbook.sheets[0];
    check(sheet, 'SHEET_REQUIRED', 'The selected worksheet is missing.');
    return { sourceId: payload.sourceId, format: 'csv' as const, content: workbookSheetToCSV(sheet), ...(payload.recipe ? { recipe: payload.recipe } : {}), ...(payload.expectedTotals ? { expectedTotals: payload.expectedTotals } : {}) };
  }
  private visibleImports() {
    const store = this.store(); const state = store.read(); const ctx = this.context;
    const legacy = state.imports.filter(item => !item.type && Array.isArray(item.rowIds) && sourceAllowed(state, ctx, item.sourceId)
      && item.rowIds.every((id: string) => { const fact = state.facts.find(f => f.id === id); return !!fact && canSeeFact(store, ctx, fact); }));
    return [...legacy.map(importPublicRecord), ...this.services.connectorRuntime.sourceSummaries(ctx)];
  }
  private privateRecipeEvidence(ctx: Context, sourceId: string): PrivateTrialRecipeEvidence {
    const state = this.store().read(); assertSourceAccess(state, ctx, [sourceId]);
    check(state.facts.filter(fact => fact.sourceId === sourceId).every(fact => canSeeFact(this.store(), ctx, fact)), 'FORBIDDEN_BRANCH', 'A recipe trial requires access to the complete retained producer history.');
    const imports = state.imports.filter(item => item.sourceId === sourceId && item.format);
    check(imports.length > 0 && imports.every(item => item.retainedInput?.version === 1 && item.retainedInput.digest === hash(item.retainedInput.input)
      && item.contentHash === hash(item.retainedInput.input.content) && item.recipeHash === hash(item.retainedInput.input.recipe)
      && item.coverage?.reconciled === true && Array.isArray(item.rowIds) && Number.isSafeInteger(item.retainedInput.input.expectedTotals?.rowCount)
      && /^-?\d+$/.test(item.retainedInput.input.expectedTotals?.amountMinor)), 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Every source generation needs its exact retained original input, recipe, explicit independent controls and reconciled lineage. Older hash-only imports cannot be inferred.');
    check(!state.imports.some(item => item.sourceId === sourceId && item.type?.startsWith('connector-')), 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Managed capture remapping requires its full qualified source custody resolver.');
    return { sourceId, recipe: structuredClone(imports.at(-1)!.retainedInput.input.recipe), captures: imports.map(item => ({ importId: item.id,
      generation: item.retainedInput.generation, complete: true, input: structuredClone(item.retainedInput.input), factIds: [...item.rowIds] })) };
  }
  private interchangeOwner(ctx: Context, historical: State) {
    this.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete workspace copying requires the untainted desktop owner.');
    check(this.options.sync === undefined, 'INTERCHANGE_EXTERNAL_CUSTODY_REQUIRED', 'Configured device sync needs its independently enumerated external custody before a complete local transfer can be admitted.');
    const current = this.store().read();
    const sourceIds = [...new Set<string>([...historical.facts.map(fact => fact.sourceId), ...historical.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])];
    assertSourceAccess(current, ctx, sourceIds);
    check(historical.facts.every(fact => canSeeFact(this.store(), ctx, fact)), 'INTERCHANGE_READ_SCOPE_REQUIRED', 'Workspace copying requires current access to every retained historical row.');
    const managedSourceIds = [...new Set<string>(current.imports.filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type)).map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    this.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
  }
  private backupHost(): WorkspaceBackupV2Host {
    check(this.services.backupV2 instanceof WorkspaceBackupV2Host, 'BACKUP_STORAGE_PROFILE_REQUIRED',
      'This storage profile requires its separately reviewed complete encrypted-custody implementation.');
    return this.services.backupV2;
  }
  private activationHost(): EngineWorkspaceActivation {
    check(this.services.workspaceActivation instanceof EngineWorkspaceActivation, 'ACTIVATION_ROOT_REQUIRED',
      'Install the reviewed synthetic local activation, actual encrypted journal and fresh credential capability in the trusted host.');
    return this.services.workspaceActivation;
  }
  private backupCompleteOwner(ctx: Context, historical: State) {
    this.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete encrypted archive custody requires the untainted desktop owner.');
    const current = this.store().read();
    const sourceIds = [...new Set<string>([...historical.facts.map(fact => fact.sourceId),
      ...historical.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])];
    assertSourceAccess(current, ctx, sourceIds);
    check(historical.facts.every(fact => canSeeFact(this.store(), ctx, fact)), 'BACKUP_READ_SCOPE_REQUIRED', 'Current access must cover every retained historical row.');
    const managedSourceIds = [...new Set<string>([...current.imports, ...historical.imports]
      .filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type))
      .map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    check((this.options.sync === undefined && managedSourceIds.length === 0) || typeof this.options.backupCustody?.withCompleteOwner === 'function',
      'BACKUP_HELD_READINESS_REQUIRED', 'Configured sync and managed sources require installed held owner/source/readiness admission through archive publication.');
    this.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
  }
  private privatePromotionImpact(ctx: Context, state = this.store().read(), strategy?: 'prospective' | 'retrospective') {
    const view: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Impact inspection is read-only.'); } };
    const member = authorize(view, ctx, 'admin');
    check(member.branches.includes('*'), 'TRIAL_IMPACT_SCOPE_REQUIRED', 'Complete publication impact requires every workspace branch.');
    assertSourceAccess(state, ctx, [...new Set(state.facts.map(fact => fact.sourceId))]);
    // Conservatively include every persisted output: meaning changes can affect even equal totals.
    const outputs = [state.receipts, state.answers, state.decisions, state.jobs, state.actions, state.conversations, state.modelReceipts, state.learning, state.schedules, state.plugins];
    const affectedArtifactIds = [...new Set<string>(outputs.flatMap(records => records.map(record => record.id).filter((id): id is string => typeof id === 'string' && id.length > 0)))].sort();
    const rebuildArtifactIds = [...new Set<string>(state.answers.filter(record => record.request && record.receiptId).map(record => record.id))].sort();
    if (strategy === 'retrospective') {
      const ineligible = state.answers.filter(answer => rebuildArtifactIds.includes(answer.id)).filter(answer => {
        const receipt = state.receipts.find(receipt => receipt.id === answer.receiptId);
        return !answer.request?.asOf || receipt?.memberId !== ctx.memberId || receipt?.epoch !== ctx.epoch;
      }).map(answer => answer.id);
      check(ineligible.length === 0, 'TRIAL_REBUILD_REQUIRED', `Retrospective publication needs current private ownership and explicitly pinned requests for these outputs: ${ineligible.join(', ')}.`);
    }
    const activeWorkIds = [...new Set<string>([
      ...state.jobs.filter(job => !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) || job.lease
        || [job.execution, ...(job.archivedExecutions ?? [])].some(execution => execution?.attempts?.some((attempt: any) => ['dispatched', 'unknown'].includes(attempt.status)))),
      ...state.actions.filter(action => !['verified', 'cancelled', 'rejected'].includes(action.status)
        || action.attempts?.some((attempt: any) => ['executing', 'unknown'].includes(attempt.outcome))),
      ...state.schedules.filter(schedule => schedule.enabled !== false && schedule.status !== 'cancelled'),
    ].map(record => record.id).filter((id): id is string => typeof id === 'string'))].sort();
    return { complete: true as const, affectedArtifactIds, rebuildArtifactIds, activeWorkIds };
  }
  private async promotePrivateTrial(ctx: Context, publication: PrivateTrialAtomicPublication): Promise<{ publicationId: string }> {
    const vault = this.store();
    return vault.update(async state => {
      const view: StateStore = { read: () => structuredClone(state), update: async () => { throw new ChausarError('REENTRANT_TRANSACTION', 'Use the current publication transaction.'); } };
      publication.assertCurrent(view);
      check(hash(this.privatePromotionImpact(ctx, state, publication.proposal.impact.strategy)) === hash({ complete: publication.proposal.impact.complete,
        affectedArtifactIds: publication.proposal.impact.affectedArtifactIds, rebuildArtifactIds: publication.proposal.impact.rebuildArtifactIds,
        activeWorkIds: publication.proposal.impact.activeWorkIds }), 'TRIAL_IMPACT_CHANGED', 'Complete publication dependencies changed inside the commit.');
      const { fork, proposal } = publication; const at = now(), publicationId = newId('trialpublication');
      if (fork.change.type === 'definition') {
        // Preserve the exact reviewed compilation metadata/hash. Operational activation time is separate.
        state.ontology = structuredClone(fork.candidate.ontology);
      } else if (fork.change.type === 'source-precedence') {
        state.sourceRules.push({ id: newId('rule'), kind: fork.change.kind, sourceIds: [...fork.change.sourceIds], at, by: ctx.memberId, trialPublicationId: publicationId });
      } else {
        const change = fork.change;
        const live = new Map(state.facts.filter(fact => fact.sourceId === change.sourceId && !fact.supersededAt && !fact.deletedAt).map(fact => [JSON.stringify([fact.kind, fact.entityId]), fact]));
        const capture = fork.recipeEvidence[0]?.captures.toSorted((left, right) => left.generation - right.generation).at(-1);
        check(capture && [...live.values()].every(fact => capture.factIds.includes(fact.id)), 'TRIAL_PRODUCER_GENERATION_REQUIRED', 'Publication needs one retained complete latest producer generation; incremental fragments cannot be silently treated as a full replacement.');
        const preview = new ImportService(view).preview(ctx, { ...capture.input, recipe: change.replacement });
        check(preview.accepted && preview.facts.length === live.size, 'TRIAL_RECIPE_CUSTODY_CHANGED', 'The reviewed latest complete source generation must still reconcile at publication.');
        const outputs = capture.factIds.map(id => fork.candidate.facts.find(fact => fact.id === id)!).map(fact => ({ entityId: fact.entityId, sourceId: fact.sourceId,
          sourceRow: fact.sourceRow, kind: fact.kind, validFrom: fact.validFrom, validTo: fact.validTo, fields: structuredClone(fact.fields), ...(fact.branch ? { branch: fact.branch } : {}) }));
        const source = new EngineConnectorService(view, this.options.connectorRuntime);
        const request = { version: 1 as const, complete: true as const, sourceId: change.sourceId, expected: producerReplacementPins(state, change.sourceId), publishedAt: at,
          outputs, custody: { inputDigest: hash(fork.recipeEvidence), recipeDigest: hash(change.replacement), outputDigest: producerReplacementOutputDigest(outputs) },
          controls: { rowCount: outputs.length, sums: [{ field: 'amountMinor', minor: String(outputs.reduce((sum, output) => sum + BigInt(String(output.fields.amountMinor)), 0n)) }] } };
        publishProducerReplacement(state, request, { assertCustody: (_state, input) => {
          check(input.custody.inputDigest === hash(fork.recipeEvidence) && input.custody.recipeDigest === hash(change.replacement), 'TRIAL_RECIPE_CUSTODY_CHANGED', 'Publication must use the exact reviewed issued custody.');
        }, assertCurrentAdmission: () => { for (const saved of fork.savedRequests) source.assertCalculationReady(ctx, saved.request); } });
        const next = new Map(state.facts.filter(fact => fact.sourceId === change.sourceId && !fact.supersededAt && !fact.deletedAt).map(fact => [JSON.stringify([fact.kind, fact.entityId]), fact]));
        const retained = JSON.parse(JSON.stringify({ ...capture.input, recipe: change.replacement }));
        const rowIds = preview.facts.map(fact => next.get(JSON.stringify([fact.kind, fact.entityId]))?.id);
        check(rowIds.every(id => typeof id === 'string'), 'TRIAL_RECIPE_CUSTODY_CHANGED', 'Every published producer row needs its actual live assertion lineage.');
        state.imports.push({ id: newId('import'), at, sourceId: change.sourceId, format: capture.input.format,
          contentHash: preview.contentHash, recipeHash: preview.recipeHash, rowIds, coverage: preview.coverage, totalsMinor: preview.totalsMinor,
          expectedTotals: capture.input.expectedTotals, unmappedFields: preview.unmappedFields, qualification: 'experimental', trialPublicationId: publicationId,
          retainedInput: { version: 1, generation: state.imports.filter(item => item.sourceId === change.sourceId && item.format).length + 1,
            input: retained, digest: hash(retained) } });
        state.learning.push({ id: publicationId, type: 'private-trial-recipe-publication-v1', sourceId: change.sourceId,
          sourceIds: [change.sourceId], recipe: structuredClone(change.replacement), recipeHash: hash(change.replacement), at, shared: false });
      }
      // Original receipts are immutable historical evidence; current answers carry explicit staleness.
      for (const answer of state.answers) { answer.stale = true; answer.staleReason = 'A reviewed private trial changed the published meaning.'; }
      if (proposal.impact.strategy === 'retrospective') {
        // Restatement is new evidence. It never overwrites historical receipts or their IDs.
        let replay = structuredClone(fork.candidate);
        const local: StateStore = { read: () => structuredClone(replay), update: async change => {
          const draft = structuredClone(replay); const result = await change(draft); replay = draft; return result;
        } };
        const connectors = new EngineConnectorService(local, this.options.connectorRuntime);
        const database = this.options.demo ? null : new DatabaseCalculator(this.options.analytics);
        const rebuilds = proposal.impact.rebuildArtifactIds.map(id => state.answers.find(answer => answer.id === id));
        for (const saved of rebuilds) {
          const original = state.receipts.find(receipt => receipt.id === saved?.receiptId);
          check(saved?.request?.asOf && original?.memberId === ctx.memberId && original?.epoch === ctx.epoch, 'TRIAL_REBUILD_REQUIRED', 'Every acknowledged rebuild needs its current private owner and explicitly pinned original request.');
          const calculator = new CalculatorService(local, { ...(database ? { verifier: receipt => database.verify(receipt) } : {}), consumerGuard: (context, request) => connectors.assertCalculationReady(context, request),
            receiptGuard: (context, receipt) => connectors.assertReceiptReady(context, receipt),
            restatement: { version: 1, interpretation: 'restated-private-diagnostic', trialId: fork.id, forkDigest: fork.digest,
              candidateStateDigest: fork.candidatePin.stateDigest, publicationId, originalAnswerId: saved.id, originalReceiptId: original.id } });
          const receipt = await calculator.calculate(ctx, structuredClone(saved.request));
          state.receipts.push(structuredClone(receipt));
          state.answers.push({ id: newId('answer'), request: structuredClone(saved.request), receiptId: receipt.id, memberId: ctx.memberId,
            epoch: ctx.epoch, at, interpretation: 'restated-private-diagnostic', restatement: 'reviewed-private-trial', publicationId, originalAnswerId: saved.id });
        }
      }
      audit(state, 'private-trial.published', { publicationId, trialId: fork.id, strategy: proposal.impact.strategy,
        candidatePin: fork.candidatePin.stateDigest, activatedAt: at });
      return { publicationId };
    });
  }
  private async privateRestatementContext(ctx: Context, receiptId: unknown) {
    check(typeof receiptId === 'string', 'RESTATEMENT_CONTEXT_REQUIRED', 'Choose one retained restated calculation receipt.');
    const receipt = this.services.calculator.receipt(ctx, receiptId), anchor = receipt.restatement;
    check(anchor?.version === 1 && anchor.interpretation === 'restated-private-diagnostic', 'RESTATEMENT_CONTEXT_REQUIRED', 'This receipt has no issued private restatement context.');
    this.assertRestatementCustodyRetained(receiptId);
    let retained, binding;
    try {
      retained = await this.store().readArtifact({ id: `${anchor.trialId}-fork`, purpose: 'private-trial' });
      binding = await this.store().readArtifact({ id: `${anchor.trialId}-binding`, purpose: 'private-trial' });
    } catch (error: any) {
      this.assertRestatementCustodyRetained(receiptId);
      if (error.code === 'ARTIFACT_NOT_FOUND') throw new ChausarError('RESTATEMENT_CUSTODY_UNAVAILABLE', 'The issued restatement payload is absent; the historical receipt remains labelled but its paired interpretation cannot be released.');
      throw error;
    }
    const fork = retained.value as PrivateTrialAtomicPublication['fork'], issued = binding.value as any;
    const { digest: ignored, ...body } = fork;
    check(fork.digest === anchor.forkDigest && hash(body) === fork.digest && fork.candidatePin.stateDigest === anchor.candidateStateDigest
      && fork.memberId === ctx.memberId && fork.epoch === ctx.epoch && fork.workspaceId === this.store().read().workspace.id
      && issued.status === 'promoted' && issued.publicationId === anchor.publicationId && issued.fork.issuedDigest === fork.digest
      && issued.fork.ref.valueDigest === retained.valueDigest, 'RESTATEMENT_CONTEXT_CHANGED', 'The retained restatement differs from its independently issued fork and publication context.');
    const originalReceipt = this.services.calculator.receipt(ctx, anchor.originalReceiptId);
    const view: StateStore = { read: () => structuredClone(fork.candidate), update: async () => { throw new Error('Restatement context is inert.'); } };
    new EngineConnectorService(view, this.options.connectorRuntime).assertReceiptReady(ctx, receipt);
    // Recheck live access after custody I/O, including every retained exclusion.
    this.services.calculator.receipt(ctx, receiptId);
    this.assertRestatementCustodyRetained(receiptId);
    return { receiptId, interpretation: anchor.interpretation, originalReceipt, forkDigest: fork.digest, candidatePin: fork.candidatePin,
      change: structuredClone(fork.change), rows: receipt.rowIds.map((id: string) => ({ factId: id,
        original: structuredClone(fork.baseline.facts.find(fact => fact.id === id)), restated: structuredClone(fork.candidate.facts.find(fact => fact.id === id)) })) };
  }
  private assertRestatementCustodyRetained(receiptId: string) {
    check(!this.store().read().tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receiptId)),
      'RESTATEMENT_CUSTODY_REVOKED', 'Managed retention or source deletion released the complete fork containing this receipt. Its immutable restatement anchor remains, but paired interpretation is explicitly unavailable.');
  }
  private visibleActivity(ctx: Context) {
    const store = this.store(); const member = authorize(store, ctx); const state = store.read();
    return state.activity.filter(item => {
      const details = item.details ?? {};
      const sourceIds = details.sourceId ? [details.sourceId] : details.sourceIds;
      if (Array.isArray(sourceIds) && !sourceIds.every((id: string) => sourceAllowed(state, ctx, id) && state.facts.filter(f => f.sourceId === id).every(f => canSeeFact(store, ctx, f)))) return false;
      return (member.role === 'owner' && member.branches.includes('*')) || details.memberId === ctx.memberId;
    });
  }
  private async purgeManagedCopies() {
    // A whole-workspace fork can hold forgotten bytes from another source. Revoke
    // surviving receipt contexts BEFORE deleting those copies; never retain the
    // forgotten fork solely to satisfy an unrelated receipt's interpretation.
    const vault = this.store(), current = vault.read();
    if (current.receipts.some(receipt => receipt.restatement && !current.tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receipt.id)))) {
      await vault.update(state => {
        const receiptIds = state.receipts.filter(receipt => receipt.restatement && !state.tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receipt.id))).map(receipt => receipt.id).sort();
        if (receiptIds.length) state.tombstones.push({ id: newId('tombstone'), kind: 'private-restatement-custody', receiptIds,
          reason: 'managed-retention-or-deletion', deletedAt: now() });
      });
    }
    const removed: string[] = await this.store().purgeArtifacts();
    const prefix = `chausar-${this.store().read().workspace.id}-`;
    for (const name of ['backups', 'exports']) {
      const folder = resolve(this.options.directory, name); let files;
      try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') continue; throw error; }
      for (const file of files) if (file.isFile() && file.name.startsWith(prefix) && MANAGED_COPY_TAIL.test(file.name.slice(prefix.length))) { const path = resolve(folder, file.name); check(relative(folder, path) === file.name, 'INVALID_PATH', 'A managed file left its export directory.'); await unlink(path); removed.push(`${name}/${file.name}`); }
    }
    return removed;
  }
  // ------------------------------------------------------------ keeping the vault key on this computer
  // KEYCHAIN-SPEC sections 2 to 4 and 8. The computer secret sits in the vault's passphrase slot; the
  // operating system keeps it for the owner's login. Secrets never reach a result, a record, a log or an error.
  #custody: { files: CustodyFiles; keys: DeviceKeyStore; autoBackups: boolean; clock: () => number } | null = null;
  #custodyFiles: CustodyFiles | null = null;
  #custodyChain: Promise<unknown> = Promise.resolve();
  #openFolder: string | null = null;
  #openUnlock: UnlockMode | null = null;
  #closedByOwner = false;
  #schedule: BackupSchedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
  private custodyHost() {
    const option = this.options.workspaceCustody; if (!option) return null;
    if (!this.#custody) {
      const keys = option.deviceKeys === 'os' ? osDeviceKeyStore() : option.deviceKeys === 'none' ? noDeviceKeyStore('not-configured') : option.deviceKeys;
      this.#custody = { files: this.custodyFiles(), keys, autoBackups: option.autoBackups === true, clock: option.clock ?? Date.now };
    }
    return this.#custody;
  }
  private custodyFiles(): CustodyFiles { return this.#custodyFiles ??= new CustodyFiles(this.options.directory); }
  private custodyNow(): number { return this.custodyHost()?.clock() ?? Date.now(); }
  private storageKind(): 'experimental-file' | 'postgres' {
    return this.vault?.storageKind ?? (this.options.storage === 'experimental-file' && this.options.demo ? 'experimental-file' : 'postgres');
  }
  /** One custody change, backup write, rotation or reseal at a time. */
  private custodySerial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#custodyChain.then(work); this.#custodyChain = next.catch(() => {}); return next;
  }
  private resetCustodySession() {
    this.#openFolder = null; this.#openUnlock = null;
    this.#schedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    this.#snapshotMark = { at: null, revision: null };
  }
  // ------------------------------------------------------------ business snapshots (Ink v2 wave 4, 4J6)
  // What the other businesses on this computer may know about one that is closed (workspace-snapshots.ts): written at
  // most once a minute while it changes and again on lock, only for a business that opens with this computer.
  #snapshots: WorkspaceSnapshots | null = null;
  #snapshotMark: { at: number | null; revision: number | null } = { at: null, revision: null };
  /** The summaries and the never-contact list on this computer; null on the hosted app or without custody. */
  private snapshotStore(): WorkspaceSnapshots | null {
    if (this.options.venture?.host === 'hosted-web') return null;
    const custody = this.custodyHost(); if (!custody) return null;
    return this.#snapshots ??= new WorkspaceSnapshots(this.options.directory, () => custody.keys);
  }
  /** The other businesses as their summaries read, the open one left out; a passphrase one is never read. Never throws. */
  private async snapshotReads(): Promise<BusinessSnapshotRead[]> {
    const store = this.snapshotStore(); if (!store) return [];
    try {
      const files = this.custodyFiles();
      const listed = (await files.listBusinesses(this.storageKind())).businesses;
      const vaults = new Map((await files.listCards()).map(card => [card.folder, card.vaultId]));
      return await store.list(listed.map(item => ({ id: item.folder, name: item.name, opens: item.opens, openedAt: item.openedAt })), vaults, this.vault ? this.#openFolder : null);
    } catch { return []; }
  }
  /**
   * workspace.custody.neverContactReset { confirmation } (4J6): the owner's explicit step to start a new never-contact
   * list, only while the old one can no longer be checked (NEVER_CONTACT_LOST; one that still checks is NEVER_CONTACT_OK).
   * The caller has passed requireAppOwner, so a business is open; confirmation is its name. Refused on the hosted app.
   * The open business adds its own blocklist again at once, the others when next opened; people forgotten elsewhere
   * can't be put back. Journalled in the audit.
   */
  private async neverContactReset(payload: any): Promise<{ line: string }> {
    const store = this.snapshotStore(), vault = this.store();
    check(store, 'TIER_UNAVAILABLE', 'This computer keeps no never-contact list.');
    check(typeof payload?.confirmation === 'string' && payload.confirmation === vault.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.');
    let lost = false;
    try { await store.neverContactHas([]); } catch (error) { if ((error as ChausarError)?.code !== 'NEVER_CONTACT_LOST') throw error; lost = true; }
    check(lost, 'NEVER_CONTACT_OK', 'Your never-contact list on this computer still checks, so there is nothing to start again.');
    const line = await store.neverContactReset();
    await vault.update(state => audit(state, 'custody.never-contact-reset', {}));
    this.#snapshotMark = { at: null, revision: null };
    await this.writeSnapshot(false);
    return { line };
  }
  /** At a tick: the open business's summary, when one is due. Never throws. */
  private async snapshotTick() {
    if (this.#closing || this.#transition || !this.vault) return;
    this.#activeRequests++;
    try { await this.writeSnapshot(false); } finally { this.#activeRequests--; this.notifyIdle(); }
  }
  /**
   * The open business's summary when due, or on lock: written only for a business that opens with this computer; one
   * that needs a passphrase has its summary taken away. Either way the addresses its own blocklist keeps out join the
   * never-contact list, as keyed checks. Never throws: the next tick or lock tries again.
   */
  private async writeSnapshot(lock: boolean) {
    const store = this.snapshotStore(), vault = this.vault, folder = this.#openFolder;
    if (!store || !vault || !folder) return;
    try {
      if (!vault.read().conversations.some((record: any) => record?.kind === 'venture-record')) return;
      if (!snapshotDue(this.#snapshotMark, vault.read().revision, this.custodyNow(), lock)) return;
      const host = await this.#ventureHost() as unknown as { snapshot?: (ctx: Context) => Promise<{ snapshot: Record<string, unknown>; neverContact: string[] } | null> };
      if (this.vault !== vault || typeof host.snapshot !== 'function') return;
      const made = await host.snapshot({ ...this.#baseContext });
      if (!made) return;
      this.#snapshotMark = { at: this.custodyNow(), revision: vault.read().revision };
      if (made.neverContact.length) await store.neverContactAdd(made.neverContact).catch(() => {});
      if (this.#openUnlock !== 'this-computer') { await store.remove(folder); return; }
      await store.write(folder, { format: SNAPSHOT_FORMAT, businessId: folder, vaultId: vault.vaultId, ...made.snapshot } as BusinessSnapshot);
    } catch { /* The next tick or lock tries again. */ }
  }
  private requireAppOwner(ctx: Context) {
    this.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Change how your business is kept from inside the app.');
  }
  /** The secret this computer keeps for a vault. PASSPHRASE_REQUIRED with no key record; DEVICE_KEY_FAILED when the OS refuses. */
  private async computerSecret(vaultId: string | null): Promise<string> {
    const custody = this.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const record = vaultId ? await custody.files.readKey(vaultId) : null;
    if (!record) throw new ChausarError('PASSPHRASE_REQUIRED', CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
    // A business already kept by this computer: no passphrase opens it, so never say "Chausar asks for a passphrase".
    const probe = await custody.keys.probe();
    if (!probe.available) throw probe.reason === 'not-configured' || probe.reason === 'platform' ? deviceKeyFailed(probe.reason)
      : Object.assign(new ChausarError('DEVICE_KEY_FAILED', CUSTODY_WORDS.lock.keyNotAnswering), { reason: probe.reason });
    let secret: Buffer | null;
    try { secret = await custody.keys.unprotect(record); } catch { throw deviceKeyFailed(); }
    if (!secret) throw deviceKeyFailed();
    try { return secret.toString('base64url'); } finally { secret.fill(0); }
  }
  /** The secret another folder of the same vault already uses, so both keep opening; null when there is none. */
  private async existingComputerSecret(vaultId: string): Promise<string | null> {
    try { return await this.computerSecret(vaultId); } catch { return null; }
  }
  private async storeComputerSecret(vault: Vault, secret: Buffer) {
    const custody = this.custodyHost()!; let record: DeviceKeyRecord | null = null;
    try { record = await custody.keys.protect(vault.vaultId, secret); await custody.files.writeKey(record); }
    catch {
      if (record) await custody.keys.forget(record).catch(() => {});
      await vault.close().catch(() => {}); throw deviceKeyFailed();
    }
  }
  /** Forget this computer's key for a vault unless another business folder still opens with it. */
  private async forgetKeyIfUnused(vaultId: string, folder: string | null) {
    const custody = this.custodyHost(); if (!custody) return;
    const others = (await custody.files.listCards()).filter(card => card.vaultId === vaultId && card.folder !== folder && card.unlock === 'this-computer');
    if (others.length) return;
    const record = await custody.files.readKey(vaultId); if (!record) return;
    await custody.keys.forget(record).catch(() => {});
    await custody.files.removeKey(vaultId);
  }
  private async currentCard(): Promise<VaultCard> {
    const custody = this.custodyHost(); if (!custody) throw deviceKeysUnavailable('not-configured');
    const card = this.#openFolder ? await custody.files.readCard(this.#openFolder) : null;
    check(card, 'VAULT_LOCKED', 'Open your business first.');
    return card;
  }
  /** After a vault opens: remember how, write or refresh its card, finish an interrupted custody change. */
  private async afterOpen(folder: string, how: 'this-computer' | 'typed', options: { recovery?: RecoveryState; reseal?: boolean; created?: boolean } = {}) {
    this.#openFolder = folder; this.#openUnlock = how === 'this-computer' ? 'this-computer' : 'passphrase'; this.#closedByOwner = false;
    const custody = this.custodyHost(); if (!custody) return;
    await this.loadSchedule();
    const vault = this.store(), state = vault.read(), unlock = this.#openUnlock, prior = await custody.files.readCard(folder);
    const recovery: RecoveryState = options.recovery ?? (prior?.state === 'ready' ? prior.recovery : how === 'typed' ? 'made' : 'unknown');
    const reseal = !!options.reseal || (!!prior && prior.state === 'ready' && (prior.pending !== null || prior.unlock !== unlock));
    const card: VaultCard = { ...(prior ?? newCard({ folder, unlock, recovery })), vaultId: vault.vaultId, workspaceId: state.workspace.id,
      name: state.workspace.name, demo: state.workspace.demo, unlock, recovery, state: 'ready', pending: reseal ? 'reseal' : null,
      wrappersDigest: vault.wrappersDigest, openedAt: new Date(this.custodyNow()).toISOString() };
    await custody.files.writeCard(card);
    if (reseal) await this.resealManaged();
    if (how === 'typed') await this.forgetKeyIfUnused(vault.vaultId, folder);
    if (how === 'typed') await this.snapshotStore()?.remove(folder); // a passphrase business keeps no summary (4J6)
    if (reseal) await custody.files.writeCard({ ...card, pending: null });
  }
  private async loadSchedule() {
    this.#schedule = { lastAt: null, lastRevision: null, due: false, lastError: null };
    const vault = this.vault; if (!vault || !this.custodyHost()) return;
    const files = this.custodyFiles(), newest = (await files.backupFiles(vault.read().workspace.id))[0];
    if (!newest) return;
    const header = await files.backupHeader(newest.name);
    this.#schedule = { ...this.#schedule, lastAt: newest.at, lastRevision: header?.vaultId === vault.vaultId ? header.revision : null };
  }
  /** Re-seal this vault's managed backups and encrypted exports with the live wrappers (KEYCHAIN-SPEC 4.4). Skipped when
   * this folder opens with this computer and another folder of the same vault is locked with a passphrase: the backups
   * are shared by workspace id, and resealing them would quietly undo that passphrase. */
  private async resealManaged() {
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id;
    if (this.#openUnlock !== 'passphrase' && (await files.listCards()).some(card => card.state === 'ready' && card.vaultId === vault.vaultId
      && card.folder !== this.#openFolder && card.unlock === 'passphrase')) return { resealed: [], skipped: [] };
    const paths = [...(await files.backupFiles(workspaceId)).map(file => join(files.backups, file.name)), ...await files.exportFiles(workspaceId)];
    return vault.resealBackups(paths);
  }
  private async backupView(name: string): Promise<BackupView> {
    const files = this.custodyFiles(), cards = this.custodyHost() ? await files.listCards() : [];
    const found = (await files.backupViews(this.store().read().workspace.id, cards)).backups.find(view => view.file === name);
    check(found, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    return found;
  }
  /** Writes one managed backup (ciphertext only) and, for automatic and safety copies, applies the rotation. */
  private async writeBackup(kind: BackupKind): Promise<BackupView> {
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id, revision = vault.read().revision;
    const folder = await safeDirectory(files.backups, true);
    let at = this.custodyNow(), name = backupName(workspaceId, at, kind);
    for (const taken = new Set((await readdir(folder)).map(item => item.toLowerCase())); taken.has(name.toLowerCase()); name = backupName(workspaceId, ++at, kind));
    await vault.backup(join(folder, name));
    this.#schedule = { lastAt: at, lastRevision: revision, due: false, lastError: null };
    if (kind !== 'manual') {
      const { remove } = keepBackups(await files.backupFiles(workspaceId), this.custodyNow());
      for (const old of remove) await files.removeBackup(old).catch(() => {});
    }
    return this.backupView(name);
  }
  /** A safety copy before a lock change. Best effort, except with no recovery code yet: then it is the only way back
   * if the change is cut short, so the change is refused (SAFETY_BACKUP_FAILED) and nothing changes. */
  private async safetyBackup(required = false): Promise<BackupView | null> {
    try { return await this.writeBackup('safety'); }
    catch (error) {
      this.#schedule.lastError = (error as Error).message.slice(0, 300);
      if (required) throw new ChausarError('SAFETY_BACKUP_FAILED', CUSTODY_WORDS.lock.safetyBackupFailed);
      return null;
    }
  }
  /** Puts a lock change that failed partway back the way it was, with the secret the vault opened with before.
   * When even that fails, the card keeps its marker and the next open tries both ways in. Never throws. */
  private async undoLockChange(card: VaultCard, secret: string | null, made: DeviceKeyRecord | null) {
    const custody = this.custodyHost(), vault = this.vault; if (!custody || !vault || !secret) return;
    try {
      await vault.rewrapPassphrase(secret);
      await custody.files.writeCard({ ...card, pending: null, wrappersDigest: vault.wrappersDigest });
    } catch { return; }
    this.#openUnlock = card.unlock;
    if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); }
    // The undo made a new wrapper (a new salt), so bring the backups to it again.
    await this.resealManaged().catch(() => {});
  }
  /** At a tick: an automatic backup when one is due (KEYCHAIN-SPEC 4.1). Never throws. */
  private async backupTick() {
    const custody = this.custodyHost();
    if (!custody?.autoBackups || this.#closing || this.#transition || !this.vault) return;
    this.#activeRequests++;
    try {
      await this.custodySerial(async () => {
        if (!this.vault || !backupDue(this.#schedule, this.vault.read().revision, custody.clock())) return;
        try { await this.writeBackup('auto'); }
        catch (error) { this.#schedule.lastError = (error as Error).message.slice(0, 300); }
      });
    } finally { this.#activeRequests--; this.notifyIdle(); }
  }
  /** Closing: back up first when the business changed since its last backup. Best effort, never blocks closing. */
  private async closingBackup() {
    const custody = this.custodyHost();
    if (!custody?.autoBackups || !this.vault || this.#schedule.lastRevision === this.vault.read().revision) return;
    await this.custodySerial(async () => {
      try { if (this.vault) await this.writeBackup('auto'); }
      catch (error) { this.#schedule.lastError = (error as Error).message.slice(0, 300); }
    }).catch(() => {});
  }
  private async custodyView(): Promise<CustodyView> {
    const custody = this.custodyHost();
    const probe: ProbeResult = custody ? await custody.keys.probe() : { available: false, reason: 'not-configured' };
    const computer = computerView(custody?.keys.scheme ?? null, probe, probe.available);
    if (!this.vault) return { computer, business: null };
    const vault = this.vault, files = this.custodyFiles(), card = custody && this.#openFolder ? await files.readCard(this.#openFolder) : null;
    const backups = await files.backupFiles(vault.read().workspace.id), next = custody?.autoBackups ? nextBackupAt(this.#schedule, vault.read().revision, this.custodyNow()) : null;
    return { computer, business: { folder: this.#openFolder ?? '', unlock: this.#openUnlock ?? 'passphrase', recovery: card?.recovery ?? 'unknown', storage: vault.storageKind,
      backups: { auto: !!custody?.autoBackups, count: backups.length, newestAt: backups[0] ? new Date(backups[0].at).toISOString() : null,
        nextDueAt: next === null ? null : new Date(next).toISOString(), lastError: this.#schedule.lastError } } };
  }
  private async backupList() {
    const files = this.custodyFiles(), cards = await files.listCards();
    return files.backupViews(this.vault ? this.vault.read().workspace.id : null, cards);
  }
  private async passphraseOn(payload: any) {
    const vault = this.store(), card = await this.currentCard();
    check(card.unlock === 'this-computer', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const files = this.custodyFiles();
    await this.safetyBackup(card.recovery !== 'made');
    // The secret it opens with now, to put things back if a step below fails.
    const before = await this.existingComputerSecret(vault.vaultId);
    // The marker goes on the card before the rewrap, so a crash after it still finds the way in (workspace.open).
    await files.writeCard({ ...card, pending: 'to-passphrase' });
    let recoveryCode: string | null = null, next: VaultCard;
    try {
      await vault.rewrapPassphrase(payload.passphrase);
      // A passphrase can be forgotten and nobody can reset it, so the owner always leaves holding a recovery code.
      recoveryCode = card.recovery === 'made' ? null : await vault.rewrapRecovery();
      next = { ...card, unlock: 'passphrase', recovery: 'made', pending: 'forget', wrappersDigest: vault.wrappersDigest };
      await files.writeCard(next);
    } catch (error) {
      // Even a failed rewrap may have reached the disk, so commit the old secret again either way.
      await this.undoLockChange(card, before, null);
      throw error;
    }
    this.#openUnlock = 'passphrase';
    await this.snapshotStore()?.remove(card.folder); // its summary goes at once: a passphrase business keeps none (4J6)
    await this.resealManaged();
    await this.forgetKeyIfUnused(vault.vaultId, card.folder);
    await files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-on', { recoveryMade: recoveryCode !== null }));
    return { custody: await this.custodyView(), recoveryCode };
  }
  private async passphraseOff(payload: any) {
    const custody = this.custodyHost()!, vault = this.store(), card = await this.currentCard();
    check(card.unlock === 'passphrase', 'CUSTODY_UNCHANGED', CUSTODY_WORDS.errors.CUSTODY_UNCHANGED);
    // Other devices pull with the passphrase; a secret only this computer holds would shut them out of new revisions.
    check(!(this.services.sync?.status(this.context).enabled), 'SYNC_NEEDS_PASSPHRASE', CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
    check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    let secret = await this.existingComputerSecret(vault.vaultId), made: DeviceKeyRecord | null = null;
    if (!secret) {
      const bytes = randomBytes(32);
      try { made = await custody.keys.protect(vault.vaultId, bytes); await custody.files.writeKey(made); secret = bytes.toString('base64url'); }
      catch (error) { if (made) await custody.keys.forget(made).catch(() => {}); throw error instanceof ChausarError && error.code === 'DEVICE_KEY_FAILED' ? error : deviceKeyFailed(); }
      finally { bytes.fill(0); }
    }
    try { await this.safetyBackup(card.recovery !== 'made'); }
    catch (error) { if (made) { await custody.keys.forget(made).catch(() => {}); await custody.files.removeKey(made.vaultId).catch(() => {}); } throw error; }
    // The marker goes on the card before the rewrap; the key record stays until the change is settled either way.
    await custody.files.writeCard({ ...card, pending: 'to-this-computer' });
    let next: VaultCard;
    try {
      await vault.rewrapPassphrase(secret);
      next = { ...card, unlock: 'this-computer', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
      await custody.files.writeCard(next);
    } catch (error) {
      // The typed passphrase was just checked, so it puts the vault back; then the new key record goes.
      await this.undoLockChange(card, payload.passphrase, made);
      throw error;
    }
    this.#openUnlock = 'this-computer';
    await this.resealManaged();
    await custody.files.writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.passphrase-off', {}));
    return { custody: await this.custodyView() };
  }
  private async makeRecoveryCode(payload: any) {
    const vault = this.store(), card = await this.currentCard();
    if (card.unlock === 'passphrase') check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const recoveryCode = await vault.rewrapRecovery();
    const next: VaultCard = { ...card, recovery: 'made', pending: 'reseal', wrappersDigest: vault.wrappersDigest };
    await this.custodyFiles().writeCard(next);
    await this.resealManaged();
    await this.custodyFiles().writeCard({ ...next, pending: null });
    await vault.update(state => audit(state, 'custody.recovery-made', {}));
    return { custody: await this.custodyView(), recoveryCode };
  }
  private async restoreManagedBackup(payload: any) {
    check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the restore in the app.');
    const vault = this.store(), files = this.custodyFiles(), workspaceId = vault.read().workspace.id;
    const parsed = typeof payload.file === 'string' ? parseBackupName(payload.file) : null;
    check(parsed, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(parsed.workspaceId === workspaceId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const header = await files.backupHeader(parsed.name);
    check(header, 'BACKUP_NOT_FOUND', CUSTODY_WORDS.errors.BACKUP_NOT_FOUND);
    check(header.vaultId === vault.vaultId, 'BACKUP_OTHER_BUSINESS', CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
    const restoredFrom = await this.backupView(parsed.name);
    // The safety copy is required here: the business's current state is about to be replaced.
    const safety = await this.writeBackup('safety');
    await vault.replaceFromBackup(files.backupPath(parsed.name));
    await this.attachSafely(vault);
    await vault.update(state => audit(state, 'backup.restored', { file: parsed.name, revision: header.revision }));
    return { workspace: this.store().read().workspace, restoredFrom, safety };
  }
  private async transferExport(payload: any) {
    const vault = this.store(), card = this.custodyHost() && this.#openFolder ? await this.custodyFiles().readCard(this.#openFolder) : null;
    if ((card?.unlock ?? this.#openUnlock ?? 'passphrase') === 'passphrase')
      check(typeof payload.passphrase === 'string' && await vault.verifyPassphrase(payload.passphrase), 'PASSPHRASE_WRONG', CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
    const transferCode = makeTransferCode(), madeAt = new Date(this.custodyNow()).toISOString();
    const text = await vault.transferText(transferCode, { recovery: (card ? card.recovery === 'made' : true) ? 'made' : 'not-made', madeAt });
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    await vault.update(state => audit(state, 'custody.transfer-exported', {}));
    return { fileName: `chausar-move-${madeAt.slice(0, 10)}.backup`, text, transferCode, bytes: Buffer.byteLength(text) };
  }
  private async transferImport(payload: any) {
    check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.');
    this.#draft?.clear();
    const text = payload.fileText;
    check(typeof text === 'string', 'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    check(text.length <= TRANSFER.maxTextChars, 'TRANSFER_TOO_LARGE', CUSTODY_WORDS.errors.TRANSFER_TOO_LARGE);
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const envelope = parsed?.envelope;
    check(parsed?.backupFormat === 'chausar.backup.v1' && envelope?.format === 'chausar.vault.v1' && typeof envelope.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(envelope.id)
      && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0 && [envelope.passphrase, envelope.recovery, envelope.snapshot].every(part => part && typeof part === 'object'),
      'TRANSFER_INVALID', CUSTODY_WORDS.errors.TRANSFER_INVALID);
    const files = this.custodyFiles();
    check(!(await files.vaultIds()).has(envelope.id), 'TRANSFER_SAME_BUSINESS', CUSTODY_WORDS.errors.TRANSFER_SAME_BUSINESS);
    const code = normalizeTransferCode(payload.transferCode);
    check(code, 'TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
    const custody = this.custodyHost(), computer = payload.passphrase === undefined || payload.passphrase === null;
    if (computer) {
      if (!custody) throw deviceKeysUnavailable('not-configured');
      const probe = await custody.keys.probe(); if (!probe.available) throw deviceKeysUnavailable(probe.reason);
    } else check(typeof payload.passphrase === 'string' && payload.passphrase.length >= 12 && payload.passphrase.length <= 1024, 'WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const folder = nextFolder(`moved-${randomBytes(3).toString('hex')}`, await files.takenFolders());
    const path = await files.transferFile(text);
    try {
      let vault: Vault;
      try { vault = await Vault.restore({ directory: this.workspacePath(folder), backupFile: path, passphrase: code, storage: await this.adapter(folder), writerGuard: this.writerGuard() }); }
      catch (error) { if ((error as ChausarError).code === 'UNLOCK_FAILED') throw new ChausarError('TRANSFER_CODE_WRONG', CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG); throw error; }
      let record: DeviceKeyRecord | null = null;
      const secret = computer ? randomBytes(32) : null;
      try {
        if (secret) { record = await custody!.keys.protect(vault.vaultId, secret); await files.writeKey(record); await vault.rewrapPassphrase(secret.toString('base64url')); }
        else await vault.rewrapPassphrase(payload.passphrase);
        // The card goes down before attaching, so if attaching fails the list still shows the right way in.
        const state = vault.read();
        await files.writeCard(newCard({ folder, vaultId: vault.vaultId, workspaceId: state.workspace.id, name: state.workspace.name, demo: state.workspace.demo,
          unlock: computer ? 'this-computer' : 'passphrase', recovery: transferHint(parsed), wrappersDigest: vault.wrappersDigest }));
      } catch (error) {
        await files.removeCard(folder).catch(() => {});
        await vault.delete().catch(() => {});
        if (record) { await custody!.keys.forget(record).catch(() => {}); await files.removeKey(record.vaultId).catch(() => {}); }
        throw error instanceof ChausarError ? error : deviceKeyFailed();
      } finally { secret?.fill(0); }
      await this.attachSafely(vault);
    } finally { await files.removeTransfer(path).catch(() => {}); }
    await this.afterOpen(folder, computer ? 'this-computer' : 'typed', { recovery: transferHint(parsed) });
    return { workspace: this.store().read().workspace, folder, unlock: computer ? 'this-computer' : 'passphrase' };
  }
  private async forgetBusiness(folder: string | null, vaultId: string) {
    const custody = this.custodyHost(); if (!custody || !folder) return;
    await custody.files.removeCard(folder);
    await this.snapshotStore()?.remove(folder); // its summary goes with it (4J6)
    if (!(await custody.files.listCards()).some(card => card.vaultId === vaultId)) {
      const record = await custody.files.readKey(vaultId);
      if (record) { await custody.keys.forget(record).catch(() => {}); await custody.files.removeKey(vaultId); }
    }
  }
  private requireWorkspaceOwner(ctx: Context) { const member = authorize(this.store(), ctx, 'admin'); check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only an unrestricted workspace owner can copy or delete the entire vault.'); }
  private jobRunner() { check(this.services.jobRunner, 'JOB_POLICY_REQUIRED', 'Configure explicit worker, active-job and lease policy before creating typed goals.'); return this.services.jobRunner; }
  private createBriefJob(ctx: Context, payload: any) {
    check(payload.plan === undefined, 'INVALID_JOB_PLAN', 'The installed runner creates its own plan.');
    // Legacy omitted scope means the owner's currently readable sources, captured
    // in the mandate at creation. Explicit [] stays empty; later sources need a new mandate.
    if (payload.sourceIds === undefined) {
      const state = this.store().read(), snapshot: StateStore = { read: () => state, update: async () => { throw new Error('Brief admission is read-only.'); } };
      const member = state.members.find(item => item.id === (payload.ownerId ?? ctx.memberId));
      const ownerContext: Context = member ? { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' } : ctx;
      const selection = new MemoryService(snapshot).query(ownerContext);
      const ids = new Set([...selection.facts.map(fact => fact.id), ...selection.excluded.map(item => item.rowId),
        ...selection.conflicts.flatMap(item => item.rowIds)]);
      payload = { ...payload, sourceIds: [...new Set(state.facts.filter(fact => ids.has(fact.id)).map(fact => fact.sourceId))].sort() };
    }
    if (!this.options.durableJobs) return this.services.jobs.create(ctx, payload);
    const store = this.store(); const limit = this.options.durableJobs.maxActiveJobs;
    const capped = new JobService({ read: () => store.read(), update: change => store.update(state => {
      check(state.jobs.filter((job: Job) => !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) || job.execution?.attempts.some(attempt => ['dispatched', 'unknown'].includes(attempt.status))).length < limit, 'ACTIVE_JOB_LIMIT', 'The configured active job ceiling is reached.');
      return change(state);
    }) }, { clock: this.services.jobs.clock, deliverableGuard: this.services.jobs.deliverableGuard });
    return capped.create(ctx, payload);
  }
  private typedJob(id: string): boolean { return !!this.services.jobs.find(this.store().read(), id).plan; }
  /** Trusted process-host hook, deliberately absent from renderer/member RPCs. */
  updateJobLifecycle(host: JobLifecycle) {
    check(host && ['awake', 'windowOpen', 'backgroundEnabled'].every(key => typeof (host as any)[key] === 'boolean') && Object.keys(host).length === 3, 'INVALID_JOB_LIFECYCLE', 'Report explicit host awake, window and background state.');
    this.#jobLifecycle = { ...host };
  }
  async tick() {
    // Automatic backups run before the autonomy check: they don't depend on scheduled jobs. So do the journal sweep and
    // the notification centre's look at Today.
    await this.backupTick();
    await this.journalTick();
    await this.notifyTick();
    await this.snapshotTick();
    const host = { ...this.#jobLifecycle };
    if (this.#closing || this.#transition || !this.vault || !this.vault.read().policy.autonomy || !host.awake || (!host.windowOpen && !host.backgroundEnabled)) return [];
    this.#activeRequests++;
    try {
    const due = this.vault.read().jobs.filter((job: Job) => !job.plan && (host.windowOpen || job.background === true) && ((['scheduled', 'approval-blocked'].includes(job.status) && Date.parse(job.nextRunAt) <= this.services.jobs.clock()) || (job.status === 'running' && job.lease && Date.parse(job.lease.expiresAt) <= this.services.jobs.clock())));
    const results = [];
    for (const job of due) { try { results.push(await this.runJob(job.id)); } catch (error) { results.push({ id: job.id, error: (error as Error).message }); } }
    if (this.services.jobRunner) for (const member of this.vault.read().members.filter(member => member.active && ['owner', 'cofounder'].includes(member.role))) {
      const ownerContext: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
      try {
        const ran: Job[] = await this.services.jobRunner.tick(ownerContext, host);
        // A multi-owner scheduler releases receipts only to their pinned owner.
        for (const job of ran) results.push(this.context.memberId === job.ownerId && this.context.epoch === job.ownerEpoch && this.context.role === job.ownerRole ? this.services.jobs.view(this.context, this.services.jobs.find(this.vault.read(), job.id)) : { id: job.id, status: job.status });
      } catch (error) { results.push({ error: { code: (error as any).code ?? 'JOB_SCHEDULER_FAILED' } }); }
    }
    return results;
    } finally { this.#activeRequests--; this.notifyIdle(); }
  }
}
