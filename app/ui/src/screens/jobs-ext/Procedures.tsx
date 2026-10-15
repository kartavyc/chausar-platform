/**
 * Procedures (work/procedures): the owner's procedures learned from a job's agent runs, with
 * their state, version, routed share and the cost of routed and fallback cases. A ready-made
 * job can propose a new one (procedures.propose). A procedure opens to its typed steps and its
 * runs; a proposed one is approved with the exact digest shown (procedures.approve) or rejected
 * with a reason, an approved one can be retired. A viewer seat draws no changing control.
 */
import { useCallback, useState } from 'react';
import type { Language, Mark, RowItem } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Sheet, type SheetPrimary } from '../../parts/Sheet';
import { RowList } from '../../parts/RowList';
import { KeyValue } from '../../parts/KeyValue';
import { Button } from '../../parts/Button';
import { procedure, procedureDetail, procedureList, readyMadeList, REJECT_REASONS, type CaseValue, type ListedProcedure, type ProcedureRun, type ProcedureStats,
  type ProcedureStep, type ReadyMade, type RejectReason, type RuleBucket } from './contract.ts';
import { useAct, useReply } from './reply.ts';
import { Frame, Note, Part, Refusal, day, loadedState, percent, rupees, useHost, useSay, type Say } from './shared.tsx';
import type { JobsxKey } from '../../text/lanes/jobs-ext.ts';
import s from './jobs-ext.module.css';

const MARK: Readonly<Record<ListedProcedure['status'], Mark>> = { proposed: 'wait', approved: 'busy', rejected: 'off', retired: 'off' };

export function shareText(stats: ProcedureStats, say: Say): string {
  return say('jobsx.proc.share', { routed: stats.routedShare.routed, total: stats.routedShare.total });
}
export function costText(stats: ProcedureStats, say: Say): string {
  return say('jobsx.proc.cost', { routed: rupees(stats.routedCostMinor), fallback: rupees(stats.fallbackCostMinor) });
}

function valueText(value: CaseValue, say: Say): string {
  if (value === null) return say('jobsx.value.empty');
  if (typeof value === 'boolean') return say(value ? 'jobsx.value.yes' : 'jobsx.value.no');
  return String(value);
}
export function bucketText(feature: string, b: RuleBucket, say: Say): string {
  const common = { feature, option: b.option, confidence: percent(b.confidence), support: b.support };
  return b.when.equals !== undefined || b.when.min === undefined || b.when.max === undefined
    ? say('jobsx.bucket.equals', { ...common, value: valueText(b.when.equals ?? null, say) })
    : say('jobsx.bucket.range', { ...common, min: String(b.when.min), max: String(b.when.max) });
}

function StepItem({ step, say, simple }: { step: ProcedureStep; say: Say; simple: boolean }) {
  const kind = say(`jobsx.step.${step.kind}` as JobsxKey);
  let note: string;
  switch (step.kind) {
    case 'calculate': note = say('jobsx.step.calculate.note', { operation: step.operation }); break;
    case 'action': note = say('jobsx.step.action.note'); break;
    case 'lookup': note = say('jobsx.step.lookup.note'); break;
    case 'question': note = say('jobsx.step.question.note', { feature: step.rule.feature, threshold: percent(step.rule.threshold) }); break;
  }
  return (
    <li className={s.item} data-step-kind={step.kind}>
      <div>
        <span>{step.title}</span>
        <p className={s.meta}>{`${kind} · ${note}`}</p>
        {step.kind === 'question' && (
          <>
            <p className={s.meta}>{say('jobsx.step.options', { options: step.options.join(', ') })}</p>
            {!simple && step.rule.buckets.length > 0 && (
              <ul className={s.sublist} data-rule-buckets="">
                {step.rule.buckets.map((b, i) => <li key={i} className={s.meta}>{bucketText(step.rule.feature, b, say)}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function RunItem({ run, say, language }: { run: ProcedureRun; say: Say; language: Language }) {
  const parts = [day(run.at, language), say(`jobsx.route.${run.route}` as JobsxKey), rupees(run.costMinor), say(`jobsx.outcome.${run.outcome}` as JobsxKey),
    run.decision === undefined ? null : say('jobsx.run.decision', { decision: run.decision })];
  return (
    <li className={s.item} data-run={run.id}>
      <div>
        <span className={s.fig}>{run.caseId}</span>
        <p className={s.meta}>{parts.filter((x): x is string => x !== null).join(' · ')}</p>
        {run.note !== undefined && <p className={s.quote}>{say('jobsx.run.note', { note: run.note })}</p>}
      </div>
    </li>
  );
}

function decidedText(item: { status: ListedProcedure['status']; reason?: string | undefined }, say: Say): string | null {
  if (item.reason === undefined) return null;
  if (item.reason === 'superseded') return say('jobsx.proc.decided.superseded');
  if (item.reason === 'retired') return say('jobsx.proc.decided.retired');
  if ((REJECT_REASONS as readonly string[]).includes(item.reason)) return say('jobsx.proc.decided.reason', { reason: say(`jobsx.reason.${item.reason}` as JobsxKey) });
  return null;
}

function ProcedureSheet({ p, id, title, origin, canChange, onClose, onChanged }: {
  p: PlaceRenderProps & { host: ReturnType<typeof useHost> }; id: string; title: string; origin: HTMLElement | null; canChange: boolean; onClose: () => void; onChanged: () => void;
}) {
  const say = useSay();
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'procedures.get', { id }, procedureDetail, String(tick));
  const act = useAct(p.rpc);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>('wrong-steps');
  const [said, setSaid] = useState<string | null>(null);
  const kind = say('jobsx.proc.kind');
  if (loaded.phase !== 'ready' && !(loaded.phase === 'loading' && loaded.last !== undefined)) {
    return (
      <Sheet kind={kind} title={title} onClose={onClose} origin={origin}>
        <Part loaded={loaded} reload={reload} say={say}>{() => null}</Part>
      </Sheet>
    );
  }
  const d = loaded.phase === 'ready' ? loaded.value : loaded.last!;
  const item = d.procedure;
  const change = async (method: string, payload: Record<string, unknown>, done: JobsxKey) => {
    setSaid(null);
    const out = await act.run(method, payload, procedure);
    if (out.ok) { setSaid(say(done)); setRejecting(false); onChanged(); }
    // A changed card is read again so the person sees what they would approve now.
    setTick(n => n + 1);
  };
  const primary: SheetPrimary | undefined = canChange && item.status === 'proposed'
    ? { label: say('jobsx.approve'), onPress: () => void change('procedures.approve', { id: item.id, digest: item.digest }, 'jobsx.done.approved'), disabled: act.busy }
    : undefined;
  const decided = decidedText(item, say);
  return (
    <Sheet kind={kind} title={`${title} · ${say('jobsx.proc.version', { n: item.version })}`} onClose={onClose} origin={origin} primary={primary}
      actions={canChange ? <>
        {item.status === 'proposed' && !rejecting && <Button variant="quiet" disabled={act.busy} onClick={() => setRejecting(true)}>{say('jobsx.reject')}</Button>}
        {item.status === 'approved' && <Button variant="quiet" danger disabled={act.busy} onClick={() => void change('procedures.retire', { id: item.id }, 'jobsx.done.retired')}>{say('jobsx.retire')}</Button>}
      </> : undefined}>
      <KeyValue onReceipt={p.openReceipt} pairs={[
        { name: say('jobsx.proc.col.status'), value: say(`jobsx.proc.status.${item.status}` as JobsxKey) },
        { name: say('jobsx.proc.col.share'), value: shareText(d.stats, say) },
        ...(p.view === 'simple' ? [] : [
          { name: say('jobsx.proc.col.routedCost'), value: rupees(d.stats.routedCostMinor), mono: true },
          { name: say('jobsx.proc.col.fallbackCost'), value: rupees(d.stats.fallbackCostMinor), mono: true },
        ]),
      ]} />
      {decided !== null && <Note>{decided}</Note>}
      {item.status === 'proposed' && (
        <div className={s.block} data-approve-digest="">
          <p className={s.digest}>{say('jobsx.approve.digest', { digest: item.digest })}</p>
          <Note>{say('jobsx.approve.note')}</Note>
        </div>
      )}
      {item.status === 'approved' && canChange && <Note>{say('jobsx.retire.note')}</Note>}
      {rejecting && canChange && (
        <form className={s.block} onSubmit={event => { event.preventDefault(); void change('procedures.reject', { id: item.id, reason }, 'jobsx.done.rejected'); }}>
          <fieldset className={s.form}>
            <legend className={s.legend}>{say('jobsx.reject.legend')}</legend>
            {REJECT_REASONS.map(r => (
              <label key={r}><input type="radio" name="reject-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />{say(`jobsx.reason.${r}` as JobsxKey)}</label>
            ))}
          </fieldset>
          <div className={s.actions}><Button submit variant="quiet" danger disabled={act.busy}>{say('jobsx.reject.confirm')}</Button></div>
        </form>
      )}
      <div className={s.block}>
        <h3 className={s.h}>{say('jobsx.steps.title')}</h3>
        <ol className={s.list} data-procedure-steps="">{item.steps.map((st, i) => <StepItem key={`${i}-${st.kind}`} step={st} say={say} simple={p.view === 'simple'} />)}</ol>
      </div>
      <div className={s.block}>
        <h3 className={s.h}>{say('jobsx.runs.title')}</h3>
        {d.runs.length === 0 ? <Note>{say('jobsx.runs.empty')}</Note> : <ol className={s.list}>{d.runs.map(r => <RunItem key={r.id} run={r} say={say} language={p.language} />)}</ol>}
      </div>
      {said !== null && <p role="status">{said}</p>}
      <Refusal code={act.refusal} say={say} />
    </Sheet>
  );
}

function unavailableKey(t: ReadyMade): JobsxKey {
  switch (t.code) {
    case 'DICTIONARY_REQUIRED': case 'TEMPLATE_CALCULATION_MISSING': case 'TEMPLATE_NOT_BUILT': case 'AGENT_ROUTE_REQUIRED': return `jobsx.unavailable.${t.code}`;
    default: return 'jobsx.unavailable.other';
  }
}

function ProposeSection({ p, types: { loaded, reload }, canChange, onProposed }: {
  p: PlaceRenderProps; types: ReturnType<typeof useReply<ReturnType<typeof readyMadeList>>>; canChange: boolean; onProposed: (id: string) => void;
}) {
  const say = useSay();
  const act = useAct(p.rpc);
  const [said, setSaid] = useState<string | null>(null);
  const propose = async (template: string) => {
    setSaid(null);
    const out = await act.run('procedures.propose', { template }, procedure);
    if (out.ok) { setSaid(say('jobsx.propose.done')); onProposed(out.value.id); }
  };
  return (
    <section className={s.section} data-propose="">
      <h2 className={s.h}>{say('jobsx.propose.title')}</h2>
      <Note>{say('jobsx.propose.note')}</Note>
      <Part loaded={loaded} reload={reload} say={say}>
        {types => types.templates.length === 0 ? <Note>{say('jobsx.propose.none')}</Note> : (
          <ul className={s.list}>
            {types.templates.map(t => (
              <li key={t.id} className={s.item} data-template={t.id}>
                <div>
                  <span>{t.title}</span>
                  {(t.experimental === true || !t.available) && (
                    <p className={s.meta}>{[t.experimental === true ? say('jobsx.propose.experimental') : null, t.available ? null : say(unavailableKey(t))].filter((x): x is string => x !== null).join(' · ')}</p>
                  )}
                </div>
                {canChange && t.available && <Button variant="quiet" disabled={act.busy} aria-label={`${say('jobsx.propose.button')}: ${t.title}`} onClick={() => void propose(t.id)}>{say('jobsx.propose.button')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Part>
      {said !== null && <p role="status">{said}</p>}
      <Refusal code={act.refusal} say={say} />
    </section>
  );
}

export function ProceduresPage({ props }: { props: PlaceRenderProps }) {
  const say = useSay();
  const host = useHost(props, 'procedures');
  const p = { ...props, host };
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(host, 'procedures.list', {}, procedureList, String(tick));
  const types = useReply(host, 'jobsx.types', {}, readyMadeList);
  const titles = types.loaded;
  const [open, setOpen] = useState<{ id: string; origin: HTMLElement | null } | null>(null);
  const canChange = !props.viewer;
  // Approving, rejecting and retiring need an approving seat; proposing needs only a preparing one.
  const canApprove = canChange && ['owner', 'cofounder'].includes(props.member.role);
  const close = useCallback(() => setOpen(null), []);
  const titleOf = (template: string) => (titles.phase === 'ready' ? titles.value.templates.find(t => t.id === template)?.title : undefined) ?? template;
  const value = loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
  const state = value === undefined ? loadedState(loaded) : null;
  const items = value?.procedures ?? [];
  const toRow = (item: ListedProcedure): RowItem => {
    const parts = props.view === 'simple'
      ? [say(`jobsx.proc.status.${item.status}` as JobsxKey), shareText(item.stats, say)]
      : [say(`jobsx.proc.status.${item.status}` as JobsxKey), say('jobsx.proc.version', { n: item.version }), shareText(item.stats, say)];
    return { id: item.id, mark: MARK[item.status], what: titleOf(item.template), note: parts.join(' · '), ...(props.view === 'simple' ? {} : { asWritten: costText(item.stats, say) }) };
  };
  const openItem = items.find(item => item.id === open?.id);
  return (
    <Frame where={say('jobsx.where.procedures')} title={say('jobsx.proc.title')} count={value === undefined ? undefined : String(items.length)} state={state} onRetry={reload} say={say}>
      <div className={s.split} data-open={open !== null ? '' : undefined}>
        <div className={s.pane}>
          <Note>{say('jobsx.proc.intro')}</Note>
          {props.viewer && <Note>{say('jobsx.readOnly')}</Note>}
          {items.length === 0 && <Note>{say('jobsx.proc.empty')}</Note>}
          {items.length > 0 && props.view === 'books' && (
            <table className={s.table} data-procedures-table="">
              <thead><tr>{(['jobsx.proc.col.procedure', 'jobsx.proc.col.status', 'jobsx.proc.col.share', 'jobsx.proc.col.routedCost', 'jobsx.proc.col.fallbackCost'] as const).map(k => <th key={k} scope="col">{say(k)}</th>)}</tr></thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td><button type="button" className={s.open} onClick={e => setOpen({ id: item.id, origin: e.currentTarget })}>{`${titleOf(item.template)} · ${say('jobsx.proc.version', { n: item.version })}`}</button></td>
                    <td>{say(`jobsx.proc.status.${item.status}` as JobsxKey)}</td>
                    <td className={s.num}>{`${item.stats.routedShare.routed}/${item.stats.routedShare.total}`}</td>
                    <td className={s.num}>{rupees(item.stats.routedCostMinor)}</td>
                    <td className={s.num}>{rupees(item.stats.fallbackCostMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length > 0 && props.view !== 'books' && (
            <div data-procedure-list=""><RowList rows={items.map(toRow)} selectedId={open?.id} onOpen={(id, el) => setOpen({ id, origin: el })} onReceipt={props.openReceipt} /></div>
          )}
          <ProposeSection p={props} types={types} canChange={canChange} onProposed={id => { setTick(n => n + 1); setOpen({ id, origin: null }); }} />
        </div>
        {open !== null && (
          <ProcedureSheet key={open.id} p={p} id={open.id} title={openItem === undefined ? say('jobsx.proc.kind') : titleOf(openItem.template)} origin={open.origin}
            canChange={canApprove} onClose={close} onChanged={() => setTick(n => n + 1)} />
        )}
      </div>
    </Frame>
  );
}
