import { Fragment, useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Count, proofOf } from '../../parts/Figure';
import { ProvedFigure } from '../money/parts';
import { Icon } from '../../parts/Icon';
import { Receipt } from '../../parts/Receipt';
import { DEPT_ICONS } from '../../parts/icons';
import { Panel, type TileSpan } from '../../parts/Tile';
import { AgentList } from './AgentCard';
import { withoutRate, type DepartmentData } from './departments';
import s from './Team.module.css';

/**
 * A department's counts in words, only the ones above zero: "1 working · 1 waiting on you · 1 run stopped · 2 idle".
 * Waiting is amber and stopped is red, in the words themselves; on a department tint the amber is --wait-strong.
 */
export function CountsLine({ counts, as: Tag = 'p' }: { counts: DepartmentData['counts']; as?: 'p' | 'span' | undefined }) {
  const t = useT();
  const parts: ReactNode[] = [];
  if (counts.working > 0) parts.push(<span key="working">{t('team.dept.working', { count: counts.working })}</span>);
  if (counts.waiting > 0) parts.push(<span key="waiting" data-tone="wait">{t('team.dept.waiting', { count: counts.waiting })}</span>);
  if (counts.stopped > 0) parts.push(<span key="stopped" data-tone="fail">{t('team.dept.stopped', { count: counts.stopped })}</span>);
  if (counts.idle > 0) parts.push(<span key="idle">{t('team.dept.idle', { count: counts.idle })}</span>);
  if (parts.length === 0) return null;
  return (
    <Tag className={s.counts} data-counts="">
      {parts.map((part, at) => <Fragment key={at}>{at > 0 && ' · '}{part}</Fragment>)}
    </Tag>
  );
}

/** The department's icon in D's white rounded box (`.dp-ic`), in the department's ink. */
export function DeptIcon({ dept, large }: { dept: DepartmentData['dept']; large?: boolean | undefined }) {
  return (
    <span className={s.deptIcon} data-dept={dept} data-large={large ? '' : undefined} aria-hidden="true">
      <Icon name={DEPT_ICONS[dept]} size={large ? 22 : 20} />
    </span>
  );
}

/**
 * One department as D's tinted panel (`.dp.p-x`): its icon and name, jobs done this week (a count), and under them its
 * spend this month (Money's ProvedFigure: the figure with its receipt and the engine's rupees beside it at the owner's
 * rate), then its agents as cards lifted off the tint, or, with nobody in it, one sentence and the way to the ways to
 * earn (spec section 8; the five departments are fixed). What would only repeat is left out: the counts line beside
 * cards that each say their own state, the held amount (the stats tile says it once), and the zero jobs and spend of a
 * department with nobody in it. A container, never a card itself.
 */
export function DepartmentPanel({ data, span, onChanged }: { data: DepartmentData; span?: TileSpan | undefined; onChanged?: (() => void) | undefined }) {
  const t = useT();
  const headId = useId();
  const name = t(`dept.${data.dept}`);
  const proof = data.spend ? proofOf({ receiptId: data.spend.receiptId }) : null;
  const empty = data.members.length === 0;
  // Nothing to say for a department nobody is in, that did no job and spent nothing (the engine's share is 0).
  const quiet = empty && (data.jobs ?? 0) === 0 && (data.spend?.share ?? 0) === 0;
  return (
    <Panel as="article" dept={data.dept} span={span} labelledBy={headId} className={s.panel}>
      <div className={s.deptHead}>
        <DeptIcon dept={data.dept} />
        <div className={s.deptTitle}>
          <h2 id={headId} className={s.deptName}>{name}</h2>
          {empty && <CountsLine counts={data.counts} />}
        </div>
        {data.jobs !== undefined && !quiet && (
          <div className={s.deptStat}>
            <Count value={data.jobs} className={s.deptCount} />
            <span className={s.deptLabel}>{t('team.dept.jobs')}</span>
          </div>
        )}
      </div>
      {/* No spend line where the engine's share is 0: nothing, or under a thousandth of the month (Money lists it). */}
      {data.spend && proof && !quiet && data.spend.share !== 0 && (
        <p className={s.deptSpend}>
          <span className={s.deptLabel}>{t('team.dept.month')}</span>{' '}
          <ProvedFigure value={data.spend.value} proof={proof} rupees={data.spend.other ?? (data.spend.rupees && withoutRate(data.spend.rupees, data.spend.rate))} size="dept" className={s.deptFigure} />
        </p>
      )}
      {data.members.length > 0
        ? <AgentList members={data.members} label={t('team.dept.agents', { dept: name })} dept={data.dept} ground="lift" onChanged={onChanged} />
        : <EmptyState title={t('team.dept.none', { dept: name })} actions={[{ label: t('team.dept.noneLink'), href: waysFor(data.dept) }]} />}
    </Panel>
  );
}

/** The ways to earn, for a department that has no agents yet (spec 8): the Start gallery, opened on that department. */
export function waysFor(dept: DepartmentData['dept']): string {
  return `#/onboarding?dept=${dept}`;
}

/**
 * What calls still running hold of a spend, in the engine's words ("including ₹18.00 held for running work"), proved
 * by that amount's own receipt: one figure group, so the amount is never shown bare.
 */
export function HeldLine({ held, className }: { held: { words: string; receiptId: string }; className?: string | undefined }) {
  return (
    <p className={cx(s.held, className)} data-held="" data-figure-group="">
      {held.words} <Receipt id={held.receiptId} />
    </p>
  );
}

