/**
 * Round-4 Books pieces (BK-02, BK-03, BK-05): one source's refused files, sign-in path and age;
 * the companies open in Tally; a recipe question answered in place, who answered, the version
 * diff and reconcile; and links to the Books places other lanes draw. Display only: every figure
 * arrives from the engine. The one computation here, a whole number of days since the last read,
 * is for the age words and is never a figure.
 */
import { useState, type FormEvent } from 'react';
import type { Language } from '../../app/presentation.ts';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { laneSubPlaces } from '../../places/subplaces/index.ts';
import { laneWords } from '../../text/lanes/index.ts';
import { Section, Note, Actions, Button, Refusal } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { rupeesToPaise } from '../work/StartJob.tsx';
import { answerRemoveReply, answerReply, diffReply, reconcileView, recipeMoreReply, sourceMoreReply, tallyCompaniesReply, type DiffReply, type Question, type ReconcileView, type TallyCompanies } from './contract-r4a.ts';
import { ConfirmButton, Table, approves, fill, prepares, styles as s, useWords, valueOf, type BooksProps } from './shared.tsx';
import { TotalText } from './r2-parts.tsx';
import { sayR4, useR4, type R4, type R4Key } from './words-r4a.ts';

/** A refusal in plain words when this round names it; otherwise the shared refusal line. */
function SayR4({ code, language }: { code: string | null; language: Language }) {
  const w = useR4(language), sentence = sayR4(w, code);
  if (sentence !== null) return <p className={s.amber} role="alert">{sentence}</p>;
  return <Refusal code={code} language={language} />;
}

/* ------------------------------------------------------------------ links to other lanes' Books places */

/**
 * Links to the Books sub-places the named lanes added (places/subplaces/<lane>.ts), each by the
 * name that lane gave it. A lane that added none draws nothing here.
 */
export function LaneLinks({ props, lanes, title }: { props: BooksProps; lanes: readonly string[]; title?: string }) {
  const w = useR4(props.language);
  const links = lanes.flatMap(lane => (laneSubPlaces[lane] ?? []).filter(sub => sub.place === 'books' && (sub.shells ?? ['desktop']).includes('desktop')).map(sub => {
    const key = `SH-01.sub.books.${sub.id}`, words = laneWords[lane];
    const label = words?.[props.language]?.[key] ?? words?.en?.[key] ?? sub.id;
    return { id: sub.id, lane, label };
  }));
  if (links.length === 0) return null;
  return (
    <nav aria-label={title ?? w.moreInBooks} className={s.inline}>
      <span className={s.note}>{title ?? w.moreInBooks}:</span>
      {links.map(link => <Button key={`${link.lane}:${link.id}`} variant="link" onClick={() => props.navigate({ place: 'books', sub: link.id })}>{link.label}</Button>)}
    </nav>
  );
}

/* ------------------------------------------------------------------ BK-02 */

/** Days since an instant, for the age words only. */
export function daysSince(iso: string, now = Date.now()): number { return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)); }
export function ageText(iso: string | null, w: R4, language: Language): string {
  if (iso === null) return w['age.never'];
  const n = daysSince(iso), when = day(iso, language);
  return n === 0 ? fill(w['age.today'], { when }) : n === 1 ? fill(w['age.yesterday'], { when }) : fill(w['age.days'], { n, when });
}

/** BK-02 on one source's sheet: the data's age, the sign-in path before the button, and where refused files are. */
export function SourceMore({ props, sourceId }: { props: BooksProps; sourceId: string }) {
  const w = useR4(props.language), b = useWords(props.language);
  const { loaded } = useReply(props, 'books.sourceMore', { sourceId }, sourceMoreReply, sourceId);
  const v = valueOf(loaded);
  if (!v) return null;
  return (
    <>
      <Section title={w.ageTitle}>
        <p>{ageText(v.age.lastRead, w, props.language)}</p>
        {v.age.stale && <p className={s.amber}>{w.ageStale}</p>}
        {v.age.schedule && v.age.schedule.everyHours !== null && v.age.schedule.freshnessTargetHours !== null && props.view !== 'simple' && (
          <Note>{fill(w.ageSchedule, { every: v.age.schedule.everyHours, target: v.age.schedule.freshnessTargetHours })}</Note>
        )}
      </Section>
      {v.signIn && (
        <Section title={w.signInPathTitle}>
          <p>{w[`path.${v.signIn.method}`]}</p>
          {v.signIn.endpoint && <p className={s.note}>{fill(w.pathEndpoint, { endpoint: v.signIn.endpoint })}</p>}
          {v.signIn.note && props.view !== 'simple' && <Note>{v.signIn.note}</Note>}
        </Section>
      )}
      <Section title={w.keptTitle}>
        <p>{w.keptNot}</p>
        <p className={s.note}>{v.kept.where ? fill(w.keptWhere, { where: v.kept.where }) : w.keptYours}</p>
        {v.refused.length === 0 ? <Note>{w.noRefused}</Note> : (
          <Table view={props.view} caption={w.keptTitle} columns={[{ head: b['col.when'], simple: true }, { head: w['col.change'] }, { head: b['col.format'] }, { head: w['col.path'], simple: true }]}
            rows={v.refused.map((r, i) => ({ key: `${r.at}-${i}`, cells: [day(r.at, props.language), w[`origin.${r.origin}`], r.what ?? '', <span className="fig">{r.code ?? ''}</span>] }))} />
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ BK-03 */

/**
 * "Which company?": the companies open in Tally now. With `onPick`, a company can be chosen for a
 * new connection; without it, the list says whether this connection's company is open.
 */
export function TallyCompaniesPart({ props, sourceId, onPick }: { props: BooksProps; sourceId?: string; onPick?: (name: string) => void }) {
  const w = useR4(props.language);
  const act = useAct(props.rpc);
  const [found, setFound] = useState<TallyCompanies | null>(null);
  if (!approves(props)) return null;
  const ask = async () => { const outcome = await act.run('books.tallyCompanies', sourceId ? { sourceId } : {}, tallyCompaniesReply); if (outcome.ok) setFound(outcome.value); };
  return (
    <div className={s.stack} aria-label={w.companiesTitle}>
      <Actions><Button onClick={() => { void ask(); }} disabled={act.busy}>{act.busy ? w.listingCompanies : w.listCompanies}</Button></Actions>
      {found && !found.available && found.reason && <Note>{w[`companies.${found.reason}`]}</Note>}
      {found && found.available && (found.companies.length === 0 ? <Note>{w.noCompanies}</Note> : (
        <ul className={s.list} aria-label={w.companiesTitle}>
          {found.companies.map(c => (
            <li key={c.name} className={s.inline}>
              <span>{c.name}</span>{c.booksFrom && props.view !== 'simple' && <span className={s.note}>{fill(w.booksFrom, { when: c.booksFrom })}</span>}
              {onPick && <Button variant="link" onClick={() => onPick(c.name)}>{w.useCompany}</Button>}
            </li>
          ))}
        </ul>
      ))}
      {found && found.available && !onPick && found.current && (found.currentOpen ? <p className={s.note}>{w.currentOpen}</p> : <p className={s.amber}>{fill(w.currentNotOpen, { name: found.current })}</p>)}
      <SayR4 code={act.refusal} language={props.language} />
    </div>
  );
}

/* ------------------------------------------------------------------ BK-05 */

const CHOICE_WORD: Readonly<Record<string, R4Key>> = { 'leave-out': 'choice.leave-out', 'no-status': 'choice.no-status', in: 'choice.in', out: 'choice.out' };
const choiceLabel = (value: string, w: R4) => Object.hasOwn(CHOICE_WORD, value) ? `${w[CHOICE_WORD[value]!]} (${value})` : value;
const roleWord = (role: string, language: Language) => {
  const words: Record<string, [string, string]> = { owner: ['owner', 'मालिक'], cofounder: ['co-founder', 'सह-संस्थापक'], accountant: ['accountant', 'लेखाकार'], ca: ['CA', 'CA'], viewer: ['viewer', 'दर्शक'] };
  return words[role]?.[language === 'hi' ? 1 : 0] ?? role;
};

function AnswerQuestion({ props, q, can, onAnswered }: { props: BooksProps; q: Question; can: boolean; onAnswered: () => void }) {
  const w = useR4(props.language);
  const act = useAct(props.rpc);
  const [choice, setChoice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (choice === null) return;
    const outcome = await act.run('books.recipeAnswer', { envelopeId: q.envelopeId, choice }, answerReply);
    if (!outcome.ok) return;
    const v = outcome.value;
    setDone(v.read ? (v.next ? `${w.answeredRead} ${w.answeredNext}` : w.answeredRead) : w[`again.${v.readAgain === 'bring-the-file-again' ? 'bring-the-file-again' : 'read-again'}`]);
    onAnswered();
  };
  return (
    <li className={s.stack}>
      <strong>{fill(w[`q.${q.reason}`], { field: q.field })}</strong>
      {/* The source's own value: outside text, shown as data only. */}
      {q.sample !== null && <span className={s.note}>{fill(w.sampleWas, { sample: q.sample })}</span>}
      {!can ? <Note>{w.answerNotBuilt}</Note> : !prepares(props) ? <ul className={s.list}>{q.choices.map(c => <li key={c}>{choiceLabel(c, w)}</li>)}</ul> : done ? <p role="status">{done}</p> : (
        <form className={s.form} aria-label={w.answerTitle} onSubmit={event => { void submit(event); }}>
          <Choice<string> label={w.answerChoice} options={q.choices.map(c => ({ value: c, label: choiceLabel(c, w) }))} value={choice} onChange={setChoice} />
          <Note>{w.answerRule}</Note>
          <Actions><Button submit variant="filled" disabled={choice === null || act.busy}>{act.busy ? w.answering : w.answerSend}</Button></Actions>
        </form>
      )}
      <SayR4 code={act.refusal} language={props.language} />
    </li>
  );
}

function RecLine({ r, w, language }: { r: ReconcileView; w: R4; language: Language }) {
  const ours = r.ours.total === null ? w.recNone : null, theirs = r.theirs?.total == null ? w.recNone : null;
  return (
    <p className={r.status === 'matches' ? undefined : s.amber}>
      {w[`rec.${r.status}`]} <span className={s.note}>{day(r.at, language)} · {r.by.name}, {roleWord(r.by.role, language)} · {ours ?? <TotalText value={r.ours.total} measure={r.measure} unit={r.unit} />} / {theirs ?? <TotalText value={r.theirs!.total} measure={r.measure} unit={r.unit} />} · {fill(w.recRows, { live: r.ours.live, changed: r.ours.changed })}</span>
    </p>
  );
}

function Reconcile({ props, envelopeId, onDone }: { props: BooksProps; envelopeId: string; onDone: () => void }) {
  const w = useR4(props.language);
  const act = useAct(props.rpc);
  const [total, setTotal] = useState('');
  const [result, setResult] = useState<ReconcileView | null>(null);
  const bad = total.trim() !== '' && rupeesToPaise(total) === null;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (bad) return;
    const minor = total.trim() ? rupeesToPaise(total) : null;
    const outcome = await act.run('books.recipeReconcile', { envelopeId, ...(minor ? { reportTotals: { total: minor } } : {}) }, reconcileView);
    if (outcome.ok) { setResult(outcome.value); onDone(); }
  };
  return (
    <form className={s.form} aria-label={w.reconcileTitle} onSubmit={event => { void submit(event); }}>
      <Field label={w.reconcileTotal} inputMode="decimal" prefix="₹" value={total} onChange={e => setTotal(e.target.value)} problem={bad ? w['say.INVALID_SOURCE_TOTALS'] : undefined} />
      <Actions><Button submit disabled={bad || act.busy}>{w.reconcileSend}</Button></Actions>
      {result && <div role="status"><RecLine r={result} w={w} language={props.language} /></div>}
      <SayR4 code={act.refusal} language={props.language} />
    </form>
  );
}

function Diff({ props, recipeId, envelopeId }: { props: BooksProps; recipeId: string; envelopeId: string | null }) {
  const w = useR4(props.language);
  const act = useAct(props.rpc);
  const [diff, setDiff] = useState<DiffReply | null>(null);
  const show = async () => { const outcome = await act.run('books.recipeDiff', { recipeId, ...(envelopeId ? { envelopeId } : {}) }, diffReply); if (outcome.ok) setDiff(outcome.value); };
  const d = diff?.diff ?? null;
  return (
    <div className={s.stack}>
      {!diff && <Actions><Button onClick={() => { void show(); }} disabled={act.busy}>{w.showDiff}</Button></Actions>}
      {diff && !diff.available && <Note>{w.diffNotBuilt}</Note>}
      {d && !d.available && <Note>{w.diffOld}</Note>}
      {d && d.available && (
        <>
          <Note>{fill(w.diffFromTo, { from: d.from.version, fromLabel: w[`label.${d.from.label}`], to: d.to.version, toLabel: w[`label.${d.to.label}`] })}</Note>
          {d.same || d.changes.length === 0 ? <p>{w.diffSame}</p> : (
            <Table view={props.view} caption={w.diffTitle} columns={[
              { head: w['col.path'], simple: true }, { head: w['col.change'], simple: true }, { head: w['col.before'] }, { head: w['col.after'], simple: true }, { head: w['col.effect'] },
            ]} rows={d.changes.map((c, i) => ({ key: `${c.path}-${i}`, cells: [<span className="fig">{c.path}</span>, w[`chg.${c.change}`], c.before ?? '', c.after ?? '', w[`effect.${c.effect}`]] }))} />
          )}
        </>
      )}
      <SayR4 code={act.refusal} language={props.language} />
    </div>
  );
}

/** BK-05 on a recipe's sheet: answer its question here, who answered, reconcile, and what changes between versions. */
export function RecipeMore({ props, recipeId, checkEnvelopeId }: { props: BooksProps; recipeId: string; checkEnvelopeId: string | null }) {
  const w = useR4(props.language), b = useWords(props.language);
  const { loaded, reload } = useReply(props, 'books.recipeMore', { recipeId }, recipeMoreReply, recipeId);
  const act = useAct(props.rpc);
  const [note, setNote] = useState<string | null>(null);
  const v = valueOf(loaded);
  if (!v) return null;
  const remove = async (answerId: string) => { if ((await act.run('books.recipeAnswerRemove', { answerId }, answerRemoveReply)).ok) { setNote(w.answerRemoved); reload(); } };
  return (
    <>
      {v.gstin && <Note>{w.gstinTitle}: <span className="fig">{v.gstin}</span></Note>}
      {v.questions.length > 0 && (
        <Section title={w.answerTitle}>
          <ul className={s.list}>{v.questions.map(q => <AnswerQuestion key={q.envelopeId} props={props} q={q} can={v.can.answer} onAnswered={reload} />)}</ul>
        </Section>
      )}
      <Section title={w.answersTitle}>
        {v.reconciled && <p>{fill(w.reconciledBy, { by: v.reconciled.by, role: roleWord(v.reconciled.role, props.language), when: day(v.reconciled.at, props.language) })}</p>}
        {v.answers.length === 0 ? <Note>{w.noAnswers}</Note> : (
          <ul className={s.list}>{v.answers.map(a => (
            <li key={a.id} className={s.inline}>
              <span>{fill(w.answeredBy, { name: a.answeredBy.name, role: roleWord(a.answeredBy.role, props.language), when: day(a.answeredBy.at, props.language), field: a.field, choice: choiceLabel(a.choice, w) })}</span>
              {v.can.remove && prepares(props) && <ConfirmButton label={w.removeAnswer} confirm={w.removeAnswerConfirm} keep={b.keep} onConfirm={() => { void remove(a.id); }} disabled={act.busy} />}
            </li>
          ))}</ul>
        )}
        {note && <p role="status">{note}</p>}
        <SayR4 code={act.refusal} language={props.language} />
      </Section>
      <Section title={w.reconcileTitle}>
        {!v.can.reconcile ? <Note>{w.reconcileNotBuilt}</Note> : checkEnvelopeId && prepares(props) ? <Reconcile props={props} envelopeId={checkEnvelopeId} onDone={reload} /> : null}
        {v.reconciliations.length > 0 && props.view !== 'simple' && (
          <div aria-label={w.recHistory}>{v.reconciliations.map((r, i) => <RecLine key={`${r.envelopeId}-${r.at}-${i}`} r={r} w={w} language={props.language} />)}</div>
        )}
      </Section>
      <Section title={w.diffTitle}>
        {v.can.diff ? <Diff props={props} recipeId={recipeId} envelopeId={checkEnvelopeId} /> : <Note>{w.diffNotBuilt}</Note>}
      </Section>
    </>
  );
}
