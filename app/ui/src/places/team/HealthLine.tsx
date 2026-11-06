import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { AgentHealth } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import s from './Team.module.css';

export interface HealthLineProps {
  health: AgentHealth | undefined;
  /** The agent the health is for, or 'team' for the team's own (a cause no single agent can claim). */
  agentId: string;
  /** The engine answered (cleared it, or refused because the health changed): read the team again. */
  onCleared?: (() => void) | undefined;
}

const TONE = { quarantined: 'fail', failing: 'fail', degraded: 'wait' } as const;

/**
 * An agent's health in plain words (A20, worked out by the engine from facts, views/health.ts): quarantined and
 * failing in fail words, degraded in wait words, each with the engine's one reason; nothing at all when it is healthy.
 * A quarantined agent starts no new work until the owner clears it: "Clear quarantine" asks once more (focus moves to
 * "Yes, clear it"; "Keep it" puts it back on "Clear quarantine"), then sends the health digest the owner saw
 * (venture.team.clearQuarantine). A health that changed since is refused in the engine's words, and the team is read
 * again so the health shown is the one now.
 */
export function HealthLine({ health, agentId, onCleared }: HealthLineProps) {
  const t = useT();
  const client = useEngine();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the ask opens or closes: set by the control that changed it, so a render alone never moves it.
  const focusNext = useRef<'yes' | 'clear' | null>(null);

  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === 'yes') yesRef.current?.focus();
    if (next === 'clear') clearRef.current?.focus();
  }, [asking]);

  if (!health || health.status === 'healthy') return null;
  const status = health.status;

  function ask() {
    setProblem(null);
    focusNext.current = 'yes';
    setAsking(true);
  }

  function keep() {
    focusNext.current = 'clear';
    setAsking(false);
  }

  async function clear(digest: string) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.team.clearQuarantine', { agentId, digest });
      setAsking(false);
    } catch (error) {
      setProblem(t('team.health.failed', { message: error instanceof Error ? error.message : String(error) }));
      focusNext.current = 'clear';
      setAsking(false);
    } finally {
      setBusy(false);
      onCleared?.();
    }
  }

  return (
    <div className={s.health} data-health={status}>
      <p className={s.healthLine}>
        <Chip tone={TONE[status]}>{t(`team.health.${status}`)}</Chip>{' '}
        <span className={s.healthReason}>{health.reason}</span>
      </p>
      {status === 'quarantined' && !asking && (
        <Button ref={clearRef} variant="secondary" size="sm" onClick={ask}>{t('team.health.clear')}</Button>
      )}
      {status === 'quarantined' && asking && (
        <div className={s.healthAsk} role="group" aria-label={t('team.health.clear')}>
          <p className={s.healthQuestion}>{t('team.health.ask')}</p>
          <div className={s.healthButtons}>
            <Button ref={yesRef} variant="primary" size="sm" disabled={busy} onClick={() => void clear(health.digest)}>{t('team.health.yes')}</Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={keep}>{t('team.health.keep')}</Button>
          </div>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
