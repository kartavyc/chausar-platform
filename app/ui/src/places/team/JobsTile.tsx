import { useId } from 'react';
import { useT } from '../../text';
import { BarChart } from '../../parts/charts/BarChart';
import type { BarPoint } from '../../parts/charts/types';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { DepartmentData } from './departments';

/**
 * D-Team's "Jobs done this week": one bar per department, in the engine's order, each as long as the engine scaled it
 * against the busiest department's week (`doneThisWeek.permille`, 4A2), with the count beside it, and the team's total
 * in the head. Counts need no receipt; the spend is on each department's panel, so it is not said again here.
 */
export function JobsTile({ departments, total, span }: { departments: readonly DepartmentData[]; total: number; span: TileSpan }) {
  const t = useT();
  const headId = useId();
  const points = departments
    .filter((department) => department.jobs !== undefined)
    .map((department): BarPoint => ({
      key: department.id ?? department.dept,
      label: t(`dept.${department.dept}`),
      value: String(department.jobs),
      valuePermille: department.jobsPermille ?? null,
      dept: department.dept,
    }));
  if (points.length === 0) return null;
  return (
    <Tile as="section" span={span} labelledBy={headId}>
      <TileHead id={headId} title={t('team.jobs.title')} meta={t('team.jobs.all', { count: total })} more={{ href: '#/work', label: t('team.dept.openWork') }} />
      <BarChart
        kind="count"
        layout="ranked"
        series={[{ label: t('team.jobs.series'), points }]}
        label={t('team.jobs.label', { values: points.map((point) => `${point.label} ${point.value}`).join(', ') })}
      />
    </Tile>
  );
}
