import { isCaptureSample } from './venture/replay/sample.ts';
import { currentRun } from './venture/replay/scope.ts';
import { DIGEST_PATTERN } from '../shared/digest.ts';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { CLAUDE_INSTALL_WORDS, installClaudeCode, mintClaudeInstallYes, type ClaudeInstallProgress, type ClaudeInstallResult, type ClaudeInstallView } from './venture/models/claude-code-install.ts';
import { readdir } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Vault, atomicWriteText, safeDirectory, type VaultWriterGuard } from './vault.ts';
import { PostgresSnapshotAdapter } from './postgres.ts';
import { MemoryService } from './memory.ts';
import { CalculatorService, type CalculationReceipt } from './calculator.ts';
import { type AnswerRecoveryEvidence, type PreparedAnswerRecovery, type CompletedAnswerRecovery } from './answer-recovery.ts';
import { PostgresInvestigationSearch } from './investigation-search.ts';
import { type ResearchSearchPort } from './research-search.ts';
import { ModelGateway } from './gateway.ts';
import { type BusinessContextManifest } from './conversation-context.ts';
import { PhoneSessionService } from './engine-phone-sessions.ts';
import { EnginePhoneRuntime } from './engine-phone-runtime.ts';
import { WorkProgress } from './work-progress.ts';
import type { WorkKind } from './venture/views/work-steps.ts';
import type { Brief, ChatAnswer } from './phone/contracts.ts';
import { writerStateDigest } from './sync-writer-admission.ts';
import { JobService } from './jobs.ts';
import { type JobLifecycle } from './engine-jobs.ts';
import type { Job } from './jobs.ts';
import type { PrivateTrialAtomicPublication } from './private-trial-host.ts';
import type { PrivateTrialRecipeEvidence } from './private-trial-contracts.ts';
import { WorkspaceBackupV2Host } from './workspace-backup-v2.ts';
import { EngineWorkspaceActivation } from './workspace-activation-engine.ts';
import { compareVersions } from './updater.ts';
import { UpdateService } from './update-service.ts';
import { authorize, check, ChausarError, hash, InternalError, internalCheck, now, type Context, type State, type StateStore } from './contracts.ts';
import type { BusinessSnapshotRead, SecretShelf, VentureClosingPort, VentureFrame, VentureRunEvent, VentureWorkspacePort } from './venture/contracts.ts';
import type { DraftHandoverPort } from './venture/onboarding-contracts.ts';
import { type DeviceKeyRecord, type DeviceKeyStore } from './device-custody.ts';
import { DriveBackup } from './drive-backup.ts';
import { CustodyFiles, MANAGED_COPY_TAIL, backupName, type BackupSchedule, type VaultCard } from './workspace-custody.ts';
import { aiSetupFile } from './venture/models/ai-setup-file.ts';
import { cliLookFile, cliLookPath } from './venture/models/cli-look-file.ts';
import { BACKUP_AFTER_METHODS, type BackupCopyView, type BackupInspectView, type BackupKind, type BackupView, type CopyImportResult, type CustodyView, type DriveStatus, type RecoveryState, type UnlockMode } from './workspace-custody-contracts.ts';
import { WorkspaceSnapshots } from './workspace-snapshots.ts';
import { type DraftDeskHandle, type EngineBackupCustodyOptions, type EngineOptions, JOURNAL_SWEEP_EVERY_MS, NOTIFY_EVERY_MS, type ConversationContinuation, type AnswerRecoveryRecord, answerRecoveryRecordIntegrity, type LegacyInternals } from './engine/shared.ts';
export type { EngineOptions, EngineBackupCustodyOptions, ConversationContinuation, AnswerRecoveryRecord, LegacyInternals } from './engine/shared.ts';
export { NOTIFY_EVERY_MS } from './engine/shared.ts';
import type { EngineInternals } from './engine/internals.ts';
import { ENGINE_HANDLERS } from './engine/dispatch.ts';
import { unknownRequest } from './engine/admission.ts';
import * as conversation from './engine/conversation.ts';
import * as services from './engine/services.ts';
import * as legacy_operations from './engine/legacy-operations.ts';
import * as custody from './engine/custody.ts';
export class Engine {
  /** Private composition only. No capability object is returned by a request. */
  #internals: EngineInternals = (() => { const engine = this; return {
    engine,
    get privateActiveRequests() { return engine.#activeRequests; }, set privateActiveRequests(value) { engine.#activeRequests = value; },
    privateAiSetup: engine.#aiSetup.bind(engine),
    get privateAnswerRecoveryExecutions() { return engine.#answerRecoveryExecutions; }, set privateAnswerRecoveryExecutions(value) { engine.#answerRecoveryExecutions = value; },
    get privateBaseContext() { return engine.#baseContext; }, set privateBaseContext(value) { engine.#baseContext = value; },
    get privateClaudeProgress() { return engine.#claudeProgress; }, set privateClaudeProgress(value) { engine.#claudeProgress = value; },
    get privateClosedByOwner() { return engine.#closedByOwner; }, set privateClosedByOwner(value) { engine.#closedByOwner = value; },
    get privateClosing() { return engine.#closing; }, set privateClosing(value) { engine.#closing = value; },
    get privateCompanion() { return engine.#companion; }, set privateCompanion(value) { engine.#companion = value; },
    get privateCustody() { return engine.#custody; }, set privateCustody(value) { engine.#custody = value; },
    get privateCustodyChain() { return engine.#custodyChain; }, set privateCustodyChain(value) { engine.#custodyChain = value; },
    get privateCustodyFiles() { return engine.#custodyFiles; }, set privateCustodyFiles(value) { engine.#custodyFiles = value; },
    get privateDraft() { return engine.#draft; }, set privateDraft(value) { engine.#draft = value; },
    privateDraftDesk: engine.#draftDesk.bind(engine),
    get privateDrive() { return engine.#drive; }, set privateDrive(value) { engine.#drive = value; },
    privateOneStep: engine.#oneStep.bind(engine),
    get privateOpenFolder() { return engine.#openFolder; }, set privateOpenFolder(value) { engine.#openFolder = value; },
    get privateOpenUnlock() { return engine.#openUnlock; }, set privateOpenUnlock(value) { engine.#openUnlock = value; },
    get privateSchedule() { return engine.#schedule; }, set privateSchedule(value) { engine.#schedule = value; },
    get privateSnapshotMark() { return engine.#snapshotMark; }, set privateSnapshotMark(value) { engine.#snapshotMark = value; },
    get privateSnapshots() { return engine.#snapshots; }, set privateSnapshots(value) { engine.#snapshots = value; },
    get privateStopWork() { return engine.#stopWork; }, set privateStopWork(value) { engine.#stopWork = value; },
    get privateTransition() { return engine.#transition; }, set privateTransition(value) { engine.#transition = value; },
    get privateUnknownAnswerRecoveries() { return engine.#unknownAnswerRecoveries; }, set privateUnknownAnswerRecoveries(value) { engine.#unknownAnswerRecoveries = value; },
    get privateVenture() { return engine.#venture; }, set privateVenture(value) { engine.#venture = value; },
    privateVentureHost: engine.#ventureHost.bind(engine),
    privateVentureModule: engine.#ventureModule.bind(engine),
    get privateVenturePromise() { return engine.#venturePromise; }, set privateVenturePromise(value) { engine.#venturePromise = value; },
    get privateVentureWorkspace() { return engine.#ventureWorkspace; }, set privateVentureWorkspace(value) { engine.#ventureWorkspace = value; },
    get privateWork() { return engine.#work; }, set privateWork(value) { engine.#work = value; },
    privateWorkBusiness: engine.#workBusiness.bind(engine),
    activationHost: engine.activationHost.bind(engine),
    adapter: engine.adapter.bind(engine),
    afterOpen: engine.afterOpen.bind(engine),
    answerRecoveryCalculator: engine.answerRecoveryCalculator.bind(engine),
    answerRecoveryEvidence: engine.answerRecoveryEvidence.bind(engine),
    answerRecoveryOwner: engine.answerRecoveryOwner.bind(engine),
    answerRecoveryRead: engine.answerRecoveryRead.bind(engine),
    answerRecoveryRecord: engine.answerRecoveryRecord.bind(engine),
    answerRecoveryView: engine.answerRecoveryView.bind(engine),
    assertRestatementCustodyRetained: engine.assertRestatementCustodyRetained.bind(engine),
    attach: engine.attach.bind(engine),
    attachSafely: engine.attachSafely.bind(engine),
    backupCompleteOwner: engine.backupCompleteOwner.bind(engine),
    backupCopyTo: engine.backupCopyTo.bind(engine),
    backupHost: engine.backupHost.bind(engine),
    backupList: engine.backupList.bind(engine),
    backupView: engine.backupView.bind(engine),
    builtinActions: engine.builtinActions.bind(engine),
    closeVault: engine.closeVault.bind(engine),
    closingBackup: engine.closingBackup.bind(engine),
    companionAnswerText: engine.companionAnswerText.bind(engine),
    companionBriefs: engine.companionBriefs.bind(engine),
    companionConversation: engine.companionConversation.bind(engine),
    companionRuntime: engine.companionRuntime.bind(engine),
    computerSecret: engine.computerSecret.bind(engine),
    get context() { return engine.context; }, set context(value) { engine.context = value; },
    conversationContinuation: engine.conversationContinuation.bind(engine),
    copyBackupOut: engine.copyBackupOut.bind(engine),
    currentCard: engine.currentCard.bind(engine),
    currentWorkspaceOwner: engine.currentWorkspaceOwner.bind(engine),
    custodyFiles: engine.custodyFiles.bind(engine),
    custodyHost: engine.custodyHost.bind(engine),
    custodyNow: engine.custodyNow.bind(engine),
    custodySerial: engine.custodySerial.bind(engine),
    custodyView: engine.custodyView.bind(engine),
    driveBackupOut: engine.driveBackupOut.bind(engine),
    driveNote: engine.driveNote.bind(engine),
    driveOf: engine.driveOf.bind(engine),
    driveStatus: engine.driveStatus.bind(engine),
    existingComputerSecret: engine.existingComputerSecret.bind(engine),
    forgetBusiness: engine.forgetBusiness.bind(engine),
    forgetKeyIfUnused: engine.forgetKeyIfUnused.bind(engine),
    handleRequest: engine.handleRequest.bind(engine),
    importCopy: engine.importCopy.bind(engine),
    inspectManagedBackup: engine.inspectManagedBackup.bind(engine),
    interchangeOwner: engine.interchangeOwner.bind(engine),
    jobRunner: engine.jobRunner.bind(engine),
    journalPayload: engine.journalPayload.bind(engine),
    labelledBackups: engine.labelledBackups.bind(engine),
    legacyInternals: engine.legacyInternals.bind(engine),
    loadSchedule: engine.loadSchedule.bind(engine),
    makeRecoveryCode: engine.makeRecoveryCode.bind(engine),
    managedExports: engine.managedExports.bind(engine),
    migrationBackup: engine.migrationBackup.bind(engine),
    neverContactReset: engine.neverContactReset.bind(engine),
    noteLiveVersion: engine.noteLiveVersion.bind(engine),
    noteMigrated: engine.noteMigrated.bind(engine),
    notifyIdle: engine.notifyIdle.bind(engine),
    get options() { return engine.options; }, set options(value) { engine.options = value; },
    passphraseOff: engine.passphraseOff.bind(engine),
    passphraseOn: engine.passphraseOn.bind(engine),
    privatePromotionImpact: engine.privatePromotionImpact.bind(engine),
    privateRecipeEvidence: engine.privateRecipeEvidence.bind(engine),
    privateSearchAdapter: engine.privateSearchAdapter.bind(engine),
    promotePrivateTrial: engine.promotePrivateTrial.bind(engine),
    purgeManagedCopies: engine.purgeManagedCopies.bind(engine),
    removeEmptyFolder: engine.removeEmptyFolder.bind(engine),
    requestAs: engine.requestAs.bind(engine),
    requireAppOwner: engine.requireAppOwner.bind(engine),
    requireWorkspaceOwner: engine.requireWorkspaceOwner.bind(engine),
    resealManaged: engine.resealManaged.bind(engine),
    resetCustodySession: engine.resetCustodySession.bind(engine),
    resolveContinuationTurn: engine.resolveContinuationTurn.bind(engine),
    restoreFromCopy: engine.restoreFromCopy.bind(engine),
    restoreManagedBackup: engine.restoreManagedBackup.bind(engine),
    retainConversationAnswer: engine.retainConversationAnswer.bind(engine),
    safetyBackup: engine.safetyBackup.bind(engine),
    get services() { return engine.services; }, set services(value) { engine.services = value; },
    snapshotReads: engine.snapshotReads.bind(engine),
    snapshotStore: engine.snapshotStore.bind(engine),
    snapshotWanted: engine.snapshotWanted.bind(engine),
    storageKind: engine.storageKind.bind(engine),
    store: engine.store.bind(engine),
    storeComputerSecret: engine.storeComputerSecret.bind(engine),
    transferExport: engine.transferExport.bind(engine),
    transferImport: engine.transferImport.bind(engine),
    transferPeek: engine.transferPeek.bind(engine),
    undoLockChange: engine.undoLockChange.bind(engine),
    updateService: engine.updateService.bind(engine),
    get vault() { return engine.vault; }, set vault(value) { engine.vault = value; },
    get version() { return engine.version; },
    whatsNew: engine.whatsNew.bind(engine),
    withContext: engine.withContext.bind(engine),
    workbookBytes: engine.workbookBytes.bind(engine),
    workspacePath: engine.workspacePath.bind(engine),
    writeBackup: engine.writeBackup.bind(engine),
    writeSnapshot: engine.writeSnapshot.bind(engine),
    writerGuard: engine.writerGuard.bind(engine),
    }; })();

  options: EngineOptions;
  readonly version: string;
  vault: Vault | null = null;
  /** C5 task 24: the open business's Drive client. */
  #drive: { workspaceId: string; client: DriveBackup } | null = null;
  #baseContext: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  /** D5: how far Install Claude Code has come, and the one under way. */
  #claudeProgress: ClaudeInstallView = { step: 'idle', receivedBytes: 0, totalBytes: null, line: null };
  #claudeInstalling: Promise<ClaudeInstallResult> | null = null;
  #requestContext = new AsyncLocalStorage<Context>();
  #stagedVaults = new Set<Vault>();
  #transition = false;
  #activeRequests = 0;
  #capturing = false;
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
        ...(this.services.helper ? { helper: this.services.helper } : {}),
        work: { begin: (kind: WorkKind, steps: readonly string[]) => this.#work.begin(kind, steps, { businessId: '' }) },
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
  #ventureEventListeners = new Set<(event: VentureFrame) => void>();
  /** One-shot C3 task 9: which step long work is on. Its frames go to the same listeners and are never written anywhere. */
  #work = new WorkProgress(event => this.#publishVentureEvents([event]), () => this.options.venture?.clock?.() ?? new Date());
  /** Trusted host hook: hears each run event a venture action committed, and each step of long work. Returns the unsubscribe function. */
  onVentureEvent(listener: (event: VentureFrame) => void): () => void {
    this.#ventureEventListeners.add(listener);
    return () => { this.#ventureEventListeners.delete(listener); };
  }
  /** Work with no boundary inside it, as one step of long work. Opening and closing a vault happen in it, so its frames are the app's ('' business). */
  async #oneStep<T>(kind: WorkKind, step: string, run: () => Promise<T>): Promise<T> {
    const work = this.#work.begin(kind, [step], { businessId: '' });
    work.step(step, 'current');
    try {
      const answer = await run();
      work.step(step, 'done');
      return answer;
    } catch (error) {
      work.failCurrent();
      throw error;
    } finally {
      work.end();
    }
  }
  /** The open business as the screens name it; '' with none open (the draft desk's work). */
  #workBusiness(): string {
    try { return this.vault ? this.#ventureWorkspace.current().id : ''; } catch { return ''; }
  }
  #publishVentureEvents(events: VentureFrame[]) {
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
    // C5 task 22: the readable copies of the open business still on this computer; none on the hosted app.
    readableExports: async () => (this.options.venture?.host === 'hosted-web' || !this.vault ? [] : this.custodyFiles().readableExports(this.vault.read().workspace.id)),
    keepReadable: async (file: string) => { await this.custodyFiles().keepReadable(file); },
    deleteReadable: async (file: string) => { await this.custodyFiles().deleteReadable(file); },
    // C5 task 17: a file of the open business in Chausar's own exports folder, under its managed name, so Forget removes it.
    keepFile: async (tail: string, text: string) => {
      if (this.options.venture?.host === 'hosted-web' || !this.vault) return null;
      const name = `chausar-${this.vault.read().workspace.id}-${tail}`;
      check(MANAGED_COPY_TAIL.test(tail), 'INVALID_PATH', 'Chausar names these files itself.');
      const folder = await safeDirectory(resolve(this.options.directory, 'exports'), true);
      await atomicWriteText(join(folder, name), text, true);
      return name;
    },
    // The never-contact list the businesses on this computer share (C10), as keyed checks; nothing on the hosted app.
    neverContact: Object.freeze({
      has: async (values: readonly string[]) => this.snapshotStore()?.neverContactHas(values) ?? false,
      add: async (values: readonly string[]) => { await this.snapshotStore()?.neverContactAdd(values); },
    }),
  });
  /** A4 fix round: the newest AI setup on this computer (models/ai-setup.ts); none on the hosted app. */
  #aiSetup() {
    const venture = this.options.venture ?? {};
    return venture.host === 'hosted-web' ? null : venture.aiSetup ?? aiSetupFile(join(this.options.directory, 'custody', 'ai-setup.json'));
  }
  #ventureHost() {
    const vault = this.store();
    const pending = this.#venturePromise ??= this.#ventureModule().then(({ VentureHost }) => {
      check(this.vault === vault, 'VAULT_LOCKED', 'This business is closed. Open it first.');
      const venture = this.options.venture ?? {};
      const host = new VentureHost(vault, { calculator: this.services.calculator, ontology: this.services.ontology, trust: this.services.trust, helper: this.services.helper, speech: this.services.speech },
        { ...venture, demo: !!this.options.demo, storage: this.options.storage === 'postgres' ? 'postgres' : 'experimental-file',
          ...(venture.host === 'hosted-web' ? {} : { draft: this.#draftHandover, aiSetup: this.#aiSetup()!, cliLooks: cliLookFile(cliLookPath(this.options.directory)) }),
          workspace: venture.workspace ?? this.#ventureWorkspace,
          work: { begin: (kind: WorkKind, steps: readonly string[]) => this.#work.begin(kind, steps, { businessId: this.#workBusiness() }) },
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
  conversationContinuation(ctx: Context, id: string, view: StateStore = this.store(), resolvedByModelReceiptId?: string): ConversationContinuation { return conversation.conversationContinuation(this.#internals, ctx, id, view, resolvedByModelReceiptId); }
  private resolveContinuationTurn(ctx: Context, model: any, answerId: string, state: ReturnType<StateStore['read']>): void { return conversation.resolveContinuationTurn(this.#internals, ctx, model, answerId, state); }
  private async retainConversationAnswer(ctx: Context, question: string, answer: any, manifest?: BusinessContextManifest, modelReceiptId?: string): Promise<{ answer: any; record: any; }> { return conversation.retainConversationAnswer(this.#internals, ctx, question, answer, manifest, modelReceiptId); }
  private async executeConversationPlan(ctx: Context, request: any, gateway: Extract<Awaited<ReturnType<ModelGateway['execute']>>, { kind: 'conversation' }>): Promise<{ clarification: string; modelReceiptId: any; } | { id: `${string}_${string}-${string}-${string}-${string}-${string}`; kind: string; results: any[]; modelReceiptId: any; receipt: { id: `${string}_${string}-${string}-${string}-${string}-${string}`; kind: string; modelReceiptId: any; resultRefs: { tool: string; answerId: string; }[]; }; }> { return conversation.executeConversationPlan(this.#internals, ctx, request, gateway); }
  contextForSession(token: string, channel: Context['channel'] = 'desktop'): Context { return conversation.contextForSession(this.#internals, token, channel); }
  /** Fixed loopback companion host; authority comes only from the current encrypted workspace. */
  private companionRuntime(): { store: Vault; sessions: PhoneSessionService; runtime: EnginePhoneRuntime; } { return conversation.companionRuntime(this.#internals); }
  async handleCompanionHttp(request: IncomingMessage, response: ServerResponse): Promise<void> { return conversation.handleCompanionHttp(this.#internals, request, response); }
  /** Project already guarded local text and exact displayed figures; never synthesize a new answer. */
  private companionAnswerText(answer: any): string { return conversation.companionAnswerText(this.#internals, answer); }
  private companionConversation(ctx: Context, previewId: string, view: StateStore): ChatAnswer | undefined { return conversation.companionConversation(this.#internals, ctx, previewId, view); }
  private companionBriefs(ctx: Context, view: StateStore): Brief[] { return conversation.companionBriefs(this.#internals, ctx, view); }
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
    internalCheck(!authority?.vaultId || vault.vaultId === authority.vaultId, 'WORKSPACE_AUTHORITY_CHANGED', 'The actual Vault differs from the independently pinned launch identity.');
    return state.members.find(m => m.id === (authority?.ownerId ?? 'owner') && m.active && m.role === 'owner');
  }
  /** Local host launch only: a separately paired Engine/server, explicit fresh
   * credential on workspace.open, and no historical routes/session tokens. */
  async activatedWorkspaceEngine(context: Context, activationId: string): Promise<Engine> {
    const selected = await this.activationHost().inspectOpenTarget(context, activationId);
    return new Engine({directory: selected.directory, version: this.version, demo: true, storage: 'experimental-file',
      workspaceAuthority: {workspaceId: selected.workspaceId, ownerId: selected.ownerId, vaultId: selected.vaultId}});
  }
  private store(): Vault { check(this.vault, 'VAULT_LOCKED', 'This business is closed. Open it first.'); return this.vault; }
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
    if (this.options.storage === 'experimental-file' && (this.options.demo || this.options.venture?.host === 'desktop')) {
      if (!this.options.vaultStorage) return 'experimental-file' as const;
      // A trusted host's own file store (the hosted server's capped one, 4J23); the same folder-name check first.
      this.workspacePath(folder);
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'experimental-file') { await adapter.close?.(); throw new InternalError('STORAGE_REQUIRED', 'Experimental file storage needs a file vault adapter.'); }
      return adapter;
    }
    if (this.options.storage === 'postgres' && this.options.vaultStorage) {
      this.workspacePath(folder); // the same folder-name check as the other storage paths
      const adapter = await this.options.vaultStorage(folder);
      if (adapter.kind !== 'postgres') { await adapter.close?.(); throw new InternalError('INVALID_POSTGRES_CONFIG', 'PostgreSQL storage needs a PostgreSQL vault adapter.'); }
      return adapter;
    }
    check(this.options.storage === 'postgres' && this.options.postgresUrl, 'DATABASE_REQUIRED', 'Use the desktop encrypted file store or configure PostgreSQL for this host.');
    const url = new URL(this.options.postgresUrl);
    check(url.protocol === 'postgresql:' || url.protocol === 'postgres:', 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
    return PostgresSnapshotAdapter.connect({ host: url.hostname.replace(/^\[|\]$/g, '') as '127.0.0.1' | '::1', port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), vaultSlot: hash(this.workspacePath(folder)) });
  }
  private workspacePath(name = 'main') {
    check(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name), 'INVALID_PATH', 'Use a short workspace folder name without path separators.');
    const path = resolve(this.options.directory, name); const rel = relative(this.options.directory, path);
    check(!rel.startsWith('..') && !isAbsolute(rel), 'INVALID_PATH', 'That place is outside this business\'s folder.'); return path;
  }
  private async attach(vault: Vault): Promise<void> { return services.attach(this.#internals, vault); }
  private builtinActions(store: StateStore): any { return services.builtinActions(this.#internals, store); }
  async close() {
    if (this.#activeRequests && !this.#transition) await this.stopLongWork();
    check(!this.#capturing && !this.#activeRequests && !this.#transition, 'VAULT_BUSY', 'Chausar is still finishing work in this business. Try again in a moment.');
    await this.closeVault();
  }
  private async closeVault() {
    // The business's summary for the others on this computer, written again on lock (4J6). Never throws. Only awaited
    // when there is one to write, and the alerts only when a venture host is open: with nothing to do, closing marks the
    // vault closed in the same turn, so a read after close() is refused at once (sync-engine's drain tests).
    if (this.snapshotWanted(true)) await this.writeSnapshot(true);
    // Phone alerts under way finish first, for 12 s at most (4G3).
    if (this.#venture) await this.#venture.settle().catch(() => {});
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
      'Private search needs its own database on this computer, and it isn\'t set up.');
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
    internalCheck(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded engine shutdown deadline.');
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
  /**
   * D12 task 4: a business from an older Chausar. The file as it was goes to a migration backup first, then the one commit of
   * the brought-up State, a diagnostics line and the data-version index. A failure leaves the file as it was.
   */
  private async migrationBackup(json: string, workspaceId: string, from: number): Promise<string> {
    const files = this.custodyFiles(), folder = await safeDirectory(files.backups, true);
    let at = this.custodyNow(), name = backupName(workspaceId, at, 'migration');
    for (const taken = new Set((await readdir(folder)).map(item => item.toLowerCase())); taken.has(name.toLowerCase()); name = backupName(workspaceId, ++at, 'migration'));
    await atomicWriteText(join(folder, name), `{"backupFormat":"chausar.backup.v1","envelope":${json}}`, true);
    await files.noteDataVersion({ file: { name, version: from } });
    return name;
  }
  private async settleMigration(vault: Vault) {
    const from = vault.migratedFrom; if (from === null) return;
    let backup = '';
    const { to } = await vault.commitMigration(async (json, workspaceId) => { backup = await this.migrationBackup(json, workspaceId, from); });
    await this.noteMigrated(vault, from, to, backup);
  }
  private async noteMigrated(vault: Vault, from: number, to: number, backup: string) {
    const files = this.custodyFiles(), state = vault.read();
    await files.noteDiagnostic('migration', `${from}-to-${to}`, { code: 'DATA_BROUGHT_UP' }, new Date(this.custodyNow()).toISOString());
    await files.noteDataVersion({ live: { folder: basename(vault.directory), entry: { version: to, workspaceId: state.workspace.id, migratedBy: String(this.options.version ?? ''), from, backup } } });
  }
  private async attachSafely(vault: Vault) { try {
    // D12: before anything else can write. A read-only device leaves it to the writer: every write there waits anyway.
    if (this.options.sync === undefined) await this.settleMigration(vault);
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
  /**
   * A2: venture.ai.setup.trust { cli: 'codex', sha256 }: keeps the owner's choice of the Codex they were shown, only for
   * that exact program, in the app and by an owner. The host's Codex trust (codex-trust.ts) checks and records it.
   * A2 second review: only the owner's click in the desktop main process's own dialog approves a Codex. As a request
   * (the window, the local server's bootstrap session, a phone, MCP) it is always refused; main reads the held review
   * (codexChoiceFor), asks the owner, and on "Use this Codex" confirms over the worker's host channel, which no request
   * can write to (confirmCodexSetup).
   */
  #codexChoiceChecked(payload: unknown, confirm = false): { trust: { record(sha256: unknown, path: unknown): Promise<unknown>; held?(sha256: unknown): unknown; current?(): unknown }; sha256: string; path: string | null } {
    const context = this.context;
    check(context && context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
    // A2 review: only the owner says which program Chausar runs (AGENTS.md: the owner approves; a cofounder does not).
    check(context.role === 'owner', 'FORBIDDEN', 'Only the owner chooses which Codex Chausar runs.');
    // One-shot A3: main's confirmation names the path its dialog showed, so the yes records that copy of the program.
    const keys = confirm ? 'cli,path,sha256' : 'cli,sha256';
    const path = (payload as { path?: unknown } | null)?.path;
    check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).sort().join(',') === keys && (payload as { cli?: unknown }).cli === 'codex'
      && typeof (payload as { sha256?: unknown }).sha256 === 'string' && DIGEST_PATTERN.test((payload as { sha256: string }).sha256)
      && (!confirm || (typeof path === 'string' && path.length > 0 && path.length <= 4096)),
      'INVALID_VENTURE_REQUEST', 'Choose the Codex Chausar showed you.');
    const trust = this.options.venture?.codexCli as { record?: (sha256: unknown, path: unknown) => Promise<unknown>; held?(sha256: unknown): unknown; current?(): unknown } | undefined;
    check(this.options.venture?.host !== 'hosted-web' && trust && typeof trust.record === 'function', 'CODEX_SETUP_UNAVAILABLE', "Chausar can't keep a chosen Codex here.");
    return { trust: trust as { record(sha256: unknown, path: unknown): Promise<unknown> }, sha256: (payload as { sha256: string }).sha256, path: confirm ? path as string : null };
  }
  /**
   * A2 second review (main only, through the worker's host channel): what main's dialog names, from the engine's held
   * review of that exact program (its real path and version), or { inUse } when that program is already the Codex in
   * use (the owner's earlier choice, or the bundled Codex): the dialog is asked for once per program.
   */
  /**
   * D5 (main only, through the worker's host channel): the owner pressed yes in main's own dialog, so the yes is made here,
   * fresh, and spent once by the install. A second press joins the one under way. Nothing here reads a payload.
   */
  installClaudeCodeFor(): Promise<ClaudeInstallResult> {
    const context = this.context, wired = this.options.claudeInstall;
    try {
      check(context && context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
      check(context.role === 'owner', 'FORBIDDEN', 'Only the owner installs Claude Code on this computer.');
      check(wired?.host === 'desktop', 'TIER_UNAVAILABLE', CLAUDE_INSTALL_WORDS.hosted);
    } catch (error) { return Promise.reject(error); }
    return this.#claudeInstalling ??= (async () => {
      this.#claudeProgress = { step: 'idle', receivedBytes: 0, totalBytes: null, line: null };
      const note = (progress: ClaudeInstallProgress) => { this.#claudeProgress = { step: progress.step, receivedBytes: progress.receivedBytes ?? this.#claudeProgress.receivedBytes, totalBytes: progress.totalBytes === undefined ? this.#claudeProgress.totalBytes : progress.totalBytes, line: null }; };
      try {
        const result = await installClaudeCode({ approval: mintClaudeInstallYes(), platform: wired!.platform ?? process.platform, host: wired!.host, ...(wired!.environment ? { environment: wired!.environment } : {}) }, wired!.ports, note);
        this.#claudeProgress = { ...this.#claudeProgress, step: 'done', line: result.words };
        if (result.path) wired!.onFound?.(result.path);
        return result;
      } catch (error) {
        this.#claudeProgress = { ...this.#claudeProgress, step: 'failed', line: null };
        throw error;
      } finally { this.#claudeInstalling = null; }
    })();
  }
  async codexChoiceFor(payload: unknown): Promise<{ path: string; version: string } | { inUse: unknown }> {
    const { trust, sha256 } = this.#codexChoiceChecked(payload);
    const current = typeof trust.current === 'function' ? trust.current() as { sha256?: unknown } | null : null;
    if (current && current.sha256 === sha256) return { inUse: current };
    const held = typeof trust.held === 'function' ? trust.held(sha256) as { path?: unknown; version?: unknown } | null : null;
    check(held && typeof held.path === 'string' && typeof held.version === 'string', 'CODEX_SETUP_CHANGED', 'That Codex changed since you looked at it. Check it again.');
    return { path: held.path as string, version: held.version as string };
  }
  /** A2 second review (main only, after the owner clicked "Use this Codex" in main's dialog): records the choice. */
  async confirmCodexSetup(payload: unknown): Promise<{ setup: unknown }> {
    check(!this.#closing, 'ENGINE_STOPPING', 'Chausar is finishing its work and closing. Open it again in a moment.');
    check(!this.#transition, 'VAULT_BUSY', 'A workspace operation is in progress. Wait for it to finish.');
    this.#activeRequests++;
    try {
      const { trust, sha256, path } = this.#codexChoiceChecked(payload, true);
      return { setup: await trust.record(sha256, path) };
    } finally { this.#activeRequests--; this.notifyIdle(); }
  }
  /** Developer capability, never an RPC method. Each capture needs explicit sample-data consent. */
  async captureDraftState(state?: State): Promise<State> {
    check(this.options.capture && this.options.demo && this.vault && isCaptureSample(this.vault), 'CAPTURE_SAMPLE_REQUIRED', 'Use a newly created disposable sample workspace.');
    return (await this.#draftDesk()).sampleState(this.vault!, state);
  }

  async captureRequest(method: string, payload: Record<string, unknown>, consent: string): Promise<{ result: unknown; path: string }> {
    check(this.options.capture, 'CAPTURE_DISABLED', 'Run capture is not enabled.');
    check(consent === 'sample business' && this.options.demo === true && !!this.vault && isCaptureSample(this.vault),
      'CAPTURE_SAMPLE_REQUIRED', 'Capture only a sample business with explicit consent.');
    check(!this.#capturing && !this.#activeRequests && !this.#transition, 'VAULT_BUSY', 'Finish the current request before capturing.');
    this.#capturing = true;
    try {
      const { captureEngineRequest } = await import('./venture/replay/engine-run.ts');
      return await captureEngineRequest(this, method, payload, this.options.capture.dir);
    } finally { this.#capturing = false; }
  }
  async request(method: string, payload: any = {}): Promise<any> {
    check(!this.#capturing || currentRun()?.owner === this, 'VAULT_BUSY', 'Finish the sample capture before another request.');
    check(!this.#closing, 'ENGINE_STOPPING', 'Chausar is finishing its work and closing. Open it again in a moment.');
    const transitions = new Set(['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.delete', 'workspace.transfer.import', 'workspace.backups.restore', 'workspace.import']);
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
  /** C7: whatsNew.get {} answers { version, seen }; whatsNew.seen { version } marks the running version seen. */
  private async whatsNew(method: 'whatsNew.get' | 'whatsNew.seen', payload: Record<string, unknown>): Promise<{ version: string; seen: boolean }> {
    const { markSeen, whatsNewState } = await import('./whats-new-file.ts');
    const custody = join(this.options.directory, 'custody');
    if (method === 'whatsNew.seen') {
      check(Object.keys(payload).length === 1 && payload.version === this.version, 'INVALID_REQUEST', 'Mark the version Chausar is running.');
      await markSeen(custody, this.version);
      return { version: this.version, seen: true };
    }
    check(Object.keys(payload).length === 0, 'INVALID_REQUEST', 'Send an empty request.');
    let hasBusiness = !!this.vault;
    if (!hasBusiness) { try { hasBusiness = (await this.custodyFiles().listBusinesses(this.storageKind())).businesses.length > 0; } catch { hasBusiness = false; } }
    return whatsNewState(custody, this.version, { hasBusiness });
  }
  private legacyInternals(store: Vault, context: Context, services: Engine['services']): LegacyInternals {
    return {
      store, context, services,
      journalPayload: this.journalPayload.bind(this),
      privateRestatementContext: this.privateRestatementContext.bind(this),
      companionRuntime: this.companionRuntime.bind(this),
      writerStatus: this.writerStatus.bind(this),
      writerConfiguration: this.writerConfiguration.bind(this),
      workspacePath: this.workspacePath.bind(this),
      adapter: this.adapter.bind(this),
      visibleImports: this.visibleImports.bind(this),
      visibleActivity: this.visibleActivity.bind(this),
      executeConversationPlan: this.executeConversationPlan.bind(this),
      retainConversationAnswer: this.retainConversationAnswer.bind(this),
      purgeManagedCopies: this.purgeManagedCopies.bind(this),
      answerRecoveryEvidence: this.answerRecoveryEvidence.bind(this),
      answerRecoveryView: this.answerRecoveryView.bind(this),
      answerRecoveryCalculator: this.answerRecoveryCalculator.bind(this),
      answerRecoveryRead: this.answerRecoveryRead.bind(this),
      executeAnswerRecovery: this.executeAnswerRecovery.bind(this),
      workbookBytes: this.workbookBytes.bind(this),
      workbookInput: this.workbookInput.bind(this),
      journalWriter: this.journalWriter.bind(this),
      journalRevision: this.journalRevision.bind(this),
      createBriefJob: this.createBriefJob.bind(this),
      jobRunner: this.jobRunner.bind(this),
      typedJob: this.typedJob.bind(this),
      runJob: this.runJob.bind(this),
      openUnlock: this.#openUnlock, stageVault: vault => { this.#stagedVaults.add(vault); },
      jobLifecycle: this.#jobLifecycle, recordIntegrity: answerRecoveryRecordIntegrity,
    };
  }
  private async handleRequest(method: string, payload: any = {}): Promise<any> {
check(typeof method === 'string' && method.length <= 80 && payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_REQUEST', 'Use a named request with an object payload.');
return (ENGINE_HANDLERS[method] ?? unknownRequest(method))(this.#internals, payload);
}
  private async runJob(id: string): Promise<any> { return legacy_operations.runJob(this.#internals, id); }
  private answerRecoveryOwner(ctx: Context, view: StateStore): void { return legacy_operations.answerRecoveryOwner(this.#internals, ctx, view); }
  private answerRecoveryView(state: State): StateStore { return legacy_operations.answerRecoveryView(this.#internals, state); }
  private answerRecoveryCalculator(view: StateStore): CalculatorService { return legacy_operations.answerRecoveryCalculator(this.#internals, view); }
  private answerRecoveryEvidence(ctx: Context, answerId: unknown, view: StateStore): { evidence: AnswerRecoveryEvidence; evidencePin: string; dictionary: { hash: string; version: number; }; } { return legacy_operations.answerRecoveryEvidence(this.#internals, ctx, answerId, view); }
  private answerRecoveryRecord(ctx: Context, newRequestId: unknown, view: StateStore): { record: AnswerRecoveryRecord; resolved: { evidence: AnswerRecoveryEvidence; evidencePin: string; dictionary: { hash: string; version: number; }; }; } { return legacy_operations.answerRecoveryRecord(this.#internals, ctx, newRequestId, view); }
  private answerRecoveryRead(ctx: Context, newRequestId: unknown): { status: string; requiresReopen: boolean; message: string; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; preparation: PreparedAnswerRecovery; dictionary: { hash: string; version: number; }; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; lineage: CompletedAnswerRecovery; answer: { id: any; receiptId: any; request: any; }; receipt: CalculationReceipt; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } { return legacy_operations.answerRecoveryRead(this.#internals, ctx, newRequestId); }
  private async executeAnswerRecovery(ctx: Context, newRequestId: unknown, preparationDigest: unknown): Promise<{ status: string; requiresReopen: boolean; message: string; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; preparation: PreparedAnswerRecovery; dictionary: { hash: string; version: number; }; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; lineage: CompletedAnswerRecovery; answer: { id: any; receiptId: any; request: any; }; receipt: CalculationReceipt; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; }> { return legacy_operations.executeAnswerRecovery(this.#internals, ctx, newRequestId, preparationDigest); }
  private journalPayload(value: unknown, allowed: readonly string[], required: readonly string[], code: string): Record<string, unknown> { return legacy_operations.journalPayload(this.#internals, value, allowed, required, code); }
  private journalWriter(ctx: Context): void { return legacy_operations.journalWriter(this.#internals, ctx); }
  private journalRevision(value: unknown): asserts value is number { return legacy_operations.journalRevision(this.#internals, value); }
  private workbookBytes(payload: any): Uint8Array { return legacy_operations.workbookBytes(this.#internals, payload); }
  private workbookInput(payload: any): { expectedTotals?: any; recipe?: any; sourceId: any; format: "csv"; content: string; } { return legacy_operations.workbookInput(this.#internals, payload); }
  private visibleImports(): any[] { return legacy_operations.visibleImports(this.#internals); }
  private privateRecipeEvidence(ctx: Context, sourceId: string): PrivateTrialRecipeEvidence { return legacy_operations.privateRecipeEvidence(this.#internals, ctx, sourceId); }
  private interchangeOwner(ctx: Context, historical: State): void { return legacy_operations.interchangeOwner(this.#internals, ctx, historical); }
  private backupHost(): WorkspaceBackupV2Host { return legacy_operations.backupHost(this.#internals); }
  private activationHost(): EngineWorkspaceActivation { return legacy_operations.activationHost(this.#internals); }
  private backupCompleteOwner(ctx: Context, historical: State): void { return legacy_operations.backupCompleteOwner(this.#internals, ctx, historical); }
  private privatePromotionImpact(ctx: Context, state = this.store().read(), strategy?: 'prospective' | 'retrospective'): { complete: true; affectedArtifactIds: string[]; rebuildArtifactIds: string[]; activeWorkIds: string[]; } { return legacy_operations.privatePromotionImpact(this.#internals, ctx, state, strategy); }
  private async promotePrivateTrial(ctx: Context, publication: PrivateTrialAtomicPublication): Promise<{ publicationId: string }> { return legacy_operations.promotePrivateTrial(this.#internals, ctx, publication); }
  private async privateRestatementContext(ctx: Context, receiptId: unknown): Promise<{ receiptId: string; interpretation: any; originalReceipt: any; forkDigest: string; candidatePin: import("./private-trial-contracts.ts").PrivateTrialVersionPin; change: import("./private-trial-contracts.ts").PrivateTrialChange; rows: any; }> { return legacy_operations.privateRestatementContext(this.#internals, ctx, receiptId); }
  private assertRestatementCustodyRetained(receiptId: string): void { return legacy_operations.assertRestatementCustodyRetained(this.#internals, receiptId); }
  private visibleActivity(ctx: Context): any[] { return legacy_operations.visibleActivity(this.#internals, ctx); }
  /**
   * One-shot A1 (row 1): the copies in Chausar's exports folder of this business. Delete keeps them (the owner exported
   * them to keep); Forget and a source delete still remove them, because they hold what was forgotten.
   */
  private async managedExports(): Promise<string[]> { return custody.managedExports(this.#internals); }
  private async purgeManagedCopies(folders: readonly ('backups' | 'exports')[] = ['backups', 'exports']): Promise<string[]> { return custody.purgeManagedCopies(this.#internals, folders); }
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
  private custodyHost(): { files: CustodyFiles; keys: DeviceKeyStore; autoBackups: boolean; clock: () => number; } | null { return custody.custodyHost(this.#internals); }
  private custodyFiles(): CustodyFiles { return custody.custodyFiles(this.#internals); }
  private custodyNow(): number { return custody.custodyNow(this.#internals); }
  private storageKind(): 'experimental-file' | 'postgres' { return custody.storageKind(this.#internals); }
  /** One custody change, backup write, rotation or reseal at a time. */
  private custodySerial<T>(work: () => Promise<T>): Promise<T> { return custody.custodySerial(this.#internals, work); }
  private resetCustodySession(): void { return custody.resetCustodySession(this.#internals); }
  // ------------------------------------------------------------ business snapshots (Ink v2 wave 4, 4J6)
  // What the other businesses on this computer may know about one that is closed (workspace-snapshots.ts): written at
  // most once a minute while it changes and again on lock, only for a business that opens with this computer.
  #snapshots: WorkspaceSnapshots | null = null;
  #snapshotMark: { at: number | null; revision: number | null } = { at: null, revision: null };
  /** The summaries and the never-contact list on this computer; null on the hosted app or without custody. */
  private snapshotStore(): WorkspaceSnapshots | null { return custody.snapshotStore(this.#internals); }
  /** The other businesses as their summaries read, the open one left out; a passphrase one is never read. Never throws. */
  private async snapshotReads(): Promise<BusinessSnapshotRead[]> { return custody.snapshotReads(this.#internals); }
  /**
   * workspace.custody.neverContactReset { confirmation } (4J6): the owner's explicit step to start a new never-contact
   * list, only while the old one can no longer be checked (NEVER_CONTACT_LOST; one that still checks is NEVER_CONTACT_OK).
   * The caller has passed requireAppOwner, so a business is open; confirmation is its name. Refused on the hosted app.
   * The open business adds its own blocklist again at once, the others when next opened; people forgotten elsewhere
   * can't be put back. Journalled in the audit.
   */
  private async neverContactReset(payload: any): Promise<{ line: string }> { return custody.neverContactReset(this.#internals, payload); }
  /** At a tick: the open business's summary, when one is due. Never throws. */
  private async snapshotTick(): Promise<void> { return custody.snapshotTick(this.#internals); }
  /**
   * The open business's summary when due, or on lock: written only for a business that opens with this computer; one
   * that needs a passphrase has its summary taken away. Either way the addresses its own blocklist keeps out join the
   * never-contact list, as keyed checks. Never throws: the next tick or lock tries again.
   */
  /** Whether a summary is due now: a store, an open venture business, and snapshotDue. Synchronous; never throws. */
  private snapshotWanted(lock: boolean): boolean { return custody.snapshotWanted(this.#internals, lock); }
  private async writeSnapshot(lock: boolean): Promise<void> { return custody.writeSnapshot(this.#internals, lock); }
  private requireAppOwner(ctx: Context): void { return custody.requireAppOwner(this.#internals, ctx); }
  /** The secret this computer keeps for a vault. PASSPHRASE_REQUIRED with no key record; DEVICE_KEY_FAILED when the OS refuses. */
  private async computerSecret(vaultId: string | null): Promise<string> { return custody.computerSecret(this.#internals, vaultId); }
  /** The secret another folder of the same vault already uses, so both keep opening; null when there is none. */
  private async existingComputerSecret(vaultId: string): Promise<string | null> { return custody.existingComputerSecret(this.#internals, vaultId); }
  private async storeComputerSecret(vault: Vault, secret: Buffer): Promise<void> { return custody.storeComputerSecret(this.#internals, vault, secret); }
  /** Forget this computer's key for a vault unless another business folder still opens with it. */
  private async forgetKeyIfUnused(vaultId: string, folder: string | null): Promise<void> { return custody.forgetKeyIfUnused(this.#internals, vaultId, folder); }
  private async currentCard(): Promise<VaultCard> { return custody.currentCard(this.#internals); }
  /** After a vault opens: remember how, write or refresh its card, finish an interrupted custody change. */
  private async afterOpen(folder: string, how: 'this-computer' | 'typed', options: { recovery?: RecoveryState; reseal?: boolean; created?: boolean } = {}): Promise<void> { return custody.afterOpen(this.#internals, folder, how, options); }
  /** D12: what the open business's live file holds, for a closed business's count at the next update. Keeps who moved it. */
  private async noteLiveVersion(folder: string): Promise<void> { return custody.noteLiveVersion(this.#internals, folder); }
  private async loadSchedule(): Promise<void> { return custody.loadSchedule(this.#internals); }
  /** Re-seal this vault's managed backups and encrypted exports with the live wrappers (KEYCHAIN-SPEC 4.4). Skipped when
   * this folder opens with this computer and another folder of the same vault is locked with a passphrase: the backups
   * are shared by workspace id, and resealing them would quietly undo that passphrase. */
  private async resealManaged(): Promise<{ resealed: string[]; skipped: { path: string; reason: string; }[]; }> { return custody.resealManaged(this.#internals); }
  private async backupView(name: string): Promise<BackupView> { return custody.backupView(this.#internals, name); }
  /** Writes one managed backup (ciphertext only) and, for automatic and safety copies, applies the rotation. */
  private async writeBackup(kind: BackupKind): Promise<BackupView> { return custody.writeBackup(this.#internals, kind); }
  /** C5 task 23: sets or clears the drive or folder automatic backups are copied to, and copies the newest now. Main asks this after its own folder pick. */
  private async backupCopyTo(payload: any): Promise<{ copy: BackupCopyView | null }> { return custody.backupCopyTo(this.#internals, payload); }
  /** C5 task 24: the open business's Drive client. Its refresh token stays in the credential store, under this business. */
  private driveOf(): DriveBackup { return custody.driveOf(this.#internals); }
  private async driveStatus(): Promise<DriveStatus> { return custody.driveStatus(this.#internals); }
  /** What the card remembers about Drive: the last file and when, or the problem. Never a token. */
  private async driveNote(note: NonNullable<VaultCard['drive']> | null): Promise<void> { return custody.driveNote(this.#internals, note); }
  /** C5 task 24: the newest backup to Drive, when Drive is connected and hasn't got it. Never throws: a problem is said on the card. */
  private async driveBackupOut(): Promise<void> { return custody.driveBackupOut(this.#internals); }
  /** C5 task 23: the newest backup to the owner's folder, when it isn't there yet. Never throws: a problem is said on the card, and the next tick tries again. */
  private async copyBackupOut(): Promise<void> { return custody.copyBackupOut(this.#internals); }
  /** A safety copy before a lock change. Best effort, except with no recovery code yet: then it is the only way back
   * if the change is cut short, so the change is refused (SAFETY_BACKUP_FAILED) and nothing changes. */
  private async safetyBackup(required = false): Promise<BackupView | null> { return custody.safetyBackup(this.#internals, required); }
  /** Puts a lock change that failed partway back the way it was, with the secret the vault opened with before.
   * When even that fails, the card keeps its marker and the next open tries both ways in. Never throws. */
  private async undoLockChange(card: VaultCard, secret: string | null, made: DeviceKeyRecord | null): Promise<void> { return custody.undoLockChange(this.#internals, card, secret, made); }
  /** At a tick: an automatic backup when one is due (KEYCHAIN-SPEC 4.1). Never throws. */
  private async backupTick(): Promise<void> { return custody.backupTick(this.#internals); }
  /** Closing: back up first when the business changed since its last backup. Best effort, never blocks closing. */
  private async closingBackup(): Promise<void> { return custody.closingBackup(this.#internals); }
  private async custodyView(): Promise<CustodyView> { return custody.custodyView(this.#internals); }
  private async backupList(): Promise<{ backups: BackupView[]; more: boolean; }> { return custody.backupList(this.#internals); }
  /** C5 task 20: each backup with what came just before it, read from the open vault. A label that can't be worked out is left off. */
  private async labelledBackups(backups: BackupView[]): Promise<BackupView[]> { return custody.labelledBackups(this.#internals, backups); }
  private async passphraseOn(payload: any): Promise<{ custody: CustodyView; recoveryCode: string | null; }> { return custody.passphraseOn(this.#internals, payload); }
  private async passphraseOff(payload: any): Promise<{ custody: CustodyView; }> { return custody.passphraseOff(this.#internals, payload); }
  private async makeRecoveryCode(payload: any): Promise<{ custody: CustodyView; recoveryCode: string; }> { return custody.makeRecoveryCode(this.#internals, payload); }
  /**
   * One-shot C6 (section 9 idea 25): what a backup of the open business holds and what restoring it would take back.
   * The same checks as a restore; the backup's state is decoded in memory only and never written. The open business
   * only, so no business words ever sit outside its vault.
   */
  private async inspectManagedBackup(payload: any): Promise<BackupInspectView> { return custody.inspectManagedBackup(this.#internals, payload); }
  private async restoreManagedBackup(payload: any): Promise<{ workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string; }; restoredFrom: BackupView; safety: BackupView; }> { return custody.restoreManagedBackup(this.#internals, payload); }
  private async transferExport(payload: any): Promise<{ dismissed: boolean; fileName?: undefined; text?: undefined; transferCode?: undefined; bytes?: undefined; } | { fileName: string; text: string; transferCode: string; bytes: number; dismissed?: undefined; }> { return custody.transferExport(this.#internals, payload); }
  /**
   * C4 task 38 (223.x1): the business name and the time a move file was made, read with its code before "Move it here".
   * Vault-less and quiet: the file's header is opened in memory only and nothing is written. A wrong code gets exactly
   * the refusal the import gives, so a peek never helps a guess.
   */
  private async transferPeek(payload: any): Promise<{ name: string; movedOutAt: string | null; }> { return custody.transferPeek(this.#internals, payload); }
  private async transferImport(payload: any): Promise<{ workspace: { id: string; name: string; currency: string; demo: boolean; createdAt: string; }; folder: string; unlock: string; }> { return custody.transferImport(this.#internals, payload); }
  /**
   * C5 task 21: workspace.import { file, passphrase?, recoveryCode?, restore? }. The desktop's main process asks it after its
   * own file pick, so no window ever names a path. The encrypted export is the backup format. A business not on this computer
   * opens as a new one with its passphrase or recovery code; one already here answers IMPORT_ALREADY_HERE, and with restore
   * goes through the restore path, opening it first when it is closed and making a safety copy first. A readable copy is
   * refused: nothing proves it wasn't changed.
   */
  private async importCopy(payload: any): Promise<CopyImportResult> { return custody.importCopy(this.#internals, payload); }
  /** The open business from an exported copy of itself, with a safety copy first, as a backup's restore does. */
  private async restoreFromCopy(file: string): Promise<CopyImportResult> { return custody.restoreFromCopy(this.#internals, file); }
  /** One-shot A4: removes a deleted business's folder when it holds nothing (never recursive); else leaves it. Never throws. */
  private async removeEmptyFolder(path: string): Promise<void> { return custody.removeEmptyFolder(this.#internals, path); }
  private async forgetBusiness(folder: string | null, vaultId: string): Promise<void> { return custody.forgetBusiness(this.#internals, folder, vaultId); }
  private requireWorkspaceOwner(ctx: Context): void { return custody.requireWorkspaceOwner(this.#internals, ctx); }
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
  /** C5 task 31: one for the engine's life, so its ten quiet minutes count from the start. */
  #updates: UpdateService | null = null;
  private updateService(): UpdateService {
    return this.#updates ??= new UpdateService({ publicKey: this.options.updatePublicKey ?? null, feedUrl: null, directory: resolve(this.options.directory, 'updates'), channel: 'stable', windowsCertificateThumbprint: null, ...this.options.updates, version: this.version, isBusy: () => this.updatesBusy() });
  }
  /**
   * C5 task 32, trusted main-process route only, at quit: is a run busy, the open data's version, and the safety copy of the
   * open business while its vault is still open (D12 attach points 1 and 2). A failed copy is said; main then installs nothing.
   */
  async prepareUpdateInstall(payload: { backup?: unknown }): Promise<{ busy: boolean; openDataSchema: number | null; backup: 'made' | 'failed' | 'none-open' | 'skipped' }> {
    // D12 task 8: the newest data on this computer, a closed business's too, not only the open one's.
    const busy = this.updatesBusy(), liveNow = this.vault ? this.vault.read().schemaVersion : null, noted = this.custodyHost() ? await this.custodyFiles().newestDataVersion() : null;
    const open = liveNow === null && noted === null ? null : Math.max(liveNow ?? 0, noted ?? 0);
    if (busy || payload?.backup !== true) return { busy, openDataSchema: open, backup: 'skipped' };
    if (!this.vault) return { busy, openDataSchema: open, backup: 'none-open' };
    return { busy, openDataSchema: open, backup: await this.custodySerial(() => this.safetyBackup()) ? 'made' : 'failed' };
  }
  /** A run is busy: a request is being answered, a job is running, or an owner's-AI job has a tool running. */
  private updatesBusy(): boolean {
    if (this.#activeRequests > 0 || this.#transition) return true;
    const state = this.vault?.read();
    if (!state) return false;
    return state.jobs.some((job: Job) => job.status === 'running') || (state.conversations as { kind?: string; agentJob?: { tools?: { status: string }[] } }[]).some(record => record?.kind === 'venture-delivery-run' && record.agentJob?.tools?.some(tool => tool.status === 'running'));
  }
  async tick() {
    if (!this.#closing) void this.updateService().tick().catch(() => {});
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
