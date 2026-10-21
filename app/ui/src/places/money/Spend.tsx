/**
 * What paid calls cost: each one reserved before it ran and settled after, by agent or connector, with the engine's
 * word for the figure (estimate, billed) and its receipt when there is one. A call with no price is refused, never
 * treated as free; the engine has no way to set such a price from the app yet, and the page says so.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { EmptyState } from '../../parts/EmptyState';
import { Receipt } from '../../parts/Receipt';
import { Row } from '../../parts/Row';
import type { SpendRow } from '../../engine/types';
import { Failed, Figure } from './parts';
import { onRuns } from './words';
import s from './Money.module.css';

export function Spend() {
  const t = useT();
  const spend = useResource('venture.spend.list', {}, { refreshOn: onRuns });
  const rows = spend.data?.rows ?? [];

  return (
    <>
      {spend.error && <Failed error={spend.error} />}
      {spend.data && <p className={s.total}><Figure>{spend.data.total}</Figure></p>}
      {spend.data && rows.length === 0 && <EmptyState title={t('money.spend.none')} />}
      {rows.length > 0 && (
        <ul className={s.list}>
          {rows.map((row) => (
            <Row key={row.id} id={row.id} eyebrow={row.agent ?? row.connector} title={row.label}>
              <SpendFigures row={row} />
            </Row>
          ))}
        </ul>
      )}
      {rows.some((row) => row.kind === 'refused') && <p className={s.quiet}>{t('money.spend.refusedNote')}</p>}
    </>
  );
}

function SpendFigures({ row }: { row: SpendRow }) {
  const t = useT();
  const kind = <span className={s.kind}>{t(`money.spend.kind.${row.kind}`)}</span>;
  const dot = <span className={s.dot} aria-hidden="true">·</span>;
  if (row.kind === 'refused') {
    return <p className={s.figures}><Figure>{row.reserved}</Figure>{dot}{kind}</p>;
  }
  return (
    <p className={s.figures}>
      <span className={s.figureLabel}>{t('money.spend.reserved')}</span>{' '}<Figure>{row.reserved}</Figure>
      {dot}
      {row.settled !== undefined
        ? <><span className={s.figureLabel}>{t('money.spend.settled')}</span>{' '}<Figure>{row.settled}</Figure></>
        : <span className={s.figureLabel}>{t('money.spend.notSettled')}</span>}
      {dot}
      {kind}
      {row.receiptId && <Receipt id={row.receiptId} />}
    </p>
  );
}
