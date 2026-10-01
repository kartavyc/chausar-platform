import type { DesktopMethod } from './ipc-contract.cjs';
import type { JobConfig } from '../../platform/runtime/jobs.ts';
import type { CalendarDefinition } from '../../platform/runtime/calendar.ts';
import type { MappingRecipe } from '../../platform/runtime/ingest.ts';
import type { MappingReview, IndependentSourceTotals } from '../../platform/runtime/connector-framework/import.ts';
import type { JournalContent, JournalDecision, JournalDraft } from '../../platform/runtime/decision-journal.ts';
import type { JournalDecisionReview } from '../../platform/runtime/reports.ts';
import type { BusinessProfileInput, renderBusinessAnswer } from '../../platform/runtime/conversation-context.ts';
import type { CalculationReceipt } from '../../platform/runtime/calculator.ts';
import type { BridgeProfileDefinition, BridgeProfileRecord, BridgeRunRequest, BridgeRecord } from '../../platform/runtime/bridge-service.ts';
import type { InvestigationCreate, Investigation, InvestigationRevisionInput, InvestigationCapsule, InvestigationDrilldown } from '../../platform/runtime/investigation-contracts.ts';
import type { InvestigationSearchRequest } from '../../platform/runtime/investigation-search.ts';
import type { ResearchSearchService } from '../../platform/runtime/research-search.ts';
import type { ConversationHistoryService, ConversationResultReference } from '../../platform/runtime/conversation-history.ts';
import type { ModelRequest } from '../../platform/runtime/gateway.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export type DesktopConversationSynthesisPreview = {
  id: string; kind: 'model-preview'; status: 'preview'; purpose: 'conversation-synthesis';
  toolTurnId: string; naturalQuestion: string; question?: string; synthesisDisclosureWarning: string;
  payload: string; digest: string; routeId: string; endpoint?: string; approvalRequired: boolean;
  send: 'samples';
  receiptBoundary: 'application-to-official-cli' | 'application-to-provider-http'; providerPayloadObserved: boolean;
  estimatedCostMinor?: string; costCurrency?: string;
};
type DesktopBusinessAnswer = ReturnType<typeof renderBusinessAnswer> & {
  id: string;
  receipt: { id: string; kind: 'business-context-receipt'; contextDigest: string; financialCalculation: false;
    sourceIds: string[]; rowIds: string[]; modelReceiptId?: string };
};
export type DesktopGroundedConversation = {
  id: string; kind: 'grounded-conversation'; modelReceiptId: string;
  results: Array<
    { tool: 'business.describe'; answer: DesktopBusinessAnswer; error?: never }
    | { tool: 'calculator.calculate'; answer: CalculationReceipt; error?: never }
    | { tool: ConversationResultReference['tool']; error: { code: string; message: string }; answer?: never }
  >;
  receipt: { id: string; kind: 'conversation-tool-receipt'; modelReceiptId: string; resultRefs: ConversationResultReference[] };
};
export type DesktopConversationSynthesisResult = {
  id: string; kind: 'synthesized-conversation'; paragraphs: string[]; cautions: { ref: string; text: string }[];
  references: { evidenceRefs: string[]; answerIds: string[]; receiptIds: string[]; citationIds: string[] }[];
  tools: DesktopGroundedConversation;
  receipt: { id: string; kind: 'conversation-synthesis-receipt'; toolTurnId: string; plannerModelReceiptId: string;
    synthesisModelReceiptId: string; inputDigest: string; outputDigest: string };
};
type JobPayloadFields = Omit<JobConfig, 'input' | 'plan' | 'type'>;
export type DesktopGoalJobConfig = JobPayloadFields & {
  type: 'calculation-set' | 'evidence-review' | 'action-preparation';
  input: JsonValue;
  limits: NonNullable<JobConfig['limits']>;
};
export type DesktopJobConfig = (JobPayloadFields & { type: 'owner-brief'; input?: JsonValue }) | DesktopGoalJobConfig;
type IdMethods = Extract<DesktopMethod, 'receipts.get' | 'sources.delete' | 'memory.undo' | 'actions.execute' | 'actions.reconcile' | 'jobs.pause' | 'jobs.resume' | 'jobs.run' | 'members.revoke' | 'models.approve' | 'speech.approve' | 'plugins.disable' | 'plugins.remove' | 'plugins.run'>;
type DigestMethods = Extract<DesktopMethod, 'actions.approve' | 'jobs.approve' | 'plugins.enable'>;
type RequiredPayloads = { [M in IdMethods]: JsonObject & { id: string } } & { [M in DigestMethods]: JsonObject & { id: string; digest: string } } & {
  'workspace.create': JsonObject & { name: string; passphrase: string; folder?: string; demo?: boolean; pack?: string };
  'workspace.open': JsonObject & { passphrase: string; folder?: string };
  'workspace.recover': JsonObject & { recoveryCode: string; passphrase: string; folder?: string };
  'workspace.restore': JsonObject & { backupFile: string; passphrase: string; folder?: string };
  'workspace.delete': JsonObject & { confirmation: string };
  'conversation.ask': ModelRequest;
  'models.preview': ModelRequest;
  'conversation.get': { id: string };
  'conversation.continuation': { id: string };
  'conversation.synthesis.preview': { id: string; routeId?: string };
  'conversation.synthesis.run': { id: string; previewId: string; approvalId: string };
  'business.context.receipt': { id: string };
  'business.profile.record': BusinessProfileInput;
  'business.profile.remove': { id: string };
  'analysis.bridge.publish': { id: string; expectedRevision: number; definition: BridgeProfileDefinition };
  'analysis.bridge.run': BridgeRunRequest;
  'analysis.bridge.get': { id: string };
  'investigations.create': InvestigationCreate;
  'investigations.get': { id: string };
  'investigations.capsule': { id: string };
  'investigations.advance': { id: string; expectedRevision: number };
  'investigations.resume': { id: string; expectedRevision: number };
  'investigations.cancel': { id: string; expectedRevision: number };
  'investigations.pause': { id: string; expectedRevision: number; reason: string };
  'investigations.revise': InvestigationRevisionInput & { id: string };
  'investigations.drilldown': { id: string; receiptId: string; offset: number; limit: number };
  'research.search': InvestigationSearchRequest;
  'actions.revise': JsonObject & { id: string; payload: JsonObject };
  'jobs.create': DesktopJobConfig;
  'jobs.amend': { id: string; config: DesktopGoalJobConfig };
  'jobs.cancel': { id: string };
  'jobs.reconcile': { id: string };
  'jobs.progress': { id: string };
  'jobs.accept': { id: string; repeat?: boolean };
  'jobs.calendar.preview': { id: string };
  'jobs.calendar.pause': { id: string };
  'jobs.calendar.resume': { id: string };
  'jobs.calendar.configure': { id: string; definition: CalendarDefinition; expectedScheduleRevision: number; expectedObjectiveRevision: number; replacement: 'replace-immediately' };
  'jobs.reject': JsonObject & { id: string; reason: string };
  'connectors.read': { profileId: string };
  'connectors.reviewMapping': { profileId: string; recipe: MappingRecipe; evidence: MappingReview['evidence'] };
  'connectors.capture': { acquisitionId: string; reviewId: string; recipe: MappingRecipe; idempotencyKey: string };
  'connectors.publish': { profileId: string; captureId: string; sourceTotals: IndependentSourceTotals };
  'connectors.ready': { profileId: string };
  'connectors.captureStatus': { profileId: string; captureId: string };
  'connectors.releaseRead': { acquisitionId: string };
  'decisions.journal.draft': { content: JournalContent };
  'decisions.journal.confirm': { draft: JournalDraft; reviewedDigest: string };
  'decisions.journal.revise': { id: string; content: JournalContent; expectedRevision: number; reason: string };
  'decisions.journal.review': { id: string; review: JournalDecisionReview; expectedRevision: number };
  'updates.verify': JsonObject & { manifest: JsonObject | string; signature: string };
  'updates.stage': JsonObject & { manifest: JsonObject | string; signature: string; confirmed: true };
};
type OptionalPayloads = { 'conversation.history': { limit?: number; cursor?: string }; 'jobs.types': Record<string, never>; 'connectors.profiles': Record<string, never>; 'sources.groups': Record<string, never>; 'analysis.bridge.profiles': Record<string, never>; 'investigations.list': Record<string, never>; 'decisions.journal.due': { dueOn?: string; branch?: string }; 'business.profile.history': { field?: BusinessProfileInput['field'] } };
export type DesktopPayload<M extends DesktopMethod> = M extends keyof RequiredPayloads ? RequiredPayloads[M] : M extends keyof OptionalPayloads ? OptionalPayloads[M] : JsonObject;
export type EngineStatus = Readonly<{ healthy: boolean; state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' }>;
export type DesktopResult<M extends DesktopMethod> =
  M extends 'conversation.history' ? ReturnType<ConversationHistoryService['list']> : M extends 'conversation.get' ? ReturnType<ConversationHistoryService['get']> :
  M extends 'conversation.continuation' ? import('../../platform/runtime/engine.ts').ConversationContinuation :
  M extends 'conversation.synthesis.preview' ? DesktopConversationSynthesisPreview : M extends 'conversation.synthesis.run' ? DesktopConversationSynthesisResult :
  M extends 'analysis.bridge.publish' ? BridgeProfileRecord : M extends 'analysis.bridge.profiles' ? BridgeProfileRecord[] :
  M extends 'analysis.bridge.run' | 'analysis.bridge.get' ? BridgeRecord :
  M extends 'investigations.list' ? Investigation[] : M extends 'investigations.capsule' ? InvestigationCapsule :
  M extends 'investigations.drilldown' ? InvestigationDrilldown : M extends 'investigations.create' | 'investigations.get' | 'investigations.advance' | 'investigations.resume' | 'investigations.cancel' | 'investigations.pause' | 'investigations.revise' ? Investigation :
  M extends 'research.search' ? Awaited<ReturnType<ResearchSearchService['search']>> :
  M extends 'workspace.status' ? { open: boolean; experimental: boolean; version: string; storage: string; workspace?: JsonObject } : M extends 'decisions.journal.draft' ? JournalDraft : M extends 'decisions.journal.confirm' | 'decisions.journal.revise' | 'decisions.journal.review' ? JournalDecision : M extends 'decisions.journal.due' ? Array<JournalDecision | JsonObject> : unknown;
export interface DesktopBridge {
  request<M extends DesktopMethod>(method: M, ...args: M extends keyof RequiredPayloads ? [payload: DesktopPayload<M>] : [payload?: DesktopPayload<M>]): Promise<DesktopResult<M>>;
  onEngineStatus(callback: (status: EngineStatus) => void): () => void;
}
declare global { interface Window { chausar?: Readonly<DesktopBridge>; } }
