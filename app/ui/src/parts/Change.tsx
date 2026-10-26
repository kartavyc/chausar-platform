import { useT } from '../text';
import { cx } from './cx';
import { Icon } from './Icon';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import type { QueueChange } from '../engine/types';
import s from './Change.module.css';

/**
 * inline: in a row of text (v1, and anywhere a sentence carries it).
 * pill: the big before-and-after on an approval card (D's `.chg` in the price preview).
 * mini: the small one on a compact card (D's `.mchg`).
 */
export type ChangeSize = 'inline' | 'pill' | 'mini';

export interface ChangeProps extends QueueChange {
  onReceipt?: ((id: string) => void) | undefined;
  size?: ChangeSize | undefined;
}

/**
 * A value changing: the old one struck through in grey, an arrow (on a card), the new one in ink, both in mono; then
 * its receipt, or the words "model estimate" when a model wrote it (an estimate never shows a receipt). The old and
 * the new value share that one proof, so the change is one figure group (`data-figure-group`, see
 * tests/helpers/ink-rules.ts); a change the engine sends with neither proof fails that rule rather than pass as proved.
 * A screen reader hears "was ₹25,000 now ₹30,000", in the order the eye reads it.
 */
export function Change({ label, before, after, receiptId, estimate, onReceipt, size = 'inline' }: ChangeProps) {
  const t = useT();
  const arrow = size !== 'inline';
  const values = (
    <>
      {before !== undefined && (
        <>
          <span className="sr-only">{t('change.was')} </span>
          <del className={cx(s.old, 'mono')}>{before}</del>
          {arrow && (
            <span className={s.arrow} aria-hidden="true">
              <Icon name="arrow-right" size={size === 'pill' ? 16 : 12} />
            </span>
          )}
        </>
      )}
      <span className="sr-only">{t('change.now')} </span>
      <span className={cx(s.now, 'mono')}>{after}</span>
    </>
  );
  const proof = estimate ? <ModelEstimate /> : receiptId ? <Receipt id={receiptId} onOpen={onReceipt} /> : null;
  return (
    <span className={cx(s.change, s[size])} data-figure-group="" data-size={size}>
      {/* The label says what changes ("Most it can cost"), so every size shows it; the small one at the label size. */}
      {label && <span className={s.label}>{label}</span>}
      {size === 'pill' ? <span className={s.pillBody}>{values}</span> : values}
      {proof && <span className={s.proof}>{proof}</span>}
    </span>
  );
}
