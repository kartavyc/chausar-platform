/**
 * Work > Ideas (Ink v2 wave 5, package 5A3; catalogue P13): the idea pipeline on 4J18's ideas list
 * (venture.ideas.list's pipeline). One column per stage, Inbox to Published, each idea with where it came from (an
 * agent's suggestion names its role) and one clear next step: Move to the next stage. Other moves and Drop sit one step
 * away under "Other moves"; a drop asks why, in one sentence. An idea in Inbox or Triage says the day it drops if
 * nothing moves it; a published idea asks for its grade from its seventh day (Today's grade card opens here). Dropped
 * ideas fold away at the end. Every refusal is worded here from the engine's code, in English and Hindi.
 *
 * Idea taken, code written here: the idea tracker of content-skills skills/viral-short-form-ideas (MIT; its sponsor
 * text left out).
 */

import { useId, useState, type FormEvent } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type IdeaGrade, type IdeaStage, type PipelineIdeaView, type VentureRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { SectionHead } from '../../parts/Tile';
import { dayOf } from '../business/shared';
import s from './Ideas.module.css';

const FORWARD: readonly IdeaStage[] = ['inbox', 'triage', 'drafted', 'made', 'published'];
const GRADES: readonly IdeaGrade[] = ['worked', 'so-so', 'did-not'];
/** The engine codes this screen words itself (kit/ideas.ts), in both languages. */
const WORDED = new Set(['IDEA_STAGE_BACKWARD', 'IDEA_DROP_REASON', 'IDEA_NOT_FOUND', 'IDEA_NOT_PUBLISHED', 'IDEA_GRADE_EARLY', 'ALREADY_DECIDED', 'APP_APPROVAL_REQUIRED']);
const IDEA_EVENTS = (event: VentureRunEvent) => event.type === 'idea.changed' || event.type === 'queue.changed';

function wordsOf(error: unknown, t: T): string {
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-rules.error.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

export function Ideas() {
  const t = useT();
  const engine = useEngine();
  const headingId = useId();
  const view = useResource('venture.ideas.list', {}, { refreshOn: IDEA_EVENTS });
  const team = useResource('venture.team.list', {});
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(work: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      await work();
      setSaid(done);
      setProblem(null);
      view.reload();
      return true;
    } catch (error) {
      setSaid(null);
      setProblem(wordsOf(error, t));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const stageName = (stage: IdeaStage) => t(`kit-rules.stage.${stage}`);
  const handlers: CardHandlers = {
    busy,
    names: new Map((team.data?.agents ?? []).map((agent) => [agent.id, agent.name] as const)),
    move: (idea, stage) => act(() => engine.request('venture.ideas.move', { id: idea.id, stage }), t('kit-rules.done.moved', { stage: stageName(stage) })),
    drop: (idea, reason) => act(() => engine.request('venture.ideas.move', { id: idea.id, stage: 'dropped', reason }), t('kit-rules.done.moved', { stage: stageName('dropped') })),
    grade: (idea, grade) => act(() => engine.request('venture.ideas.grade', { id: idea.id, grade }), t('kit-rules.done.graded', { grade: t(`kit-rules.grade.${grade}`) })),
  };

  if (view.error && !view.data) return <p className={s.problem} role="alert">{t('kit-rules.failed', { message: view.error.message })}</p>;
  if (!view.data) return null;
  const all = view.data.pipeline;
  const dropped = all.filter((idea) => idea.stage === 'dropped');
  const open = all.length - dropped.length;

  return (
    <section aria-labelledby={headingId} className={s.ideas}>
      <SectionHead
        id={headingId} title={t('kit-rules.heading')}
        end={adding || open === 0 ? undefined : <Button size="sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('kit-rules.add')}</Button>}
      />
      <p className={s.line}>{t('kit-rules.line')}</p>
      {adding && (
        <AddForm
          busy={busy} onCancel={() => setAdding(false)}
          onAdd={async (text, source) => {
            if (await act(() => engine.request('venture.ideas.add', { text, source }), t('kit-rules.done.added'))) setAdding(false);
          }}
        />
      )}
      {said && <p className={s.said} role="status" data-said="">{said}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {open === 0 && !adding ? (
        <EmptyState title={t(dropped.length ? 'kit-rules.emptyOpen' : 'kit-rules.empty')} actions={[{ label: t('kit-rules.add'), onSelect: () => setAdding(true) }]} />
      ) : open > 0 && (
        <div className={s.board}>
          {FORWARD.map((stage) => <Column key={stage} stage={stage} ideas={all.filter((idea) => idea.stage === stage)} handlers={handlers} />)}
        </div>
      )}
      {dropped.length > 0 && (
        <details className={s.fold} data-fold="dropped">
          <summary>{t('kit-rules.dropped', { count: dropped.length })}<Icon name="chevron-down" size={16} /></summary>
          <ul className={s.droppedList}>
            {dropped.map((idea) => (
              <li key={idea.id} data-idea={idea.id}>
                <span className={s.text}>{idea.text}</span>
                <span className={s.meta}>{idea.expired ? t('kit-rules.expired') : idea.dropReason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface CardHandlers {
  busy: boolean;
  /** The team's names by role id (venture.team.list: an agent's id is its role's), for Suggested by. */
  names: ReadonlyMap<string, string>;
  move: (idea: PipelineIdeaView, stage: IdeaStage) => Promise<boolean>;
  drop: (idea: PipelineIdeaView, reason: string) => Promise<boolean>;
  grade: (idea: PipelineIdeaView, grade: IdeaGrade) => Promise<boolean>;
}

function Column({ stage, ideas, handlers }: { stage: IdeaStage; ideas: PipelineIdeaView[]; handlers: CardHandlers }) {
  const t = useT();
  const id = useId();
  return (
    <section aria-labelledby={id} className={s.column} data-stage={stage}>
      <h3 id={id} className={s.columnHead}>
        {t(`kit-rules.stage.${stage}`)}
        <span className={s.count}>{ideas.length}</span>
      </h3>
      {ideas.length === 0 ? <p className={s.none}>{t('kit-rules.stage.none')}</p> : (
        <ul className={s.cards}>
          {ideas.map((idea) => <li key={idea.id}><Card idea={idea} handlers={handlers} /></li>)}
        </ul>
      )}
    </section>
  );
}

function Card({ idea, handlers }: { idea: PipelineIdeaView; handlers: CardHandlers }) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const [reason, setReason] = useState('');
  const forward = idea.next.filter((stage) => stage !== 'dropped');
  const canDrop = idea.next.includes('dropped');
  const stageName = (stage: IdeaStage) => t(`kit-rules.stage.${stage}`);

  function onDrop(event: FormEvent) {
    event.preventDefault();
    void handlers.drop(idea, reason.trim()).then((ok) => { if (ok) setReason(''); });
  }

  return (
    <article aria-labelledby={titleId} className={s.card} data-idea={idea.id}>
      <p id={titleId} className={s.text}>{idea.text}</p>
      <p className={s.meta}>
        {idea.by === 'agent' && <span className={s.by}>{idea.role && handlers.names.has(idea.role) ? t('kit-rules.byAgent', { role: handlers.names.get(idea.role)! }) : t('kit-rules.byAgentNone')}</span>}
        <span>{t('kit-rules.from', { source: idea.source })}</span>
      </p>
      {idea.dropsOn && <p className={s.meta} data-drops>{t('kit-rules.dropsOn', { day: dayOf(idea.dropsOn, language) })}</p>}
      {idea.stage === 'published' && (idea.grade ? (
        <p className={s.meta} data-graded>{t('kit-rules.graded', { grade: t(`kit-rules.grade.${idea.grade}`) })}</p>
      ) : idea.gradeDue ? (
        <div className={s.grade} role="group" aria-label={t('kit-rules.grade.ask')}>
          <p className={s.ask}>{t('kit-rules.grade.ask')}</p>
          <div className={s.actions}>
            {GRADES.map((grade) => (
              <Button key={grade} size="sm" disabled={handlers.busy} onClick={() => { void handlers.grade(idea, grade); }}>{t(`kit-rules.grade.${grade}`)}</Button>
            ))}
          </div>
        </div>
      ) : idea.gradeFrom && <p className={s.meta}>{t('kit-rules.gradeFrom', { day: dayOf(idea.gradeFrom, language) })}</p>)}
      {forward.length > 0 && (
        <div className={s.actions}>
          <Button variant="primary" size="sm" disabled={handlers.busy} onClick={() => { void handlers.move(idea, forward[0]!); }}>
            {t('kit-rules.moveTo', { stage: stageName(forward[0]!) })}
          </Button>
        </div>
      )}
      {(forward.length > 1 || canDrop) && (
        <details className={s.more}>
          <summary>{t('kit-rules.more')}<Icon name="chevron-down" size={16} /></summary>
          <div className={s.moreBody}>
            {forward.slice(1).map((stage) => (
              <Button key={stage} variant="quiet" size="sm" disabled={handlers.busy} onClick={() => { void handlers.move(idea, stage); }}>
                {t('kit-rules.moveTo', { stage: stageName(stage) })}
              </Button>
            ))}
            {canDrop && (
              <form className={s.drop} onSubmit={onDrop} aria-label={t('kit-rules.drop')}>
                <Field label={t('kit-rules.drop.reason')} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
                <Button type="submit" size="sm" disabled={handlers.busy}>{t('kit-rules.drop.confirm')}</Button>
              </form>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

function AddForm({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (text: string, source: string) => void; onCancel: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd(text.trim(), source.trim());
  }
  return (
    <form className={s.add} onSubmit={submit} aria-label={t('kit-rules.add.form')}>
      <Field label={t('kit-rules.add.text')} value={text} maxLength={300} onChange={(event) => setText(event.target.value)} />
      <Field label={t('kit-rules.add.source')} hint={t('kit-rules.add.sourceHint')} value={source} maxLength={120} onChange={(event) => setSource(event.target.value)} />
      <div className={s.actions}>
        <Button variant="quiet" onClick={onCancel}>{t('kit-rules.add.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy}>{t('kit-rules.add.save')}</Button>
      </div>
    </form>
  );
}
