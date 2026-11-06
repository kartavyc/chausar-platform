/**
 * W6 6G1 (D42): what a chat change did, in the engine's words, with Undo beside it (every chat action has Undo). Undo
 * sends the request the engine returned with the change, so the chat goes back exactly as it was. Used by a chat's head
 * and by Settled chats in the business pages.
 */

import { useT } from '../../text';
import { Button } from '../../parts/Button';
import { cx } from '../../parts/cx';
import sLocal from './ChangeNotice.module.css';

export interface ChangeNoticeProps {
  line: string;
  busy: boolean;
  onUndo: () => void;
  className?: string | undefined;
}

export function ChangeNotice({ line, busy, onUndo, className }: ChangeNoticeProps) {
  const t = useT();
  return (
    <p className={cx(sLocal.change, className)} role="status" aria-label={t('chats.change.label')}>
      <span>{line}</span>
      <Button variant="quiet" size="sm" disabled={busy} onClick={onUndo}>{t('chats.change.undo')}</Button>
    </p>
  );
}
