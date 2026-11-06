import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import s from './TodayActions.module.css';

/**
 * W4 4J19: a work receipt (`work-receipt:<id>`), the receipt behind a working paper's figure that the engine's work tools
 * made (sums, totals, a reconciliation), read with venture.work.get. The receipt sheet again: the receipt's own figures
 * in plain DM Mono, the steps code took, and its explanation, every line the engine's own.
 */
export function WorkReceiptSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const receipt = useResource('venture.work.get', { id });
  const view = receipt.data;
  return (
    <Sheet label={t('sheet.receipt')} title={<span className="mono">{id}</span>} onClose={onClose} returnFocus={returnFocus} receipt>
      {receipt.error && <p className={s.problem}>{t('sheet.failed', { message: receipt.error.message })}</p>}
      {!view && !receipt.error && <p className={s.hint}>{t('sheet.loading')}</p>}
      {view && (
        <div className={s.workReceipt}>
          {view.figures.length > 0 && (
            <dl className={s.workFigures}>
              {view.figures.map((figure) => (
                <div key={figure.key} className={s.workFigure}>
                  <dt>{figure.label}</dt>
                  <dd className="mono">{figure.display}</dd>
                </div>
              ))}
            </dl>
          )}
          {view.steps.length > 0 && (
            <ol className={s.workSteps}>
              {view.steps.map((step, index) => <li key={index}>{step.rule}</li>)}
            </ol>
          )}
          {view.coverage && <p className={s.hint}>{view.coverage.line}</p>}
          <p className={s.said}>{view.explanation}</p>
        </div>
      )}
    </Sheet>
  );
}
