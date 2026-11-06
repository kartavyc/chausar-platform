import { useT } from '../text';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './NotificationBell.module.css';

export interface NotificationBellProps {
  /** How many notifications are new, counted by the engine (W4 4G). */
  unread: number;
  onOpen?: (() => void) | undefined;
  /** Whether the notification centre it opens is showing. */
  expanded?: boolean | undefined;
  /** `outlined`: the round button in the page header. `bare`: no border, for the phone's top bar. */
  look?: 'outlined' | 'bare' | undefined;
  className?: string | undefined;
}

/**
 * The bell (D's `.ib` and the phone's `.tib`). It shows a dot when something is new and never a number on the icon;
 * the count is said in its name only ("Notifications, 2 new"), as the founder decided for every alert.
 */
export function NotificationBell({ unread, onOpen, expanded, look = 'outlined', className }: NotificationBellProps) {
  const t = useT();
  const fresh = unread > 0;
  return (
    <button
      type="button"
      className={cx(s.bell, className)}
      data-look={look}
      aria-label={fresh ? t('bell.new', { count: unread }) : t('bell.label')}
      aria-expanded={expanded}
      onClick={onOpen}
    >
      <Icon name="bell" size={look === 'bare' ? 20 : 18} />
      {fresh && <span className={s.dot} data-dot="" />}
    </button>
  );
}
