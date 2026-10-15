/**
 * Figure: a value in the number face. Every figure opens its receipt, so the receipt
 * callback is required and a known value is always a button: there is no static amount.
 * A missing value is words, never a zero and never a blank; so is a value that arrived
 * without a receipt id. The exact value and the receipt id sit in the title; the amount
 * in words is the accessible name when the format module supplied it. All of the
 * figure's labels are shown beside it, outside the button, so they are still read.
 * A figure the owner told (`told`) has no receipt: it is drawn without a button, labelled
 * told by owner.
 */

import type { FigureOrMissing, Missing, StatementLabel } from '../app/presentation.ts';
import { isFigure, missingOf } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Label } from './Label';
import s from './Figure.module.css';

export const MISSING_WORDS: Readonly<Record<Missing, string>> = {
  absent: 'MISSING.absent',
  null: 'MISSING.null',
  unknown: 'MISSING.unknown',
  withheld: 'MISSING.withheld',
  'not-applicable': 'MISSING.not-applicable',
  'not-loaded-yet': 'MISSING.not-loaded-yet',
  'not-counted': 'MISSING.not-counted',
  'cash-not-captured': 'MISSING.cash-not-captured',
  'not-agreed': 'MISSING.not-agreed',
  none: 'MISSING.none',
};

export type FigureSize = 'row' | 'tile' | 'big';

export interface FigureProps {
  value: FigureOrMissing;
  size?: FigureSize | undefined;
  onReceipt: (receiptId: string) => void;
  /** Keep the figure out of the tab order; a list reaches it with Right and Left. */
  tabStop?: boolean | undefined;
  /** A statement label from the screen, shown after the figure's own labels. */
  statement?: StatementLabel | undefined;
  className?: string | undefined;
}

export function MissingWords({ missing, className }: { missing: Missing; className?: string | undefined }) {
  const t = useT();
  return <span className={[s.missing, className].filter(Boolean).join(' ')}>{t(MISSING_WORDS[missing])}</span>;
}

export function Figure({ value, size = 'row', onReceipt, tabStop = true, statement, className }: FigureProps) {
  const t = useT();
  const cls = [s.figure, s[size], className].filter(Boolean).join(' ');

  if (!isFigure(value)) {
    return <MissingWords missing={missingOf(value)} className={cls} />;
  }

  if (value.told) {
    return (
      <span className={cls} data-told="">
        <span className="fig" title={t('FIGURE.told', { exact: value.exact })}>{value.display}</span>
        {value.labels.map((label) => (
          <Label key={label} kind={label} className={s.label} />
        ))}
        <Label kind="told-by-owner" className={s.label} />
        {statement !== undefined && statement !== 'told-by-owner' && <Label kind={statement} className={s.label} />}
      </span>
    );
  }

  return (
    <span className={cls}>
      <button
        type="button"
        className={[s.button, 'fig'].join(' ')}
        title={t('FIGURE.title', { exact: value.exact, receipt: value.receiptId })}
        aria-label={value.spoken !== undefined ? t('FIGURE.spoken', { spoken: value.spoken }) : undefined}
        tabIndex={tabStop ? 0 : -1}
        onClick={() => onReceipt(value.receiptId)}
      >
        {value.display}
      </button>
      {value.asWritten !== undefined && <span className={s.asWritten}>{value.asWritten}</span>}
      {value.labels.map((label) => (
        <Label key={label} kind={label} className={s.label} />
      ))}
      {statement !== undefined && <Label kind={statement} className={s.label} />}
    </span>
  );
}
