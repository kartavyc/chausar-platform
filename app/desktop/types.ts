import type { DesktopMethod } from './ipc-contract.cjs';
import type { JobConfig } from '../../platform/runtime/jobs.ts';
import type { CalendarDefinition } from '../../platform/runtime/calendar.ts';
import type { MappingRecipe } from '../../platform/runtime/ingest.ts';
import type { MappingReview, IndependentSourceTotals } from '../../platform/runtime/connector-framework/import.ts';
import type { JournalContent, JournalDecision, JournalDraft } from '../../platform/runtime/decision-journal.ts';
import type { JournalDecisionReview } from '../../platform/runtime/reports.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
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
  'conversation.ask': JsonObject & { question: string };
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
type OptionalPayloads = { 'jobs.types': Record<string, never>; 'connectors.profiles': Record<string, never>; 'sources.groups': Record<string, never>; 'decisions.journal.due': { dueOn?: string; branch?: string } };
export type DesktopPayload<M extends DesktopMethod> = M extends keyof RequiredPayloads ? RequiredPayloads[M] : M extends keyof OptionalPayloads ? OptionalPayloads[M] : JsonObject;
export type EngineStatus = Readonly<{ healthy: boolean; state: 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped' }>;
export type DesktopResult<M extends DesktopMethod> = M extends 'workspace.status' ? { open: boolean; experimental: boolean; version: string; storage: string; workspace?: JsonObject } : M extends 'decisions.journal.draft' ? JournalDraft : M extends 'decisions.journal.confirm' | 'decisions.journal.revise' | 'decisions.journal.review' ? JournalDecision : M extends 'decisions.journal.due' ? Array<JournalDecision | JsonObject> : unknown;
export interface DesktopBridge {
  request<M extends DesktopMethod>(method: M, ...args: M extends keyof RequiredPayloads ? [payload: DesktopPayload<M>] : [payload?: DesktopPayload<M>]): Promise<DesktopResult<M>>;
  onEngineStatus(callback: (status: EngineStatus) => void): () => void;
}
declare global { interface Window { chausar?: Readonly<DesktopBridge>; } }
