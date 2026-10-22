import { useT } from '../text';
import { openSheet } from '../shell/navigation';
import s from './Receipt.module.css';

const SHORT_REFERENCE = /^[A-Za-z]{1,4}-?\d{1,8}$/;

/**
 * A receipt reference: a button that opens the receipt sheet. A receipted figure is always reachable this way;
 * the UI never shows a bare amount where a receipt belongs.
 */
export function Receipt({ id, onOpen }: { id: string; onOpen?: ((id: string) => void) | undefined }) {
  const t = useT();
  // A short reference such as R-0412 reads as itself; a long engine id reads as the word, and the sheet shows it whole.
  const short = SHORT_REFERENCE.test(id);
  return (
    <button
      type="button"
      className={short ? `${s.receipt} mono` : s.receipt}
      aria-label={t('receipt.open', { id })}
      data-receipt={id}
      onClick={(event) => (onOpen ? onOpen(id) : openSheet('receipt', id, event.currentTarget))}
    >
      {short ? id : t('receipt.word')}
    </button>
  );
}
