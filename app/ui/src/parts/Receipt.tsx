import { useT } from '../text';
import { openSheet } from '../shell/navigation';
import s from './Receipt.module.css';

/**
 * A receipt reference: a button that opens the receipt sheet. A receipted figure is always reachable this way;
 * the UI never shows a bare amount where a receipt belongs.
 */
export function Receipt({ id, onOpen }: { id: string; onOpen?: ((id: string) => void) | undefined }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`${s.receipt} mono`}
      aria-label={t('receipt.open', { id })}
      data-receipt={id}
      onClick={(event) => (onOpen ? onOpen(id) : openSheet('receipt', id, event.currentTarget))}
    >
      {id}
    </button>
  );
}
