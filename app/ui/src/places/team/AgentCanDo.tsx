import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { AgentView, CapabilityItemView } from '../../engine/types';
import { Chip, type ChipTone } from '../../parts/Chip';
import { AgentSkills } from './AgentSkills';
import { capabilityPageWords, capabilityWords } from './CapabilityWords';
import s from './AgentExtras.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Each state's chip: works is done, a hand-off waits on the owner, planned and off are plain labels. Words say it too. */
const TONE: Readonly<Record<CapabilityItemView['state'], ChipTone>> = { works: 'done', reads: 'neutral', records: 'neutral', 'hands-off': 'wait', planned: 'line', off: 'idle' };
const LISTS: readonly CapabilityItemView['list'][] = ['see', 'do', 'off'];

/**
 * The agent panel's Can do tab (W4 4J22b): its skills (AgentSkills), then its capability page (4J18's capabilities.ts;
 * catalogue A16): what the agent can see, what it
 * can do, and "If it is off here, it can't do it", with exact known static lines localized and honest states worded here
 * (works, reads, only recorded, you pass it on, planned, off). The engine's line on top says the order's AI team
 * shares one tool list, and the list itself says each step goes to the owner's own AI provider. Nothing is claimed
 * beyond what the engine lists. Changed evidence and client-authored step purposes stay verbatim.
 */
export function AgentCanDo({ agent, onTry }: { agent: AgentView; onTry: (starter: string) => void }) {
  const t = useT();
  const base = useId();
  const view = useResource('venture.agents.capabilities', { agent: agent.id });
  if (view.error) return <p className={s.problem} role="alert">{messageOf(view.error)}</p>;
  if (!view.data) return <p className={s.quiet}>{t('team.loading')}</p>;
  const page = view.data;
  return (
    <div className={s.tab}>
      <AgentSkills agent={agent} onTry={onTry} />
      <p className={s.line}>{capabilityPageWords(t, page.line)}</p>
      {LISTS.map((list) => {
        const items = page.items.filter((item) => item.list === list);
        const headId = `${base}-${list}`;
        return (
          <section key={list} className={s.section} aria-labelledby={headId}>
            <h3 id={headId} className={s.small}>{t(`team.cando.${list}`)}</h3>
            <ul className={s.items} aria-labelledby={headId}>
              {items.map((item) => (
                <li key={`${item.key}:${item.line}`} className={s.item} data-item="">
                  <span data-state={item.state} className={s.state}><Chip tone={TONE[item.state]}>{t(`team.cando.state.${item.state}`)}</Chip></span>
                  <span className={s.itemLine}>{capabilityWords(t, item.key, item.line)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
