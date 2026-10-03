import { digest, sourceAccess } from '../../runtime/actions.ts';
import { check, initialState } from '../../runtime/contracts.ts';
import type { Context } from '../../runtime/contracts.ts';
import { createLessonEvidenceAuthority } from '../../runtime/lesson-evidence.ts';
import { LessonService } from '../../runtime/lessons.ts';
import type {
  LessonApplicableContext, LessonCandidate, LessonDecision, LessonEvaluationReference,
  LessonEvaluationResult, LessonPin, LessonProposal, LessonState, LessonStore,
  LessonTarget, LessonView,
} from '../../runtime/lesson-contracts.ts';

/** Protocol fixtures only: these runs do not certify a real open or hidden suite. */
export const SYNTHETIC_QUALIFICATION = 'synthetic-protocol' as const;
export const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const ACCOUNTANT: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
export const VIEWER: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
export const APPLICABLE: LessonApplicableContext = {
  branchId: 'main', sourceIds: ['source-job'], conditions: { task: 'weekly-overview' },
};

/** Each callback commits a detached draft only after successful completion. */
export class AtomicLessonStore implements LessonStore {
  state: LessonState = { workspaceId: 'workspace-synthetic-lessons', episodes: [], lessons: [] };
  private queue: Promise<unknown> = Promise.resolve();
  read(): LessonState { return structuredClone(this.state); }
  update<T>(change: (state: LessonState) => T): Promise<T> {
    const operation = this.queue.then(() => {
      const draft = structuredClone(this.state);
      const result = change(draft);
      this.state = draft;
      return structuredClone(result);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export const pin = (candidate: LessonCandidate): LessonPin => ({ id: candidate.id, revision: candidate.revision, digest: candidate.digest });
export function targetDigest(target: LessonTarget): string {
  const { digest: ignored, ...body } = target;
  return digest(body);
}
export function evaluationDigest(result: LessonEvaluationResult): string {
  return digest({ ...result, reference: { id: result.reference.id, revision: result.reference.revision } });
}
export function repinEvaluation(result: LessonEvaluationResult): LessonEvaluationResult {
  result.reference.digest = evaluationDigest(result);
  return result;
}
export function proposal(overrides: Partial<LessonProposal> = {}): LessonProposal {
  return {
    title: 'Lead weekly overviews with receipts',
    rationale: 'The owner explicitly selected receipt details in the recorded synthetic job.',
    evidence: [{ kind: 'job', id: 'job-synthetic-1' }],
    change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'overview-first', after: 'receipt-first' },
    applicability: { memberId: 'owner', sourceIds: ['source-job'], branchIds: ['main'], conditions: { task: 'weekly-overview' } },
    counterexamples: [{ conditions: { task: 'urgent-summary' }, reason: 'The explicit urgent-summary condition keeps the existing concise preference.' }],
    ...structuredClone(overrides),
  };
}
export function decision(view: LessonView, choice: LessonDecision['decision'] = 'approve'): LessonDecision {
  if (!view.review) throw new Error('The fixture requires an actual service review token.');
  return {
    candidate: pin(view.candidate), reviewId: view.review.id, reviewDigest: view.review.digest,
    decision: choice, reason: 'The human owner reviewed the exact candidate and synthetic protocol evidence.',
  };
}

export function fixture(options: { evaluations?: boolean } = {}) {
  const workspace = initialState('Synthetic lesson protocol', false);
  workspace.workspace.id = 'workspace-synthetic-lessons';
  workspace.workspace.createdAt = '2026-10-01T00:00:00.000Z';
  workspace.members[0].branches = ['main'];
  workspace.members.push(
    { id: 'accountant', name: 'Synthetic preparer', role: 'accountant', active: true, epoch: 1, branches: ['main'] },
    { id: 'viewer', name: 'Synthetic viewer', role: 'viewer', active: true, epoch: 1, branches: ['main'] },
  );
  workspace.policy.allowedSources = ['source-calculation', 'source-eval', 'source-job'];
  workspace.ontology = {
    dictionary: { version: 1, terms: [{ key: 'earned', definition: 'Published synthetic earned revenue' }] },
    recipes: [{ id: 'earned-recipe', version: 1, expression: 'sum(published rows)' }],
  };
  workspace.jobs.push({
    id: 'job-synthetic-1', revision: 'job-revision-1', memberId: 'owner', epoch: 1,
    status: 'complete', sourceIds: ['source-job'], branchIds: ['main'],
    sourceTainted: false, available: true,
    sourceMarkings: [{ sourceId: 'source-job', marking: 'Synthetic owner choice, explicitly classified safe by this fixture authority.' }],
    summary: 'Synthetic completed job: the owner chose receipt-first for weekly overviews.',
  });
  workspace.receipts.push({
    id: 'calculation-synthetic-1', revision: 'receipt-revision-1', memberId: 'owner', epoch: 1,
    status: 'published', sourceIds: ['source-calculation'], branchIds: ['main'],
    sourceTainted: false, available: true,
    sourceMarkings: [{ sourceId: 'source-calculation', marking: 'Synthetic published calculation evidence, classified safe by this fixture authority.' }],
    summary: 'Synthetic published calculation retains its exact dictionary and recipe pins.',
    dictionaryHash: digest(workspace.ontology.dictionary), recipeHash: digest(workspace.ontology.recipes), valueMinor: '4200',
  });
  const protectedHashes = () => ({
    dictionary: digest(workspace.ontology.dictionary), recipes: digest(workspace.ontology.recipes), calculations: digest(workspace.receipts),
  });
  const store = new AtomicLessonStore();
  const evidence = createLessonEvidenceAuthority(() => workspace, (state, context, reference) => {
    const collection = reference.kind === 'job' ? state.jobs : state.receipts;
    const record = collection.find(item => item.id === reference.id);
    check(record && record.available && record.memberId === context.memberId && record.epoch === context.epoch,
      'SYNTHETIC_EVIDENCE_UNAVAILABLE', 'The original fixture job or receipt owner and current epoch must match.');
    return {
      pin: { kind: reference.kind, id: record.id, revision: record.revision, digest: digest(record), sourceIds: [...record.sourceIds], branchIds: [...record.branchIds] },
      available: record.available, sourceTainted: record.sourceTainted,
      sourceMarkings: structuredClone(record.sourceMarkings), summary: record.summary,
    };
  });
  const target: LessonTarget = {
    kind: 'personal-preference', id: 'preference-overview', revision: 'preference-revision-1', digest: '',
    owner: { memberId: 'owner', role: 'owner', epoch: 1 }, value: 'overview-first',
  };
  target.digest = targetDigest(target);
  const targets = {
    authorityRevision(): string { return digest(target); },
    resolve(context: Context, requested: Pick<LessonTarget, 'kind' | 'id'>): LessonTarget {
      check(requested.kind === target.kind && requested.id === target.id, 'SYNTHETIC_TARGET_UNKNOWN', 'The fixture has one explicitly owned preference target.');
      check(context.memberId === target.owner.memberId && context.epoch === target.owner.epoch, 'SYNTHETIC_TARGET_FORBIDDEN', 'Only the current target owner has the fixture preference.');
      return structuredClone(target);
    },
    validateChange(context: Context, current: LessonTarget, after: unknown): void {
      check(context.memberId === current.owner.memberId && ['overview-first', 'receipt-first', 'details-first'].includes(String(after)) && typeof after === 'string',
        'SYNTHETIC_TARGET_INVALID', 'The fixture preference schema allows only three explicit textual choices.');
    },
  };
  const evaluationRuns = new Map<string, LessonEvaluationResult>();
  const evaluations = {
    authorityRevision(): string { return digest([...evaluationRuns.entries()].sort(([left], [right]) => left.localeCompare(right))); },
    resolve(_context: Context, reference: LessonEvaluationReference): LessonEvaluationResult {
      const run = evaluationRuns.get(reference.id);
      check(run && digest(run.reference) === digest(reference), 'SYNTHETIC_EVALUATION_UNAVAILABLE', 'The fixture resolves only an explicitly registered exact run reference.');
      return structuredClone(run);
    },
    assertSourceAccess(context: Context, sourceIds: string[]) { sourceAccess(workspace, context, sourceIds); },
  };
  const service = new LessonService(store, { evidence, targets, ...(options.evaluations === false ? {} : { evaluations }) });
  function registerEvaluations(candidate: LessonPin, alter?: (result: LessonEvaluationResult, set: 'open' | 'hidden') => void) {
    const references = {} as { open: LessonEvaluationReference; hidden: LessonEvaluationReference };
    for (const set of ['open', 'hidden'] as const) {
      const artifact = (id: string) => ({ id, revision: 'synthetic-revision-1', digest: digest({ id, fixture: 'synthetic-protocol' }) });
      const result: LessonEvaluationResult = {
        reference: { id: `${candidate.id}-${candidate.revision}-${set}-synthetic`, revision: 'synthetic-run-revision-1', digest: '' },
        set, candidate: structuredClone(candidate), authorityId: 'synthetic-explicit-test-authority', qualification: SYNTHETIC_QUALIFICATION,
        suite: artifact(`synthetic-${set}-suite`), harness: artifact(`synthetic-${set}-harness`), build: artifact('synthetic-build'), configuration: artifact('synthetic-config'),
        comparisonId: `synthetic-comparison-${candidate.id}-${candidate.revision}`, completedAt: '2026-10-03T00:00:00.000Z', status: 'complete',
        baseline: { guidance: 'off', digest: digest({ fixture: 'synthetic-baseline', candidate: candidate.id, revision: candidate.revision }) },
        treatment: { guidance: 'on', candidate: structuredClone(candidate) },
        metrics: [
          { name: 'synthetic-accuracy', direction: 'higher-is-better', before: 8, after: 9 },
          { name: 'synthetic-latency-ms', direction: 'lower-is-better', before: 10, after: 9 },
        ],
        sourceTainted: false, sourceIds: ['source-eval'],
      };
      alter?.(result, set);
      repinEvaluation(result);
      evaluationRuns.set(result.reference.id, structuredClone(result));
      references[set] = structuredClone(result.reference);
    }
    return references;
  }
  async function ready(input: LessonProposal = proposal()) {
    const proposed = await service.propose(OWNER, input);
    const references = registerEvaluations(pin(proposed.candidate));
    await service.bindEvaluations(OWNER, pin(proposed.candidate), references);
    return service.review(OWNER, pin(proposed.candidate));
  }
  async function approved(input: LessonProposal = proposal()) {
    const reviewed = await ready(input);
    return service.decideLesson(OWNER, decision(reviewed));
  }
  return { workspace, store, evidence, target, targets, evaluations, evaluationRuns, service, protectedHashes, registerEvaluations, ready, approved };
}
