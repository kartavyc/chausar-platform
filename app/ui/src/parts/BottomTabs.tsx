import { useT } from '../text';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import type { IconName } from './icons';
import s from './BottomTabs.module.css';

export interface BottomTab {
  id: string;
  /** The place's address ("#/today"). */
  href: string;
  label: string;
  icon: IconName;
  /** How many things need the owner (Today's count). Drawn in DM Mono and said in words to screen readers. */
  badge?: number | string | undefined;
}

export interface BottomTabsProps {
  tabs: readonly BottomTab[];
  /** The id of the tab for the place on screen. */
  current: string;
  /** The nav's name; "Places" when left out. */
  label?: string | undefined;
  className?: string | undefined;
}

/**
 * The phone's bottom tabs (D's `nav.tabs`): one link per place with its icon and word, the current one marked with
 * `aria-current` and the accent tab line, Today's count as a dark badge. Each tab is the full height of the bar and
 * at least the 44 px touch target wide. The caller places the bar (the phone shell, 3H1).
 */
export function BottomTabs({ tabs, current, label, className }: BottomTabsProps) {
  const t = useT();
  return (
    <nav className={cx(s.tabs, className)} aria-label={label ?? t('tabs.label')}>
      {tabs.map((tab) => {
        const on = tab.id === current;
        const badge = tab.badge === undefined || tab.badge === '' ? undefined : tab.badge;
        return (
          <a
            key={tab.id}
            className={s.tab}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            data-current={on ? '' : undefined}
          >
            {on && <span className={s.line} data-tab-line="" aria-hidden="true" />}
            <Icon name={tab.icon} size={22} />
            <span className={s.word}>{tab.label}</span>
            {badge !== undefined && (
              <>
                <span className={s.badge} data-badge="" aria-hidden="true"><Count value={badge} /></span>
                <span className="sr-only">{`, ${t('tabs.needYou', { count: badge })}`}</span>
              </>
            )}
          </a>
        );
      })}
    </nav>
  );
}
