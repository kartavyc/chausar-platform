import { resolve, join, relative, isAbsolute } from 'node:path';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Vault } from './vault.ts';
import { PostgresSnapshotAdapter } from './postgres.ts';
import { OntologyService } from './ontology.ts';
import { ImportService, seedDemo } from './ingest.ts';
import { MemoryService } from './memory.ts';
import { canSeeFact } from './memory.ts';
import { CalculatorService, type CalculatorOptions } from './calculator.ts';
import { ReportService, type ReportOptions } from './reports.ts';
import { createJournalExecutionResolver } from './journal-execution.ts';
import { TrustService, sourceAllowed } from './trust.ts';
import { ModelGateway } from './gateway.ts';
import type { GatewayOptions } from './gateway.ts';
import { conversationPurpose } from './conversation-purpose.ts';
import { buildBusinessContext, assertBusinessContextCurrent, renderBusinessAnswer, BusinessProfileService, type BusinessContextHooks, type BusinessContextManifest } from './conversation-context.ts';
import { SpeechService } from './speech.ts';
import { AuthService } from './auth.ts';
import { SyncService, type SyncOptions } from './sync.ts';
import { ActionService } from './actions.ts';
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
import { readWorkbook, workbookSheetToCSV } from './workbook.ts';
import { DatabaseCalculator, type DatabaseCalculatorOptions } from './analytics.ts';
import { AnalyticalHelper } from './helper.ts';
import { ReleaseUpdater, compareVersions } from './updater.ts';
import { authorize, audit, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';

export type EngineOptions = { directory: string; version?: string; demo?: boolean; storage?: 'experimental-file' | 'postgres'; postgresUrl?: string; connectorCredentials?: CredentialBroker; connectorRuntime?: EngineConnectorOptions; analytics?: DatabaseCalculatorOptions; sync?: SyncOptions; pythonExecutable?: string; updatePublicKey?: string; durableJobs?: EngineJobOptions; gateway?: GatewayOptions; reports?: Pick<ReportOptions, 'executionReceipt'>; jobCalendar?: { rules: CalendarRules; bounds: CalendarBounds } };

/** The sole product authority. The renderer receives named, bounded results only. */
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
  #idleWaiters = new Set<() => void>();
  // Unknown host state is closed to scheduled dispatch. Only a trusted host sets it.
  #jobLifecycle: JobLifecycle = { awake: false, windowOpen: false, backgroundEnabled: false };
  get context(): Context { return this.#requestContext.getStore() || this.#baseContext; }
  set context(value: Context) { this.#baseContext = { ...value }; }
  services: Record<string, any> = {};
  constructor(options: EngineOptions) { this.version = options.version ?? '0.1.0-preview.1'; compareVersions(this.version, this.version); this.options = { ...options, directory: resolve(options.directory) }; }
  contextForSession(token: string, channel: Context['channel'] = 'desktop'): Context { this.store(); return this.services.auth.authenticate(token, channel); }
  async withContext<T>(context: Context, work: () => T | Promise<T>): Promise<T> {
    const scoped = Object.freeze({ ...context }); if (this.vault) authorize(this.vault, scoped);
    return this.#requestContext.run(scoped, async () => await work());
  }
  async requestAs(context: Context, method: string, payload: any = {}): Promise<any> { return this.withContext(context, () => this.request(method, payload)); }
  bootstrapContext(): Context {
    if (!this.vault) return { ...this.#baseContext };
    const member = this.vault.read().members.find(m => m.id === 'owner' && m.active && m.role === 'owner');
    check(member, 'OWNER_REQUIRED', 'The local workspace owner is no longer available.'); return { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  }
  private store(): Vault { check(this.vault, 'VAULT_LOCKED', 'Open your workspace first.'); return this.vault; }
  private async adapter(folder = 'main') {
    if (this.options.storage === 'experimental-file' && this.options.demo) return 'experimental-file' as const;
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
  private attach(vault: Vault) {
    this.vault = vault; const owner = vault.read().members.find(m => m.id === 'owner' && m.active && m.role === 'owner');
    check(owner, 'OWNER_REQUIRED', 'No current owner is available for this vault.');
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
    // Execution resolution is a trusted host port, never a route or RPC setting.
    this.services.reports = new ReportService(store, { ...calculationOptions, executionReceipt: (ctx, id, view) => {
      const resolver = this.options.reports?.executionReceipt ?? createJournalExecutionResolver(this.services.actions);
      return resolver(ctx, id, view);
    } });
    this.services.connectors = new ConnectorService(store, { credentialBroker: this.options.connectorCredentials });
    this.services.helper = new AnalyticalHelper({ executable: this.options.pythonExecutable });
    if (this.options.updatePublicKey) this.services.updater = new ReleaseUpdater({ publicKey: this.options.updatePublicKey, version: this.version, stageDirectory: resolve(this.options.directory, 'updates') });
    this.services.trust = new TrustService(store);
    const businessContextHooks: BusinessContextHooks = { assertEvidenceReady: (ctx, refs) => {
      this.options.gateway?.businessContext?.assertEvidenceReady?.(ctx, refs);
      return connectorRuntime.assertBusinessEvidenceReady(ctx, refs);
    } };
    this.services.businessContextHooks = businessContextHooks;
    this.services.businessProfile = new BusinessProfileService(store);
    this.services.gateway = new ModelGateway(store, { ...this.options.gateway, businessContext: businessContextHooks });
    this.services.speech = new SpeechService(store);
    this.services.auth = new AuthService(store);
    this.services.sync = new SyncService(store, { ...this.options.sync, vault });
    this.services.actions = new ActionService(store, this.builtinActions(store));
    this.services.jobs = new JobService(store, { clock: this.options.durableJobs?.clock,
      calendarRules: this.options.jobCalendar?.rules, calendarBounds: this.options.jobCalendar?.bounds,
      deliverableGuard: (ctx: Context, job: any) => {
      if (!job.deliverable) return true;
      if (job.plan) return this.services.jobRunner?.canRelease(ctx, job) === true;
      const ids = job.deliverable.result?.receiptIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      try { ids.forEach((id: string) => this.services.calculator.receipt(ctx, id));
        const currentDecisions = new Set(this.services.reports.decisions(ctx).map((item: any) => item.id));
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
    check(!this.#activeRequests && !this.#transition, 'VAULT_BUSY', 'Drain pending engine requests before closing its authority.');
    await this.closeVault();
  }
  private async closeVault() {
    this.services.connectorRuntime?.close();
    this.services.gateway?.clearCredentials(); this.services.speech?.clearCredentials();
    for (const staged of this.#stagedVaults) await staged.close(); this.#stagedVaults.clear();
    if (this.vault) { await this.vault.close(); this.vault = null; this.services = {}; }
  }
  async shutdown(timeoutMs = 70000) {
    check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 75000, 'INVALID_SHUTDOWN_LIMIT', 'Use a bounded engine shutdown deadline.');
    this.#closing = true;
    this.services.connectorRuntime?.close();
    this.services.jobRunner?.interruptActive();
    if (this.#activeRequests || this.#transition) await new Promise<void>((accept, reject) => {
      const finished = () => { clearTimeout(timer); this.#idleWaiters.delete(finished); accept(); };
      const timer = setTimeout(() => { this.#idleWaiters.delete(finished); reject(new Error('Engine shutdown exceeded its deadline; unfinished actions require reconciliation.')); }, timeoutMs);
      this.#idleWaiters.add(finished);
    });
    await this.closeVault();
  }
  private notifyIdle() { if (!this.#activeRequests && !this.#transition) for (const finished of this.#idleWaiters) finished(); }
  private async attachSafely(vault: Vault) { try { this.attach(vault); await this.services.actions.recoverInterrupted(this.context); await this.services.jobRunner?.recoverInterrupted(this.context); } catch (error) { await vault.close(); this.vault = null; this.services = {}; throw error; } }
  async request(method: string, payload: any = {}): Promise<any> {
    check(!this.#closing, 'ENGINE_STOPPING', 'The engine is completing pending work before shutdown.');
    const transitions = new Set(['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore', 'workspace.lock', 'workspace.delete']);
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
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before creating another.');
      check(typeof payload.name === 'string' && payload.name.trim().length >= 2 && payload.name.length <= 100, 'INVALID_NAME', 'Give your business a name.');
      const pack = payload.pack ?? 'ecommerce'; check(new OntologyService({ read: () => { throw new Error('No vault'); }, update: async () => { throw new Error('No vault'); } }).packs().some(p => p.pack === pack), 'UNKNOWN_PACK', 'Choose an available business starter pack.');
      const result = await Vault.create({ directory: this.workspacePath(payload.folder), passphrase: payload.passphrase, name: payload.name.trim(), demo: !!payload.demo, storage: await this.adapter(payload.folder) });
      try {
        this.attach(result.vault); await this.services.ontology.publish(this.context, pack);
        if (payload.demo) await seedDemo(this.store(), this.context);
        return { workspace: this.store().read().workspace, recoveryKit: result.recoveryCode, recoveryCode: result.recoveryCode, experimental: !!this.options.demo };
      } catch (error) { await result.vault.delete(); this.vault = null; this.services = {}; throw error; }
    }
    if (method === 'workspace.open') { check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); const folder = payload.folder ?? payload.path ?? 'main'; await this.attachSafely(await Vault.open({ directory: this.workspacePath(folder), passphrase: payload.passphrase, storage: await this.adapter(folder) })); return { workspace: this.store().read().workspace }; }
    if (method === 'workspace.recover') { check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace first.'); await this.attachSafely(await Vault.recover({ directory: this.workspacePath(payload.folder), recoveryCode: payload.recoveryCode, newPassphrase: payload.passphrase, storage: await this.adapter(payload.folder) })); return { workspace: this.store().read().workspace }; }
    if (method === 'workspace.restore') {
      check(!this.vault, 'VAULT_OPEN', 'Lock the current workspace before restoring.');
      check(typeof payload.backupFile === 'string', 'INVALID_PATH', 'Choose a backup from this app.');
      const backupRoot = resolve(this.options.directory, 'backups'); const backupFile = resolve(backupRoot, payload.backupFile); const rel = relative(backupRoot, backupFile);
      check(!rel.startsWith('..') && !isAbsolute(rel) && rel.endsWith('.backup'), 'INVALID_PATH', 'Choose a managed backup file.');
      const folder = payload.folder ?? 'restored'; await this.attachSafely(await Vault.restore({ directory: this.workspacePath(folder), backupFile, passphrase: payload.passphrase, storage: await this.adapter(folder) })); return { workspace: this.store().read().workspace };
    }
    if (method === 'workspace.lock') { if (this.vault) authorize(this.vault, this.context, 'admin'); await this.closeVault(); return { locked: true }; }
    const store = this.store(); const ctx = this.context; authorize(store, ctx);
    const s = this.services;
    switch (method) {
      case 'auth.invite': return s.auth.invite(ctx, payload);
      case 'auth.accept': return s.auth.accept(payload.token);
      case 'auth.session': return s.auth.issueSession(ctx, payload.memberId ?? ctx.memberId, payload.ttlMs);
      case 'auth.revoke': return payload.inviteId ? s.auth.revokeInvite(ctx, payload.inviteId) : s.auth.revokeSession(ctx, payload.sessionId ?? payload.id);
      case 'auth.sessions': return s.auth.sessions(ctx);
      case 'sync.status': authorize(store, ctx, 'admin'); return s.sync.status(ctx);
      case 'sync.identity': return s.sync.identity(ctx);
      case 'sync.enable': return s.sync.enable(ctx, payload.enabled);
      case 'sync.trust': return s.sync.trustDevice(ctx, payload);
      case 'sync.preview': return s.sync.preview(ctx);
      case 'sync.approve': return s.sync.approve(ctx, payload.id ?? payload.previewId);
      case 'sync.push': return s.sync.push(ctx, payload);
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
        const purpose = conversationPurpose(payload.question, payload.purpose);
        let result: any;
        let businessManifest: BusinessContextManifest | undefined;
        let modelReceiptId: string | undefined;
        if (payload.routeId) {
          const gatewayResult = await s.gateway.execute(ctx, { ...payload, purpose });
          if (gatewayResult.kind === 'business-context') { result = gatewayResult.answer; businessManifest = gatewayResult.receipt.businessContext; modelReceiptId = gatewayResult.receipt.id; }
          else { const plan = gatewayResult.plan; if (plan.clarification || !plan.operation) return plan; result = await s.calculator.calculate(ctx, plan); }
        } else if (purpose === 'business-context') {
          check(payload.previewId === undefined && payload.approvalId === undefined && payload.profileSamples === undefined, 'MODEL_ROUTE_REQUIRED', 'A model preview requires its exact selected route. Local context stays on this device.');
          const request = { ...(payload.sourceIds !== undefined ? { sourceIds: payload.sourceIds } : {}), ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.asOf !== undefined ? { asOf: payload.asOf } : {}), ...(payload.onDate !== undefined ? { onDate: payload.onDate } : {}), ...(payload.period !== undefined ? { period: payload.period } : {}) };
          businessManifest = buildBusinessContext(store, ctx, request, s.businessContextHooks);
          result = renderBusinessAnswer(store, ctx, businessManifest, { claimIds: businessManifest.claims.map(claim => claim.id), unknownCategories: businessManifest.unknownCategories }, s.businessContextHooks);
        } else { const { question, purpose: ignoredPurpose, routeId, previewId, approvalId, ...filters } = payload; result = await s.calculator.ask(ctx, payload.question, filters); }
        if (businessManifest) {
          const manifest = businessManifest, id = newId('business_answer');
          result = { ...result, id, receipt: { id, kind: 'business-context-receipt', contextDigest: manifest.digest, financialCalculation: false, sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, ...(modelReceiptId ? { modelReceiptId } : {}) } };
          await store.update(state => {
            const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx); assertBusinessContextCurrent(view, ctx, manifest, s.businessContextHooks);
            state.conversations.push({ id, kind: 'business-context-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question: payload.question, manifest, answer: structuredClone(result), sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, profileIds: manifest.profileIds });
          });
        } else await store.update(state => { state.conversations.push({ id: newId('message'), at: now(), memberId: ctx.memberId, question: payload.question, resultId: result.id ?? result.receipt?.id, role: 'user' }); });
        return result;
      }
      case 'business.context.receipt': {
        check(typeof payload.id === 'string', 'INVALID_REFERENCE', 'Choose a saved business context receipt.');
        const saved = store.read().conversations.find(item => item.kind === 'business-context-answer' && item.id === payload.id);
        check(saved && saved.memberId === ctx.memberId && saved.epoch === ctx.epoch, 'RECEIPT_NOT_FOUND', 'This business context receipt is unavailable to the current account.');
        assertBusinessContextCurrent(store, ctx, saved.manifest, s.businessContextHooks); return structuredClone(saved.answer);
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
        check(['calculation-set', 'evidence-review', 'action-preparation'].includes(payload.type), 'JOB_TYPE_UNSUPPORTED', 'Choose an installed goal type explicitly.');
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
      case 'workspace.delete': this.requireWorkspaceOwner(ctx); check(payload.confirmation === store.read().workspace.name, 'CONFIRMATION_REQUIRED', 'Type the business name to delete the vault.'); const removed = await this.purgeManagedCopies(); await store.delete(); await this.closeVault(); return { deleted: true, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' };
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
    const result = await this.services.reports.brief(jobContext, {});
    const completed = await this.services.jobs.complete(jobContext, id, job.lease, { kind: 'brief', result, at: now() }, '0');
    // The scheduler may administer another member's run, but does not disclose
    // that member's cached report to a different requesting identity.
    if (this.context.memberId !== owner.id) return { id: completed.id, status: completed.status };
    return completed;
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
    return [...legacy, ...this.services.connectorRuntime.sourceSummaries(ctx)];
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
    const removed: string[] = [];
    const prefix = `chausar-${this.store().read().workspace.id}-`;
    for (const name of ['backups', 'exports']) {
      const folder = resolve(this.options.directory, name); let files;
      try { files = await readdir(folder, { withFileTypes: true }); } catch (error) { if ((error as any).code === 'ENOENT') continue; throw error; }
      for (const file of files) if (file.isFile() && file.name.startsWith(prefix) && /^\d+\.(backup|json|vault)$/.test(file.name.slice(prefix.length))) { const path = resolve(folder, file.name); check(relative(folder, path) === file.name, 'INVALID_PATH', 'A managed file left its export directory.'); await unlink(path); removed.push(`${name}/${file.name}`); }
    }
    return removed;
  }
  private requireWorkspaceOwner(ctx: Context) { const member = authorize(this.store(), ctx, 'admin'); check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only an unrestricted workspace owner can copy or delete the entire vault.'); }
  private jobRunner() { check(this.services.jobRunner, 'JOB_POLICY_REQUIRED', 'Configure explicit worker, active-job and lease policy before creating typed goals.'); return this.services.jobRunner; }
  private createBriefJob(ctx: Context, payload: any) {
    check(payload.plan === undefined, 'INVALID_JOB_PLAN', 'The installed runner creates its own plan.');
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
