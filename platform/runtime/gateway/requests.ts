// Synthesis and retained-continuation request validation (split out of gateway.ts, D11).
import { check, hash } from '../contracts.ts';
import { validateReviewedConversationCalculationParameters } from '../conversation-calculation-arguments.ts';
import type { BusinessContextRequest } from '../conversation-context.ts';
import type { ModelRequest, GatewayConversationContinuation } from './model-request.ts';

export const SYNTHESIS_INVALID = 'INVALID_SYNTHESIS_REQUEST';
export const SYNTHESIS_MARKERS = ['toolTurnId', 'synthesisAuthority', 'synthesisSummary', 'synthesisBinding', 'synthesisDisclosure', 'synthesisOutputWire', 'synthesisOutput'];
export function synthesisJson(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0;
  function walk(item: unknown, depth: number) {
    check(++nodes <= 20000 && depth <= 32, SYNTHESIS_INVALID, 'The synthesis contract exceeds its bounded structure.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { check(item.length <= 32768, SYNTHESIS_INVALID, 'Synthesis text exceeds its exact transfer bound.'); return; }
    if (typeof item === 'number') { check(Number.isSafeInteger(item), SYNTHESIS_INVALID, 'Synthesis metadata requires bounded integers.'); return; }
    check(item !== null && typeof item === 'object' && !seen.has(item)
      && (Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(item))),
    SYNTHESIS_INVALID, 'Synthesis metadata must be plain acyclic JSON.');
    check(Object.getOwnPropertySymbols(item).length === 0, SYNTHESIS_INVALID, 'Synthesis metadata has unsupported fields.');
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) check(item.length <= 8192 && Object.keys(descriptors).length === item.length + 1
      && Array.from({ length: item.length }, (_, index) => descriptors[String(index)]).every(descriptor => descriptor?.enumerable && Object.hasOwn(descriptor, 'value')),
      SYNTHESIS_INVALID, 'Synthesis lists require bounded complete entries.');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      check(descriptor.enumerable && Object.hasOwn(descriptor, 'value') && !['__proto__', 'prototype', 'constructor'].includes(key),
        SYNTHESIS_INVALID, 'Synthesis metadata cannot contain computed fields.');
      walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  walk(value, 0);
  check(Buffer.byteLength(JSON.stringify(value)) <= 262144, SYNTHESIS_INVALID, 'The synthesis authority exceeds its exact transfer bound.');
}
export function synthesisObject(value: unknown, keys: string[], required = keys): asserts value is Record<string, any> {
  check(isRecord(value) && Object.keys(value).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(value, key)),
    SYNTHESIS_INVALID, 'Synthesis authority has missing or undeclared fields.');
}
export function synthesisIds(value: unknown, limit = 8192): asserts value is string[] {
  check(Array.isArray(value) && value.length <= limit && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)
    && new Set(value).size === value.length, SYNTHESIS_INVALID, 'Synthesis authority needs bounded unique references.');
}
export function synthesisRequest(request: Partial<ModelRequest>) {
  const allowed = ['question', 'purpose', 'questionDisclosure', 'routeId', 'toolTurnId', 'previewId', 'approvalId'];
  check(Object.keys(request).every(key => allowed.includes(key)), SYNTHESIS_INVALID, 'Synthesis accepts only an admitted tool turn and its exact disclosure review.');
}

export function validDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export const CONTINUATION_INVALID = 'INVALID_CONVERSATION_CONTINUATION';
export const CONTINUATION_STALE = 'CONVERSATION_CONTINUATION_STALE';
export function continuationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}
export function continuationObject(value: unknown, allowed: string[], required: string[] = []): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), CONTINUATION_INVALID, 'The retained continuation needs plain local metadata.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Object.getOwnPropertySymbols(value).length === 0 && Object.keys(descriptors).every(key => allowed.includes(key)
    && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')) && required.every(key => Object.hasOwn(descriptors, key)),
  CONTINUATION_INVALID, 'The retained continuation has missing or computed fields.');
}
export function continuationArray(value: unknown, limit: number): asserts value is unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= limit
    && Object.getOwnPropertySymbols(value).length === 0, CONTINUATION_INVALID, 'The retained continuation exceeds its bounded list contract.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Object.keys(descriptors).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => descriptors[String(index)])
    .every(descriptor => descriptor?.enumerable && Object.hasOwn(descriptor, 'value')), CONTINUATION_INVALID, 'The retained continuation list has missing or computed entries.');
}
export function continuationSources(value: unknown): asserts value is string[] {
  continuationArray(value, 64);
  check(value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200) && new Set(value).size === value.length,
    CONTINUATION_INVALID, 'The retained continuation needs bounded unique source IDs.');
}
export function continuationText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}
export function validateContinuation(raw: unknown, id: string): GatewayConversationContinuation {
  const keys = ['schemaVersion', 'turnId', 'originalQuestion', 'clarification', 'sourceIds', 'requestScope', 'digest'];
  continuationObject(raw, [...keys, 'exchanges', 'reviewedCalculationParameters'], keys);
  check(raw.schemaVersion === 1 && raw.turnId === id && continuationId(raw.turnId)
    && continuationText(raw.originalQuestion, 8000) && continuationText(raw.clarification, 500)
    && typeof raw.digest === 'string' && /^[a-f0-9]{64}$/.test(raw.digest), CONTINUATION_INVALID, 'The retained continuation has invalid identity or text.');
  continuationSources(raw.sourceIds);
  const scope = raw.requestScope;
  continuationObject(scope, ['sourceIds', 'branch', 'asOf', 'onDate', 'period']);
  if (Object.hasOwn(scope, 'sourceIds')) {
    continuationSources(scope.sourceIds);
    check(hash([...scope.sourceIds].sort()) === hash([...raw.sourceIds].sort()), CONTINUATION_INVALID, 'The retained continuation source scope does not match its authority.');
  }
  if (Object.hasOwn(scope, 'branch')) check(continuationText(scope.branch, 200), CONTINUATION_INVALID, 'The retained branch is invalid.');
  if (Object.hasOwn(scope, 'asOf')) check(typeof scope.asOf === 'string' && scope.asOf.length <= 64 && Number.isFinite(Date.parse(scope.asOf)), CONTINUATION_INVALID, 'The retained known-on timestamp is invalid.');
  if (Object.hasOwn(scope, 'onDate')) check(validDay(scope.onDate), CONTINUATION_INVALID, 'The retained business date is invalid.');
  if (Object.hasOwn(scope, 'period')) {
    continuationObject(scope.period, ['from', 'to'], ['from', 'to']);
    check(validDay(scope.period.from) && validDay(scope.period.to) && scope.period.from <= scope.period.to, CONTINUATION_INVALID, 'The retained period is invalid.');
  }
  if (Object.hasOwn(raw, 'reviewedCalculationParameters')) {
    const parameters = validateReviewedConversationCalculationParameters(raw.reviewedCalculationParameters);
    check(hash(parameters) === hash(raw.reviewedCalculationParameters)
      && (scope.period === undefined || parameters.period !== undefined && hash(parameters.period) === hash(scope.period)), CONTINUATION_INVALID, 'The retained calculation parameters conflict with the exact business scope.');
  }
  if (Object.hasOwn(raw, 'exchanges')) {
    continuationArray(raw.exchanges, 8);
    for (const exchange of raw.exchanges) {
      continuationObject(exchange, ['question', 'clarification'], ['question', 'clarification']);
      check(continuationText(exchange.question, 8000) && continuationText(exchange.clarification, 500), CONTINUATION_INVALID, 'A retained clarification exchange has invalid text.');
    }
  }
  const { digest, ...body } = raw;
  check(Buffer.byteLength(JSON.stringify(raw)) <= 131072 && hash(body) === digest, CONTINUATION_INVALID, 'The exact retained continuation is oversized or changed.');
  return structuredClone(raw) as GatewayConversationContinuation;
}
export function sameContinuationScope(key: keyof BusinessContextRequest, left: unknown, right: unknown): boolean {
  if (key === 'sourceIds') {
    continuationSources(left); continuationSources(right);
    return hash([...left].sort()) === hash([...right].sort());
  }
  if (key === 'asOf') return typeof left === 'string' && typeof right === 'string' && Number.isFinite(Date.parse(left))
    && Number.isFinite(Date.parse(right)) && new Date(left).toISOString() === new Date(right).toISOString();
  if (key === 'period') return isRecord(left) && isRecord(right) && left.from === right.from && left.to === right.to
    && Object.keys(left).length === 2 && Object.keys(right).length === 2;
  return hash(left) === hash(right);
}
export function continuationRequest(request: Partial<ModelRequest>, retained: GatewayConversationContinuation): BusinessContextRequest {
  const scope = retained.requestScope as BusinessContextRequest;
  const selected = scope.sourceIds ?? retained.sourceIds;
  if (request.sourceIds !== undefined) check(sameContinuationScope('sourceIds', request.sourceIds, selected), CONTINUATION_STALE, 'Keep the exact retained source selection for this continuation.');
  const result: BusinessContextRequest = { sourceIds: [...selected].sort() };
  for (const key of ['branch', 'asOf', 'onDate', 'period'] as const) {
    if (scope[key] !== undefined && request[key] !== undefined) check(sameContinuationScope(key, request[key], scope[key]), CONTINUATION_STALE, 'The continuation conflicts with its retained review scope.');
    const value = scope[key] ?? request[key];
    if (value !== undefined) Object.assign(result, { [key]: structuredClone(value) });
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
