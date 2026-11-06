

import { resolve, join } from 'node:path';

import { Vault, safeDirectory } from '../vault.ts';

import { OntologyService } from '../ontology.ts';
import { ImportService } from '../ingest.ts';
import { MemoryService } from '../memory.ts';

import { CalculatorService, type CalculatorOptions, type CalculationRequest, type CalculationReceipt } from '../calculator.ts';

import { ForecastService } from '../forecast-service.ts';
import { AlertsService } from '../alerts.ts';
import { ReportService, type ReportOptions } from '../reports.ts';
import { createJournalExecutionResolver } from '../journal-execution.ts';
import { BridgeService } from '../bridge-service.ts';
import { InvestigationService } from '../investigations.ts';

import { ResearchSearchService } from '../research-search.ts';
import { TrustService } from '../trust.ts';
import { ModelGateway } from '../gateway.ts';

import { ConversationHistoryService } from '../conversation-history.ts';
import { ConversationSynthesisHost } from '../conversation-synthesis-host.ts';
import { installedConversationSynthesisCodec } from '../conversation-synthesis-codec.ts';

import { assertBusinessContextCurrent, BusinessProfileService, type BusinessContextHooks } from '../conversation-context.ts';
import { SpeechService } from '../speech.ts';
import { AuthService } from '../auth.ts';

import { SyncService } from '../sync.ts';

import { ActionService, digest } from '../actions.ts';
import { JobService } from '../jobs.ts';
import { createEngineJobRunner } from '../engine-jobs.ts';

import { PluginService } from '../plugins.ts';
import { LearningService } from '../learning.ts';
import { MCPService } from '../mcp.ts';
import { ConnectorService } from '../connectors.ts';
import { EngineConnectorService } from '../engine-connectors.ts';
import { PrivateTrialHostService } from '../private-trial-host.ts';

import { WorkspaceInterchangeHost } from '../workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../workspace-interchange-local.ts';
import { WorkspaceBackupV2Host } from '../workspace-backup-v2.ts';
import { createWorkspaceBackupV2LocalPorts } from '../workspace-backup-local.ts';
import { EngineWorkspaceActivation } from '../workspace-activation-engine.ts';

import { DatabaseCalculator } from '../analytics.ts';
import { AnalyticalHelper } from '../helper.ts';
import { ReleaseUpdater } from '../updater.ts';

import { audit, check, hash, newId, now, type Context, type StateStore } from '../contracts.ts';

import { defaultBackupBudgets, defaultBackupFilesystemBudgets } from './shared.ts';
import type { EngineInternals } from './internals.ts';

export async function attach(internals: EngineInternals, vault: Vault): Promise<void> {
    internals.privateVenture?.close(); internals.privateVenture = null; internals.privateVenturePromise = null;
    // A new workspace starts with long local work allowed again.
    if (internals.privateStopWork.signal.aborted) internals.privateStopWork = new AbortController();
    // Vault paths are canonicalized when opened. Resolve the independently
    // configured root under the same no-symlink checks before comparing scope
    // (Windows may spell the same directory with a short-name alias).
    const applicationDirectory = await safeDirectory(internals.options.directory);
    const owner = internals.currentWorkspaceOwner(vault);
    check(owner, 'OWNER_REQUIRED', 'This business has no owner set up yet.');
    internals.vault = vault; delete internals.services.workspaceActivation;
    internals.privateUnknownAnswerRecoveries.clear();
    internals.context = { memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop' };
    const store: StateStore = vault;
    internals.services.ontology = new OntologyService(store);
    internals.services.imports = new ImportService(store);
    internals.services.memory = new MemoryService(store);
    // Preview arithmetic is exact integer math. Production additionally refuses
    // numbers until the registered isolated SQL query verifies the same projection.
    const database = internals.options.demo ? null : new DatabaseCalculator(internals.options.analytics);
    const connectorRuntime = new EngineConnectorService(store, internals.options.connectorRuntime);
    internals.services.connectorRuntime = connectorRuntime;
    const calculationOptions: CalculatorOptions = {
      ...(database ? { verifier: (receipt: any) => database.verify(receipt) } : {}),
      consumerGuard: (ctx, request) => connectorRuntime.assertCalculationReady(ctx, request),
      receiptGuard: (ctx, receipt) => connectorRuntime.assertReceiptReady(ctx, receipt),
    };
    internals.services.calculator = new CalculatorService(store, calculationOptions);
    internals.services.forecasts = new ForecastService(store, calculationOptions);
    // Execution resolution is a trusted host port, never a route or RPC setting.
    const reportOptions: ReportOptions = { ...calculationOptions, executionReceipt: (ctx, id, view) => {
      const resolver = internals.options.reports?.executionReceipt ?? createJournalExecutionResolver(internals.services.actions);
      return resolver(ctx, id, view);
    }, alertBrief: (ctx, scope, view) => new AlertsService(view, { calculatorOptions: current => {
      const connectors = connectorForView(current);
      return { consumerGuard: (member, request) => connectors.assertCalculationReady(member, request),
        receiptGuard: (member, receipt) => connectors.assertReceiptReady(member, receipt) };
    } }).brief(ctx, scope) };
    internals.services.reports = new ReportService(store, reportOptions);
    internals.services.bridge = new BridgeService(store, { calculator: calculationOptions, ...internals.options.bridge });
    internals.services.investigations = new InvestigationService(store, calculationOptions);
    internals.services.research = new ResearchSearchService(store, { calculator: calculationOptions, reports: reportOptions,
      adapter: () => internals.privateSearchAdapter() });
    internals.services.connectors = new ConnectorService(store, { credentialBroker: internals.options.connectorCredentials });
    internals.services.helper = new AnalyticalHelper({ executable: internals.options.pythonExecutable });
    if (internals.options.updatePublicKey) internals.services.updater = new ReleaseUpdater({ publicKey: internals.options.updatePublicKey, version: internals.version, stageDirectory: internals.options.updates ? join(internals.options.updates.directory, 'stage') : resolve(internals.options.directory, 'updates') });
    internals.services.trust = new TrustService(store);
    const connectorForView = (view: StateStore) => view === store ? connectorRuntime : new EngineConnectorService(view, internals.options.connectorRuntime);
    internals.services.privateTrials = new PrivateTrialHostService(store, {
      custody: {
        write: input => vault.writeArtifact(input).then(ref => ({ ...ref, purpose: 'private-trial' as const })),
        read: input => vault.readArtifact(input).then(ref => ({ ...ref, purpose: 'private-trial' as const })),
        list: input => vault.listArtifacts(input).then(refs => refs.map(ref => ({ ...ref, purpose: 'private-trial' as const }))),
        remove: input => vault.removeArtifact(input),
      },
      now,
      resolveRecipeEvidence: (ctx, sourceId) => internals.privateRecipeEvidence(ctx, sourceId),
      calculatorGuards: view => {
        const connectors = connectorForView(view);
        return { consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
          receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt) };
      },
      resolvePromotionImpact: (ctx, _fork, _evaluation, strategy) => internals.privatePromotionImpact(ctx, internals.store().read(), strategy),
      promoteAtomic: (ctx, publication) => internals.promotePrivateTrial(ctx, publication),
    });
    const interchangeLocal = createWorkspaceInterchangeLocalPorts({ vault, applicationDirectory,
      assertCompleteOwner: async (ctx, historical) => internals.interchangeOwner(ctx, historical) });
    internals.services.interchangeLocal = interchangeLocal;
    internals.services.interchange = new WorkspaceInterchangeHost(interchangeLocal.ports);
    if (vault.storageKind === 'experimental-file') {
      const backup = internals.options.backupCustody;
      const budgets = backup?.budgets ?? defaultBackupBudgets;
      let installedActivation: EngineWorkspaceActivation | undefined;
      const backupLocal = createWorkspaceBackupV2LocalPorts({ vault, applicationDirectory, budgets,
        ...(internals.options.workspaceActivation ? {workspaceActivation: {journalVault: internals.options.workspaceActivation.journalVault,
          inspectCurrentLive: async (input: Parameters<EngineWorkspaceActivation['inspectCurrentLive']>[0]) => {
            check(installedActivation, 'ACTIVATION_ROOT_REQUIRED', 'Complete the trusted activation composition before live custody inspection.');
            await installedActivation.inspectCurrentLive(input);
          }}} : {}),
        filesystemBudgets: backup?.filesystemBudgets ?? defaultBackupFilesystemBudgets,
        externalKeyRequirements: backup?.externalKeyRequirements ?? [{ provider: 'other', namespace: 'operator/credential-wrappers',
          requirement: 'Retain the operator passphrase or recovery credential separately. Encrypted wrappers do not include that credential.' }],
        assertCompleteOwner: async (ctx, historical) => internals.backupCompleteOwner(ctx, historical),
        withCompleteOwner: async (ctx, historical, work) => vault.withCustodyWriterAdmission(async assertVault => {
          const admission = async (assertAdditional: () => void) => {
            const assertCurrent = () => {
              check(internals.options.backupCustody === backup, 'BACKUP_HOST_CONFIGURATION_CHANGED', 'Installed custody admission changed during publication.');
              assertVault(); internals.backupCompleteOwner(ctx, historical);
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
      internals.services.backupLocal = backupLocal;
      internals.services.backupV2 = new WorkspaceBackupV2Host(backupLocal.ports, budgets);
      const activation = internals.options.workspaceActivation;
      if (activation) {
        check(internals.options.demo === true && internals.options.sync === undefined
          && !vault.read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
        'ACTIVATION_SOURCE_PROFILE', 'This joined activation profile supports explicitly approved synthetic local sources; sync and managed connector activation need their separate qualified profiles.');
        installedActivation = new EngineWorkspaceActivation({...activation, sourceVault: vault, applicationDirectory,
          backup: backupLocal, interchange: interchangeLocal,
          backupPolicy: {approvedSyntheticWorkspaceIds: [...activation.policy.approvedSyntheticWorkspaceIds], backupBudgets: budgets,
            maxMaterialUtf8Bytes: activation.policy.budgets.maxCandidateBytes, maxCandidateUtf8Bytes: activation.policy.budgets.maxCandidateBytes},
          assertCompleteOwner: async (ctx, historical) => {
            check(internals.options.workspaceActivation === activation && internals.options.sync === undefined,
              'ACTIVATION_HOST_CONFIGURATION_CHANGED', 'Installed activation admission changed during custody.');
            internals.backupCompleteOwner(ctx, historical);
            check(!internals.store().read().imports.some(item => typeof item.type === 'string' && item.type.startsWith('connector-')),
              'ACTIVATION_SOURCE_PROFILE', 'Current managed connector imports need a separately qualified activation profile.');
          }});
        internals.services.workspaceActivation = installedActivation;
      }
    }
    internals.services.alerts = new AlertsService(store, { calculatorOptions: view => {
      const connectors = connectorForView(view);
      return {
        consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
        receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt),
      };
    } });
    const businessContextHooks: BusinessContextHooks = { assertEvidenceReady: (ctx, refs, view = store) => {
      internals.options.gateway?.businessContext?.assertEvidenceReady?.(ctx, refs, view);
      return connectorForView(view).assertBusinessEvidenceReady(ctx, refs);
    } };
    internals.services.businessContextHooks = businessContextHooks;
    internals.services.conversationHistory = new ConversationHistoryService(store, {
      assertBusinessContext: (ctx, manifest, view) => assertBusinessContextCurrent(view, ctx, manifest, businessContextHooks),
      receipt: (ctx, id, view) => new CalculatorService(view, {
        receiptGuard: (currentCtx, receipt) => connectorForView(view).assertReceiptReady(currentCtx, receipt),
      }).receipt(ctx, id),
      assertModelReceipt: (ctx, id, view) => internals.services.gateway.assertConversationReceipt(ctx, id, view),
      assertSynthesisAnswer: (ctx, record, view) => internals.services.synthesisHost.assertRecord(ctx, record, view),
    });
    internals.services.synthesisHost = new ConversationSynthesisHost(store, {
      history: view => new ConversationHistoryService(view, internals.services.conversationHistory.options),
      planner: (ctx, id, view) => internals.services.gateway.assertConversationReceipt(ctx, id, view),
      synthesis: (ctx, id, view) => internals.services.gateway.assertSynthesisReceipt(ctx, id, view),
      codec: () => internals.options.synthesis ?? internals.options.gateway?.synthesisCodec ?? installedConversationSynthesisCodec,
    });
    internals.services.businessProfile = new BusinessProfileService(store);
    internals.services.gateway = new ModelGateway(store, { ...internals.options.gateway, businessContext: businessContextHooks,
      conversationContinuation: (ctx, id, view, resolvedBy) => internals.conversationContinuation(ctx, id, view, resolvedBy),
      conversationSynthesis: (ctx, id, view) => internals.services.synthesisHost.resolve(ctx, id, view),
      synthesisCodec: internals.options.synthesis ?? internals.options.gateway?.synthesisCodec ?? installedConversationSynthesisCodec });
    internals.services.speech = new SpeechService(store, internals.options.speech);
    // The whisper.cpp the owner set up in Connections > Your AI, kept in the vault; never on the hosted server.
    if (internals.options.venture?.host !== 'hosted-web') internals.services.speech.restoreLocal(store.read());
    internals.services.auth = new AuthService(store);
    internals.services.sync = new SyncService(store, { ...internals.options.sync, vault, requireWriterAdmission: true });
    internals.services.actions = new ActionService(store, internals.builtinActions(store));
    internals.services.jobs = new JobService(store, { clock: internals.options.durableJobs?.clock,
      calendarRules: internals.options.jobCalendar?.rules, calendarBounds: internals.options.jobCalendar?.bounds,
      deliverableGuard: (ctx: Context, job: any, candidateView?: StateStore) => {
      if (!job.deliverable) return true;
      if (job.plan) return internals.services.jobRunner?.canRelease(ctx, job) === true;
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
        const history = new ConversationHistoryService(view, internals.services.conversationHistory.options);
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
    if (internals.options.durableJobs) internals.services.jobRunner = createEngineJobRunner(store, internals.services.jobs, internals.services.actions, calculationOptions, internals.options.durableJobs);
    internals.services.plugins = new PluginService(store, {});
    internals.services.learning = new LearningService(store);
    internals.services.mcp = new MCPService(store, { calculations: [{
      name: 'calculate', description: 'Run a published read-only business calculation and return its exact receipt.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: { operation: { type: 'string', enum: ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'revenue', 'net_sales', 'margin', 'aging', 'change', 'scenario'] }, period: { type: 'object' }, asOf: { type: 'string' }, branch: { type: 'string' }, customerId: { type: 'string' }, orderId: { type: 'string' }, comparePeriod: { type: 'object' }, assumptions: { type: 'object' }, onDate: { type: 'string' } } },
      calculate: async (request: any, ctx: Context) => { const receipt = await internals.services.calculator.calculate(ctx, request); return { value: receipt.totalMinor, receipt }; },
    }], receiptReader: (ctx: Context, id: string) => internals.services.calculator.receipt(ctx, id) });
  }

export function builtinActions(internals: EngineInternals, store: StateStore): any {
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
