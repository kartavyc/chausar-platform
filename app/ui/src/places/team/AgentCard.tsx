import { useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Inner, Lift } from '../../parts/Card';
import { Button } from '../../parts/Button';
import { Chip, PostureChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import type { DeptId } from '../../parts/icons';
import { ProgressBar } from '../../parts/ProgressBar';
import { DEPT_OF, isKeeper, nested, type Member } from './departments';
import { HealthLine } from './HealthLine';
import { KeeperCard } from './KeeperCard';
import { canChat } from './chat';
import { RING, Result, busyFirst, elapsedOf, stateWords, toneOf } from './shared';
import s from './Team.module.css';
import c from './AgentChat.module.css';
import x from './AgentExtras.module.css';

/** Past this many agents, idle ones fold behind "Show n idle" (catalogue U2). */
export const MOST_SHOWN = 8;

export interface AgentCardProps {
  member: Member;
  /** The department tint for the avatar. Left out, the engine's own department for the agent, if it sent one. */
  dept?: DeptId | undefined;
  /** An inner grey card on a white tile, or a white card lifted off a department's tint. */
  ground: 'inner' | 'lift';
  /** The agent this one helps, by name, when the engine nests it under one (W4 4J12). */
  helps?: string | undefined;
  /** The engine changed the agent (a quarantine cleared): read the team again. */
  onChanged?: (() => void) | undefined;
  /** W4 4J22b: the cards of the agents that help this one, nested under it; its spend then counts theirs (4J12). */
  helpers?: ReactNode;
}

/**
 * One agent as D's `.acard`: the avatar with its ring, the name (it opens the agent panel), the role, what it is
 * doing now (it opens that run; a waiting agent says "Waiting on you" in the UI's own words, then what it waits on),
 * the run's steps as a bar with the time so far ("paused" while it waits), or, with nothing on now, its last result
 * with its receipt or "model estimate" (every result is in its panel's runs), its health when it is not healthy (W4 4A2, HealthLine), and its posture. A role whose steps are code
 * says so. The card is a list row too: J and K move between cards and Enter opens the panel. An agent the owner can
 * talk to has a quiet Chat button at the foot (W4 4B3, the founder's "not in your face"): "Chat with Editor" opens the
 * panel on its Chat tab.
 */
export function AgentCard({ member, dept, ground, helps, onChanged, helpers }: AgentCardProps) {
  const t = useT();
  const nameId = useId();
  const { agent, run, state } = member;
  const waiting = run?.state === 'waiting';
  const tint = dept ?? (agent.department ? DEPT_OF[agent.department] : undefined);
  const Card = ground === 'lift' ? Lift : Inner;
  return (
    <li className={cx(s.agent, helpers ? x.withHelpers : undefined)} data-row="" data-row-id={agent.id} tabIndex={-1} aria-labelledby={nameId}>
      <Card className={s.card}>
        <div className={s.top}>
          <Avatar name={agent.name} dept={tint} state={RING[state]} size={40} />
          <div className={s.id}>
            <button type="button" id={nameId} className={s.name} data-open="" onClick={(event) => openSheet('agent', agent.id, event.currentTarget)}>
              {agent.name}
            </button>
            <p className={s.role}>{agent.role}</p>
            {helps && <p className={s.helps}>{t('team.helps', { name: helps })}</p>}
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
        <HealthLine health={agent.health} agentId={agent.id} onCleared={onChanged} />
        {run?.progress && (
          <div className={s.progress}>
            <ProgressBar progress={run.progress} tone={toneOf(run)} className={s.bar} />
            {elapsedOf(run) && <span className={cx(s.elapsed, 'mono')}>{elapsedOf(run)}</span>}
          </div>
        )}
        {/* Its last result, only while it has nothing on now (D-Team's idle cards); the rest are in its panel's runs. */}
        {!run && agent.last && (
          <p className={s.last}>
            <Result line={agent.last.line} receiptId={agent.last.receiptId} estimate={agent.last.estimate} />
          </p>
        )}
        <div className={s.foot}>
          <PostureChip posture={agent.posture} />
          {/* A role whose steps are code (W4 4A1 kind 'code'): said in words, as Keeper says it. */}
          {agent.kind === 'code' && <Chip tone="line">{t('team.keeper.code')}</Chip>}
          {canChat(agent) && (
            <Button
              variant="chat"
              className={c.chatButton}
              aria-label={t('team.chat.open', { name: agent.name })}
              onClick={(event) => openSheet('agent', agent.id, event.currentTarget, 'chat')}
            />
          )}
        </div>
      </Card>
      {helpers && (
        <div className={x.helpersBox}>
          <p className={x.helpersSpend} data-helpers-spend="">
            {t('team.helpers.spend')}{' '}
            <a className={x.helpersMoney} href="#/money/spend">{t('team.helpers.money')}</a>
          </p>
          <ul className={x.helpers} aria-label={t('team.helpers.list', { name: agent.name })}>{helpers}</ul>
        </div>
      )}
    </li>
  );
}

export interface AgentListProps {
  members: readonly Member[];
  /** The list's name ("Agents", "Production agents"). */
  label: string;
  dept?: DeptId | undefined;
  ground: 'inner' | 'lift';
  onChanged?: (() => void) | undefined;
  /** Keeper's jobs as rows, not in a fold (one department shown alone). */
  keeperOpen?: boolean | undefined;
}

/**
 * Agent cards in a grid: agents doing something first, then idle ones, each in the engine's order. Past eight, the
 * idle ones fold behind "Show n idle"; opening the fold moves focus to the first card it showed.
 */
export function AgentList({ members, label, dept, ground, onChanged, keeperOpen }: AgentListProps) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  // Helpers sit under the agent they help, inside its place (W4 4J12, 4J22b); Keeper, code with no runs of its own,
  // comes last. Only the agents at the top count toward the fold.
  const ordered = nested(busyFirst(members));
  const names = new Map(members.map((member) => [member.agent.id, member.agent.name]));
  const parentOf = (member: Member) => (member.agent.parentId && names.has(member.agent.parentId) ? member.agent.parentId : null);
  const top = ordered.filter((member) => !parentOf(member));
  const shown = open ? top : top.filter((member, at) => at < MOST_SHOWN || member.state !== 'idle');
  const folded = top.length - shown.length;

  function unfold() {
    const first = shown.length;
    setOpen(true);
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>(':scope > [data-row]')[first]?.focus());
  }

  return (
    <>
      <ul ref={list} className={s.agents} aria-label={label}>
        {shown.map(function card(member: Member): ReactNode {
          if (isKeeper(member.agent)) return <KeeperCard key={member.agent.id} member={member} dept={dept} ground={ground} open={keeperOpen} />;
          const helping = ordered.filter((other) => parentOf(other) === member.agent.id);
          return (
            <AgentCard
              key={member.agent.id}
              member={member}
              dept={dept}
              ground={ground}
              helps={member.agent.parentId ? names.get(member.agent.parentId) : undefined}
              onChanged={onChanged}
              helpers={helping.length ? helping.map(card) : undefined}
            />
          );
        })}
      </ul>
      {folded > 0 && (
        <button type="button" className={s.fold} aria-expanded={false} onClick={unfold}>
          {t('team.showIdle', { count: folded })}
        </button>
      )}
    </>
  );
}
