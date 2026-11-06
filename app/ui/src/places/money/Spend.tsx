/**
 * What paid calls cost: each one reserved before it ran and settled after, by agent or connector, with the engine's
 * word for the figure (estimate, billed) and its receipt when there is one. A call with no price is refused, never
 * treated as free; a refused row says why in the engine's words. With the owner's own rupee rate, the engine also gives
 * each figure in rupees, with that rate, and it sits beside the dollars. Under the calls, the owner's limits and rate
 * card (SpendPolicy.tsx). Spend limits stay in US dollars, what the AI providers bill.
 *
 * A call with a receipt shows its figures under that receipt (one `data-figure-group`). The engine sends a call still
 * held at its estimate, and the month's total, with no receipt of their own yet: those stay the engine's words, never
 * set as proved figures, until W4 4J1 sends their receipts.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import type { SpendRow } from '../../engine/types';
import { Amount, EngineWords, Failed, Rupees, Section } from './parts';
import { SpendPolicy } from './SpendPolicy';
import { onRuns } from './words';
import s from './Money.module.css';

export function Spend() {
  const t = useT();
  const spend = useResource('venture.spend.list', {}, { refreshOn: onRuns });
  const rows = spend.data?.rows ?? [];
  const total = spend.data && (
    <p className={s.total}>
      <EngineWords><Amount text={spend.data.total} /></EngineWords>
      <Rupees text={spend.data.totalRupees} />
    </p>
  );

  return (
    <>
      {spend.error && <Failed error={spend.error} />}
      <Section title={t('money.spend.title')} end={total}>
        {spend.data && rows.length === 0 && <EmptyState title={t('money.spend.none')} />}
        {rows.length > 0 && (
          <ul className={s.list}>
            {rows.map((row) => (
              <Row key={row.id} id={row.id} eyebrow={row.agent ?? row.connector} title={row.label}>
                <SpendFigures row={row} />
                {row.kind === 'refused' && row.reason && <p className={s.quietLine} data-engine-line="">{row.reason}</p>}
              </Row>
            ))}
          </ul>
        )}
        {rows.some((row) => row.kind === 'refused' && !row.reason) && <p className={s.quietLine}>{t('money.spend.refusedNote')}</p>}
      </Section>
      <SpendPolicy />
    </>
  );
}

function SpendFigures({ row }: { row: SpendRow }) {
  const t = useT();
  const kind = <span className={s.kind} data-kind={row.kind}>{t(`money.spend.kind.${row.kind}`)}</span>;
  const dot = <span className={s.dot} aria-hidden="true">·</span>;
  const figure = (value: string) => <Amount text={value} />;
  const body = row.kind === 'refused' ? (
    <>{figure(row.reserved)}<Rupees text={row.reservedRupees} />{dot}{kind}</>
  ) : (
    <>
      <span className={s.figureLabel}>{t('money.spend.reserved')}</span>{' '}{figure(row.reserved)}<Rupees text={row.reservedRupees} />
      {dot}
      {row.settled !== undefined
        ? <><span className={s.figureLabel}>{t('money.spend.settled')}</span>{' '}{figure(row.settled)}<Rupees text={row.settledRupees} /></>
        : <span className={s.figureLabel}>{t('money.spend.notSettled')}</span>}
      {dot}
      {kind}
    </>
  );
  // With its receipt, the call's figures sit under it; without one, they are the engine's words as written.
  return row.receiptId
    ? <p className={s.figures} data-figure-group="">{body}<Receipt id={row.receiptId} /></p>
    : <p className={s.figures} data-engine-line="">{body}</p>;
}
