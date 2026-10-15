/**
 * Chausar is driving (WK-14, experimental), at #/work/driving. First the choice of the one
 * window Chausar may use; then the banner "Chausar is driving. Ctrl Alt Pause to stop." with
 * Stop, and the steps as they happen. States: sign in yourself; you moved the mouse (paused,
 * with Continue and Stop); stopped by your key; a step failed. Everything comes from the
 * session lane through `approvals.driving*`; while that lane is absent the page says not built
 * yet and shows nothing that pretends to drive.
 */
import { useState } from 'react';
import { useAct, useReply } from './kit/reply.ts';
import { dayTime } from './kit/format.ts';
import { Actions, Button, Note, Refusal, Section } from './kit/Page';
import { driving, type DrivingStatus } from './contract-jobs.ts';
import { jobWords, type JobKey, type JobWords } from './text-jobs.ts';
import { Frame, type WorkProps } from './shared.tsx';
import { r4Words, sayR4 } from './text-r4.ts';
import s from './work.module.css';

const STATE_KEY: Readonly<Record<DrivingStatus['state'], JobKey>> = {
  idle: 'driving.idle', driving: 'driving.banner', 'sign-in': 'driving.signIn', 'paused-by-you': 'driving.paused',
  'stopped-by-key': 'driving.stoppedByKey', stopped: 'driving.stopped', 'step-failed': 'driving.failed', done: 'driving.done',
};
const ACTIVE: readonly DrivingStatus['state'][] = ['driving', 'sign-in', 'paused-by-you'];

function Steps({ status, j, language }: { status: DrivingStatus; j: JobWords; language: WorkProps['language'] }) {
  if (status.steps.length === 0) return null;
  return (
    <Section title={j['driving.steps']}>
      <ol className={s.list}>
        {status.steps.map((st, i) => (
          <li key={`${st.at}-${i}`} className={s.item} data-step-state={st.state}>
            <span>{st.text}</span>
            <span className={s.meta}>{`${dayTime(st.at, language)} · ${j[`step.${st.state}`]}`}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function DrivingPage({ p }: { p: WorkProps }) {
  const { language } = p;
  const j = jobWords(language);
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.drivingStatus', {}, driving, String(tick));
  const act = useAct(p.rpc);
  const [chosen, setChosen] = useState<string | null>(null);
  const owner = !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder');
  const canStop = !p.viewer;
  const run = async (method: string, payload: Record<string, unknown> = {}) => {
    const out = await act.run(method, payload, driving);
    if (out.ok) setTick(n => n + 1);
  };
  return (
    <Frame p={p} title={j['driving.title']} loaded={loaded} reload={reload}>
      {d => {
        if (!d.available) return (<><Note>{j['driving.notBuilt']}</Note><Note>{j['driving.rules']}</Note></>);
        const st = d.status;
        const r4 = r4Words(language);
        const active = ACTIVE.includes(st.state);
        return (
          <div className={s.pane}>
            {active && (
              <div role="status" data-driving-banner="" className={s.block}>
                <strong>{j['driving.banner']}</strong>
                {st.window !== null && <p className={s.meta}>{st.window.title}</p>}
                {st.state !== 'driving' && <p>{j[STATE_KEY[st.state]]}</p>}
                <Actions>
                  {st.state === 'paused-by-you' && canStop && <Button variant="quiet" disabled={act.busy} onClick={() => void run('approvals.drivingContinue')}>{j['driving.continue']}</Button>}
                  {canStop && <Button variant="filled" danger disabled={act.busy} onClick={() => void run('approvals.drivingStop')}>{j['driving.stop']}</Button>}
                </Actions>
              </div>
            )}
            {!active && <Note>{j[STATE_KEY[st.state]]}</Note>}
            {!active && st.reason !== null && <Note>{st.reason}</Note>}
            {d.driver !== undefined && !d.driver.available && <Note>{sayR4(r4, 'driving.cannot', { code: d.driver.code ?? 'DRIVER_UNAVAILABLE' })}</Note>}
            {!active && owner && (d.driver === undefined || d.driver.available) && (
              <Section title={j['driving.choose']}>
                {(d.windows ?? []).length === 0 ? <Note>{j['driving.noWindows']}</Note> : (
                  <fieldset className={s.form}>
                    <legend>{j['driving.choose']}</legend>
                    {(d.windows ?? []).map(win => (
                      <label key={win.id}><span><input type="radio" name="driving-window" checked={chosen === win.id} onChange={() => setChosen(win.id)} /> {`${win.title} · ${win.app}`}</span></label>
                    ))}
                    <Actions><Button variant="filled" disabled={act.busy || chosen === null} onClick={() => chosen !== null && void run('approvals.drivingStart', { windowId: chosen })}>{j['driving.start']}</Button></Actions>
                  </fieldset>
                )}
              </Section>
            )}
            <Steps status={st} j={j} language={language} />
            {st.exports !== undefined && st.exports.length > 0 && (
              <Section title={r4['driving.exports']}><ul className={s.list}>{st.exports.map(x => <li key={x.id} className={s.item}><code>{x.name}</code></li>)}</ul></Section>
            )}
            <Note>{j['driving.rules']}</Note>
            <Refusal code={act.refusal} language={language} />
          </div>
        );
      }}
    </Frame>
  );
}
