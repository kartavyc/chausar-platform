import { useT } from '../text';
import { useResource } from '../engine/context';
import { BusinessMenu } from './BusinessMenu';
import { RAIL_PLACES, type Route } from './routes';
import { cx } from '../parts/cx';
import { Icon } from '../parts/Icon';
import { Logo } from '../parts/Logo';
import type { IconName } from '../parts/icons';
import s from './Rail.module.css';

type RailPlace = (typeof RAIL_PLACES)[number];

/** Each rail place's icon (D-STYLE.md section 4, "Rail"), keyed by RAIL_PLACES. */
const PLACE_ICONS: Readonly<Record<RailPlace, IconName>> = {
  today: 'sun',
  chats: 'messages-square',
  team: 'users',
  work: 'briefcase',
  clients: 'contact',
  money: 'wallet',
  connections: 'plug',
};

/**
 * The rail (D's `.rail`, 232 px): the brand, which goes home to Today; the business button and its menu; then the
 * seven places with their icons. Today carries the count of what needs the owner across every business on this
 * computer, amber while the owner is elsewhere. A phone never draws it: under 760 px the shell shows the top bar and
 * the bottom tabs instead (TopBar.tsx).
 */
export function Rail({ route }: { route: Route }) {
  const t = useT();
  const queue = useResource('venture.queue.list', { scope: 'all' }, { refreshOn: (event) => event.type === 'queue.changed' });
  const needsYou = queue.data?.needsYou ?? 0;
  // W4 4C2: Chats says "New" until the open business has its first chat; where the engine cannot list chats, nothing.
  const chats = useResource('venture.chief.threads', {}, { refreshOn: (event) => event.type === 'chief.message' });
  const firstChat = chats.data?.groups.length === 0;

  return (
    <nav className={s.rail} aria-label={t('shell.places')}>
      <div className={s.top}>
        <a className={s.brand} href="#/today" aria-label={t('rail.brand')}>
          <Logo wordmark className={s.logo} />
        </a>
        <BusinessMenu />
      </div>
      <ul className={s.places}>
        {RAIL_PLACES.map((place) => {
          const here = route.place === place;
          return (
            <li key={place}>
              <a className={cx(s.place, here && s.on)} href={`#/${place}`} aria-current={here ? 'page' : undefined}>
                <Icon name={PLACE_ICONS[place]} className={s.icon} />
                <span>{t(`place.${place}`)}</span>
                {place === 'today' && needsYou > 0 && (
                  <>
                    <span className={cx(s.count, 'mono')} aria-hidden="true" data-tone={here ? undefined : 'wait'}>{needsYou}</span>
                    <span className="sr-only">, {t('rail.needsYou', { count: needsYou })}</span>
                  </>
                )}
                {place === 'chats' && firstChat && (
                  <>
                    <span className={s.new} aria-hidden="true" data-new="">{t('rail.chats.new')}</span>
                    <span className="sr-only">{t('rail.chats.newWords')}</span>
                  </>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
