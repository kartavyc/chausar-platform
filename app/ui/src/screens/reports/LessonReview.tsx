/**
 * LessonReview (RP-04 proposed lessons on Reports, The week ahead; A10.2 on Work,
 * Approvals): the currently released lesson views as quiet rows, at most five at rest and
 * every further row one page on, in the Engine's order; each row with its standing, its
 * source evidence and what it would change, and one sheet per opened row with the whole
 * source-written record, both evaluation summaries, the review token, a reason field and
 * the two approved controls, Approve and Not now.
 * Rules kept here.
 * - Rows and the sheet show what the Engine returned, verbatim: titles, rationale,
 *   summaries, markings, identities and qualification words are data, never instructions
 *   and never markup. Nothing is ranked, counted from hidden history or summarised, and
 *   no released row is cut off: the five-row density is a window, not a limit on access.
 * - A page control names the exact list and the exact page it was rendered for; a row names
 *   the exact list, page and selected candidate it was rendered beside (null at rest). A
 *   replaced list, a moved window, a newer selection or a left surface leave them inert.
 * - Approve and Not now exist only when the checked availability says so: a review-ready
 *   candidate, both evaluations complete and untainted, a current review token bound to
 *   that evaluation, and the current approving member as its owner and reviewer. A blank
 *   reason disables both. There is no Reject and no hidden-evaluation control.
 * - `synthetic-protocol` is written out as lifecycle verification only. No score, direction
 *   or outcome is computed from the metrics; they are listed as supplied.
 * - A press passes the exact displayed candidate pin, review token, evaluation digest and
 *   decision word with the typed reason upward once. This screen keeps no copy of the list
 *   and performs no effect. The host keys this sheet by that exact tuple and its address,
 *   so a typed reason never carries onto another candidate, review or evaluation.
 */

import { useId, useState, type ReactNode } from 'react';
import type { Mark, RowItem } from '../../app/presentation.ts';
import { PageHeader } from '../../app/PageHeader';
import { useT } from '../../app/text';
import type { LessonReviewState } from '../../host/retained-controller.ts';
import { LESSON_PAGE_SIZE, REASON_MAX_LENGTH, humanReason, isTransportUnavailable, lessonPin } from '../../host/retained-contracts.ts';
import type {
  LessonActorPin, LessonArtifactPin, LessonDecisionAvailability, LessonDecisionIntent, LessonEvaluationSummary, LessonHumanDecision, LessonReviewView, LessonStatus, LessonValue,
} from '../../host/retained-contracts.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { RowList } from '../../parts/RowList';
import { Sheet, type SheetPrimary } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import s from './LessonReview.module.css';

/** At most five lessons at rest (RP-04). Order is the Engine's; later rows are one page on. */
export const LESSON_ROWS_MAX = LESSON_PAGE_SIZE;

/** The at-rest window: which released rows are on this page, and where it sits in the complete list. */
export interface LessonPageWindow {
  readonly rows: readonly LessonReviewView[];
  /** One-based positions of the first and last row on this page, for the page sentence. */
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly last: number;
}
export function lessonPageWindow(lessons: readonly LessonReviewView[], page: number): LessonPageWindow {
  const last = Math.max(0, Math.ceil(lessons.length / LESSON_ROWS_MAX) - 1);
  const current = Math.min(Math.max(0, page), last), start = current * LESSON_ROWS_MAX;
  const rows = lessons.slice(start, start + LESSON_ROWS_MAX);
  return { rows, from: rows.length === 0 ? 0 : start + 1, to: start + rows.length, total: lessons.length, last };
}

const STATUS_MARK: Readonly<Record<LessonStatus, Mark>> = {
  proposed: 'busy', 'evaluation-blocked': 'unsure', 'review-ready': 'wait', approved: 'you',
  rejected: 'off', deferred: 'off', retired: 'off', superseded: 'off',
};

/** What a row control names: the exact rendered list, the page it was drawn on and the candidate selected beside it (null at rest). */
export interface LessonRowOrigin {
  readonly list: readonly LessonReviewView[];
  readonly from: string | null;
  readonly page: number;
}

export interface LessonReviewListProps {
  state: LessonReviewState;
  /** The place and sub-place words of the surface this list sits on. */
  where: string;
  title: string;
  onRead: () => void;
  /** Opens a row: the exact candidate id, the control pressed and the exact rendered origin it came from. */
  onOpen: (id: string, origin: HTMLElement, from: LessonRowOrigin) => void;
  /** Moves the at-rest window over the exact rendered list, from the exact page the control was drawn on. */
  onPage: (list: readonly LessonReviewView[], from: number, page: number) => void;
  legacy?: ReactNode;
}

/** The at-rest rows of one page, each with its standing in visible words, its evidence count
 * and what it would change. The title is the source's own, unchanged. */
export function useLessonRows(rows: readonly LessonReviewView[]): ReadonlyArray<RowItem> {
  const t = useT();
  return rows.map((view) => ({
    id: view.candidate.id,
    mark: STATUS_MARK[view.status],
    markWordsKey: `RETAINED.lesson.status.${view.status}`,
    what: view.candidate.title,
    note: t('RETAINED.lesson.rowStatus', {
      status: t(`RETAINED.lesson.status.${view.status}`), kind: t(`RETAINED.lesson.kind.${view.candidate.change.kind}`),
      target: view.candidate.change.targetId, count: view.candidate.evidence.length,
    }),
  }));
}

function Rows({ state, onOpen, onPage }: { state: Extract<LessonReviewState, { kind: 'ready' | 'deciding' }>; onOpen: LessonReviewListProps['onOpen']; onPage: LessonReviewListProps['onPage'] }) {
  const t = useT();
  const titleId = useId();
  const list = state.lessons;
  const shown = lessonPageWindow(list, state.page);
  const rows = useLessonRows(shown.rows);
  const current = Math.min(state.page, shown.last);
  return (
    <section className={s.group} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.heading}>{t('RETAINED.lesson.title')}</h2>
      <p className={s.note}>{t('RETAINED.lesson.note')}</p>
      {state.kind === 'ready' && state.notice !== null && (
        <p role="status" className={s.text}>{t(state.notice === 'LESSON_REVIEW_CHANGED' ? 'RETAINED.lesson.changed' : 'RETAINED.lesson.cancelled')}</p>
      )}
      {state.kind === 'deciding' && <p role="status" className={s.note}>{t('RETAINED.lesson.deciding')}</p>}
      {list.length === 0 ? (
        <p className={s.text}>{t('RETAINED.lesson.empty')}</p>
      ) : (
        <RowList rows={rows} labelledBy={titleId} selectedId={state.selectedId ?? undefined} onOpen={(id, origin) => onOpen(id, origin, { list, from: state.selectedId, page: current })} onReceipt={() => {}} />
      )}
      {list.length > LESSON_ROWS_MAX && (
        <div className={s.actions}>
          <p className={s.note}>{t('RETAINED.lesson.page', { from: shown.from, to: shown.to, total: shown.total })}</p>
          <Button variant="link" disabled={current === 0} onClick={() => onPage(list, current, current - 1)}>{t('RETAINED.lesson.pageEarlier')}</Button>
          <Button variant="link" disabled={current >= shown.last} onClick={() => onPage(list, current, current + 1)}>{t('RETAINED.lesson.pageLater')}</Button>
        </div>
      )}
    </section>
  );
}

export function LessonReviewList({ state, where, title, onRead, onOpen, onPage, legacy }: LessonReviewListProps) {
  const t = useT();
  let body: ReactNode;
  if (state.kind === 'ready' || state.kind === 'deciding') {
    body = (
      <>
        <Rows state={state} onOpen={onOpen} onPage={onPage} />
        <div className={s.actions}><Button variant="link" onClick={onRead}>{t('RETAINED.readAgain')}</Button></div>
      </>
    );
  } else if (state.kind === 'unavailable') {
    body = (
      <>
        <State
          state={{ kind: 'failed', code: state.code, what: t(isTransportUnavailable(state.code) ? 'RETAINED.lesson.transport' : 'RETAINED.lesson.unavailable') }}
          action={{ label: t('RETAINED.readAgain'), onPress: onRead }}
        />
        {state.afterDispatch && <p role="status" className={s.text}>{t('RETAINED.lesson.uncertain')}</p>}
      </>
    );
  } else {
    body = <p role="status" className={s.text}>{t('RETAINED.lesson.loading')}</p>;
  }
  return (
    <section className={s.page} aria-label={title}>
      <PageHeader where={where} title={title} />
      {body}
      {legacy}
    </section>
  );
}

/* ---------- The opened lesson ---------- */

function Pair({ name, mono = false, children }: { name: string; mono?: boolean | undefined; children: ReactNode }) {
  return (
    <div className={s.pair}>
      <dt className={s.name}>{name}</dt>
      <dd className={[s.value, mono ? 'fig' : ''].filter(Boolean).join(' ')}>{children}</dd>
    </div>
  );
}

function Json({ value }: { value: LessonValue }) {
  return <pre className={s.payload}>{JSON.stringify(value, null, 2)}</pre>;
}

/** A pinned actor: the member, the role in the reader's language with the exact pinned role word kept as provenance, and the epoch. */
function Actor({ actor }: { actor: LessonActorPin }) {
  const t = useT();
  return <>{t('RETAINED.lesson.actorPin', { member: actor.memberId, role: t(`RETAINED.lesson.role.${actor.role}`), enum: actor.role, epoch: actor.epoch })}</>;
}

function Artifact({ name, pin }: { name: string; pin: LessonArtifactPin }) {
  const t = useT();
  return <Pair name={name} mono>{t('RETAINED.lesson.artifact', { id: pin.id, revision: pin.revision, digest: pin.digest })}</Pair>;
}

function Conditions({ value }: { value: Readonly<Record<string, string>> }) {
  const t = useT();
  const entries = Object.entries(value);
  if (entries.length === 0) return <>{t('MISSING.none')}</>;
  return (
    <dl className={s.pairs}>
      {entries.map(([key, item]) => <Pair key={key} name={key} mono>{item}</Pair>)}
    </dl>
  );
}

function Evaluation({ name, summary }: { name: string; summary: LessonEvaluationSummary }) {
  const t = useT();
  return (
    <div className={s.group}>
      <h4 className={s.heading}>{name}</h4>
      <p className={s.text}>{t(`RETAINED.lesson.qualification.${summary.qualification}`)}</p>
      <dl className={s.pairs}>
        <Pair name={t('RETAINED.lesson.evaluation.status')}>{t(`RETAINED.lesson.evaluation.status.${summary.status}`)}</Pair>
        <Pair name={t('RETAINED.lesson.authority')} mono>{summary.authorityId}</Pair>
        <Pair name={t('RETAINED.lesson.comparison')} mono>{summary.comparisonId}</Pair>
        <Pair name={t('RETAINED.lesson.completedAt')} mono>{summary.completedAt}</Pair>
        <Pair name={t('RETAINED.lesson.baselineDigest')} mono>{summary.baseline.digest}</Pair>
        <Pair name={t('RETAINED.lesson.sourceTaint')}>{t(summary.sourceTainted ? 'RETAINED.lesson.evidence.tainted' : 'RETAINED.lesson.evidence.clean')}</Pair>
        <Pair name={t('RETAINED.lesson.sources')} mono>{summary.sourceIds.length === 0 ? t('MISSING.none') : summary.sourceIds.join(', ')}</Pair>
      </dl>
      <h5 className={s.heading}>{t('RETAINED.lesson.metrics')}</h5>
      {summary.metrics.length === 0 ? <p className={s.note}>{t('MISSING.none')}</p> : (
        <ul className={s.list}>
          {summary.metrics.map((metric) => (
            <li key={metric.name} className={[s.text, 'fig'].join(' ')}>
              {t('RETAINED.lesson.metric', { name: metric.name, before: String(metric.before), after: String(metric.after), direction: t(`RETAINED.lesson.direction.${metric.direction}`) })}
            </li>
          ))}
        </ul>
      )}
      <details className={s.more}>
        <summary className={s.summary}>{t('RETAINED.lesson.pins')}</summary>
        <dl className={s.pairs}>
          <Artifact name={t('RETAINED.lesson.reference')} pin={summary.reference} />
          <Artifact name={t('RETAINED.lesson.suite')} pin={summary.suite} />
          <Artifact name={t('RETAINED.lesson.harness')} pin={summary.harness} />
          <Artifact name={t('RETAINED.lesson.build')} pin={summary.build} />
          <Artifact name={t('RETAINED.lesson.configuration')} pin={summary.configuration} />
        </dl>
      </details>
    </div>
  );
}

export interface LessonReviewSheetProps {
  view: LessonReviewView;
  availability: LessonDecisionAvailability;
  /** A decision for this view is in flight: controls stay visible and disabled, nothing is pressed twice. */
  deciding: boolean;
  position?: { index: string; total: string } | undefined;
  origin: HTMLElement | null;
  onClose: () => void;
  onAdjacent?: ((delta: -1 | 1) => void) | undefined;
  /** Exactly one human intent: the displayed candidate, review and evaluation pins, the decision word and the typed reason. */
  onDecide: (intent: LessonDecisionIntent, reason: string) => void;
}

export function LessonReviewSheet({ view, availability, deciding, position, origin, onClose, onAdjacent, onDecide }: LessonReviewSheetProps) {
  const t = useT();
  const [reason, setReason] = useState('');
  const candidate = view.candidate;
  const ready = humanReason(reason) !== null;
  const problem = reason.trim().length > 0 && !ready ? t('RETAINED.lesson.reasonInvalid') : undefined;
  // The checked availability already requires the bound evaluation and the current review token.
  const press = (decision: LessonHumanDecision) => {
    if (!availability.ok || !ready || deciding || view.review === undefined || view.evaluation === undefined) return;
    onDecide({ candidate: lessonPin(candidate), reviewId: view.review.id, reviewDigest: view.review.digest, evaluationDigest: view.evaluation.digest, decision }, reason);
  };
  const primary: SheetPrimary | undefined = availability.ok ? { label: t('BTN.approve'), onPress: () => press('approve'), disabled: !ready || deciding } : undefined;
  const actions = availability.ok ? (
    <Button variant="quiet" disabled={!ready || deciding} onClick={() => press('defer')}>{t('BTN.notNow')}</Button>
  ) : undefined;
  return (
    <Sheet kind={t('RETAINED.lesson.sheet')} position={position} title={candidate.title} origin={origin} onClose={onClose} onAdjacent={onAdjacent} primary={primary} actions={actions}>
      <dl className={s.pairs}>
        <Pair name={t('RETAINED.lesson.statusName')}>{t(`RETAINED.lesson.status.${view.status}`)}</Pair>
        <Pair name={t('RETAINED.lesson.kindName')}>{t(`RETAINED.lesson.kind.${candidate.change.kind}`)}</Pair>
      </dl>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.rationale')}</h3>
        <p className={s.text}>{candidate.rationale}</p>
      </section>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.change')}</h3>
        <dl className={s.pairs}>
          <Pair name={t('RETAINED.lesson.target')} mono>{candidate.change.targetId}</Pair>
          <Pair name={t('WK-02.before')}><Json value={candidate.change.before} /></Pair>
          <Pair name={t('WK-02.after')}><Json value={candidate.change.after} /></Pair>
          <Pair name={t('RETAINED.lesson.targetValue')}><Json value={candidate.target.value} /></Pair>
          <Pair name={t('RETAINED.lesson.targetPin')} mono>{t('RETAINED.lesson.artifact', { id: candidate.target.id, revision: candidate.target.revision, digest: candidate.target.digest })}</Pair>
          <Pair name={t('RETAINED.lesson.owner')}><Actor actor={candidate.target.owner} /></Pair>
        </dl>
      </section>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.evidence')}</h3>
        {candidate.evidence.length === 0 ? <p className={s.note}>{t('MISSING.none')}</p> : (
          <ul className={s.list}>
            {candidate.evidence.map((item) => (
              <li key={`${item.pin.kind}:${item.pin.id}:${item.pin.revision}`} className={s.item}>
                <dl className={s.pairs}>
                  <Pair name={t(`RETAINED.lesson.evidence.kind.${item.pin.kind}`)} mono>{t('RETAINED.lesson.artifact', { id: item.pin.id, revision: item.pin.revision, digest: item.pin.digest })}</Pair>
                  <Pair name={t('RETAINED.lesson.evidence.standing')}>{t(item.available ? 'RETAINED.lesson.evidence.available' : 'RETAINED.lesson.evidence.unavailable')}</Pair>
                  <Pair name={t('RETAINED.lesson.sourceTaint')}>{t(item.sourceTainted ? 'RETAINED.lesson.evidence.tainted' : 'RETAINED.lesson.evidence.clean')}</Pair>
                  <Pair name={t('RETAINED.lesson.sources')} mono>{item.pin.sourceIds.join(', ')}</Pair>
                  <Pair name={t('RETAINED.lesson.branches')} mono>{item.pin.branchIds.join(', ')}</Pair>
                  <Pair name={t('RETAINED.lesson.markings')}>
                    {item.sourceMarkings.length === 0 ? t('MISSING.none') : (
                      <ul className={s.list}>{item.sourceMarkings.map((marking, index) => <li key={index} className={[s.text, 'fig'].join(' ')}>{t('RETAINED.lesson.marking', { source: marking.sourceId, marking: marking.marking })}</li>)}</ul>
                    )}
                  </Pair>
                </dl>
                <p className={s.text}>{item.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.scope')}</h3>
        <dl className={s.pairs}>
          <Pair name={t('RETAINED.lesson.member')} mono>{candidate.applicability.memberId}</Pair>
          <Pair name={t('RETAINED.lesson.branches')} mono>{candidate.applicability.branchIds.join(', ')}</Pair>
          <Pair name={t('RETAINED.lesson.sources')} mono>{candidate.applicability.sourceIds.join(', ')}</Pair>
          <Pair name={t('RETAINED.lesson.conditions')}><Conditions value={candidate.applicability.conditions} /></Pair>
        </dl>
        <h4 className={s.heading}>{t('RETAINED.lesson.counterexamples')}</h4>
        <ul className={s.list}>
          {candidate.counterexamples.map((counterexample, index) => (
            <li key={index} className={s.item}>
              <Conditions value={counterexample.conditions} />
              <p className={s.text}>{counterexample.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.evaluation')}</h3>
        {view.evaluation === undefined ? <p className={s.text}>{t('RETAINED.lesson.evaluation.none')}</p> : (
          <>
            <Evaluation name={t('RETAINED.lesson.evaluation.open')} summary={view.evaluation.open} />
            <Evaluation name={t('RETAINED.lesson.evaluation.hidden')} summary={view.evaluation.hidden} />
            <dl className={s.pairs}><Pair name={t('RETAINED.lesson.evaluationDigest')} mono>{view.evaluation.digest}</Pair></dl>
          </>
        )}
      </section>

      <section className={s.group}>
        <h3 className={s.heading}>{t('RETAINED.lesson.review')}</h3>
        {view.review === undefined ? <p className={s.text}>{t('RETAINED.lesson.review.none')}</p> : (
          <dl className={s.pairs}>
            <Pair name={t('RETAINED.lesson.reviewId')} mono>{view.review.id}</Pair>
            <Pair name={t('RETAINED.lesson.reviewer')}><Actor actor={view.review.reviewer} /></Pair>
            <Pair name={t('RETAINED.lesson.reviewedAt')} mono>{view.review.at}</Pair>
            <Pair name={t('RETAINED.lesson.evaluationDigest')} mono>{view.review.evaluationDigest}</Pair>
            <Pair name={t('RETAINED.lesson.digest')} mono>{view.review.digest}</Pair>
          </dl>
        )}
      </section>

      <details className={s.more}>
        <summary className={s.summary}>{t('RETAINED.lesson.identity')}</summary>
        <dl className={s.pairs}>
          <Pair name={t('RETAINED.lesson.candidate')} mono>{t('RETAINED.lesson.candidatePin', { id: candidate.id, revision: candidate.revision })}</Pair>
          <Pair name={t('RETAINED.lesson.digest')} mono>{candidate.digest}</Pair>
          <Pair name={t('RETAINED.lesson.workspace')} mono>{candidate.workspaceId}</Pair>
          <Pair name={t('RETAINED.lesson.owner')}><Actor actor={candidate.owner} /></Pair>
          <Pair name={t('RETAINED.lesson.proposedBy')}><Actor actor={candidate.proposedBy} /></Pair>
          <Pair name={t('RETAINED.lesson.proposedAt')} mono>{candidate.proposedAt}</Pair>
          <Pair name={t('RETAINED.lesson.episodes')} mono>{candidate.episodeIds.length === 0 ? t('MISSING.none') : candidate.episodeIds.join(', ')}</Pair>
          {candidate.supersedes !== undefined && <Pair name={t('RETAINED.lesson.supersedes')} mono>{t('RETAINED.lesson.candidatePin', { id: candidate.supersedes.id, revision: candidate.supersedes.revision })}</Pair>}
        </dl>
      </details>

      <section className={s.group}>
        {availability.ok ? (
          <>
            <Field label={t('RETAINED.lesson.reason')} value={reason} onChange={(event) => setReason(event.currentTarget.value)} disabled={deciding}
              maxLength={REASON_MAX_LENGTH} problem={problem} autoComplete="off" />
            {!ready && problem === undefined && <p className={s.note}>{t('RETAINED.lesson.reasonRequired')}</p>}
            <p className={s.note}>{t('RETAINED.lesson.decisionNote')}</p>
            {deciding && <p role="status" className={s.note}>{t('RETAINED.lesson.deciding')}</p>}
          </>
        ) : (
          <p className={s.text}>{t(`RETAINED.lesson.block.${availability.block}`)}</p>
        )}
      </section>
    </Sheet>
  );
}
