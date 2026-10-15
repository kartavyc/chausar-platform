/**
 * Job controls (work/job-controls): for the owner's jobs run by job extensions (jobsx.list,
 * rows with laneRun), the budget meters (jobsx.budget), the stop rules with the failed-run
 * limit to edit (jobsx.stopRules, jobsx.setStopRules) and the ready-made card as a SKILL.md
 * file (jobsx.templateSkill), copied or saved on this computer only. "Find repeating work"
 * runs jobsx.detect and lists the proposals waiting (jobsx.proposals). Missed-run notes
 * (jobsx.missed) can be marked as read (jobsx.missed.seen). A viewer seat changes nothing.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Language, Mark, RowItem } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Sheet } from '../../parts/Sheet';
import { RowList } from '../../parts/RowList';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { Button } from '../../parts/Button';
import { budget as budgetCheck, failureLimit, laneJobList, missedList, missedSeen, proposalList, skillFile, stopRules as stopRulesCheck,
  type Budget, type LaneJobRow, type MissedNote, type ModelMeter, type SkillFile, type StopRule, type StopRules } from './contract.ts';
import { useAct, useReply, type ReplyHost } from './reply.ts';
import { Frame, Note, Part, Refusal, day, loadedState, rupees, useHost, useSay, type Say } from './shared.tsx';
import type { JobsxKey } from '../../text/lanes/jobs-ext.ts';
import s from './jobs-ext.module.css';

const KNOWN_STATES = new Set(['scheduled', 'running', 'paused', 'set-aside', 'waiting-for-you', 'result-waiting', 'awaiting-acceptance', 'stopped-by-rule',
  'waiting-network', 'waiting', 'accepted', 'cancelled', 'stopped']);
export function stateText(state: string, say: Say): string {
  return KNOWN_STATES.has(state) ? say(`jobsx.job.state.${state}` as JobsxKey) : say('jobsx.job.state.other', { code: state });
}
const markOf = (state: string): Mark => state === 'running' ? 'busy' : state === 'waiting-for-you' || state === 'result-waiting' || state === 'awaiting-acceptance' ? 'wait'
  : state === 'set-aside' || state === 'stopped-by-rule' ? 'unsure' : 'off';

const MINUTE_MS = 60_000;
/** Clock time in whole minutes, rounded down. A duration, never money. */
export function clockText(clockMs: number, say: Say): string {
  const minutes = Math.floor(clockMs / MINUTE_MS);
  return minutes < 1 ? say('jobsx.budget.underMinute') : say('jobsx.budget.minutes', { n: minutes });
}
export function meterText(m: ModelMeter, say: Say): string {
  if (m.basis === 'zero') return say('jobsx.budget.route.zero', { route: m.routeId, minutes: m.minutes });
  return say(m.basis === 'estimate' ? 'jobsx.budget.route.estimate' : 'jobsx.budget.route.measured', { route: m.routeId, cost: rupees(m.costMinor), steps: m.steps });
}
/** Money spent, reserved and left, as exact rupees from the engine's paise. */
export function budgetPairs(b: Budget, say: Say): Pair[] {
  return [
    { name: say('jobsx.budget.total'), value: rupees(b.budgetMinor), mono: true },
    { name: say('jobsx.budget.spent'), value: rupees(b.spentMinor), mono: true },
    { name: say('jobsx.budget.reserved'), value: rupees(b.reservedMinor), mono: true },
    { name: say('jobsx.budget.left'), value: rupees(b.remainingMinor), mono: true },
  ];
}
export function ruleText(r: StopRule, say: Say, language: Language): string {
  switch (r.rule) {
    case 'runs': return say('jobsx.stop.runs', { limit: r.limit ?? 0, used: r.used ?? 0 });
    case 'deadline': return r.at === undefined ? say('jobsx.stop.other', { rule: r.rule }) : say('jobsx.stop.deadline', { date: day(r.at, language) });
    case 'budget': return say('jobsx.stop.budget');
    case 'failures': return say('jobsx.stop.failures', { limit: r.limit ?? 0, count: r.count ?? 0 });
    case 'goal': return r.text === undefined ? say('jobsx.stop.other', { rule: r.rule }) : say('jobsx.stop.goal', { text: r.text });
    default: return say('jobsx.stop.other', { rule: r.rule });
  }
}

function BudgetBlock({ host, id, say, simple }: { host: ReplyHost; id: string; say: Say; simple: boolean }) {
  const { loaded, reload } = useReply(host, 'jobsx.budget', { id }, budgetCheck);
  return (
    <div className={s.block} data-budget="">
      <h3 className={s.h}>{say('jobsx.budget.title')}</h3>
      <Part loaded={loaded} reload={reload} say={say}>
        {b => (
          <>
            <KeyValue pairs={budgetPairs(b, say)} onReceipt={() => {}} />
            {!simple && (
              <KeyValue onReceipt={() => {}} pairs={[
                { name: say('jobsx.budget.clock'), value: clockText(b.meters.clockMs, say), mono: true },
                { name: say('jobsx.budget.exposure'), value: b.meters.exposureMinor === '0' ? say('jobsx.budget.exposure.none') : rupees(b.meters.exposureMinor) },
              ]} />
            )}
            <p className={s.meta}>{say('jobsx.budget.model')}</p>
            {b.meters.model.length === 0 ? <Note>{say('jobsx.budget.noModel')}</Note>
              : <ul className={s.sublist} data-model-meters="">{b.meters.model.map(m => <li key={m.routeId} className={s.fig}>{meterText(m, say)}</li>)}</ul>}
          </>
        )}
      </Part>
    </div>
  );
}

function StopBlock({ host, rpc, id, say, language, canChange }: { host: ReplyHost; rpc: PlaceRenderProps['rpc']; id: string; say: Say; language: Language; canChange: boolean }) {
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(host, 'jobsx.stopRules', { id }, stopRulesCheck, String(tick));
  const act = useAct(rpc);
  const [draft, setDraft] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (event: FormEvent, current: StopRules) => {
    event.preventDefault();
    setSaid(null); setProblem(null); act.clear();
    const typed = (draft ?? String(failureLimit(current) ?? '')).trim();
    const failures = /^\d{1,2}$/.test(typed) ? Number(typed) : 0;
    if (failures < 1 || failures > 10) { setProblem('INVALID_STOP_RULE'); return; }
    const out = await act.run('jobsx.setStopRules', { id, failures }, stopRulesCheck);
    if (out.ok) { setSaid(say('jobsx.stop.edit.done')); setDraft(null); setTick(n => n + 1); }
  };
  return (
    <div className={s.block} data-stop-rules="">
      <h3 className={s.h}>{say('jobsx.stop.title')}</h3>
      <Part loaded={loaded} reload={reload} say={say}>
        {rules => (
          <>
            <ul className={s.list}>
              {rules.rules.map(r => (
                <li key={r.rule} className={s.item} data-rule={r.rule}><span>{ruleText(r, say, language)}</span>{r.met && <span className={s.meta}>{say('jobsx.stop.met')}</span>}</li>
              ))}
            </ul>
            {rules.stoppedBy !== null && <Note>{say('jobsx.stop.stoppedBy', { date: day(rules.stoppedBy.at, language) })}</Note>}
            {rules.setAside !== null && <Note>{say('jobsx.stop.setAside', { date: day(rules.setAside.at, language) })}</Note>}
            {canChange && (
              <form className={s.form} noValidate aria-label={say('jobsx.stop.title')} onSubmit={event => void save(event, rules)}>
                <label className={s.field}>{say('jobsx.stop.edit.label')}
                  <input type="number" min={1} max={10} step={1} inputMode="numeric" value={draft ?? String(failureLimit(rules) ?? '')} onChange={e => setDraft(e.currentTarget.value)} />
                </label>
                <div className={s.actions}><Button submit variant="quiet" disabled={act.busy}>{say('jobsx.stop.edit.save')}</Button></div>
              </form>
            )}
          </>
        )}
      </Part>
      {said !== null && <p role="status">{said}</p>}
      <Refusal code={problem ?? act.refusal} say={say} />
    </div>
  );
}

function SkillBlock({ rpc, template, say }: { rpc: PlaceRenderProps['rpc']; template: string | null; say: Say }) {
  const act = useAct(rpc);
  const [file, setFile] = useState<SkillFile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => { if (link !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(link.url); }, [link]);
  if (template === null) return <div className={s.block}><h3 className={s.h}>{say('jobsx.skill.title')}</h3><Note>{say('jobsx.skill.none')}</Note></div>;
  const show = async () => { const out = await act.run('jobsx.templateSkill', { id: template }, skillFile); if (out.ok) setFile(out.value); };
  const copy = async (content: string) => {
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('unavailable');
      await navigator.clipboard.writeText(content); setCopied(say('jobsx.skill.copied'));
    } catch { setCopied(say('jobsx.skill.copyFailed')); }
  };
  const save = (f: SkillFile) => {
    if (typeof URL.createObjectURL !== 'function') { setCopied(say('jobsx.skill.copyFailed')); return; }
    setLink({ url: URL.createObjectURL(new Blob([f.content], { type: 'text/markdown;charset=utf-8' })), name: 'SKILL.md' });
  };
  return (
    <div className={s.block} data-skill="">
      <h3 className={s.h}>{say('jobsx.skill.title')}</h3>
      <Note>{say('jobsx.skill.note')}</Note>
      {file === null ? <div className={s.actions}><Button variant="quiet" disabled={act.busy} onClick={() => void show()}>{say('jobsx.skill.show')}</Button></div> : (
        <>
          <p className={s.meta}>{say('jobsx.skill.path', { path: file.path })}</p>
          <pre className={s.skill} data-skill-content="" tabIndex={0}>{file.content}</pre>
          <div className={s.actions}>
            <Button variant="quiet" onClick={() => void copy(file.content)}>{say('jobsx.skill.copy')}</Button>
            <Button variant="quiet" onClick={() => save(file)}>{say('jobsx.skill.save')}</Button>
            {link !== null && <a href={link.url} download={link.name} data-skill-download="">{say('jobsx.skill.saved', { name: link.name })}</a>}
          </div>
          {copied !== null && <p role="status" className={s.meta}>{copied}</p>}
        </>
      )}
      <Refusal code={act.refusal} say={say} />
    </div>
  );
}

function JobSheet({ p, host, job, origin, canChange, onClose }: { p: PlaceRenderProps; host: ReplyHost; job: LaneJobRow; origin: HTMLElement | null; canChange: boolean; onClose: () => void }) {
  const say = useSay();
  return (
    <Sheet kind={say('jobsx.ctl.kind')} title={job.title} onClose={onClose} origin={origin}>
      <p className={s.meta}>{stateText(job.state, say)}</p>
      <BudgetBlock host={host} id={job.id} say={say} simple={p.view === 'simple'} />
      <StopBlock host={host} rpc={p.rpc} id={job.id} say={say} language={p.language} canChange={canChange} />
      <SkillBlock rpc={p.rpc} template={job.template} say={say} />
    </Sheet>
  );
}

function DetectSection({ p, host, canChange }: { p: PlaceRenderProps; host: ReplyHost; canChange: boolean }) {
  const say = useSay();
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(host, 'jobsx.proposals', {}, proposalList, String(tick));
  const act = useAct(p.rpc);
  const [said, setSaid] = useState<string | null>(null);
  const detect = async () => {
    setSaid(null);
    const out = await act.run('jobsx.detect', {}, proposalList);
    if (out.ok) { setSaid(say('jobsx.detect.found', { n: out.value.length })); setTick(n => n + 1); }
  };
  return (
    <section className={s.section} data-detect="">
      <h2 className={s.h}>{say('jobsx.detect.title')}</h2>
      <Note>{say('jobsx.detect.note')}</Note>
      {canChange && <div className={s.actions}><Button variant="quiet" disabled={act.busy} onClick={() => void detect()}>{say('jobsx.detect.button')}</Button></div>}
      {said !== null && <p role="status">{said}</p>}
      <Refusal code={act.refusal} say={say} />
      <h3 className={s.h}>{say('jobsx.proposals.title')}</h3>
      <Part loaded={loaded} reload={reload} say={say}>
        {items => items.length === 0 ? <Note>{say('jobsx.proposals.empty')}</Note> : (
          <>
            <ul className={s.list}>
              {items.map(item => (
                <li key={item.id} className={s.item} data-proposal={item.id}>
                  <div><span>{item.card.title}</span><p className={s.meta}>{[say(`jobsx.origin.${item.origin}` as JobsxKey), ...item.evidence].join(' · ')}</p></div>
                </li>
              ))}
            </ul>
            <div className={s.actions}><Button variant="link" onClick={() => p.navigate({ place: 'work', sub: 'approvals' })}>{say('jobsx.proposals.review')}</Button></div>
          </>
        )}
      </Part>
    </section>
  );
}

const MISSED_RULES = new Set(['skip', 'once', 'all']);
function MissedSection({ p, host, canChange, titleOf }: { p: PlaceRenderProps; host: ReplyHost; canChange: boolean; titleOf: (jobId: string) => string | null }) {
  const say = useSay();
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(host, 'jobsx.missed', {}, missedList, String(tick));
  const act = useAct(p.rpc);
  const [said, setSaid] = useState<string | null>(null);
  const markRead = async (notes: readonly MissedNote[]) => {
    setSaid(null);
    const out = await act.run('jobsx.missed.seen', { ids: notes.map(n => n.id) }, missedSeen);
    if (out.ok) { setSaid(say('jobsx.missed.done', { n: out.value.seen })); setTick(n => n + 1); }
  };
  return (
    <section className={s.section} data-missed="">
      <h2 className={s.h}>{say('jobsx.missed.title')}</h2>
      <Part loaded={loaded} reload={reload} say={say}>
        {all => {
          const unread = all.filter(n => !n.seen);
          if (unread.length === 0) return <Note>{say('jobsx.missed.empty')}</Note>;
          return (
            <>
              <ul className={s.list}>
                {unread.map(n => (
                  <li key={n.id} className={s.item} data-missed-note={n.id}>
                    <div>
                      <span>{`${say('jobsx.missed.line', { n: n.missed })} ${say(MISSED_RULES.has(n.rule) ? `jobsx.missed.rule.${n.rule}` as JobsxKey : 'jobsx.missed.rule.other')}`}</span>
                      <p className={s.meta}>{[titleOf(n.jobId), day(n.at, p.language)].filter((x): x is string => x !== null).join(' · ')}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {canChange && <div className={s.actions}><Button variant="quiet" disabled={act.busy} onClick={() => void markRead(unread)}>{say('jobsx.missed.markRead')}</Button></div>}
            </>
          );
        }}
      </Part>
      {said !== null && <p role="status">{said}</p>}
      <Refusal code={act.refusal} say={say} />
    </section>
  );
}

export function JobControlsPage({ props }: { props: PlaceRenderProps }) {
  const say = useSay();
  const host = useHost(props, 'job-controls');
  const { loaded, reload } = useReply(host, 'jobsx.list', {}, laneJobList);
  const [open, setOpen] = useState<{ id: string; origin: HTMLElement | null } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const canChange = !props.viewer;
  const value = loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
  const state = value === undefined ? loadedState(loaded) : null;
  const jobs = (value?.jobs ?? []).filter(j => j.laneRun && j.deleted !== true);
  const titleOf = (jobId: string) => jobs.find(j => j.id === jobId)?.title ?? null;
  const toRow = (j: LaneJobRow): RowItem => ({
    id: j.id, mark: markOf(j.state), what: j.title, note: stateText(j.state, say),
    ...(props.view === 'simple' ? {} : { asWritten: say('jobsx.ctl.spent', { spent: rupees(j.spentMinor), budget: rupees(j.budgetMinor) }) }),
  });
  const openJob = jobs.find(j => j.id === open?.id);
  return (
    <Frame where={say('jobsx.where.controls')} title={say('jobsx.ctl.title')} count={value === undefined ? undefined : String(jobs.length)} state={state} onRetry={reload} say={say}>
      <div className={s.split} data-open={openJob !== undefined ? '' : undefined}>
        <div className={s.pane}>
          {props.viewer && <Note>{say('jobsx.readOnly')}</Note>}
          <section className={s.section} data-lane-jobs="">
            <h2 className={s.h}>{say('jobsx.ctl.jobs')}</h2>
            {jobs.length === 0 ? <Note>{say('jobsx.ctl.empty')}</Note>
              : <RowList rows={jobs.map(toRow)} selectedId={open?.id} onOpen={(id, el) => setOpen({ id, origin: el })} onReceipt={props.openReceipt} />}
          </section>
          <DetectSection p={props} host={host} canChange={canChange} />
          <MissedSection p={props} host={host} canChange={canChange} titleOf={titleOf} />
        </div>
        {openJob !== undefined && <JobSheet key={openJob.id} p={props} host={host} job={openJob} origin={open?.origin ?? null} canChange={canChange} onClose={close} />}
      </div>
    </Frame>
  );
}
