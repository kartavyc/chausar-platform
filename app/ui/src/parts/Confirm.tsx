import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../text';
import { Button, type ButtonSize } from './Button';
import s from './Confirm.module.css';
import { Swap } from './Swap';

export interface ConfirmProps {
  /** What it asks, in words. */
  children: ReactNode;
  /** The action's own words, the same as the button that asked. */
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Stops both buttons while the action is on its way. */
  busy?: boolean | undefined;
  /** It destroys or stops something: red words on an outline, never the fill. */
  tone?: 'danger' | undefined;
  size?: ButtonSize | undefined;
  /** The grouped name, for a place that shows the ask away from its button (a menu). */
  label?: string | undefined;
  /** Left out: Cancel, B1's one word for it. */
  cancelLabel?: string | undefined;
}

/**
 * One second ask for every place: the words, then Cancel as a secondary and the action as the primary, right-aligned,
 * where the asking button was. No colour block. Cancel takes the focus, so a second press never confirms by accident.
 */
export function Confirm({ children, action, onCancel, onConfirm, busy = false, tone, size, label, cancelLabel }: ConfirmProps) {
  const t = useT();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!cancel.current?.closest('[inert]')) cancel.current?.focus(); }, []);
  return (
    <div className={s.confirm} data-confirm-box="" data-second-ask="" role={label ? 'group' : undefined} aria-label={label}>
      <div className={s.words}>{children}</div>
      <div className={s.buttons}>
        <Button ref={cancel} size={size} disabled={busy} onClick={onCancel}>{cancelLabel ?? t('approval.cancel')}</Button>
        <Button
          variant={tone === 'danger' ? 'secondary' : 'primary'} tone={tone} size={size} data-confirm="" disabled={busy}
          aria-busy={busy || undefined} onClick={onConfirm}
        >
          {action}
        </Button>
      </div>
    </div>
  );
}

/** Keep this slot mounted around the asking button and its confirmation. Only its current controls can be used. */
export function ConfirmSlot({ asking, children }: { asking: boolean; children: ReactNode }) {
  return <Swap block value={asking ? 'asking' : 'button'}>{children}</Swap>;
}
