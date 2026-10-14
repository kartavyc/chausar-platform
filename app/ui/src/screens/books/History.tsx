/** BK-15 History (as known on a date, versions of one entity) and BK-16 stale answers. */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Label } from '../../parts/Label';
import { Section, Note, Refusal, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day, dayTime } from '../work/kit/format.ts';
import { asKnownReply, staleAnswer, staleReply, versionsReply } from './contract.ts';
import { BooksPage, Money, Recorded, Table, fill, styles as s, useWords, valueOf, type BooksProps } from './shared.tsx';

const OPERATIONS = ['billed', 'received', 'earned', 'costs', 'margin'] as const;
type Operation = typeof OPERATIONS[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function History(props: BooksProps) {
  const w = useWords(props.language);
  const [operation, setOperation] = useState<Operation>('billed');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState('');
  const [asked, setAsked] = useState<{ operation: Operation; period: { from: string; to: string }; asOf: string } | null>(null);
  const [entity, setEntity] = useState('');
  const [shownEntity, setShownEntity] = useState<string | null>(null);
  const ready = DATE.test(from) && DATE.test(to) && DATE.test(asOf);
  return (
    <BooksPage props={props} sub="history" title={w['title.history']}>
      <form className={s.form} aria-label={w.asKnownForm} onSubmit={(e: FormEvent) => { e.preventDefault(); if (ready) setAsked({ operation, period: { from, to }, asOf }); }}>
        <Choice<Operation> label={w.operation} options={OPERATIONS.map(o => ({ value: o, label: w[`op.${o}`] }))} value={operation} onChange={setOperation} />
        <Field label={w.periodFrom} type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <Field label={w.periodTo} type="date" value={to} onChange={e => setTo(e.target.value)} />
        <Field label={w.knownOn} type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
        <Actions><Button submit disabled={!ready}>{w.show}</Button></Actions>
      </form>
      {asked && <AsKnown props={props} payload={asked} />}
      <form className={s.form} aria-label={w.versionsOf} onSubmit={(e: FormEvent) => { e.preventDefault(); if (entity.trim()) setShownEntity(entity.trim()); }}>
        <Field label={w.entity} value={entity} onChange={e => setEntity(e.target.value)} />
        <Actions><Button submit disabled={!entity.trim()}>{w.showVersions}</Button></Actions>
      </form>
      {shownEntity !== null && <Versions props={props} entityId={shownEntity} />}
    </BooksPage>
  );
}

function AsKnown({ props, payload }: { props: BooksProps; payload: { operation: Operation; period: { from: string; to: string }; asOf: string } }) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'history.asKnownOn', payload, asKnownReply);
  const value = valueOf(loaded);
  return (
    <Section title={fill(w.asKnownTitle, { op: w[`op.${payload.operation}`], from: day(payload.period.from, props.language), to: day(payload.period.to, props.language) })}>
      {loaded.phase === 'refused' && <Refused props={props} code={loaded.code} notBuilt={loaded.state.kind === 'not-built'} retry={reload} />}
      {loaded.phase === 'loading' && !value && <Note>{w.reading}</Note>}
      {value && (
        <div className={s.figures}>
          {([['then', fill(w.knownThen, { when: day(value.then.asOf, props.language) })], ['now', fill(w.knownNow, { when: day(value.now.asOf, props.language) })]] as const).map(([key, title]) => (
            <div key={key} className={s.figureBox} data-figure={key}>
              <span className={s.figureName}>{title}</span>
              <Money value={value[key].value} receiptId={value[key].receiptId} language={props.language} onReceipt={props.openReceipt} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Refused({ props, code, notBuilt, retry }: { props: BooksProps; code: string; notBuilt: boolean; retry?: () => void }) {
  const w = useWords(props.language);
  if (notBuilt) return <Note>{w.notBuilt}</Note>;
  return <span className={s.inline}><Refusal code={code} language={props.language} />{retry && <Button variant="link" onClick={retry}>{w.retry}</Button>}</span>;
}

function Versions({ props, entityId }: { props: BooksProps; entityId: string }) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'history.versions', { entityId }, versionsReply, entityId);
  const value = valueOf(loaded);
  return (
    <Section title={fill(w.versionsTitle, { id: entityId })}>
      {loaded.phase === 'refused' && <Refused props={props} code={loaded.code} notBuilt={loaded.state.kind === 'not-built'} retry={reload} />}
      {value && (value.versions.length === 0 ? <Note>{w['empty.versions']}</Note> : (
        <Table view={props.view} caption={fill(w.versionsTitle, { id: entityId })} columns={[
          { head: w['col.learned'], simple: true }, { head: w['col.change'], simple: true }, { head: w['col.kind'] }, { head: w['col.validFrom'] },
          { head: w['col.amount'], num: true, simple: true }, { head: w['col.source'] }, { head: w['col.superseded'] },
        ]} rows={value.versions.map(v => ({ key: v.factId, cells: [
          dayTime(v.learnedAt, props.language),
          <span data-change={v.change} className={v.change === 'correction' ? s.amber : undefined}>{w[`change.${v.change}`]}</span>,
          v.kind, day(v.validFrom, props.language),
          <span className={v.supersededAt !== null ? s.struck : undefined}><Recorded value={v.amount} language={props.language} /></span>,
          v.sourceId,
          v.supersededAt === null ? w.current : day(v.supersededAt, props.language),
        ] }))} />
      ))}
    </Section>
  );
}

export function Stale(props: BooksProps) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'history.stale', {}, staleReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const rebuild = async (id: string) => { if ((await act.run('history.rebuild', { id }, staleAnswer)).ok) reload(); };
  return (
    <BooksPage props={props} sub="stale" title={w['title.stale']} count={value ? String(value.answers.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.answers.length === 0 ? <Note>{w['empty.stale']}</Note> : (
        <Table view={props.view} caption={w['title.stale']} columns={[
          { head: w['col.answer'], simple: true }, { head: w['col.workedOut'] }, { head: w['col.reason'] }, { head: w['col.rebuilt'], simple: true },
        ]} rows={value.answers.map(a => ({ key: a.id, cells: [
          a.question ?? <span className={s.missing}>{w.noQuestion}</span>,
          <span className={s.inline}><Label kind="stale" />{day(a.workedOutOn, props.language)}</span>,
          a.reason ?? <span className={s.missing}>{w.noReason}</span>,
          <span className={s.inline}>
            {a.rebuilt === null ? w.notRebuilt : a.rebuilt.matches
              ? <span data-result="match">{fill(w.rebuiltMatch, { when: dayTime(a.rebuilt.at, props.language) })}</span>
              : <span data-result="failed" className={s.amber}>{w.rebuildFailed} {w.quick} <Recorded value={a.rebuilt.quick} language={props.language} /> · {w.full} <Recorded value={a.rebuilt.full} language={props.language} /></span>}
            {!props.viewer && (a.rebuilt === null || !a.rebuilt.matches) && <Button onClick={() => { void rebuild(a.id); }} disabled={act.busy}>{w.rebuild}</Button>}
          </span>,
        ] }))} />
      ))}
      <Refusal code={act.refusal} language={props.language} />
    </BooksPage>
  );
}
