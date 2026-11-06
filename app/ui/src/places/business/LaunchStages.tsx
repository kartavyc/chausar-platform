import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { LaunchStatusView, VentureRunEvent } from '../../engine/types';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';
import { LoadingPlace } from '../../parts/Skeleton';
import { FilterChips } from '../../parts/FilterChips';

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
  const models = useResource('venture.models.status', {}, { refreshOn: onChange });
  const [phase, setPhase] = useState<'idle' | 'ask' | 'busy'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<LaunchStatusView | null>(null);
  // C4 task 17: right after going live, one line and an Undo (back to Practice is allowed any time, delivery/launch.ts).
  const [justLive, setJustLive] = useState(false);
  const reasonId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (phase === 'ask') cancelRef.current?.focus(); }, [phase]);
  useEffect(() => { if (status.data) setView(status.data); }, [status.data]);

  async function move(to: 'practice' | 'live') {
    setPhase('busy');
    setProblem(null);
    try {
      setView(await client.request('venture.launch.advance', { to }));
      setJustLive(to === 'live');
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
  const main = models.data?.tiers.main;
  const needsAi = main && (main.usable === false || main.presetId === 'built-in-templates');
  function choose(stage: string) {
    if (phase !== 'idle' || stage === data?.stage) return;
    if (stage === 'practice') { void move('practice'); return; }
    if (live?.allowed) { setProblem(null); setPhase('ask'); }
    else window.location.hash = needsAi ? '#/connections/ai' : '#/business/plan';
  }
  return (
    <TileSection title={t('business.launch')}>
      {status.error && !data && <p className={s.problem} role="alert">{t('business.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <LoadingPlace shape="settings" />}
      {data && (
        <>
          <FilterChips label={t('business.launch')} value={data.stage} options={data.stages.map(item => ({ id: item.stage, label: t(`business.launch.${item.stage}`) }))} onChange={choose} />
          {/* In Practice with Live blocked, the reason is the one line: it says what to do next. */}
          {data.stage === 'practice' && live && !live.allowed
            ? <p className={s.note} id={reasonId}>{live.reason}</p>
            : current && <p className={s.line}>{current.reason}</p>}
          {justLive && data.stage === 'live' && (
            <p className={s.line} role="status" data-live-line="">
              {t('business.launch.liveLine')}{' '}
              <Button variant="quiet" size="sm" disabled={phase !== 'idle'} onClick={() => void move('practice')}>{t('business.launch.undo')}</Button>
            </p>
          )}
          {phase === 'ask' ? (
            <div className={s.foldBody} data-second-ask="">
              <p className={s.line}>{t('business.launch.ask')}</p>
              <div className={s.buttons}>
                <Button ref={cancelRef} variant="quiet" onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
                <Button onClick={() => void move('live')}>{t('business.launch.goLiveNow')}</Button>
              </div>
            </div>
          ) : (
            <div className={s.buttons}>
              {data.stage === 'practice'
                ? (
                  <Button disabled={phase !== 'idle'} onClick={() => choose('live')}>
                    {t(live?.allowed ? 'business.launch.goLive' : needsAi ? 'business.launch.connect' : 'business.launch.readPlan')}
                  </Button>
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
