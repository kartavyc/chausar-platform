import { Fragment, useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Count, proofOf } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { Receipt } from '../../parts/Receipt';
import { DEPT_ICONS } from '../../parts/icons';
import { Panel, type TileSpan } from '../../parts/Tile';
import { AgentList } from './AgentCard';
import type { DepartmentData } from './departments';
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
 * One department as D's tinted panel (`.dp.p-x`): its icon, name and counts, jobs done this week (a count) and spend
 * this month (with its receipt), then its agents as cards lifted off the tint, or, with nobody in it, one sentence and
 * the way to the ways to earn (spec section 8; the five departments are fixed). A container, never a card itself.
 */
export function DepartmentPanel({ data, span }: { data: DepartmentData; span?: TileSpan | undefined }) {
  const t = useT();
  const headId = useId();
  const name = t(`dept.${data.dept}`);
  const proof = data.spend ? proofOf({ receiptId: data.spend.receiptId }) : null;
  return (
    <Panel as="article" dept={data.dept} span={span} labelledBy={headId} className={s.panel}>
      <div className={s.deptHead}>
        <DeptIcon dept={data.dept} />
        <div className={s.deptTitle}>
          <h2 id={headId} className={s.deptName}>{name}</h2>
          <CountsLine counts={data.counts} />
        </div>
        <div className={s.deptStats}>
          {data.jobs !== undefined && (
            <div className={s.deptStat}>
              <Count value={data.jobs} className={s.deptCount} />
              <span className={s.deptLabel}>{t('team.dept.jobs')}</span>
            </div>
          )}
          {/* The spend and its receipt are one figure group, with the receipt on the label line, so the head keeps to
              one line at desktop widths (D's `.dp-s`: the figure over its words). */}
          {data.spend && proof && (
            <div className={s.deptStat} data-figure-group="">
              <span className={cx(s.deptCount, 'mono')}>{data.spend.value}</span>
              <span className={s.deptLabel}>{t('team.dept.spend')} <Receipt id={data.spend.receiptId} /></span>
            </div>
          )}
        </div>
      </div>
      {data.members.length > 0
        ? <AgentList members={data.members} label={t('team.dept.agents', { dept: name })} dept={data.dept} ground="lift" />
        : <EmptyState title={t('team.dept.none', { dept: name })} actions={[{ label: t('team.dept.noneLink'), href: '#/onboarding' }]} />}
    </Panel>
  );
}
