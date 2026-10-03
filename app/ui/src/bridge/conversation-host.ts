/**
 * Injected conversation orchestration. The trusted desktop/browser host owns RPC,
 * identity and transport. Cancelling discards local work and late replies; it
 * cannot recall a model dispatch the Engine has already started.
 */
import {
  approveRequest, askRequest, synthesisPreviewRequest, synthesisRunRequest, conversationIdRequest,
  validateConversationRequest, validateConversationReadback, validateConversationReply, verifyConversationReply,
  validateOutboundApproval, verifyModelPreview, verifyConversationContinuation,
} from './conversation-contract.ts';
import type { ConversationRequest, ConversationEnginePort, ConversationRpcPort, ConversationPayloads } from './conversation-contract.ts';
import { ReplyValidationError } from './validate.ts';

export type ConversationPreview = Awaited<ReturnType<typeof verifyModelPreview>>;
export type ConversationSavedAnswer = ReturnType<typeof validateConversationReadback>;
export type ConversationContinuation = Awaited<ReturnType<typeof verifyConversationContinuation>>;
export type ConversationDraft = Omit<ConversationRequest, 'continuationId'>;

export type ConversationRpcPayloads = ConversationPayloads;
/** Exactly these existing Engine methods are injected; this owns no transport. */
export type ConversationHostPort = ConversationEnginePort;
export type ConversationFailureCode = 'INVALID_REPLY' | 'REQUEST_FAILED' | 'READ_INVALIDATED'
  | 'ACCESS_DENIED' | 'VAULT_LOCKED' | 'UNAUTHENTICATED' | 'EVIDENCE_UNAVAILABLE' | 'STALE_EVIDENCE'
  | 'CONTINUATION_RESOLVED' | 'CONTINUATION_LIMIT' | 'CONSENT_REQUIRED' | 'REVIEW_CHANGED'
  | 'NO_TOOL_TURN' | 'APPROVAL_EXPIRED';
export type ConversationActionResult = { readonly ok: true } | { readonly ok: false; readonly code: ConversationFailureCode };
export type ConversationOperation = 'preview' | 'approval' | 'ask' | 'readback' | 'continuation' | 'synthesis-preview' | 'synthesis-run';
type PlanningReview = { readonly stage: 'planning'; readonly request: ConversationRequest; readonly preview: Extract<ConversationPreview, { readonly purpose: 'conversation' }> };
type WritingReview = { readonly stage: 'final-writing'; readonly toolTurnId: string; readonly preview: Extract<ConversationPreview, { readonly purpose: 'conversation-synthesis' }> };
type Review = PlanningReview | WritingReview;
export type ConversationHostState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy'; readonly operation: ConversationOperation }
  | ({ readonly kind: 'review' } & Review)
  | { readonly kind: 'answer'; readonly saved: ConversationSavedAnswer }
  | { readonly kind: 'continuation'; readonly value: ConversationContinuation }
  | { readonly kind: 'unavailable'; readonly code: ConversationFailureCode };

/** A clicked consent must identify the actual displayed preview and payload. */
export interface ModelConsent {
  readonly previewId: string;
  readonly digest: string;
  readonly consent: boolean;
}
export interface ConversationHostOptions { readonly now?: () => number }
export interface ConversationHost {
  snapshot(): ConversationHostState;
  subscribe(listener: () => void): () => void;
  preview(request: ConversationDraft): Promise<ConversationActionResult>;
  open(id: string): Promise<ConversationActionResult>;
  selectContinuation(id: string): Promise<ConversationActionResult>;
  previewFinalWriting(): Promise<ConversationActionResult>;
  sendReviewed(consent: ModelConsent): Promise<ConversationActionResult>;
  /** Draft edits cancel old review/work while retaining only a selected server continuation. */
  editQuestion(): void;
  cancel(): void;
  invalidate(code?: ConversationFailureCode): void;
}

const success: ConversationActionResult = Object.freeze({ ok: true });
const failure = (code: ConversationFailureCode): ConversationActionResult => Object.freeze({ ok: false, code });
function freezeChecked(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const entry of Object.values(value)) freezeChecked(entry);
  Object.freeze(value);
}
function sameChecked(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((entry, index) => sameChecked(entry, b[index]));
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => sameChecked(Object.getOwnPropertyDescriptor(a, key)?.value, Object.getOwnPropertyDescriptor(b, key)?.value));
}
function errorCode(error: unknown): ConversationFailureCode {
  if (error instanceof ReplyValidationError) return 'INVALID_REPLY';
  let descriptor: PropertyDescriptor | undefined;
  try { descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined; }
  catch { return 'REQUEST_FAILED'; }
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (code === 'VAULT_LOCKED') return 'VAULT_LOCKED';
  if (code === 'UNAUTHENTICATED' || code === 'INVALID_SESSION' || code === 'authentication_required') return 'UNAUTHENTICATED';
  if (typeof code !== 'string') return 'REQUEST_FAILED';
  if (['ACCESS_DENIED', 'ACCESS_REVOKED', 'SOURCE_REVOKED', 'ROUTE_REVOKED', 'FORBIDDEN', 'BRANCH_FORBIDDEN', 'RECEIPT_FORBIDDEN', 'authority_denied'].includes(code)) return 'ACCESS_DENIED';
  if (code === 'OUTBOUND_APPROVAL_REQUIRED') return 'CONSENT_REQUIRED';
  if (code === 'CONVERSATION_CONTINUATION_RESOLVED') return 'CONTINUATION_RESOLVED';
  if (code === 'CONVERSATION_CONTINUATION_LIMIT') return 'CONTINUATION_LIMIT';
  if (['PREVIEW_STALE', 'PAYLOAD_CHANGED', 'PREVIEW_REQUEST_CHANGED', 'SYNTHESIS_STALE', 'CONVERSATION_CONTINUATION_STALE', 'MODEL_RECEIPT_EXPIRED', 'CALCULATION_STALE'].includes(code)) return 'STALE_EVIDENCE';
  if (['CONVERSATION_NOT_FOUND', 'CONVERSATION_CONTINUATION_UNAVAILABLE', 'RECEIPT_NOT_FOUND', 'MODEL_RECEIPT_NOT_FOUND', 'SYNTHESIS_UNAVAILABLE', 'EVIDENCE_UNAVAILABLE', 'not_found'].includes(code)) return 'EVIDENCE_UNAVAILABLE';
  return 'REQUEST_FAILED';
}

function consentSnapshot(value: ModelConsent): ModelConsent | null {
  if (!value || typeof value !== 'object') return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const take = (key: string): unknown => {
    const descriptor = descriptors[key];
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const consent = take('consent'), previewId = take('previewId'), digest = take('digest');
  return typeof consent === 'boolean' && typeof previewId === 'string' && typeof digest === 'string'
    ? { consent, previewId, digest } : null;
}

export function createConversationHost(port: ConversationHostPort, options: ConversationHostOptions = {}): ConversationHost {
  let generation = Symbol();
  let state: ConversationHostState = Object.freeze({ kind: 'idle' });
  let selectedContinuation: ConversationContinuation | null = null;
  let review: Review | null = null;
  const listeners = new Set<() => void>();
  const now = options.now ?? Date.now;
  const publish = (next: ConversationHostState) => {
    freezeChecked(next); state = next;
    // An observer cannot alter approval sequencing or prevent privacy cleanup.
    for (const listener of listeners) { try { listener(); } catch { /* observer owns its error reporting */ } }
  };
  const start = (operation: ConversationOperation, retainContinuation = false) => {
    const requested = Symbol(); generation = requested; review = null;
    if (!retainContinuation) selectedContinuation = null;
    publish({ kind: 'busy', operation });
    return requested;
  };
  const current = (requested: symbol) => generation === requested;
  const close = (requested: symbol, error: unknown): ConversationActionResult => {
    if (!current(requested)) return failure('READ_INVALIDATED');
    const code = errorCode(error);
    if (!current(requested)) return failure('READ_INVALIDATED');
    generation = Symbol(); review = null; selectedContinuation = null;
    publish({ kind: 'unavailable', code });
    return failure(code);
  };
  const invalidated = () => failure('READ_INVALIDATED');
  const readAfterDispatch = async (reply: ReturnType<typeof validateConversationReply>, requested: symbol, expectedQuestion: string): Promise<ConversationActionResult> => {
    if (!current(requested)) return invalidated();
    const id = 'id' in reply ? reply.id : reply.modelReceiptId;
    publish({ kind: 'busy', operation: 'readback' });
    if (!current(requested)) return invalidated();
    const raw = await port.request('conversation.get', conversationIdRequest(id));
    if (!current(requested)) return invalidated();
    const saved = validateConversationReadback(raw, id);
    if (saved.question !== expectedQuestion) throw new ReplyValidationError('conversation.readback.question');
    if (!sameChecked(saved.answer, reply)) throw new ReplyValidationError('conversation.readback.answer');
    if (!current(requested)) return invalidated();
    selectedContinuation = null;
    publish({ kind: 'answer', saved });
    return current(requested) ? success : invalidated();
  };
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async preview(draft: ConversationDraft) {
      const continuation = selectedContinuation;
      const requested = start('preview', true);
      try {
        if (!current(requested)) return invalidated();
        const input = validateConversationRequest(draft);
        if (input.continuationId !== undefined) throw new ReplyValidationError('conversation.request.continuationId');
        const request = validateConversationRequest(continuation ? { ...input, continuationId: continuation.turnId } : input);
        freezeChecked(request);
        if (!current(requested)) return invalidated();
        const raw = await port.request('models.preview', request);
        if (!current(requested)) return invalidated();
        const preview = await verifyModelPreview(raw, request);
        if (!current(requested)) return invalidated();
        if (preview.purpose !== 'conversation') throw new ReplyValidationError('conversation.preview.purpose');
        selectedContinuation = preview.continuation ?? null;
        review = { stage: 'planning', request, preview };
        publish({ kind: 'review', ...review });
        return current(requested) ? success : invalidated();
      } catch (error) { return close(requested, error); }
    },
    async open(id: string) {
      const requested = start('readback');
      try {
        if (!current(requested)) return invalidated();
        const raw = await port.request('conversation.get', conversationIdRequest(id));
        if (!current(requested)) return invalidated();
        const saved = validateConversationReadback(raw, id);
        if (!current(requested)) return invalidated();
        publish({ kind: 'answer', saved });
        return current(requested) ? success : invalidated();
      } catch (error) { return close(requested, error); }
    },
    async selectContinuation(id: string) {
      const requested = start('continuation');
      try {
        if (!current(requested)) return invalidated();
        const raw = await port.request('conversation.continuation', conversationIdRequest(id));
        if (!current(requested)) return invalidated();
        const value = await verifyConversationContinuation(raw, id);
        if (!current(requested)) return invalidated();
        selectedContinuation = value;
        publish({ kind: 'continuation', value });
        return current(requested) ? success : invalidated();
      } catch (error) { return close(requested, error); }
    },
    async previewFinalWriting() {
      if (state.kind !== 'answer' || state.saved.kind !== 'grounded-conversation') return failure('NO_TOOL_TURN');
      const id = state.saved.id;
      const requested = start('synthesis-preview');
      try {
        if (!current(requested)) return invalidated();
        const raw = await port.request('conversation.synthesis.preview', synthesisPreviewRequest(id));
        if (!current(requested)) return invalidated();
        const preview = await verifyModelPreview(raw, { id });
        if (!current(requested)) return invalidated();
        if (preview.purpose !== 'conversation-synthesis') throw new ReplyValidationError('conversation.synthesis.preview.purpose');
        review = { stage: 'final-writing', toolTurnId: id, preview };
        publish({ kind: 'review', ...review });
        return current(requested) ? success : invalidated();
      } catch (error) { return close(requested, error); }
    },
    async sendReviewed(consent: ModelConsent) {
      const observedGeneration = generation;
      const selected = review;
      let clicked: ModelConsent | null;
      try { clicked = consentSnapshot(consent); } catch { return failure('CONSENT_REQUIRED'); }
      if (!current(observedGeneration) || review !== selected) return invalidated();
      if (!clicked || clicked.consent !== true) return failure('CONSENT_REQUIRED');
      if (state.kind !== 'review' || !selected || clicked.previewId !== selected.preview.id || clicked.digest !== selected.preview.digest) return failure('REVIEW_CHANGED');
      // Consume this local review before awaiting approval; double presses cannot dispatch twice.
      const requested = start('approval', true);
      try {
        if (!current(requested)) return invalidated();
        const rawApproval = await port.request('models.approve', approveRequest(selected.preview));
        if (!current(requested)) return invalidated();
        const approval = validateOutboundApproval(rawApproval, selected.preview);
        const at = now();
        if (!current(requested)) return invalidated();
        if (!Number.isFinite(at) || Date.parse(approval.expiresAt) <= at) {
          generation = Symbol(); review = null; selectedContinuation = null;
          publish({ kind: 'unavailable', code: 'APPROVAL_EXPIRED' }); return failure('APPROVAL_EXPIRED');
        }
        let raw: unknown;
        if (selected.stage === 'planning') {
          publish({ kind: 'busy', operation: 'ask' });
          if (!current(requested)) return invalidated();
          raw = await port.request('conversation.ask', askRequest(selected.request, selected.preview, approval));
        } else {
          publish({ kind: 'busy', operation: 'synthesis-run' });
          if (!current(requested)) return invalidated();
          raw = await port.request('conversation.synthesis.run', synthesisRunRequest(selected.toolTurnId, selected.preview, approval));
        }
        if (!current(requested)) return invalidated();
        const expected = selected.stage === 'planning' ? { modelReceiptId: selected.preview.id, preview: selected.preview }
          : { toolTurnId: selected.toolTurnId, synthesisModelReceiptId: selected.preview.id, inputDigest: selected.preview.synthesisInputDigest, preview: selected.preview };
        const reply = await verifyConversationReply(raw, expected);
        if (!current(requested)) return invalidated();
        return await readAfterDispatch(reply, requested, selected.stage === 'planning' ? selected.request.question : selected.preview.naturalQuestion);
      } catch (error) { return close(requested, error); }
    },
    editQuestion() {
      generation = Symbol(); review = null;
      publish(selectedContinuation ? { kind: 'continuation', value: selectedContinuation } : { kind: 'idle' });
    },
    cancel() { generation = Symbol(); review = null; selectedContinuation = null; publish({ kind: 'idle' }); },
    invalidate(code: ConversationFailureCode = 'READ_INVALIDATED') {
      generation = Symbol(); review = null; selectedContinuation = null; publish({ kind: 'unavailable', code });
    },
  });
}

export function createDesktopConversationHost(port: ConversationEnginePort, options: ConversationHostOptions = {}): ConversationHost {
  return createConversationHost(port, options);
}

export function createBrowserConversationHost(port: ConversationRpcPort, options: ConversationHostOptions = {}): ConversationHost {
  return createConversationHost({ request: (method, payload) => port.call({ method, payload }) }, options);
}
