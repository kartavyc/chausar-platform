/**
 * `todayx.receiptDetail`: the receipt's small print, composed only from records the engine
 * already keeps. The calculation receipt itself is read through `receipts.get` as the same
 * caller, so a seat that may not read the receipt gets that method's refusal and nothing
 * else. Every other line is present only when a record supports it:
 *
 * - question: a `calculation-answer` conversation record of this seat that names the receipt;
 * - sources: the receipt's source ids, the way in and the oldest read time of the visible
 *   source records (`sources.list`, so a hidden source adds nothing);
 * - recipe: the import's retained mapping recipe id, its qualification and the person whose
 *   recorded import decision accepted it, when every source of the receipt has one recipe;
 * - meaning: the dictionary version the receipt names and who published it (review and
 *   co-sign are not recorded by the engine yet, so they never appear);
 * - rate: the one exchange rate recorded on the receipt's rows;
 * - number guard and route: only when a model turn this seat may see linked the answer;
 * - allowed by: the recorded approval of that model send, otherwise the read access the
 *   receipt was made under (who and when). Rule id, check step and device are not recorded.
 */
import type { Context, State } from '../contracts.ts';
import { numberGuard } from '../calculator.ts';

type Rec = Record<string, any>;
export type WayIn = 'interface' | 'exported-file' | 'computer-export';
export type ReceiptDetail = {
  receiptId: string;
  question?: string;
  sources?: { names: string[]; wayIn?: WayIn; readAt?: string };
  recipe?: { recipeId: string; state: 'seed' | 'tested' | 'not-yet-tested' | 'failed'; acceptedBy: string; grade: 'model' | 'owner' | 'accountant' | 'ca' | 'reconciled' };
  meaning?: { version: string; publishedBy: string };
  rate?: { numerator: string; denominator: string; from: string; to: string };
  numberGuard?: { passed: boolean; matched: string; of: string };
  allowedBy: { kind: 'read-access' | 'send-approved'; person?: string; at?: string };
  route?: { kind: string; sendLevel: 'nothing' | 'shape' | 'samples'; costPaise: string | null };
};

const isIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value));
const digits = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(value);
const plainText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);

function personName(state: State, memberId: unknown): string | undefined {
  const member = state.members.find(item => item.id === memberId);
  return member && plainText(member.name) ? member.name : undefined;
}
function gradeOf(role: unknown): 'owner' | 'accountant' | undefined {
  return role === 'owner' || role === 'cofounder' ? 'owner' : role === 'accountant' ? 'accountant' : undefined;
}

/** The written answer a model turn linked to this receipt, with that model receipt. */
function modelLink(state: State, ctx: Context, answerIds: ReadonlySet<string>, visibleModels: readonly Rec[]): Rec | undefined {
  for (const record of [...state.conversations].reverse()) {
    if (record?.kind !== 'conversation-tools-answer' || record.memberId !== ctx.memberId || !Array.isArray(record.resultRefs)) continue;
    if (!record.resultRefs.some((ref: Rec) => answerIds.has(ref?.answerId))) continue;
    const model = visibleModels.find(item => item?.id === record.modelReceiptId && item?.kind === 'model-preview');
    if (model) return model;
  }
  return undefined;
}

export function composeReceiptDetail(state: State, ctx: Context, receipt: Rec, visibleSources: readonly Rec[], visibleModels: readonly Rec[]): ReceiptDetail {
  const detail: ReceiptDetail = { receiptId: receipt.id, allowedBy: { kind: 'read-access' } };

  const answers = state.conversations.filter(item => item?.kind === 'calculation-answer' && item.receiptId === receipt.id && item.memberId === ctx.memberId);
  const asked = answers.find(item => plainText(item.question, 8000));
  if (asked) detail.question = asked.question.trim();

  const sourceIds: string[] = Array.isArray(receipt.sourceIds) ? receipt.sourceIds.filter((id: unknown) => plainText(id)) : [];
  if (sourceIds.length > 0) {
    const records = visibleSources.filter(item => sourceIds.includes(item?.sourceId));
    const ways = new Set(records.map(item => (typeof item.format === 'string' ? 'exported-file' : item.domain ? 'interface' : null)));
    const reads = records.map(item => item.at).filter(isIso).sort();
    const covered = sourceIds.every(id => records.some(item => item.sourceId === id));
    detail.sources = {
      names: sourceIds,
      ...(covered && ways.size === 1 && !ways.has(null) ? { wayIn: [...ways][0] as WayIn } : {}),
      ...(covered && reads.length > 0 ? { readAt: reads[0] } : {}),
    };
    // The newest visible import of each source, read before the receipt was made.
    const imports = sourceIds.map(id => state.imports.filter(item => item?.sourceId === id && typeof item.format === 'string'
      && records.some(visible => visible.id === item.id) && isIso(item.at) && item.at <= receipt.createdAt).at(-1));
    const recipeIds = new Set(imports.map(item => item?.retainedInput?.input?.recipe?.id));
    if (imports.every(Boolean) && recipeIds.size === 1 && imports.length === 1) {
      const imported = imports[0]!, recipeId = [...recipeIds][0];
      const decision = state.learning.find(item => item?.type === 'decision' && item.importIdentity?.id === imported.id && item.importIdentity?.outcome === 'accepted');
      const acceptedBy = decision ? personName(state, decision.memberId) : undefined;
      const grade = imported.coverage?.reconciled === true ? 'reconciled' as const : gradeOf(decision?.role);
      // The engine qualifies every file recipe as experimental: it has not been tested yet.
      if (plainText(recipeId) && acceptedBy && grade && imported.qualification === 'experimental') detail.recipe = { recipeId, state: 'not-yet-tested', acceptedBy, grade };
    }
  }

  const dictionary = (Array.isArray(state.ontology?.history) ? state.ontology.history : [])
    .find((item: Rec) => item?.hash === receipt.dictionaryHash && item?.version === receipt.ontologyVersion);
  const publisher = dictionary ? personName(state, dictionary.publishedBy) : undefined;
  if (dictionary && publisher && Number.isSafeInteger(dictionary.version)) detail.meaning = { version: String(dictionary.version), publishedBy: publisher };

  const rates = new Map<string, Rec>();
  for (const row of Array.isArray(receipt.rows) ? receipt.rows : []) {
    const n = row?.normalization;
    if (n && digits(n.rate?.numerator) && digits(n.rate?.denominator) && plainText(n.sourceCurrency, 8) && plainText(n.targetCurrency, 8))
      rates.set(JSON.stringify([n.rate.numerator, n.rate.denominator, n.sourceCurrency, n.targetCurrency]), n);
  }
  if (rates.size === 1) {
    const n = [...rates.values()][0]!;
    detail.rate = { numerator: n.rate.numerator, denominator: n.rate.denominator, from: n.sourceCurrency, to: n.targetCurrency };
  }

  const model = modelLink(state, ctx, new Set(answers.map(item => item.id)), visibleModels);
  if (model) {
    const written = answers.map(item => item.answer?.message ?? item.answer?.explanation).find(text => typeof text === 'string');
    if (typeof written === 'string' && Array.isArray(receipt.allowedNumbers)) {
      try {
        const checked = numberGuard(written, receipt as any);
        detail.numberGuard = { passed: true, matched: String(checked.checkedNumbers), of: String(checked.checkedNumbers) };
      } catch { /* A failed guard never reached a stored answer; nothing is claimed. */ }
    }
    const route = state.routes.find(item => item?.id === model.routeId);
    if (route && plainText(route.kind, 40) && ['nothing', 'shape', 'samples'].includes(model.send)) {
      detail.route = { kind: route.kind, sendLevel: model.send, costPaise: model.costMeasured === true && digits(model.actualCostMinor) ? model.actualCostMinor : null };
    }
    const approval = visibleModels.find(item => item?.kind === 'outbound-approval' && item.previewId === model.id);
    const approver = approval ? personName(state, approval.approverId) : undefined;
    if (approval && approver && isIso(approval.createdAt)) detail.allowedBy = { kind: 'send-approved', person: approver, at: approval.createdAt };
  }
  if (detail.allowedBy.kind === 'read-access') {
    const person = personName(state, receipt.memberId);
    detail.allowedBy = { kind: 'read-access', ...(person ? { person } : {}), ...(isIso(receipt.createdAt) ? { at: receipt.createdAt } : {}) };
  }
  return detail;
}
