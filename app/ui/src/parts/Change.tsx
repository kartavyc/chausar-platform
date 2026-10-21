import { useT } from '../text';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import type { QueueChange } from '../engine/types';
import s from './Change.module.css';

export interface ChangeProps extends QueueChange {
  onReceipt?: ((id: string) => void) | undefined;
}

/** A value changing: the old one struck through in grey, the new one in ink, both in mono; then its receipt, or the
 *  words "model estimate" when a model wrote it (an estimate never shows a receipt). */
export function Change({ label, before, after, receiptId, estimate, onReceipt }: ChangeProps) {
  const t = useT();
  return (
    <span className={s.change}>
      {label && <span className={s.label}>{label}</span>}
      {before !== undefined && (
        <>
          <span className="sr-only">{t('change.was')} </span>
          <del className={`${s.old} mono`}>{before}</del>
        </>
      )}
      <span className="sr-only">{t('change.now')} </span>
      <span className={`${s.now} mono`}>{after}</span>
      {estimate ? <ModelEstimate /> : receiptId ? <Receipt id={receiptId} onOpen={onReceipt} /> : null}
    </span>
  );
}
