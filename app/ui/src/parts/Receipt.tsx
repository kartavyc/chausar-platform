import { useT } from '../text';
import { openSheet } from '../shell/navigation';
import { Icon } from './Icon';
import s from './Receipt.module.css';

export interface ReceiptProps {
  id: string;
  /**
   * 4Z3: the amount this receipt proves, as the engine wrote it ("₹1,12,400"). The mark is named for it ("Receipt for
   * ₹1,12,400"); left out, where the receipt stands for a line or a set rather than one amount, it is named "Receipt".
   */
  amount?: string | undefined;
  onOpen?: ((id: string) => void) | undefined;
  /** `dark`: on the dark goal card, the mark in the card's light link colour. */
  tone?: 'dark' | undefined;
  /**
   * Where the receipt is kept. Left out: a price or sum receipt, read with venture.receipt.get. `ca`: a CA firm's
   * calculator receipt (a working paper's), read with venture.ca.receipt in the same receipt sheet. `work` (W4 4J19): a
   * receipt the work tools made, read with venture.work.get (Today's `work-receipt` sheet).
   */
  source?: 'ca' | 'work' | undefined;
}

/**
 * A receipt: a small, quiet receipt mark (the receipt icon) that opens the receipt sheet. A receipted figure is always
 * reachable this way; the UI never shows a bare amount where a receipt belongs. 4Z3 (founder, 27 Oct): the mark never
 * prints the receipt's code beside the amount (it read like accounting software); the code is shown inside the sheet
 * the mark opens, and stays on the mark as `data-receipt`. The mark's name says what it is ("Receipt for ₹1,12,400").
 */
export function Receipt({ id, amount, onOpen, tone, source }: ReceiptProps) {
  const t = useT();
  return (
    <button
      type="button"
      className={s.receipt}
      aria-label={amount ? t('receipt.for', { amount }) : t('receipt.mark')}
      data-receipt={id}
      data-tone={tone}
      data-receipt-source={source}
      onClick={(event) => (onOpen ? onOpen(id) : openSheet(source === 'ca' ? 'ca-receipt' : source === 'work' ? 'work-receipt' : 'receipt', id, event.currentTarget))}
    >
      <Icon name="receipt-text" size={14} />
    </button>
  );
}
