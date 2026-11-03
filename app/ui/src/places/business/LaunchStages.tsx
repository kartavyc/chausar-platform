import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { LaunchStatusView, VentureRunEvent } from '../../engine/types';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';

/**
 * Business > Practice: the launch stage (wave 6, 6C4 / D19). Two stages only, Practice and Live (you approve each), as
 * venture.launch.status lists them, with the engine's line for where the business is. One button moves it: Go live
 * (venture.launch.advance { to: 'live' }) asks a second time, since drafts can then reach clients after the owner's
 * approval; Back to practice needs no second ask, since it only takes autonomy away. A blocked Live keeps its button
 * locked (aria-disabled) and shows the engine's reason under it.
 */
const onChange = (event: VentureRunEvent) => event.type === 'queue.changed';

export function LaunchStages() {
  const t = useT();
  const client = useEngine();
  const status = useResource('venture.launch.status', {}, { refreshOn: onChange });
  const [phase, setPhase] = useState<'idle' | 'ask' | 'busy'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<LaunchStatusView | null>(null);
  const reasonId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (phase === 'ask') cancelRef.current?.focus(); }, [phase]);
  useEffect(() => { if (status.data) setView(status.data); }, [status.data]);

  async function move(to: 'practice' | 'live') {
    setPhase('busy');
    setProblem(null);
    try {
      setView(await client.request('venture.launch.advance', { to }));
    } catch (error) {
      setProblem(t('business.launch.failed', { message: messageOf(error) }));
    } finally {
      setPhase('idle');
      status.reload();
    }
  }

  const data = view ?? status.data ?? null;
  const live = data?.stages.find((item) => item.stage === 'live');
  const current = data?.stages.find((item) => item.current);
  return (
    <TileSection title={t('business.launch')}>
      {status.error && !data && <p className={s.problem} role="alert">{t('business.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <p className={s.note}>{t('business.loading')}</p>}
      {data && (
        <>
          <ul className={s.steps}>
            {data.stages.map((item) => (
              <li key={item.stage} className={s.step} data-launch-stage={item.stage} data-current={item.current ? '' : undefined} aria-current={item.current ? 'step' : undefined}>
                <span className={item.current ? s.strong : undefined}>{t(`business.launch.${item.stage}`)}</span>
              </li>
            ))}
          </ul>
          {/* In Practice with Live blocked, the reason is the one line: it says what to do next. */}
          {data.stage === 'practice' && live && !live.allowed
            ? <p className={s.note} id={reasonId}>{live.reason}</p>
            : current && <p className={s.line}>{current.reason}</p>}
          {phase === 'ask' ? (
            <div className={s.foldBody} data-second-ask="">
              <p className={s.line}>{t('business.launch.ask')}</p>
              <div className={s.buttons}>
                <Button ref={cancelRef} variant="quiet" onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
                <Button variant="primary" onClick={() => void move('live')}>{t('business.launch.goLiveNow')}</Button>
              </div>
            </div>
          ) : (
            <div className={s.buttons}>
              {data.stage === 'practice'
                ? (
                  <Button
                    variant="primary" disabled={phase !== 'idle'} locked={!live?.allowed}
                    lockedReason={live?.allowed ? undefined : live?.reason} lockedNoteId={live?.allowed ? undefined : reasonId}
                    onClick={() => { if (live?.allowed) { setProblem(null); setPhase('ask'); } }}
                  >{t('business.launch.goLive')}</Button>
                )
                : <Button disabled={phase !== 'idle'} onClick={() => void move('practice')}>{t('business.launch.back')}</Button>}
            </div>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </TileSection>
  );
}
