import { authorize, check, hash, newId, now, type Context, type StateStore } from './contracts.ts';
import { ConversationHistoryService, conversationRecordIntegrity } from './conversation-history.ts';
import type { CalculationReceipt } from './calculator.ts';
import type { BusinessClaim } from './conversation-context.ts';
import type { ConversationSynthesisCodec, GatewaySynthesisAuthority, GroundedSynthesisOutput, GroundedToolSummary,
  SynthesisEvidence, SynthesisLocalEvidence, SynthesisTool } from './conversation-synthesis-contract.ts';

export type SynthesizedConversation = {
  id: string; kind: 'synthesized-conversation'; paragraphs: string[]; cautions: { ref: string; text: string }[];
  references: { evidenceRefs: string[]; answerIds: string[]; receiptIds: string[]; citationIds: string[] }[];
  tools: any;
  receipt: { id: string; kind: 'conversation-synthesis-receipt'; toolTurnId: string; plannerModelReceiptId: string;
    synthesisModelReceiptId: string; inputDigest: string; outputDigest: string };
};
export type ConversationSynthesisHostOptions = {
  history: (view: StateStore) => ConversationHistoryService;
  planner: (ctx: Context, id: string, view: StateStore) => any;
  synthesis: (ctx: Context, id: string, view: StateStore) => any;
  codec: () => ConversationSynthesisCodec | undefined;
};
const STALE = 'SYNTHESIS_STALE', INVALID = 'INVALID_SYNTHESIS';
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (left: unknown, right: unknown): boolean => hash(clean(left)) === hash(clean(right));
function exact(value: unknown, keys: string[]) {
  check(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), STALE, 'The retained synthesis binding changed.');
}
const sorted = (values: string[]) => [...new Set(values)].sort();
type WithoutAliases<T> = T extends unknown ? Omit<T, 'ref' | 'resultRef'> : never;

/** Local-only source projection and durable admission. No RPC/model can install these guards. */
export class ConversationSynthesisHost {
  readonly store: StateStore; readonly options: ConversationSynthesisHostOptions;
  readonly #resolving = new Set<string>();
  constructor(store: StateStore, options: ConversationSynthesisHostOptions) { this.store = store; this.options = options; }
  codec(): ConversationSynthesisCodec {
    const codec = this.options.codec();
    check(codec && typeof codec.schema === 'function' && typeof codec.validate === 'function' && typeof codec.materialize === 'function'
      && typeof codec.instructions === 'string' && codec.instructions.length > 0, 'SYNTHESIS_UNAVAILABLE', 'The grounded final-answer module is not installed.');
    return codec;
  }
  resolve(ctx: Context, toolTurnId: string, view: StateStore = this.store): GatewaySynthesisAuthority {
    authorize(view, ctx); check(reference(toolTurnId), INVALID, 'Choose one current retained tool turn.');
    const key = `${ctx.memberId}:${ctx.epoch}:${toolTurnId}`;
    check(!this.#resolving.has(key) && this.#resolving.size < 8, INVALID, 'A synthesis must reference a local tool turn, not another synthesis.');
    this.#resolving.add(key);
    try {
      const history = this.options.history(view), turn = history.get(ctx, toolTurnId), state = view.read();
      check(turn.id === toolTurnId && turn.kind === 'grounded-conversation' && turn.answer?.kind === 'grounded-conversation',
        'SYNTHESIS_UNAVAILABLE', 'Complete the current local tool results before preparing a final answer.');
      const records = state.conversations.filter(item => item?.id === toolTurnId), record = records[0];
      check(records.length === 1 && record.kind === 'conversation-tools-answer', STALE, 'The retained tool turn changed.');
      const model = this.options.planner(ctx, turn.answer.modelReceiptId, view);
      const question = model.continuation?.originalQuestion ?? model.naturalQuestion;
      check(typeof question === 'string' && question.trim().length > 0 && question.length <= 8000, STALE, 'The original reviewed objective is unavailable.');
      const summary: GroundedToolSummary = { schemaVersion: 1, question, results: [], evidence: [], citationRefs: [] };
      const local: SynthesisLocalEvidence[] = [];
      let childIndex = 0;
      const add = (resultRef: string, answerId: string, item: WithoutAliases<SynthesisEvidence>, renderText: string,
        metadata: Partial<SynthesisLocalEvidence> = {}) => {
        check(typeof renderText === 'string' && renderText.length > 0 && renderText.length <= 20000, INVALID, 'A retained result exceeds the final-answer text budget.');
        const ref = `e${summary.evidence.length + 1}`;
        summary.evidence.push({ ...item, ref, resultRef } as SynthesisEvidence);
        local.push({ ref, resultRef, answerId, evidenceHash: hash({ item, renderText, metadata }), renderText, ...metadata });
        return ref;
      };
      const caution = (resultRef: string, answerId: string, code: string, label: string, text = label) =>
        add(resultRef, answerId, { kind: 'caution', code, label, required: true }, text);
      for (const [index, result] of turn.answer.results.entries()) {
        const resultRef = `r${index + 1}`, start = summary.evidence.length, tool: SynthesisTool = result.tool;
        let status: 'ok' | 'partial' | 'unavailable' = 'ok';
        if (result.error) {
          status = 'unavailable';
          caution(resultRef, toolTurnId, result.error.code, 'This tool result is unavailable.', result.error.message);
        } else {
          const childRef = record.resultRefs[childIndex++];
          check(childRef?.tool === tool, STALE, 'The ordered tool-result references changed.');
          const child = history.get(ctx, childRef.answerId), answer = child.answer;
          if (tool === 'business.describe') {
            const citationAliases = new Map<string, string>();
            for (const citation of answer.citations) {
              const alias = `c${summary.citationRefs.length + 1}`;
              summary.citationRefs.push(alias); citationAliases.set(citation.id, alias);
            }
            for (const claim of answer.claims as BusinessClaim[]) {
              const citationRefs = claim.citationIds.map(id => {
                const alias = citationAliases.get(id); check(alias, STALE, 'A current business citation is unavailable.'); return alias;
              });
              add(resultRef, child.id, { kind: 'claim', text: claim.text, origin: claim.origin,
                qualification: claim.qualification, citationRefs }, claim.text, { citationIds: [...claim.citationIds] });
              if (claim.qualification === 'draft' || claim.qualification === 'unqualified-observation')
                caution(resultRef, child.id, 'UNQUALIFIED_CLAIM', 'This claim is not established evidence.',
                  claim.qualification === 'draft' ? 'A draft assumption is not an established business fact.' : 'An observed source claim has not been qualified as an established business fact.');
            }
            for (const unknown of answer.unknowns) caution(resultRef, child.id, 'BUSINESS_UNKNOWN',
              `The ${unknown.category.replaceAll('_', ' ')} description is unknown.`, unknown.message);
            for (const conflict of answer.conflicts) caution(resultRef, child.id, 'BUSINESS_CONFLICT',
              'Permitted source claims conflict.', conflict.reason);
            for (const limitation of answer.scope.limitations) caution(resultRef, child.id, 'BUSINESS_LIMITATION', 'Business evidence has a documented limitation.', limitation);
            if (answer.scope.syntheticFixture) caution(resultRef, child.id, 'SYNTHETIC_FIXTURE', 'Synthetic evidence is not live-qualified.');
            status = answer.status === 'grounded' ? 'ok' : 'partial';
          } else {
            const receipt: CalculationReceipt = history.currentReceipt(ctx, answer.receipt?.id ?? answer.id, view);
            check(state.receipts.filter(item => item?.id === receipt.id).length === 1, STALE, 'The exact calculation receipt is ambiguous.');
            for (const figure of receipt.figures) add(resultRef, child.id, { kind: 'figure', label: figure.label,
              unit: figure.unit, ...(figure.currency ? { currency: figure.currency } : {}) }, figure.display,
              { receiptId: receipt.id, figureKey: figure.key });
            add(resultRef, child.id, { kind: 'scope', label: 'Calculation period' }, receipt.period
              ? `${receipt.period.from} to ${receipt.period.to}` : 'All periods in the selected records');
            add(resultRef, child.id, { kind: 'scope', label: 'Selected branch' }, receipt.branch ?? 'All permitted branches in the selected sources');
            add(resultRef, child.id, { kind: 'scope', label: 'Known-on timestamp' }, receipt.asOf);
            if (receipt.comparePeriod) add(resultRef, child.id, { kind: 'scope', label: 'Comparison period' }, `${receipt.comparePeriod.from} to ${receipt.comparePeriod.to}`);
            if (receipt.coverage.completeness !== 'reconciled-imports') {
              status = 'partial'; caution(resultRef, child.id, 'CALCULATION_COVERAGE', 'The calculation has bounded or incomplete evidence coverage.',
                `Calculation coverage: ${receipt.coverage.completeness}. This figure describes only the retained selected records.`);
            }
            for (const gap of receipt.coverage.gaps) caution(resultRef, child.id, 'CALCULATION_GAP', 'A calculation coverage gap remains.', gap);
            if (receipt.exclusions.length) caution(resultRef, child.id, 'CALCULATION_EXCLUSIONS', 'Some selected records were excluded.',
              `${receipt.exclusions.length} selected records were excluded; see the exact calculation receipt.`);
            if (receipt.coverage.unresolvedConflicts) caution(resultRef, child.id, 'CALCULATION_CONFLICTS', 'Some selected records have unresolved conflicts.',
              `${receipt.coverage.unresolvedConflicts} unresolved conflicts remain; see the calculation receipt.`);
            if (Object.keys(receipt.assumptions).length) caution(resultRef, child.id, 'CALCULATION_ASSUMPTIONS', 'This is an assumption-based calculation.',
              'These figures depend on the assumptions retained in the calculation receipt; they are not measured future results.');
            if (model.businessContext?.scope.syntheticFixture) caution(resultRef, child.id, 'SYNTHETIC_FIXTURE', 'Synthetic evidence is not live-qualified.');
          }
        }
        summary.results.push({ ref: resultRef, tool, status, evidenceRefs: summary.evidence.slice(start).map(item => item.ref) });
      }
      check(childIndex === record.resultRefs.length && Buffer.byteLength(JSON.stringify(summary)) <= 131072, INVALID, 'The bounded current tool summary is unavailable.');
      const sourceIds = sorted([...(model.businessContext?.request.sourceIds ?? model.sourceIds), ...record.sourceIds]);
      const rowIds = sorted(record.rowIds);
      return clean({ summary, binding: { toolTurnId, plannerModelReceiptId: model.id, toolResultsDigest: hash(clean(turn.answer)),
        inputDigest: hash(summary), evidence: local }, sourceIds, factIds: rowIds, rowIds });
    } finally { this.#resolving.delete(key); }
  }
  private materialize(ctx: Context, model: any, view: StateStore) {
    const authority = this.resolve(ctx, model.toolTurnId, view), codec = this.codec();
    check(model.synthesisAuthorityDigest === hash(authority) && model.synthesisInputDigest === authority.binding.inputDigest,
      STALE, 'The reviewed tool results changed before final rendering.');
    const output: GroundedSynthesisOutput = codec.validate(model.synthesisOutputWire, authority.summary);
    check(equal(output, model.synthesisOutput) && hash(output) === model.synthesisOutputDigest, STALE, 'The admitted final-answer output changed.');
    const slots = new Map(authority.binding.evidence.map(item => [item.ref, item]));
    const evidence = new Map(authority.summary.evidence.map(item => [item.ref, item]));
    const resolve = (ref: string) => { const slot = slots.get(ref); check(slot, INVALID, 'The final answer references unavailable evidence.'); return slot.renderText; };
    check(Array.isArray(output.paragraphs) && output.paragraphs.length > 0 && output.paragraphs.length <= 12, INVALID, 'The final answer needs bounded grounded paragraphs.');
    for (const paragraph of output.paragraphs) {
      check(Array.isArray(paragraph.evidenceRefs) && paragraph.evidenceRefs.length > 0
        && new Set(paragraph.evidenceRefs).size === paragraph.evidenceRefs.length && paragraph.evidenceRefs.every(ref => evidence.has(ref)), INVALID, 'A final paragraph needs current evidence references.');
      check(Array.isArray(paragraph.parts) && paragraph.parts.length > 0 && paragraph.parts.length <= 64
        && paragraph.parts.every(part => plain(part) && (part.kind === 'text' && Object.keys(part).length === 2 && typeof part.text === 'string'
          || part.kind === 'slot' && Object.keys(part).length === 2 && typeof part.ref === 'string' && paragraph.evidenceRefs.includes(part.ref)
            && evidence.has(part.ref) && evidence.get(part.ref)!.kind !== 'caution')), INVALID, 'A final answer can only render declared current text and evidence slots.');
    }
    const required = authority.summary.evidence.filter(item => item.kind === 'caution').map(item => item.ref);
    check(Array.isArray(output.cautionRefs) && new Set(output.cautionRefs).size === output.cautionRefs.length
      && equal([...output.cautionRefs].sort(), [...required].sort()), INVALID, 'The final answer cannot suppress required warnings.');
    const rendered = codec.materialize(output, authority.summary, resolve);
    const expected = output.paragraphs.map(paragraph => paragraph.parts.map(part => part.kind === 'text' ? part.text : resolve(part.ref)).join(''));
    check(plain(rendered) && Object.keys(rendered).length === 1 && equal(rendered.paragraphs, expected)
      && expected.every(text => text.trim().length > 0 && text.length <= 20000), INVALID, 'Exact values must render from the current local receipts.');
    const references = output.paragraphs.map(paragraph => ({ evidenceRefs: [...paragraph.evidenceRefs],
      answerIds: sorted(paragraph.evidenceRefs.map(ref => slots.get(ref)!.answerId)),
      receiptIds: sorted(paragraph.evidenceRefs.flatMap(ref => slots.get(ref)!.receiptId ? [slots.get(ref)!.receiptId!] : [])),
      citationIds: sorted(paragraph.evidenceRefs.flatMap(ref => slots.get(ref)!.citationIds ?? [])) }));
    return { authority, paragraphs: expected, references, cautions: required.map(ref => ({ ref, text: resolve(ref) })) };
  }
  async retain(ctx: Context, synthesisModelReceiptId: string): Promise<SynthesizedConversation> {
    this.codec();
    return this.store.update(state => {
      const view: StateStore = { read: () => state, update: this.store.update.bind(this.store) }; authorize(view, ctx);
      const model = this.options.synthesis(ctx, synthesisModelReceiptId, view), rendered = this.materialize(ctx, model, view);
      // A single dispatched synthesis receipt creates one durable final answer.
      check(!state.conversations.some(item => item.kind === 'conversation-synthesis-answer' && item.synthesisModelReceiptId === model.id),
        'SYNTHESIS_ALREADY_RETAINED', 'This exact final-answer result is already retained.');
      const id = newId('conversation_final'), tools = this.options.history(view).get(ctx, model.toolTurnId).answer;
      const answer: SynthesizedConversation = { id, kind: 'synthesized-conversation', paragraphs: rendered.paragraphs,
        references: rendered.references, cautions: rendered.cautions, tools, receipt: { id, kind: 'conversation-synthesis-receipt', toolTurnId: model.toolTurnId,
          plannerModelReceiptId: rendered.authority.binding.plannerModelReceiptId, synthesisModelReceiptId: model.id,
          inputDigest: rendered.authority.binding.inputDigest, outputDigest: model.synthesisOutputDigest } };
      const body = clean({ id, kind: 'conversation-synthesis-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch,
        question: rendered.authority.summary.question, answer, toolTurnId: model.toolTurnId, synthesisModelReceiptId: model.id,
        sourceIds: rendered.authority.sourceIds, rowIds: rendered.authority.rowIds });
      state.conversations.push({ ...body, integrity: conversationRecordIntegrity(body) });
      return clean(answer);
    });
  }
  assertRecord(ctx: Context, record: any, view: StateStore): SynthesizedConversation {
    authorize(view, ctx);
    exact(record, ['id', 'kind', 'at', 'memberId', 'epoch', 'question', 'answer', 'toolTurnId', 'synthesisModelReceiptId', 'sourceIds', 'rowIds', 'integrity']);
    check(record.kind === 'conversation-synthesis-answer' && reference(record.id) && record.memberId === ctx.memberId && record.epoch === ctx.epoch
      && reference(record.toolTurnId) && reference(record.synthesisModelReceiptId) && digest(record.integrity)
      && conversationRecordIntegrity(record) === record.integrity, STALE, 'The retained final answer is unavailable.');
    const model = this.options.synthesis(ctx, record.synthesisModelReceiptId, view), rendered = this.materialize(ctx, model, view);
    check(record.toolTurnId === model.toolTurnId && record.question === rendered.authority.summary.question
      && equal(record.sourceIds, rendered.authority.sourceIds) && equal(record.rowIds, rendered.authority.rowIds), STALE, 'The retained final-answer scope changed.');
    const expected: SynthesizedConversation = { id: record.id, kind: 'synthesized-conversation', paragraphs: rendered.paragraphs, references: rendered.references, cautions: rendered.cautions,
      tools: this.options.history(view).get(ctx, model.toolTurnId).answer,
      receipt: { id: record.id, kind: 'conversation-synthesis-receipt', toolTurnId: model.toolTurnId,
        plannerModelReceiptId: rendered.authority.binding.plannerModelReceiptId, synthesisModelReceiptId: model.id,
        inputDigest: rendered.authority.binding.inputDigest, outputDigest: model.synthesisOutputDigest } };
    check(equal(record.answer, expected), STALE, 'The retained final-answer text or receipt changed.');
    return clean(expected);
  }
}
