import { check, newId, now } from './contracts.ts';
import type { Context } from './contracts.ts';
import { canonical, digest } from './actions.ts';
import { assertLessonEvidenceSnapshot } from './lesson-evidence.ts';
import type {
  LessonActor, LessonApplicableContext, LessonCandidate, LessonDecision, LessonEvaluationBinding,
  LessonEvaluationReference, LessonEvaluationResult, LessonEvent, LessonGuidance, LessonPin,
  LessonProposal, LessonRecord, LessonReview, LessonServiceOptions, LessonState, LessonStore,
  LessonTarget, LessonView,
} from './lesson-contracts.ts';

const actor = (context: Context): LessonActor => ({ memberId: context.memberId, role: context.role, epoch: context.epoch });
const immutableContext = (context: Context): Context => Object.freeze(structuredClone(context));
const pin = (candidate: LessonCandidate): LessonPin => ({ id: candidate.id, revision: candidate.revision, digest: candidate.digest });
function unsealed<T extends { digest: string }>(value: T) { const { digest: _digest, ...body } = value; return body; }
function sealed<T extends object>(value: T): T & { digest: string } { return { ...value, digest: digest(value) }; }
function intact(value: { digest: string }, code = 'LESSON_CHANGED') {
  check(value.digest === digest(unsealed(value)), code, 'The immutable lesson record changed.');
}
function same(left: unknown, right: unknown) { return canonical(left) === canonical(right); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length && same(value, [...value].sort());
}
function fields(value: unknown, required: string[], optional: string[] = []) {
  canonical(value);
  check(!!value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => [...required, ...optional].includes(key)), 'INVALID_LESSON', 'Use the declared lesson contract fields.');
}
function conditions(value: unknown) {
  check(!!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, val]) => text(key) && text(val) && !['__proto__', 'prototype', 'constructor'].includes(key)),
  'INVALID_APPLICABILITY', 'Supply explicit applicability conditions.');
}
function matches(expected: Record<string, string>, actual: Record<string, string>) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}
function compatible(left: Record<string, string>, right: Record<string, string>) {
  return Object.keys(left).every(key => !Object.hasOwn(right, key) || left[key] === right[key]);
}
function targetIntact(target: LessonTarget) {
  fields(target, ['kind', 'id', 'revision', 'digest', 'owner', 'value']);
  check(text(target.id) && text(target.revision), 'INVALID_LESSON_TARGET', 'Targets need immutable revisions.');
  intact(target, 'LESSON_TARGET_CHANGED');
}
/** Evaluation digests cover every field except reference.digest, avoiding a circular hash. */
export function lessonEvaluationDigest(result: LessonEvaluationResult): string {
  const { digest: _digest, ...reference } = result.reference;
  return digest({ ...result, reference });
}
function evaluationValid(result: LessonEvaluationResult, reference: LessonEvaluationReference, candidate: LessonPin, set: 'open' | 'hidden') {
  fields(reference, ['id', 'revision', 'digest']);
  check(text(reference.id) && text(reference.revision) && /^[a-f0-9]{64}$/.test(reference.digest), 'EVALUATION_PROVENANCE_REQUIRED', 'Resolve an exact evaluation revision.');
  fields(result, ['reference', 'set', 'candidate', 'authorityId', 'qualification', 'suite', 'harness', 'build', 'configuration',
    'comparisonId', 'completedAt', 'status', 'baseline', 'treatment', 'metrics', 'sourceTainted', 'sourceIds']);
  check(same(result.reference, reference) && result.reference.digest === lessonEvaluationDigest(result), 'EVALUATION_CHANGED', 'The evaluation revision changed.');
  check(result.set === set && same(result.candidate, candidate) && result.treatment.guidance === 'on' && same(result.treatment.candidate, candidate) &&
    result.baseline.guidance === 'off', 'EVALUATION_CANDIDATE_MISMATCH', 'Both evaluations must compare this exact enabled candidate against guidance off.');
  check(text(result.authorityId) && text(result.comparisonId) && ['synthetic-protocol', 'owner-qualified'].includes(result.qualification),
    'EVALUATION_PROVENANCE_REQUIRED', 'The evaluation must identify its authority and qualification.');
  for (const artifact of [result.suite, result.harness, result.build, result.configuration]) {
    fields(artifact, ['id', 'revision', 'digest']);
    check(text(artifact.id) && text(artifact.revision) && /^[a-f0-9]{64}$/.test(artifact.digest), 'EVALUATION_PROVENANCE_REQUIRED', 'Pin the suite, harness, build and configuration.');
  }
  check(/^[a-f0-9]{64}$/.test(result.baseline.digest) && Number.isFinite(Date.parse(result.completedAt)), 'EVALUATION_PROVENANCE_REQUIRED', 'Pin the baseline and completed run time.');
  check(['complete', 'incomplete', 'declined'].includes(result.status) && result.sourceTainted === false && strings(result.sourceIds),
    'INVALID_LESSON_EVALUATION', 'Evaluation summaries need explicit clean source provenance.');
  check(Array.isArray(result.metrics) && (result.status !== 'complete' || result.metrics.length > 0) &&
    new Set(result.metrics.map(metric => metric.name)).size === result.metrics.length && result.metrics.every(metric =>
      text(metric.name) && ['higher-is-better', 'lower-is-better'].includes(metric.direction) && Number.isFinite(metric.before) && Number.isFinite(metric.after)),
  'INVALID_LESSON_EVALUATION', 'Supply paired finite metrics with authority-selected directions.');
}
function passes(binding: LessonEvaluationBinding) {
  return [binding.open, binding.hidden].every(result => result.status === 'complete' && result.metrics.length > 0 &&
    result.metrics.every(metric => metric.direction === 'higher-is-better' ? metric.after >= metric.before : metric.after <= metric.before));
}

/** An isolated protocol. All business evidence, target schemas and evaluation authorities are supplied by its owner. */
export class LessonService {
  private readonly store: LessonStore;
  private readonly options: LessonServiceOptions;
  constructor(store: LessonStore, options: LessonServiceOptions) {
    check(!!options?.evidence && !!options?.targets, 'LESSON_AUTHORITIES_REQUIRED', 'Supply current evidence and personal-target authorities.');
    this.store = store; this.options = options;
  }
  private authorize(context: Context, permission: 'read' | 'prepare' | 'approve' = 'read') {
    this.options.evidence.authorize(context, permission);
    this.workspace(this.store.read().workspaceId);
    check(!context.sourceTainted, 'TAINTED_LESSON', 'Tainted requests cannot supply reusable instructions.');
  }
  private workspace(workspaceId: string) {
    check(text(workspaceId) && workspaceId === this.options.evidence.workspaceId(), 'LESSON_WORKSPACE_CHANGED', 'Lesson storage belongs to its exact current workspace.');
  }
  private basis() {
    const basis = { workspaceId: this.options.evidence.workspaceId(), evidence: this.options.evidence.authorityRevision(),
      targets: this.options.targets.authorityRevision(), evaluations: this.options.evaluations?.authorityRevision() ?? null };
    check(text(basis.workspaceId) && text(basis.evidence) && text(basis.targets) && (basis.evaluations === null || text(basis.evaluations)),
      'LESSON_AUTHORITY_REVISION_REQUIRED', 'Every installed authority must expose its current revision.');
    return basis;
  }
  private unchanged(basis: ReturnType<LessonService['basis']>) {
    check(same(basis, this.basis()), 'LESSON_AUTHORITY_CHANGED', 'Authority changed during this operation; resolve current evidence again.');
  }
  private find(state: LessonState, id: string) {
    this.workspace(state.workspaceId);
    const record = state.lessons.find(item => item.id === id);
    check(record, 'LESSON_NOT_FOUND', 'This lesson is unavailable under current authority.');
    this.integrity(record); return record;
  }
  private integrity(record: LessonRecord) {
    check(record.revisions.length > 0 && record.events.length > 0, 'LESSON_CHANGED', 'The lesson history is incomplete.');
    record.revisions.forEach((candidate, index) => {
      intact(candidate); check(candidate.id === record.id && candidate.revision === index + 1 && candidate.kind === 'candidate-lesson', 'LESSON_CHANGED', 'The candidate revision sequence changed.');
    });
    let previousDigest = '';
    for (const event of record.events) {
      intact(event); const candidate = record.revisions[event.candidate.revision - 1];
      check(event.previousDigest === previousDigest && !!candidate && same(event.candidate, pin(candidate)), 'LESSON_CHANGED', 'The lifecycle binding changed.');
      if (event.binding) { intact(event.binding); check(same(event.binding.candidate, event.candidate), 'LESSON_CHANGED', 'The evaluation binding changed.'); }
      if (event.review) { intact(event.review); check(same(event.review.candidate, event.candidate), 'LESSON_CHANGED', 'The review binding changed.'); }
      previousDigest = event.digest;
    }
  }
  private candidate(record: LessonRecord, expected?: LessonPin) {
    const candidate = record.revisions.at(-1)!;
    if (expected) check(same(expected, pin(candidate)), 'LESSON_CHANGED', 'Review the current immutable candidate revision.');
    return candidate;
  }
  private owner(context: Context, candidate: LessonCandidate) {
    check(same(actor(context), candidate.owner), 'LESSON_OWNER_REQUIRED', 'Personal guidance belongs to its pinned owner and permission epoch.');
  }
  private evidenceCurrent(context: Context, candidate: LessonCandidate) {
    const current = this.options.evidence.assertCurrent(context, candidate.evidence.map(item => item.pin));
    check(current.length === candidate.evidence.length, 'LESSON_EVIDENCE_CHANGED', 'The evidence coverage changed.');
    assertLessonEvidenceSnapshot(current, candidate.evidence);
  }
  private targetCurrent(context: Context, candidate: LessonCandidate) {
    const target = this.options.targets.resolve(context, { kind: candidate.change.kind, id: candidate.change.targetId });
    targetIntact(target);
    check(same(target, candidate.target), 'LESSON_TARGET_CHANGED', 'The configured personal target changed.');
    this.options.targets.validateChange(context, structuredClone(target), structuredClone(candidate.change.after));
  }
  private access(context: Context, candidate: LessonCandidate) {
    this.authorize(context); this.workspace(candidate.workspaceId); this.owner(context, candidate); this.evidenceCurrent(context, candidate);
  }
  private release(context: Context, view: LessonView) {
    const basis = this.basis(); this.access(context, view.candidate); this.targetCurrent(context, view.candidate);
    if (view.evaluation) this.bindingCurrent(context, view.candidate, view.evaluation, false);
    this.access(context, view.candidate); this.unchanged(basis); return view;
  }
  private predecessorCurrent(context: Context, state: LessonState, candidate: LessonCandidate) {
    if (!candidate.supersedes) return;
    const record = this.find(state, candidate.supersedes.id); const previous = this.candidate(record, candidate.supersedes);
    const view = this.view(record);
    check(view.status === 'approved' && view.evaluation && same(previous.applicability, candidate.applicability) &&
      same(previous.target, candidate.target) && previous.change.kind === candidate.change.kind && previous.change.targetId === candidate.change.targetId &&
      same(previous.change.after, candidate.change.before), 'INVALID_SUPERSESSION', 'The exact approved predecessor must still supply the reviewed before value.');
    this.release(context, view); this.bindingCurrent(context, previous, view.evaluation);
  }
  private append(record: LessonRecord, context: Context, type: LessonEvent['type'], data: Partial<Pick<LessonEvent, 'binding' | 'review' | 'reason' | 'successor'>> = {}) {
    record.events.push(sealed({ id: newId('lesson_event'), candidate: pin(this.candidate(record)), at: now(), actor: actor(context),
      previousDigest: record.events.at(-1)?.digest ?? '', type, ...structuredClone(data) }));
  }
  private view(record: LessonRecord): LessonView {
    const candidate = this.candidate(record);
    const events = record.events.filter(event => event.candidate.revision === candidate.revision);
    const evaluationIndex = events.findLastIndex(event => event.type === 'evaluation');
    const evaluation = events[evaluationIndex]?.binding;
    const review = events.slice(evaluationIndex + 1).findLast(event => event.type === 'review')?.review;
    const last = events.at(-1)!;
    let status: LessonView['status'] = 'proposed';
    if (evaluation) status = passes(evaluation) ? 'review-ready' : 'evaluation-blocked';
    const statuses = { approve: 'approved', reject: 'rejected', defer: 'deferred', retire: 'retired', supersede: 'superseded' } as const;
    if (last.type in statuses) status = statuses[last.type as keyof typeof statuses];
    return structuredClone({ candidate, status, ...(evaluation ? { evaluation } : {}), ...(review ? { review } : {}) });
  }
  private proposal(context: Context, state: LessonState, input: LessonProposal, id: string, revision: number): LessonCandidate {
    this.workspace(state.workspaceId);
    fields(input, ['title', 'rationale', 'evidence', 'change', 'applicability', 'counterexamples'], ['supersedes']);
    check(text(input.title) && text(input.rationale), 'INVALID_LESSON', 'Explain the lesson and its evidence.');
    fields(input.change, ['kind', 'targetId', 'before', 'after']);
    check(['personal-preference', 'reminder-timing', 'shortlist-order'].includes(input.change.kind) && text(input.change.targetId),
      'PROTECTED_LESSON_TARGET', 'Lessons may propose only configured personal guidance targets.');
    check(!same(input.change.before, input.change.after), 'EMPTY_LESSON_CHANGE', 'Show the exact before and after change.');
    const target = structuredClone(this.options.targets.resolve(context, { kind: input.change.kind, id: input.change.targetId }));
    targetIntact(target);
    check(target.kind === input.change.kind && target.id === input.change.targetId && same(target.owner, actor(context)), 'LESSON_OWNER_REQUIRED', 'The target must belong to the current personal owner.');
    this.options.targets.validateChange(context, structuredClone(target), structuredClone(input.change.after));
    const evidence = this.options.evidence.capture(context, structuredClone(input.evidence));
    const sourceIds = [...new Set(evidence.flatMap(item => item.pin.sourceIds))].sort();
    const branchIds = [...new Set(evidence.flatMap(item => item.pin.branchIds))];
    fields(input.applicability, ['memberId', 'branchIds', 'sourceIds', 'conditions']);
    check(input.applicability.memberId === context.memberId && strings(input.applicability.branchIds) && strings(input.applicability.sourceIds) &&
      same(input.applicability.sourceIds, sourceIds) && input.applicability.branchIds.every(branch => branch !== '*' && branchIds.includes(branch)),
    'INVALID_APPLICABILITY', 'Personal applicability must stay within its exact evidence sources and named branches.');
    conditions(input.applicability.conditions);
    check(Array.isArray(input.counterexamples) && input.counterexamples.length > 0, 'COUNTEREXAMPLES_REQUIRED', 'Declare scoped counterexamples.');
    for (const counterexample of input.counterexamples) { fields(counterexample, ['conditions', 'reason']); conditions(counterexample.conditions); check(text(counterexample.reason), 'COUNTEREXAMPLES_REQUIRED', 'Explain each counterexample.'); }
    let before = target.value;
    if (input.supersedes) {
      const previous = this.find(state, input.supersedes.id); const old = this.candidate(previous, input.supersedes); this.access(context, old);
      check(this.view(previous).status === 'approved' && old.change.kind === input.change.kind && old.change.targetId === input.change.targetId &&
        same(old.applicability, input.applicability) && same(old.target, target), 'INVALID_SUPERSESSION', 'Replace an exact approved personal scope without broadening it.');
      const view = this.release(context, this.view(previous));
      check(view.evaluation, 'INVALID_SUPERSESSION', 'An approved predecessor must retain its evaluation authority.');
      this.bindingCurrent(context, old, view.evaluation);
      before = old.change.after;
    }
    check(same(input.change.before, before), 'LESSON_BEFORE_CHANGED', 'The before value must match the current configured target or approved predecessor.');
    const proposedAt = now(); const episodeIds: string[] = [];
    for (const item of evidence) {
      const episode = sealed({ kind: 'episode' as const, id: newId('lesson_episode'), evidence: structuredClone(item), recordedBy: actor(context), recordedAt: proposedAt });
      state.episodes.push(episode); episodeIds.push(episode.id);
    }
    return sealed({ ...structuredClone(input), kind: 'candidate-lesson' as const, workspaceId: state.workspaceId, id, revision, owner: actor(context), proposedBy: actor(context), proposedAt, episodeIds,
      evidence: structuredClone(evidence), target });
  }
  async propose(context: Context, input: LessonProposal): Promise<LessonView> {
    context = immutableContext(context);
    const request = structuredClone(input);
    const result = await this.store.update(state => {
      const basis = this.basis(); this.authorize(context, 'prepare'); const id = newId('lesson');
      const candidate = this.proposal(context, state, request, id, 1);
      const record: LessonRecord = { id, revisions: [candidate], events: [] };
      this.append(record, context, 'proposal'); state.lessons.push(record);
      const view = this.release(context, this.view(record)); this.unchanged(basis); return view;
    });
    return this.release(context, result);
  }
  async revise(context: Context, expected: LessonPin, input: LessonProposal): Promise<LessonView> {
    context = immutableContext(context);
    const request = structuredClone(input); const expectedPin = structuredClone(expected);
    const result = await this.store.update(state => {
      const basis = this.basis(); this.authorize(context, 'prepare'); const record = this.find(state, expectedPin.id); const old = this.candidate(record, expectedPin); this.access(context, old);
      check(['proposed', 'review-ready', 'evaluation-blocked', 'deferred'].includes(this.view(record).status), 'INVALID_LESSON_STATE', 'Terminal guidance must be replaced by a fresh candidate.');
      record.revisions.push(this.proposal(context, state, request, record.id, old.revision + 1));
      this.append(record, context, 'revision'); const view = this.release(context, this.view(record)); this.unchanged(basis); return view;
    });
    return this.release(context, result);
  }
  private evaluations(context: Context, candidate: LessonCandidate, references: { open: LessonEvaluationReference; hidden: LessonEvaluationReference }): LessonEvaluationBinding {
    const authority = this.options.evaluations;
    check(authority, 'EVALUATION_AUTHORITY_REQUIRED', 'Configure the open and hidden evaluation authorities before review.');
    fields(references, ['open', 'hidden']);
    const open = structuredClone(authority.resolve(context, structuredClone(references.open)));
    const hidden = structuredClone(authority.resolve(context, structuredClone(references.hidden)));
    evaluationValid(open, references.open, pin(candidate), 'open'); evaluationValid(hidden, references.hidden, pin(candidate), 'hidden');
    authority.assertSourceAccess(context, [...new Set([...open.sourceIds, ...hidden.sourceIds])].sort());
    check(open.comparisonId === hidden.comparisonId && open.baseline.digest === hidden.baseline.digest && same(open.build, hidden.build) &&
      same(open.configuration, hidden.configuration) && open.qualification === hidden.qualification,
    'EVALUATION_COMPARISON_MISMATCH', 'Open and hidden runs must belong to the same pinned comparison, build and configuration.');
    return sealed({ candidate: pin(candidate), open, hidden });
  }
  private bindingCurrent(context: Context, candidate: LessonCandidate, binding: LessonEvaluationBinding, requirePass = true) {
    intact(binding, 'EVALUATION_CHANGED');
    const current = this.evaluations(context, candidate, { open: binding.open.reference, hidden: binding.hidden.reference });
    check(same(current, binding), 'EVALUATION_CHANGED', 'The bound evaluation provenance changed.');
    if (requirePass) check(passes(binding), 'LESSON_EVALUATION_BLOCKED', 'Missing, incomplete, declined or regressing results block human review and promotion.');
  }
  async bindEvaluations(context: Context, expected: LessonPin, references: { open: LessonEvaluationReference; hidden: LessonEvaluationReference }): Promise<LessonView> {
    context = immutableContext(context);
    const expectedPin = structuredClone(expected); const refs = structuredClone(references);
    const result = await this.store.update(state => {
      const basis = this.basis(); this.authorize(context, 'prepare'); const record = this.find(state, expectedPin.id); const candidate = this.candidate(record, expectedPin); this.access(context, candidate); this.targetCurrent(context, candidate);
      this.predecessorCurrent(context, state, candidate);
      check(['proposed', 'deferred'].includes(this.view(record).status), 'INVALID_LESSON_STATE', 'Evaluation binds once to a candidate revision; revise a blocked candidate.');
      const binding = this.evaluations(context, candidate, refs); this.access(context, candidate); this.targetCurrent(context, candidate);
      this.append(record, context, 'evaluation', { binding }); const view = this.release(context, this.view(record)); this.unchanged(basis); return view;
    });
    return this.release(context, result);
  }
  private human(context: Context) {
    this.authorize(context, 'approve');
    check(context.channel === 'desktop', 'APP_LESSON_REVIEW_REQUIRED', 'Review the exact lesson in the untainted app.');
  }
  async review(context: Context, expected: LessonPin): Promise<LessonView> {
    context = immutableContext(context);
    const expectedPin = structuredClone(expected);
    const result = await this.store.update(state => {
      const basis = this.basis(); this.human(context); const record = this.find(state, expectedPin.id); const candidate = this.candidate(record, expectedPin); this.access(context, candidate); this.targetCurrent(context, candidate);
      this.predecessorCurrent(context, state, candidate);
      const view = this.view(record);
      check(view.status === 'review-ready' && view.evaluation, 'LESSON_EVALUATION_BLOCKED', 'Bind passing open and hidden results before human review.');
      this.bindingCurrent(context, candidate, view.evaluation);
      this.access(context, candidate); this.targetCurrent(context, candidate);
      const review: LessonReview = sealed({ id: newId('lesson_review'), candidate: pin(candidate), evaluationDigest: view.evaluation.digest, reviewer: actor(context), at: now() });
      this.append(record, context, 'review', { review }); const result = this.release(context, this.view(record)); this.unchanged(basis); return result;
    });
    return this.release(context, result);
  }
  private overlap(left: LessonCandidate, right: LessonCandidate) {
    return left.owner.memberId === right.owner.memberId && left.change.kind === right.change.kind && left.change.targetId === right.change.targetId &&
      left.applicability.branchIds.some(branch => right.applicability.branchIds.includes(branch)) &&
      same(left.applicability.sourceIds, right.applicability.sourceIds) &&
      compatible(left.applicability.conditions, right.applicability.conditions);
  }
  async decideLesson(context: Context, input: LessonDecision): Promise<LessonView> {
    context = immutableContext(context);
    const request = structuredClone(input);
    fields(request, ['candidate', 'reviewId', 'reviewDigest', 'decision', 'reason']);
    check(['approve', 'reject', 'defer'].includes(request.decision) && text(request.reason), 'INVALID_LESSON_DECISION', 'Supply a human decision and its reason.');
    const result = await this.store.update(state => {
      const basis = this.basis(); this.human(context); const record = this.find(state, request.candidate.id); const candidate = this.candidate(record, request.candidate); this.access(context, candidate); this.targetCurrent(context, candidate);
      this.predecessorCurrent(context, state, candidate);
      const view = this.view(record); const review = view.review;
      check(view.status === 'review-ready' && review && view.evaluation && review.id === request.reviewId && review.digest === request.reviewDigest &&
        same(review.candidate, request.candidate) && review.evaluationDigest === view.evaluation.digest && same(review.reviewer, actor(context)),
      'LESSON_REVIEW_CHANGED', 'The decision must bind the current evaluation-bound human review.');
      this.bindingCurrent(context, candidate, view.evaluation);
      if (request.decision === 'approve') {
        for (const other of state.lessons) {
          if (other.id === record.id) continue;
          this.integrity(other); const previous = this.candidate(other);
          if (this.view(other).status !== 'approved' || !this.overlap(candidate, previous)) continue;
          check(!!candidate.supersedes && same(candidate.supersedes, pin(previous)), 'LESSON_CONFLICT', 'Explicitly supersede overlapping personal guidance; no implicit ranking is allowed.');
        }
        if (candidate.supersedes) {
          const previous = this.find(state, candidate.supersedes.id); this.candidate(previous, candidate.supersedes);
          check(this.view(previous).status === 'approved', 'INVALID_SUPERSESSION', 'The approved predecessor changed before promotion.');
          this.append(previous, context, 'supersede', { successor: pin(candidate), reason: request.reason });
        }
      }
      this.access(context, candidate); this.targetCurrent(context, candidate);
      this.append(record, context, request.decision, { reason: request.reason });
      const result = this.release(context, this.view(record)); this.unchanged(basis); return result;
    });
    return this.release(context, result);
  }
  async retire(context: Context, expected: LessonPin, reason: string): Promise<LessonView> {
    context = immutableContext(context);
    check(text(reason), 'INVALID_LESSON_DECISION', 'Record why this guidance is retired.'); const expectedPin = structuredClone(expected);
    const result = await this.store.update(state => {
      const basis = this.basis(); this.human(context); const record = this.find(state, expectedPin.id); const candidate = this.candidate(record, expectedPin); this.access(context, candidate);
      check(this.view(record).status === 'approved', 'INVALID_LESSON_STATE', 'Only current approved guidance can be retired.');
      this.append(record, context, 'retire', { reason }); const result = this.release(context, this.view(record)); this.unchanged(basis); return result;
    });
    return this.release(context, result);
  }
  /** Narrow planned memory.lessons adapter; terminal records are available through permitted history. */
  lessons(context: Context): LessonView[] {
    context = immutableContext(context);
    const basis = this.basis(); this.authorize(context); const result: LessonView[] = [];
    for (const record of this.store.read().lessons) {
      try { this.integrity(record); const candidate = this.candidate(record); this.access(context, candidate); const view = this.view(record);
        if (!['rejected', 'retired', 'superseded'].includes(view.status)) result.push(this.release(context, view));
      } catch { /* Fail closed without revealing unavailable personal evidence. */ }
    }
    this.authorize(context); this.unchanged(basis); return result;
  }
  history(context: Context, id: string): LessonRecord {
    context = immutableContext(context);
    const basis = this.basis(); this.authorize(context); const record = this.find(this.store.read(), id);
    for (const candidate of record.revisions) { this.access(context, candidate); this.targetCurrent(context, candidate); }
    for (const event of record.events) if (event.binding) this.bindingCurrent(context, record.revisions[event.candidate.revision - 1], event.binding, false);
    this.authorize(context); this.unchanged(basis);
    return structuredClone(record);
  }
  private guidance(context: Context, record: LessonRecord, scope: LessonApplicableContext): LessonGuidance | undefined {
    this.integrity(record); const candidate = this.candidate(record); this.access(context, candidate);
    const view = this.view(record);
    if (view.status !== 'approved') return;
    this.targetCurrent(context, candidate); check(view.evaluation, 'LESSON_EVALUATION_BLOCKED', 'Approved guidance requires bound evaluations.');
    this.bindingCurrent(context, candidate, view.evaluation);
    check(view.review && same(view.review.reviewer, actor(context)), 'LESSON_REVIEW_CHANGED', 'The approval owner changed.');
    const applicability = candidate.applicability;
    if (!applicability.branchIds.includes(scope.branchId) || !same(applicability.sourceIds, scope.sourceIds) || !matches(applicability.conditions, scope.conditions) ||
      candidate.counterexamples.some(counterexample => matches(counterexample.conditions, scope.conditions))) return;
    return structuredClone({ kind: 'personal-preference' as const, lesson: pin(candidate),
      change: { kind: candidate.change.kind, targetId: candidate.change.targetId, after: candidate.change.after }, applicability,
      counterexamples: candidate.counterexamples, evaluation: view.evaluation });
  }
  private context(scope: LessonApplicableContext) {
    fields(scope, ['branchId', 'sourceIds', 'conditions']);
    check(text(scope.branchId) && scope.branchId !== '*' && strings(scope.sourceIds), 'INVALID_APPLICABILITY', 'Supply the complete named source and branch scope.');
    conditions(scope.conditions);
  }
  applicable(context: Context, scope: LessonApplicableContext): LessonGuidance[] {
    context = immutableContext(context); scope = structuredClone(scope);
    const basis = this.basis(); this.authorize(context); this.context(scope); const result: LessonGuidance[] = [];
    for (const record of this.store.read().lessons) {
      try { const guidance = this.guidance(context, record, scope); if (guidance) result.push(guidance); }
      catch { /* Unavailable, stale and invalid guidance never becomes an instruction. */ }
    }
    this.authorize(context); this.unchanged(basis); return result;
  }
  /** Old summaries may contain only references: re-resolve them here, never inject their old prose. */
  resolveGuidance(context: Context, references: LessonPin[], scope: LessonApplicableContext): LessonGuidance[] {
    context = immutableContext(context); references = structuredClone(references); scope = structuredClone(scope);
    const basis = this.basis(); this.authorize(context); this.context(scope);
    check(Array.isArray(references) && new Set(references.map(reference => reference.id)).size === references.length, 'INVALID_LESSON_REFERENCES', 'Resolve distinct immutable lesson references.');
    const state = this.store.read(); const result: LessonGuidance[] = [];
    for (const reference of references) {
      const record = this.find(state, reference.id); this.candidate(record, reference);
      const guidance = this.guidance(context, record, scope);
      check(guidance, 'LESSON_NOT_APPLICABLE', 'This historical guidance is no longer a current applicable instruction.'); result.push(guidance);
    }
    this.authorize(context); this.unchanged(basis); return result;
  }
}
