/**
 * Model asks: accounts sorting and dictionary edits may ask the model route the owner chose.
 * Each ask is three explicit presses, never fewer:
 *   1. Ask: the engine builds the request under the send level and returns the exact bytes.
 *   2. The owner approves exactly those bytes (`models.approve {id}`).
 *   3. Send once (`learningx.*AskRun {previewId, approvalId}`).
 * Every typed "not yet" is drawn as plain words for its code.
 */
import { useState, type ReactNode } from 'react';
import { useAct, useReply } from '../work/kit/reply.ts';
import type { Check } from '../work/kit/validate.ts';
import {
  ACCOUNT_CLASSES, accountsListReply, accountsRunReply, approvalReply, askReply, editsRunReply, modelRouteReply, routesReply,
  type AccountSet, type NotYet, type Preview,
} from './contract.ts';
import {
  Button, NotYetLine, Part, Refused, admins, day, editText, isOwner, prepares, styles as s, useLx, valueOf, type LearningProps, type Lx,
} from './shared.tsx';

const classText = (value: string | null, lx: Lx) => value === null ? lx('accounts.noClass') : (ACCOUNT_CLASSES as readonly string[]).includes(value) ? lx(`class.${value}`) : value;

export function ModelAsks(props: LearningProps) {
  const lx = useLx();
  const route = useReply(props, 'learningx.modelRoute', {}, modelRouteReply);
  const chosen = valueOf(route.loaded);
  return (
    <>
      <Part title={lx('model.routeTitle')} loaded={route.loaded} reload={route.reload}>
        {chosen && (
          <div className={s.stack}>
            {chosen.route === null
              ? <p>{lx('model.noRoute')}</p>
              : <p className={s.change}>{lx('model.route', { model: chosen.route.model, kind: chosen.route.kind, endpoint: chosen.route.endpoint })}</p>}
            {chosen.notYet && <NotYetLine value={chosen.notYet} />}
            <p className={s.note}>{lx(`send.${chosen.send}`)}</p>
            {isOwner(props) && <RouteChooser props={props} current={chosen.route?.routeId ?? null} onChosen={route.reload} />}
          </div>
        )}
      </Part>
      <AccountsAsk props={props} />
      <EditsAsk props={props} />
    </>
  );
}

function RouteChooser({ props, current, onChosen }: { props: LearningProps; current: string | null; onChosen: () => void }) {
  const lx = useLx();
  const { loaded } = useReply(props, 'models.list', {}, routesReply);
  const routes = (valueOf(loaded) ?? []).filter(r => r.enabled);
  const act = useAct(props.rpc);
  const [pick, setPick] = useState<string>('');
  if (loaded.phase === 'refused') return <p className={s.note}>{lx('model.routesUnavailable')}</p>;
  const choose = async (routeId: string | null) => {
    const done = await act.run('learningx.modelRouteSet', { routeId }, modelRouteReply);
    if (done.ok) { setPick(''); onChosen(); }
  };
  return (
    <div className={s.stack}>
      {routes.length === 0
        ? <p className={s.note}>{lx('model.noRoutes')}</p>
        : (
          <p className={s.inline}>
            <label className={s.selectLabel}>{lx('model.pick')}
              <select className={s.select} value={pick} onChange={e => setPick(e.target.value)}>
                <option value="" disabled>{lx('model.pick')}</option>
                {routes.map(r => <option key={r.id} value={r.id}>{lx('model.option', { model: r.model, kind: r.kind })}</option>)}
              </select>
            </label>
            <Button onClick={() => { void choose(pick); }} disabled={act.busy || pick === '' || pick === current}>{lx('model.choose')}</Button>
          </p>
        )}
      {current !== null && <p><Button variant="link" onClick={() => { void choose(null); }} disabled={act.busy}>{lx('model.clear')}</Button></p>}
      <Refused code={act.refusal} />
    </div>
  );
}

function AccountsAsk({ props }: { props: LearningProps }) {
  const lx = useLx();
  const { loaded, reload } = useReply(props, 'learningx.accountsList', {}, accountsListReply);
  const sets = valueOf(loaded)?.sets ?? [];
  const [setId, setSetId] = useState('');
  const chosen = sets.find(set => set.id === setId);
  return (
    <Part title={lx('accounts.title')} loaded={loaded} reload={reload}>
      {sets.length === 0
        ? <p className={s.note}>{lx('accounts.empty')}</p>
        : (
          <label className={s.selectLabel}>{lx('accounts.pick')}
            <select className={s.select} value={setId} onChange={e => setSetId(e.target.value)}>
              <option value="" disabled>{lx('accounts.pick')}</option>
              {sets.map(set => <option key={set.id} value={set.id}>{lx('accounts.option', { date: day(set.at, props.language), total: String(set.counts.total), questions: String(set.counts.needsQuestion) })}</option>)}
            </select>
          </label>
        )}
      {chosen && prepares(props) && (
        <AskFlow key={chosen.id} props={props} ask="learningx.accountsAsk" payload={{ setId: chosen.id }} run="learningx.accountsAskRun" check={accountsRunReply}
          label={lx('accounts.ask')} onDone={reload}
          done={value => <AccountsDone set={value.set} count={String(value.modelProposals)} />} />
      )}
    </Part>
  );
}

function AccountsDone({ set, count }: { set: AccountSet; count: string }) {
  const lx = useLx();
  return (
    <div className={s.stack}>
      <p>{lx('accounts.done', { count })}</p>
      <ul className={s.list} aria-label={lx('accounts.newSet')}>
        {set.proposals.map(p => (
          <li key={p.accountId}>
            {lx('accounts.line', { name: p.name, cls: classText(p.accountClass, lx), confidence: lx(`confidence.${p.confidence}`) })}
            {p.needsQuestion && <span className={s.amberWord}> {lx('accounts.question')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditsAsk({ props }: { props: LearningProps }) {
  const lx = useLx();
  if (!prepares(props)) return null;
  return (
    <Part title={lx('editsAsk.title')}>
      <p className={s.note}>{lx('editsAsk.intro')}</p>
      <AskFlow props={props} ask="learningx.editsAsk" payload={{}} run="learningx.editsAskRun" check={editsRunReply} label={lx('editsAsk.ask')}
        done={value => (
          <div className={s.stack}>
            <p>{lx('editsAsk.done', { count: String(value.items.length) })}</p>
            <ul className={s.list}>
              {value.items.map(item => <li key={item.id}>{editText(item.edit, lx)} <span className={item.status === 'failed-answer-key' ? s.amberWord : s.word}>{lx(`status.${item.status}`)}</span></li>)}
              {value.refused.map(item => <li key={`r${item.index}`} className={s.amber}>{lx('editsAsk.refused', { code: item.code })}</li>)}
            </ul>
          </div>
        )} />
    </Part>
  );
}

type Step<D> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'not-yet'; readonly notYet: NotYet }
  | { readonly kind: 'preview'; readonly preview: Preview }
  | { readonly kind: 'approved'; readonly preview: Preview; readonly approvalId: string }
  | { readonly kind: 'done'; readonly value: D };

/** Ask, approve the exact bytes, send once. Each step is its own press. */
function AskFlow<D extends { readonly state: 'done' }>({ props, ask, payload, run, check, label, done, onDone }: {
  props: LearningProps; ask: string; payload: Record<string, unknown>; run: string; check: Check<D | NotYet>; label: string;
  done: (value: D) => ReactNode; onDone?: () => void;
}) {
  const lx = useLx();
  const act = useAct(props.rpc);
  const [step, setStep] = useState<Step<D>>({ kind: 'idle' });
  // The gateway lets the owner or a co-founder approve, and only the person who asked can send: so only they ask.
  const owner = admins(props);
  const start = async () => {
    const reply = await act.run(ask, payload, askReply);
    if (reply.ok) setStep(reply.value.state === 'not-yet' ? { kind: 'not-yet', notYet: reply.value } : { kind: 'preview', preview: reply.value });
  };
  const approve = async (preview: Preview) => {
    const reply = await act.run('models.approve', { id: preview.previewId }, approvalReply);
    if (reply.ok) setStep({ kind: 'approved', preview, approvalId: reply.value.id });
  };
  const send = async (preview: Preview, approvalId: string) => {
    const reply = await act.run(run, { previewId: preview.previewId, approvalId }, check);
    if (!reply.ok) return;
    if (reply.value.state === 'not-yet') setStep({ kind: 'not-yet', notYet: reply.value as NotYet });
    else { setStep({ kind: 'done', value: reply.value as D }); onDone?.(); }
  };
  return (
    <div className={s.stack} data-ask={ask}>
      {owner && (step.kind === 'idle' || step.kind === 'not-yet' || step.kind === 'done') && (
        <p><Button onClick={() => { void start(); }} disabled={act.busy}>{step.kind === 'idle' ? label : lx('model.askAgain')}</Button></p>
      )}
      {step.kind === 'not-yet' && <NotYetLine value={step.notYet} />}
      {(step.kind === 'preview' || step.kind === 'approved') && (
        <div className={s.stack}>
          <p className={s.change}>{lx('model.previewTitle')}</p>
          <dl className={s.facts}>
            <dt>{lx('model.endpoint')}</dt><dd className={s.code}>{step.preview.endpoint}</dd>
            <dt>{lx('model.sendLevel')}</dt><dd>{lx(`sendWord.${step.preview.send}`)}</dd>
            <dt>{lx('model.digest')}</dt><dd className={s.code}>{step.preview.digest}</dd>
          </dl>
          <p className={s.note}>{lx('model.bytes')}</p>
          <pre className={s.bytes} data-payload="">{step.preview.payload}</pre>
          {step.kind === 'preview' && (owner
            ? <p className={s.inline}>
                <Button onClick={() => { void approve(step.preview); }} disabled={act.busy}>{lx('model.approve')}</Button>
                <Button variant="link" onClick={() => setStep({ kind: 'idle' })}>{lx('notNow')}</Button>
              </p>
            : <p className={s.note}>{lx('model.ownerApproves')}</p>)}
          {step.kind === 'approved' && (
            <p className={s.inline}>
              <span>{lx('model.approved')}</span>
              <Button onClick={() => { void send(step.preview, step.approvalId); }} disabled={act.busy}>{lx('model.send')}</Button>
            </p>
          )}
        </div>
      )}
      {step.kind === 'done' && done(step.value)}
      <Refused code={act.refusal} />
    </div>
  );
}
