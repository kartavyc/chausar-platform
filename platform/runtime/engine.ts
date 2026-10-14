import { resolve, join, relative, isAbsolute } from 'node:path';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Vault, safeDirectory, type KeychainHook, type VaultKeychainProvider, type VaultWriterGuard, type EncryptedSnapshotAdapter, type VaultDeletionCleanup } from './vault.ts';
import { captureInvoiceCustody, prepareInvoiceRestoredState, type InvoiceCustodyArtifact } from './vault-invoice-custody.ts';
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
import { SpeechService } from './speech.ts';
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
import { InvoiceFollowUpHost, invoiceJobType, invoiceConnectorId, type InvoiceHostOptions } from './invoice-follow-up.ts';
import { createEngineJobRunner, type EngineJobOptions, type JobLifecycle } from './engine-jobs.ts';
import type { Job } from './jobs.ts';
import type { CalendarRules } from './calendar-zone.ts';
import type { CalendarBounds } from './calendar.ts';
import { PluginService } from './plugins.ts';
import { LearningService } from './learning.ts';
import { MCPService } from './mcp.ts';
import { ConnectorService, type CredentialBroker } from './connectors.ts';
import { EngineConnectorService, connectorDiscoveryGeneration, type EngineConnectorOptions } from './engine-connectors.ts';
import { PrivateTrialHostService } from './private-trial-host.ts';
import { EngineScenarioService } from './engine-scenarios.ts';
import { createEngineLessonService, type EngineLessonOptions } from './engine-lessons.ts';
import { EngineTodayService } from './engine-today.ts';
import type { TodayAttentionSelectionPolicy } from './engine-today-contracts.ts';
import { TodayTilesService } from './today-tiles.ts';
import { TodayAttentionService, type TodayAttentionOptions } from './today-attention.ts';
import { TodayEventsService } from './today-events.ts';
import { TodayReviewService } from './today-review.ts';
import type { LessonDecision } from './lesson-contracts.ts';
import type { PrivateTrialAtomicPublication } from './private-trial-host.ts';
import type { PrivateTrialRecipeEvidence } from './private-trial-contracts.ts';
import { producerReplacementPins, producerReplacementOutputDigest, publishProducerReplacement } from './producer-replacement.ts';
import { WorkspaceInterchangeHost } from './workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from './workspace-interchange-local.ts';
import { WorkspaceBackupV2Host, type WorkspaceBackupV2Budgets, type WorkspaceBackupV2ExternalKeyRequirement } from './workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts, type WorkspaceBackupV2FilesystemBudgets } from './workspace-backup-local.ts';
import { EngineWorkspaceActivation, type EngineWorkspaceActivationOptions } from './workspace-activation-engine.ts';
import { EnginePostgresWorkspaceActivation } from './workspace-postgres-engine.ts';
import type { EnginePostgresWorkspaceOptions, PostgresWorkspaceOpenAdmission, PostgresWorkspaceStorageOperation, TrustedWorkspaceLaunch } from './workspace-postgres-contracts.ts';
import { readWorkbook, workbookSheetToCSV } from './workbook.ts';
import { DatabaseCalculator, type DatabaseCalculatorOptions } from './analytics.ts';
import { AnalyticalHelper } from './helper.ts';
import { ReleaseUpdater, compareVersions } from './updater.ts';
import { authorize, audit, check, ChausarError, hash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import { engineModules, moduleMethods } from './modules/registry.ts';
import type { ModuleHost } from './modules/types.ts';
import { registerPrivateStatePurgeHook } from './private-state-lifecycle.ts';

// Engine modules register their namespace purge once, at load.
for (const engineModule of engineModules) if (engineModule.purge) registerPrivateStatePurgeHook(engineModule.purge.bind(engineModule));

export type EngineBackupCustodyOptions = {
  budgets?: WorkspaceBackupV2Budgets; filesystemBudgets?: WorkspaceBackupV2FilesystemBudgets;
  externalKeyRequirements?: WorkspaceBackupV2ExternalKeyRequirement[];
  /** Trusted installed host capability, never supplied by an RPC payload. */
  withCompleteOwner?<T>(context: Context, historical: State, work: (assertCurrent: () => void) => Promise<T>): Promise<T>;
};
/** Installed display and live read authority. RPCs cannot install these ports
 * or select implicit tile presets, business zones, or attention ordering. */
export type EngineTodayHostOptions = {
  calendarRules?: CalendarRules;
  calendar?: TodayAttentionOptions['calendar'];
  selection?: TodayAttentionSelectionPolicy;
  /** Advance for every outside-State report, job, lesson or calendar guard change. */
  authorityRevision?: () => string;
};
export type EngineOptions = { directory: string; version?: string; demo?: boolean; storage?: 'experimental-file' | 'postgres'; postgresUrl?: string; connectorCredentials?: CredentialBroker; connectorRuntime?: EngineConnectorOptions; analytics?: DatabaseCalculatorOptions; sync?: SyncOptions & { writerAdmission?: SyncWriterAdmission }; pythonExecutable?: string; updatePublicKey?: string; durableJobs?: EngineJobOptions; gateway?: GatewayOptions; synthesis?: ConversationSynthesisCodec; reports?: Pick<ReportOptions, 'executionReceipt'>; jobCalendar?: { rules: CalendarRules; bounds: CalendarBounds }; bridge?: Pick<BridgeServiceOptions, 'factorAdmission'>; research?: { search?: ResearchSearchPort }; backupCustody?: EngineBackupCustodyOptions;
  today?: EngineTodayHostOptions;
  /** Trusted per-module host options, keyed by engine module id (platform/runtime/modules). */
  modules?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Trusted host custody for direct Vault lifecycles, never an RPC or archive.
   * No native platform provider is installed or qualified by this contract. */
  keychain?: KeychainHook;
  /** Trusted local composition capabilities. Never supplied by an RPC or archive. */
  workspaceActivation?: EngineWorkspaceActivationOptions;
  /** Trusted native transfer composition. Never installed from RPC or an archive. */
  postgresWorkspace?: EnginePostgresWorkspaceOptions;
  /** Trusted committed-target adapter admission, held through Vault open/attach. */
  workspaceStorageAdmission?: PostgresWorkspaceOpenAdmission;
  workspaceAuthority?: {workspaceId: string; ownerId: string; vaultId?: string};
  /** Explicit synthetic policy supplied by a trusted host, never an RPC or product default. */
  invoiceFollowUp?: InvoiceHostOptions;
  /** Explicit current evidence, personal target and evaluation authorities. Never an RPC payload. */
  lessons?: EngineLessonOptions;
  /** Trusted enterprise-server host only. With `postgresTls`, the Vault database may be on another host over verified TLS. */
  storageMode?: 'enterprise-server';
  postgresTls?: { ca: string; servername?: string };
};
// Operational admission ceilings reject the complete operation; no namespace is truncated.
const defaultBackupBudgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 32 * 1024 * 1024,
  maxEntryBytes: 16 * 1024 * 1024, maxTotalEntryBytes: 16 * 1024 * 1024, maxEntries: 4096, maxJsonDepth: 128, maxJsonNodes: 200_000 };
const defaultBackupFilesystemBudgets: WorkspaceBackupV2FilesystemBudgets = { maxFiles: 8192, maxBytes: 128 * 1024 * 1024, maxDepth: 16 };

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
export class Engine {
  // Host dispatch isolation follows the trusted launch mode across every Vault attach.
  readonly #demo: boolean;
  // Trusted current custody survives a lock within this Engine only. An old
  // archive cannot establish later invoice history after a process restart.
  #lastInvoiceCustody?: InvoiceCustodyArtifact;
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
  #searchAdapter: Promise<PostgresInvestigationSearch> | null = null;
  #unknownAnswerRecoveries = new Set<string>();
  #answerRecoveryExecutions = new Map<string, Promise<void>>();
  // Unknown host state is closed to scheduled dispatch. Only a trusted host sets it.
  #jobLifecycle: JobLifecycle = { awake: false, windowOpen: false, backgroundEnabled: false };
  get context(): Context { return this.#requestContext.getStore() || this.#baseContext; }
  set context(value: Context) { this.#baseContext = { ...value }; }
  services: Record<string, any> = {};
  constructor(options: EngineOptions) {
    this.#demo = options.demo === true;
    check(!options.invoiceFollowUp || options.demo === true, 'INVOICE_SIMULATION_ONLY', 'Install invoice follow-up only in the explicitly experimental synthetic host.');
    this.version = options.version ?? '0.1.0-preview.1'; compareVersions(this.version, this.version); this.options = { ...options, directory: resolve(options.directory) };
  }
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
    const selected: TrustedWorkspaceLaunch = await this.activationHost().inspectOpenTarget(context, activationId);
    if (selected.backend === 'postgres') return new Engine({ directory: selected.directory, version: this.version,
      storage: 'postgres', workspaceStorageAdmission: selected.withWorkspaceAdmission,
      workspaceAuthority: { workspaceId: selected.workspaceId, ownerId: selected.ownerId, vaultId: selected.vaultId } });
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
    if (this.options.storage === 'experimental-file' && this.options.demo) return 'experimental-file' as const;
    check(this.options.storage === 'postgres' && this.options.postgresUrl, 'DATABASE_REQUIRED', 'Production requires configured PostgreSQL. File storage is available only in the explicitly experimental demo.');
    const url = new URL(this.options.postgresUrl);
    check(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
    return PostgresSnapshotAdapter.connect({ host: url.hostname.replace(/^\[|\]$/g, '') as '127.0.0.1' | '::1', port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), vaultSlot: hash(this.workspacePath(folder)), ...(this.options.storageMode === 'enterprise-server' && this.options.postgresTls ? { remoteTls: this.options.postgresTls } : {}) });
  }
  private async withWorkspaceStorage<T>(folder: string, operation: PostgresWorkspaceStorageOperation,
    work: (adapter: 'experimental-file' | EncryptedSnapshotAdapter) => Promise<T>): Promise<T> {
    const profile = this.options.postgresWorkspace;
    const admission = this.options.workspaceStorageAdmission ?? profile?.withWorkspaceAdmission;
    if (!admission) {
      const adapter = await this.adapter(folder);
      if (adapter !== 'experimental-file') {
        // Ordinary PostgreSQL admission precedes credentials and backup intake.
        // In particular, a prepared target cannot reach Vault.restore's file
        // decryption or have its native refusal hidden by unlock cleanup.
        try { await adapter.load(); }
        catch (error) { await adapter.close?.(); throw error; }
      }
      return work(adapter);
    }
    check(this.options.storage === 'postgres' && (!profile || profile.format === 'chausar.postgres-workspace-profile.v1'),
      'POSTGRES_WORKSPACE_ROOT_REQUIRED', 'Native storage admission requires its explicit trusted PostgreSQL profile.');
    let calls = 0;
    const originalVault = this.vault;
    let result: T;
    try { result = await admission({ directory: this.workspacePath(folder), operation, expectedAuthority: this.options.workspaceAuthority }, async adapter => {
      check(++calls === 1 && adapter?.kind === 'postgres', 'POSTGRES_WORKSPACE_ADMISSION', 'Transfer one admitted native adapter into the actual Vault operation.');
      const value = await work(adapter);
      check(this.options.postgresWorkspace === profile && (this.options.workspaceStorageAdmission ?? profile?.withWorkspaceAdmission) === admission,
        'POSTGRES_WORKSPACE_CONFIGURATION_CHANGED', 'Installed storage admission changed during open/attach.');
      return value;
    });
      check(calls === 1, 'POSTGRES_WORKSPACE_ADMISSION', 'Installed storage admission did not execute the actual Vault operation.');
    } catch (error) {
      // A failed final guard/lease exit cannot leave an attached Engine after a
      // rejected open. Retain durable authority; this is resource closure only.
      if (this.vault && this.vault !== originalVault) await this.closeVault();
      throw error;
    }
    return result;
  }
  private workspacePath(name = 'main') {
    check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name), 'INVALID_PATH', 'Use a short workspace folder name without path separators.');
    const path = resolve(this.options.directory, name); const rel = relative(this.options.directory, path);
    check(!rel.startsWith('..') && !isAbsolute(rel), 'INVALID_PATH', 'Workspace path is outside the vault folder.'); return path;
  }
  private async attach(vault: Vault) {
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
    if (this.options.invoiceFollowUp) this.services.invoiceFollowUp = new InvoiceFollowUpHost(store, this.options.invoiceFollowUp, calculationOptions);
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
    this.services.scenarios = new EngineScenarioService(vault, { calculatorOptions: view => {
      const connectors = connectorForView(view);
      return { ...(database ? { verifier: (receipt: CalculationReceipt) => database.verify(receipt) } : {}),
        consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
        receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt) };
    }, discoveryAuthorityRevision: state => {
      const options = this.options.connectorRuntime;
      // Bracket factories too: a profile/semantic factory can change host-owned
      // readiness before the constructed connector's own stamp is available.
      const generation = connectorDiscoveryGeneration(options);
      const namespace = state.scenarioRecords ?? [];
      check(Array.isArray(namespace) && namespace.every(record => Array.isArray(record?.evidence)
        && record.evidence.every(evidence => evidence?.state && Array.isArray(evidence.state.sourceRules))),
      'SCENARIO_CUSTODY_INVALID', 'Discovery requires complete retained connector authority views.');
      const stamps = [state, ...namespace.flatMap(record => record.evidence.map(evidence => evidence.state))].map(retained => {
        const authority = { ...structuredClone(retained), members: structuredClone(state.members), policy: structuredClone(state.policy),
          sourceRules: [...structuredClone(retained.sourceRules.filter(rule => typeof rule.sourceId !== 'string')),
            ...structuredClone(state.sourceRules.filter(rule => typeof rule.sourceId === 'string'))] };
        delete authority.scenarioRecords; delete authority.lessonState;
        const readonly: StateStore = { read: () => structuredClone(authority), update: async () => {
          throw new ChausarError('SCENARIO_READ_ONLY', 'Discovery connector authority is read only.');
        } };
        return new EngineConnectorService(readonly, options).discoveryReadinessRevision();
      });
      check(connectorDiscoveryGeneration(options) === generation, 'SCENARIO_AUTHORITY_CHANGED',
        'Connector discovery readiness changed while retained authority was resolved.');
      return digest({ generation, stamps });
    }, now });
    if (this.options.lessons) this.services.lessons = createEngineLessonService(store, this.options.lessons);
    else delete this.services.lessons;
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
    let backupLocal: ReturnType<typeof createWorkspaceBackupV2LocalPorts> | undefined;
    let installedActivation: EngineWorkspaceActivation | undefined;
    if (vault.storageKind === 'experimental-file') {
      const backup = this.options.backupCustody;
      const budgets = backup?.budgets ?? defaultBackupBudgets;
      backupLocal = createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
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
    }
    const interchangeLocal = createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory,
      backupControlCustody: backupLocal,
      assertCompleteOwner: async (ctx, historical) => this.interchangeOwner(ctx, historical) });
    this.services.interchangeLocal = interchangeLocal;
    this.services.interchange = new WorkspaceInterchangeHost(interchangeLocal.ports);
    const activation = this.options.workspaceActivation;
    if (backupLocal && activation) {
        const budgets = this.options.backupCustody?.budgets ?? defaultBackupBudgets;
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
    const postgresProfile = this.options.postgresWorkspace;
    if (vault.storageKind === 'postgres' && postgresProfile) {
      check(this.options.workspaceActivation === undefined && this.options.sync === undefined
        && !vault.read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
      'ACTIVATION_SOURCE_PROFILE', 'The explicit synthetic PostgreSQL transfer profile requires its own custody; managed connector/sync activation stays separately gated.');
      const budgets = this.options.backupCustody?.budgets ?? defaultBackupBudgets;
      const assertConfiguration = () => {
        check(this.options.postgresWorkspace === postgresProfile && this.options.sync === undefined,
          'POSTGRES_WORKSPACE_CONFIGURATION_CHANGED', 'Installed native transfer admission changed during custody.');
      };
      const installed = await EnginePostgresWorkspaceActivation.install(postgresProfile, {
        sourceVault: vault, journalVault: postgresProfile.journalVault, applicationDirectory,
        interchange: interchangeLocal, backupBudgets: budgets,
        backupPolicy: { approvedSyntheticWorkspaceIds: [...postgresProfile.policy.approvedSyntheticWorkspaceIds], backupBudgets: budgets,
          maxMaterialUtf8Bytes: postgresProfile.policy.budgets.maxCandidateBytes, maxCandidateUtf8Bytes: postgresProfile.policy.budgets.maxCandidateBytes },
        policy: postgresProfile.policy, targetPassphrase: authority => postgresProfile.targetPassphrase(authority),
        bootstrap: options => Vault.createBootstrap(options), openVault: options => Vault.open(options),
        assertCompleteOwner: async (ctx, historical) => {
          assertConfiguration(); this.backupCompleteOwner(ctx, historical);
          check(!vault.read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
            'ACTIVATION_SOURCE_PROFILE', 'Managed imports require their separately qualified activation profile.');
        },
      }, assertConfiguration);
      this.services.backupLocal = installed.backup;
      this.services.backupV2 = new WorkspaceBackupV2Host(installed.backup.ports, budgets);
      this.services.workspaceActivation = installed;
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
    this.services.gateway = new ModelGateway(store, { ...this.options.gateway, demo: this.#demo, businessContext: businessContextHooks,
      conversationContinuation: (ctx, id, view, resolvedBy) => this.conversationContinuation(ctx, id, view, resolvedBy),
      conversationSynthesis: (ctx, id, view) => this.services.synthesisHost.resolve(ctx, id, view),
      synthesisCodec: this.options.synthesis ?? this.options.gateway?.synthesisCodec ?? installedConversationSynthesisCodec });
    this.services.speech = new SpeechService(store);
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
    const todayHost = this.options.today, installedReports = this.options.reports,
      installedJobs = this.options.durableJobs, installedLessons = this.options.lessons,
      installedConnectors = this.options.connectorRuntime, installedCalendar = this.options.jobCalendar;
    const rules = todayHost?.calendarRules ?? installedCalendar?.rules;
    const externalRevision = todayHost?.authorityRevision, calendar = todayHost?.calendar,
      selection = todayHost?.selection;
    const selectionRevision = selection?.revision, selectAttention = selection?.select, selectionId = selection?.id;
    const assertTodayConfiguration = () => {
      check(this.options.today === todayHost && this.options.reports === installedReports
        && this.options.durableJobs === installedJobs && this.options.lessons === installedLessons
        && this.options.connectorRuntime === installedConnectors && this.options.jobCalendar === installedCalendar
        && todayHost?.authorityRevision === externalRevision && todayHost?.calendar === calendar
        && todayHost?.selection === selection && selection?.revision === selectionRevision
        && selection?.select === selectAttention && selection?.id === selectionId
        && (todayHost?.calendarRules ?? installedCalendar?.rules) === rules,
      'TODAY_AUTHORITY_CHANGED', 'Installed Today authorities changed. Reopen the workspace before reading again.');
    };
    const readTodayHostRevision = () => {
      check(!(installedReports?.executionReceipt || installedJobs || installedLessons || calendar || selection) || typeof externalRevision === 'function',
        'TODAY_HOST_AUTHORITY_REQUIRED', 'Install a live Today generation for outside-workspace read guards.');
      const revision: unknown = externalRevision?.();
      if (revision instanceof Promise) void revision.catch(() => {});
      check(!externalRevision || typeof revision === 'string' && revision.trim() === revision && revision.length >= 1
        && revision.length <= 200 && !/[\u0000-\u001f]/.test(revision),
      'TODAY_HOST_AUTHORITY_REQUIRED', 'Supply a bounded synchronous live Today generation.');
      return revision ?? null;
    };
    const readTodaySelectionRevision = () => {
      const revision: unknown = selectionRevision?.call(selection);
      if (revision instanceof Promise) void revision.catch(() => {});
      check(!selection || typeof revision === 'string' && revision.trim() === revision && revision.length >= 1
        && revision.length <= 4096 && !/[\u0000-\u001f]/.test(revision),
      'TODAY_HOST_AUTHORITY_REQUIRED', 'Supply the current synchronous installed attention policy generation.');
      return revision ?? null;
    };
    const todayAuthorityRevision = () => {
      assertTodayConfiguration();
      const before = readTodayHostRevision(), policyBefore = readTodaySelectionRevision(),
        connectors = connectorRuntime.discoveryReadinessRevision(), policyAfter = readTodaySelectionRevision(),
        after = readTodayHostRevision();
      assertTodayConfiguration();
      check(before === after && policyBefore === policyAfter, 'TODAY_AUTHORITY_CHANGED', 'Outside-workspace Today authority changed while current connector readiness was checked.');
      return hash({ connectors, external: after, selection: selection ? { id: selectionId, revision: policyAfter } : null,
        calendarRules: rules ? { revision: rules.revision, minYear: rules.minYear, maxYear: rules.maxYear } : null });
    };
    const currentCalculationOptions = (view: StateStore): CalculatorOptions => {
      const connectors = connectorForView(view);
      return { ...calculationOptions,
        consumerGuard: (member, request) => connectors.assertCalculationReady(member, request),
        receiptGuard: (member, receipt) => connectors.assertReceiptReady(member, receipt) };
    };
    const review = new TodayReviewService(store, { actions: this.services.actions, jobs: this.services.jobs,
      authorityRevision: todayAuthorityRevision,
      ...(installedLessons?.evaluations ? { lessons: { service: this.services.lessons,
        targets: installedLessons.targets, evaluations: installedLessons.evaluations } } : {}),
      unsupportedMutations: { actionConnectors: [invoiceConnectorId], jobTypes: [invoiceJobType] } });
    this.services.today = new EngineTodayService({ store, authorityRevision: todayAuthorityRevision,
      tiles: new TodayTilesService(this.services.calculator),
      attention: new TodayAttentionService(store, {
        alertsOptions: view => ({ calculatorOptions: currentCalculationOptions }),
        reportOptions: view => ({ ...reportOptions, ...currentCalculationOptions(view) }),
        ...(calendar ? { calendar } : {}) }),
      events: new TodayEventsService({ store, ...(rules ? { rules } : {}), services: {
        learning: this.services.learning, calculator: this.services.calculator,
        actions: this.services.actions, reports: this.services.reports, jobs: this.services.jobs } }),
      review, ...(selection ? { selection } : {}) });
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
    check(!this.#activeRequests && !this.#transition, 'VAULT_BUSY', 'Drain pending engine requests before closing its authority.');
    await this.closeVault();
  }
  private async closeVault() {
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
      this.#lastInvoiceCustody = undefined;
      // Failure to retain bounded restore custody must still clear the vault
      // key and lock. Never reuse a stale artifact after a failed capture.
      try { this.#lastInvoiceCustody = captureInvoiceCustody(this.vault.read(), this.vault.vaultId); }
      catch (error) { failure ??= error; }
      try { await this.vault.close(); this.vault = null; this.services = {}; } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
  private async deleteVault(vault: Vault, cleanup?: VaultDeletionCleanup) {
    let failure: { error: unknown } | undefined;
    try { await vault.delete(cleanup); } catch (error) { failure = { error }; }
    // Vault deletion closes its key and writer even when custody removal
    // fails. Never read that closed handle or retain deleted invoice custody.
    this.vault = null; this.#lastInvoiceCustody = undefined;
    try { await this.closeVault(); } catch (error) { failure ??= { error }; }
    finally { this.services = {}; }
    if (failure) throw failure.error;
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
    this.services.connectorRuntime?.close();
    this.services.jobRunner?.interruptActive();
    this.services.invoiceFollowUp?.runner.interruptActive();
    if (this.#activeRequests || this.#transition) await new Promise<void>((accept, reject) => {
      const finished = () => { clearTimeout(timer); this.#idleWaiters.delete(finished); accept(); };
      const timer = setTimeout(() => { this.#idleWaiters.delete(finished); reject(new Error('Engine shutdown exceeded its deadline; unfinished actions require reconciliation.')); }, timeoutMs);
      this.#idleWaiters.add(finished);
    });
    await this.closeVault();
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
    const state = vault.read();
    if (this.services.invoiceFollowUp && (state.jobs.some(job => job.type === invoiceJobType && job.status === 'running')
      || state.actions.some(action => action.connector === invoiceConnectorId && action.status === 'executing')
      || state.answers.some(item => item.kind === 'invoice-simulated-delivery-v1' && item.status === 'reserved'))) {
      await this.services.invoiceFollowUp.recover(this.context);
    }
    if (vault.read().actions.some(action => action.status === 'executing')) await this.services.actions.recoverInterrupted(this.context);
    if (this.services.jobRunner && vault.read().jobs.some(job => job.status === 'running')) await this.services.jobRunner.recoverInterrupted(this.context);
  } catch (error) { await vault.close(); this.vault = null; this.services = {}; throw error; } }
  #moduleOptions = new Map<string, Readonly<Record<string, unknown>>>();
  /** Host-supplied module options win; otherwise the module builds its own once from trusted inputs. */
  private moduleOptions(moduleId: string): Readonly<Record<string, unknown>> {
    const supplied = this.options.modules?.[moduleId];
    if (supplied) return Object.freeze({ ...supplied });
    let built = this.#moduleOptions.get(moduleId);
    if (!built) {
      const engineModule = engineModules.find(candidate => candidate.id === moduleId);
      built = Object.freeze({ ...(engineModule?.hostOptions?.({ directory: this.options.directory, demo: this.#demo, env: Object.freeze({ ...process.env }) }) ?? {}) });
      this.#moduleOptions.set(moduleId, built);
    }
    return built;
  }
  /** The narrow host handed to an engine module for one call. */
  moduleHost(moduleId: string, ctx: Context): ModuleHost {
    const engine = this;
    return Object.freeze({
      get store() { return engine.store(); },
      services: this.services, demo: this.#demo, directory: this.options.directory,
      options: this.moduleOptions(moduleId),
      // `tainted` can only add the outside-text mark to the caller's context, never remove it.
      call: (method: string, payload: Record<string, unknown>, options?: { tainted?: boolean }) =>
        engine.requestAs(options?.tainted === true ? { ...ctx, sourceTainted: true } : ctx, method, payload),
    });
  }
  async request(method: string, payload: any = {}): Promise<any> {
    check(!this.#closing, 'ENGINE_STOPPING', 'The engine is completing pending work before shutdown.');
    const transitions = new Set(['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.delete', 'sources.delete']);
    const transition = transitions.has(method);
    check(!this.#transition && (!transition || this.#activeRequests === 0), 'VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.');
    if (transition) this.#transition = true; else this.#activeRequests++;
    try { return await this.handleRequest(method, payload); }
    finally { if (transition) this.#transition = false; else this.#activeRequests--; this.notifyIdle(); }
  }
  private async handleRequest(method: string, payload: any = {}): Promise<any> {
    check(typeof method === 'string' && method.length <= 80 && payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_REQUEST', 'Use a named request with an object payload.');
    if (method === 'workspace.status') return { open: !!this.vault, workspace: this.vault?.read().workspace, storage: this.options.storage, experimental: !!this.options.demo, version: this.version };
    if (method === 'workspace.create') {
      check(this.options.sync === undefined, 'SYNC_EXISTING_WORKSPACE_REQUIRED', 'Create a local workspace before enrolling its exact identity in device sync.');
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before creating another.');
      check(typeof payload.name === 'string' && payload.name.trim().length >= 2 && payload.name.length <= 100, 'INVALID_NAME', 'Give your business a name.');
      const name = payload.name.trim(), passphrase = payload.passphrase, demo = payload.demo, demoFixtureMonth = payload.demoFixtureMonth;
      const dictionaryMode = Object.hasOwn(payload, 'dictionaryMode') ? payload.dictionaryMode : 'legacy';
      check(dictionaryMode === 'legacy' || dictionaryMode === 'deferred', 'INVALID_DICTIONARY_MODE', 'Choose legacy starter publication or an explicit first-run dictionary review.');
      if (dictionaryMode === 'deferred') check((demo === undefined || demo === false) && !Object.hasOwn(payload, 'demoFixtureMonth') && !Object.hasOwn(payload, 'pack'),
        'INVALID_DICTIONARY_MODE', 'Deferred dictionary review requires a fresh workspace without a demo fixture or selected starter pack.');
      if (demoFixtureMonth !== undefined) check(this.#demo && demo === true, 'DEMO_ONLY', 'Only a synthetic launch may select a sample fixture month.');
      const pack = dictionaryMode === 'legacy' ? payload.pack ?? 'ecommerce' : undefined;
      if (pack !== undefined) check(new OntologyService({ read: () => { throw new Error('No vault'); }, update: async () => { throw new Error('No vault'); } }).packs().some(p => p.pack === pack), 'UNKNOWN_PACK', 'Choose an available business starter pack.');
      const folder = payload.folder ?? 'main';
      return this.withWorkspaceStorage(folder, 'create', async storage => {
      const result = await Vault.create({ directory: this.workspacePath(folder), passphrase, name, demo: !!demo, dictionaryMode, storage, keychain: this.options.keychain });
      try {
        await this.attach(result.vault);
        authorize(result.vault, this.context, 'admin');
        if (dictionaryMode === 'legacy') await this.services.ontology.publish(this.context, pack);
        if (demo) await seedDemo(this.store(), this.context, demoFixtureMonth);
        return { workspace: this.store().read().workspace, recoveryKit: result.recoveryCode, recoveryCode: result.recoveryCode, experimental: !!this.options.demo };
      } catch (error) { await this.deleteVault(result.vault); throw error; }
      });
    }
    if (method === 'workspace.open') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.');
      check(payload.unlock === undefined || payload.unlock === 'passphrase' || payload.unlock === 'keychain', 'INVALID_REQUEST', 'Choose passphrase or native custody unlock.');
      const folder = payload.folder ?? payload.path ?? 'main', keychain = this.options.keychain;
      if (payload.unlock === 'keychain') {
        const ctx = this.context;
        check(ctx.channel === 'desktop' && !ctx.sourceTainted && ctx.role === 'owner'
          && ctx.memberId === this.#baseContext.memberId && ctx.epoch === this.#baseContext.epoch,
        'KEYCHAIN_OWNER_REQUIRED', 'Native custody unlock requires the trusted local desktop owner.');
        check(keychain && 'retrieve' in keychain && typeof keychain.retrieve === 'function', 'KEYCHAIN_PROVIDER_REQUIRED', 'Install the trusted native custody provider before convenience unlock.');
      }
      return this.withWorkspaceStorage(folder, 'open', async storage => {
        if (payload.unlock === 'keychain') await this.attachSafely(await Vault.openWithKeychain({ directory: this.workspacePath(folder), storage,
          keychain: keychain as VaultKeychainProvider, writerGuard: this.writerGuard() }));
        else await this.attachSafely(await Vault.open({ directory: this.workspacePath(folder), passphrase: payload.passphrase,
          storage, keychain, writerGuard: this.writerGuard() }));
        return { workspace: this.store().read().workspace };
      });
    }
    if (method === 'workspace.recover') { check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); const folder = payload.folder ?? 'main'; return this.withWorkspaceStorage(folder, 'recover', async storage => { await this.attachSafely(await Vault.recover({ directory: this.workspacePath(folder), recoveryCode: payload.recoveryCode, newPassphrase: payload.passphrase, storage, keychain: this.options.keychain, writerGuard: this.writerGuard() })); return { workspace: this.store().read().workspace }; }); }
    if (method === 'workspace.restore') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before restoring.');
      check(typeof payload.backupFile === 'string', 'INVALID_PATH', 'Choose a backup from this app.');
      const backupRoot = resolve(this.options.directory, 'backups'); const backupFile = resolve(backupRoot, payload.backupFile); const rel = relative(backupRoot, backupFile);
      check(!rel.startsWith('..') && !isAbsolute(rel) && rel.endsWith('.backup'), 'INVALID_PATH', 'Choose a managed backup file.');
      const folder = payload.folder ?? 'restored'; return this.withWorkspaceStorage(folder, 'restore', async storage => { await this.attachSafely(await Vault.restore({ directory: this.workspacePath(folder), backupFile, passphrase: payload.passphrase, storage, keychain: this.options.keychain, writerGuard: this.writerGuard(),
        prepareRestoredState: (state, descriptor) => {
          if (this.#lastInvoiceCustody?.workspaceId === descriptor.workspaceId && this.#lastInvoiceCustody.vaultId === descriptor.vaultId)
            prepareInvoiceRestoredState(state, this.#lastInvoiceCustody, descriptor);
          else prepareInvoiceRestoredState(state, undefined, descriptor);
        } })); return { workspace: this.store().read().workspace }; });
    }
    if (method === 'workspace.lock') { if (this.vault) authorize(this.vault, this.context, 'admin'); await this.closeVault(); return { locked: true }; }
    const earlyMethod = moduleMethods.get(method);
    if (earlyMethod?.preVault === true && !this.vault) {
      // Only the trusted local desktop may call a module before a workspace is open; nothing is authorized yet.
      const early = this.context;
      check(early.channel === 'desktop' && !early.sourceTainted, 'OPEN_DESKTOP', 'Open the desktop app for this request.');
      check(!(earlyMethod.external && this.#demo), 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled.');
      return earlyMethod.handler(early, payload, this.moduleHost(earlyMethod.module, early));
    }
    const store = this.store(); const ctx = this.context; authorize(store, ctx);
    const s = this.services;
    if (['speech.configure', 'speech.preview', 'speech.approve', 'speech.transcribe'].includes(method)) {
      check(!this.#demo, 'DEMO_PROVIDER_DISABLED', 'Synthetic demo mode keeps speech providers disabled. Use typed questions.');
    }
    if (method === 'sources.fetch' || method === 'connectors.read') {
      check(!this.#demo, 'DEMO_SOURCE_READ_DISABLED', 'Synthetic demo mode keeps external source reads disabled. Import an explicitly selected local fixture.');
    }
    // Dedicated invoice guards own mandate acceptance, reminder expiry and costs.
    if (method.startsWith('jobs.') && payload.id) check(!store.read().jobs.some(job => job.id === payload.id && job.type === invoiceJobType),
      'INVOICE_CONTRACT_REQUIRED', 'Use the named invoice follow-up contract for this mandate.');
    if (method.startsWith('actions.') && payload.id) check(!store.read().actions.some(action => action.id === payload.id && action.connector === invoiceConnectorId),
      'INVOICE_CONTRACT_REQUIRED', 'Use the named invoice reminder contract for this action.');
    if (method.startsWith('invoiceFollowUp.')) {
      check(ctx.channel !== 'phone', 'OPEN_DESKTOP', 'Review invoice mandates and reminders in the desktop app.');
      check(s.invoiceFollowUp, 'INVOICE_HOST_UNAVAILABLE', 'A trusted synthetic invoice host with explicit policy is required.');
    }
    const moduleMethod = moduleMethods.get(method);
    if (moduleMethod) {
      authorize(store, ctx, moduleMethod.permission);
      check(ctx.channel !== 'phone' || moduleMethod.phone === true, 'OPEN_DESKTOP', 'Open the desktop app for this request.');
      check(!(moduleMethod.external && this.#demo), 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps external systems disabled.');
      return moduleMethod.handler(ctx, payload, this.moduleHost(moduleMethod.module, ctx));
    }
    switch (method) {
      case 'today.prepareTiles': {
        this.journalPayload(payload, ['date', 'timeZone', 'starterPack', 'configurationId', 'configurationDigest', 'request'],
          ['date', 'timeZone', 'starterPack', 'configurationId', 'configurationDigest', 'request'], 'INVALID_TODAY_REQUEST');
        return s.today.prepareTiles(ctx, payload);
      }
      case 'today.get': {
        this.journalPayload(payload, ['date', 'timeZone', 'tileCapture'], ['date', 'timeZone'], 'INVALID_TODAY_REQUEST');
        return this.vault!.snapshot(async () => s.today.get(ctx, payload));
      }
      case 'today.review': {
        this.journalPayload(payload, ['limit', 'cursor'], [], 'INVALID_TODAY_REQUEST');
        return this.vault!.snapshot(async () => s.today.review(ctx, payload));
      }
      case 'today.resolveReview': {
        this.journalPayload(payload, ['reference'], ['reference'], 'INVALID_TODAY_REQUEST');
        return this.vault!.snapshot(async () => s.today.resolveReview(ctx, payload.reference));
      }
      case 'today.resolveEvent': {
        this.journalPayload(payload, ['date', 'timeZone', 'eventId'], ['date', 'timeZone', 'eventId'], 'INVALID_TODAY_REQUEST');
        return this.vault!.snapshot(async () => s.today.resolveEvent(ctx, payload));
      }
      case 'today.resolveAttention': {
        this.journalPayload(payload, ['date', 'timeZone', 'reference'], ['date', 'timeZone', 'reference'], 'INVALID_TODAY_REQUEST');
        return this.vault!.snapshot(async () => s.today.resolveAttention(ctx, payload));
      }
      case 'ui.context': {
        this.journalPayload(payload, [], [], 'INVALID_UI_CONTEXT');
        const member = authorize(store, ctx), state = store.read();
        // Reads may append receipts, answers and activity. Those do not change
        // authority. Evidence, policy and configured routes do invalidate views.
        const contextKey = hash({ kind: 'ui-authority-context-v1', workspace: state.workspace,
          member, policy: state.policy, sourceRules: state.sourceRules, tombstones: state.tombstones,
          ontology: state.ontology, facts: state.facts, imports: state.imports, merges: state.merges,
          routes: state.routes.map(({ costConsumedMinor: _costConsumedMinor, ...configuration }) => configuration) });
        return { workspace: { id: state.workspace.id, name: state.workspace.name, demo: state.workspace.demo },
          member: { id: member.id, name: member.name, role: member.role, epoch: member.epoch, branches: [...member.branches] }, contextKey };
      }
      case 'invoiceFollowUp.create':
        check(payload.ownerId === ctx.memberId, 'JOB_OWNER_REQUIRED', 'Declare the exact creating owner for this invoice mandate.');
        check(payload.requiresApproval === true, 'INVOICE_MANDATE_APPROVAL_REQUIRED', 'Review and approve each explicit invoice mandate.');
        return s.invoiceFollowUp.dispatch(ctx, method, payload);
      case 'invoiceFollowUp.consent.record':
      case 'invoiceFollowUp.run':
      case 'invoiceFollowUp.read':
      case 'invoiceFollowUp.reconcile':
      case 'invoiceFollowUp.pause':
      case 'invoiceFollowUp.resume':
      case 'invoiceFollowUp.cancel':
      case 'invoiceFollowUp.approve':
      case 'invoiceFollowUp.accept':
      case 'invoiceFollowUp.reject':
      case 'invoiceFollowUp.reminder.approve':
      case 'invoiceFollowUp.reminder.execute':
      case 'invoiceFollowUp.reminder.reconcile':
      case 'invoiceFollowUp.reminder.cancel':
        return s.invoiceFollowUp.dispatch(ctx, method, payload);
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
      case 'scenarios.create': return s.scenarios.create(ctx, this.journalPayload(payload,
        ['version', 'label', 'baseline', 'alternatives'], ['version', 'label', 'baseline', 'alternatives'], 'INVALID_SCENARIO'));
      case 'scenarios.addAnalysis': {
        const input = this.journalPayload(payload, ['scenarioId', 'expectedHeadRevisionId', 'input'],
          ['scenarioId', 'expectedHeadRevisionId', 'input'], 'INVALID_SCENARIO');
        return s.scenarios.addAnalysis(ctx, input.scenarioId, input.expectedHeadRevisionId, input.input);
      }
      case 'scenarios.changeAssumption': {
        const input = this.journalPayload(payload, ['scenarioId', 'expectedHeadRevisionId', 'branchId', 'priceChangeBps'],
          ['scenarioId', 'expectedHeadRevisionId', 'branchId', 'priceChangeBps'], 'INVALID_SCENARIO');
        return s.scenarios.changeAssumption(ctx, input.scenarioId, input.expectedHeadRevisionId, input.branchId, input.priceChangeBps);
      }
      case 'scenarios.beginRun': {
        const input = this.journalPayload(payload, ['scenarioId', 'revisionId', 'jobId'],
          ['scenarioId', 'revisionId', 'jobId'], 'INVALID_SCENARIO');
        return s.scenarios.beginRun(ctx, input.scenarioId, input.revisionId, input.jobId);
      }
      case 'scenarios.evaluate': {
        const input = this.journalPayload(payload, ['scenarioId', 'runId'], ['scenarioId', 'runId'], 'INVALID_SCENARIO');
        return s.scenarios.evaluate(ctx, input.scenarioId, input.runId);
      }
      case 'scenarios.finalize': {
        const input = this.journalPayload(payload, ['scenarioId', 'expectedHeadRevisionId'],
          ['scenarioId', 'expectedHeadRevisionId'], 'INVALID_SCENARIO');
        return s.scenarios.finalize(ctx, input.scenarioId, input.expectedHeadRevisionId);
      }
      case 'scenarios.reopen': {
        const input = this.journalPayload(payload, ['scenarioId', 'revisionId'], ['scenarioId', 'revisionId'], 'INVALID_SCENARIO');
        return s.scenarios.reopen(ctx, input.scenarioId, input.revisionId);
      }
      case 'scenarios.discover': {
        const input = this.journalPayload(payload, ['limit', 'cursor'], [], 'INVALID_SCENARIO');
        return s.scenarios.discover(ctx, input);
      }
      case 'scenarios.recompute': {
        const input = this.journalPayload(payload, ['scenarioId', 'expectedHeadRevisionId'],
          ['scenarioId', 'expectedHeadRevisionId'], 'INVALID_SCENARIO');
        return s.scenarios.recompute(ctx, input.scenarioId, input.expectedHeadRevisionId);
      }
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
      case 'sync.enable': return this.writerConfiguration(() => {
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
      case 'sources.delete': {
        // This request holds the Engine transition fence, requires an idle
        // authority and excludes newly admitted jobs until managed cleanup ends.
        const result = await s.trust.deleteSource(ctx, payload.id);
        const removed = await this.purgeManagedCopies();
        return { ...result, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' };
      }
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
      case 'ontology.get': return s.ontology.get(ctx, payload);
      case 'ontology.publish': return s.ontology.publishPayload(ctx, payload);
      case 'memory.list': return s.memory.query(ctx, payload);
      case 'memory.lessons': {
        this.journalPayload(payload, [], [], 'INVALID_LESSON');
        if (s.lessons) return s.lessons.lessons(ctx);
        check(!store.read().lessonState?.lessons.length, 'LESSON_AUTHORITY_REQUIRED', 'Install current lesson evidence and personal target authorities before reading retained lessons.');
        return [];
      }
      case 'memory.decideLesson': {
        const input = this.journalPayload(payload, ['candidate', 'reviewId', 'reviewDigest', 'decision', 'reason'],
          ['candidate', 'reviewId', 'reviewDigest', 'decision', 'reason'], 'INVALID_LESSON');
        check(s.lessons, 'LESSON_AUTHORITY_REQUIRED', 'Install current lesson evidence, personal target and evaluation authorities before deciding a lesson.');
        return s.lessons.decideLesson(ctx, input as LessonDecision);
      }
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
      case 'jobs.list': return s.jobs.list(ctx).filter((job: Job) => job.type !== invoiceJobType);
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
        return s.jobs.accept(ctx, payload.id, payload.repeat === true, payload.reference);
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
      case 'workspace.delete': {
        this.requireWorkspaceOwner(ctx); const workspace = store.read().workspace;
        check(payload.confirmation === workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete the vault.');
        await this.revokeManagedCopyReceipts();
        let removed: string[] = [];
        await this.deleteVault(store, async ({ privateArtifactPaths, assertCurrent }) => {
          removed = [...privateArtifactPaths, ...await this.purgeManagedApplicationCopies(workspace.id, assertCurrent)];
        });
        return { deleted: true, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' };
      }
      default: throw new ChausarError('UNKNOWN_METHOD', `Unknown request: ${method}`);
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
    const visibility: StateStore = { read: () => current, update: async () => { throw new Error('Owner admission is read-only.'); } };
    check(historical.facts.every(fact => canSeeFact(visibility, ctx, fact)), 'INTERCHANGE_READ_SCOPE_REQUIRED', 'Workspace copying requires current access to every retained historical row.');
    const managedSourceIds = [...new Set<string>(current.imports.filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type)).map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    this.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
    this.retainedNamespaceOwner(ctx, historical, current);
  }
  private retainedNamespaceOwner(ctx: Context, historical: State, current: State) {
    const assertScenarioRelease = historical.scenarioRecords?.length
      ? this.services.scenarios.assertInterchangeRead(ctx, historical) : undefined;
    if (historical.lessonState && (historical.lessonState.episodes.length || historical.lessonState.lessons.length)) {
      check(this.services.lessons, 'LESSON_AUTHORITY_REQUIRED', 'Install current lesson evidence, target and evaluation authorities before copying retained lesson history.');
      this.services.lessons.assertInterchangeRead(ctx, historical.lessonState, { at: now(), days: current.policy.retentionDays });
    }
    assertScenarioRelease?.();
  }
  private backupHost(): WorkspaceBackupV2Host {
    check(this.services.backupV2 instanceof WorkspaceBackupV2Host, 'BACKUP_STORAGE_PROFILE_REQUIRED',
      'This storage profile requires its separately reviewed complete encrypted-custody implementation.');
    return this.services.backupV2;
  }
  private activationHost(): EngineWorkspaceActivation | EnginePostgresWorkspaceActivation {
    check(this.services.workspaceActivation instanceof EngineWorkspaceActivation
      || this.services.workspaceActivation instanceof EnginePostgresWorkspaceActivation, 'ACTIVATION_ROOT_REQUIRED',
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
    const visibility: StateStore = { read: () => current, update: async () => { throw new Error('Owner admission is read-only.'); } };
    check(historical.facts.every(fact => canSeeFact(visibility, ctx, fact)), 'BACKUP_READ_SCOPE_REQUIRED', 'Current access must cover every retained historical row.');
    const managedSourceIds = [...new Set<string>([...current.imports, ...historical.imports]
      .filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type))
      .map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    check((this.options.sync === undefined && managedSourceIds.length === 0) || typeof this.options.backupCustody?.withCompleteOwner === 'function',
      'BACKUP_HELD_READINESS_REQUIRED', 'Configured sync and managed sources require installed held owner/source/readiness admission through archive publication.');
    this.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
    this.retainedNamespaceOwner(ctx, historical, current);
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
  private async revokeManagedCopyReceipts() {
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
  }
  private async purgeManagedCopies() {
    await this.revokeManagedCopyReceipts();
    const vault = this.store(), workspaceId = vault.read().workspace.id;
    return [...await vault.purgeArtifacts(), ...await this.purgeManagedApplicationCopies(workspaceId)];
  }
  private async purgeManagedApplicationCopies(workspaceId: string, assertCurrent: () => void = () => {}) {
    const removed: string[] = [], prefix = `chausar-${workspaceId}-`;
    for (const name of ['backups', 'exports']) {
      const folder = resolve(this.options.directory, name); let files;
      try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') continue; throw error; }
      for (const file of files) if (file.isFile() && file.name.startsWith(prefix) && /^\d+\.(backup|json|vault)$/.test(file.name.slice(prefix.length))) { const path = resolve(folder, file.name); check(relative(folder, path) === file.name, 'INVALID_PATH', 'A managed file left its export directory.'); assertCurrent(); await unlink(path); removed.push(`${name}/${file.name}`); }
    }
    return removed;
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
    const host = { ...this.#jobLifecycle };
    if (this.#closing || this.#transition || !this.vault || !this.vault.read().policy.autonomy || !host.awake || (!host.windowOpen && !host.backgroundEnabled)) return [];
    this.#activeRequests++;
    try {
    const due = this.vault.read().jobs.filter((job: Job) => !job.plan && !engineModules.some(engineModule => engineModule.ownsJob?.(job)) && (host.windowOpen || job.background === true) && ((['scheduled', 'approval-blocked'].includes(job.status) && Date.parse(job.nextRunAt) <= this.services.jobs.clock()) || (job.status === 'running' && job.lease && Date.parse(job.lease.expiresAt) <= this.services.jobs.clock())));
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
    if (!this.#closing && !this.#transition && this.services.invoiceFollowUp) for (const member of this.vault.read().members.filter(member => member.active && ['owner', 'cofounder'].includes(member.role))) {
      const ownerContext: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
      try {
        const installed = this.services.invoiceFollowUp as InvoiceFollowUpHost;
        const ran = await installed.dispatch(ownerContext, 'invoiceFollowUp.tick', host) as Job[];
        for (const job of ran) results.push(this.context.memberId === job.ownerId && this.context.epoch === job.ownerEpoch && this.context.role === job.ownerRole
          ? installed.jobs.view(this.context, installed.jobs.find(this.vault.read(), job.id)) : { id: job.id, status: job.status });
      } catch (error) { results.push({ error: { code: (error as any).code ?? 'JOB_SCHEDULER_FAILED' } }); }
    }
    for (const engineModule of engineModules) if (engineModule.tick && !this.#closing && !this.#transition && this.vault)
      for (const member of this.vault.read().members.filter(member => member.active && ['owner', 'cofounder'].includes(member.role))) {
        const ownerContext: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
        try { results.push(...await this.withContext(ownerContext, () => engineModule.tick!(ownerContext, this.moduleHost(engineModule.id, ownerContext), host))); }
        catch (error) { results.push({ module: engineModule.id, error: { code: (error as any).code ?? 'MODULE_SCHEDULER_FAILED' } }); }
      }
    return results;
    } finally { this.#activeRequests--; this.notifyIdle(); }
  }
}
