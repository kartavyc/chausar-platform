import type { CalculationReceiptEvidence } from './presentation.ts';
import { ReplyValidationError, assertISODate, assertISOInstant, projectCalculationReceipt } from './validate.ts';
import { calculationParameterKeys, validateReviewedCalculationParameters, validateCalculationParameterOrigins, validateCalculationParameterDisclosure,
  type CalculationPeriod, type ReviewedCalculationParameters, type CalculationParameterOrigins, type CalculationParameterDisclosure } from './calculation-parameters.ts';

/** Checked projections of ce5dc4f Engine DTOs, never alternate Engine authority.
 * Sources: runtime/gateway.ts, engine.ts, conversation-history.ts and
 * conversation-synthesis-host.ts. No transport, credentials or React belong here. */
export interface ConversationScope {
  readonly sourceIds?: readonly string[]; readonly branch?: string; readonly asOf?: string;
  readonly onDate?: string; readonly period?: { readonly from: string; readonly to: string };
}
export interface ConversationRequest extends ConversationScope {
  readonly question: string; readonly purpose: 'conversation'; readonly questionDisclosure: 'verbatim';
  readonly routeId: string; readonly continuationId?: string;
  readonly comparePeriod?: CalculationPeriod; readonly assumptions?: { readonly priceChangeBps: string };
}
export interface CheckedConversationContinuation {
  readonly schemaVersion: 1; readonly turnId: string; readonly originalQuestion: string; readonly clarification: string;
  readonly sourceIds: readonly string[]; readonly requestScope: ConversationScope; readonly digest: string;
  readonly exchanges?: readonly { readonly question: string; readonly clarification: string }[];
  readonly reviewedCalculationParameters?: ReviewedCalculationParameters;
}
interface ModelPreviewBase {
  readonly id: string; readonly kind: 'model-preview'; readonly status: 'preview'; readonly naturalQuestion: string;
  readonly questionDisclosure: 'verbatim'; readonly payload: string; readonly digest: string; readonly routeId: string;
  readonly endpoint: string; readonly approvalRequired: true;
  readonly receiptBoundary: 'application-to-official-cli' | 'application-to-provider-http'; readonly providerPayloadObserved: boolean;
  readonly estimatedCostMinor?: string; readonly costCurrency: 'INR';
}
export interface CheckedConversationPreview extends ModelPreviewBase {
  readonly purpose: 'conversation'; readonly send: 'shape' | 'samples'; readonly questionDisclosureWarning: string;
  readonly definitionDisclosure: 'published'; readonly definitionDisclosureWarning: string;
  readonly reviewedCalculationParameters: ReviewedCalculationParameters; readonly calculationParameterOrigins: CalculationParameterOrigins;
  readonly calculationParametersDigest: string; readonly calculationParameterDisclosure: CalculationParameterDisclosure;
  readonly calculationParameterDisclosureWarning: string;
  readonly continuationId?: string; readonly continuationDigest?: string; readonly continuation?: CheckedConversationContinuation;
  readonly continuationDisclosure?: 'verbatim'; readonly continuationDisclosureWarning?: string;
}
export interface CheckedSynthesisPreview extends ModelPreviewBase {
  readonly purpose: 'conversation-synthesis'; readonly send: 'samples'; readonly toolTurnId: string;
  readonly synthesisInputDigest: string; readonly synthesisDisclosure: 'admitted-tool-summary'; readonly synthesisDisclosureWarning: string;
}
export type CheckedModelPreview = CheckedConversationPreview | CheckedSynthesisPreview;
export interface CheckedOutboundApproval {
  readonly id: string; readonly kind: 'outbound-approval'; readonly previewId: string; readonly digest: string;
  readonly routeId: string; readonly endpoint: string; readonly approverId: string; readonly approverEpoch: number;
  readonly createdAt: string; readonly expiresAt: string; readonly used: false;
}
export type BusinessCategory = 'industry' | 'products' | 'customers' | 'business_model' | 'location';
export interface CheckedBusinessClaim {
  readonly id: string; readonly category: 'workspace' | 'definitions' | 'records' | BusinessCategory; readonly text: string;
  readonly origin: 'workspace-metadata' | 'published-definition' | 'source-observation' | 'owner-told' | 'draft-assumption';
  readonly qualification: 'metadata-only' | 'unqualified-observation' | 'evidence-qualified' | 'owner-stated' | 'draft'; readonly citationIds: readonly string[];
}
export interface CheckedBusinessCitation {
  readonly id: string; readonly kind: 'workspace' | 'dictionary' | 'fact' | 'profile'; readonly referenceId: string;
  readonly path: string; readonly contentHash: string; readonly sourceId?: string; readonly factId?: string; readonly sourceRow?: number;
  readonly branch?: string; readonly validFrom?: string; readonly validTo?: string | null; readonly learnedAt?: string;
}
export interface CheckedBusinessAnswer {
  readonly id: string; readonly kind: 'business-context'; readonly status: 'grounded' | 'partial' | 'unknown'; readonly message: string;
  readonly claims: readonly CheckedBusinessClaim[]; readonly citations: readonly CheckedBusinessCitation[];
  readonly unknowns: readonly { readonly category: BusinessCategory; readonly message: string }[];
  readonly conflicts: readonly { readonly category: 'records' | BusinessCategory; readonly citationIds: readonly string[]; readonly reason: string }[];
  readonly scope: { readonly branch: string | null; readonly asOf: string; readonly onDate: string; readonly syntheticFixture: boolean;
    readonly corpus: 'currently-authorized-local-evidence'; readonly completeness: 'bounded'; readonly limitations: readonly string[] };
  readonly contextDigest: string; readonly sourceIds: readonly string[]; readonly rowIds: readonly string[]; readonly profileIds: readonly string[];
  readonly receipt: { readonly id: string; readonly kind: 'business-context-receipt'; readonly contextDigest: string; readonly financialCalculation: false;
    readonly sourceIds: readonly string[]; readonly rowIds: readonly string[]; readonly modelReceiptId?: string };
}
export type ConversationTool = 'business.describe' | 'calculator.calculate';
export type CheckedConversationToolResult =
  | { readonly tool: 'business.describe'; readonly answer: CheckedBusinessAnswer; readonly error?: never }
  | { readonly tool: 'calculator.calculate'; readonly answer: CalculationReceiptEvidence; readonly error?: never }
  | { readonly tool: ConversationTool; readonly error: { readonly code: string; readonly message: string }; readonly answer?: never };
export interface CheckedGroundedConversation {
  readonly id: string; readonly kind: 'grounded-conversation'; readonly modelReceiptId: string; readonly results: readonly CheckedConversationToolResult[];
  readonly receipt: { readonly id: string; readonly kind: 'conversation-tool-receipt'; readonly modelReceiptId: string;
    readonly resultRefs: readonly { readonly tool: ConversationTool; readonly answerId: string }[] };
}
export interface CheckedConversationReference {
  readonly evidenceRefs: readonly string[]; readonly answerIds: readonly string[]; readonly receiptIds: readonly string[]; readonly citationIds: readonly string[];
}
export interface CheckedSynthesizedConversation {
  readonly id: string; readonly kind: 'synthesized-conversation'; readonly paragraphs: readonly string[];
  readonly cautions: readonly { readonly ref: string; readonly text: string }[]; readonly references: readonly CheckedConversationReference[];
  readonly tools: CheckedGroundedConversation;
  readonly receipt: { readonly id: string; readonly kind: 'conversation-synthesis-receipt'; readonly toolTurnId: string;
    readonly plannerModelReceiptId: string; readonly synthesisModelReceiptId: string; readonly inputDigest: string; readonly outputDigest: string };
}
export interface CheckedClarification { readonly clarification: string; readonly modelReceiptId: string }
export type CheckedCalculationAnswer = CalculationReceiptEvidence | { readonly supported: true; readonly message: string; readonly receipt: CalculationReceiptEvidence };
export type CheckedConversationReply = CheckedClarification | CheckedGroundedConversation | CheckedSynthesizedConversation;
export type CheckedConversationReadback = { readonly id: string; readonly at: string; readonly question: string } & (
  | { readonly kind: 'clarification'; readonly answer: CheckedClarification }
  | { readonly kind: 'grounded-conversation'; readonly answer: CheckedGroundedConversation }
  | { readonly kind: 'synthesized-conversation'; readonly answer: CheckedSynthesizedConversation }
  | { readonly kind: 'business-context'; readonly answer: CheckedBusinessAnswer }
  | { readonly kind: 'calculation'; readonly answer: CheckedCalculationAnswer }
);
export type CheckedReadback = CheckedConversationReadback;
export type CheckedContinuation = CheckedConversationContinuation;
export interface SynthesisPreviewRequest { readonly id: string; readonly routeId?: string }
export interface SynthesisRunRequest { readonly id: string; readonly previewId: string; readonly approvalId: string }
export interface ConversationAskRequest extends ConversationRequest { readonly previewId: string; readonly approvalId: string }
export interface ConversationPayloads {
  'models.preview': ConversationRequest; 'models.approve': { readonly id: string }; 'conversation.ask': ConversationAskRequest;
  'conversation.get': { readonly id: string }; 'conversation.continuation': { readonly id: string };
  'conversation.synthesis.preview': SynthesisPreviewRequest; 'conversation.synthesis.run': SynthesisRunRequest;
}
export interface ConversationEnginePort { request<M extends keyof ConversationPayloads>(method: M, payload: ConversationPayloads[M]): Promise<unknown> }
export interface ConversationRpcPort { call<M extends keyof ConversationPayloads>(message: { readonly method: M; readonly payload: ConversationPayloads[M] }): Promise<unknown> }
export interface ConversationReplyExpectation { readonly modelReceiptId?: string; readonly toolTurnId?: string; readonly synthesisModelReceiptId?: string; readonly inputDigest?: string; readonly preview?: CheckedModelPreview }
type PreviewProof = { verified: boolean; readonly request?: ConversationRequest; readonly summary?: Record<string, unknown>; readonly binding?: Record<string, unknown> };
const previewProofs = new WeakMap<CheckedModelPreview, PreviewProof>();

function fail(path: string): never { throw new ReplyValidationError(path); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail(path);
  for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) if (!Object.hasOwn(d, 'value') || !d.enumerable) fail(path);
  return value as Record<string, unknown>;
}
function shape(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = object(value, path);
  if (required.some(k => !Object.hasOwn(obj, k)) || Object.keys(obj).some(k => !required.includes(k) && !optional.includes(k)) || Object.values(obj).some(v => v === undefined)) fail(path);
  return obj;
}
function text(value: unknown, path: string, max = 20000, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path);
}
function id(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail(path); }
function digest(value: unknown, path: string): asserts value is string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(path); }
function eq(actual: unknown, expected: unknown, path: string): void { if (actual !== expected) fail(path); }
function choice(value: unknown, choices: readonly string[], path: string): void { if (typeof value !== 'string' || !choices.includes(value)) fail(path); }
function integer(value: unknown, path: string, minimum = 0): void { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(path); }
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Object.getOwnPropertySymbols(value).length) fail(path);
  const props = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(props).length !== value.length + 1) fail(path);
  for (let i = 0; i < value.length; i++) { const d = props[String(i)]; if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail(path); }
  return value;
}
function ids(value: unknown, path: string, max = 10000): string[] {
  const list = array(value, path, max); list.forEach((v, i) => id(v, `${path}[${i}]`));
  if (new Set(list).size !== list.length) fail(path); return list as string[];
}
function sources(value: unknown, path: string): string[] {
  const list = array(value, path, 64);
  if (list.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(v)) || new Set(list).size !== list.length) fail(path);
  return list as string[];
}
function sameIds(a: unknown, b: unknown, path: string): void { if (JSON.stringify([...(a as string[])].sort()) !== JSON.stringify([...(b as string[])].sort())) fail(path); }
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameData(Object.getOwnPropertyDescriptor(a, k)?.value, Object.getOwnPropertyDescriptor(b, k)?.value));
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function snapshot<T>(value: unknown): T { try { return freeze(structuredClone(value)) as T; } catch { return fail('reply.data'); } }
function json(value: unknown, path: string, maximumBytes = 4 * 1024 * 1024): void {
  let nodes = 0;
  function visit(v: unknown, p: string, depth: number): void {
    if (++nodes > 200000 || depth > 20) fail(p);
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { text(v, p, 262144, true); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(p); return; }
    if (Array.isArray(v)) { array(v, p, 10000).forEach((x, i) => visit(x, `${p}[${i}]`, depth + 1)); return; }
    const obj = object(v, p); if (Object.keys(obj).length > 1000) fail(p);
    for (const [k, x] of Object.entries(obj)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) fail(p); visit(x, `${p}.${k}`, depth + 1); }
  }
  visit(value, path, 0); if (new TextEncoder().encode(JSON.stringify(value)).length > maximumBytes) fail(path);
}
function scope(value: unknown, path: string): void {
  const v = shape(value, path, [], ['sourceIds', 'branch', 'asOf', 'onDate', 'period']);
  if (Object.hasOwn(v, 'sourceIds')) sources(v.sourceIds, `${path}.sourceIds`);
  if (Object.hasOwn(v, 'branch')) text(v.branch, `${path}.branch`, 200);
  if (Object.hasOwn(v, 'asOf')) { text(v.asOf, `${path}.asOf`, 64); if (!Number.isFinite(Date.parse(v.asOf))) fail(`${path}.asOf`); }
  if (Object.hasOwn(v, 'onDate')) assertISODate(v.onDate, `${path}.onDate`);
  if (Object.hasOwn(v, 'period')) { const p = shape(v.period, `${path}.period`, ['from', 'to']); assertISODate(p.from, `${path}.period.from`); assertISODate(p.to, `${path}.period.to`); if (p.from > p.to) fail(`${path}.period`); }
}
export function validateConversationId(value: unknown): string { id(value, 'request.id'); return value; }
export function conversationIdRequest(value: unknown): { readonly id: string } { return Object.freeze({ id: validateConversationId(value) }); }
export function validateConversationRequest(value: unknown): ConversationRequest {
  const v = shape(value, 'request', ['question', 'purpose', 'questionDisclosure', 'routeId'], ['continuationId', 'sourceIds', 'branch', 'asOf', 'onDate', 'period', 'comparePeriod', 'assumptions']);
  text(v.question, 'request.question', 8000); eq(v.purpose, 'conversation', 'request.purpose'); eq(v.questionDisclosure, 'verbatim', 'request.questionDisclosure'); id(v.routeId, 'request.routeId');
  if (Object.hasOwn(v, 'continuationId')) id(v.continuationId, 'request.continuationId');
  const selected: Record<string, unknown> = {}; for (const k of ['sourceIds', 'branch', 'asOf', 'onDate', 'period']) if (Object.hasOwn(v, k)) selected[k] = v[k];
  scope(selected, 'request.scope'); selectedCalculationParameters(v, 'request.calculationParameters'); json(value, 'request', 131072); return snapshot<ConversationRequest>(value);
}

function continuation(value: unknown, expectedId: string, path: string): void {
  const v = shape(value, path, ['schemaVersion', 'turnId', 'originalQuestion', 'clarification', 'sourceIds', 'requestScope', 'digest'], ['exchanges', 'reviewedCalculationParameters']);
  eq(v.schemaVersion, 1, `${path}.schemaVersion`); id(v.turnId, `${path}.turnId`); eq(v.turnId, expectedId, `${path}.turnId`);
  text(v.originalQuestion, `${path}.originalQuestion`, 8000); text(v.clarification, `${path}.clarification`, 500); digest(v.digest, `${path}.digest`);
  sources(v.sourceIds, `${path}.sourceIds`); scope(v.requestScope, `${path}.requestScope`);
  const selected = v.requestScope as Record<string, unknown>;
  if (Object.hasOwn(v, 'reviewedCalculationParameters')) {
    const parameters = validateReviewedCalculationParameters(v.reviewedCalculationParameters, path + '.reviewedCalculationParameters');
    if (Object.hasOwn(selected, 'period') && !sameData(parameters.period, selected.period)) fail(path + '.reviewedCalculationParameters.period');
  }
  if (Object.hasOwn(selected, 'sourceIds')) sameIds(selected.sourceIds, v.sourceIds, `${path}.requestScope.sourceIds`);
  if (Object.hasOwn(v, 'exchanges')) array(v.exchanges, `${path}.exchanges`, 8).forEach((item, i) => {
    const e = shape(item, `${path}.exchanges[${i}]`, ['question', 'clarification']); text(e.question, `${path}.exchanges[${i}].question`, 8000); text(e.clarification, `${path}.exchanges[${i}].clarification`, 500);
  });
  json(value, path, 131072);
}
export function validateConversationContinuation(value: unknown, expectedId: string): CheckedConversationContinuation {
  id(expectedId, 'request.id'); continuation(value, expectedId, 'continuation'); return snapshot<CheckedConversationContinuation>(value);
}
async function sha(value: string, path: string): Promise<string> {
  try {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch { return fail(path); }
}
export async function verifyConversationContinuation(value: unknown, expectedId: string): Promise<CheckedConversationContinuation> {
  const checked = validateConversationContinuation(value, expectedId);
  // contracts.hash hashes JSON.stringify directly. Preserve the server's property
  // insertion order; a reordered presentation projection is not the hashed body.
  const { digest: expected, ...body } = checked;
  eq(await sha(JSON.stringify(body), 'continuation.digest'), expected, 'continuation.digest'); return checked;
}
function endpoint(value: unknown, path: string, boundary?: unknown): void {
  text(value, path, 2000); let url: URL; try { url = new URL(value); } catch { return fail(path); }
  if (url.protocol === 'cli:') {
    if (!['cli://codex/provider-managed', 'cli://claude/provider-managed'].includes(value) || boundary !== 'application-to-official-cli') fail(path); return;
  }
  if (boundary === 'application-to-official-cli') fail(path);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail(path);
}
const basePreviewKeys = ['id', 'kind', 'status', 'purpose', 'createdAt', 'at', 'memberId', 'epoch', 'routeId', 'routeRevision', 'endpoint',
  'questionDisclosure', 'naturalQuestion', 'questionHash', 'sourceIds', 'factIds', 'rowIds', 'factDigest', 'trustFingerprint',
  'schema', 'schemaDigest', 'instructions', 'payload', 'digest', 'approvalRequired', 'send', 'receiptBoundary', 'providerPayloadObserved', 'costReservedMinor', 'costCurrency', 'experimental'];
const conversationPreviewKeys = ['questionDisclosureWarning', 'definitionDisclosure', 'publishedCalculations', 'definitionDisclosureWarning',
  'reviewedCalculationParameters', 'calculationParameterOrigins', 'calculationParametersDigest', 'calculationParameterDisclosure', 'calculationParameterDisclosureWarning',
  'requestScope', 'profileSamplesHash', 'businessContext', 'contextDigest', 'profileIds', 'operations', 'selectors'];
const continuationPreviewKeys = ['continuationId', 'continuationDigest', 'continuation', 'continuationDisclosure', 'continuationDisclosureWarning', 'requestScopeDigest'];
const synthesisPreviewKeys = ['toolTurnId', 'synthesisAuthority', 'synthesisAuthorityDigest', 'synthesisSummary', 'synthesisBinding', 'synthesisInputDigest', 'synthesisDisclosure', 'synthesisDisclosureWarning'];
const projectedPreviewKeys = ['id', 'kind', 'status', 'purpose', 'naturalQuestion', 'questionDisclosure', 'payload', 'digest', 'routeId', 'endpoint',
  'approvalRequired', 'send', 'receiptBoundary', 'providerPayloadObserved', 'estimatedCostMinor', 'costCurrency', 'questionDisclosureWarning',
  'definitionDisclosure', 'definitionDisclosureWarning', ...continuationPreviewKeys.filter(k => k !== 'requestScopeDigest'),
  'reviewedCalculationParameters', 'calculationParameterOrigins', 'calculationParametersDigest', 'calculationParameterDisclosure', 'calculationParameterDisclosureWarning',
  'toolTurnId', 'synthesisInputDigest', 'synthesisDisclosure', 'synthesisDisclosureWarning'];
const profileCategories = ['industry', 'products', 'customers', 'business_model', 'location'];
const origins = ['workspace-metadata', 'published-definition', 'source-observation', 'owner-told', 'draft-assumption'];
const qualificationsByOrigin: Readonly<Record<string, readonly string[]>> = {
  'workspace-metadata': ['metadata-only'], 'published-definition': ['metadata-only'], 'source-observation': ['unqualified-observation', 'evidence-qualified'], 'owner-told': ['owner-stated'], 'draft-assumption': ['draft'],
};
function qualification(origin: unknown, value: unknown, path: string): void { if (typeof origin !== 'string' || typeof value !== 'string' || !qualificationsByOrigin[origin]?.includes(value)) fail(path); }
function alias(value: unknown, prefix: string, path: string): void { if (typeof value !== 'string' || !new RegExp(`^${prefix}[1-9]\\d{0,3}$`).test(value)) fail(path); }
function aliases(value: unknown, prefix: string, path: string): string[] { const list = ids(value, path, 8192); list.forEach(v => alias(v, prefix, path)); return list; }
function summary(value: unknown, path: string): void {
  const v = shape(value, path, ['schemaVersion', 'question', 'results', 'evidence', 'citationRefs']); eq(v.schemaVersion, 1, `${path}.schemaVersion`); text(v.question, `${path}.question`, 8000);
  const citations = aliases(v.citationRefs, 'c', `${path}.citationRefs`), evidence = array(v.evidence, `${path}.evidence`, 64), resultList = array(v.results, `${path}.results`, 4);
  if (!resultList.length || !evidence.length || citations.length > 64) fail(`${path}.results`);
  const evidenceMap = new Map<string, Record<string, unknown>>();
  evidence.forEach((item, i) => {
    const p = `${path}.evidence[${i}]`, e = object(item, p); alias(e.ref, 'e', `${p}.ref`); alias(e.resultRef, 'r', `${p}.resultRef`);
    if (evidenceMap.has(e.ref as string)) fail(`${p}.ref`); evidenceMap.set(e.ref as string, e);
    if (e.kind === 'claim') {
      shape(e, p, ['kind', 'ref', 'resultRef', 'text', 'origin', 'qualification', 'citationRefs']); text(e.text, `${p}.text`, 4096); choice(e.origin, origins, `${p}.origin`); qualification(e.origin, e.qualification, `${p}.qualification`);
      const refs = aliases(e.citationRefs, 'c', `${p}.citationRefs`); if (!refs.length || refs.length > 16 || refs.some(ref => !citations.includes(ref))) fail(`${p}.citationRefs`);
    } else if (e.kind === 'figure') {
      shape(e, p, ['kind', 'ref', 'resultRef', 'label', 'unit'], ['currency']); text(e.label, `${p}.label`, 200); choice(e.unit, ['money', 'basis-points'], `${p}.unit`);
      if (Object.hasOwn(e, 'currency') && (typeof e.currency !== 'string' || !/^[A-Z]{3}$/.test(e.currency))) fail(`${p}.currency`);
      if (e.unit === 'money' && !Object.hasOwn(e, 'currency')) fail(`${p}.currency`);
      if (e.unit === 'basis-points' && Object.hasOwn(e, 'currency')) fail(`${p}.currency`);
    } else if (e.kind === 'scope') { shape(e, p, ['kind', 'ref', 'resultRef', 'label']); text(e.label, `${p}.label`, 200); }
    else if (e.kind === 'caution') { shape(e, p, ['kind', 'ref', 'resultRef', 'code', 'label', 'required']); if (typeof e.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(e.code)) fail(`${p}.code`); text(e.label, `${p}.label`, 512); eq(e.required, true, `${p}.required`); }
    else fail(`${p}.kind`);
  });
  const resultRefs = new Set<string>();
  resultList.forEach((item, i) => {
    const p = `${path}.results[${i}]`, r = shape(item, p, ['ref', 'tool', 'status', 'evidenceRefs']); alias(r.ref, 'r', `${p}.ref`);
    if (resultRefs.has(r.ref as string)) fail(`${p}.ref`); resultRefs.add(r.ref as string);
    choice(r.tool, ['business.describe', 'calculator.calculate'], `${p}.tool`); choice(r.status, ['ok', 'partial', 'unavailable'], `${p}.status`);
    const refs = aliases(r.evidenceRefs, 'e', `${p}.evidenceRefs`);
    const selected = [...evidenceMap.values()].filter(e => e.resultRef === r.ref);
    if (!refs.length || refs.length > 64 || !sameData(refs, selected.map(e => e.ref))) fail(`${p}.evidenceRefs`);
    if (r.status !== 'ok' && !selected.some(e => e.kind === 'caution')) fail(`${p}.status`);
  });
  if ([...evidenceMap.values()].some(e => !resultRefs.has(e.resultRef as string))) fail(`${path}.evidence`);
  json(value, path, 131072);
}
function synthesisMetadata(v: Record<string, unknown>, path: string): void {
  summary(v.synthesisSummary, `${path}.synthesisSummary`);
  const s = v.synthesisSummary as Record<string, unknown>, b = shape(v.synthesisBinding, `${path}.synthesisBinding`, ['toolTurnId', 'plannerModelReceiptId', 'toolResultsDigest', 'inputDigest', 'evidence']);
  id(b.toolTurnId, `${path}.synthesisBinding.toolTurnId`); id(b.plannerModelReceiptId, `${path}.synthesisBinding.plannerModelReceiptId`); digest(b.toolResultsDigest, `${path}.synthesisBinding.toolResultsDigest`); digest(b.inputDigest, `${path}.synthesisBinding.inputDigest`);
  eq(b.toolTurnId, v.toolTurnId, `${path}.synthesisBinding.toolTurnId`); eq(b.inputDigest, v.synthesisInputDigest, `${path}.synthesisBinding.inputDigest`); eq(s.question, v.naturalQuestion, `${path}.synthesisSummary.question`);
  const evidence = array(b.evidence, `${path}.synthesisBinding.evidence`, 8192), refs = new Set<string>();
  const published = s.evidence as Record<string, unknown>[];
  evidence.forEach((item, i) => {
    const p = `${path}.synthesisBinding.evidence[${i}]`, e = shape(item, p, ['ref', 'resultRef', 'answerId', 'evidenceHash', 'renderText'], ['receiptId', 'figureKey', 'citationIds']);
    alias(e.ref, 'e', `${p}.ref`); alias(e.resultRef, 'r', `${p}.resultRef`); id(e.answerId, `${p}.answerId`); digest(e.evidenceHash, `${p}.evidenceHash`); text(e.renderText, `${p}.renderText`);
    if (refs.has(e.ref as string) || !published.some(r => r.ref === e.ref && r.resultRef === e.resultRef)) fail(`${p}.ref`); refs.add(e.ref as string);
    for (const k of ['receiptId', 'figureKey']) if (Object.hasOwn(e, k)) id(e[k], `${p}.${k}`);
    if (Object.hasOwn(e, 'citationIds')) ids(e.citationIds, `${p}.citationIds`);
  });
  if (refs.size !== published.length) fail(`${path}.synthesisBinding.evidence`);
  const a = shape(v.synthesisAuthority, `${path}.synthesisAuthority`, ['summary', 'binding', 'sourceIds', 'factIds', 'rowIds']);
  if (JSON.stringify(a.summary) !== JSON.stringify(s) || JSON.stringify(a.binding) !== JSON.stringify(b)) fail(`${path}.synthesisAuthority`);
  for (const k of ['sourceIds', 'factIds', 'rowIds']) sameIds(ids(a[k], `${path}.synthesisAuthority.${k}`), v[k], `${path}.synthesisAuthority.${k}`);
}
function selectedCalculationParameters(value: Record<string, unknown>, path: string): ReviewedCalculationParameters {
  const selected: Record<string, unknown> = {};
  for (const key of calculationParameterKeys) if (Object.hasOwn(value, key)) selected[key] = value[key];
  return validateReviewedCalculationParameters(selected, path);
}
function calculationReview(v: Record<string, unknown>, request: ConversationRequest): void {
  const path = 'preview';
  const parameters = validateReviewedCalculationParameters(v.reviewedCalculationParameters, path + '.reviewedCalculationParameters');
  const origins = validateCalculationParameterOrigins(v.calculationParameterOrigins, parameters, path + '.calculationParameterOrigins');
  const supplied = selectedCalculationParameters(request as unknown as Record<string, unknown>, 'request.calculationParameters');
  const retained = v.continuation as Record<string, unknown> | undefined;
  const retainedScope = retained?.requestScope as Record<string, unknown> | undefined;
  const inherited = validateReviewedCalculationParameters(retained?.reviewedCalculationParameters
    ?? (retainedScope?.period !== undefined ? { period: retainedScope.period } : {}), path + '.continuation.reviewedCalculationParameters');
  const expected: Record<string, unknown> = {}, expectedOrigins: Record<string, unknown> = {};
  for (const key of calculationParameterKeys) {
    if (inherited[key] !== undefined && supplied[key] !== undefined && !sameData(inherited[key], supplied[key])) fail(path + '.reviewedCalculationParameters.' + key);
    const value = inherited[key] ?? supplied[key];
    if (value !== undefined) {
      expected[key] = value;
      expectedOrigins[key] = inherited[key] !== undefined ? 'retained-owner-requested' : 'owner-requested';
    }
  }
  if (!sameData(parameters, expected) || !sameData(origins, expectedOrigins)) fail(path + '.reviewedCalculationParameters');
  const selectedScope = v.requestScope as Record<string, unknown>;
  if (Object.hasOwn(selectedScope, 'period') && !sameData(parameters.period, selectedScope.period)) fail(path + '.requestScope.period');
  validateCalculationParameterDisclosure(v.calculationParameterDisclosure, parameters, origins, path + '.calculationParameterDisclosure');
  digest(v.calculationParametersDigest, path + '.calculationParametersDigest');
  text(v.calculationParameterDisclosureWarning, path + '.calculationParameterDisclosureWarning');
}
export function validateModelPreview(value: unknown, expected: ConversationRequest | SynthesisPreviewRequest): CheckedModelPreview {
  const path = 'preview', raw = object(value, path), synthesis = raw.purpose === 'conversation-synthesis';
  const v = shape(value, path, [...basePreviewKeys, ...(synthesis ? synthesisPreviewKeys : conversationPreviewKeys)], ['estimatedCostMinor', ...(synthesis ? [] : continuationPreviewKeys)]);
  eq(v.kind, 'model-preview', `${path}.kind`); eq(v.status, 'preview', `${path}.status`); choice(v.purpose, ['conversation', 'conversation-synthesis'], `${path}.purpose`);
  for (const k of ['id', 'memberId', 'routeId']) id(v[k], `${path}.${k}`);
  for (const k of ['epoch', 'routeRevision']) integer(v[k], `${path}.${k}`, 1);
  for (const k of ['createdAt', 'at']) assertISOInstant(v[k], `${path}.${k}`);
  for (const k of ['questionHash', 'factDigest', 'trustFingerprint', 'schemaDigest', 'digest']) digest(v[k], `${path}.${k}`);
  eq(v.questionDisclosure, 'verbatim', `${path}.questionDisclosure`); text(v.naturalQuestion, `${path}.naturalQuestion`, 8000); text(v.instructions, `${path}.instructions`, 262144); text(v.payload, `${path}.payload`, 262144);
  if (new TextEncoder().encode(v.payload).length > 262144) fail(`${path}.payload`);
  eq(v.approvalRequired, true, `${path}.approvalRequired`); eq(v.costReservedMinor, '0', `${path}.costReservedMinor`); eq(v.costCurrency, 'INR', `${path}.costCurrency`); eq(v.experimental, true, `${path}.experimental`);
  choice(v.send, ['shape', 'samples'], `${path}.send`); choice(v.receiptBoundary, ['application-to-official-cli', 'application-to-provider-http'], `${path}.receiptBoundary`);
  eq(v.providerPayloadObserved, v.receiptBoundary === 'application-to-provider-http', `${path}.providerPayloadObserved`);
  for (const k of ['sourceIds', 'factIds', 'rowIds']) ids(v[k], `${path}.${k}`);
  if (Object.hasOwn(v, 'endpoint')) endpoint(v.endpoint, `${path}.endpoint`, v.receiptBoundary);
  if (Object.hasOwn(v, 'estimatedCostMinor') && (typeof v.estimatedCostMinor !== 'string' || !/^\d{1,256}$/.test(v.estimatedCostMinor))) fail(`${path}.estimatedCostMinor`);
  if (synthesis) {
    const selected = synthesisPreviewRequest((expected as SynthesisPreviewRequest).id, expected.routeId);
    id(v.toolTurnId, `${path}.toolTurnId`); eq(v.toolTurnId, selected.id, `${path}.toolTurnId`);
    if (selected.routeId !== undefined) eq(v.routeId, selected.routeId, `${path}.routeId`);
    eq(v.send, 'samples', `${path}.send`); eq(v.synthesisDisclosure, 'admitted-tool-summary', `${path}.synthesisDisclosure`); text(v.synthesisDisclosureWarning, `${path}.synthesisDisclosureWarning`);
    digest(v.synthesisInputDigest, `${path}.synthesisInputDigest`); digest(v.synthesisAuthorityDigest, `${path}.synthesisAuthorityDigest`); synthesisMetadata(v, path);
  } else {
    const request = validateConversationRequest(expected); eq(v.naturalQuestion, request.question, `${path}.naturalQuestion`); eq(v.routeId, request.routeId, `${path}.routeId`);
    text(v.questionDisclosureWarning, `${path}.questionDisclosureWarning`); text(v.definitionDisclosureWarning, `${path}.definitionDisclosureWarning`); eq(v.definitionDisclosure, 'published', `${path}.definitionDisclosure`);
    for (const k of ['contextDigest', 'profileSamplesHash']) digest(v[k], `${path}.${k}`);
    ids(v.profileIds, `${path}.profileIds`); scope(v.requestScope, `${path}.requestScope`);
    const selected = v.requestScope as Record<string, unknown>;
    for (const k of ['sourceIds', 'branch', 'asOf', 'onDate', 'period'] as const) if (request[k] !== undefined) {
      if (k === 'sourceIds') sameIds(selected[k] ?? [], request[k], `${path}.requestScope.${k}`);
      else if (k === 'asOf') { if (typeof selected[k] !== 'string' || Date.parse(selected[k]) !== Date.parse(request[k])) fail(`${path}.requestScope.${k}`); }
      else if (JSON.stringify(selected[k]) !== JSON.stringify(request[k])) fail(`${path}.requestScope.${k}`);
    }
    const hasContinuation = continuationPreviewKeys.some(k => Object.hasOwn(v, k));
    if (hasContinuation !== (request.continuationId !== undefined)) fail(`${path}.continuationId`);
    if (hasContinuation) {
      if (continuationPreviewKeys.some(k => !Object.hasOwn(v, k))) fail(`${path}.continuation`);
      eq(v.continuationId, request.continuationId, `${path}.continuationId`); continuation(v.continuation, request.continuationId!, `${path}.continuation`);
      eq(v.continuationDigest, (v.continuation as Record<string, unknown>).digest, `${path}.continuationDigest`); eq(v.continuationDisclosure, 'verbatim', `${path}.continuationDisclosure`);
      digest(v.requestScopeDigest, `${path}.requestScopeDigest`); text(v.continuationDisclosureWarning, `${path}.continuationDisclosureWarning`);
    }
    calculationReview(v, request);
  }
  json(value, path); const selected: Record<string, unknown> = {};
  for (const k of projectedPreviewKeys) if (Object.hasOwn(v, k)) selected[k] = v[k];
  const checked = snapshot<CheckedModelPreview>(selected);
  previewProofs.set(checked, synthesis ? { verified: false, summary: snapshot<Record<string, unknown>>(v.synthesisSummary), binding: snapshot<Record<string, unknown>>(v.synthesisBinding) }
    : { verified: false, request: validateConversationRequest(expected) });
  return checked;
}
export async function verifyModelPreview(value: unknown, expected: ConversationRequest | SynthesisPreviewRequest): Promise<CheckedModelPreview> {
  const checked = validateModelPreview(value, expected), v = snapshot<Record<string, unknown>>(value);
  eq(await sha(checked.payload, 'preview.digest'), checked.digest, 'preview.digest');
  eq(await sha(checked.naturalQuestion, 'preview.questionHash'), v.questionHash, 'preview.questionHash');
  eq(await sha(JSON.stringify(v.schema), 'preview.schemaDigest'), v.schemaDigest, 'preview.schemaDigest');
  // The ce5 gateway has exactly these three payload envelopes. Hashing the
  // envelope alone does not bind its disclosed input to the displayed review.
  let input: unknown;
  try {
    if (checked.receiptBoundary === 'application-to-official-cli') {
      const prefix = `${v.instructions as string}\n`; if (!checked.payload.startsWith(prefix)) fail('preview.payload.instructions');
      input = checked.payload.slice(prefix.length);
    } else {
      const envelope = object(JSON.parse(checked.payload), 'preview.payload');
      if (Object.hasOwn(envelope, 'messages')) {
        if (Object.hasOwn(envelope, 'input')) fail('preview.payload');
        const messages = array(envelope.messages, 'preview.payload.messages', 2); if (messages.length !== 2) fail('preview.payload.messages');
        const system = shape(messages[0], 'preview.payload.messages[0]', ['role', 'content']), user = shape(messages[1], 'preview.payload.messages[1]', ['role', 'content']);
        eq(system.role, 'system', 'preview.payload.messages[0].role'); eq(system.content, v.instructions, 'preview.payload.instructions'); eq(user.role, 'user', 'preview.payload.messages[1].role'); input = user.content;
      } else { eq(envelope.instructions, v.instructions, 'preview.payload.instructions'); input = envelope.input; }
    }
    text(input, 'preview.payload.input', 262144); input = JSON.parse(input);
  } catch { fail('preview.payload.input'); }
  json(input, 'preview.payload.input', 262144); const content = object(input, 'preview.payload.input');
  if (checked.purpose === 'conversation-synthesis') {
    eq(await sha(JSON.stringify(v.synthesisSummary), 'preview.synthesisInputDigest'), checked.synthesisInputDigest, 'preview.synthesisInputDigest');
    eq(await sha(JSON.stringify(v.synthesisAuthority), 'preview.synthesisAuthorityDigest'), v.synthesisAuthorityDigest, 'preview.synthesisAuthorityDigest');
    eq(await sha(JSON.stringify(content), 'preview.payload.input'), checked.synthesisInputDigest, 'preview.payload.input');
    const published = (v.synthesisSummary as Record<string, unknown>).evidence as Record<string, unknown>[];
    for (const local of (v.synthesisBinding as Record<string, unknown>).evidence as Record<string, unknown>[]) {
      const descriptor = published.find(item => item.ref === local.ref)!;
      const { ref: _ref, resultRef: _resultRef, ...item } = descriptor;
      const metadata = Object.fromEntries(Object.entries(local).filter(([key]) => ['receiptId', 'figureKey', 'citationIds'].includes(key)));
      eq(await sha(JSON.stringify({ item, renderText: local.renderText, metadata }), 'preview.synthesisBinding.evidenceHash'), local.evidenceHash, 'preview.synthesisBinding.evidenceHash');
    }
  } else {
    const parameters = validateReviewedCalculationParameters(v.reviewedCalculationParameters, 'preview.reviewedCalculationParameters');
    const origins = validateCalculationParameterOrigins(v.calculationParameterOrigins, parameters, 'preview.calculationParameterOrigins');
    eq(await sha(JSON.stringify(v.reviewedCalculationParameters), 'preview.calculationParametersDigest'), v.calculationParametersDigest, 'preview.calculationParametersDigest');
    validateCalculationParameterDisclosure(content.calculationParameters, parameters, origins, 'preview.payload.calculationParameters');
    eq(await sha(JSON.stringify(content.calculationParameters), 'preview.payload.calculationParameters'),
      await sha(JSON.stringify(v.calculationParameterDisclosure), 'preview.calculationParameterDisclosure'), 'preview.payload.calculationParameters');
    eq(content.question, checked.naturalQuestion, 'preview.payload.question'); eq(content.questionDisclosure, 'verbatim', 'preview.payload.questionDisclosure');
    if (checked.continuation) {
      const retained = await verifyConversationContinuation(checked.continuation, checked.continuation.turnId);
      const { turnId, originalQuestion, clarification, exchanges } = retained;
      eq(content.continuationDisclosure, 'verbatim', 'preview.payload.continuationDisclosure');
      eq(await sha(JSON.stringify(content.continuation), 'preview.payload.continuation'), await sha(JSON.stringify({ turnId, originalQuestion, clarification, ...(exchanges !== undefined ? { exchanges } : {}) }), 'preview.continuation'), 'preview.payload.continuation');
      eq(await sha(JSON.stringify(v.requestScope), 'preview.requestScopeDigest'), v.requestScopeDigest, 'preview.requestScopeDigest');
      const businessContext = object(v.businessContext, 'preview.businessContext'); scope(businessContext.request, 'preview.businessContext.request');
      eq(await sha(JSON.stringify(v.requestScope), 'preview.requestScopeDigest'), await sha(JSON.stringify(businessContext.request), 'preview.businessContext.request'), 'preview.requestScopeDigest');
    } else if (Object.hasOwn(content, 'continuation') || Object.hasOwn(content, 'continuationDisclosure')) fail('preview.payload.continuation');
  }
  previewProofs.get(checked)!.verified = true;
  return checked;
}
export function validateOutboundApproval(value: unknown, preview: CheckedModelPreview): CheckedOutboundApproval {
  const v = shape(value, 'approval', ['id', 'kind', 'previewId', 'digest', 'routeId', 'endpoint', 'approverId', 'approverEpoch', 'createdAt', 'expiresAt', 'used']);
  for (const k of ['id', 'previewId', 'routeId', 'approverId']) id(v[k], `approval.${k}`);
  digest(v.digest, 'approval.digest'); eq(v.kind, 'outbound-approval', 'approval.kind'); eq(v.used, false, 'approval.used'); integer(v.approverEpoch, 'approval.approverEpoch', 1);
  assertISOInstant(v.createdAt, 'approval.createdAt'); assertISOInstant(v.expiresAt, 'approval.expiresAt'); if (Date.parse(v.expiresAt) <= Date.parse(v.createdAt)) fail('approval.expiresAt');
  if (Object.hasOwn(v, 'endpoint')) endpoint(v.endpoint, 'approval.endpoint', preview.receiptBoundary);
  eq(v.previewId, preview.id, 'approval.previewId'); eq(v.digest, preview.digest, 'approval.digest'); eq(v.routeId, preview.routeId, 'approval.routeId'); eq(v.endpoint, preview.endpoint, 'approval.endpoint');
  return snapshot<CheckedOutboundApproval>(value);
}
function verifiedProof(preview: CheckedModelPreview): PreviewProof { const proof = previewProofs.get(preview); if (!proof?.verified) fail('preview.verification'); return proof; }
export function approveRequest(preview: CheckedModelPreview): { readonly id: string } { verifiedProof(preview); return conversationIdRequest(preview.id); }
export function askRequest(request: ConversationRequest, preview: CheckedModelPreview, approval: CheckedOutboundApproval): ConversationAskRequest {
  const checked = validateConversationRequest(request); eq(preview.purpose, 'conversation', 'request.preview.purpose'); eq(preview.naturalQuestion, checked.question, 'request.preview.question'); eq(preview.routeId, checked.routeId, 'request.preview.routeId');
  if (!sameData(verifiedProof(preview).request, checked)) fail('request.preview.scope');
  eq((preview as CheckedConversationPreview).continuationId, checked.continuationId, 'request.preview.continuationId'); validateOutboundApproval(approval, preview);
  return snapshot<ConversationAskRequest>({ ...checked, previewId: preview.id, approvalId: approval.id });
}
export function synthesisPreviewRequest(value: unknown, routeId?: string): SynthesisPreviewRequest {
  const result: { id: string; routeId?: string } = { id: validateConversationId(value) }; if (routeId !== undefined) { id(routeId, 'request.routeId'); result.routeId = routeId; } return Object.freeze(result);
}
export function synthesisRunRequest(value: unknown, preview: CheckedModelPreview, approval: CheckedOutboundApproval): SynthesisRunRequest {
  verifiedProof(preview); const selected = validateConversationId(value); eq(preview.purpose, 'conversation-synthesis', 'request.preview.purpose'); eq((preview as CheckedSynthesisPreview).toolTurnId, selected, 'request.preview.toolTurnId'); validateOutboundApproval(approval, preview);
  return Object.freeze({ id: selected, previewId: preview.id, approvalId: approval.id });
}

function business(value: unknown, path: string, modelReceiptId?: string): CheckedBusinessAnswer {
  const v = shape(value, path, ['id', 'kind', 'status', 'message', 'claims', 'citations', 'unknowns', 'conflicts', 'scope', 'contextDigest', 'sourceIds', 'rowIds', 'profileIds', 'receipt']);
  id(v.id, `${path}.id`); eq(v.kind, 'business-context', `${path}.kind`); choice(v.status, ['grounded', 'partial', 'unknown'], `${path}.status`); text(v.message, `${path}.message`, 20000, true); digest(v.contextDigest, `${path}.contextDigest`);
  for (const k of ['sourceIds', 'rowIds', 'profileIds']) ids(v[k], `${path}.${k}`, 256);
  const citations = array(v.citations, `${path}.citations`, 256), citationSet = new Set<string>();
  citations.forEach((item, i) => {
    const p = `${path}.citations[${i}]`, c = shape(item, p, ['id', 'kind', 'referenceId', 'path', 'contentHash'], ['sourceId', 'factId', 'sourceRow', 'branch', 'validFrom', 'validTo', 'learnedAt']);
    for (const k of ['id', 'referenceId']) id(c[k], `${p}.${k}`); text(c.path, `${p}.path`); digest(c.contentHash, `${p}.contentHash`); choice(c.kind, ['workspace', 'dictionary', 'fact', 'profile'], `${p}.kind`);
    if (citationSet.has(c.id as string)) fail(`${p}.id`); citationSet.add(c.id as string);
    for (const k of ['sourceId', 'factId', 'branch']) if (Object.hasOwn(c, k)) text(c[k], `${p}.${k}`, 200);
    if (Object.hasOwn(c, 'sourceRow')) integer(c.sourceRow, `${p}.sourceRow`, 1);
    if (Object.hasOwn(c, 'validFrom')) assertISODate(c.validFrom, `${p}.validFrom`);
    if (Object.hasOwn(c, 'validTo') && c.validTo !== null) assertISODate(c.validTo, `${p}.validTo`);
    if (Object.hasOwn(c, 'learnedAt')) assertISOInstant(c.learnedAt, `${p}.learnedAt`);
  });
  const claimSet = new Set<string>(), usedCitations = new Set<string>(), claims = array(v.claims, `${path}.claims`, 16);
  claims.forEach((item, i) => {
    const p = `${path}.claims[${i}]`, c = shape(item, p, ['id', 'category', 'text', 'origin', 'qualification', 'citationIds']); id(c.id, `${p}.id`); text(c.text, `${p}.text`);
    choice(c.category, ['workspace', 'definitions', 'records', ...profileCategories], `${p}.category`); choice(c.origin, origins, `${p}.origin`); qualification(c.origin, c.qualification, `${p}.qualification`);
    if (claimSet.has(c.id as string)) fail(`${p}.id`); claimSet.add(c.id as string);
    const refs = ids(c.citationIds, `${p}.citationIds`, 256); if (!refs.length || refs.some(ref => !citationSet.has(ref))) fail(`${p}.citationIds`); refs.forEach(ref => usedCitations.add(ref));
  });
  if (usedCitations.size !== citationSet.size) fail(`${path}.citations`);
  const categories = new Set<string>(), unknowns = array(v.unknowns, `${path}.unknowns`, 5);
  unknowns.forEach((item, i) => {
    const p = `${path}.unknowns[${i}]`, u = shape(item, p, ['category', 'message']); choice(u.category, profileCategories, `${p}.category`); text(u.message, `${p}.message`);
    if (categories.has(u.category as string)) fail(`${p}.category`); categories.add(u.category as string);
    eq(u.message, `I do not have an established ${(u.category as string).replaceAll('_', ' ')} description in the currently permitted evidence.`, `${p}.message`);
  });
  const conflicts = array(v.conflicts, `${path}.conflicts`, 256);
  conflicts.forEach((item, i) => {
    const p = `${path}.conflicts[${i}]`, c = shape(item, p, ['category', 'citationIds', 'reason']); choice(c.category, ['records', ...profileCategories], `${p}.category`); if (!ids(c.citationIds, `${p}.citationIds`, 256).length) fail(`${p}.citationIds`); text(c.reason, `${p}.reason`);
    // Conflicts retain the whole manifest. Their citations may legitimately lie
    // outside the returned citations selected for released claims.
  });
  const s = shape(v.scope, `${path}.scope`, ['branch', 'asOf', 'onDate', 'syntheticFixture', 'corpus', 'completeness', 'limitations']);
  if (s.branch !== null) text(s.branch, `${path}.scope.branch`, 200); assertISOInstant(s.asOf, `${path}.scope.asOf`); assertISODate(s.onDate, `${path}.scope.onDate`);
  if (typeof s.syntheticFixture !== 'boolean') fail(`${path}.scope.syntheticFixture`); eq(s.corpus, 'currently-authorized-local-evidence', `${path}.scope.corpus`); eq(s.completeness, 'bounded', `${path}.scope.completeness`);
  const limitations = array(s.limitations, `${path}.scope.limitations`, 4), fixedLimitations = ['Only currently permitted, retained local evidence was searched.', 'Absence in this context does not establish absence elsewhere.', 'Owner statements and draft assumptions are not verified financial results.'];
  if ((limitations.length !== 3 && limitations.length !== 4) || fixedLimitations.some((item, i) => limitations[i] !== item) || limitations.length === 4 && limitations[3] !== 'Imported-record context is bounded; no exhaustive source coverage is claimed.') fail(`${path}.scope.limitations`);
  const established = claims.some(c => (c as Record<string, unknown>).origin === 'owner-told'), unqualified = claims.some(c => ['draft', 'unqualified-observation'].includes((c as Record<string, unknown>).qualification as string));
  eq(v.status, established ? unknowns.length || conflicts.length || unqualified ? 'partial' : 'grounded' : 'unknown', `${path}.status`);
  const expectedMessage = [...claims.map(c => (c as Record<string, unknown>).text), ...unknowns.map(u => (u as Record<string, unknown>).message), ...(conflicts.length ? ['Some permitted source claims conflict, so they were not treated as established business facts.'] : [])].join('\n');
  eq(v.message, expectedMessage, `${path}.message`);
  const r = shape(v.receipt, `${path}.receipt`, ['id', 'kind', 'contextDigest', 'financialCalculation', 'sourceIds', 'rowIds'], ['modelReceiptId']);
  eq(r.id, v.id, `${path}.receipt.id`); eq(r.kind, 'business-context-receipt', `${path}.receipt.kind`); eq(r.contextDigest, v.contextDigest, `${path}.receipt.contextDigest`); eq(r.financialCalculation, false, `${path}.receipt.financialCalculation`);
  for (const k of ['sourceIds', 'rowIds']) sameIds(ids(r[k], `${path}.receipt.${k}`, 256), v[k], `${path}.receipt.${k}`);
  if (Object.hasOwn(r, 'modelReceiptId')) id(r.modelReceiptId, `${path}.receipt.modelReceiptId`);
  if (modelReceiptId !== undefined) eq(r.modelReceiptId, modelReceiptId, `${path}.receipt.modelReceiptId`);
  json(value, path, 131072); return snapshot<CheckedBusinessAnswer>(value);
}
function grounded(value: unknown, path: string, errorMessageMaximum = 512): CheckedGroundedConversation {
  const v = shape(value, path, ['id', 'kind', 'modelReceiptId', 'results', 'receipt']); id(v.id, `${path}.id`); id(v.modelReceiptId, `${path}.modelReceiptId`); eq(v.kind, 'grounded-conversation', `${path}.kind`);
  const results = array(v.results, `${path}.results`, 4); if (!results.length) fail(`${path}.results`);
  const checked: CheckedConversationToolResult[] = results.map((item, i) => {
    const p = `${path}.results[${i}]`, r = object(item, p); choice(r.tool, ['business.describe', 'calculator.calculate'], `${p}.tool`);
    if (Object.hasOwn(r, 'error')) {
      shape(r, p, ['tool', 'error']); const e = shape(r.error, `${p}.error`, ['code', 'message']); if (typeof e.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(e.code)) fail(`${p}.error.code`); text(e.message, `${p}.error.message`, errorMessageMaximum);
      return snapshot<CheckedConversationToolResult>(r);
    }
    shape(r, p, ['tool', 'answer']);
    if (r.tool === 'business.describe') return { tool: 'business.describe', answer: business(r.answer, `${p}.answer`, v.modelReceiptId as string) };
    const answer = projectCalculationReceipt(r.answer); if (answer.stale) fail(`${p}.answer.stale`);
    return { tool: 'calculator.calculate', answer };
  });
  const r = shape(v.receipt, `${path}.receipt`, ['id', 'kind', 'modelReceiptId', 'resultRefs']); eq(r.id, v.id, `${path}.receipt.id`); eq(r.kind, 'conversation-tool-receipt', `${path}.receipt.kind`); eq(r.modelReceiptId, v.modelReceiptId, `${path}.receipt.modelReceiptId`);
  const refs = array(r.resultRefs, `${path}.receipt.resultRefs`, 4), successful = checked.filter(item => !item.error), seen = new Set<string>();
  if (refs.length !== successful.length) fail(`${path}.receipt.resultRefs`);
  refs.forEach((item, i) => {
    const p = `${path}.receipt.resultRefs[${i}]`, ref = shape(item, p, ['tool', 'answerId']); eq(ref.tool, successful[i]?.tool, `${p}.tool`); id(ref.answerId, `${p}.answerId`);
    if (seen.has(ref.answerId as string)) fail(`${p}.answerId`); seen.add(ref.answerId as string);
    const success = successful[i]; if (success?.tool === 'business.describe') eq(ref.answerId, success.answer?.id, `${p}.answerId`);
    // A calculation's retained message ID and its calculation receipt ID are
    // distinct. Reopening that child is the Engine's current-authority check.
  });
  return snapshot<CheckedGroundedConversation>({ ...v, results: checked });
}
function synthesized(value: unknown, path: string, errorMessageMaximum = 512): CheckedSynthesizedConversation {
  const v = shape(value, path, ['id', 'kind', 'paragraphs', 'cautions', 'references', 'tools', 'receipt']); id(v.id, `${path}.id`); eq(v.kind, 'synthesized-conversation', `${path}.kind`);
  const paragraphs = array(v.paragraphs, `${path}.paragraphs`, 12); if (!paragraphs.length) fail(`${path}.paragraphs`); paragraphs.forEach((p, i) => text(p, `${path}.paragraphs[${i}]`));
  const tools = grounded(v.tools, `${path}.tools`, errorMessageMaximum), r = shape(v.receipt, `${path}.receipt`, ['id', 'kind', 'toolTurnId', 'plannerModelReceiptId', 'synthesisModelReceiptId', 'inputDigest', 'outputDigest']);
  eq(r.id, v.id, `${path}.receipt.id`); eq(r.kind, 'conversation-synthesis-receipt', `${path}.receipt.kind`); eq(r.toolTurnId, tools.id, `${path}.receipt.toolTurnId`); eq(r.plannerModelReceiptId, tools.modelReceiptId, `${path}.receipt.plannerModelReceiptId`);
  id(r.synthesisModelReceiptId, `${path}.receipt.synthesisModelReceiptId`); digest(r.inputDigest, `${path}.receipt.inputDigest`); digest(r.outputDigest, `${path}.receipt.outputDigest`);
  const allowedAnswers = new Set([tools.id, ...tools.receipt.resultRefs.map(ref => ref.answerId)]), allowedReceipts = new Set<string>(), allowedCitations = new Set<string>();
  tools.results.forEach(result => {
    if (result.error) return;
    if (result.tool === 'calculator.calculate') allowedReceipts.add(result.answer.id);
    else result.answer.citations.forEach(c => allowedCitations.add(c.id));
  });
  const references = array(v.references, `${path}.references`, 12); if (references.length !== paragraphs.length) fail(`${path}.references`);
  references.forEach((item, i) => {
    const p = `${path}.references[${i}]`, ref = shape(item, p, ['evidenceRefs', 'answerIds', 'receiptIds', 'citationIds']); const evidence = aliases(ref.evidenceRefs, 'e', `${p}.evidenceRefs`), answers = ids(ref.answerIds, `${p}.answerIds`, 5);
    if (!evidence.length || !answers.length || answers.some(x => !allowedAnswers.has(x))) fail(p);
    if (ids(ref.receiptIds, `${p}.receiptIds`, 4).some(x => !allowedReceipts.has(x)) || ids(ref.citationIds, `${p}.citationIds`, 256).some(x => !allowedCitations.has(x))) fail(p);
  });
  const cautionRefs = new Set<string>(); array(v.cautions, `${path}.cautions`, 8192).forEach((item, i) => {
    const p = `${path}.cautions[${i}]`, c = shape(item, p, ['ref', 'text']); alias(c.ref, 'e', `${p}.ref`); text(c.text, `${p}.text`); if (cautionRefs.has(c.ref as string)) fail(`${p}.ref`); cautionRefs.add(c.ref as string);
  });
  return snapshot<CheckedSynthesizedConversation>({ ...v, tools });
}
function clarification(value: unknown, path: string): CheckedClarification {
  const v = shape(value, path, ['clarification', 'modelReceiptId']); text(v.clarification, `${path}.clarification`, 500); id(v.modelReceiptId, `${path}.modelReceiptId`); return snapshot<CheckedClarification>(value);
}
export function validateConversationReply(value: unknown, expected: ConversationReplyExpectation = {}): CheckedConversationReply { return conversationReply(value, expected, 512); }
function conversationReply(value: unknown, expected: ConversationReplyExpectation, errorMessageMaximum: number): CheckedConversationReply {
  json(value, 'answer'); const v = object(value, 'answer'); let checked: CheckedConversationReply;
  if (v.kind === 'grounded-conversation') checked = grounded(value, 'answer', errorMessageMaximum);
  else if (v.kind === 'synthesized-conversation') checked = synthesized(value, 'answer', errorMessageMaximum);
  else checked = clarification(value, 'answer');
  const modelReceiptId = 'modelReceiptId' in checked ? checked.modelReceiptId : checked.receipt.plannerModelReceiptId;
  if (expected.modelReceiptId !== undefined) eq(modelReceiptId, expected.modelReceiptId, 'answer.modelReceiptId');
  if (expected.toolTurnId !== undefined || expected.synthesisModelReceiptId !== undefined || expected.inputDigest !== undefined) {
    if (!('kind' in checked) || checked.kind !== 'synthesized-conversation') fail('answer.kind');
    if (expected.toolTurnId !== undefined) eq(checked.receipt.toolTurnId, expected.toolTurnId, 'answer.receipt.toolTurnId');
    if (expected.synthesisModelReceiptId !== undefined) eq(checked.receipt.synthesisModelReceiptId, expected.synthesisModelReceiptId, 'answer.receipt.synthesisModelReceiptId');
    if (expected.inputDigest !== undefined) eq(checked.receipt.inputDigest, expected.inputDigest, 'answer.receipt.inputDigest');
  }
  if (expected.preview !== undefined) {
    const preview = expected.preview, proof = verifiedProof(preview);
    if (preview.purpose === 'conversation') eq(modelReceiptId, preview.id, 'answer.modelReceiptId');
    else {
      if (!('kind' in checked) || checked.kind !== 'synthesized-conversation' || !proof.summary || !proof.binding) fail('answer.kind');
      eq(checked.receipt.synthesisModelReceiptId, preview.id, 'answer.receipt.synthesisModelReceiptId'); eq(checked.receipt.toolTurnId, preview.toolTurnId, 'answer.receipt.toolTurnId'); eq(checked.receipt.inputDigest, preview.synthesisInputDigest, 'answer.receipt.inputDigest');
      eq(checked.receipt.plannerModelReceiptId, proof.binding.plannerModelReceiptId, 'answer.receipt.plannerModelReceiptId');
      const evidence = proof.summary.evidence as Record<string, unknown>[], local = proof.binding.evidence as Record<string, unknown>[];
      const cautions = evidence.filter(e => e.kind === 'caution').map(e => ({ ref: e.ref, text: local.find(item => item.ref === e.ref)?.renderText }));
      if (!sameData(checked.cautions, cautions)) fail('answer.cautions');
      const covered = new Set(checked.references.flatMap(ref => ref.evidenceRefs));
      if (evidence.filter(e => e.kind === 'figure' || e.kind === 'scope').some(e => !covered.has(e.ref as string))) fail('answer.references.coverage');
      checked.references.forEach((ref, i) => {
        const selected = ref.evidenceRefs.map(key => { const item = local.find(e => e.ref === key); if (!item) fail(`answer.references[${i}].evidenceRefs`); return item; });
        for (const [key, values] of [
          ['answerIds', selected.map(e => e.answerId)], ['receiptIds', selected.flatMap(e => e.receiptId ? [e.receiptId] : [])], ['citationIds', selected.flatMap(e => (e.citationIds as string[] | undefined) ?? [])],
        ] as const) sameIds(ref[key], [...new Set(values)], `answer.references[${i}].${key}`);
      });
    }
  }
  return checked;
}
export async function verifyConversationReply(value: unknown, expected: ConversationReplyExpectation = {}): Promise<CheckedConversationReply> {
  const checked = validateConversationReply(value, expected);
  if (expected.preview?.purpose === 'conversation-synthesis') {
    const raw = snapshot<Record<string, unknown>>(value), proof = verifiedProof(expected.preview);
    eq(await sha(JSON.stringify(raw.tools), 'answer.tools.digest'), proof.binding?.toolResultsDigest, 'answer.tools.digest');
  }
  return checked;
}
export function validateConversationReadback(value: unknown, expectedId: string): CheckedConversationReadback {
  id(expectedId, 'request.id'); json(value, 'readback'); const v = shape(value, 'readback', ['id', 'at', 'question', 'kind', 'answer']); id(v.id, 'readback.id'); assertISOInstant(v.at, 'readback.at'); text(v.question, 'readback.question', 8000);
  let answer: CheckedConversationReply | CheckedBusinessAnswer | CheckedCalculationAnswer;
  if (v.kind === 'business-context') answer = business(v.answer, 'readback.answer');
  else if (v.kind === 'calculation') {
    const a = object(v.answer, 'readback.answer');
    if (Object.hasOwn(a, 'supported')) {
      shape(a, 'readback.answer', ['supported', 'message', 'receipt']); eq(a.supported, true, 'readback.answer.supported'); text(a.message, 'readback.answer.message'); const receipt = projectCalculationReceipt(a.receipt); if (receipt.stale) fail('readback.answer.receipt.stale'); eq(a.message, receipt.explanation, 'readback.answer.message'); answer = { supported: true, message: a.message, receipt };
    } else { answer = projectCalculationReceipt(a); if (answer.stale) fail('readback.answer.stale'); }
  } else {
    choice(v.kind, ['clarification', 'grounded-conversation', 'synthesized-conversation'], 'readback.kind'); answer = conversationReply(v.answer, {}, 2000);
    eq(v.kind, 'kind' in answer ? answer.kind : 'clarification', 'readback.kind');
  }
  if (v.id !== expectedId && !(v.kind === 'clarification' && 'modelReceiptId' in answer && answer.modelReceiptId === expectedId)) fail('readback.id');
  if (['business-context', 'grounded-conversation', 'synthesized-conversation'].includes(v.kind as string)) eq((answer as { id: string }).id, v.id, 'readback.answer.id');
  return snapshot<CheckedConversationReadback>({ ...v, answer });
}
