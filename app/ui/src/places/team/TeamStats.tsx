import { useLanguage, useT } from '../../text';
import type { MoneyOverviewLine, TeamListView } from '../../engine/types';
import { Avatar } from '../../parts/Avatar';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import { MiniBars } from '../../parts/charts/MiniBars';
import { StatTile } from '../../parts/StatTile';
import { Bento, Tile, type TileSpan } from '../../parts/Tile';
import { ProvedFigure, lineProof, spendShown } from '../money/parts';
import { HeldLine } from './DepartmentPanel';
import { DEPT_OF, spendOf, withoutRate, type Member } from './departments';
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
 * work (D's sub line) is the engine's words under that amount's own receipt (W4 4A1).
 */
function SpendTile({ line, held, span }: { line: MoneyOverviewLine; held?: { words: string; receiptId: string } | undefined; span: TileSpan }) {
  const t = useT();
  const proof = lineProof(line);
  if (!proof) return null;
  // 4Z3: the figure as the engine says it leads (rupees or dollars first), the other currency beneath it.
  const shown = spendShown(line.lead, line.value, line.rupees);
  return (
    <Tile span={span} pad="compact" card className={s.spendTile}>
      <p className={s.statLabel}><Icon name="indian-rupee" size={14} />{t('team.stats.spend')}</p>
      <div className={cx(s.statValue, WORDS.test(shown.value) && s.worded)}>
        <ProvedFigure value={shown.value} proof={proof} rupees={shown.rupees} />
      </div>
      {held && <HeldLine held={held} className={s.statHeld} />}
    </Tile>
  );
}

/** What running work holds, in the engine's words without the rate: the figure above says the rate, once. */
function heldOf(spend: NonNullable<TeamListView['totals']>['spendThisMonth']) {
  const held = spendOf(spend).held;
  return held ? { ...held, words: withoutRate(held.words, spend.rate) } : undefined;
}

/** The team's spend this month from its totals (W4 4A1: Money's own figure and receipt), as a Money spend line. */
function totalsLine(totals: NonNullable<TeamListView['totals']>): MoneyOverviewLine {
  const spend = totals.spendThisMonth;
  return { id: 'spent', label: '', value: spend.display, receiptId: spend.receiptId, ...(spend.rupees ? { rupees: spend.rupees } : {}), ...(spend.lead ? { lead: spend.lead } : {}) };
}

/**
 * "Team at a glance" (D-Team's `.stats`): who is working now, who waits on the owner and what for, and the business's
 * AI spend this month. Counts are counted; nothing is worked out. With the engine's team totals (W4 4A1), "Done this
 * week" is its count of jobs and the spend is its figure (Money's own); before them the spend is the money overview's.
 */
export function TeamStats({ members, spent, totals, bars }: {
  members: readonly Member[];
  spent: MoneyOverviewLine | undefined;
  totals?: TeamListView['totals'] | undefined;
  /** Each department's jobs this week, per mille of the busiest's (the engine's), for the small bars beside the count. */
  bars?: readonly number[] | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const working = members.filter((member) => member.state === 'working');
  const waiting = members.filter((member) => member.state === 'waiting');
  const one = waiting.length === 1 ? waiting[0] : undefined;
  // With the engine's totals (W4 4A1) the stats are four, D-Team's row: jobs done this week, and the spend from the
  // same partition as the departments, with what running work holds.
  const span: TileSpan = totals ? 3 : 4;
  const line = totals ? totalsLine(totals) : spent;
  return (
    <Bento as="section" label={t('team.stats')} className={s.stats}>
      <StatTile
        span={span}
        dot="working"
        label={t('team.stats.working')}
        count={working.length}
        side={working.length > 0 ? <Stack members={working} /> : undefined}
        sub={working.length > 0 ? joined(working.map((m) => m.agent.name), language) : t('team.stats.workingNone')}
      />
      <StatTile
        span={span}
        dot="wait"
        tone={waiting.length > 0 ? 'wait' : undefined}
        label={t('team.stats.waiting')}
        count={waiting.length}
        side={waiting.length > 0 ? <Stack members={waiting} ring /> : undefined}
        sub={one?.run
          ? t('team.stats.waitingOne', { agent: one.agent.name, purpose: one.run.purpose })
          : waiting.length > 0 ? joined(waiting.map((m) => m.agent.name), language) : t('team.stats.waitingNone')}
      />
      {totals && (
        <StatTile
          span={span}
          icon="check"
          label={t('team.stats.done')}
          count={totals.doneThisWeek.count}
          side={bars && bars.length > 0 ? <MiniBars heights={[...bars]} current={false} label={t('team.stats.doneBars')} /> : undefined}
        />
      )}
      {line && <SpendTile line={line} held={totals ? heldOf(totals.spendThisMonth) : undefined} span={span} />}
    </Bento>
  );
}
