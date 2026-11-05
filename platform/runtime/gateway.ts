// The model gateway: routes, previews, owner approval and dispatch. The types, the plan, request validation, each
// provider route and the review checks live in gateway/ (split in D11); this file keeps the class and re-exports the
// names it always exported, so no importer changes.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { authorize, audit, check, ChausarError, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import { assertSourceAccess, isNoResend, sourceAllowed, trustFingerprint, visibleFacts } from './trust.ts';
import { createCodexCliProcessAdapter, type CodexCliCapabilityProfile } from './providers/codex-cli.ts';
import { conversationPurpose } from './conversation-purpose.ts';
import { CONVERSATION_PLANNER_INSTRUCTIONS, conversationPlannerSchema, validateConversationPlan } from './conversation-planner.ts';
import { buildBusinessContext, assertBusinessContextCurrent, businessContextDisclosure, validateBusinessSelection, renderBusinessAnswer } from './conversation-context.ts';
import { PRIORITY, INSTRUCTIONS, BUSINESS_INSTRUCTIONS, SAFE_WORDS, type RouteConfig, type ModelRequest, type DispatchedConversationStatus, type GatewayResult, type HttpResult, type ProcessResult, type GatewayOptions, type GatewayCore } from './gateway/model-request.ts';
import { operationCatalog, publishedCalculationCatalog, DEFINITION_INSTRUCTIONS, planSchema, businessSelectionSchema, businessRequest, reviewedCalculationRequest, modelPayload, validatePlan } from './gateway/plan.ts';
import { SYNTHESIS_INVALID, SYNTHESIS_MARKERS, synthesisJson, synthesisObject, CONTINUATION_INVALID, continuationId, continuationRequest } from './gateway/requests.ts';
import { validateEndpoint, defaultHttp } from './gateway/providers/http.ts';
import { defaultProcess, cliArguments, processEnv } from './gateway/providers/cli.ts';
import { parseProviderOutput, actualCost, modelReceiptRetained } from './gateway/provider-output.ts';
import { assertRequestMatchesPreview, assertUnusedOutboundApproval } from './gateway/preview-checks.ts';
import { resolveContinuation, assertContinuationCurrent } from './gateway/continuation-review.ts';
import { assertCurrentEvidence } from './gateway/evidence-review.ts';
import { synthesisCodec, previewSynthesis } from './gateway/synthesis-review.ts';

export { DEFAULT_OPERATIONS } from './gateway/model-request.ts';
export type { RouteKind, RouteConfig, AnalyticalPlan, ModelRequest, GatewayConversationContinuation, DispatchedConversationStatus, GatewayResult, HttpRequest, HttpResult, ProcessRequest, ProcessResult, GatewayOptions } from './gateway/model-request.ts';
export { operationCatalog, planSchema, businessSelectionSchema, validatePlan } from './gateway/plan.ts';
export { validateEndpoint } from './gateway/providers/http.ts';
export { defaultProcess, cliArguments } from './gateway/providers/cli.ts';

export class ModelGateway {
  store: StateStore; options: GatewayOptions; #credentials = new Map<string, string>();
  #continuationResolutions = new Set<string>();
  #synthesisResolutions = new Set<string>();
  constructor(store: StateStore, options: GatewayOptions = {}) {
    this.store = store;
    this.options = { ...options, ...(options.codexCli ? { codexCli: structuredClone(options.codexCli) } : {}) };
  }
  #routeStatus(route: Pick<RouteConfig, 'kind' | 'credentialEnv'> & { id: string }) {
    const cli = route.kind.endsWith('-cli');
    return { credentialConfigured: !cli && (route.kind === 'ollama' || this.#credentials.has(route.id) || Boolean(route.credentialEnv && process.env[route.credentialEnv])),
      ...(cli ? { authenticationStatus: 'cli-managed-unverified',
        interfaceEvidenceKind: route.kind === 'codex-cli' ? this.options.codexCli?.capabilities.evidence.kind ?? 'unverified' : 'unverified',
        accountAccess: 'unverified', modelAccess: 'unverified' } : {}) };
  }
  async configureRoute(context: Context, config: RouteConfig, secret?: string) {
    authorize(this.store, context, 'admin');
    const allowed = ['id', 'kind', 'model', 'endpoint', 'command', 'enabled', 'budgetMinor', 'maxCostMinor', 'maxOutputTokens', 'inputPerMillionMinor', 'outputPerMillionMinor', 'credentialEnv', 'label'];
    check(Object.keys(config).every(k => allowed.includes(k)), 'INVALID_ROUTE', 'Unknown route field; credentials must use the credential broker.');
    check(Object.hasOwn(PRIORITY, config.kind) && typeof config.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(config.model), 'INVALID_ROUTE', 'The route needs a kind and explicit model identifier.');
    for (const key of ['budgetMinor', 'maxCostMinor', 'inputPerMillionMinor', 'outputPerMillionMinor'] as const) {
      const value = config[key];
      if (value !== undefined) check(typeof value === 'string' && /^\d{1,30}$/.test(value), 'INVALID_BUDGET', 'Costs and budgets use integer paise strings.');
    }
    if (config.maxOutputTokens !== undefined) check(Number.isInteger(config.maxOutputTokens) && config.maxOutputTokens >= 64 && config.maxOutputTokens <= 4096, 'INVALID_ROUTE', 'Output token limits must be between 64 and 4096.');
    if (config.credentialEnv) check(/^CHAUSAR_[A-Z0-9_]+$/.test(config.credentialEnv), 'INVALID_ROUTE', 'Use a dedicated CHAUSAR credential environment variable.');
    if (secret !== undefined) check(typeof secret === 'string' && secret.length > 0 && secret.length <= 8192 && !/[\r\n]/.test(secret), 'INVALID_CREDENTIAL', 'The supplied API credential is invalid.');
    const cli = config.kind.endsWith('-cli');
    check(!cli || secret === undefined, 'SUBSCRIPTION_TOKEN_REFUSED', 'The official CLI owns its login. Chausar never handles a subscription token.');
    let endpoint = config.endpoint;
    if (!cli) endpoint = validateEndpoint(endpoint || (config.kind === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : config.kind === 'openai-compatible' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.openai.com/v1/responses'), config.kind);
    if (config.kind === 'managed') check(Boolean(config.endpoint), 'MANAGED_UNAVAILABLE', 'A managed allowance needs an actual configured service endpoint.');
    const command = config.command || (config.kind === 'codex-cli' ? 'codex' : 'claude');
    if (cli) check(command === (config.kind === 'codex-cli' ? 'codex' : 'claude') || (isAbsolute(command) && /(?:^|[\\/])(?:codex|claude)(?:\.exe)?$/.test(command)), 'INVALID_COMMAND', 'Use the installed official CLI executable, without a shell wrapper.');
    const id = config.id || newId('route');
    const route = await this.store.update(state => {
      authorize(this.store, context, 'admin'); const old = state.routes.find(r => r.id === id);
      const record = { ...structuredClone(config), id, endpoint: cli ? `cli://${config.kind === 'codex-cli' ? 'codex' : 'claude'}/provider-managed` : endpoint,
        command: cli ? command : undefined, enabled: config.enabled ?? true, budgetMinor: config.budgetMinor || '10000', maxCostMinor: config.maxCostMinor || '100', maxOutputTokens: config.maxOutputTokens || 512,
        revision: (old?.revision || 0) + 1, costConsumedMinor: old?.costConsumedMinor ?? String(state.modelReceipts.filter(r => r.routeId === id).reduce((sum, r) => sum + BigInt(r.costReservedMinor || '0'), 0n)), priority: PRIORITY[config.kind], experimental: true, verification: 'not-live-verified', createdAt: old?.createdAt || now() };
      state.routes = state.routes.filter(r => r.id !== id); state.routes.push(record); audit(state, 'model.route.configured', { routeId: id, kind: config.kind }); return record;
    });
    if (secret !== undefined) this.#credentials.set(id, secret);
    return { ...structuredClone(route), ...this.#routeStatus(route) };
  }
  listRoutes(context: Context) {
    authorize(this.store, context); return structuredClone(this.store.read().routes).sort((a, b) => a.priority - b.priority).map(route => ({ ...route, ...this.#routeStatus(route), installationVerified: false }));
  }
  async revokeRoute(context: Context, id: string) {
    authorize(this.store, context, 'admin'); this.#credentials.delete(id);
    return this.store.update(state => { authorize(this.store, context, 'admin'); const route = state.routes.find(r => r.id === id); check(route, 'ROUTE_NOT_FOUND', 'Model route was not found.'); route.enabled = false; route.revision++; audit(state, 'model.route.revoked', { routeId: id }); return { id, enabled: false }; });
  }
  /** What the split review modules need from this gateway (gateway/model-request.ts GatewayCore). */
  #core(): GatewayCore {
    return { store: this.store, options: this.options, continuationResolutions: this.#continuationResolutions, synthesisResolutions: this.#synthesisResolutions,
      route: (context, id, state) => this.#route(context, id, state), assertCurrent: (context, preview, state) => this.#assertCurrent(context, preview, state) };
  }
  #route(context: Context, id?: string, state = this.store.read()) {
    authorize({ read: () => state, update: this.store.update.bind(this.store) }, context); const route = id ? state.routes.find(r => r.id === id && r.enabled) : [...state.routes].filter(r => r.enabled).sort((a, b) => a.priority - b.priority)[0];
    check(route, 'MODEL_NOT_CONFIGURED', 'Configure an installed CLI, API key, or local model.'); return structuredClone(route);
  }
  async preview(context: Context, request: ModelRequest): Promise<any> {
    authorize(this.store, context, 'prepare');
    check(!Object.hasOwn(request, 'continuation'), CONTINUATION_INVALID, 'Only a retained turn ID may select trusted local continuation text.');
    check(typeof request.question === 'string' && request.question.trim().length > 0 && request.question.length <= 10000, 'INVALID_QUESTION', 'Use a question between one and 10000 characters.');
    const state = this.store.read(); check(state.policy.send !== 'nothing', 'SEND_DISABLED', 'Your privacy policy sends nothing to models. Use the local calculator or change your send policy.');
    if (request.purpose === 'conversation-synthesis') return previewSynthesis(this.#core(), context, request);
    check(request.toolTurnId === undefined, SYNTHESIS_INVALID, 'Tool-turn references belong to the separately reviewed synthesis mode.');
    const unified = request.purpose === 'conversation';
    if (unified) {
      check(typeof request.routeId === 'string' && request.routeId.length > 0, 'MODEL_ROUTE_REQUIRED', 'Choose the exact model route for this conversation.');
      check(request.questionDisclosure === 'verbatim', 'QUESTION_DISCLOSURE_REQUIRED', 'Review and explicitly approve the original question separately from evidence Shape.');
      check(request.samples === undefined && request.profileSamples === undefined, 'INVALID_SAMPLE', 'The conversation planner uses bounded evidence structure, not automatic sample values.');
    } else {
      check(request.questionDisclosure === undefined, 'INVALID_QUESTION_DISCLOSURE', 'Original-question disclosure belongs to the reviewed conversation planner.');
      check(request.continuationId === undefined, CONTINUATION_INVALID, 'Retained clarification disclosure requires the conversation planner.');
      check(request.comparePeriod === undefined && request.assumptions === undefined, 'INVALID_CALCULATION_PARAMETERS', 'Comparison and scenario inputs require the reviewed conversation mode.');
    }
    const continuation = request.continuationId !== undefined ? resolveContinuation(this.#core(), context, request.continuationId, this.store) : undefined;
    const scope = continuation ? continuationRequest(request, continuation) : businessRequest(request);
    const calculationReview = unified ? reviewedCalculationRequest(request, scope, continuation) : undefined;
    const purpose = unified ? 'conversation' : conversationPurpose(request.question, request.purpose);
    const manifest = purpose === 'business-context' || unified ? buildBusinessContext(this.store, context, scope, this.options.businessContext) : undefined;
    const route = this.#route(context, request.routeId); const sourceIds = manifest ? unified ? [...(scope.sourceIds ?? manifest.sourceIds)].sort() : manifest.sourceIds : [...new Set(request.sourceIds || visibleFacts(this.store, context, request.sourceIds).map(f => f.sourceId))];
    const facts = visibleFacts(this.store, context, sourceIds); assertSourceAccess(state, context, sourceIds);
    const operations = operationCatalog(state); check(manifest || operations.length > 0, 'NO_APPROVED_OPERATIONS', 'Publish tested dictionary operations before asking a model for a plan.'); const branches = [...new Set(facts.map(f => f.branch).filter(Boolean))] as string[];
    const customerIds = [...new Set(facts.map(f => f.fields.customerId).filter(v => typeof v === 'string'))] as string[];
    const shape = [...new Set(facts.map(f => f.sourceId))].map(id => ({ fields: [...new Set(facts.filter(f => f.sourceId === id).flatMap(f => Object.keys(f.fields)))].filter(k => /^[A-Za-z_][A-Za-z_]{0,63}$/.test(k)).sort() }));
    const samples: any[] = [];
    check(!manifest || request.samples === undefined, 'INVALID_SAMPLE', 'Business introductions use explicitly selected profile samples, not automatic fact rows.');
    check(manifest || request.profileSamples === undefined, 'INVALID_SAMPLE', 'Profile samples belong to business introductions only.');
    if (!manifest && state.policy.send === 'samples') {
      check(!request.samples || (Array.isArray(request.samples) && request.samples.length <= 5), 'SAMPLE_LIMIT', 'Model samples are limited to five rows.');
      const selected: NonNullable<ModelRequest['samples']> = request.samples || facts.slice(0, 3).map(f => ({ factId: f.id }));
      for (const selection of selected) {
        const fact = facts.find(f => f.id === selection.factId); check(fact, 'SOURCE_REVOKED', 'A selected sample is not visible to your account.');
        const names = selection.fields || Object.keys(fact.fields);
        check(Array.isArray(names) && names.every(k => typeof k === 'string' && Object.hasOwn(fact.fields, k)), 'INVALID_SAMPLE', 'A sample requested an unavailable field.');
        const fields: Record<string, unknown> = {};
        for (const k of names) { const v = fact.fields[k]; check(v === null || ['string', 'number', 'boolean'].includes(typeof v), 'INVALID_SAMPLE', 'Samples contain scalar values only.'); fields[k] = typeof v === 'string' ? v.slice(0, 500) : v; }
        check(Buffer.byteLength(JSON.stringify(fields)) <= 4096, 'SAMPLE_LIMIT', 'A sample row is too large.'); samples.push(fields);
      }
    }
    // Shape mode cannot accidentally send names, values or arbitrary outside instructions in a question.
    const question = state.policy.send === 'shape' ? (request.question.toLowerCase().match(/[a-z_]+/g) || []).filter(w => SAFE_WORDS.has(w)).join(' ') || 'request clarification' : request.question;
    const plannerSelectors = unified && state.policy.send === 'shape' ? { branches: [], customerIds: [] } : { branches, customerIds };
    const plannerContext = { manifest: manifest!, operations, selectors: plannerSelectors, reviewedCalculationParameters: calculationReview?.parameters };
    const publishedCalculations = unified ? publishedCalculationCatalog(state, operations, calculationReview!.parameters) : undefined;
    const content = unified ? { question: request.question, questionDisclosure: 'verbatim', ...(continuation ? { continuationDisclosure: 'verbatim',
      continuation: { turnId: continuation.turnId, originalQuestion: continuation.originalQuestion, clarification: continuation.clarification,
        ...(continuation.exchanges !== undefined ? { exchanges: continuation.exchanges } : {}) } } : {}), definitionDisclosure: 'published', publishedCalculations, calculationParameters: calculationReview!.disclosure,
      tools: [{ name: 'business.describe', description: 'Select cited current business claims and preserve documented unknowns.' },
        { name: 'calculator.calculate', description: 'Run an approved deterministic calculation locally and retain its exact receipt.', operations }],
      evidence: { business: businessContextDisclosure(manifest!, 'shape'), calculator: { shape,
        ...(state.policy.send === 'samples' ? { selectors: plannerSelectors } : {}) } } }
      : manifest ? { question: 'Provide a grounded business introduction and retain documented unknowns.',
      ...businessContextDisclosure(manifest, state.policy.send, request.profileSamples) }
      : { question, operations, shape, ...(state.policy.send === 'samples' ? { samples, selectors: { branches, customerIds } } : {}) };
    const schema = unified ? conversationPlannerSchema(plannerContext) : manifest ? businessSelectionSchema(manifest) : planSchema(operations);
    const instructions = unified ? `${CONVERSATION_PLANNER_INSTRUCTIONS} ${DEFINITION_INSTRUCTIONS}` : manifest ? BUSINESS_INSTRUCTIONS : INSTRUCTIONS;
    const schemaName = unified ? 'grounded_conversation_plan' : manifest ? 'business_context_selection' : 'analytical_plan';
    const payload = modelPayload(route, instructions, JSON.stringify(content), schema, schemaName);
    check(Buffer.byteLength(payload) <= 262144, 'PAYLOAD_TOO_LARGE', 'The model payload is too large.');
    const digest = hash(payload); check(!isNoResend(state, digest), 'NO_RESEND', 'This deleted or expired payload cannot be sent again.');
    const local = route.kind === 'ollama'; const approvalRequired = unified || !local && (Boolean(context.sourceTainted) || facts.length > 0 || Boolean(request.sourceIds?.length)
      || Boolean(manifest && state.policy.send === 'samples' && request.profileSamples?.length));
    const record = { id: newId('model_preview'), kind: 'model-preview', status: 'preview', createdAt: now(), at: now(), memberId: context.memberId, epoch: context.epoch, routeId: route.id, routeRevision: route.revision,
      purpose, questionHash: hash(unified ? request.question : request.question.trim()), ...(unified ? { questionDisclosure: 'verbatim', naturalQuestion: request.question, questionDisclosureWarning: 'The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.',
        reviewedCalculationParameters: calculationReview!.parameters, calculationParameterOrigins: calculationReview!.origins,
        calculationParametersDigest: hash(calculationReview!.parameters), calculationParameterDisclosure: calculationReview!.disclosure,
        calculationParameterDisclosureWarning: 'Exact owner-requested periods and scenario assumptions are included separately from evidence Shape. Review them before approving this payload once; scenario inputs never alter source facts.',
        definitionDisclosure: 'published', publishedCalculations, definitionDisclosureWarning: 'Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.' } : {}),
      ...(continuation ? { continuationId: continuation.turnId, continuationDigest: continuation.digest, continuation,
        continuationDisclosure: 'verbatim', continuationDisclosureWarning: 'The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.',
        requestScopeDigest: hash(manifest!.request) } : {}), requestScope: continuation ? structuredClone(manifest!.request) : scope,
      profileSamplesHash: hash(request.profileSamples ?? []), schema, schemaDigest: hash(schema), instructions,
      ...(manifest ? { businessContext: manifest, contextDigest: manifest.digest, rowIds: manifest.rowIds, profileIds: manifest.profileIds } : {}),
      sourceIds, factIds: facts.map(f => f.id), factDigest: hash(facts), operations, selectors: unified ? plannerSelectors : { branches, customerIds }, payload, digest, endpoint: route.endpoint,
      approvalRequired, send: state.policy.send, trustFingerprint: trustFingerprint(state, context, sourceIds),
      receiptBoundary: route.kind.endsWith('-cli') ? 'application-to-official-cli' : 'application-to-provider-http', providerPayloadObserved: !route.kind.endsWith('-cli'),
      costReservedMinor: '0', estimatedCostMinor: route.maxCostMinor, costCurrency: 'INR', experimental: true };
    return this.store.update(s => { const view = { read: () => s, update: this.store.update.bind(this.store) }; authorize(view, context, 'prepare'); if (manifest) assertBusinessContextCurrent(view, context, manifest, this.options.businessContext); assertContinuationCurrent(this.#core(), context, record, view, route); s.modelReceipts.push(record); return structuredClone(record); });
  }
  async approveOutbound(context: Context, previewId: string) {
    authorize(this.store, context, 'approve'); check(context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Approve model data transfers inside the app.');
    return this.store.update(state => {
      authorize(this.store, context, 'approve'); const preview = state.modelReceipts.find(r => r.id === previewId && r.status === 'preview');
      check(preview, 'PREVIEW_NOT_FOUND', 'An unused model preview is required.');
      check(modelReceiptRetained(state, preview), 'MODEL_RECEIPT_EXPIRED', 'This model disclosure is outside current retention. Create a fresh preview.');
      const origin = state.members.find(m => m.id === preview.memberId); check(origin?.active && origin.epoch === preview.epoch, 'ACCESS_REVOKED', 'The requesting account has changed.');
      const originContext = { memberId: origin.id, role: origin.role, epoch: origin.epoch };
      check(preview.trustFingerprint === trustFingerprint(state, originContext, preview.sourceIds), 'PREVIEW_STALE', 'Privacy settings changed. Create a new preview.');
      if (['business-context', 'conversation', 'conversation-synthesis'].includes(preview.purpose)) this.#assertCurrent(originContext, preview, state);
      const approval = { id: newId('outbound_approval'), kind: 'outbound-approval', previewId, digest: preview.digest, routeId: preview.routeId, endpoint: preview.endpoint,
        approverId: context.memberId, approverEpoch: context.epoch, createdAt: now(), expiresAt: new Date(Date.now() + 300000).toISOString(), used: false };
      state.modelReceipts.push(approval); audit(state, 'model.outbound.approved', { previewId, digest: preview.digest, memberId: context.memberId }); return structuredClone(approval);
    });
  }
  #assertCurrent(context: Context, preview: any, state = this.store.read()) {
    const route = assertCurrentEvidence(this.#core(), context, preview, state);
    const current = state.modelReceipts.find(r => r.id === preview.id);
    if (preview.approvalRequired && (current?.status === 'dispatching' || ['conversation', 'conversation-synthesis'].includes(preview.purpose) && current?.status === 'completed')) {
      const approval = state.modelReceipts.find(a => a.id === current.approvalId && a.kind === 'outbound-approval');
      const approver = state.members.find(m => m.id === approval?.approverId);
      const approvalWasCurrent = current.status === 'completed'
        ? Number.isFinite(Date.parse(current.completedAt)) && Date.parse(approval?.expiresAt) > Date.parse(current.completedAt)
        : Date.parse(approval?.expiresAt) > Date.now();
      // Expiry bounds the one transfer, not the retention of its already completed cited answer.
      check(approval?.used && approval.previewId === current.id && approval.routeId === preview.routeId && approval.digest === preview.digest && approval.endpoint === preview.endpoint && approvalWasCurrent && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role), 'APPROVAL_REVOKED', 'The person approving this transfer no longer has approval rights.');
    }
    return route;
  }
  /** Current read-only authority for executing or reopening an admitted tool plan. */
  assertConversationReceipt(context: Context, id: string, view: StateStore = this.store) {
    const state = view.read(), record = state.modelReceipts.find(item => item.id === id);
    check(record?.kind === 'model-preview' && record.purpose === 'conversation' && record.status === 'completed', 'MODEL_RESULT_UNAVAILABLE', 'A completed current conversation plan is required.');
    this.#assertCurrent(context, record, state);
    const plan = validateConversationPlan(record.conversationPlanWire, { manifest: record.businessContext, operations: record.operations, selectors: record.selectors, reviewedCalculationParameters: record.reviewedCalculationParameters });
    check(hash(plan) === record.conversationPlanDigest && hash(record.plan) === record.conversationPlanDigest, 'PAYLOAD_CHANGED', 'The admitted conversation plan changed.');
    return structuredClone(record);
  }
  /** Read-only current authority for a separately approved stage-two response. */
  assertSynthesisReceipt(context: Context, id: string, view: StateStore = this.store) {
    const state = view.read(), records = state.modelReceipts.filter(item => item?.id === id), record = records[0];
    check(records.length === 1 && record?.kind === 'model-preview' && record.purpose === 'conversation-synthesis' && record.status === 'completed',
      'SYNTHESIS_UNAVAILABLE', 'One completed current synthesis receipt is required.');
    this.#assertCurrent(context, record, state);
    synthesisJson(record.synthesisOutputWire); synthesisJson(record.synthesisOutput);
    const output = synthesisCodec(this.options).validate(structuredClone(record.synthesisOutputWire), structuredClone(record.synthesisSummary)); synthesisJson(output);
    check(hash(record.synthesisOutputWire) === record.synthesisOutputWireDigest && hash(output) === record.synthesisOutputDigest
      && hash(record.synthesisOutput) === record.synthesisOutputDigest, 'PAYLOAD_CHANGED', 'The admitted synthesis output changed.');
    return structuredClone(record);
  }
  /** Trusted host read-only guard. This grants no dispatch/effect authority and
   * never approves, consumes approval, reserves budget or calls a provider. */
  assertReviewedConversationRequest(context: Context, request: ModelRequest, view: StateStore = this.store) {
    authorize(view, context, 'prepare');
    check(typeof request.previewId === 'string' && request.previewId.length > 0 && request.purpose === 'conversation'
      && request.questionDisclosure === 'verbatim' && typeof request.question === 'string' && typeof request.routeId === 'string',
      'PREVIEW_REQUEST_CHANGED', 'Use the exact approved unified conversation request.');
    check(!Object.hasOwn(request, 'continuation'), CONTINUATION_INVALID, 'Only a retained turn ID may select trusted local continuation text.');
    const state = view.read(), records = state.modelReceipts.filter(record => record.id === request.previewId), preview = records[0];
    check(records.length === 1 && preview?.kind === 'model-preview' && preview.purpose === 'conversation'
      && ['preview', 'completed'].includes(preview.status) && preview.approvalRequired === true,
      'PREVIEW_NOT_FOUND', 'An approved conversation preview or its completed retained receipt is required.');
    assertRequestMatchesPreview(request, preview);
    this.#assertCurrent(context, preview, state);
    if (preview.status === 'preview') assertUnusedOutboundApproval(state, preview, request.approvalId);
    else {
      check(typeof request.approvalId === 'string' && request.approvalId === preview.approvalId,
        'APPROVAL_REVOKED', 'Use the original consumed approval for this retained conversation request.');
      this.assertConversationReceipt(context, preview.id, view);
    }
    return structuredClone(preview);
  }
  /** Trusted host status/reconciliation only. Requires evidence of the original
   * single dispatch, even when its one-transfer approval has since expired.
   * The returned projection has no plan, answer, result wire or effect authority. */
  assertDispatchedConversationRequest(context: Context, request: ModelRequest, view: StateStore = this.store): DispatchedConversationStatus {
    authorize(view, context, 'prepare');
    check(typeof request.previewId === 'string' && request.previewId.length > 0 && request.purpose === 'conversation'
      && request.questionDisclosure === 'verbatim' && typeof request.question === 'string' && typeof request.routeId === 'string',
      'PREVIEW_REQUEST_CHANGED', 'Use the exact originally approved unified conversation request.');
    check(!Object.hasOwn(request, 'continuation'), CONTINUATION_INVALID, 'Only a retained turn ID may select trusted local continuation text.');
    const state = view.read(), records = state.modelReceipts.filter(record => record.id === request.previewId), preview = records[0];
    check(records.length === 1 && preview?.kind === 'model-preview' && preview.purpose === 'conversation'
      && ['dispatching', 'failed'].includes(preview.status) && preview.approvalRequired === true && preview.attempts === 1,
      'DISPATCH_STATUS_UNAVAILABLE', 'One originally dispatched conversation is required for current status.');
    assertRequestMatchesPreview(request, preview);
    const approvals = state.modelReceipts.filter(record => record.id === preview.approvalId && record.kind === 'outbound-approval'), approval = approvals[0];
    const approver = state.members.find(member => member.id === approval?.approverId);
    const dispatchedAt = typeof preview.dispatchedAt === 'string' ? Date.parse(preview.dispatchedAt) : NaN;
    const createdAt = typeof approval?.createdAt === 'string' ? Date.parse(approval.createdAt) : NaN;
    const expiresAt = typeof approval?.expiresAt === 'string' ? Date.parse(approval.expiresAt) : NaN;
    check(typeof request.approvalId === 'string' && request.approvalId === preview.approvalId && approvals.length === 1
      && approval?.used === true && approval.previewId === preview.id && approval.routeId === preview.routeId
      && approval.digest === preview.digest && approval.endpoint === preview.endpoint
      && approver?.active && approver.epoch === approval.approverEpoch && ['owner', 'cofounder'].includes(approver.role),
      'APPROVAL_REVOKED', 'The original consumed approval or its current approver no longer matches this dispatch.');
    check(Number.isFinite(dispatchedAt) && Number.isFinite(createdAt) && Number.isFinite(expiresAt)
      && dispatchedAt >= createdAt && dispatchedAt < expiresAt && dispatchedAt <= Date.now(),
      'DISPATCH_STATUS_UNAVAILABLE', 'The persisted single dispatch is outside its original approval interval.');
    assertCurrentEvidence(this.#core(), context, preview, state);
    return { id: preview.id, purpose: 'conversation', status: preview.status, memberId: preview.memberId, epoch: preview.epoch,
      sourceIds: structuredClone(preview.sourceIds), routeId: preview.routeId, routeRevision: preview.routeRevision, endpoint: preview.endpoint,
      digest: preview.digest, schemaDigest: preview.schemaDigest, attempts: 1, dispatchedAt: preview.dispatchedAt,
      publishedCalculations: { dictionaryHash: preview.publishedCalculations?.dictionaryHash ?? null,
        dictionaryVersion: preview.publishedCalculations?.dictionaryVersion ?? null } };
  }
  async execute(context: Context, request: Partial<ModelRequest> & { previewId?: string }): Promise<GatewayResult> {
    authorize(this.store, context, 'prepare');
    check(!Object.hasOwn(request, 'continuation'), CONTINUATION_INVALID, 'Only a retained turn ID may select trusted local continuation text.');
    const preview = request.previewId ? structuredClone(this.store.read().modelReceipts.find(r => r.id === request.previewId)) : await this.preview(context, request as ModelRequest);
    check(preview && preview.status === 'preview', 'PREVIEW_NOT_FOUND', 'An unused model preview is required.');
    assertRequestMatchesPreview(request, preview);
    let route = this.#assertCurrent(context, preview); const cli = route.kind.endsWith('-cli');
    let processPort = this.options.process || defaultProcess;
    let codexCapabilities: CodexCliCapabilityProfile | undefined;
    if (route.kind === 'codex-cli') {
      const settings = this.options.codexCli;
      check(settings, 'CLI_CAPABILITY_REQUIRED', 'The trusted host must provide the reviewed Codex CLI interface.');
      check(settings.mode !== 'synthetic-fixture' || this.options.process, 'CLI_CAPABILITY_REQUIRED', 'Synthetic CLI evidence requires an explicitly injected fixture process.');
      processPort = createCodexCliProcessAdapter({ ...settings, process: processPort });
      if (settings.mode === 'local-cli') check(settings.capabilities.evidence.kind === 'installed-help' && route.command === settings.capabilities.evidence.executable, 'INVALID_COMMAND', 'The route must use the exact reviewed native Codex executable.');
      codexCapabilities = settings.capabilities;
      // Validate interface/model before consuming approval or reserving any budget.
      cliArguments(route, join(tmpdir(), 'plan-schema.json'), codexCapabilities);
    }
    const key = cli || route.kind === 'ollama' ? undefined : this.#credentials.get(route.id) || (route.credentialEnv ? process.env[route.credentialEnv] : undefined) || await this.options.credentialBroker?.(route.id);
    check(cli || route.kind === 'ollama' || Boolean(key), route.kind === 'managed' ? 'MANAGED_UNAVAILABLE' : 'CREDENTIAL_REQUIRED', 'This model route needs its configured API credential.');
    // Credentials may be retrieved asynchronously; recheck access immediately before reserving and dispatch.
    route = this.#assertCurrent(context, preview);
    await this.store.update(state => {
      this.#assertCurrent(context, preview, state); const current = state.modelReceipts.find(r => r.id === preview.id);
      check(current?.status === 'preview', 'ALREADY_SENT', 'Every model preview can be dispatched once only.');
      if (preview.approvalRequired) {
        const approval = assertUnusedOutboundApproval(state, preview, request.approvalId);
        approval.used = true; current.approvalId = approval.id;
      }
      const savedRoute = state.routes.find(r => r.id === route.id); check(savedRoute, 'ROUTE_REVOKED', 'The model route no longer exists.');
      const spent = savedRoute.costConsumedMinor !== undefined ? BigInt(savedRoute.costConsumedMinor) : state.modelReceipts.filter(r => r.routeId === route.id).reduce((sum, r) => sum + BigInt(r.costReservedMinor || '0'), 0n);
      check(spent + BigInt(route.maxCostMinor) <= BigInt(route.budgetMinor), 'BUDGET_EXCEEDED', 'The route rupee budget is exhausted.');
      if (route.inputPerMillionMinor && route.outputPerMillionMinor && !cli) {
        const upperCost = (BigInt(Buffer.byteLength(preview.payload)) * BigInt(route.inputPerMillionMinor) + BigInt(route.maxOutputTokens) * BigInt(route.outputPerMillionMinor) + 999999n) / 1000000n;
        check(upperCost <= BigInt(route.maxCostMinor), 'BUDGET_RESERVATION_TOO_SMALL', 'The configured per-call reservation is below its conservative token-cost bound.');
      }
      savedRoute.costConsumedMinor = String(spent + BigInt(route.maxCostMinor));
      current.status = 'dispatching'; current.costReservedMinor = route.maxCostMinor; current.attempts = 1; current.dispatchedAt = now();
      audit(state, 'model.dispatch.prepared', { receiptId: preview.id, digest: preview.digest, endpoint: preview.endpoint });
    });
    let result: HttpResult | ProcessResult; let directory: string | undefined;
    try {
      if (cli) {
        directory = await mkdtemp(join(tmpdir(), 'chausar-model-')); const schemaPath = join(directory, 'plan-schema.json');
        const schema = preview.schema ?? planSchema(preview.operations);
        await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
        const call = { command: route.command, args: cliArguments({ ...route, operations: preview.operations }, schemaPath, codexCapabilities, { schema, instructions: preview.instructions ?? INSTRUCTIONS }), cwd: directory, env: processEnv(route), stdin: preview.payload, timeoutMs: 120000, schema };
        this.#assertCurrent(context, preview);
        result = await processPort(call);
        check(result.exitCode === 0, 'MODEL_FAILED', 'The installed CLI failed. The request was not retried or rerouted.');
      } else {
        this.#assertCurrent(context, preview);
        result = await (this.options.http || defaultHttp)({ endpoint: preview.endpoint, method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: preview.payload, redirect: 'error', timeoutMs: 120000 });
        check(!result.endpoint || result.endpoint === preview.endpoint, 'REDIRECT_REFUSED', 'The provider endpoint changed during dispatch.');
        check(result.status < 300 || result.status >= 400, 'REDIRECT_REFUSED', 'Model redirects are refused.');
        check(result.status >= 200 && result.status < 300, 'MODEL_FAILED', 'The model provider failed. The request was not retried or rerouted.');
      }
      this.#assertCurrent(context, preview);
      const parsed = parseProviderOutput(route.kind, cli ? (result as ProcessResult).stdout : (result as HttpResult).body);
      if (preview.purpose === 'conversation-synthesis') synthesisJson(parsed.value);
      const synthesisOutput = preview.purpose === 'conversation-synthesis'
        ? synthesisCodec(this.options).validate(structuredClone(parsed.value), structuredClone(preview.synthesisSummary)) : undefined;
      if (preview.purpose === 'conversation-synthesis') {
        synthesisJson(synthesisOutput); synthesisObject(synthesisOutput, ['schemaVersion', 'paragraphs', 'cautionRefs']);
        check(synthesisOutput.schemaVersion === 1 && Array.isArray(synthesisOutput.paragraphs) && Array.isArray(synthesisOutput.cautionRefs),
          SYNTHESIS_INVALID, 'The installed synthesis validator did not return its declared output contract.');
      }
      const conversationPlan = preview.purpose === 'conversation' ? validateConversationPlan(parsed.value, { manifest: preview.businessContext, operations: preview.operations, selectors: preview.selectors, reviewedCalculationParameters: preview.reviewedCalculationParameters }) : undefined;
      const selection = preview.purpose === 'business-context' ? validateBusinessSelection(parsed.value, preview.businessContext) : undefined;
      const answer = selection ? renderBusinessAnswer(this.store, context, preview.businessContext, selection, this.options.businessContext) : undefined;
      const plan = selection || conversationPlan || synthesisOutput ? undefined : validatePlan(parsed.value, preview.operations, preview.selectors); const costMinor = actualCost(route, parsed.usage);
      const receipt = await this.store.update(state => {
        this.#assertCurrent(context, preview, state); const current = state.modelReceipts.find(r => r.id === preview.id); check(current?.status === 'dispatching', 'RESULT_REVOKED', 'The model result is no longer valid.');
        current.status = 'completed'; current.completedAt = now();
        if (selection) { current.selection = selection; current.answerDigest = hash(answer); }
        else if (synthesisOutput) { current.synthesisOutputWire = structuredClone(parsed.value); current.synthesisOutputWireDigest = hash(parsed.value);
          current.synthesisOutput = synthesisOutput; current.synthesisOutputDigest = hash(synthesisOutput); }
        else current.plan = conversationPlan ?? plan;
        if (conversationPlan) { current.conversationPlanWire = structuredClone(parsed.value); current.conversationPlanDigest = hash(conversationPlan); }
        current.actualCostMinor = costMinor; current.costMeasured = costMinor !== null; current.responseHash = hash(cli ? (result as ProcessResult).stdout : (result as HttpResult).body);
        if (costMinor !== null && BigInt(costMinor) > BigInt(current.costReservedMinor)) {
          const savedRoute = state.routes.find(r => r.id === route.id); if (savedRoute) savedRoute.costConsumedMinor = String(BigInt(savedRoute.costConsumedMinor || '0') + BigInt(costMinor) - BigInt(current.costReservedMinor)); current.costReservedMinor = costMinor;
        }
        current.providerRequestId = cli ? undefined : (result as HttpResult).requestId; current.costStatus = costMinor === null ? 'reserved-estimate-cost-unavailable' : 'measured-at-configured-rates';
        audit(state, 'model.dispatch.completed', { receiptId: preview.id, ...(plan ? { operation: plan.operation } : { purpose: preview.purpose, contextDigest: preview.contextDigest }) }); return structuredClone(current);
      });
      if (synthesisOutput) return { kind: 'conversation-synthesis', output: synthesisOutput, receipt };
      if (conversationPlan) return { kind: 'conversation', plan: conversationPlan, receipt };
      if (selection && answer) return { kind: 'business-context', selection, answer, receipt };
      check(plan, 'INVALID_PLAN', 'The model did not return an analytical plan.');
      return { kind: 'analysis', plan, receipt };
    } catch (error) {
      await this.store.update(state => { const current = state.modelReceipts.find(r => r.id === preview.id); if (current) { current.status = 'failed'; current.errorCode = error instanceof ChausarError ? error.code : 'MODEL_FAILED'; current.completedAt = now(); } });
      if (error instanceof ChausarError) throw error; throw new ChausarError('MODEL_FAILED', 'The selected model failed. The request was not retried or rerouted.');
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
  receipts(context: Context) {
    const member = authorize(this.store, context); const state = this.store.read(); const facts = visibleFacts(this.store, context); const visibleIds = new Set(facts.map(f => f.id));
    const view = { read: () => state, update: this.store.update.bind(this.store) };
    return structuredClone(state.modelReceipts.filter(r => modelReceiptRetained(state, r)
      && (['owner', 'cofounder'].includes(member.role) || r.memberId === member.id) &&
      (!r.sourceIds || r.sourceIds.every((id: unknown) => typeof id === 'string' && sourceAllowed(state, context, id)))
      && (!r.factIds || r.factIds.every((id: unknown) => typeof id === 'string' && visibleIds.has(id)))
      && (r.purpose !== 'conversation-synthesis' && !SYNTHESIS_MARKERS.some(key => r[key] !== undefined) || (() => { try {
        if (r.status === 'completed') this.assertSynthesisReceipt(context, r.id, view); else this.#assertCurrent(context, r, state); return true;
      } catch { return false; } })())));
  }
  clearCredentials() { this.#credentials.clear(); }
}
