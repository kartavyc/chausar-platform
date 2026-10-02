import { canonical } from './actions.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { authorize, hash, newId } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import type { ModelRequest } from './gateway.ts';
import { assertSourceAccess } from './trust.ts';
import { PhoneError, isId, isOperationVersion, requirePhone, sameBinding } from './phone/contracts.ts';
import type { Brief, ChatAnswer, PhoneCapability, PhoneMethods, RemoteRequest, RequestResult, SessionGrant } from './phone/contracts.ts';
import { PhoneHost } from './phone/host.ts';
import type { PhoneCustodyRecord, PhoneCustodyStorage, PhoneHostAuthentication, PhoneHostOperation, PhoneHostPrincipal,
  PhoneHostRelease, PhoneReceipt, PhoneRequestScope } from './phone/host-contracts.ts';
import { PhoneRequestCustody } from './phone/request-custody.ts';

export type ReviewedPhoneConversationRequest = ModelRequest & {
  purpose: 'conversation'; questionDisclosure: 'verbatim'; routeId: string; previewId: string; approvalId: string;
};
/** Implemented by the supported session adapter. Pure checks receive the exact writer/read view. */
export interface EnginePhoneSessions {
  authenticate(authentication: PhoneHostAuthentication): Promise<PhoneHostPrincipal>;
  pair(authentication: PhoneHostAuthentication, payload: PhoneMethods['pairing.accept']['input']): Promise<SessionGrant>;
  assertPrincipal(principal: PhoneHostPrincipal, current: State | StateStore, capability?: PhoneCapability): Context;
  target(owner: Context, sessionId: string, current: State | StateStore): PhoneHostPrincipal;
  revoke(principal: PhoneHostPrincipal, deviceId: string): Promise<void>;
}
export interface EnginePhoneRuntimePorts {
  /** Pure current readiness/access/request/operation guard, including exact consumed-preview readback. */
  review(ctx: Context, request: ReviewedPhoneConversationRequest, view: StateStore): { sourceIds: string[]; operationVersion: string };
  executeConversation(ctx: Context, request: ReviewedPhoneConversationRequest): Promise<unknown>;
  /** Only exact currently guarded retained history linked to this preview proves a commit. Never execute here. */
  reconcileConversation(ctx: Context, previewId: string, view: StateStore): ChatAnswer | undefined;
  briefs(ctx: Context, view: StateStore): Brief[] | Promise<Brief[]>;
  receipt(ctx: Context, id: string, view: StateStore): PhoneReceipt | Promise<PhoneReceipt>;
}

type Offer = { id: string; principal: PhoneHostPrincipal; request: ReviewedPhoneConversationRequest; requestDigest: string;
  scope: PhoneRequestScope; createdAt: string; expiresAt: string };
type Intent = { id: string; offerId: string; previewId: string; requestDigest: string; operationIds: string[];
  status: 'dispatching' | 'cancelled' | 'committed'; cancelRequested: boolean; result?: ChatAnswer };
type Container = { id: string; kind: 'engine-phone-runtime'; version: 1; workspaceId: string; revision: number;
  records: PhoneCustodyRecord[]; offers: Offer[]; intents: Intent[]; integrity: string };
type ReadTicket = { projection: string; fingerprint: string };
type ReadScope = { briefs: Map<string, ReadTicket>; receipts: Map<string, ReadTicket> };
class ScopedPhoneHost extends PhoneHost {
  private readonly reads: AsyncLocalStorage<ReadScope>;
  constructor(options: ConstructorParameters<typeof PhoneHost>[0], reads: AsyncLocalStorage<ReadScope>) {
    super(options); this.reads = reads;
  }
  override handle(authentication: PhoneHostAuthentication): Promise<unknown> {
    return this.reads.run({ briefs: new Map(), receipts: new Map() }, () => super.handle(authentication));
  }
}
const CONTAINER_ID = 'engine_phone_runtime_v1';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 1000;
class CustodyChanged extends Error {}
function json<T>(value: T, maxBytes = MAX_BYTES): T {
  const serialized = JSON.stringify(value);
  requirePhone(typeof serialized === 'string' && Buffer.byteLength(serialized) <= maxBytes, 'CACHE_INVALID');
  const clean = JSON.parse(serialized); canonical(clean); return clean;
}
function digest(value: unknown): string { return hash(canonical(json(value))); }
function exact(value: any, keys: string[]): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function view(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new PhoneError('INVALID_REQUEST'); } };
}
function body(container: Container) { const { integrity: ignored, ...data } = container; return data; }
function seal(container: Container): Container { return { ...container, integrity: digest(body(container)) }; }
function load(state: State): Container {
  const matches = state.conversations.filter(row => row?.id === CONTAINER_ID || row?.kind === 'engine-phone-runtime');
  if (!matches.length) return seal({ id: CONTAINER_ID, kind: 'engine-phone-runtime', version: 1,
    workspaceId: state.workspace.id, revision: 0, records: [], offers: [], intents: [], integrity: '' });
  requirePhone(matches.length === 1, 'CACHE_INVALID');
  const c = json(matches[0]) as Container;
  requirePhone(exact(c, ['id', 'kind', 'version', 'workspaceId', 'revision', 'records', 'offers', 'intents', 'integrity'])
    && c.id === CONTAINER_ID && c.kind === 'engine-phone-runtime' && c.version === 1 && c.workspaceId === state.workspace.id
    && Number.isSafeInteger(c.revision) && c.revision >= 0 && c.integrity === digest(body(c)), 'CACHE_INVALID');
  for (const rows of [c.records, c.offers, c.intents]) requirePhone(Array.isArray(rows) && rows.length <= MAX_ROWS, 'CACHE_INVALID');
  const ids = [...c.offers.map(row => row.id), ...c.intents.map(row => row.id)];
  requirePhone(ids.every(isId) && new Set(ids).size === ids.length && new Set(c.offers.map(row => row.request.previewId)).size === c.offers.length
    && new Set(c.intents.map(row => row.previewId)).size === c.intents.length, 'CACHE_INVALID');
  for (const offer of c.offers) requirePhone(exact(offer, ['id', 'principal', 'request', 'requestDigest', 'scope', 'createdAt', 'expiresAt'])
    && offer.requestDigest === digest(offer.request) && Number.isFinite(Date.parse(offer.createdAt))
    && Date.parse(offer.expiresAt) > Date.parse(offer.createdAt), 'CACHE_INVALID');
  for (const intent of c.intents) requirePhone(exact(intent, ['id', 'offerId', 'previewId', 'requestDigest', 'operationIds', 'status', 'cancelRequested',
    ...(intent.result === undefined ? [] : ['result'])]) && c.offers.some(offer => offer.id === intent.offerId && offer.request.previewId === intent.previewId
      && offer.requestDigest === intent.requestDigest) && Array.isArray(intent.operationIds) && intent.operationIds.length > 0
    && intent.operationIds.length <= 100 && intent.operationIds.every(isId) && new Set(intent.operationIds).size === intent.operationIds.length
    && ['dispatching', 'cancelled', 'committed'].includes(intent.status) && typeof intent.cancelRequested === 'boolean'
    && (intent.status === 'committed') === (intent.result !== undefined), 'CACHE_INVALID');
  return c;
}
function save(state: State, container: Container): void {
  requirePhone(container.revision < Number.MAX_SAFE_INTEGER, 'CACHE_INVALID');
  const clean = json(seal({ ...container, revision: container.revision + 1 }));
  state.conversations = state.conversations.filter(row => row?.id !== CONTAINER_ID);
  state.conversations.push(clean);
}

/** CAS writes preserve unrelated State fields; get/list/read-only settlements commit no no-op revision. */
export class StateStorePhoneCustodyStorage implements PhoneCustodyStorage {
  private readonly store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  async transaction<T>(work: (records: PhoneCustodyRecord[]) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const original = load(this.store.read()), records = structuredClone(original.records), result = work(records);
      if (result && typeof (result as any).then === 'function') {
        void Promise.resolve(result).catch(() => undefined); throw new PhoneError('INVALID_REQUEST');
      }
      const retainedResult = structuredClone(result);
      if (digest(records) === digest(original.records)) return retainedResult;
      try {
        await this.store.update(state => {
          const current = load(state);
          if (current.revision !== original.revision || current.integrity !== original.integrity) throw new CustodyChanged();
          current.records = json(records); save(state, current);
        });
        return retainedResult;
      } catch (error) { if (!(error instanceof CustodyChanged)) throw error; }
    }
    throw new PhoneError('TRANSPORT_UNKNOWN');
  }
}

function request(value: ReviewedPhoneConversationRequest): ReviewedPhoneConversationRequest {
  requirePhone(value && typeof value.question === 'string' && value.question.trim().length > 0 && value.question.length <= 8000
    && value.purpose === 'conversation' && value.questionDisclosure === 'verbatim'
    && [value.routeId, value.previewId, value.approvalId].every(isId), 'INVALID_REQUEST');
  // Preserve every exact reviewed selector, including future ModelRequest additions.
  canonical(value); return json(value, 128 * 1024);
}
function samePrincipal(a: PhoneHostPrincipal, b: PhoneHostPrincipal): boolean {
  return sameBinding(a.authority.binding, b.authority.binding) && a.authority.sessionId === b.authority.sessionId && a.channel === b.channel;
}
function operationDigest(record: PhoneCustodyRecord, offer: Offer): string {
  return hash(JSON.stringify({ kind: 'chat', input: { requestId: record.identity.requestId, question: offer.request.question } }));
}
function answer(value: ChatAnswer): ChatAnswer {
  requirePhone(exact(value, ['conversationId', 'text', 'receiptIds']) && isId(value.conversationId)
    && typeof value.text === 'string' && value.text.length <= 64000 && Array.isArray(value.receiptIds)
    && value.receiptIds.length <= 100 && value.receiptIds.every(isId), 'INVALID_RESPONSE');
  return json(value, 128 * 1024);
}
function reviewedPayload(state: State, value: ReviewedPhoneConversationRequest): string {
  const previews = state.modelReceipts.filter(row => row?.id === value.previewId), approvals = state.modelReceipts.filter(row => row?.id === value.approvalId);
  requirePhone(previews.length === 1 && approvals.length === 1, 'PREVIEW_CHANGED');
  const mutable = new Set(['status', 'costReservedMinor', 'attempts', 'dispatchedAt', 'approvalId', 'completedAt', 'selection',
    'answerDigest', 'plan', 'conversationPlanWire', 'conversationPlanDigest', 'actualCostMinor', 'costMeasured', 'responseHash',
    'providerRequestId', 'costStatus', 'errorCode']);
  return digest({ preview: Object.fromEntries(Object.entries(previews[0]).filter(([key]) => !mutable.has(key))),
    approval: Object.fromEntries(Object.entries(approvals[0]).filter(([key]) => key !== 'used')) });
}
function readFingerprint(state: State, ctx: Context, receiptIds: string[]): string {
  const receipts = state.receipts.filter(row => receiptIds.includes(row.id));
  const modelReceipts = state.modelReceipts.filter(row => receiptIds.includes(row.id));
  const history = state.conversations.filter(row => row?.kind !== 'engine-phone-runtime'
    && [row?.id, row?.receiptId, row?.modelReceiptId].some(id => receiptIds.includes(id)));
  const sourceIds = new Set(receipts.flatMap(row => [...(row.sourceIds ?? []), ...(row.rows ?? []).map((item: any) => item.sourceId)]));
  const selected = (row: any) => !receiptIds.length || receipts.length !== new Set(receiptIds).size || sourceIds.has(row.sourceId);
  return digest({ workspaceId: state.workspace.id, member: state.members.find(row => row.id === ctx.memberId),
    policy: state.policy, ontology: state.ontology, receipts, modelReceipts, history,
    facts: state.facts.filter(selected), imports: state.imports.filter(selected), sourceRules: state.sourceRules.filter(selected),
    tombstones: state.tombstones.filter(row => selected(row) || receipts.some(receipt => receipt.rowIds?.includes(row.factId))) });
}
function outcome(record: PhoneCustodyRecord, status: 'unknown' | 'cancelled' | ChatAnswer): RemoteRequest<RequestResult> {
  return typeof status === 'string' ? { status, requestId: record.identity.requestId }
    : { status: 'succeeded', requestId: record.identity.requestId, result: answer(status) };
}

export class EnginePhoneRuntime {
  readonly custody: PhoneRequestCustody;
  readonly host: PhoneHost;
  private readonly clock: () => number;
  private readonly reads = new AsyncLocalStorage<ReadScope>();
  private readonly store: StateStore;
  private readonly sessions: EnginePhoneSessions;
  private readonly ports: EnginePhoneRuntimePorts;
  constructor(store: StateStore, sessions: EnginePhoneSessions,
    ports: EnginePhoneRuntimePorts, options: { clock?: () => number } = {}) {
    this.store = store; this.sessions = sessions; this.ports = ports;
    this.clock = options.clock ?? Date.now;
    this.custody = new PhoneRequestCustody(new StateStorePhoneCustodyStorage(store));
    this.host = new ScopedPhoneHost({ clock: this.clock, custody: this.custody, ports: {
      authenticate: authentication => sessions.authenticate(authentication), pair: (authentication, input) => sessions.pair(authentication, input),
      revoke: (principal, deviceId) => sessions.revoke(principal, deviceId),
      briefs: async (principal, briefId) => {
        const current = this.snapshot(principal, 'brief.read');
        const rows = json(await ports.briefs(current.ctx, current.view));
        for (const row of rows) this.reads.getStore()?.briefs.set(row.id, { projection: digest(row),
          fingerprint: readFingerprint(current.state, current.ctx, row.receiptIds) });
        return briefId === undefined ? rows : rows.filter(row => row.id === briefId);
      },
      receipt: async (principal, id) => { const current = this.snapshot(principal, 'brief.read');
        const projected = json(await ports.receipt(current.ctx, id, current.view));
        this.reads.getStore()?.receipts.set(id, { projection: digest(projected), fingerprint: readFingerprint(current.state, current.ctx, [id]) });
        return projected; },
      release: (principal, resource) => this.release(principal, resource),
      admit: async (principal, operation) => this.admit(principal, operation),
      check: async (principal, record) => { this.checked(principal, record, this.store.read()); },
      start: (principal, record, operation) => this.start(principal, record, operation),
      status: async (principal, record) => this.status(principal, record),
      cancel: (principal, record) => this.cancel(principal, record),
      // An atomic production phone-approval ledger and writeback target set are not joined.
    } }, this.reads);
  }
  private snapshot(principal: PhoneHostPrincipal, capability?: PhoneCapability) {
    const state = this.store.read(), currentView = view(state);
    const ctx = this.sessions.assertPrincipal(principal, currentView, capability);
    requirePhone(ctx.channel === 'phone', 'CHANNEL_FORBIDDEN');
    return { state, view: currentView, ctx };
  }
  private scope(principal: PhoneHostPrincipal, value: ReviewedPhoneConversationRequest, state: State): PhoneRequestScope {
    const currentView = view(state), ctx = this.sessions.assertPrincipal(principal, currentView, 'chat');
    requirePhone(ctx.channel === 'phone', 'CHANNEL_FORBIDDEN');
    const reviewed = this.ports.review(ctx, structuredClone(value), currentView);
    requirePhone(Array.isArray(reviewed.sourceIds) && reviewed.sourceIds.length <= 100 && reviewed.sourceIds.every(isId)
      && new Set(reviewed.sourceIds).size === reviewed.sourceIds.length && isOperationVersion(reviewed.operationVersion), 'INVALID_RESPONSE');
    const sourceIds = [...reviewed.sourceIds].sort(); assertSourceAccess(state, ctx, sourceIds);
    const facts = state.facts.filter(row => sourceIds.includes(row.sourceId)), factIds = new Set(facts.map(row => row.id));
    for (const sourceId of sourceIds) requirePhone(state.imports.some(row => row.sourceId === sourceId)
      || facts.some(row => row.sourceId === sourceId), 'ACCESS_REVOKED');
    const route = state.routes.find(row => row.id === value.routeId);
    const projection = { workspaceId: state.workspace.id, member: state.members.find(row => row.id === ctx.memberId),
      policy: state.policy, ontology: state.ontology, request: value, operationVersion: reviewed.operationVersion,
      grant: { binding: principal.authority.binding, sessionId: principal.authority.sessionId, expiresAt: principal.authority.expiresAt,
        capabilities: [...principal.authority.capabilities].sort(), channel: principal.channel, role: principal.role },
      reviewedPayload: reviewedPayload(state, value), route: route && Object.fromEntries(Object.entries(route).filter(([key]) => key !== 'costConsumedMinor')),
      facts, imports: state.imports.filter(row => sourceIds.includes(row.sourceId)),
      sourceRules: state.sourceRules.filter(row => sourceIds.includes(row.sourceId)),
      tombstones: state.tombstones.filter(row => sourceIds.includes(row.sourceId) || factIds.has(row.factId)) };
    return { revision: digest(projection), operationVersion: reviewed.operationVersion, sourceIds };
  }
  async offer(owner: Context, input: { sessionId: string; request: ReviewedPhoneConversationRequest }) {
    requirePhone(exact(input, ['sessionId', 'request']) && isId(input.sessionId) && owner.channel === 'desktop'
      && owner.role === 'owner' && !owner.sourceTainted, 'CHANNEL_FORBIDDEN');
    const value = request(input.request);
    return this.store.update(state => {
      authorize(view(state), owner, 'approve');
      const principal = this.sessions.target(owner, input.sessionId, view(state));
      requirePhone(principal.authority.binding.memberId === owner.memberId, 'CAPABILITY_FORBIDDEN');
      this.sessions.assertPrincipal(principal, view(state), 'chat');
      const container = load(state), requestDigest = digest(value);
      requirePhone(!container.offers.some(row => row.request.previewId === value.previewId), 'REQUEST_EXISTS');
      const previews = state.modelReceipts.filter(row => row?.id === value.previewId), approvals = state.modelReceipts.filter(row => row?.id === value.approvalId);
      const preview = previews[0], approval = approvals[0];
      requirePhone(previews.length === 1 && approvals.length === 1 && preview.kind === 'model-preview' && preview.status === 'preview'
        && preview.purpose === 'conversation' && preview.memberId === owner.memberId && preview.epoch === owner.epoch
        && preview.naturalQuestion === value.question && preview.questionHash === hash(value.question)
        && approval.kind === 'outbound-approval' && approval.previewId === preview.id && approval.used === false
        && approval.approverId === owner.memberId && approval.approverEpoch === owner.epoch && approval.digest === preview.digest
        && approval.routeId === value.routeId && preview.routeId === value.routeId && approval.endpoint === preview.endpoint,
      'PREVIEW_CHANGED');
      requirePhone(Number.isFinite(Date.parse(approval.expiresAt)), 'APPROVAL_EXPIRED');
      const createdAt = new Date(this.clock()).toISOString(), expiresAt = new Date(Math.min(this.clock() + 300000,
        Date.parse(principal.authority.expiresAt), Date.parse(approval.expiresAt))).toISOString();
      requirePhone(Date.parse(expiresAt) > this.clock() && container.offers.length < MAX_ROWS, 'APPROVAL_EXPIRED');
      const scope = this.scope(principal, value, state);
      requirePhone(!container.offers.some(row => samePrincipal(row.principal, principal) && row.request.question === value.question
        && Date.parse(row.expiresAt) > this.clock()), 'REQUEST_EXISTS');
      const offered: Offer = { id: newId('phone_offer'), principal: structuredClone(principal), request: value, requestDigest, scope, createdAt, expiresAt };
      container.offers.push(offered); save(state, container);
      return { offerId: offered.id, sessionId: input.sessionId, previewId: value.previewId, expiresAt, scope: structuredClone(scope) };
    });
  }
  private offerFor(principal: PhoneHostPrincipal, record: PhoneCustodyRecord, state: State): Offer {
    requirePhone(record.identity.kind === 'chat', 'OPEN_DESKTOP');
    requirePhone(sameBinding(record.binding, principal.authority.binding) && record.sessionId === principal.authority.sessionId
      && Date.parse(record.expiresAt) > this.clock(), 'ACCESS_REVOKED');
    const matches = load(state).offers.filter(row => samePrincipal(row.principal, principal) && digest(row.scope) === digest(record.scope)
      && operationDigest(record, row) === record.inputDigest);
    requirePhone(matches.length === 1, 'PREVIEW_CHANGED');
    const offered = matches[0];
    requirePhone(digest(this.scope(principal, offered.request, state)) === digest(record.scope), 'PREVIEW_CHANGED');
    return offered;
  }
  private checked(principal: PhoneHostPrincipal, record: PhoneCustodyRecord, state: State): Offer {
    const offered = this.offerFor(principal, record, state);
    const retained = load(state).records.filter(row => row.operationId === record.operationId);
    requirePhone(retained.length === 1 && retained[0].inputDigest === record.inputDigest && sameBinding(retained[0].binding, record.binding)
      && retained[0].sessionId === record.sessionId && digest(retained[0].identity) === digest(record.identity)
      && digest(retained[0].scope) === digest(record.scope) && retained[0].expiresAt === record.expiresAt, 'CACHE_INVALID');
    if (record.state.status === 'succeeded') {
      const ctx = this.sessions.assertPrincipal(principal, view(state), 'chat');
      const committed = this.ports.reconcileConversation(ctx, offered.request.previewId, view(state));
      requirePhone(committed && digest(answer(committed)) === digest(record.state.result), 'ACCESS_REVOKED');
    }
    return offered;
  }
  private admit(principal: PhoneHostPrincipal, operation: PhoneHostOperation): PhoneRequestScope {
    requirePhone(operation.kind === 'chat', 'OPEN_DESKTOP');
    const state = this.store.read(); this.sessions.assertPrincipal(principal, view(state), 'chat');
    const offers = load(state).offers.filter(row => samePrincipal(row.principal, principal) && row.request.question === operation.input.question
      && Date.parse(row.expiresAt) > this.clock());
    requirePhone(offers.length === 1, 'OPEN_DESKTOP');
    requirePhone(digest(this.scope(principal, offers[0].request, state)) === digest(offers[0].scope), 'PREVIEW_CHANGED');
    return structuredClone(offers[0].scope);
  }
  private status(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): RemoteRequest<RequestResult> {
    const state = this.store.read(), offered = this.checked(principal, record, state);
    const ctx = this.sessions.assertPrincipal(principal, view(state), 'chat');
    const committed = this.ports.reconcileConversation(ctx, offered.request.previewId, view(state));
    if (committed) return outcome(record, answer(committed));
    const intent = load(state).intents.find(row => row.previewId === offered.request.previewId);
    return outcome(record, intent?.status === 'cancelled' ? 'cancelled' : 'unknown');
  }
  private async start(principal: PhoneHostPrincipal, record: PhoneCustodyRecord, operation: PhoneHostOperation): Promise<RemoteRequest<RequestResult>> {
    requirePhone(operation.kind === 'chat', 'OPEN_DESKTOP');
    const dispatch = await this.store.update(state => {
      const offered = this.checked(principal, record, state), container = load(state);
      requirePhone(operation.input.question === offered.request.question && operationDigest(record, offered) === record.inputDigest, 'REQUEST_EXISTS');
      const existing = container.intents.find(row => row.previewId === offered.request.previewId);
      if (existing) {
        requirePhone(existing.offerId === offered.id && existing.requestDigest === offered.requestDigest, 'PREVIEW_CHANGED');
        if (!existing.operationIds.includes(record.operationId)) {
          requirePhone(existing.operationIds.length < 100, 'REQUEST_EXISTS'); existing.operationIds.push(record.operationId); save(state, container);
        }
        return undefined;
      }
      requirePhone(container.intents.length < MAX_ROWS, 'REQUEST_EXISTS');
      const ctx = this.sessions.assertPrincipal(principal, view(state), 'chat');
      if (this.ports.reconcileConversation(ctx, offered.request.previewId, view(state))) return undefined;
      requirePhone(Date.parse(offered.expiresAt) > this.clock(), 'APPROVAL_EXPIRED');
      const preview = state.modelReceipts.find(row => row?.id === offered.request.previewId), approval = state.modelReceipts.find(row => row?.id === offered.request.approvalId);
      requirePhone(preview?.status === 'preview' && approval?.used === false, 'PREVIEW_CHANGED');
      container.intents.push({ id: newId('phone_intent'), offerId: offered.id, previewId: offered.request.previewId,
        requestDigest: offered.requestDigest, operationIds: [record.operationId], status: 'dispatching', cancelRequested: false });
      save(state, container); return { ctx, request: structuredClone(offered.request) };
    });
    if (!dispatch) return this.status(principal, record);
    try { await this.ports.executeConversation(dispatch.ctx, dispatch.request); }
    catch { /* Persisted dispatch intent is uncertain; exact guarded history may still prove commit. */ }
    return this.store.update(state => {
      const offered = this.checked(principal, record, state), container = load(state);
      const intent = container.intents.find(row => row.previewId === offered.request.previewId);
      requirePhone(intent && intent.operationIds.includes(record.operationId), 'CACHE_INVALID');
      const ctx = this.sessions.assertPrincipal(principal, view(state), 'chat');
      const committed = this.ports.reconcileConversation(ctx, offered.request.previewId, view(state));
      if (committed) { intent.status = 'committed'; intent.result = answer(committed); save(state, container); return outcome(record, intent.result); }
      return outcome(record, 'unknown');
    });
  }
  private cancel(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): Promise<RemoteRequest<RequestResult>> {
    return this.store.update(state => {
      const offered = this.checked(principal, record, state), container = load(state);
      const ctx = this.sessions.assertPrincipal(principal, view(state), 'chat');
      const committed = this.ports.reconcileConversation(ctx, offered.request.previewId, view(state));
      if (committed) return outcome(record, answer(committed));
      let intent = container.intents.find(row => row.previewId === offered.request.previewId);
      if (!intent) {
        requirePhone(container.intents.length < MAX_ROWS, 'REQUEST_EXISTS');
        intent = { id: newId('phone_intent'), offerId: offered.id, previewId: offered.request.previewId,
          requestDigest: offered.requestDigest, operationIds: [record.operationId], status: 'cancelled', cancelRequested: true };
        container.intents.push(intent);
      } else { intent.cancelRequested = true; }
      save(state, container);
      return outcome(record, intent.status === 'cancelled' ? 'cancelled' : 'unknown');
    });
  }
  private async release(principal: PhoneHostPrincipal, resource: PhoneHostRelease): Promise<void> {
    if (resource.kind === 'session') { this.snapshot(principal); return; }
    if (resource.kind === 'approval' || resource.kind === 'approval-list') throw new PhoneError('OPEN_DESKTOP');
    if (resource.kind === 'requests') {
      const current = this.snapshot(principal), records = load(current.state).records;
      for (const selected of resource.records) {
        const record = records.find(row => row.operationId === selected.operationId);
        requirePhone(record && digest({ identity: record.identity, binding: record.binding, sessionId: record.sessionId,
          operationId: record.operationId, scope: record.scope, expiresAt: record.expiresAt }) === digest(selected), 'PREVIEW_CHANGED');
        this.checked(principal, record, current.state);
      }
      this.snapshot(principal); return;
    }
    const current = this.snapshot(principal, 'brief.read');
    if (resource.kind === 'receipt') {
      const original = this.reads.getStore()?.receipts.get(resource.receiptId);
      requirePhone(original, 'INVALID_RESPONSE');
      const latest = await this.ports.receipt(current.ctx, resource.receiptId, current.view);
      requirePhone(original.projection === digest(latest) && original.fingerprint === readFingerprint(current.state, current.ctx, [resource.receiptId]), 'PREVIEW_CHANGED');
      const fresh = this.snapshot(principal, 'brief.read');
      const rechecked = await this.ports.receipt(fresh.ctx, resource.receiptId, fresh.view);
      requirePhone(original.projection === digest(rechecked)
        && original.fingerprint === readFingerprint(fresh.state, fresh.ctx, [resource.receiptId]), 'PREVIEW_CHANGED');
      const released = this.snapshot(principal, 'brief.read');
      requirePhone(readFingerprint(fresh.state, fresh.ctx, [resource.receiptId]) === readFingerprint(released.state, released.ctx, [resource.receiptId]), 'PREVIEW_CHANGED');
      return;
    }
    const latest = await this.ports.briefs(current.ctx, current.view);
    for (const expected of resource.briefs) {
      const original = this.reads.getStore()?.briefs.get(expected.id);
      requirePhone(original && original.fingerprint === readFingerprint(current.state, current.ctx, expected.receiptIds), 'PREVIEW_CHANGED');
      const matches = latest.filter(row => row.id === expected.id);
      requirePhone(matches.length === 1 && digest(matches[0]) === original.projection && matches[0].version === expected.version
        && digest(matches[0].receiptIds) === digest(expected.receiptIds), 'PREVIEW_CHANGED');
      for (const receiptId of expected.receiptIds) await this.ports.receipt(current.ctx, receiptId, current.view);
    }
    const fresh = this.snapshot(principal, 'brief.read'), rechecked = await this.ports.briefs(fresh.ctx, fresh.view);
    for (const expected of resource.briefs) requirePhone(this.reads.getStore()?.briefs.get(expected.id)?.fingerprint
      === readFingerprint(fresh.state, fresh.ctx, expected.receiptIds)
      && rechecked.some(row => row.id === expected.id && row.version === expected.version
        && digest(row.receiptIds) === digest(expected.receiptIds) && digest(row) === this.reads.getStore()?.briefs.get(expected.id)?.projection), 'PREVIEW_CHANGED');
    const released = this.snapshot(principal, 'brief.read'), receiptIds = resource.briefs.flatMap(row => row.receiptIds);
    requirePhone(readFingerprint(fresh.state, fresh.ctx, receiptIds) === readFingerprint(released.state, released.ctx, receiptIds), 'PREVIEW_CHANGED');
  }
}
