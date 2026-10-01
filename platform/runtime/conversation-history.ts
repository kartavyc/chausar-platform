import { canonical } from './actions.ts';
import { authorize, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import type { CalculationReceipt } from './calculator.ts';
import { renderBusinessAnswer, validateBusinessSelection, type BusinessContextManifest } from './conversation-context.ts';
import { assertSourceAccess } from './trust.ts';

export type ConversationHistoryKind = 'business-context' | 'calculation';
export type ConversationHistoryItem = { id: string; at: string; question: string; kind: ConversationHistoryKind; receiptId: string };
export type ConversationHistoryPage = { items: ConversationHistoryItem[]; nextCursor?: string };
export type ConversationHistoryAnswer = Omit<ConversationHistoryItem, 'receiptId'> & { answer: any };
export type ConversationHistoryOptions = {
  assertBusinessContext: (ctx: Context, manifest: BusinessContextManifest, view: StateStore) => unknown;
  receipt: (ctx: Context, id: string, view: StateStore) => CalculationReceipt;
};
export type CalculationAnswerRecord = {
  id: string; kind: 'calculation-answer'; at: string; memberId: string; epoch: number;
  question: string; answer: any; receiptId: string; sourceIds: string[]; rowIds: string[]; integrity: string;
};

const UNAVAILABLE = 'CONVERSATION_NOT_FOUND';
const MAX_BYTES = 4 * 1024 * 1024;
function plain(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function reference(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(reference) && new Set(value).size === value.length;
}
// Persisted records are JSON. Normalization removes optional undefined receipt
// fields equally before and after encrypted file serialization.
function json(value: unknown): any {
  const text = JSON.stringify(value);
  check(typeof text === 'string' && Buffer.byteLength(text) <= MAX_BYTES, UNAVAILABLE, 'This saved answer is unavailable.');
  const clean = JSON.parse(text); canonical(clean); return clean;
}
function same(a: unknown, b: unknown): boolean { return canonical(json(a)) === canonical(json(b)); }
export function conversationRecordIntegrity(record: unknown): string {
  check(plain(record), UNAVAILABLE, 'This saved answer is unavailable.');
  const { integrity: ignored, ...body } = record;
  return hash(canonical(json(body)));
}
function receiptRows(receipt: CalculationReceipt): string[] {
  check(ids(receipt.rowIds) && Array.isArray(receipt.exclusions), UNAVAILABLE, 'This saved answer is unavailable.');
  check(receipt.exclusions.every(item => plain(item) && reference(item.rowId)), UNAVAILABLE, 'This saved answer is unavailable.');
  return [...new Set([...receipt.rowIds, ...receipt.exclusions.map(item => item.rowId)])];
}
function receiptSources(receipt: CalculationReceipt): string[] {
  check(ids(receipt.sourceIds) && Array.isArray(receipt.rows) && receipt.rows.every(row => plain(row) && reference(row.sourceId)), UNAVAILABLE, 'This saved answer is unavailable.');
  return [...new Set([...receipt.sourceIds, ...receipt.rows.map(row => row.sourceId)])];
}
function calculationAnswer(answer: unknown, receipt: CalculationReceipt) {
  check(plain(answer), UNAVAILABLE, 'This saved answer is unavailable.');
  if (answer.supported === true) {
    check(Object.keys(answer).every(key => ['supported', 'message', 'receipt'].includes(key)) && answer.message === receipt.explanation && same(answer.receipt, receipt), UNAVAILABLE, 'This saved answer is unavailable.');
  } else check(same(answer, receipt), UNAVAILABLE, 'This saved answer is unavailable.');
}

/** Called inside the Engine's authorized transaction, with a freshly guarded saved receipt. */
export function createCalculationAnswerRecord(ctx: Context, question: string, answer: unknown, receipt: CalculationReceipt, at = now()): CalculationAnswerRecord {
  check(receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch && receipt.stale === false && reference(receipt.id)
    && timestamp(at) && typeof question === 'string' && question.trim().length > 0 && question.length <= 8000, UNAVAILABLE, 'This saved answer is unavailable.');
  calculationAnswer(answer, receipt);
  const record = { id: newId('message'), kind: 'calculation-answer' as const, at, memberId: ctx.memberId, epoch: ctx.epoch,
    question, answer: json(answer), receiptId: receipt.id, sourceIds: receiptSources(receipt), rowIds: receiptRows(receipt) };
  return { ...record, integrity: conversationRecordIntegrity(record) };
}

/** Current authority is injected by the Engine, including its managed-source readiness guards. */
export class ConversationHistoryService {
  readonly store: StateStore;
  readonly options: ConversationHistoryOptions;
  constructor(store: StateStore, options: ConversationHistoryOptions) {
    check(typeof options?.assertBusinessContext === 'function' && typeof options.receipt === 'function', 'HISTORY_GUARD_REQUIRED', 'History requires the current evidence guards.');
    this.store = store; this.options = options;
  }
  currentReceipt(ctx: Context, id: string, view: StateStore = this.store): CalculationReceipt {
    authorize(view, ctx);
    const receipt = this.options.receipt(ctx, id, view), state = view.read();
    check(plain(receipt) && receipt.id === id && receipt.memberId === ctx.memberId && receipt.epoch === ctx.epoch && receipt.stale === false, UNAVAILABLE, 'This saved answer is unavailable.');
    this.retained(view, receipt.createdAt);
    assertSourceAccess(state, ctx, receiptSources(receipt));
    for (const rowId of receiptRows(receipt)) {
      const fact = state.facts.find(item => item.id === rowId);
      check(fact && !fact.deletedAt && !state.tombstones.some(item => item.factId === rowId), UNAVAILABLE, 'This saved answer is unavailable.');
      this.retained(view, fact.learnedAt);
    }
    return structuredClone(receipt);
  }
  list(ctx: Context, input: { limit?: number; cursor?: string } = {}): ConversationHistoryPage {
    const view = this.snapshot(); authorize(view, ctx);
    check(plain(input) && Object.keys(input).every(key => ['limit', 'cursor'].includes(key))
      && (input.limit === undefined || Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 50), 'INVALID_HISTORY_REQUEST', 'Choose a history page of one to fifty answers.');
    check(input.cursor === undefined || reference(input.cursor), 'INVALID_HISTORY_CURSOR', 'This history cursor is unavailable.');
    const candidates = view.read().conversations.filter(record => plain(record) && record.memberId === ctx.memberId && timestamp(record.at)
      && (record.kind === 'business-context-answer' || record.kind === 'calculation-answer' || record.role === 'user' && reference(record.resultId)))
      .sort((a, b) => b.at.localeCompare(a.at) || String(b.id).localeCompare(String(a.id)));
    let start = 0;
    if (input.cursor !== undefined) {
      const index = candidates.findIndex(record => record.id === input.cursor);
      check(index >= 0 && this.admit(view, ctx, candidates[index]), 'INVALID_HISTORY_CURSOR', 'This history cursor is unavailable.'); start = index + 1;
    }
    const found: ConversationHistoryItem[] = [], limit = input.limit ?? 20;
    for (const record of candidates.slice(start)) {
      const saved = this.admit(view, ctx, record); if (!saved) continue;
      found.push(saved.item); if (found.length > limit) break;
    }
    return { items: found.slice(0, limit), ...(found.length > limit ? { nextCursor: found[limit - 1].id } : {}) };
  }
  get(ctx: Context, id: string): ConversationHistoryAnswer {
    const view = this.snapshot(); authorize(view, ctx);
    const matches = reference(id) ? view.read().conversations.filter(record => record?.id === id) : [];
    const saved = matches.length === 1 ? this.admit(view, ctx, matches[0]) : undefined;
    check(saved, UNAVAILABLE, 'This saved answer is unavailable under current access.');
    const { receiptId: ignored, ...item } = saved.item; return { ...item, answer: structuredClone(saved.answer) };
  }
  private snapshot(): StateStore {
    const state = this.store.read();
    return { read: () => state, update: async () => { throw new Error('History is read-only.'); } };
  }
  private retained(view: StateStore, at: unknown) {
    const days = view.read().policy.retentionDays;
    check(timestamp(at) && Number.isFinite(days) && days >= 0 && Date.parse(at) >= Date.now() - days * 86400000, UNAVAILABLE, 'This saved answer is unavailable.');
  }
  private admit(view: StateStore, ctx: Context, record: any): { item: ConversationHistoryItem; answer: any } | undefined {
    try {
      check(plain(record) && reference(record.id) && record.memberId === ctx.memberId && typeof record.question === 'string' && record.question.trim().length > 0 && record.question.length <= 8000, UNAVAILABLE, 'This saved answer is unavailable.');
      check(view.read().conversations.filter(item => item?.id === record.id).length === 1, UNAVAILABLE, 'This saved answer is unavailable.');
      this.retained(view, record.at);
      if (record.integrity !== undefined) check(typeof record.integrity === 'string' && record.integrity === conversationRecordIntegrity(record), UNAVAILABLE, 'This saved answer is unavailable.');
      let kind: ConversationHistoryKind, receiptId: string, answer: any;
      if (record.kind === 'business-context-answer') {
        check(record.epoch === ctx.epoch, UNAVAILABLE, 'This saved answer is unavailable.');
        this.options.assertBusinessContext(ctx, record.manifest, view);
        answer = this.businessAnswer(view, ctx, record); kind = 'business-context'; receiptId = answer.receipt.id;
      } else {
        const legacy = record.kind === undefined && record.role === 'user' && reference(record.resultId);
        check(legacy || record.kind === 'calculation-answer' && record.epoch === ctx.epoch && typeof record.integrity === 'string', UNAVAILABLE, 'This saved answer is unavailable.');
        check(record.epoch === undefined || record.epoch === ctx.epoch, UNAVAILABLE, 'This saved answer is unavailable.');
        receiptId = legacy ? record.resultId : record.receiptId;
        check(reference(receiptId), UNAVAILABLE, 'This saved answer is unavailable.');
        const receipt = this.currentReceipt(ctx, receiptId, view);
        if (legacy) answer = { supported: true, message: receipt.explanation, receipt };
        else {
          calculationAnswer(record.answer, receipt);
          check(same(record.rowIds, receiptRows(receipt)) && same(record.sourceIds, receiptSources(receipt)), UNAVAILABLE, 'This saved answer is unavailable.');
          answer = json(record.answer);
        }
        kind = 'calculation';
      }
      return { item: { id: record.id, at: record.at, question: record.question, kind, receiptId }, answer };
    } catch { return undefined; }
  }
  private businessAnswer(view: StateStore, ctx: Context, record: any) {
    const manifest = record.manifest as BusinessContextManifest, answer = record.answer;
    check(plain(answer) && answer.kind === 'business-context' && answer.id === record.id && answer.contextDigest === manifest.digest
      && same(record.sourceIds, manifest.sourceIds) && same(record.rowIds, manifest.rowIds) && same(record.profileIds, manifest.profileIds), UNAVAILABLE, 'This saved answer is unavailable.');
    check(Array.isArray(answer.claims), UNAVAILABLE, 'This saved answer is unavailable.');
    const selection = validateBusinessSelection({ claimIds: answer.claims.map((claim: any) => claim?.id), unknownCategories: manifest.unknownCategories }, manifest);
    // Validate legacy text with the existing renderer; the saved answer itself
    // is returned unchanged. The Engine's injected assertion proves the exact
    // current manifest, including every managed domain before forwarding its
    // qualified scope to the renderer's mandatory readiness hook.
    const expected = renderBusinessAnswer(view, ctx, manifest, selection, {
      assertEvidenceReady: (currentCtx, refs) => {
        this.options.assertBusinessContext(currentCtx, manifest, view);
        return { qualifiedSourceIds: refs.managedSourceIds };
      },
    });
    const { id: ignoredId, receipt, ...body } = answer;
    check(same(body, expected) && plain(receipt) && Object.keys(receipt).every(key => ['id', 'kind', 'contextDigest', 'financialCalculation', 'sourceIds', 'rowIds', 'modelReceiptId'].includes(key))
      && receipt.id === record.id && receipt.kind === 'business-context-receipt' && receipt.contextDigest === manifest.digest && receipt.financialCalculation === false
      && same(receipt.sourceIds, manifest.sourceIds) && same(receipt.rowIds, manifest.rowIds), UNAVAILABLE, 'This saved answer is unavailable.');
    if (receipt.modelReceiptId !== undefined) {
      const model = view.read().modelReceipts.find(item => item.id === receipt.modelReceiptId);
      check(model && model.memberId === ctx.memberId && model.epoch === ctx.epoch && model.contextDigest === manifest.digest, UNAVAILABLE, 'This saved answer is unavailable.');
      this.retained(view, model.at ?? model.createdAt);
    }
    return json(answer);
  }
}
