import { useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Inner, Lift } from '../../parts/Card';
import { PostureChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import type { DeptId } from '../../parts/icons';
import { ProgressBar } from '../../parts/ProgressBar';
import { DEPT_OF, type Member } from './departments';
import { RING, Result, busyFirst, elapsedOf, stateWords, toneOf } from './shared';
import s from './Team.module.css';

/** Past this many agents, idle ones fold behind "Show n idle" (catalogue U2). */
export const MOST_SHOWN = 8;

export interface AgentCardProps {
  member: Member;
  /** The department tint for the avatar. Left out, the engine's own department for the agent, if it sent one. */
  dept?: DeptId | undefined;
  /** An inner grey card on a white tile, or a white card lifted off a department's tint. */
  ground: 'inner' | 'lift';
}

/**
 * One agent as D's `.acard`: the avatar with its ring, the name (it opens the agent panel), the role, what it is
 * doing now (it opens that run; a waiting agent says "Waiting on you" in the UI's own words, then what it waits on),
 * the run's steps as a bar with the time so far ("paused" while it waits), its last result with its receipt or
 * "model estimate", and its posture. The card is a list row too: J and K move between cards and Enter opens the
 * panel. The quiet Chat button arrives with the chat itself (W4 4B), so it is not drawn yet.
 */
export function AgentCard({ member, dept, ground }: AgentCardProps) {
  const t = useT();
  const nameId = useId();
  const { agent, run, state } = member;
  const waiting = run?.state === 'waiting';
  const tint = dept ?? (agent.department ? DEPT_OF[agent.department] : undefined);
  const Card = ground === 'lift' ? Lift : Inner;
  return (
    <li className={s.agent} data-row="" data-row-id={agent.id} tabIndex={-1} aria-labelledby={nameId}>
      <Card className={s.card}>
        <div className={s.top}>
          <Avatar name={agent.name} dept={tint} state={RING[state]} size={40} />
          <div className={s.id}>
            <button type="button" id={nameId} className={s.name} data-open="" onClick={(event) => openSheet('agent', agent.id, event.currentTarget)}>
              {agent.name}
            </button>
            <p className={s.role}>{agent.role}</p>
          </div>
        </div>
        <p className={s.now}>
          {run ? (
            <button
              type="button"
              className={s.nowOpen}
              data-waiting={waiting ? '' : undefined}
              onClick={(event) => openSheet('run', run.runId, event.currentTarget)}
            >
              {waiting ? stateWords(t, 'waiting') : agent.now}
            </button>
          ) : agent.now}
          {waiting && <> {run.purpose}</>}
        </p>
        {run?.progress && (
          <div className={s.progress}>
            <ProgressBar progress={run.progress} tone={toneOf(run)} className={s.bar} />
            <span className={cx(s.elapsed, 'mono')}>{elapsedOf(t, run)}</span>
          </div>
        )}
        <p className={s.last}>
          <span className={s.lastLabel}>{t('team.last')}</span>{' '}
          {agent.last
            ? <Result line={agent.last.line} receiptId={agent.last.receiptId} estimate={agent.last.estimate} />
            : <span className={s.none}>{t('team.lastNone')}</span>}
        </p>
        <div className={s.foot}>
          <PostureChip posture={agent.posture} />
        </div>
      </Card>
    </li>
  );
}

export interface AgentListProps {
  members: readonly Member[];
  /** The list's name ("Agents", "Production agents"). */
  label: string;
  dept?: DeptId | undefined;
  ground: 'inner' | 'lift';
}

/**
 * Agent cards in a grid: agents doing something first, then idle ones, each in the engine's order. Past eight, the
 * idle ones fold behind "Show n idle"; opening the fold moves focus to the first card it showed.
 */
export function AgentList({ members, label, dept, ground }: AgentListProps) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const ordered = busyFirst(members);
  const shown = open ? ordered : ordered.filter((member, at) => at < MOST_SHOWN || member.state !== 'idle');
  const folded = ordered.length - shown.length;

  function unfold() {
    const first = shown.length;
    setOpen(true);
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('[data-row]')[first]?.focus());
  }

  return (
    <>
      <ul ref={list} className={s.agents} aria-label={label}>
        {shown.map((member) => <AgentCard key={member.agent.id} member={member} dept={dept} ground={ground} />)}
      </ul>
      {folded > 0 && (
        <button type="button" className={s.fold} aria-expanded={false} onClick={unfold}>
          {t('team.showIdle', { count: folded })}
        </button>
      )}
    </>
  );
}
