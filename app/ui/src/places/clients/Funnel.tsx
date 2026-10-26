/**
 * "How people moved" (D-Clients `.fun`; the engine's 4E1 funnel): over the last 90 days, how many cards reached each
 * stage, Found to Won, each bar that count against the largest (the engine's per mille, so the screen divides nothing),
 * then the count and the share that moved on in the engine's words ("71%"), every count with its count receipt in
 * "View chart data". Simple first: the chart is folded under its heading. Under it the forecast: the engine's figure
 * with its receipt, or its line saying why there is none yet.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { BarChart } from '../../parts/charts/BarChart';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { Tile } from '../../parts/Tile';
import type { PipelineView } from '../../engine/types';
import { CLOSED_STAGES } from './pipeline';
import s from './Pipeline.module.css';

export function Funnel({ view }: { view: PipelineView }) {
  const t = useT();
  const titleId = useId();
  const shown = view.funnel.filter((item) => !CLOSED_STAGES.has(item.stage) || item.stage === 'won');
  const forecast = view.forecast;
  return (
    <Tile as="section" labelledBy={titleId} className={s.funnel}>
      <details className={s.fold}>
        <summary className={s.foldSummary}>
          <Icon name="chevron-right" size={14} />
          <h2 id={titleId} className={s.foldTitle}>{t('clients.pipeline.funnel')}</h2>
          <span className={s.quiet}>{t('clients.pipeline.funnel.days')}</span>
        </summary>
        {shown.some((item) => item.reached > 0) ? (
          <BarChart
            kind="count"
            layout="ranked"
            label={t('clients.pipeline.funnel.label')}
            series={[{
              label: t('clients.pipeline.funnel.reached'),
              points: shown.map((item) => ({
                key: item.stage, label: t(`clients.pipeline.stage.${item.stage}`), valuePermille: item.reachedPermille ?? null, receiptId: item.receiptId,
                value: item.share ? t('clients.pipeline.funnel.value', { count: item.reached, share: item.share }) : String(item.reached),
              })),
            }]}
          />
        ) : <p className={s.quiet}>{t('clients.pipeline.funnel.none')}</p>}
        {forecast && ('line' in forecast
          ? <p className={s.quiet} data-forecast="">{forecast.line}</p>
          : <p className={s.forecast} data-forecast=""><Figure value={forecast.value} receiptId={forecast.receiptId} /> <span>{forecast.label}</span></p>)}
      </details>
    </Tile>
  );
}
