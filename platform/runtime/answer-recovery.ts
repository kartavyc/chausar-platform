import { check, hash } from './contracts.ts';
import type { CalculationReceipt, CalculationRequest } from './calculator.ts';
import { validDate, validatePeriod, type Period } from './memory.ts';

/** Only a projection of host-resolved records. These objects are never bearer authority. */
export type AnswerRecoveryEvidence = {
  workspaceId: string;
  answer: { id: string; receiptId: string; request: CalculationRequest };
  receipt: CalculationReceipt;
};
export type AnswerRecoverySource = {
  workspaceId: string; originalAnswerId: string; originalReceiptId: string;
  originalRequestDigest: string; originalReceiptDigest: string;
};
/** Null explicitly chooses all event dates / no comparison / no aging date respectively. */
export type AnswerRecoveryTimeScope = {
  asOf: string; period: Period | null; comparePeriod: Period | null; onDate: string | null;
};
export type AnswerRecoveryDeclaration = {
  version: 1; newRequestId: string; source: AnswerRecoverySource;
  timeScope: AnswerRecoveryTimeScope; confirmedNewCalculation: true;
};
export type PreparedAnswerRecovery = {
  version: 1; type: 'fresh-answer-recovery-v1'; newRequestId: string;
  source: AnswerRecoverySource; timeScope: AnswerRecoveryTimeScope;
  request: CalculationRequest; requestDigest: string;
  interpretation: 'new-calculation-with-declared-time-scope';
  preservesOriginalRecords: true; historicalReplay: false; grantsAuthority: false;
  digest: string;
};
export type CompletedAnswerRecovery = {
  version: 1; type: 'fresh-answer-recovery-lineage-v1'; newRequestId: string;
  source: AnswerRecoverySource; declaredTimeScope: AnswerRecoveryTimeScope;
  newAnswerId: string; newReceiptId: string; newRequestDigest: string; newReceiptDigest: string;
  preparationDigest: string; interpretation: 'new-calculation-with-declared-time-scope';
  historicalReplay: false; grantsAuthority: false; digest: string;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
function keys(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, unknown> {
  check(object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
    'INVALID_ANSWER_RECOVERY', 'Use the exact declared answer recovery fields.');
}
function dataOnly(value: unknown, maximumBytes: number) {
  const pending = [{ value, depth: 0 }]; let nodes = 0, textBytes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    check(++nodes <= 200_000 && item.depth <= 16, 'ANSWER_RECOVERY_LIMIT', 'Recovery evidence exceeds the declared structural bound.');
    const current = item.value;
    if (typeof current === 'string') { textBytes += Buffer.byteLength(current); }
    else if (current === null || typeof current === 'boolean' || (typeof current === 'number' && Number.isFinite(current))) { /* JSON primitives */ }
    else {
      check(object(current) || Array.isArray(current), 'INVALID_ANSWER_RECOVERY', 'Recovery fields must contain finite plain JSON data.');
      const prototype = Object.getPrototypeOf(current);
      check(Array.isArray(current) ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
        'INVALID_ANSWER_RECOVERY', 'Recovery fields must contain plain JSON records.');
      check(Object.getOwnPropertySymbols(current).length === 0, 'INVALID_ANSWER_RECOVERY', 'Symbol fields are not recovery evidence.');
      const names = Object.getOwnPropertyNames(current);
      if (Array.isArray(current)) check(names.length === current.length + 1 && names.every(name => name === 'length' || /^(0|[1-9]\d*)$/.test(name)),
        'INVALID_ANSWER_RECOVERY', 'Sparse arrays and extra array fields are not recovery evidence.');
      for (const name of names) {
        if (Array.isArray(current) && name === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, name)!;
        check('value' in descriptor && descriptor.enumerable, 'INVALID_ANSWER_RECOVERY', 'Accessors and hidden fields are not recovery evidence.');
        textBytes += Buffer.byteLength(name); pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    }
    check(textBytes <= maximumBytes, 'ANSWER_RECOVERY_LIMIT', 'Recovery evidence exceeds the declared byte bound.');
  }
  check(Buffer.byteLength(JSON.stringify(value)) <= maximumBytes, 'ANSWER_RECOVERY_LIMIT', 'Recovery evidence exceeds the declared byte bound.');
}
function period(value: unknown) {
  keys(value, ['from', 'to']); validatePeriod(value as Period);
}
function receiptScope(request: CalculationRequest, receipt: CalculationReceipt) {
  check(object(receipt) && ['id', 'memberId', 'epoch', 'operation', 'asOf', 'period', 'comparePeriod', 'branch', 'assumptions'].every(key => Object.hasOwn(receipt, key))
    && object(receipt.assumptions) && typeof receipt.operation === 'string' && typeof receipt.asOf === 'string'
    && Number.isFinite(Date.parse(receipt.asOf)) && (receipt.branch === null || id(receipt.branch)),
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'Resolve a complete original calculation receipt.');
  for (const value of [receipt.period, receipt.comparePeriod]) if (value !== null) period(value);
  check(request.operation === receipt.operation && hash(request.period ?? null) === hash(receipt.period)
    && hash(request.comparePeriod ?? null) === hash(receipt.comparePeriod) && (request.branch ?? null) === receipt.branch
    && hash(request.sourceIds ?? null) === hash(receipt.requestedSourceIds ?? null),
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'The saved request and original receipt must have the same operation and scope.');
  if (request.operation === 'aging' && request.onDate !== undefined) check(request.onDate === receipt.assumptions.onDate,
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'The saved aging date must match its original receipt.');
  if (request.operation === 'scenario') check(request.assumptions && /^-?\d+$/.test(request.assumptions.priceChangeBps)
    && String(BigInt(request.assumptions.priceChangeBps)) === receipt.assumptions.priceChangeBps,
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'The saved scenario assumption must match its original receipt.');
}
function sourceEvidence(evidence: AnswerRecoveryEvidence): AnswerRecoverySource {
  dataOnly(evidence, 16 * 1024 * 1024); keys(evidence, ['workspaceId', 'answer', 'receipt']); keys(evidence.answer, ['id', 'receiptId', 'request']);
  const { answer, receipt } = evidence;
  check(id(evidence.workspaceId) && id(answer.id) && id(answer.receiptId) && object(receipt) && id(receipt.id)
    && receipt.id === answer.receiptId && answer.id !== receipt.id && id(receipt.memberId) && Number.isSafeInteger(receipt.epoch) && receipt.epoch >= 1,
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'Resolve the exact original saved answer and private receipt in this workspace.');
  dataOnly(answer.request, 64 * 1024);
  keys(answer.request, ['operation', 'period', 'comparePeriod', 'onDate', 'sourceIds', 'branch', 'customerId', 'orderId', 'assumptions', 'asOf'], ['operation']);
  check(!Object.hasOwn(answer.request, 'asOf'), 'ANSWER_RECOVERY_NOT_UNPINNED', 'This recovery path is only for a saved request without a retained knowledge cutoff.');
  const request = answer.request;
  check(typeof request.operation === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.operation), 'INVALID_ANSWER_RECOVERY', 'Choose a saved published calculation.');
  for (const value of [request.period, request.comparePeriod]) if (value !== undefined) period(value);
  if (request.onDate !== undefined) check(request.operation === 'aging' && validDate(request.onDate), 'INVALID_AGING_DATE', 'Give a valid saved aging date.');
  for (const value of [request.branch, request.customerId, request.orderId]) if (value !== undefined) check(id(value), 'INVALID_ANSWER_RECOVERY', 'Saved filters must use bounded plain identifiers.');
  if (request.sourceIds !== undefined) check(Array.isArray(request.sourceIds) && request.sourceIds.length <= 64
    && request.sourceIds.every(id) && new Set(request.sourceIds).size === request.sourceIds.length,
    'INVALID_SOURCE_SCOPE', 'Retain at most sixty-four distinct saved source identifiers.');
  if (request.assumptions !== undefined) {
    keys(request.assumptions, ['priceChangeBps']); const value = request.assumptions.priceChangeBps;
    check(request.operation === 'scenario' && typeof value === 'string' && value.length <= 16 && /^-?\d+$/.test(value)
      && BigInt(value) >= -10000n && BigInt(value) <= 100000n, 'SCENARIO_LIMIT', 'Retain the valid saved scenario assumption.');
  }
  check(!Object.hasOwn(receipt, 'restatement'), 'ANSWER_RECOVERY_PRIVATE_DIAGNOSTIC', 'A private restatement is not an ordinary saved calculation recovery source.');
  receiptScope(request, receipt);
  return { workspaceId: evidence.workspaceId, originalAnswerId: answer.id, originalReceiptId: receipt.id,
    originalRequestDigest: hash(request), originalReceiptDigest: hash(receipt) };
}
function declaredScope(scope: AnswerRecoveryTimeScope, operation: string): AnswerRecoveryTimeScope {
  keys(scope, ['asOf', 'period', 'comparePeriod', 'onDate']);
  // Date.parse alone admits local dates and ambiguous locale strings. Require an explicit ISO offset;
  // reuse the business-date validator to reject silently normalized dates such as February 30.
  check(typeof scope.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(scope.asOf)
    && validDate(scope.asOf.slice(0, 10)) && Number.isFinite(Date.parse(scope.asOf)),
    'INVALID_ASOF', 'Explicitly choose a valid known-on ISO timestamp with its time zone.');
  for (const value of [scope.period, scope.comparePeriod]) if (value !== null) period(value);
  if (operation === 'change') check(scope.period !== null && scope.comparePeriod !== null, 'COMPARISON_REQUIRED', 'Explicitly choose both new comparison periods.');
  else check(scope.comparePeriod === null, 'INVALID_CALCULATION', 'A comparison period only applies to a change calculation.');
  if (operation === 'aging') check(validDate(scope.onDate), 'INVALID_AGING_DATE', 'Explicitly choose a new aging date.');
  else check(scope.onDate === null, 'INVALID_CALCULATION', 'An aging date only applies to an aging calculation.');
  return { ...structuredClone(scope), asOf: new Date(scope.asOf).toISOString() };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
function preparation(evidence: AnswerRecoveryEvidence, input: AnswerRecoveryDeclaration): PreparedAnswerRecovery {
  const source = sourceEvidence(evidence);
  dataOnly(input, 64 * 1024); keys(input, ['version', 'newRequestId', 'source', 'timeScope', 'confirmedNewCalculation']);
  keys(input.source, ['workspaceId', 'originalAnswerId', 'originalReceiptId', 'originalRequestDigest', 'originalReceiptDigest']);
  check(input.version === 1 && input.confirmedNewCalculation === true, 'ANSWER_RECOVERY_CONFIRMATION_REQUIRED', 'Confirm a new calculation using the newly declared time scope.');
  check(Object.keys(source).every(key => input.source[key as keyof AnswerRecoverySource] === source[key as keyof AnswerRecoverySource]),
    'ANSWER_RECOVERY_SOURCE_CHANGED', 'The original request or receipt changed after recovery review.');
  check(id(input.newRequestId) && ![source.originalAnswerId, source.originalReceiptId].includes(input.newRequestId),
    'ANSWER_RECOVERY_NEW_ID_REQUIRED', 'The host must allocate a separate new request identity.');
  const timeScope = declaredScope(input.timeScope, evidence.answer.request.operation);
  const request = structuredClone(evidence.answer.request);
  delete request.period; delete request.comparePeriod; delete request.onDate;
  request.asOf = timeScope.asOf;
  if (timeScope.period !== null) request.period = structuredClone(timeScope.period);
  if (timeScope.comparePeriod !== null) request.comparePeriod = structuredClone(timeScope.comparePeriod);
  if (timeScope.onDate !== null) request.onDate = timeScope.onDate;
  const plan = { version: 1 as const, type: 'fresh-answer-recovery-v1' as const, newRequestId: input.newRequestId, source,
    timeScope, request, requestDigest: hash(request), interpretation: 'new-calculation-with-declared-time-scope' as const,
    preservesOriginalRecords: true as const, historicalReplay: false as const, grantsAuthority: false as const };
  return freeze({ ...plan, digest: hash(plan) });
}

/** Pure disclosure only: does not read a store, authorize access or choose any default time. */
export function explainAnswerRecovery(evidence: AnswerRecoveryEvidence) {
  const source = sourceEvidence(evidence);
  return freeze({ version: 1 as const, status: 'new-time-scope-required' as const, source,
    message: 'This saved request has no retained knowledge cutoff. Choose a new time scope to create a separate answer. The original answer and receipt stay unchanged.',
    requiredTimeFields: ['asOf', 'period', 'comparePeriod', 'onDate'] as const,
    historicalReplay: false as const, grantsAuthority: false as const });
}

/** Pure preparation only. Always execute the returned request through the normal current calculator. */
export function prepareAnswerRecovery(evidence: AnswerRecoveryEvidence, input: AnswerRecoveryDeclaration): PreparedAnswerRecovery {
  return preparation(evidence, input);
}

/** Rebuild from host-resolved originals before execution; a caller-authored plan is not authority. */
export function assertPreparedAnswerRecoveryCurrent(evidence: AnswerRecoveryEvidence, plan: PreparedAnswerRecovery): void {
  dataOnly(plan, 128 * 1024);
  const rebuilt = preparation(evidence, { version: 1, newRequestId: plan.newRequestId, source: plan.source,
    timeScope: plan.timeScope, confirmedNewCalculation: true });
  check(hash(plan) === hash(rebuilt), 'ANSWER_RECOVERY_PREPARATION_CHANGED', 'The recovery preparation changed. Review the exact new request again.');
}

/** Build lineage only after the host independently retrieves its newly issued normal answer/receipt. */
export function completeAnswerRecovery(evidence: AnswerRecoveryEvidence, plan: PreparedAnswerRecovery,
  result: Pick<AnswerRecoveryEvidence, 'answer' | 'receipt'>): CompletedAnswerRecovery {
  assertPreparedAnswerRecoveryCurrent(evidence, plan); dataOnly(result, 16 * 1024 * 1024);
  keys(result, ['answer', 'receipt']); keys(result.answer, ['id', 'receiptId', 'request']);
  check(object(result.receipt) && id(result.answer.id) && id(result.receipt.id) && result.answer.receiptId === result.receipt.id
    && ![plan.source.originalAnswerId, plan.source.originalReceiptId, plan.newRequestId].includes(result.answer.id)
    && ![plan.source.originalAnswerId, plan.source.originalReceiptId, plan.newRequestId].includes(result.receipt.id)
    && result.answer.id !== result.receipt.id && hash(result.answer.request) === plan.requestDigest
    && result.receipt.memberId === evidence.receipt.memberId && result.receipt.epoch === evidence.receipt.epoch,
    'ANSWER_RECOVERY_RESULT_CHANGED', 'Recovery must produce a separate answer and receipt for the exact newly declared request.');
  check(!Object.hasOwn(result.receipt, 'restatement') && result.receipt.asOf === plan.timeScope.asOf,
    'ANSWER_RECOVERY_RESULT_CHANGED', 'Recovery is a new normal calculation, not a historical private restatement.');
  receiptScope(plan.request, result.receipt);
  const lineage = { version: 1 as const, type: 'fresh-answer-recovery-lineage-v1' as const, newRequestId: plan.newRequestId,
    source: structuredClone(plan.source), declaredTimeScope: structuredClone(plan.timeScope), newAnswerId: result.answer.id,
    newReceiptId: result.receipt.id, newRequestDigest: plan.requestDigest, newReceiptDigest: hash(result.receipt),
    preparationDigest: plan.digest, interpretation: plan.interpretation, historicalReplay: false as const, grantsAuthority: false as const };
  return freeze({ ...lineage, digest: hash(lineage) });
}
