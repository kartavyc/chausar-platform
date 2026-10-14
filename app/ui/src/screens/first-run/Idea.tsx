/**
 * FR-11 An idea, not a business yet, and FR-12 the setup checklist after it.
 *
 * The conversation is on the left and the draft forms on the right (the TwoSides pattern):
 * the business in a few lines, the money for one sale, a first 90-day plan, and the unknowns.
 * Every line carries its label, "told by owner" or "assumption" (the owner's own guess, or a
 * dated range with its source). The draft is built without a model: the owner types one thing
 * at a time and picks where it goes; the engine keeps the words exactly as typed
 * (`todayx.idea.*`). No number is written by anything but the owner: an unknown nobody told
 * stays blank. Each statement can be corrected or taken back.
 *
 * The idea is kept in the workspace's vault, which the founder made at FR-03, as owner text.
 *
 * FR-12 rows come from the engine's dated rule table (`todayx.setupChecklist`). Each row names
 * its rule, its source and the date it was checked. Nothing on that list comes from a model.
 */

import { useEffect, useId, useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { Label } from '../../parts/Label';
import { TwoSides } from '../../patterns/TwoSides';
import {
  IDEA_UNKNOWNS, isChecklistReply, isIdeaReply,
  type ChecklistRow, type IdeaDraft, type IdeaLine, type IdeaSection, type IdeaUnknown, type IdeaUnknownRow,
} from '../../bridge/todayx-contract.ts';
import { ReplyValidationError } from '../../bridge/validate.ts';
import { failureOf, type JourneyFailure, type JourneyPort } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import s from './Journey.module.css';

type Checklist = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly rows: readonly ChecklistRow[] } | { readonly kind: 'failed'; readonly failure: JourneyFailure };

export function SetupChecklist({ rpc }: { rpc: JourneyPort }) {
  const t = useT();
  const [list, setList] = useState<Checklist>({ kind: 'reading' });
  useEffect(() => {
    let live = true;
    void rpc.request('todayx.setupChecklist', {}).then(reply => {
      if (!isChecklistReply(reply)) throw new ReplyValidationError('todayx.setupChecklist');
      if (live) setList({ kind: 'ready', rows: reply.rows });
    }).catch((error: unknown) => { if (live) setList({ kind: 'failed', failure: failureOf(error) }); });
    return () => { live = false; };
  }, [rpc]);
  return (
    <section className={s.section} data-setup-checklist="">
      <h2 className={s.sectionTitle}>{t('FR-12.title')}</h2>
      <p className={s.note}>{t('FR-12.lede')}</p>
      {list.kind === 'reading' && <Status k="FR-12.reading" />}
      {list.kind === 'failed' && <FailureLine failure={list.failure} notBuilt="FR-12.notBuilt" refused="FR.journey.code" />}
      {list.kind === 'ready' && (
        <ul className={s.rows}>
          {list.rows.map(row => (
            <li key={row.id} className={s.row} data-checklist-row={row.id}>
              <div className={s.rowLine}>
                <span className={s.rowName}>{t(`FR-12.row.${row.id}`)}</span>
                <span className={s.rowState}>{t(`FR-12.state.${row.state}`)}</span>
              </div>
              <p className={s.note}>{t('FR-12.rule', { rule: row.ruleId, source: row.source, date: row.checkedOn.slice(0, 10) })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where a statement goes: a part of the draft, or the answer to one of the standard unknowns. */
type Target = IdeaSection | IdeaUnknown;
const TARGETS: readonly Target[] = ['business', 'sale', 'plan', 'unknown', 'price', 'sale-cost', 'first-customers', 'licences'];
const isUnknownTarget = (target: Target): target is IdeaUnknown => (IDEA_UNKNOWNS as readonly string[]).includes(target);

type Draft = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly draft: IdeaDraft } | { readonly kind: 'failed'; readonly failure: JourneyFailure };

function checked(reply: unknown, method: string): IdeaDraft {
  if (!isIdeaReply(reply) || reply.state !== 'drafting') throw new ReplyValidationError(method);
  return reply;
}

function Lines({ lines, empty }: { lines: readonly IdeaLine[]; empty?: string | undefined }) {
  const t = useT();
  if (lines.length === 0) return empty === undefined ? null : <p className={s.note}>{t(empty)}</p>;
  return (
    <ul className={s.rows}>
      {lines.map(line => (
        <li key={line.claimId} className={s.row} data-idea-line={line.claimId} data-idea-label={line.label}>
          <div className={s.rowLine}>
            <span className={s.rowName}>{line.text}</span>
            <Label kind={line.label} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function UnknownRow({ row }: { row: IdeaUnknownRow }) {
  const t = useT();
  return (
    <div data-idea-unknown={row.id} data-idea-unknown-state={row.state}>
      <p className={s.status}>{t(`FR-11.unknown.${row.id}`)}</p>
      {row.state === 'told' && <Lines lines={row.lines} />}
      {row.state === 'blank' && <p className={s.note}>{t('FR-11.blank')}</p>}
      {row.state === 'range' && row.range !== null && (
        <div className={s.rowLine}>
          <span className={s.note}>{t('FR-11.range', { low: row.range.low, high: row.range.high, unit: row.range.unit, source: row.range.source, date: row.range.checkedOn.slice(0, 10) })}</span>
          <Label kind="assumption" />
        </div>
      )}
    </div>
  );
}

function DraftSide({ draft }: { draft: IdeaDraft }) {
  const t = useT();
  const unknowns = (section: IdeaSection) => draft.unknowns.filter(row => row.section === section);
  const blank = draft.unknowns.filter(row => row.state === 'blank');
  return (
    <div data-idea-draft="">
      <h4 className={s.sectionTitle}>{t('FR-11.part.business')}</h4>
      <Lines lines={draft.business} empty="FR-11.empty" />
      <h4 className={s.sectionTitle} style={{ marginTop: 'var(--sp5)' }}>{t('FR-11.part.sale')}</h4>
      <Lines lines={draft.sale} />
      {unknowns('sale').map(row => <UnknownRow key={row.id} row={row} />)}
      <h4 className={s.sectionTitle} style={{ marginTop: 'var(--sp5)' }}>{t('FR-11.part.plan')}</h4>
      <Lines lines={draft.plan} />
      {unknowns('plan').map(row => <UnknownRow key={row.id} row={row} />)}
      <h4 className={s.sectionTitle} style={{ marginTop: 'var(--sp5)' }}>{t('FR-11.part.unknown')}</h4>
      {blank.length > 0 && (
        <ul className={s.rows} data-idea-blanks="">
          {blank.map(row => <li key={row.id} className={s.row}>{t(`FR-11.unknown.${row.id}`)}</li>)}
        </ul>
      )}
      <Lines lines={draft.unknownsTold} empty={blank.length === 0 ? 'FR-11.empty' : undefined} />
      <Note k="FR-11.noModel" />
    </div>
  );
}

export function Idea({ rpc, onDone }: { rpc: JourneyPort; onDone: () => void }) {
  const t = useT();
  const targetId = useId();
  const [state, setState] = useState<Draft>({ kind: 'reading' });
  const [text, setText] = useState('');
  const [target, setTarget] = useState<Target>('business');
  const [guess, setGuess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<JourneyFailure | null>(null);
  const [editing, setEditing] = useState<{ readonly claimId: string; readonly text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void rpc.request('todayx.idea.start', {}).then(reply => {
      if (live) setState({ kind: 'ready', draft: checked(reply, 'todayx.idea.start') });
    }).catch((error: unknown) => { if (live) setState({ kind: 'failed', failure: failureOf(error) }); });
    return () => { live = false; };
  }, [rpc]);

  const send = async (work: () => Promise<unknown>, method: string): Promise<boolean> => {
    setBusy(true); setRefusal(null);
    try { setState({ kind: 'ready', draft: checked(await work(), method) }); return true; }
    catch (error) { setRefusal(failureOf(error)); return false; }
    finally { setBusy(false); }
  };

  const tell = async () => {
    const typed = text.trim();
    if (typed.length === 0) { setProblem('FR-11.say.empty'); return; }
    setProblem(null);
    const where = isUnknownTarget(target) ? { answers: target } : { section: target };
    if (await send(() => rpc.request('todayx.idea.tell', { text: typed, ...where, ...(guess ? { guess: true } : {}) }), 'todayx.idea.tell')) { setText(''); setGuess(false); }
  };
  const correct = async () => {
    if (editing === null) return;
    const typed = editing.text.trim();
    if (typed.length === 0) { setProblem('FR-11.say.empty'); return; }
    setProblem(null);
    if (await send(() => rpc.request('todayx.idea.correct', { claimId: editing.claimId, text: typed }), 'todayx.idea.correct')) setEditing(null);
  };
  const withdraw = (claimId: string) => { void send(() => rpc.request('todayx.idea.correct', { claimId, withdraw: true }), 'todayx.idea.correct'); };

  return (
    <section data-first-run-screen="idea">
      <StepHeader step={6} title="FR-11.title" lede="FR-11.lede" />
      {state.kind === 'reading' && <Status k="FR-11.reading" />}
      {state.kind === 'failed' && <FailureLine failure={state.failure} notBuilt="FR-11.notBuilt" refused="FR-11.refused" />}
      {state.kind === 'ready' && (
        <TwoSides title={t('FR-11.title')}
          left={{ heading: t('FR-11.talk'), children: (
            <div data-idea-conversation="">
              {state.draft.conversation.length === 0
                ? <p className={s.note}>{t('FR-11.talk.empty')}</p>
                : (
                  <ul className={s.rows}>
                    {state.draft.conversation.map(item => (
                      <li key={item.claimId} className={s.row} data-idea-told={item.claimId} data-idea-status={item.status}>
                        {editing?.claimId === item.claimId
                          ? (
                            <form onSubmit={event => { event.preventDefault(); void correct(); }}>
                              <Field label={t('FR-11.correct.field')} value={editing.text} maxLength={500} autoComplete="off"
                                onChange={event => { const value = event.currentTarget.value; setEditing(current => current === null ? null : { ...current, text: value }); }} />
                              <Actions>
                                <Act submit variant="filled" label="FR-11.correct.save.btn" disabled={busy} />
                                <Act variant="link" label="FR-11.correct.cancel.btn" onClick={() => setEditing(null)} />
                              </Actions>
                            </form>
                          )
                          : (
                            <>
                              <div className={s.rowLine}>
                                <span className={s.rowName}>{item.text}</span>
                                <Label kind={item.label} />
                              </div>
                              <p className={s.note}>{t(item.status === 'active' ? 'FR-11.told.where' : `FR-11.told.${item.status}`, {
                                where: t(`FR-11.target.${item.answers ?? item.section}`),
                              })}</p>
                              {item.status === 'active' && (
                                <Actions>
                                  <Act variant="link" label="FR-11.correct.btn" disabled={busy} onClick={() => { setProblem(null); setEditing({ claimId: item.claimId, text: item.text }); }} />
                                  <Act variant="link" label="FR-11.withdraw.btn" disabled={busy} onClick={() => withdraw(item.claimId)} />
                                </Actions>
                              )}
                            </>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
              <form className={s.section} data-idea-say="" onSubmit={event => { event.preventDefault(); void tell(); }}>
                <div className={s.fields}>
                  <Field label={t('FR-11.say')} value={text} maxLength={500} autoComplete="off" onChange={event => setText(event.currentTarget.value)} />
                  <label className={s.rowLine} htmlFor={targetId}>
                    <span className={s.rowName}>{t('FR-11.where')}</span>
                  </label>
                  <select id={targetId} className={s.select} value={target} onChange={event => {
                    const value = event.currentTarget.value;
                    if ((TARGETS as readonly string[]).includes(value)) setTarget(value as Target);
                  }}>
                    {TARGETS.map(option => <option key={option} value={option}>{t(`FR-11.target.${option}`)}</option>)}
                  </select>
                  <label className={s.radioRow}>
                    <input type="checkbox" checked={guess} onChange={event => setGuess(event.currentTarget.checked)} />
                    <span>{t('FR-11.guess')}</span>
                  </label>
                </div>
                {problem !== null && <p className={s.problem} role="alert">{t(problem)}</p>}
                {refusal !== null && <FailureLine failure={refusal} notBuilt="FR-11.notBuilt" refused="FR-11.refused" />}
                <Actions><Act submit variant="filled" label="FR-11.say.btn" disabled={busy} /></Actions>
              </form>
              <Note k="FR-11.kept" />
            </div>
          ) }}
          right={{ heading: t('FR-11.draft'), children: <DraftSide draft={state.draft} /> }} />
      )}
      <SetupChecklist rpc={rpc} />
      <Actions><Act variant="filled" label="FR-12.finish.btn" onClick={onDone} /></Actions>
    </section>
  );
}
