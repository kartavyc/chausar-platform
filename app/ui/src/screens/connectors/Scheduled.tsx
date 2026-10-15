/**
 * `#/books/scheduled`: repeating reads. Lists the connections read through a system's own
 * interface with their schedule and freshness, and lets an owner set, change or turn off a
 * schedule (`connectorsx.schedule`). The engine decides what may repeat; its refusals are words.
 */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Button } from '../../parts/Button';
import { useReply } from '../work/kit/reply.ts';
import { dayTime } from '../work/kit/format.ts';
import type { CxKey } from '../../text/lanes/connectors-ext.ts';
import { connection, connectionsReply, freshnessReply, repeatable, systemsReply, type CatchUp, type Connection, type FreshnessRow, type SystemOperation } from './contract.ts';
import { CxPage, Experimental, MonthSquares, Note, Say, Section, Table, approves, styles as s, useCx, useLiveAct, valueOf, type Cx, type CxProps } from './shared.tsx';

const OUTCOMES = new Set(['accepted', 'imported', 'refused', 'abstained', 'failed', 'daily-read-budget', 'deferred-tick-budget', 'missed-slot-skipped', 'source-not-allowed']);
/** The engine's last outcome (`accepted`, `refused:CODE`, `daily-read-budget` ...) in words, with its code as written. */
function outcomeWords(outcome: string | null, cx: Cx) {
  if (outcome === null) return null;
  const [head = '', detail] = outcome.split(':', 2);
  const said = OUTCOMES.has(head) ? cx(`CX.outcome.${head}` as CxKey) : null;
  if (said === null) return <span className="fig">{outcome}</span>;
  return <>{said}{detail ? <> · <span className="fig">{detail}</span></> : null}</>;
}

function scheduleLine(schedule: NonNullable<Connection['schedule']>, label: string, cx: Cx) {
  return schedule.everyHours === 1 ? cx('CX.sched.everyHour', { what: label }) : cx('CX.sched.every', { n: schedule.everyHours, what: label });
}

export function Scheduled(props: CxProps) {
  const cx = useCx(props.language);
  const conns = useReply(props, 'connectorsx.connections', {}, connectionsReply);
  const fresh = useReply(props, 'connectorsx.freshness', {}, freshnessReply);
  const systems = useReply(props, 'connectorsx.systems', {}, systemsReply);
  const act = useLiveAct(props);
  const [editing, setEditing] = useState<string | null>(null);
  const [said, setSaid] = useState<CxKey | null>(null);
  const all = valueOf(conns.loaded);
  const rows = all?.filter(c => c.road === 'interface') ?? [];
  const freshness = valueOf(fresh.loaded);
  const catalogue = valueOf(systems.loaded);
  const freshOf = (c: Connection): FreshnessRow | undefined => freshness?.find(f => f.sourceId === c.sourceId);
  const opsOf = (c: Connection): readonly SystemOperation[] => catalogue ? repeatable(catalogue, c.group) : [];
  const labelOf = (c: Connection, operation: string) => catalogue?.groups.find(g => g.id === c.group)?.operations.find(o => o.id === operation)?.label ?? operation;
  const reload = () => { conns.reload(); fresh.reload(); };
  const off = async (c: Connection) => {
    setSaid(null);
    const outcome = await act.run('connectorsx.schedule', { connectionId: c.id, schedule: null }, connection);
    if (outcome?.ok) { setSaid('CX.sched.turnedOff'); setEditing(null); reload(); }
  };
  const changing = rows.find(c => c.id === editing) ?? null;
  return (
    <CxPage props={props} sub="scheduled" title={cx('CX.sched.title')} count={all ? String(rows.length) : undefined} loads={[conns.loaded]} reload={conns.reload}>
      <Section title={cx('CX.sched.title')} label={cx('CX.sched.when')}>
        <Note>{cx('CX.sched.when')}</Note>
        <Note>{cx('CX.sched.budget')}</Note>
        {props.view !== 'simple' && <Note>{cx('CX.sched.onlyTotals')}</Note>}
        {!props.viewer && !approves(props) && <Note>{cx('CX.sched.ownerOnly')}</Note>}
        <Experimental cx={cx} />
      </Section>
      {fresh.loaded.phase === 'refused' && <Say code={fresh.loaded.code} cx={cx} what={cx('CX.col.freshness')} />}
      {all && (rows.length === 0 ? <Note>{cx('CX.sched.empty')}</Note> : (
        <Table view={props.view} caption={cx('CX.sched.title')} columns={[
          { head: cx('CX.col.connection'), simple: true }, { head: cx('CX.col.schedule'), simple: true }, { head: cx('CX.col.lastRead'), simple: true },
          { head: cx('CX.col.freshness'), simple: true }, { head: cx('CX.col.lastRun') }, { head: cx('CX.col.months') },
          ...(approves(props) ? [{ head: cx('CX.col.do'), simple: true }] : []),
        ]} rows={rows.map(c => {
          const f = freshOf(c);
          const schedule = c.schedule ?? null;
          return { key: c.id, cells: [
            <span className={s.inline}>{c.label}{props.view !== 'simple' && <span className={s.note}>{c.company}</span>}{c.status === 'paused' && <span className={s.note}>{cx('CX.paused')}</span>}</span>,
            schedule === null ? <span className={s.missing}>{cx('CX.sched.none')}</span> : (
              <span className={s.stack}>
                <span>{scheduleLine(schedule, labelOf(c, schedule.operation), cx)}</span>
                {props.view !== 'simple' && <span className={s.note}>{cx('CX.sched.targetLine', { n: schedule.freshnessTargetHours })} · {cx(`CX.catch.${schedule.catchUp}`)}{schedule.autoImport ? ` · ${cx('CX.sched.autoLine')}` : ''}</span>}
              </span>
            ),
            f === undefined ? <span className={s.missing}>{cx('CX.notKnown')}</span> : f.lastRead ? dayTime(f.lastRead, props.language) : <span className={s.missing}>{cx('CX.run.never')}</span>,
            f === undefined || f.stale === null ? <span className={s.missing}>{cx('CX.fresh.none')}</span> : f.stale ? <span className={s.amber}>{cx('CX.fresh.stale')}</span> : cx('CX.fresh.ok'),
            schedule?.lastRunAt ? <span>{dayTime(schedule.lastRunAt, props.language)} · {outcomeWords(schedule.lastOutcome, cx)}</span> : <span className={s.missing}>{cx('CX.run.never')}</span>,
            f ? <MonthSquares months={f.months} language={props.language} /> : <span className={s.missing}>{cx('CX.notKnown')}</span>,
            ...(approves(props) ? [
              <span className={s.actions}>
                <Button onClick={() => { setSaid(null); setEditing(c.id); }} disabled={act.busy}>{schedule ? cx('CX.sched.change') : cx('CX.sched.set')}</Button>
                {schedule && <Button variant="link" onClick={() => { void off(c); }} disabled={act.busy}>{cx('CX.sched.off')}</Button>}
              </span>,
            ] : []),
          ] };
        })} />
      ))}
      {said && <p role="status">{cx(said)}</p>}
      <Say code={act.refusal} cx={cx} />
      {changing && approves(props) && (
        <ScheduleForm key={changing.id} props={props} conn={changing} ops={opsOf(changing)} label={op => labelOf(changing, op)} catalogueCode={systems.loaded.phase === 'refused' ? systems.loaded.code : null}
          onSaved={() => { setSaid('CX.sched.saved'); setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      )}
    </CxPage>
  );
}

const MAX_HOURS = 744;
const hoursOf = (text: string): number | null => /^\d{1,4}$/.test(text.trim()) ? parseInt(text.trim(), 10) : null;

function ScheduleForm({ props, conn, ops, label, catalogueCode, onSaved, onCancel }: {
  props: CxProps; conn: Connection; ops: readonly SystemOperation[]; label: (op: string) => string; catalogueCode: string | null; onSaved: () => void; onCancel: () => void;
}) {
  const cx = useCx(props.language);
  const act = useLiveAct(props);
  const current = conn.schedule ?? null;
  const options = [...ops.map(o => ({ value: o.id, label: o.label })), ...(current && !ops.some(o => o.id === current.operation) ? [{ value: current.operation, label: label(current.operation) }] : [])];
  const [operation, setOperation] = useState<string>(current?.operation ?? options[0]?.value ?? '');
  const [every, setEvery] = useState(String(current?.everyHours ?? 6));
  const [target, setTarget] = useState(String(current?.freshnessTargetHours ?? 24));
  const [catchUp, setCatchUp] = useState<CatchUp>(current?.catchUp ?? 'run-once');
  const [auto, setAuto] = useState<'yes' | 'no'>(current?.autoImport ? 'yes' : 'no');
  const everyHours = hoursOf(every), targetHours = hoursOf(target);
  const hoursOk = everyHours !== null && targetHours !== null && everyHours >= 1 && everyHours <= MAX_HOURS && targetHours >= everyHours && targetHours <= MAX_HOURS * 2;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!operation || !hoursOk) return;
    const outcome = await act.run('connectorsx.schedule', {
      connectionId: conn.id,
      schedule: { operation, everyHours, freshnessTargetHours: targetHours, catchUp, autoImport: auto === 'yes' },
    }, connection);
    if (outcome?.ok) onSaved();
  };
  const title = cx('CX.sched.formTitle', { name: conn.label });
  return (
    <Section title={title}>
      {options.length === 0 ? (
        <div className={s.stack}>
          {catalogueCode !== null ? <Say code={catalogueCode} cx={cx} /> : <Note>{cx('CX.sched.noRepeatable')}</Note>}
          <div className={s.actions}><Button variant="link" onClick={onCancel}>{cx('CX.sched.cancel')}</Button></div>
        </div>
      ) : (
        <form className={s.form} aria-label={title} onSubmit={event => { void submit(event); }}>
          <Choice<string> label={cx('CX.sched.what')} options={options} value={operation} onChange={setOperation} />
          <div className={s.split}>
            <Field label={cx('CX.sched.everyHours')} inputMode="numeric" value={every} onChange={e => setEvery(e.target.value)} problem={hoursOk ? undefined : cx('CX.sched.hoursHelp')} />
            <Field label={cx('CX.sched.target')} inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)} />
          </div>
          <Choice<CatchUp> label={cx('CX.sched.catchUp')} options={(['run-once', 'skip'] as const).map(v => ({ value: v, label: cx(`CX.catch.${v}`) }))} value={catchUp} onChange={setCatchUp} />
          <Choice<'yes' | 'no'> label={cx('CX.sched.auto')} options={[{ value: 'no', label: cx('CX.no') }, { value: 'yes', label: cx('CX.yes') }]} value={auto} onChange={setAuto} />
          <Note>{cx('CX.sched.budget')}</Note>
          <div className={s.actions}>
            <Button submit variant="filled" disabled={act.busy || !operation || !hoursOk}>{cx('CX.sched.save')}</Button>
            <Button variant="link" onClick={onCancel}>{cx('CX.sched.cancel')}</Button>
          </div>
          <Say code={act.refusal} cx={cx} />
        </form>
      )}
    </Section>
  );
}
