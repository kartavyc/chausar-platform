import { useLanguage, useT } from '../../text';
import type { MoneyOverviewLine } from '../../engine/types';
import { Avatar } from '../../parts/Avatar';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import { StatTile } from '../../parts/StatTile';
import { Bento, Tile } from '../../parts/Tile';
import { ProvedFigure, lineProof } from '../money/parts';
import { DEPT_OF, type Member } from './departments';
import s from './Team.module.css';

/** Letters in the engine's spend text: it carries words beside the amount ("₹60.10, includes estimates"), so it is set
 *  at the tile figure size, where it fits on a line or two, instead of the stat size. */
const WORDS = /[A-Za-zऀ-ॿ]/;

/** Names joined the way the UI's language joins them ("Editor and Researcher"; "Editor, Researcher and Keeper"). */
function joined(names: string[], language: 'en' | 'hi'): string {
  return new Intl.ListFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { type: 'conjunction' }).format(names);
}

/** D's `.stack`: overlapping avatars, hidden, because the names are said in words under them. */
function Stack({ members, ring }: { members: Member[]; ring?: boolean | undefined }) {
  return (
    <span className={s.stack} aria-hidden="true">
      {members.map(({ agent, state }) => (
        <Avatar key={agent.id} name={agent.name} dept={agent.department ? DEPT_OF[agent.department] : undefined} state={ring ? state : undefined} size={28} />
      ))}
    </span>
  );
}

/**
 * The AI spend this month (D-Team's fourth `.stat`), through the part Money uses for the same line (money/parts.tsx):
 * the figure with its receipt, and the engine's rupee view beside it at the owner's own rate, both under that one
 * receipt. A spend line with no receipt draws no tile, as on Money: "includes estimates" means calls not settled yet,
 * a cost code worked out, so it is never labelled a model estimate and never shown bare. The amount held for running
 * work (D's sub line) is a placeholder until W4 4A.
 */
function SpendTile({ line }: { line: MoneyOverviewLine }) {
  const t = useT();
  const proof = lineProof(line);
  if (!proof) return null;
  return (
    <Tile span={4} pad="compact" card className={s.spendTile}>
      <p className={s.statLabel}><Icon name="indian-rupee" size={14} />{t('team.stats.spend')}</p>
      <div className={cx(s.statValue, WORDS.test(line.value) && s.worded)}>
        <ProvedFigure value={line.value} proof={proof} rupees={line.rupees} />
      </div>
    </Tile>
  );
}

/**
 * "Team at a glance" (D-Team's `.stats`): who is working now, who waits on the owner and what for, and the business's
 * AI spend this month from the engine's money overview. Counts are counted; nothing is worked out. "Done this week"
 * waits for the engine's department summaries (W4 4A).
 */
export function TeamStats({ members, spent }: { members: readonly Member[]; spent: MoneyOverviewLine | undefined }) {
  const t = useT();
  const language = useLanguage();
  const working = members.filter((member) => member.state === 'working');
  const waiting = members.filter((member) => member.state === 'waiting');
  const one = waiting.length === 1 ? waiting[0] : undefined;
  return (
    <Bento as="section" label={t('team.stats')} className={s.stats}>
      <StatTile
        span={4}
        dot="working"
        label={t('team.stats.working')}
        count={working.length}
        side={working.length > 0 ? <Stack members={working} /> : undefined}
        sub={working.length > 0 ? joined(working.map((m) => m.agent.name), language) : t('team.stats.workingNone')}
      />
      <StatTile
        span={4}
        dot="wait"
        tone={waiting.length > 0 ? 'wait' : undefined}
        label={t('team.stats.waiting')}
        count={waiting.length}
        side={waiting.length > 0 ? <Stack members={waiting} ring /> : undefined}
        sub={one?.run
          ? t('team.stats.waitingOne', { agent: one.agent.name, purpose: one.run.purpose })
          : waiting.length > 0 ? joined(waiting.map((m) => m.agent.name), language) : t('team.stats.waitingNone')}
      />
      {spent && <SpendTile line={spent} />}
    </Bento>
  );
}
