import { useT } from '../text';
import { openSheet } from '../shell/navigation';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './Receipt.module.css';

const SHORT_REFERENCE = /^[A-Za-z]{1,4}-?\d{1,8}$/;

export interface ReceiptProps {
  id: string;
  onOpen?: ((id: string) => void) | undefined;
  /** `dark`: the goal card's underlined light link (D's `.rc-d`), with no chip and no icon. */
  tone?: 'dark' | undefined;
  /**
   * Where the receipt is kept. Left out: a price or sum receipt, read with venture.receipt.get. `ca`: a CA firm's
   * calculator receipt (a working paper's), read with venture.ca.receipt in the same receipt sheet.
   */
  source?: 'ca' | undefined;
}

/**
 * A receipt reference: a button that opens the receipt sheet. A receipted figure is always reachable this way;
 * the UI never shows a bare amount where a receipt belongs. It looks like D's receipt chip (`.rc`): the receipt
 * icon and the id in DM Mono, on a light chip with a blue edge.
 */
export function Receipt({ id, onOpen, tone, source }: ReceiptProps) {
  const t = useT();
  // A short reference such as R-0412 reads as itself; a long engine id reads as the word, and the sheet shows it whole.
  const short = SHORT_REFERENCE.test(id);
  return (
    <button
      type="button"
      className={cx(s.receipt, short && 'mono')}
      aria-label={t('receipt.open', { id })}
      data-receipt={id}
      data-tone={tone}
      data-receipt-source={source}
      onClick={(event) => (onOpen ? onOpen(id) : openSheet(source === 'ca' ? 'ca-receipt' : 'receipt', id, event.currentTarget))}
    >
      {tone !== 'dark' && <Icon name="receipt-text" size={12} />}
      {short ? id : t('receipt.word')}
    </button>
  );
}
