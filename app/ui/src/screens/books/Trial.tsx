/**
 * BK-09 Try a change on a copy (experimental). Reached from a meaning draft (BK-08) or a
 * proposed mapping (BK-05). The address sheet is the draft id, or `p:` and the proposal id.
 * Saved questions are worked out twice on a private copy: now, and with the change. A figure
 * that differs is in ink, the rest grey. "Now" opens the saved answer's receipt; "with the
 * change" opens the copy's receipt here. The copy never runs an action and never sends anything.
 */
import { useState } from 'react';
import { Label } from '../../parts/Label';
import { Note, Section, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day, paise } from '../work/kit/format.ts';
import { missingWord } from '../work/kit/words.ts';
import { trialDiscardReply, trialPublishReply, trialQuestionsReply, trialReadReply, trialView, type TrialCell, type TrialView } from './contract.ts';
import { BooksPage, Money, Table, approves, fill, idOf, prepares, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { Say, r2Styles as t } from './r2-parts.tsx';
import { useR2, type R2 } from './words-r2.ts';

export function Trial(props: BooksProps) {
  const r = useR2(props.language);
  const raw = idOf(props.address.sheet);
  const target = raw === null ? null : raw.startsWith('p:') ? { proposalId: raw.slice(2) } : { draftId: raw };
  const { loaded, reload } = useReply(props, 'books.trialRead', target ?? { draftId: '' }, trialReadReply, raw ?? '');
  const value = target ? valueOf(loaded) : undefined;
  return (
    <BooksPage props={props} sub="trial" title={r['title.trial']} loaded={target ? loaded : undefined} reload={reload} aside={<Label kind="experimental" />}>
      <Note>{r.copyRule}</Note>
      {!target && <Note>{r.noDraft}</Note>}
      {value && (value.trial === null
        ? (prepares(props) ? <MakeCopy props={props} target={target!} onMade={reload} /> : <Note>{r.noDraft}</Note>)
        : <Compare props={props} trial={value.trial} onDone={reload} />)}
    </BooksPage>
  );
}

function MakeCopy({ props, target, onMade }: { props: BooksProps; target: { draftId: string } | { proposalId: string }; onMade: () => void }) {
  const r = useR2(props.language);
  const { loaded } = useReply(props, 'books.trialQuestions', {}, trialQuestionsReply);
  const questions = valueOf(loaded);
  const act = useAct(props.rpc);
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const chosen = picked ?? new Set((questions?.questions ?? []).filter(q => !q.stale).map(q => q.id));
  const toggle = (id: string) => { const next = new Set(chosen); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };
  const make = async () => { if ((await act.run('books.trial', { ...target, savedAnswerIds: [...chosen] }, trialView)).ok) onMade(); };
  return (
    <Section title={r.pickQuestions}>
      {loaded.phase === 'refused' && <Say code={loaded.code} language={props.language} />}
      {questions && (questions.questions.length === 0 ? <Note>{r['empty.saved']}</Note> : (
        <>
          <ul className={s.list}>{questions.questions.map(q => (
            <li key={q.id}><label className={t.check}><input type="checkbox" checked={chosen.has(q.id)} onChange={() => toggle(q.id)} />
              {q.operation}{q.period ? ` · ${day(q.period.from, props.language)} – ${day(q.period.to, props.language)}` : ''}{q.stale ? ` ${r.staleQuestion}` : ''}</label></li>
          ))}</ul>
          <Actions><Button variant="filled" onClick={() => { void make(); }} disabled={act.busy || chosen.size === 0}>{r.makeCopy}</Button></Actions>
          {act.busy && <p role="status">{r.making}</p>}
        </>
      ))}
      <Say code={act.refusal} language={props.language} />
    </Section>
  );
}

function CellValue({ cell, differs, language, r }: { cell: TrialCell; differs: boolean; language: BooksProps['language']; r: R2 }) {
  if (cell.refused) return <span className={s.amber}>{fill(r.refusedCell, { code: cell.refused })}</span>;
  return <span className={differs ? t.ink : t.grey}>{'minor' in cell.value ? <span className="fig">{paise(cell.value.minor)}</span> : missingWord(cell.value.missing, language)}</span>;
}

function Compare({ props, trial, onDone }: { props: BooksProps; trial: TrialView; onDone: () => void }) {
  const r = useR2(props.language);
  const act = useAct(props.rpc);
  const [shown, setShown] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const publish = async () => {
    if (!trial.evaluationDigest || !trial.impact) return;
    if ((await act.run('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: trial.impact.digest }, trialPublishReply)).ok) setNote(r.publishedCopy);
  };
  const discard = async () => { if ((await act.run('books.trialDiscard', { trialId: trial.trialId }, trialDiscardReply)).ok) { setNote(r.discardedCopy); onDone(); } };
  const open = trial.rows.find(x => x.answerId === shown);
  return (
    <div className={s.stack}>
      <Note>{trial.change.target} · {fill(r.copyCost, { ms: trial.cost.preparationMs, kb: Math.ceil(trial.cost.diskBytes / 1024) })}</Note>
      <Table view={props.view} caption={r['title.trial']} columns={[
        { head: r['col.question'], simple: true }, { head: r['col.now'], num: true, simple: true }, { head: r['col.withChange'], num: true, simple: true },
      ]} rows={trial.rows.map(row => ({ key: row.answerId, cells: [
        `${row.operation}${row.period ? ` · ${day(row.period.from, props.language)} – ${day(row.period.to, props.language)}` : ''}`,
        row.now.refused || row.now.receiptId === null
          ? <CellValue cell={row.now} differs={row.differs} language={props.language} r={r} />
          : <span className={row.differs ? t.ink : t.grey}><Money value={row.now.value} receiptId={row.now.receiptId} language={props.language} onReceipt={props.openReceipt} /></span>,
        <button type="button" className={t.cellButton} aria-label={`${r.openCopyReceipt}: ${row.operation}`} onClick={() => setShown(shown === row.answerId ? null : row.answerId)}>
          <CellValue cell={row.withChange} differs={row.differs} language={props.language} r={r} />
        </button>,
      ] }))} />
      {open && open.withChange.receipt && (
        <div className={t.panel} role="region" aria-label={fill(r.copyReceipt, { operation: open.operation })}>
          <strong>{fill(r.copyReceipt, { operation: open.withChange.receipt.operation })}</strong>
          <span>{fill(r.counted, { n: open.withChange.receipt.counted, x: open.withChange.receipt.excluded })}</span>
          <span>{fill(r.usesWords, { list: open.withChange.receipt.definitions.join(', ') })}</span>
          <span>{fill(r.coverage, { what: open.withChange.receipt.completeness })}</span>
        </div>
      )}
      {trial.impact ? <p>{fill(r.impact, { n: trial.impact.affectedAnswers, r: trial.impact.rebuild })}</p> : trial.impactCode && <p className={s.amber}>{fill(r.impactUnknown, { code: trial.impactCode })}</p>}
      {trial.limitations.length > 0 && <Section title={r.limitations}><ul className={s.list}>{trial.limitations.map(l => <li key={l}>{l}</li>)}</ul></Section>}
      {!note && (
        <Actions>
          {approves(props) && trial.impact && trial.evaluationDigest && <Button variant="filled" onClick={() => { void publish(); }} disabled={act.busy}>{r.publish}</Button>}
          {prepares(props) && <Button danger onClick={() => { void discard(); }} disabled={act.busy}>{r.discard}</Button>}
        </Actions>
      )}
      {note && <p role="status">{note}</p>}
      <Say code={act.refusal} language={props.language} />
    </div>
  );
}
