/**
 * Work, Screen driving (experimental): the record and the settings view of driving a program.
 * A session is never started here: that stays on WK-14 (#/work/driving), which this page
 * links to. From top to bottom:
 *   This computer        `session.driver`: whether Chausar can drive here, or the engine's plain reason;
 *   Now                  `session.status`: a running session, with Stop (`session.stop`) for every seat but a viewer;
 *   What it can export   `session.plans`: each plan's program, what it makes, its steps and its label;
 *   Earlier sessions     `session.history`: newest first, each opening to its steps in a sheet;
 *   Exports waiting      `session.exports`: each with Discard (`session.discardExport`) for every seat but a viewer;
 *   The rules            always shown.
 *
 * The engine is reached only through `rpc`, and every reply is checked in contract.ts before
 * it is drawn; a reply of any other shape shows Failed, never a part of it. A method that does
 * not exist yet shows "not built yet". Window titles and file names are outside text and are
 * drawn as text only, never as markup or links.
 */
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { Address, Language, Mark, RowItem } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { useT } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import { Button } from '../../parts/Button';
import { Label } from '../../parts/Label';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { ListWithSheet, useListWithSheet } from '../../patterns/ListWithSheet';
import { count } from '../../format/counts.ts';
import { date, time } from '../../format/dates.ts';
import {
  ACTIVE_STATES, DRIVING_ADDRESS, METHODS, checkDriver, checkExports, checkHistory, checkPlans, checkStatus, codeOf, isNotBuilt,
  type PastSession, type SessionState, type Step,
} from './contract.ts';
import s from './ScreenDriving.module.css';

type Load<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'not-built' }
  | { readonly phase: 'failed'; readonly code: string }
  | { readonly phase: 'ready'; readonly data: T };

type T = (key: string, values?: Record<string, string | number>) => string;

/** One read, again whenever `tick` moves. A reply for an address no longer live is dropped. */
function useRead<D>(props: PlaceRenderProps, method: string, check: (reply: unknown) => D | null, tick: number): Load<D> {
  const { rpc, live, address } = props;
  const [load, setLoad] = useState<Load<D>>({ phase: 'loading' });
  useEffect(() => {
    let current = true;
    rpc.request(method, {}).then(
      (reply) => {
        if (!current || !live(address)) return;
        const data = check(reply);
        setLoad(data === null ? { phase: 'failed', code: 'INVALID_REPLY' } : { phase: 'ready', data });
      },
      (error: unknown) => {
        if (!current || !live(address)) return;
        setLoad(isNotBuilt(error) ? { phase: 'not-built' } : { phase: 'failed', code: codeOf(error) });
      },
    );
    return () => { current = false; };
    // The rpc, address and check are fixed for this page; only `tick` asks again.
  }, [tick]);
  return load;
}

/** The state of a section that is not ready yet, or null when it is. */
function pending(load: Load<unknown>): ReactNode {
  switch (load.phase) {
    case 'loading': return <State state={{ kind: 'loading' }} />;
    case 'not-built': return <State state={{ kind: 'not-built' }} />;
    case 'failed': return <State state={{ kind: 'failed', code: load.code }} />;
    case 'ready': return null;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={s.section} aria-labelledby={id}>
      <h2 id={id} className={s.h}>{title}</h2>
      {children}
    </section>
  );
}

const MARK: Readonly<Record<SessionState, Mark>> = {
  idle: 'off', driving: 'busy', 'sign-in': 'you', 'paused-by-you': 'you', 'stopped-by-key': 'off', stopped: 'off', 'step-failed': 'unsure', done: 'cha',
};

function when(at: string, language: Language, t: T): string {
  return t('driving.x.when', { date: date(new Date(at).toISOString().slice(0, 10), 'short', language), time: time(at, 'UTC') });
}

function StepList({ steps, language, t }: { steps: readonly Step[]; language: Language; t: T }) {
  if (steps.length === 0) return <p className={s.meta}>{t('driving.x.history.noSteps')}</p>;
  return (
    <ol className={s.steps}>
      {steps.map((st, i) => (
        <li key={`${st.at}-${i}`} data-step-state={st.state}>
          <span className={s.asWritten}>{st.text}</span>{' '}
          <span className={s.meta}>{`${when(st.at, language, t)} · ${t(`driving.x.step.${st.state}`)}`}</span>
        </li>
      ))}
    </ol>
  );
}

type ActNote = { readonly kind: 'failed'; readonly code: string } | { readonly kind: 'not-built' } | null;

export function ScreenDrivingPlace(props: PlaceRenderProps) {
  const { address, language, viewer, rpc, live, navigate } = props;
  const t = useT();
  const titleId = useId();
  const [statusTick, setStatusTick] = useState(0);
  const [exportsTick, setExportsTick] = useState(0);
  const driver = useRead(props, METHODS.driver, checkDriver, 0);
  const status = useRead(props, METHODS.status, checkStatus, statusTick);
  const plans = useRead(props, METHODS.plans, checkPlans, 0);
  const history = useRead(props, METHODS.history, checkHistory, statusTick);
  const exports = useRead(props, METHODS.exports, checkExports, exportsTick);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ActNote>(null);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  const run = async (method: string, payload: Record<string, unknown>, after: () => void) => {
    if (viewer || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await rpc.request(method, payload);
      if (!live(address)) return;
      after();
    } catch (error) {
      if (!live(address)) return;
      setNote(isNotBuilt(error) ? { kind: 'not-built' } : { kind: 'failed', code: codeOf(error) });
    } finally {
      setBusy(false);
    }
  };
  const reloadAll = () => { setStatusTick(n => n + 1); setExportsTick(n => n + 1); };
  const goDriving = () => navigate(DRIVING_ADDRESS satisfies Address);

  const sessions: readonly PastSession[] = history.phase === 'ready' ? history.data.sessions : [];
  const rows: RowItem[] = sessions.map(h => ({
    id: h.id,
    mark: MARK[h.state],
    markWordsKey: `driving.x.state.${h.state}`,
    what: h.window.title,
    note: t('driving.x.history.note', { state: t(`driving.x.state.${h.state}`), when: when(h.startedAt, language, t) }),
  }));
  const onOpenSheet = useCallback((id: string | undefined) => setOpenId(id), []);
  const controller = useListWithSheet(rows, openId, onOpenSheet);
  const open = controller.render !== null ? sessions[controller.render.index] : undefined;

  const rules = (
    <Section title={t('driving.x.rules.title')}>
      <p className={s.p}>{t('driving.x.rules')}</p>
      <p className={s.p}>{t('driving.x.stopHow')}</p>
    </Section>
  );
  /* Button words come from this lane's catalogue; driving-place.test.ts keeps each within 22 characters. */
  const label = { go: t('driving.x.goDriving'), stop: t('driving.x.stop'), discard: t('driving.x.discard') };
  const link = <Button variant="link" onClick={goDriving}>{label.go}</Button>;

  return (
    <div className={s.page} data-place="driving.screen-driving">
      <PageHeader where={t('SH-01.place.work')} title={t('SH-01.sub.work.screen-driving')} titleId={titleId} aside={<Label kind="experimental" />} />
      <p className={s.p}>{t('driving.x.intro')}</p>
      {viewer && <p className={s.meta} data-read-only="">{t('driving.x.viewer')}</p>}

      {driver.phase === 'not-built' ? (
        <>
          <State state={{ kind: 'not-built' }} />
          <p className={s.p}>{t('driving.x.notBuiltRules')}</p>
        </>
      ) : (
        <>
          <Section title={t('driving.x.computer')}>
            {pending(driver)}
            {driver.phase === 'ready' && (
              <div data-driver={driver.data.available ? 'available' : 'unavailable'}>
                <p className={s.p}>{t(driver.data.available ? 'driving.x.can' : 'driving.x.cannot')}</p>
                {driver.data.platform !== null && <p className={s.meta}>{t('driving.x.platform', { name: t(`driving.x.platform.${driver.data.platform}`) })}</p>}
                {!driver.data.available && driver.data.reason !== null && <p className={s.asWritten}>{driver.data.reason}</p>}
                {!driver.data.available && driver.data.code !== null && <p className={[s.meta, s.fig].join(' ')}>{t('driving.x.code', { code: driver.data.code })}</p>}
                <p className={s.meta}>{t('driving.x.stopKey', { key: driver.data.stopKey })}</p>
              </div>
            )}
          </Section>

          <Section title={t('driving.x.now')}>
            {pending(status)}
            {status.phase === 'ready' && (ACTIVE_STATES.includes(status.data.state) ? (
              <div role="status" data-session-running="">
                <p className={s.p}><strong>{t('driving.x.running')}</strong></p>
                <p className={s.meta}>{t(`driving.x.state.${status.data.state}`)}</p>
                {status.data.window !== null && <p className={s.asWritten}>{t('driving.x.window', { title: status.data.window.title })}</p>}
                <div className={s.actions}>
                  {link}
                  {!viewer && <Button variant="filled" danger disabled={busy} onClick={() => void run(METHODS.stop, {}, reloadAll)}>{label.stop}</Button>}
                </div>
              </div>
            ) : (
              <div>
                <p className={s.p}>{t('driving.x.notRunning')}</p>
                {status.data.state !== 'idle' && <p className={s.meta}>{t('driving.x.last', { state: t(`driving.x.state.${status.data.state}`) })}</p>}
                {status.data.state !== 'idle' && status.data.reason !== null && <p className={s.asWritten}>{status.data.reason}</p>}
                <div className={s.actions}>{link}</div>
              </div>
            ))}
          </Section>

          <Section title={t('driving.x.plans')}>
            {pending(plans)}
            {plans.phase === 'ready' && (plans.data.plans.length === 0 ? <State state={{ kind: 'empty' }} emptyKey="driving.x.plans.empty" /> : (
              <ul className={s.list}>
                {plans.data.plans.map(plan => (
                  <li key={plan.id} className={s.item} data-plan={plan.id}>
                    <div className={s.line}>
                      <strong className={s.asWritten}>{plan.title}</strong>
                      {plan.status === 'experimental' ? <Label kind="experimental" /> : <span className={s.meta}>{t('driving.x.plan.tested')}</span>}
                    </div>
                    <p className={s.meta}>{t('driving.x.plan.app', { app: plan.app })}</p>
                    <p className={s.meta}>{t('driving.x.plan.produces', { what: plan.produces })}</p>
                    {plan.groups.length > 0 && <p className={s.meta}>{t('driving.x.plan.groups', { groups: plan.groups.join(', ') })}</p>}
                    <p className={s.meta}>{t('driving.x.plan.steps')}</p>
                    <ol className={s.steps}>{plan.steps.map((st, i) => <li key={i} className={s.asWritten}>{st}</li>)}</ol>
                  </li>
                ))}
              </ul>
            ))}
          </Section>

          <Section title={t('driving.x.history')}>
            {pending(history)}
            {history.phase === 'ready' && (rows.length === 0
              ? <State state={{ kind: 'empty' }} emptyKey="driving.x.history.empty" />
              : <div data-history=""><ListWithSheet controller={controller} onReceipt={() => {}} /></div>)}
          </Section>

          <Section title={t('driving.x.exports')}>
            <p className={s.meta}>{t('driving.x.exports.note')}</p>
            {pending(exports)}
            {exports.phase === 'ready' && (exports.data.exports.length === 0 ? <State state={{ kind: 'empty' }} emptyKey="driving.x.exports.empty" /> : (
              <ul className={s.list}>
                {exports.data.exports.map(file => (
                  <li key={file.id} className={s.item} data-export={file.id}>
                    <div className={s.line}>
                      <span className={s.asWritten}>{file.name}</span>
                      {!viewer && <Button variant="quiet" disabled={busy} onClick={() => void run(METHODS.discardExport, { exportId: file.id }, () => setExportsTick(n => n + 1))}>{label.discard}</Button>}
                    </div>
                    <p className={s.meta}>{t('driving.x.exports.meta', { type: file.mediaType, size: count(String(file.bytes)), when: when(file.at, language, t) })}</p>
                  </li>
                ))}
              </ul>
            ))}
          </Section>
        </>
      )}

      {rules}
      {note !== null && <p className={s.alert} role="alert">{note.kind === 'not-built' ? t('driving.x.actNotBuilt') : t('driving.x.actFailed', { code: note.code })}</p>}

      {controller.render !== null && open !== undefined && (
        <Sheet kind={t('driving.x.history.sheet')} title={open.window.title} origin={controller.render.origin} onClose={controller.render.close} onAdjacent={controller.render.adjacent}>
          <p className={s.meta}>{t('driving.x.history.app', { app: open.window.app })}</p>
          <p className={s.meta}>{t(`driving.x.state.${open.state}`)}</p>
          {open.reason !== null && <p className={s.asWritten}>{open.reason}</p>}
          <p className={s.meta}>{t('driving.x.history.started', { when: when(open.startedAt, language, t) })}</p>
          <p className={s.meta}>{open.endedAt !== null ? t('driving.x.history.ended', { when: when(open.endedAt, language, t) }) : t('driving.x.history.open')}</p>
          <StepList steps={open.steps} language={language} t={t} />
          {open.exports.length > 0 && (
            <>
              <p className={s.meta}>{t('driving.x.history.files')}</p>
              <ul className={s.list}>
                {open.exports.map(file => <li key={file.id} className={s.item}><span className={s.asWritten}>{file.name}</span> <span className={s.meta}>{t('driving.x.bytes', { size: count(String(file.bytes)) })}</span></li>)}
              </ul>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
