import type { Context, State } from './contracts.ts';

/** Lesson storage has no business-state or ontology write capability. */
export type LessonValue = null | boolean | number | string | LessonValue[] | { [key: string]: LessonValue };
export type LessonActor = Pick<Context, 'memberId' | 'role' | 'epoch'>;
export type LessonPin = { id: string; revision: number; digest: string };
export type LessonEvidenceReference = { kind: 'job' | 'calculation'; id: string };
export type LessonEvidencePin = LessonEvidenceReference & { revision: string; digest: string; sourceIds: string[]; branchIds: string[] };
export type LessonResolvedEvidence = {
  pin: LessonEvidencePin; available: boolean; sourceTainted: boolean;
  sourceMarkings: { sourceId: string; marking: string }[]; summary: string;
};
/** A resolver must retain the original job/receipt authority, not just its source IDs. */
export type LessonEvidenceResolver = (state: State, context: Context, reference: LessonEvidenceReference) => LessonResolvedEvidence;
export interface LessonEvidenceAuthority {
  workspaceId(): string;
  /** Changes whenever any membership, source, evidence or workspace authority changes. */
  authorityRevision(): string;
  authorize(context: Context, permission: 'read' | 'prepare' | 'approve'): void;
  capture(context: Context, references: LessonEvidenceReference[]): LessonResolvedEvidence[];
  assertCurrent(context: Context, pins: LessonEvidencePin[]): LessonResolvedEvidence[];
}
export type LessonEpisode = {
  kind: 'episode'; id: string; evidence: LessonResolvedEvidence; recordedBy: LessonActor; recordedAt: string; digest: string;
};
/** Only personal guidance is accepted here. Procedures and business rules use their own owner/specialist processes. */
export type LessonChangeKind = 'personal-preference' | 'reminder-timing' | 'shortlist-order';
export type LessonTarget = {
  kind: LessonChangeKind; id: string; revision: string; digest: string;
  owner: LessonActor; value: LessonValue;
};
export interface LessonTargetAuthority {
  /** Changes for target values, schemas or access decisions. Read-only and synchronous. */
  authorityRevision(): string;
  resolve(context: Context, target: { kind: LessonChangeKind; id: string }): LessonTarget;
  /** The integration owner supplies the target schema; this never executes the change. */
  validateChange(context: Context, target: LessonTarget, after: LessonValue): void;
}
export type LessonApplicability = {
  memberId: string; branchIds: string[]; sourceIds: string[]; conditions: Record<string, string>;
};
export type LessonCounterexample = { conditions: Record<string, string>; reason: string };
export type LessonProposal = {
  title: string; rationale: string; evidence: LessonEvidenceReference[];
  change: { kind: LessonChangeKind; targetId: string; before: LessonValue; after: LessonValue };
  applicability: LessonApplicability; counterexamples: LessonCounterexample[]; supersedes?: LessonPin;
};
export type LessonCandidate = Omit<LessonProposal, 'evidence'> & {
  kind: 'candidate-lesson'; workspaceId: string; id: string; revision: number; digest: string; owner: LessonActor;
  proposedBy: LessonActor; proposedAt: string; episodeIds: string[];
  evidence: LessonResolvedEvidence[]; target: LessonTarget;
};
export type LessonEvaluationReference = { id: string; revision: string; digest: string };
export type LessonArtifactPin = { id: string; revision: string; digest: string };
export type LessonEvaluationResult = {
  reference: LessonEvaluationReference; set: 'open' | 'hidden'; candidate: LessonPin;
  authorityId: string; qualification: 'synthetic-protocol' | 'owner-qualified';
  suite: LessonArtifactPin; harness: LessonArtifactPin; build: LessonArtifactPin; configuration: LessonArtifactPin;
  comparisonId: string; completedAt: string; status: 'complete' | 'incomplete' | 'declined';
  baseline: { guidance: 'off'; digest: string }; treatment: { guidance: 'on'; candidate: LessonPin };
  /** Bars/directions are supplied by the evaluation authority, never chosen by this service. */
  metrics: { name: string; direction: 'higher-is-better' | 'lower-is-better'; before: number; after: number }[];
  sourceTainted: boolean; sourceIds: string[];
};
export interface LessonEvaluationAuthority {
  /** Changes for runs, qualification, provenance or evaluation-access authority. */
  authorityRevision(): string;
  /** Resolve an already completed run from its current authority. No default evaluator exists. */
  resolve(context: Context, reference: LessonEvaluationReference): LessonEvaluationResult;
  assertSourceAccess(context: Context, sourceIds: string[]): void;
}
export type LessonEvaluationBinding = { candidate: LessonPin; open: LessonEvaluationResult; hidden: LessonEvaluationResult; digest: string };
export type LessonReview = {
  id: string; candidate: LessonPin; evaluationDigest: string; reviewer: LessonActor; at: string; digest: string;
};
export type LessonDecision = {
  candidate: LessonPin; reviewId: string; reviewDigest: string; decision: 'approve' | 'reject' | 'defer'; reason: string;
};
export type LessonEvent = {
  id: string; candidate: LessonPin; at: string; actor: LessonActor; previousDigest: string; digest: string;
  type: 'proposal' | 'revision' | 'evaluation' | 'review' | 'approve' | 'reject' | 'defer' | 'retire' | 'supersede';
  binding?: LessonEvaluationBinding; review?: LessonReview; reason?: string; successor?: LessonPin;
};
export type LessonRecord = { id: string; revisions: LessonCandidate[]; events: LessonEvent[] };
export type LessonState = { workspaceId: string; episodes: LessonEpisode[]; lessons: LessonRecord[] };
/** Implementations must serialize updates and atomically commit or roll back the whole callback. */
export interface LessonStore {
  read(): LessonState;
  update<T>(change: (state: LessonState) => T): Promise<T>;
}
export type LessonStatus = 'proposed' | 'evaluation-blocked' | 'review-ready' | 'approved' | 'rejected' | 'deferred' | 'retired' | 'superseded';
export type LessonView = { candidate: LessonCandidate; status: LessonStatus; evaluation?: LessonEvaluationBinding; review?: LessonReview };
export type LessonApplicableContext = { branchId: string; sourceIds: string[]; conditions: Record<string, string> };
export type LessonGuidance = {
  kind: 'personal-preference'; lesson: LessonPin; change: Pick<LessonCandidate['change'], 'kind' | 'targetId' | 'after'>;
  applicability: LessonApplicability; counterexamples: LessonCounterexample[]; evaluation: LessonEvaluationBinding;
};
export type LessonServiceOptions = {
  evidence: LessonEvidenceAuthority; targets: LessonTargetAuthority; evaluations?: LessonEvaluationAuthority;
};
