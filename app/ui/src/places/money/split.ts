/**
 * AI spend this month by department, for Money's spend tile (W4 4A2): the engine's department spend and the part no
 * single department can claim (`shared`), each with the share of the month's whole spend the engine worked out
 * (`sharePermille`, views/team-series.ts). The amounts are the engine's text and the whole split is proved by the
 * receipt of the month's spend they add up to (the team totals' figure, which is Money's own). Nothing is divided here:
 * a part with no share from the engine means no split at all.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { DepartmentSpend, TeamListView, VentureRunEvent } from '../../engine/types';
import { splitFigure } from '../../parts/Figure';
import type { SplitData, SplitPartId } from '../../parts/charts/types';
import { DEPT_OF } from '../team/departments';

/** The split moves when spend does: a run's calls settle, or the business changes. */
const onSpend = (event: VentureRunEvent) => event.type.startsWith('run.') || event.type === 'queue.changed';

type Part = SplitData['parts'][number];

function partOf(dept: SplitPartId, spend: DepartmentSpend): Part | null {
  if (spend.sharePermille === undefined) return null;
  // The amount alone (the engine's words after it, "includes estimates", stay with the month's figure above), led as the
  // engine says (4Z3: rupees or dollars first, as the month's figure above).
  return { dept, amount: splitFigure(spend.lead?.figure ?? spend.display).amount, permille: spend.sharePermille };
}

/** The split from the team view, or undefined when the engine sends no departments, totals or shares. */
export function splitOf(view: TeamListView | undefined, label: (parts: string) => string, name: (dept: SplitPartId) => string): SplitData | undefined {
  if (!view?.departments || view.departments.length === 0 || !view.totals) return undefined;
  const parts: Part[] = [];
  for (const department of view.departments) {
    const part = partOf(DEPT_OF[department.id], department.spendThisMonth);
    if (!part) return undefined;
    parts.push(part);
  }
  if (view.shared) {
    const part = partOf('shared', view.shared);
    if (!part) return undefined;
    parts.push(part);
  }
  return {
    parts,
    proof: { receiptId: view.totals.spendThisMonth.receiptId },
    label: label(parts.map((part) => `${name(part.dept)} ${part.amount}`).join(', ')),
  };
}

/** Money's spend split for the open business, from venture.team.list. */
export function useSpendSplit(): SplitData | undefined {
  const t = useT();
  const team = useResource('venture.team.list', {}, { refreshOn: onSpend });
  return splitOf(team.data, (parts) => t('money.split.label', { parts }), (dept) => (dept === 'shared' ? t('chart.shared') : t(`dept.${dept}`)));
}
